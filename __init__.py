import server
import aiohttp
from aiohttp_session import setup, get_session
from aiohttp_session.cookie_storage import EncryptedCookieStorage
from aiohttp import web
import base64
import os
import folder_paths
import bcrypt

node_dir = os.path.dirname(__file__)
comfy_dir = os.path.dirname(folder_paths.__file__)
password_path = os.path.join(comfy_dir, "PASSWORD")

# Access the PromptServer instance and its app
prompt_server = server.PromptServer.instance
app = prompt_server.app
routes = prompt_server.routes

secret_key = base64.urlsafe_b64decode(os.getenv('SECRET_KEY', base64.urlsafe_b64encode(os.urandom(32))))
setup(app, EncryptedCookieStorage(secret_key))

@routes.get("/login")
async def get_root(request):
    session = await get_session(request)
    if ('logged_in' in session and session['logged_in']):
        raise web.HTTPFound('/')
    else:
        return web.FileResponse(os.path.join(node_dir, "login.html"))

# Add a route for "/login" that handles the form submission
@routes.post("/login")
async def login_handler(request):
    data = await request.post()  # Get the data from the form
    password = data.get('password').encode('utf-8')
    if os.path.exists(password_path):
        with open(password_path, "rb") as f:
            hashed_password = f.read()
        if bcrypt.checkpw(password, hashed_password):
            session = await get_session(request)
            session['logged_in'] = True
            response = web.HTTPFound('/')  # Redirect to the main page if the password is correct
            return response
        else:
            return web.HTTPFound('/login?feedback=Wrong password')
    else:
        salt = bcrypt.gensalt()
        hashed_password = bcrypt.hashpw(password, salt)
        # Write the hashed password to a file
        with open(password_path, "wb") as file:
            file.write(hashed_password)
        session = await get_session(request)
        session['logged_in'] = True
        response = web.HTTPFound('/')  # Redirect to the main page if the password is correct
        return response

@routes.get("/logout")
async def get_root(request):
    session = await get_session(request)
    session['logged_in'] = False
    response = web.HTTPFound('/login')  # Redirect to the main page if the password is correct
    return response

# For loading all custom js
WEB_DIRECTORY = "js"

@web.middleware
async def check_login_status(request: web.Request, handler):
    if request.path == '/login' or request.path.endswith('.css') or request.path.endswith('.js'):
        # Skip for safe URIs
        response = await handler(request)
        return response
    session = await get_session(request)
    if ('logged_in' in session and session['logged_in']):
        response = await handler(request)
        if request.path == '/': # This avoids seeing the GUI after logging out and navigating back immediately.
            response.headers.setdefault('Cache-Control', 'no-cache')
        return response
    raise web.HTTPFound('/login')

app.middlewares.append(check_login_status)

NODE_CLASS_MAPPINGS = {}
