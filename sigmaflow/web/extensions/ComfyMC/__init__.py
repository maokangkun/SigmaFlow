
import os
import sys

from server import PromptServer

try:
    import aiohttp
    from aiohttp import web
except ImportError:
    print("Module 'aiohttp' not installed. Please install it via:")
    print("pip install aiohttp")
    print("or")
    print("pip install -r requirements.txt")
    sys.exit()

version = "0.0.1"
print(f"=====> Loading ComfyMC-Service {version} <=====")

current_path = os.path.abspath(os.path.dirname(__file__))
web_path = os.path.join(current_path, "web")
index_file = os.path.join(current_path, "web/index.html")

@PromptServer.instance.routes.get("/mc")
async def mc_app(request):
    return web.FileResponse(index_file)

@PromptServer.instance.routes.get("/mc/{path:.*}")
async def mc_web(request):
    path = request.match_info['path']
    if os.path.exists(os.path.join(web_path, path)):
        return web.FileResponse(os.path.join(web_path, path))
    else:
        return web.FileResponse(index_file)
    

WEB_DIRECTORY = "lib"
I18N_DIRECTORY = "i18n"
NODE_CLASS_MAPPINGS = {}
__all__ = ['NODE_CLASS_MAPPINGS']