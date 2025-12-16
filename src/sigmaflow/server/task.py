import copy
import time
import uuid
import json
import heapq
import asyncio
import traceback
import threading
from tqdm.rich import tqdm
from starlette.websockets import WebSocketState
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect

from ..log import log
from .constant import *

class TaskQueue:
    def __init__(self, ws_msges, loop=None, max_history_size=10000):
        self.ws_msges = ws_msges
        self.loop = loop
        self.max_history_size = max_history_size
        self.mutex = threading.RLock()
        self.not_empty = threading.Condition(self.mutex)
        self.task_counter = 0
        self.queue = []
        self.currently_running = {}
        self.history = {}
        self.flags = {}

    def put(self, item):
        with self.mutex:
            heapq.heappush(self.queue, item)
            self.queue_updated_broadcast()
            self.not_empty.notify()

    def get(self, timeout=None):
        with self.not_empty:
            while len(self.queue) == 0:
                self.not_empty.wait(timeout=timeout)
                if timeout is not None and len(self.queue) == 0:
                    return None
            item = heapq.heappop(self.queue)
            task_id = self.task_counter
            self.currently_running[task_id] = copy.deepcopy(item)
            self.task_counter += 1
            self.queue_updated_broadcast()
            return task_id, item

    def task_done(self, task_id, history_result, status):
        with self.mutex:
            item = self.currently_running.pop(task_id)
            if len(self.history) > self.max_history_size:
                self.history.pop(next(iter(self.history)))

            self.history[item[0]] = {
                "task": item,
                'status': status,
            } | history_result
            self.queue_updated_broadcast()

    def queue_updated_broadcast(self):
        m = Message(Events.MSG, self.get_queue_info())
        self.loop.call_soon_threadsafe(self.ws_msges.put_nowait, m)

    def get_queue_info(self):
        return {'queue_remaining': self.get_tasks_remaining()}

    def get_current_queue(self):
        with self.mutex:
            out = []
            for x in self.currently_running.values():
                out += [x]
            return (out, copy.deepcopy(self.queue))

    def get_tasks_remaining(self):
        with self.mutex:
            return len(self.queue) + len(self.currently_running)

    def wipe_queue(self):
        with self.mutex:
            self.queue = []
            self.server.queue_updated()

    def delete_queue_item(self, function):
        with self.mutex:
            for x in range(len(self.queue)):
                if function(self.queue[x]):
                    if len(self.queue) == 1:
                        self.wipe_queue()
                    else:
                        self.queue.pop(x)
                        heapq.heapify(self.queue)
                    self.server.queue_updated()
                    return True
        return False

    def get_history(self, prompt_id=None, max_items=None, offset=-1):
        with self.mutex:
            if prompt_id is None:
                out = {}
                i = 0
                if offset < 0 and max_items is not None:
                    offset = len(self.history) - max_items
                for k in self.history:
                    if i >= offset:
                        out[k] = self.history[k]
                        if max_items is not None and len(out) >= max_items:
                            break
                    i += 1
                return out
            elif prompt_id in self.history:
                return {prompt_id: copy.deepcopy(self.history[prompt_id])}
            else:
                return {}

    def wipe_history(self):
        with self.mutex:
            self.history = {}

    def delete_history_item(self, id_to_delete):
        with self.mutex:
            self.history.pop(id_to_delete, None)

    def set_flag(self, name, data):
        with self.mutex:
            self.flags[name] = data
            self.not_empty.notify()

    def get_flags(self, reset=True):
        with self.mutex:
            if reset:
                ret = self.flags
                self.flags = {}
                return ret
            else:
                return self.flags.copy()

    def cancel_task(self, task_id):
        with self.mutex:
            if task_id in [v[0] for v in self.currently_running.values()]:
                self.flags[task_id] = {"cancel": True}
                return "running"
            for idx, item in enumerate(self.queue):
                if item[0] == task_id:
                    self.queue.pop(idx)
                    heapq.heapify(self.queue)
                    self.queue_updated_broadcast()
                    return "queued"
        return None

class TaskWorker(threading.Thread):
    def __init__(self, queue=None, loop=None, ws_msges=None, pipeline_manager=None):
        name = self.__class__.__name__
        threading.Thread.__init__(self, name=name, daemon=True)
        self.queue = queue
        self.loop = loop
        self.ws_msges = ws_msges
        self.pipeline_manager = pipeline_manager
        log.debug(f'{name} thread start')

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
                self.send_msg(Events.TASK_END, {"task_id": task_id}, sid)

    def run_task(self, task_id, task_data, sid):
        self.send_msg(Events.TASK_START, {"task_id": task_id}, sid)

        out = None
        if self.pipeline_manager:
            msg_func = lambda out: self.send_msg(Events.TASK_ITEM_PROCESS, out, sid)
            def cancel_func(out):
                if self.queue.get_flags(reset=False).get(task_id, {}).get("cancel"):
                    raise Exception(f"Task {task_id} cancelled during execution.")

            for i, task in enumerate(tqdm(task_data)):
                self.send_msg(Events.TASK_ITEM_START, {"task_index": i, "total": len(task_data)}, sid)
                pipe = self.pipeline_manager.pipes[task['pipe']]
                pipe.add_node_finish_callback(callbacks=[msg_func, cancel_func])
                out, info = pipe.run(task['data'])
                self.send_msg(Events.TASK_ITEM_DONE, out, sid)
                # self.send_msg(Events.TASK_ITEM_DONE, info, sid)

        return out

    def send_msg(self, header, data, sid=None):
        data |= {"timestamp": int(time.time() * 1000)}
        m = Message(header, data, sid)
        self.loop.call_soon_threadsafe(self.ws_msges.put_nowait, m)

class WSConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}

    async def connect(self, websocket: WebSocket, sid: str):
        await websocket.accept()
        self.active_connections[sid] = websocket

    def disconnect(self, sid: str):
        if sid in self.active_connections:
            del self.active_connections[sid]

    async def send(self, msg: Message):
        match msg.header:
            case Events.UNENCODED_PREVIEW_IMAGE:
                data = self.encode_image(msg.data)
                func = 'send_bytes'
            case Events.PREVIEW_IMAGE:
                data = msg.data
                func = 'send_bytes'
            case _:
                data = msg.dict()
                func = 'send_json'

        if msg.sid:
            websocket = self.active_connections.get(msg.sid)
            if websocket and websocket.application_state == WebSocketState.CONNECTED:
                await getattr(websocket, func)(data)
        else:
            for ws in self.active_connections.values():
                if ws.application_state == WebSocketState.CONNECTED:
                    await getattr(ws, func)(data)

    def encode_image(self, image_data):
        from PIL import Image, ImageOps
        image_type = image_data[0]
        image = image_data[1]
        max_size = image_data[2]
        if max_size is not None:
            resampling = Image.Resampling.BILINEAR if hasattr(Image, 'Resampling') else Image.ANTIALIAS
            image = ImageOps.contain(image, (max_size, max_size), resampling)
        type_num = 1 if image_type == "JPEG" else 2
        bytes_io = BytesIO()
        header = struct.pack(">I", type_num)
        bytes_io.write(header)
        image.save(bytes_io, format=image_type, quality=95, compress_level=1)
        preview_bytes = bytes_io.getvalue()
        return preview_bytes

class TaskAPI:
    def __init__(self, pipeline_manager):
        self.router = router = APIRouter()
        ws_msges = asyncio.Queue()
        ws_manager = WSConnectionManager()
        task_queue = TaskQueue(ws_msges)

        async def ws_loop():
            while True:
                msg = await ws_msges.get()
                log.info(f'WS send: {msg}')
                await ws_manager.send(msg)

        @router.on_event("startup")
        async def startup_event():
            if task_queue.loop is None:
                log.debug("Setup Sigmaflow Task API")
                loop = asyncio.get_running_loop()
                task_queue.loop = loop
                TaskWorker(queue=task_queue, loop=loop, ws_msges=ws_msges, pipeline_manager=pipeline_manager).start()
                asyncio.create_task(ws_loop())

        @router.get("/task")
        async def get_task():
            return task_queue.get_queue_info()

        @router.get("/cur_task")
        async def get_cur_task():
            running, pending = task_queue.get_current_queue()
            queue_info = {
                'queue_running': running,
                'queue_pending': pending,
            }
            return queue_info

        @router.get("/cancel_task/{task_id}")
        async def cancel_task(task_id: str):
            status = task_queue.cancel_task(task_id)
            if status == "queued":
                return {"status": "removed_from_queue", "task_id": task_id}
            elif status == "running":
                return {"status": "cancelling_running_task", "task_id": task_id}
            else:
                raise HTTPException(status_code=404, detail="Task not found")

        @router.post("/task")
        async def process_task(data: TaskData):
            try:
                task_id = str(uuid.uuid4())
                task_queue.put((task_id, data.task, data.sid))

                ret = {"task_id": task_id}
                return ret
            except Exception as e:
                print(traceback.format_exc())
                raise HTTPException(status_code=500, detail=traceback.format_exc())

        @router.websocket("/ws")
        async def websocket_endpoint(ws: WebSocket, sid: Optional[str] = None):
            sid = sid or uuid.uuid4().hex
            await ws_manager.connect(ws, sid)

            try:
                data = {
                    'queue_remaining': task_queue.get_tasks_remaining(),
                }
                m = Message(Events.WS_CONNECTED, data, sid)
                await ws_manager.send(m)

                while True:
                    data = await ws.receive()
                    match data["type"]:
                        case "websocket.receive":
                            if data["text"]:
                                ret = None
                                try:
                                    task_data = json.loads(data["text"])
                                except:
                                    log.error("Error parsing JSON")
                                    ret = {"error": "Invalid JSON format"}
                                    e = Events.ERROR
                                if ret is None:
                                    task_id = str(uuid.uuid4())
                                    task_queue.put((task_id, task_data["task"], sid))
                                    ret = {"task_id": task_id}
                                    e = Events.MSG
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
