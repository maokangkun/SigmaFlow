from pathlib import Path
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from .api import PipelineAPI
from .task import TaskAPI
from .workspace import WorkspaceAPI

class PipelineServer:
    def __init__(self, pipeline_manager=None):
        self.app = FastAPI(title='Sigmaflow Server')

        api = PipelineAPI(pipeline_manager)
        task = TaskAPI(pipeline_manager)
        workspace = WorkspaceAPI(pipeline_manager)

        self.app.include_router(api.router)
        self.app.include_router(task.router)
        self.app.include_router(workspace.router)

        web_root = Path(f'{__file__[:__file__.rindex("/")]}/website/dist/')
        work_root = Path(f'{__file__[:__file__.rindex("/")]}/comfyui/dist')
        self.app.mount("/workspace/", StaticFiles(directory=work_root, html=True), name="SigmaFlow Workspace")
        self.app.mount("/", StaticFiles(directory=web_root, html=True), name="SigmaFlow Web")
