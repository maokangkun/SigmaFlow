from fastapi import FastAPI

from .api import PipelineAPI
from .task import TaskAPI

class PipelineServer:
    def __init__(self, pipeline_manager=None):
        self.app = FastAPI(title='Sigmaflow Server')

        api = PipelineAPI(pipeline_manager)
        task = TaskAPI(pipeline_manager)

        self.app.include_router(api.router)
        self.app.include_router(task.router)
