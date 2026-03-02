import os
import json
import time
import uuid
import shutil
import asyncio
import logging
import traceback
import threading
import glob
from pathlib import Path
from urllib import parse
from typing import Optional, TypedDict
from fastapi import APIRouter, Request, Response
from fastapi.responses import FileResponse
from fastapi import HTTPException, WebSocket, WebSocketDisconnect
from ..log import log
from .task import WSConnectionManager, TaskQueue, TaskWorker
from .constant import Events, Types, Message, WorkspacePromptData, InterruptData

class FileInfo(TypedDict):
    path: str
    name: str
    type: str
    size: int
    modified: int


def get_userdata_dir() -> str:
    """Get the userdata directory path, creating it if necessary."""
    userdata_dir = os.path.expanduser("~/.sigmaflow/userdata")
    os.makedirs(userdata_dir, exist_ok=True)
    return userdata_dir


def get_file_info(path: str, relative_to: str) -> dict:
    return {
        "path": os.path.relpath(path, relative_to).replace(os.sep, '/'),
        "name": os.path.basename(path),
        "size": os.path.getsize(path),
        "modified": os.path.getmtime(path),
    }


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
        pipe_name = extra_data["workflow_name"]
        pipeline = self.pipeline_manager.add_pipe(pipe_name, comfyui_data=task_data)
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
                self.queue.set_flag(task_id, {})
                raise Exception(f"Task {task_id} cancelled during execution.")

        pipeline.add_node_callback(start_cb=[start_msg_func], finish_cb=[finish_msg_func, cancel_func])

        inp_data = {}
        for _, d in task_data.items():
            match d["class_type"]:
                case "JSONData":
                    inp_data = json.loads(d["inputs"]["json"]) | {"#TRACE_ID": task_id}
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

        @router.get("/api/v2/userdata")
        async def list_userdata_v2(path: str = ""):
            """
            List files and directories in the userdata directory.

            Query Parameters:
            - path (optional): The relative path within the userdata directory to list. Defaults to root ('').

            Returns:
            - 400: If the requested path is invalid or outside the userdata directory.
            - 404: If the requested path does not exist.
            - 500: If there is an error reading the directory contents.
            - 200: JSON response containing a list of file and directory objects.
                   Each object includes:
                   - name: The name of the file or directory.
                   - type: 'file' or 'directory'.
                   - path: The relative path from the userdata root.
                   - size (for files): The size in bytes.
                   - modified (for files): The last modified timestamp (Unix epoch).
            """
            try:
                # URL-decode the path parameter
                if path:
                    try:
                        path = parse.unquote(path)
                    except Exception as e:
                        logging.warning(f"Failed to decode path parameter: {path}, Error: {e}")
                        raise HTTPException(status_code=400, detail="Invalid characters in path parameter")

                userdata_root = get_userdata_dir()
                
                # Build the target absolute path
                if path:
                    target_abs_path = os.path.abspath(os.path.join(userdata_root, path))
                else:
                    target_abs_path = userdata_root

                # Prevent path traversal attacks
                if os.path.commonpath((userdata_root, target_abs_path)) != userdata_root:
                    raise HTTPException(status_code=400, detail="Invalid path requested")

                # Handle cases where the path doesn't exist
                if not os.path.exists(target_abs_path):
                    # Check if it's the root directory that's missing
                    if target_abs_path == userdata_root:
                        return []
                    else:
                        raise HTTPException(status_code=404, detail="Requested path not found")

                if not os.path.isdir(target_abs_path):
                    raise HTTPException(status_code=400, detail="Requested path is not a directory")

                results = []
                try:
                    for item in os.listdir(target_abs_path):
                        item_path = os.path.join(target_abs_path, item)
                        rel_path = os.path.relpath(item_path, userdata_root).replace(os.sep, '/')
                        
                        if os.path.isdir(item_path):
                            results.append({
                                "name": item,
                                "path": rel_path,
                                "type": "directory"
                            })
                        else:
                            try:
                                stats = os.stat(item_path)
                                results.append({
                                    "name": item,
                                    "path": rel_path,
                                    "type": "file",
                                    "size": stats.st_size,
                                    "modified": stats.st_mtime
                                })
                            except OSError as e:
                                logging.warning(f"Could not stat file {item_path}: {e}")
                                results.append({
                                    "name": item,
                                    "path": rel_path,
                                    "type": "file"
                                })
                except OSError as e:
                    logging.error(f"Error listing directory {target_abs_path}: {e}")
                    raise HTTPException(status_code=500, detail="Error reading directory contents")

                # Sort results alphabetically, directories first then files
                results.sort(key=lambda x: (x['type'] != 'directory', x['name'].lower()))

                return results
            except HTTPException:
                raise
            except Exception as e:
                logging.error(f"Error in userdata endpoint: {e}")
                raise HTTPException(status_code=500, detail=traceback.format_exc())

        def validate_userdata_path(file_path: str) -> str:
            """Validate and return absolute path for userdata file operations."""
            if not file_path:
                raise HTTPException(status_code=400, detail="File path is required")
            
            # URL-decode the path
            try:
                file_path = parse.unquote(file_path)
            except Exception as e:
                logging.warning(f"Failed to decode file path: {file_path}, Error: {e}")
                raise HTTPException(status_code=400, detail="Invalid characters in file path")
            
            userdata_root = get_userdata_dir()
            abs_path = os.path.abspath(os.path.join(userdata_root, file_path))
            
            # Prevent path traversal attacks
            if os.path.commonpath((userdata_root, abs_path)) != userdata_root:
                raise HTTPException(status_code=403, detail="Invalid file path")
            
            return abs_path

        @router.get("/api/userdata")
        async def list_userdata(dir: str = "", recurse: str = "false", full_info: str = "false", split: str = "false"):
            """List files in the userdata directory.

            Query parameters mimic the UserManager implementation:
            - dir: relative directory to list (required)
            - recurse: "true" to recurse into subdirectories
            - full_info: "true" to return FileInfo dicts instead of strings
            - split: "true" to split returned paths into components (ignored if full_info)
            """
            try:
                if not dir:
                    raise HTTPException(status_code=400, detail="Directory not provided")

                abs_dir = validate_userdata_path(dir)
                if not os.path.exists(abs_dir):
                    raise HTTPException(status_code=404, detail="Directory not found")
                if not os.path.isdir(abs_dir):
                    raise HTTPException(status_code=400, detail="Path is not a directory")

                recurse_bool = recurse.lower() == "true"
                full_info_bool = full_info.lower() == "true"
                split_bool = split.lower() == "true"

                if recurse_bool:
                    pattern = os.path.join(glob.escape(abs_dir), "**", "*")
                else:
                    pattern = os.path.join(glob.escape(abs_dir), "*")

                def process_full_path(full_path: str):
                    if full_info_bool:
                        return get_file_info(full_path, abs_dir)
                    rel_path = os.path.relpath(full_path, abs_dir).replace(os.sep, '/')
                    if split_bool:
                        return [rel_path] + rel_path.split('/')
                    return rel_path

                results = [
                    process_full_path(full_path)
                    for full_path in glob.glob(pattern, recursive=recurse_bool)
                    if os.path.isfile(full_path)
                ]
                return results
            except HTTPException:
                raise
            except Exception as e:
                logging.error(f"Error listing userdata: {e}")
                raise HTTPException(status_code=500, detail=traceback.format_exc())

        @router.get("/api/userdata/{file_path:path}")
        async def get_userdata_file(file_path: str):
            """Download a single userdata file.

            When a request targets an index file that doesn't yet exist (e.g.
            `workflows/.index.json`) we return an empty JSON object with 200
            instead of generating a 404.  The frontend uses this pattern for
            bookmarks and expects a missing file to silently fall back to
            an empty set.
            """
            try:
                if file_path == "comfy.templates.json":
                    return FileResponse(Path(__file__).parent / "templates.json")

                abs_path = validate_userdata_path(file_path)

                if not os.path.exists(abs_path):
                    # special case for index files
                    if file_path.endswith(".index.json"):
                        return {}
                    raise HTTPException(status_code=404, detail="File not found")

                if not os.path.isfile(abs_path):
                    raise HTTPException(status_code=400, detail="Path is not a file")

                return FileResponse(abs_path)
            except HTTPException:
                raise
            except Exception as e:
                logging.error(f"Error downloading userdata file: {e}")
                raise HTTPException(status_code=500, detail=traceback.format_exc())

        @router.post("/api/userdata/{file_path:path}")
        async def post_userdata_file(file_path: str, request: Request, overwrite: str = "true", full_info: str = "false"):
            """
            Upload or update a userdata file.

            Query Parameters:
            - overwrite (optional): If "false", prevents overwriting existing files. Defaults to "true".
            - full_info (optional): If "true", returns detailed file information. If "false", returns relative path.
            """
            try:
                abs_path = validate_userdata_path(file_path)
                
                # Parse query parameters
                should_overwrite = overwrite.lower() != "false"
                return_full_info = full_info.lower() == "true"
                
                # Check if file already exists and overwrite is false
                if not should_overwrite and os.path.exists(abs_path):
                    raise HTTPException(status_code=409, detail="File already exists")
                
                # Create parent directories if they don't exist
                os.makedirs(os.path.dirname(abs_path), exist_ok=True)
                
                # Read and write file
                try:
                    body = await request.body()
                    with open(abs_path, "wb") as f:
                        f.write(body)
                except OSError as e:
                    logging.warning(f"Error saving file '{abs_path}': {e}")
                    raise HTTPException(
                        status_code=400,
                        detail="Invalid filename. Please avoid special characters like :\\/*?\"<>|"
                    )
                
                # Return response
                userdata_root = get_userdata_dir()
                if return_full_info:
                    return get_file_info(abs_path, userdata_root)
                else:
                    return {"path": os.path.relpath(abs_path, userdata_root).replace(os.sep, '/')}
            except HTTPException:
                raise
            except Exception as e:
                logging.error(f"Error uploading userdata file: {e}")
                raise HTTPException(status_code=500, detail=traceback.format_exc())

        @router.delete("/api/userdata/{file_path:path}")
        async def delete_userdata_file(file_path: str):
            """Delete a userdata file.

            Returns 204 No Content on success to match frontend expectations.
            """
            try:
                abs_path = validate_userdata_path(file_path)
                
                if not os.path.exists(abs_path):
                    raise HTTPException(status_code=404, detail="File not found")
                
                if not os.path.isfile(abs_path):
                    raise HTTPException(status_code=400, detail="Path is not a file")
                
                os.remove(abs_path)
                # respond with 204 and no body
                return Response(status_code=204)
            except HTTPException:
                raise
            except Exception as e:
                logging.error(f"Error deleting userdata file: {e}")
                raise HTTPException(status_code=500, detail=traceback.format_exc())

        @router.post("/api/userdata/{file_path:path}/move/{dest_path:path}")
        async def move_userdata_file(file_path: str, dest_path: str, request: Request, overwrite: str = "true", full_info: str = "false"):
            """
            Move or rename a userdata file.

            Query Parameters:
            - overwrite (optional): If "false", prevents overwriting destination. Defaults to "true".
            - full_info (optional): If "true", returns detailed file information. If "false", returns relative path.
            """
            try:
                source = validate_userdata_path(file_path)
                dest = validate_userdata_path(dest_path)
                
                if not os.path.exists(source):
                    raise HTTPException(status_code=404, detail="Source file not found")
                
                if not os.path.isfile(source):
                    raise HTTPException(status_code=400, detail="Source path is not a file")
                
                # Parse query parameters
                should_overwrite = overwrite.lower() != "false"
                return_full_info = full_info.lower() == "true"
                
                # Check if destination exists and overwrite is false
                if not should_overwrite and os.path.exists(dest):
                    raise HTTPException(status_code=409, detail="Destination file already exists")
                
                # Create destination parent directories if they don't exist
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                
                # Move the file
                logging.info(f"Moving '{source}' -> '{dest}'")
                shutil.move(source, dest)
                
                # Return response
                userdata_root = get_userdata_dir()
                if return_full_info:
                    return get_file_info(dest, userdata_root)
                else:
                    return {"path": os.path.relpath(dest, userdata_root).replace(os.sep, '/')}
            except HTTPException:
                raise
            except Exception as e:
                logging.error(f"Error moving userdata file: {e}")
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
