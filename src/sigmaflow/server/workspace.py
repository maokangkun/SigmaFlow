import json
import time
import uuid
import asyncio
import traceback
import threading
from pathlib import Path
from typing import Optional
from fastapi import APIRouter
from fastapi.responses import FileResponse
from fastapi import HTTPException, WebSocket, WebSocketDisconnect
from ..log import log
from .task import WSConnectionManager, TaskQueue, TaskWorker
from .constant import Events, Types, Message, WorkspacePromptData, InterruptData


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
                queue_id, (task_id, task_data, extra_data, sid) = queue_item
                log.debug(
                    f"{name}:\nqueue_id: {queue_id}\nsid: {sid}\ntask_id: {task_id}"
                )

                try:
                    out = self.run_task(task_id, task_data, extra_data, sid)
                except Exception:
                    err = traceback.format_exc()
                    log.error(err)
                    error = {
                        "prompt_id": task_id,
                        "exception_message": err,
                        "exception_type": "Error",
                        "traceback": [],
                    }
                    self.send_msg(Types.EXEC_ERROR, error, sid)
                    out = {"error": err}

                self.send_msg(Types.EXEC_SUCCESS, {"prompt_id": task_id}, sid)
                self.send_msg(
                    Types.EXECUTING, {"prompt_id": task_id, "node": None}, sid
                )  # remove progress in the browser tab bar

                self.queue.task_done(
                    queue_id,
                    {"outputs": out},
                    status={
                        "status_str": "success",
                        "completed": True,
                        "messages": None,
                    },
                )

    def run_task(self, task_id, task_data, extra_data, sid):
        self.send_msg(Types.EXEC_START, {"prompt_id": task_id}, sid)
        pipe_id = extra_data["extra_pnginfo"]["workflow"]["id"]
        pipeline = self.pipeline_manager.add_pipe(pipe_id, comfyui_data=task_data)
        pconf = pipeline.pipegraph.export_conf()
        self.send_msg(Types.TRANS_TO_PIPELINE, {"pipeline": pconf}, sid)

        runing_nodes = set()
        loop_nodes = {}

        def start_msg_func(data):
            runing_nodes.add(data["node"].split('-')[0])
            if data["node_type"] == "LoopNode":
                loop_nodes[data["node"].split('-')[0]] = {
                    "value": 0,
                    "max": data["info"].get("loop_count", 0),
                    "completed_nodes": {n:0 for n in pconf[data["node"]]["pipe_in_loop"]},
                }

            d = {
                "prompt_id": task_id,
                "nodes": {
                    node_id: {"display_node_id": node_id, "state": "running"} | (loop_nodes[node_id] if node_id in loop_nodes else {}) for node_id in runing_nodes
                },
                "from": data["node"],
            }
            self.send_msg(Types.PROG_STATE, d, sid)

        def finish_msg_func(data):
            node_id = data["node"].split('-')[0]
            out = data["out"]
            if type(out) is dict:
                out = json.dumps(out, indent=4, ensure_ascii=False)
            d = {
                "prompt_id": task_id,
                "display_node": node_id,
                "node": node_id,
                "output": {
                    "text": [out],
                    "execution_time": data["execution_time"],
                },
            }
            self.send_msg(Types.EXECUTED, d, sid)
            if node_id in runing_nodes: runing_nodes.remove(node_id)
            for n in loop_nodes:
                if data["node"] in loop_nodes[n]["completed_nodes"]:
                    loop_nodes[n]["completed_nodes"][data["node"]] += 1
                    v = min(loop_nodes[n]["completed_nodes"].values())
                    if v != loop_nodes[n]["value"]:
                        loop_nodes[n]["value"] = v
                        d = {
                            "prompt_id": task_id,
                            "nodes": {
                                node_id: {"display_node_id": node_id, "state": "running"} | (loop_nodes[node_id] if node_id in loop_nodes else {}) for node_id in runing_nodes
                            },
                            "from": data["node"],
                        }
                        self.send_msg(Types.PROG_STATE, d, sid)

        def cancel_func(out):
            if self.queue.get_flags(reset=False).get(task_id, {}).get("cancel"):
                raise Exception(f"Task {task_id} cancelled during execution.")

        pipeline.add_node_callback(start_cb=[start_msg_func], finish_cb=[finish_msg_func, cancel_func])

        inp_data = {}
        for _, d in task_data.items():
            match d["class_type"]:
                case "JSONData":
                    inp_data = json.loads(d["inputs"]["json"])
                case _:
                    pass

        for node_id in set(task_data.keys()) - set(k.split("-")[0] for k in pconf.keys()):
            d = {
                "prompt_id": task_id,
                "display_node": node_id,
                "node": node_id,
            }
            self.send_msg(Types.EXECUTED, d, sid)

        out, info = pipeline.run(inp_data)

        if "error_msg" in out:
            error = {
                "prompt_id": task_id,
                "exception_message": out["error_msg"],
                "exception_type": "Pipeline Error",
                "traceback": [],
            }
            self.send_msg(Types.EXEC_ERROR, error, sid)

        return out


