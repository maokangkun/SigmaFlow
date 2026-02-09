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


class SPAStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope):
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code != HTTP_404_NOT_FOUND:
                raise
            if scope.get("method") not in {"GET", "HEAD"}:
                raise
            index_path = Path(self.directory) / "index.html"
            if not index_path.exists():
                raise
            return FileResponse(index_path)


class PipelineServer:
    def __init__(self, pipeline_manager=None):
        self.app = FastAPI(title="Sigmaflow Server")

        api = PipelineAPI(pipeline_manager)
        task = TaskAPI(pipeline_manager)
        workspace = WorkspaceAPI(pipeline_manager)
        admin = AdminAPI(pipeline_manager)

        self.app.include_router(api.router)
        self.app.include_router(task.router)
        self.app.include_router(workspace.router)
        self.app.include_router(admin.router)

        web_root = Path(f"{__file__[: __file__.rindex('/')]}/website/dist/")
        work_root = Path(f"{__file__[: __file__.rindex('/')]}/comfyui/dist")
        admin_root = Path(f"{__file__[: __file__.rindex('/')]}/admin/dist")
        
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
        
        # Main website (catch-all)
        if web_root.exists():
            self.app.mount(
                "/", StaticFiles(directory=web_root, html=True), name="SigmaFlow Web"
            )
