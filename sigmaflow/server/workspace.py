import json
import uuid
import time
import asyncio
import traceback
import threading
from pathlib import Path
from fastapi import APIRouter
from pydantic import BaseModel
from fastapi import HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, FileResponse
from .constant import *
from ..log import log
from .task import WSConnectionManager, TaskQueue, TaskWorker

class WorkspaceTaskQueue(TaskQueue):
    def queue_updated_broadcast(self):
        d = {"status": {"exec_info": self.get_queue_info()}}
        m = Message(Types.STATUS, d)
        self.loop.call_soon_threadsafe(self.ws_msges.put_nowait, m)

class WorkspaceTaskWorker(TaskWorker):
    def run(self):
        name = threading.current_thread().name

        while True:
            queue_item = self.queue.get(timeout=1000)
            if queue_item is not None:
                queue_id, (task_id, task_data, sid) = queue_item
                log.debug(f'{name}:\nqueue_id: {queue_id}\nsid: {sid}\ntask_id: {task_id}')

                try:
                    out = self.run_task(task_id, task_data, sid)
                except Exception as e:
                    err = traceback.format_exc()
                    log.error(err)
                    self.send_msg(Events.ERROR, {"error": err}, sid)
                    out = {"error": err}

                self.send_msg(Types.EXEC_SUCCESS, {"prompt_id": task_id}, sid)
                self.send_msg(Types.EXECUTING, {'prompt_id': task_id, 'node': None}, sid) # remove progress in the browser tab bar

                self.queue.task_done(
                    queue_id,
                    {
                        "outputs": out
                    },
                    status={
                        "status_str": 'success',
                        "completed": True,
                        "messages": None,
                    }
                )

    def run_task(self, task_id, task_data, sid):
        self.send_msg(Types.EXEC_START, {"prompt_id": task_id}, sid)

        d = {
            "prompt_id": task_id,
            "nodes": {
                1: {
                    'display_node_id': "1",
                    'state': "running",
                }
            }
        }
        self.send_msg(Types.PROG_STATE, d, sid)

        time.sleep(1)

        # node 2
        d = {
            "prompt_id": task_id,
            "nodes": {
                2: {
                    'display_node_id': "2",
                    'max': 20,
                    'state': "running",
                    'value': 0,
                },
            }
        }
        self.send_msg(Types.PROG_STATE, d, sid)

        for i in range(20):
            d = {
                "prompt_id": task_id,
                "nodes": {
                    2: {
                        'display_node_id': "2",
                        'max': 20,
                        'state': "running",
                        'value': i+1,
                    }
                }
            }
            self.send_msg(Types.PROG_STATE, d, sid)
            time.sleep(0.2)
        

        # node 3
        d = {
            "prompt_id": task_id,
            "nodes": {
                3: {
                    'display_node_id': "3",
                    'state': "running",
                },
            }
        }
        self.send_msg(Types.PROG_STATE, d, sid)

        d = {
            "prompt_id": task_id,
            "display_node": '3',
            'node': '3',
            "output": {
                'images': [
                    {
                        "filename": "ComfyUI_00005_.png",
                        "subfolder": "",
                        "type": "output"
                    }
                ]
            }
        }
        self.send_msg(Types.EXECUTED, d, sid)
        
        d = {
            "prompt_id": task_id,
            "nodes": {
                3: {
                    'display_node_id': "3",
                    'state': "finished",
                },
            }
        }
        self.send_msg(Types.PROG_STATE, d, sid)



        out = None
        # if self.pipeline_manager:
        #     msg_func = lambda out: self.send_msg(Events.TASK_ITEM_PROCESS, out, sid)
        #     def cancel_func(out):
        #         if self.queue.get_flags(reset=False).get(task_id, {}).get("cancel"):
        #             raise Exception(f"Task {task_id} cancelled during execution.")

        #     for i, task in enumerate(tqdm(task_data)):
        #         self.send_msg(Events.TASK_ITEM_START, {"task_index": i, "total": len(task_data)}, sid)
        #         pipe = self.pipeline_manager.pipes[task['pipe']]
        #         pipe.add_node_finish_callback(callbacks=[msg_func, cancel_func])
        #         out, info = pipe.run(task['data'])
        #         self.send_msg(Events.TASK_ITEM_DONE, out, sid)
        #         # self.send_msg(Events.TASK_ITEM_DONE, info, sid)

        return out

