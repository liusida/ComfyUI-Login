import server
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
password_path = os.path.join(comfy_dir, "PASSWORD")
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
                username = 'User'
                if len(stored_data) > 1:
                    # Assuming username is stored on the second line, password on the first
                    username = stored_data[1].decode('utf-8')
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
    feedback = request.query.get('feedback', '')  # Get feedback from query parameters
    if 'logged_in' in session and session['logged_in']:
        raise web.HTTPFound('/')
    else:
        env = Environment(
            loader=FileSystemLoader(node_dir),
            autoescape=select_autoescape(['html', 'xml'])
        )
        template = env.get_template('login.html')
        first_time = not os.path.exists(password_path)
        username = ''
        if not first_time:
            username, _ = get_user_data()
        return web.Response(text=template.render(first_time=first_time, username=username, feedback=feedback), content_type='text/html')

@routes.post("/login")
async def login_handler(request):
    data = await request.post()
    username_input = data.get('username')
    password_input = data.get('password').encode('utf-8')
    feedback = ''
    if os.path.exists(password_path):
        # Existing user login attempt
        username_cached, password_cached = get_user_data()
        if bcrypt.checkpw(password_input, password_cached):
            session = await get_session(request)
            session['logged_in'] = True
            session['username'] = username_cached
            return web.HTTPFound('/')
        else:
            feedback = 'Wrong password'
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
    return web.HTTPFound('/login?feedback=' + feedback)

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
load_token()

# For loading all custom js
WEB_DIRECTORY = "js"

@web.middleware
async def check_login_status(request: web.Request, handler):
    if request.path == '/login' or request.path.endswith('.css') or request.path.endswith('.js'):
        # Skip for safe URIs
        response = await handler(request)
        return response
    session = await get_session(request)
    if TOKEN == "":
        load_token()
    if (request.query.get("token") == TOKEN) or ('logged_in' in session and session['logged_in']):
        response = await handler(request)
        if request.path == '/': # This avoids seeing the GUI after logging out and navigating back immediately.
            response.headers.setdefault('Cache-Control', 'no-cache')
        return response
    raise web.HTTPFound('/login')

app.middlewares.append(check_login_status)

NODE_CLASS_MAPPINGS = {}
