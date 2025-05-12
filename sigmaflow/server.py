from pydantic import BaseModel
from fastapi.staticfiles import StaticFiles
from starlette.websockets import WebSocketState
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, FileResponse, RedirectResponse

import time
import copy
import uuid
import json
import heapq
import struct
import asyncio
import threading
from io import BytesIO
from pathlib import Path
from itertools import chain
from functools import partial
from PIL import Image, ImageOps, PngImagePlugin
from typing import Optional, Dict, Any, Callable
from .log import log

PipelineServer = server = FastAPI(title='llmpipeline server')
PipelineServer.api = None
web_dir = 'web'
web_root = Path(f'{__file__[:__file__.rindex("/")]}/{web_dir}')
server.mount("/web", StaticFiles(directory=web_root, html=True), name="llmpipeline server web")

class BinaryEventTypes:
    PREVIEW_IMAGE = 1
    UNENCODED_PREVIEW_IMAGE = 2

class WSConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}

    async def connect(self, websocket: WebSocket, sid: str):
        await websocket.accept()
        self.active_connections[sid] = websocket

    def disconnect(self, sid: str):
        if sid in self.active_connections:
            del self.active_connections[sid]

    async def send(self, event, data, sid=None):
        if event == BinaryEventTypes.UNENCODED_PREVIEW_IMAGE:
            await self.send_image(data, sid=sid)
        elif isinstance(data, (bytes, bytearray)):
            await self.send_bytes(event, data, sid)
        else:
            message = {"type": event, "data": data}
            await self.send_json(message, sid)

    async def send_json(self, message: dict, sid: Optional[str] = None):
        if sid:
            websocket = self.active_connections.get(sid)
            if websocket and websocket.application_state == WebSocketState.CONNECTED:
                await websocket.send_json(message)
        else:
            for ws in self.active_connections.values():
                if ws.application_state == WebSocketState.CONNECTED:
                    await ws.send_json(message)

    async def send_bytes(self, data: bytes, sid: Optional[str] = None):
        if sid:
            websocket = self.active_connections.get(sid)
            if websocket and websocket.application_state == WebSocketState.CONNECTED:
                await websocket.send_bytes(data)
        else:
            for ws in self.active_connections.values():
                if ws.application_state == WebSocketState.CONNECTED:
                    await ws.send_bytes(data)

    async def send_image(self, image_data, sid: Optional[str] = None):
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
        await self.send_bytes(BinaryEventTypes.PREVIEW_IMAGE, preview_bytes, sid=sid)

class TaskQueue:
    def __init__(self, loop=None, max_history_size=10000):
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
            prompt = self.currently_running.pop(task_id)
            if len(self.history) > self.max_history_size:
                self.history.pop(next(iter(self.history)))

            self.history[prompt[1]] = {
                "prompt": prompt,
                'status': status,
            } | history_result
            self.queue_updated_broadcast()

    def queue_updated_broadcast(self):
        event = "status"
        data = {"status": self.get_queue_info()}
        self.loop.call_soon_threadsafe(ws_msges.put_nowait, (event, data, None))

    def get_queue_info(self):
        prompt_info = {
            'exec_info': {
                'queue_remaining': self.get_tasks_remaining()
            }
        }
        return prompt_info

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

class TaskWorker(threading.Thread):
    def __init__(self, queue=None, loop=None):
        name = self.__class__.__name__
        threading.Thread.__init__(self, name=name, daemon=True)
        self.queue = queue
        self.loop = loop
        log.debug(f'{name} thread start')

    def run(self):
        name = threading.current_thread().name

        while True:
            queue_item = self.queue.get(timeout=1000)
            if queue_item is not None:
                task_id, (_, prompt_id, task_data, extra_data) = queue_item
                log.debug(f'{name}:\ntask_id: {task_id}\nprompt_id: {prompt_id}\ntask_data: {task_data}\nextra_data: {extra_data}')

                out = self.run_task(prompt_id, task_data, extra_data)
                his = {
                    "outputs": {
                        out['node']: out['output'],
                    },
                    "meta": {},
                }

                self.queue.task_done(
                    task_id,
                    his,
                    status={
                        "status_str": 'success',
                        "completed": True,
                        "messages": None,
                    }
                )

                self.send_msg("executing", {"node": None, "prompt_id": prompt_id}, extra_data['client_id'])

    def run_task(self, prompt_id, task_data, extra_data):
        ws_id = extra_data.get('client_id', None)
        self.send_msg("execution_start", {"prompt_id": prompt_id}, ws_id)
        self.send_msg("execution_cached", {"nodes":[], "prompt_id": prompt_id}, ws_id)

        out = None
        if PipelineServer.api:
            pipe = PipelineServer.api.pipeline_manager.add_pipe('comfyUI', is_seq=True)
            out = pipe.run(prompt_id, ws_id, task_data, self.send_msg)

        return out

    def send_msg(self, event, data, ws_id=None):
        data |= {"timestamp": int(time.time() * 1000)}
        self.loop.call_soon_threadsafe(ws_msges.put_nowait, (event, data, ws_id))