class WorkspaceAPI:
    def __init__(self, pipeline_manager):
        self.router = router = APIRouter(prefix='/workspace')
        ws_msges = asyncio.Queue()
        ws_manager = WSConnectionManager()
        task_queue = WorkspaceTaskQueue(ws_msges)

        async def ws_loop():
            while True:
                msg = await ws_msges.get()
                log.info(f'WS send: {msg}')
                await ws_manager.send(msg)

        @router.on_event("startup")
        async def startup_event():
            if task_queue.loop is None:
                log.debug("Setup Sigmaflow Workspace API")
                loop = asyncio.get_running_loop()
                task_queue.loop = loop
                WorkspaceTaskWorker(queue=task_queue, loop=loop, ws_msges=ws_msges, pipeline_manager=pipeline_manager).start()
                asyncio.create_task(ws_loop())

        @router.get("/api/users")
        async def users():
            try:
                ret = {
                    'storage': "server",
                    'migrated': True
                }
                return ret
            except Exception as e:
                raise HTTPException(status_code=500, detail=traceback.format_exc())
        
        @router.get("/api/i18n")
        async def i18n():
            try:
                return {}
            except Exception as e:
                raise HTTPException(status_code=500, detail=traceback.format_exc())
        
        @router.get("/api/system_stats")
        async def system_stats():
            try:
                return {
                    "system": {
                        "os": "posix",
                        "ram_total": 274877906944,
                        "ram_free": 270875971584,
                        "comfyui_version": "0.3.49",
                        "required_frontend_version": "1.24.4",
                        "python_version": "3.13.5 | packaged by Anaconda, Inc. | (main, Jun 12 2025, 16:09:02) [GCC 11.2.0]",
                        "pytorch_version": "2.7.1+cu128",
                        "embedded_python": False,
                        "argv": [
                            "main.py"
                        ]
                    },
                    "devices": [
                        {
                            "name": "cuda:0 NVIDIA A800-SXM4-80GB : cudaMallocAsync",
                            "type": "cuda",
                            "index": 0,
                            "vram_total": 17029083955,
                            "vram_free": 16594973491,
                            "torch_vram_total": 0,
                            "torch_vram_free": 0
                        }
                    ]
                }
            except Exception as e:
                raise HTTPException(status_code=500, detail=traceback.format_exc())

        @router.get("/api/settings")
        async def settings():
            try:
                return {
                    "Comfy.TutorialCompleted": True,
                    "Comfy.Release.Version": "0.3.44",
                    "Comfy.Release.Status": "what's new seen",
                    "Comfy.Release.Timestamp": 1752042448014,
                    "Comfy.ColorPalette": "dark",
                    "Comfy.Locale": "en"
                }
            except Exception as e:
                raise HTTPException(status_code=500, detail=traceback.format_exc())

        @router.get("/api/userdata")
        async def userdata():
            try:
                return []
            except Exception as e:
                raise HTTPException(status_code=500, detail=traceback.format_exc())
        
        @router.get("/api/extensions")
        async def extensions():
            try:
                return []
            except Exception as e:
                raise HTTPException(status_code=500, detail=traceback.format_exc())
        
        @router.get("/api/object_info")
        async def object_info():
            try:
                cur_folder = Path(__file__).parent
                with open(cur_folder / 'object_info.json', 'r') as f:
                    return json.load(f)
            except Exception as e:
                raise HTTPException(status_code=500, detail=traceback.format_exc())
        
        @router.get("/api/experiment/models")
        async def models():
            try:
                cur_folder = Path(__file__).parent
                with open(cur_folder / 'models.json', 'r') as f:
                    return json.load(f)
            except Exception as e:
                raise HTTPException(status_code=500, detail=traceback.format_exc())
        
        @router.get("/api/queue")
        async def queue():
            try:
                return {"queue_running": [], "queue_pending": []}
            except Exception as e:
                raise HTTPException(status_code=500, detail=traceback.format_exc())

        @router.get("/api/history")
        async def history(max_items: int):
            try:
                return {}
            except Exception as e:
                raise HTTPException(status_code=500, detail=traceback.format_exc())

        @router.get("/api/view")
        async def view(filename: str, subfolder: str):
            try:
                image_path = '/mnt/workspace/code/github/ComfyUI/output/ComfyUI_00001_.png'
                return FileResponse(image_path)
            except Exception as e:
                raise HTTPException(status_code=500, detail=traceback.format_exc())

        @router.post("/api/prompt")
        async def prompt(data: WorkspacePromptData):
            try:
                log.debug(f'prompt: {data.prompt}')
                prompt_id = str(data.prompt_id or uuid.uuid4())
                task_queue.put((prompt_id, data.prompt, data.client_id))
                response = {"prompt_id": prompt_id, "number": 1, "node_errors": {}}
                return response

                # node_errors = {
                #     4: {
                #         "errors": [{
                #             "type": "exception_during_validation",
                #             "message": "Exception when validating node",
                #             "details": 'test error',
                #             "extra_info": {
                #                 "exception_type": '',
                #                 "traceback": ''
                #             }
                #         }],
                #         "dependent_outputs": [],
                #         "class_type": "CheckpointLoaderSimple"
                #     }
                # }
                # return JSONResponse(status_code=400, content={"error": "test", "node_errors": node_errors})
            except Exception as e:
                raise HTTPException(status_code=500, detail=traceback.format_exc())

        @router.websocket("/ws")
        async def websocket_endpoint(ws: WebSocket, clientId: Optional[str] = None):
            sid = clientId or uuid.uuid4().hex
            await ws_manager.connect(ws, sid)

            try:
                data = {
                    'status': {
                        'exec_info':{
                            'queue_remaining': task_queue.get_tasks_remaining(),
                        }
                    },
                    'sid': sid,
                }
                m = Message(Types.STATUS, data, sid)
                await ws_manager.send(m)

                first_message = True
                while True:
                    data = await ws.receive()
                    match data["type"]:
                        case "websocket.receive":
                            if data["text"]:
                                ret = None
                                try:
                                    json_data = json.loads(data["text"])
                                except:
                                    log.error("Error parsing JSON")
                                    ret = {"error": "Invalid JSON format"}
                                    e = Events.ERROR
                                if ret is None and first_message and json_data.get("type") == "feature_flags":
                                    print(123)
                                    ret = {
                                        "max_upload_size": 104857600,
                                        "supports_preview_metadata": True
                                    }
                                    e = Types.FEATURE_FLAG
                                    first_message = False
                                if ret:
                                    m = Message(e, ret, sid)
                                    await ws_manager.send(m)
                        case "websocket.close":
                            break
                        case "websocket.disconnect":
                            break
            except WebSocketDisconnect:
                pass
            finally:
                ws_manager.disconnect(sid)

        @router.get("/internal/logs")
        async def logs():
            try:
                return {}
            except Exception as e:
                raise HTTPException(status_code=500, detail=traceback.format_exc())

