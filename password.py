import server
from comfy.cli_args import args
import aiohttp
from aiohttp_session import setup, get_session
from aiohttp_session.cookie_storage import EncryptedCookieStorage
from aiohttp import web
from jinja2 import Environment, FileSystemLoader, select_autoescape
import base64
import os
import folder_paths
import bcrypt
from datetime import datetime, timedelta
import logging

node_dir = os.path.dirname(__file__)
comfy_dir = os.path.dirname(folder_paths.__file__)
password_path = os.path.join(comfy_dir, "login", "PASSWORD")
secret_key_path = os.path.join(node_dir,'.secret-key.txt')
login_html_path = os.path.join(node_dir, "login.html")
KEY_AGE_LIMIT = timedelta(days=30)  # Key expiration period
TOKEN = ""

# Global cache dictionary
user_cache = {}

def get_user_data():
    if 'username' in user_cache:
        return user_cache['username'], user_cache['password']
    else:
        if os.path.exists(password_path):
            with open(password_path, "rb") as f:
                stored_data = f.read().split(b'\n')
                password = stored_data[0]
                user_cache['password'] = password
                if len(stored_data) > 1 and stored_data[1].strip():
                    # Username exists in the second line
                    username = stored_data[1].decode('utf-8').strip()
                else:
                    # No username present, use a placeholder and prompt for update
                    username = None
                user_cache['username'] = username
                return username, password
        return None, None


def generate_key():
    return base64.urlsafe_b64encode(os.urandom(32)).decode('utf-8')

def write_key_to_file(key):
    with open(secret_key_path, 'w') as file:
        file.write(f"{key},{datetime.now().isoformat()}")

def read_key_from_file():
    try:
        with open(secret_key_path, 'r') as file:
            key, timestamp = file.read().split(',')
            return key, datetime.fromisoformat(timestamp)
    except FileNotFoundError:
        return None, None

def key_is_old(timestamp):
    return datetime.now() - timestamp > KEY_AGE_LIMIT

def get_or_refresh_key():
    key, timestamp = read_key_from_file()
    if key is None or timestamp is None or key_is_old(timestamp):
        key = generate_key()
        write_key_to_file(key)
    return key

# Access the PromptServer instance and its app
prompt_server = server.PromptServer.instance
app = prompt_server.app
routes = prompt_server.routes

secret_key = get_or_refresh_key()
setup(app, EncryptedCookieStorage(secret_key))

@routes.get("/login")
async def get_root(request):
    session = await get_session(request)
    wrong_password = request.query.get('wrong_password', '')
    if 'logged_in' in session and session['logged_in']:
        raise web.HTTPFound('/')
    else:
        env = Environment(
            loader=FileSystemLoader(node_dir),
            autoescape=select_autoescape(['html', 'xml'])
        )
        template = env.get_template('login.html')
        first_time = not os.path.exists(password_path)
        username, _ = get_user_data() if not first_time else (None, None)
        prompt_for_username = False

        if username is None and not first_time:
            # If there's no username but it's not the first time, prompt for username
            prompt_for_username = True

        return web.Response(text=template.render(first_time=first_time, username=username, wrong_password=wrong_password, prompt_for_username=prompt_for_username), content_type='text/html')

@routes.post("/login")
async def login_handler(request):
    data = await request.post()
    username_input = data.get('username')
    password_input = data.get('password').encode('utf-8')

    if os.path.exists(password_path):
        # Existing user login attempt
        username_cached, password_cached = get_user_data()
        if password_cached and bcrypt.checkpw(password_input, password_cached):
            # Password is correct
            session = await get_session(request)
            session['logged_in'] = True
            if username_cached:
                session['username'] = username_cached
            else:
                # Username needs to be added because it does not exist
                with open(password_path, "wb") as file:
                    file.write(password_cached + b'\n' + username_input.encode('utf-8'))
                user_cache['username'] = username_input
                session['username'] = username_input
            return web.HTTPFound('/')  # Redirect to the main page if the password is correct
        else:
            return web.HTTPFound('/login?wrong_password=1')
    else:
        # New user setup
        salt = bcrypt.gensalt()
        hashed_password = bcrypt.hashpw(password_input, salt)
        with open(password_path, "wb") as file:
            file.write(hashed_password + b'\n' + username_input.encode('utf-8'))
        user_cache['username'] = username_input
        user_cache['password'] = hashed_password
        session = await get_session(request)
        session['logged_in'] = True
        session['username'] = username_input
        return web.HTTPFound('/')
    return web.HTTPFound('/login') # will not be reached

@routes.get("/logout")
async def get_root(request):
    session = await get_session(request)
    session['logged_in'] = False
    session.pop('username', None)  # Clear the username
    response = web.HTTPFound('/login')  # Redirect to the main page if the password is correct
    return response

def load_token():
    global TOKEN
    try:
        with open(password_path, "r", encoding="utf-8") as f:
            TOKEN = f.readline().strip()  # Read only the first line and strip any newline characters
            logging.info(f"For direct API calls, use token={TOKEN}")
    except FileNotFoundError as e:
        logging.error("Please set up your password before use. The token will be a hashed string derived from your password.")
        TOKEN = ""

if not os.path.exists(os.path.dirname(password_path)):
    logging.info("Password directory does not exists, creating...")
    os.makedirs(os.path.dirname(password_path))

# Backward compatibility
# Move PASSWORD file in login folder
old_password_path = os.path.join(comfy_dir, "PASSWORD")
if os.path.exists(old_password_path):
    os.rename(old_password_path, password_path)

load_token()

async def process_request(request, handler):
    """Process the request by calling the handler and setting response headers."""
    response = await handler(request)
    if request.path == '/':  # Prevent caching the main page after logout
        response.headers.setdefault('Cache-Control', 'no-cache')
    return response

@web.middleware
async def check_login_status(request: web.Request, handler):
    # Skip authentication for specific paths
    if request.path == '/login' or request.path.endswith('.css') or request.path.endswith('.js'):
        return await handler(request)

    # Load the token if not already loaded
    if TOKEN == "":
        load_token()

    # Get the session and check if logged in
    session = await get_session(request)
    if 'logged_in' in session and session['logged_in']:
        # User is logged in via session, proceed without checking tokens
        return await process_request(request, handler)

    # Check the Authorization header for Bearer token
    if args.enable_cors_header is None or args.enable_cors_header == request.headers.get('Origin'):
        authorization_header = request.headers.get("Authorization")
        if authorization_header:
            auth_type, token_from_header = authorization_header.split()
            if auth_type == 'Bearer' and token_from_header == TOKEN:
                # Bearer token is valid, proceed without checking query token
                return await process_request(request, handler)

        # Fallback to check the token in the query
        if request.query.get("token") == TOKEN:
            return await process_request(request, handler)

    # Redirect to login if not authorized
    raise web.HTTPFound('/login')

app.middlewares.append(check_login_status)

NODE_CLASS_MAPPINGS = {}