ws_msges = asyncio.Queue()
ws_manager = WSConnectionManager()
task_queue = TaskQueue()

async def ws_loop():
    while True:
        msg = await ws_msges.get()
        log.debug(f'ws: {msg}')
        await ws_manager.send(*msg)

@server.websocket("/ws")
async def websocket_endpoint(ws: WebSocket, clientId: Optional[str] = None):    
    # init process
    if task_queue.loop is None:
        loop = asyncio.get_running_loop()
        task_queue.loop = loop
        TaskWorker(queue=task_queue, loop=loop).start()
        asyncio.create_task(ws_loop())

    sid = clientId or uuid.uuid4().hex
    await ws_manager.connect(ws, sid)
    try:
        d = {
            'exec_info': {
                'queue_remaining': 0,
            },
        }
        await ws_manager.send("status", {"status": d, 'sid': sid}, sid)

        # if prompt_server.client_id == sid and prompt_server.last_node_id is not None:
        #     await prompt_server.send_json("executing", {"node": prompt_server.last_node_id}, sid)

        while True:
            data = await ws.receive()
            if data["type"] == "websocket.disconnect":
                break
    except WebSocketDisconnect:
        pass
    finally:
        ws_manager.disconnect(sid)

@server.get("/extensions")
async def get_extensions():
    c = chain(
        web_root.glob('extensions/core/*.js'),
        web_root.glob('extensions/*/lib/*.js')
    )
    extensions = list(map(lambda x: f'/{web_dir}/{x.relative_to(web_root)}', c))
    return extensions


@server.get("/object_info")
async def get_object_info():
    with open(web_root / 'addition/my_nodes.json', 'r') as f:
        out = json.load(f)
    with open(web_root / 'addition/nodes.json', 'r') as f:
        out |= json.load(f)
    if server.api: out |= server.api.pipeline_manager.export_nodes()
    return out

@server.get("/prompt")
async def get_prompt():
    return task_queue.get_queue_info()

class PromptData(BaseModel):
    client_id: str | None = None
    prompt: dict
    extra_data: dict | None = None

@server.post("/prompt")
async def post_prompt(data: PromptData):
    if data.prompt:
        extra_data = data.extra_data or {}
        if data.client_id: extra_data["client_id"] = data.client_id

        prompt_id = str(uuid.uuid4())
        task_queue.put((0, prompt_id, data.prompt, extra_data))

        ret = {
            "prompt_id": prompt_id,
            "number": 0, 
            "node_errors": []
        }
        return ret
    else:
        raise HTTPException(status_code=400, detail={"error": "no prompt", "node_errors": []})

@server.get("/queue")
async def get_queue():
    running, pending = task_queue.get_current_queue()
    queue_info = {
        'queue_running': running,
        'queue_pending': pending,
    }
    return queue_info

@server.get("/view_model/{item}")
async def view_model(item: str, filename: Optional[str] = None):
    if not filename:
        raise HTTPException(status_code=404, detail="Item not found")

    if item == 'model':
        ...

    image_path = web_root / 'images/ChatGPT.png'
    return FileResponse(image_path)

@server.get("/view")
async def view_image(filename: Optional[str] = None, type: Optional[str] = None, subfolder: Optional[str] = None):
    if not filename:
        raise HTTPException(status_code=404, detail="Item not found")

    if filename not in ['doubao.png', 'ChatGPT.png', 'grok.png', 'wenxin.png']:
        image_path = web_root / 'images/ChatGPT.png'
    else:
        image_path = web_root / f'images/{filename}'
    return FileResponse(image_path)
