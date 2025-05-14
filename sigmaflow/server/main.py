import asyncio
from fastapi import FastAPI
from ..log import log
from .api import PipelineAPI
from .utils import TaskQueue, TaskWorker

class PipelineServer:
    def __init__(self, pipeline_manager=None):
        self.app = app = FastAPI(title='Sigmaflow Server')
        task_queue = TaskQueue()

        api = PipelineAPI(pipeline_manager)
        app.include_router(api.router)

        @app.on_event("startup")
        async def startup_event():
            log.debug("Starting Sigmaflow server")
            loop = asyncio.get_running_loop()
            task_queue.loop = loop
            TaskWorker(queue=task_queue, loop=loop).start()

        @app.get("/task")
        async def get_task():
            return task_queue.get_queue_info()

        @app.get("/cur_task")
        async def get_cur_task():
            running, pending = task_queue.get_current_queue()
            queue_info = {
                'queue_running': running,
                'queue_pending': pending,
            }
            return queue_info

# @app.post("/task")
# async def post_prompt(data: PromptData):
#     if data.prompt:
#         extra_data = data.extra_data or {}
#         if data.client_id: extra_data["client_id"] = data.client_id

#         prompt_id = str(uuid.uuid4())
#         task_queue.put((0, prompt_id, data.prompt, extra_data))

#         ret = {
#             "prompt_id": prompt_id,
#             "number": 0, 
#             "node_errors": []
#         }
#         return ret
#     else:
#         raise HTTPException(status_code=400, detail={"error": "no prompt", "node_errors": []})


