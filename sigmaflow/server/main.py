from pathlib import Path
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from .api import PipelineAPI
from .task import TaskAPI

class PipelineServer:
    def __init__(self, pipeline_manager=None):
        self.app = FastAPI(title='Sigmaflow Server')

        api = PipelineAPI(pipeline_manager)
        task = TaskAPI(pipeline_manager)

        self.app.include_router(api.router)
        self.app.include_router(task.router)

        web_root = Path(f'{__file__[:__file__.rindex("/")]}/web')
        self.app.mount("/web", StaticFiles(directory=web_root, html=True), name="SigmaFlow Web")