class WorkspaceAPI:
    def __init__(self, pipeline_manager):
        self.router = router = APIRouter(prefix="/workspace")
        ws_msges = asyncio.Queue()
        ws_manager = WSConnectionManager()
        task_queue = WorkspaceTaskQueue(ws_msges)

        async def ws_loop():
            while True:
                msg = await ws_msges.get()
                log.info(f"WS send: {msg}")
                await ws_manager.send(msg)

        @router.on_event("startup")
        async def startup_event():
            if task_queue.loop is None:
                log.debug("Setup Sigmaflow Workspace API")
                loop = asyncio.get_running_loop()
                task_queue.loop = loop
                WorkspaceTaskWorker(
                    queue=task_queue,
                    loop=loop,
                    ws_msges=ws_msges,
                    pipeline_manager=pipeline_manager,
                ).start()
                asyncio.create_task(ws_loop())

        @router.get("/api/users")
        async def users():
            try:
                ret = {"storage": "server", "migrated": True}
                return ret
            except Exception:
                raise HTTPException(status_code=500, detail=traceback.format_exc())

        @router.get("/api/i18n")
        async def i18n():
            try:
                return {}
            except Exception:
                raise HTTPException(status_code=500, detail=traceback.format_exc())

        @router.get("/api/system_stats")
        async def system_stats():
            try:
                return {
                    "system": {
                        "os": "posix",
                        "ram_total": 536870912000,
                        "ram_free": 531932536832,
                        "comfyui_version": "0.3.70",
                        "required_frontend_version": "1.28.8",
                        "installed_templates_version": None,
                        "required_templates_version": "0.2.11",
                        "python_version": "3.13.5 | packaged by Anaconda, Inc. | (main, Jun 12 2025, 16:09:02) [GCC 11.2.0]",
                        "pytorch_version": "2.8.0+cu128",
                        "embedded_python": False,
                        "argv": ["main.py"],
                    },
                    "devices": [
                        {
                            "name": "cuda:0 NVIDIA",
                            "type": "cuda",
                            "index": 0,
                            "vram_total": 150393585664,
                            "vram_free": 149845180416,
                            "torch_vram_total": 0,
                            "torch_vram_free": 0,
                        }
                    ],
                }
            except Exception:
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
                    "Comfy.Locale": "en",
                }
            except Exception:
                raise HTTPException(status_code=500, detail=traceback.format_exc())

        @router.get("/api/global_subgraphs")
        async def global_subgraphs():
            return {}

        @router.get("/api/userdata")
        async def userdata():
            try:
                return []
            except Exception:
                raise HTTPException(status_code=500, detail=traceback.format_exc())

        @router.get("/api/extensions")
        async def extensions():
            try:
                return []
            except Exception:
                raise HTTPException(status_code=500, detail=traceback.format_exc())

        @router.get("/api/object_info")
        async def object_info():
            try:
                cur_folder = Path(__file__).parent
                obj = {}
                with open(cur_folder / "sigmaflow.json", "r") as f:
                    obj |= json.load(f)
                with open(cur_folder / "object_info.json", "r") as f:
                    obj |= json.load(f)
                return obj
            except Exception:
                raise HTTPException(status_code=500, detail=traceback.format_exc())

        @router.get("/api/experiment/models")
        async def models():
            try:
                cur_folder = Path(__file__).parent
                with open(cur_folder / "models.json", "r") as f:
                    return json.load(f)
            except Exception:
                raise HTTPException(status_code=500, detail=traceback.format_exc())

        @router.get("/api/queue")
        async def queue():
            try:
                return {"queue_running": [], "queue_pending": []}
            except Exception:
                raise HTTPException(status_code=500, detail=traceback.format_exc())

        @router.get("/api/history")
        async def history(max_items: int):
            try:
                return {}
            except Exception:
                raise HTTPException(status_code=500, detail=traceback.format_exc())

        @router.get("/api/view")
        async def view(filename: str, subfolder: str):
            print(filename, subfolder)
            try:
                image_path = (
                    "/home/kk/code/SigmaFlow/examples/demo/legend.png"
                )
                return FileResponse(image_path)
            except Exception:
                raise HTTPException(status_code=500, detail=traceback.format_exc())

        @router.post("/api/prompt")
        async def prompt(data: WorkspacePromptData):
            try:
                log.debug(f"prompt: {data.prompt}")
                prompt_id = str(data.prompt_id or uuid.uuid4())
                task_queue.put((prompt_id, data.prompt, data.extra_data, data.client_id))
                response = {"prompt_id": prompt_id, "number": 1, "node_errors": {}}
                return response
            except Exception:
                raise HTTPException(status_code=500, detail=traceback.format_exc())

        @router.post("/api/interrupt")
        async def interrupt(data: InterruptData):
            try:
                status = task_queue.cancel_task(data.prompt_id)
                if status == "queued":
                    return {"status": "removed_from_queue", "prompt_id": data.prompt_id}
                elif status == "running":
                    return {"status": "cancelling_running_task", "prompt_id": data.prompt_id}
                else:
                    raise HTTPException(status_code=404, detail="Task not found")
            except Exception:
                raise HTTPException(status_code=500, detail=traceback.format_exc())

        @router.websocket("/ws")
        async def websocket_endpoint(ws: WebSocket, clientId: Optional[str] = None):
            sid = clientId or uuid.uuid4().hex
            await ws_manager.connect(ws, sid)

            try:
                data = {
                    "status": {
                        "exec_info": {
                            "queue_remaining": task_queue.get_tasks_remaining(),
                        }
                    },
                    "sid": sid,
                }
                m = Message(Types.STATUS, data, sid)
                await ws_manager.send(m)

                first_message = True
                while True:
                    data = dict(await ws.receive())
                    match data["type"]:
                        case "websocket.receive":
                            if data["text"]:
                                ret: Optional[dict[str, object]] = None
                                try:
                                    json_data = json.loads(str(data["text"]))
                                except Exception:
                                    log.error("Error parsing JSON")
                                    ret = {"error": "Invalid JSON format"}
                                    e: Events | Types = Events.ERROR
                                if (
                                    ret is None
                                    and first_message
                                    and json_data.get("type") == "feature_flags"
                                ):
                                    ret = {
                                        "max_upload_size": 104857600,
                                        "supports_preview_metadata": True,
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
            except Exception:
                raise HTTPException(status_code=500, detail=traceback.format_exc())
