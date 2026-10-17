from pathlib import Path
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.responses import FileResponse
from starlette.status import HTTP_404_NOT_FOUND

from .api import PipelineAPI
from .task import TaskAPI
from .workspace import WorkspaceAPI
from .admin import AdminAPI
from .science import ScienceAPI


class SPAStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope):
        is_entry = not path or path.endswith("index.html") or path.endswith("/")
        try:
            res = await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code != HTTP_404_NOT_FOUND:
                raise
            if scope.get("method") not in {"GET", "HEAD"}:
                raise
            index_path = Path(self.directory) / "index.html"
            if not index_path.exists():
                raise
            res = FileResponse(index_path)
        # SPA 入口不可缓存: 浏览器每次都重新协商, 保证拿到最新前端代码
        if is_entry and getattr(res, "status_code", 0) == 200:
            res.headers["Cache-Control"] = "no-cache"
        return res


class PipelineServer:
    def __init__(self, pipeline_manager=None):
        self.app = FastAPI(title="Sigmaflow Server")

        @self.app.middleware("http")
        async def spa_no_cache(request, call_next):
            response = await call_next(request)
            # 设置页等 SPA 入口禁止缓存, 保证浏览器总能拿到最新前端代码
            if (
                request.url.path.endswith("index.html")
                or request.url.path.rstrip("/") == "/science"
            ):
                response.headers["Cache-Control"] = "no-cache"
            return response

        api = PipelineAPI(pipeline_manager)
        task = TaskAPI(pipeline_manager)
        workspace = WorkspaceAPI(pipeline_manager)
        admin = AdminAPI(pipeline_manager)
        science = ScienceAPI()

        self.app.include_router(api.router)
        self.app.include_router(task.router)
        self.app.include_router(workspace.router)
        self.app.include_router(admin.router)
        self.app.include_router(science.router)
        self.app.include_router(science.auth_router)

        web_root = Path(f"{__file__[: __file__.rindex('/')]}/website/dist/")
        work_root = Path(f"{__file__[: __file__.rindex('/')]}/comfyui/dist")
        admin_root = Path(f"{__file__[: __file__.rindex('/')]}/admin/dist")
        sci_root = Path(f"{__file__[: __file__.rindex('/')]}/science/dist")

        # Mount static files in order of specificity
        # Admin panel static files
        if admin_root.exists():
            self.app.mount(
                "/admin",
                SPAStaticFiles(directory=admin_root, html=True),
                name="SigmaFlow Admin",
            )

        # ComfyUI workspace
        if work_root.exists():
            self.app.mount(
                "/workspace/",
                StaticFiles(directory=work_root, html=True),
                name="SigmaFlow Workspace",
            )

        # Science workspace
        if sci_root.exists():
            self.app.mount(
                "/science/",
                StaticFiles(directory=sci_root, html=True),
                name="SigmaFlow Science",
            )

        # Main website (catch-all)
        if web_root.exists():
            self.app.mount(
                "/", StaticFiles(directory=web_root, html=True), name="SigmaFlow Web"
            )
