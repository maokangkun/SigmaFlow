"""SigmaFlow Science backend.

Implements the Science Agent protocol (see science/API.md) on the main
FastAPI server, with a single run manager serving two transports:

* WebSocket  -- preferred transport (`/api/ws`);
* HTTP + SSE -- the original protocol, kept for compatibility.

This is still a DEMO executor: it ticks synthetic progress for each step
and never executes commands, code or uploaded files. Swap
`ScienceRunManager` for a real execution backend to go live; the wire
contract stays unchanged.
"""

import asyncio
import json
import os
import time
import uuid

import requests
from pathlib import Path
from typing import Any, Dict, Optional, Set

from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

MAX_RUNS = 100
MAX_PROMPT_CHARS = 6000
MAX_STEPS = 10
MAX_MODELS = 50
RUN_TTL_MS = 3_600_000  # evict runs older than 1h once nobody is watching
TICK_SECONDS = 0.7


class StepSpec(BaseModel):
    title: str = ""
    description: str = ""
    tool: str = "demo"


class RunCreate(BaseModel):
    prompt: str
    workflowId: Optional[str] = None
    projectId: Optional[str] = None
    datasetIds: Optional[list] = None
    config: Optional[dict] = None
    steps: list[StepSpec] = Field(default_factory=list)


class RunControl(BaseModel):
    action: str


class ProviderIn(BaseModel):
    id: Optional[str] = None
    name: str = ""
    baseUrl: str = ""
    apiKey: Optional[str] = None


class ProviderRef(BaseModel):
    id: Optional[str] = None
    baseUrl: Optional[str] = None
    apiKey: Optional[str] = None


class ModelIn(BaseModel):
    id: Optional[str] = None
    providerId: str = ""
    model: str = ""
    isDefault: bool = False


class ProjectIn(BaseModel):
    id: Optional[str] = None
    name: str
    description: str = ""
    tags: Optional[list] = None
    icon: str = "folder"
    remote: Optional[str] = None


class ConversationIn(BaseModel):
    id: Optional[str] = None
    title: str = ""
    projectId: Optional[str] = None
    pinned: Optional[bool] = None
    archived: Optional[bool] = None
    content: Optional[list] = None


def _test_provider(base_url: str, api_key: str) -> dict:
    """Ping `{base_url}/models` on the provider and report real latency."""
    url = base_url.rstrip("/") + "/models"
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    start = time.time()
    try:
        resp = requests.get(url, headers=headers, timeout=10)
    except Exception as err:
        return {"ok": False, "latencyMs": round((time.time() - start) * 1000), "status": 0, "modelCount": None, "error": str(err)}
    latency = round((time.time() - start) * 1000)
    result = {"ok": resp.status_code == 200, "latencyMs": latency, "status": resp.status_code, "modelCount": None, "error": None}
    try:
        data = resp.json()
        if isinstance(data, dict) and isinstance(data.get("data"), list):
            result["modelCount"] = len(data["data"])
        elif isinstance(data, list):
            result["modelCount"] = len(data)
    except Exception:
        pass
    if resp.status_code != 200:
        detail = None
        try:
            body = resp.json()
            detail = body.get("error", {}).get("message") if isinstance(body.get("error"), dict) else body.get("error") or body.get("message")
        except Exception:
            pass
        result["error"] = f"HTTP {resp.status_code}" + (f"：{str(detail)[:200]}" if detail else "")
    return result


def _list_provider_models(base_url: str, api_key: str) -> dict:
    """Fetch the provider's model catalogue (`GET {baseUrl}/models`)."""
    url = base_url.rstrip("/") + "/models"
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    try:
        resp = requests.get(url, headers=headers, timeout=15)
    except Exception as err:
        return {"ok": False, "models": [], "error": str(err)}
    if resp.status_code != 200:
        return {"ok": False, "models": [], "error": f"HTTP {resp.status_code}"}
    names = []
    try:
        data = resp.json()
        entries = data.get("data") if isinstance(data, dict) else data
        if isinstance(entries, list):
            for item in entries:
                if isinstance(item, dict) and item.get("id"):
                    names.append(str(item["id"]))
                elif isinstance(item, str):
                    names.append(item)
    except Exception:
        pass
    return {"ok": True, "models": sorted(set(names)), "error": None}


class ScienceModelStore:
    """File-based model-config storage (`~/.sigmaflow/science/models.json`).

    The raw API key never leaves the server: list responses expose only a
    masked `keyHint`. An update with no `apiKey` keeps the stored key.
    """

    def __init__(self, storage_dir: Optional[str] = None):
        if storage_dir is None:
            storage_dir = os.environ.get("SIGMAFLOW_SCIENCE_DIR") or os.path.join(
                os.path.expanduser("~"), ".sigmaflow", "science"
            )
        self.storage_dir = Path(storage_dir)
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        self.path = self.storage_dir / "models.json"
        self.providers: Dict[str, dict] = {}
        self.models: Dict[str, dict] = {}
        self._load()

    def _load(self):
        data = {}
        if self.path.exists():
            try:
                data = json.loads(self.path.read_text(encoding="utf-8"))
            except Exception:
                data = {}
        if not isinstance(data, dict):
            data = {}
        # legacy flat records: {id: {name, baseUrl, apiKey, keyHint, isDefault}}
        if data and "providers" not in data:
            legacy, data = data, {"providers": {}, "models": {}}
            seen = {}
            for old in legacy.values():
                if not isinstance(old, dict) or not old.get("baseUrl"):
                    continue
                key = (old.get("baseUrl"), old.get("keyHint"))
                pid = seen.get(key)
                if pid is None:
                    pid = f"pv-{uuid.uuid4().hex[:12]}"
                    seen[key] = pid
                    data["providers"][pid] = {
                        "id": pid,
                        "name": old["baseUrl"].split("//", 1)[-1].split("/", 1)[0] or "provider",
                        "baseUrl": old["baseUrl"],
                        "apiKey": old.get("apiKey", ""),
                        "keyHint": old.get("keyHint"),
                        "createdAt": old.get("createdAt"),
                        "updatedAt": old.get("updatedAt"),
                    }
                mid = old.get("id") or f"md-{uuid.uuid4().hex[:12]}"
                data["models"][mid] = {
                    "id": mid,
                    "providerId": pid,
                    "model": _clip(old.get("name"), 200),
                    "isDefault": bool(old.get("isDefault")),
                    "createdAt": old.get("createdAt"),
                    "updatedAt": old.get("updatedAt"),
                }
        self.providers = data.get("providers") or {}
        self.models = data.get("models") or {}

    def _save(self):
        self.path.write_text(
            json.dumps({"providers": self.providers, "models": self.models}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    @staticmethod
    def _hint(key: Optional[str]) -> Optional[str]:
        if not key:
            return None
        return key if len(key) <= 8 else f"{key[:4]}****{key[-4:]}"

    # ------------------------------------------------------------ providers

    def _public_provider(self, provider: dict) -> dict:
        return {
            "id": provider["id"],
            "name": provider.get("name") or "",
            "baseUrl": provider.get("baseUrl") or "",
            "keyHint": provider.get("keyHint"),
            "createdAt": provider.get("createdAt"),
            "updatedAt": provider.get("updatedAt"),
        }

    def list_providers(self) -> list:
        return [self._public_provider(p) for p in self.providers.values()]

    def upsert_provider(self, payload: ProviderIn) -> dict:
        now = int(time.time() * 1000)
        provider = self.providers.get(payload.id or "")
        if provider is None:
            if payload.id:
                raise HTTPException(status_code=404, detail="Provider not found")
            if len(self.providers) >= MAX_MODELS:
                raise HTTPException(status_code=429, detail="Provider limit reached")
            provider = {"id": f"pv-{uuid.uuid4().hex[:12]}", "apiKey": "", "createdAt": now}
            self.providers[provider["id"]] = provider
        base_url = payload.baseUrl.strip()
        if not base_url:
            raise HTTPException(status_code=400, detail="Base URL is required")
        provider["name"] = _clip(payload.name or base_url.split("//", 1)[-1].split("/", 1)[0], 200)
        provider["baseUrl"] = _clip(base_url, 500)
        if payload.apiKey:  # absent/empty keeps the stored key
            provider["apiKey"] = _clip(payload.apiKey, 4096)
            provider["keyHint"] = self._hint(payload.apiKey)
        provider["updatedAt"] = now
        self._save()
        return self._public_provider(provider)

    def delete_provider(self, provider_id: str) -> bool:
        if provider_id not in self.providers:
            return False
        self.providers.pop(provider_id, None)
        lost_default = False
        for mid in [k for k, m in self.models.items() if m.get("providerId") == provider_id]:
            lost_default = lost_default or self.models[mid].get("isDefault")
            self.models.pop(mid, None)
        if lost_default:
            self._fix_default()
        self._save()
        return True

    # --------------------------------------------------------------- models

    def _public_model(self, model: dict) -> dict:
        provider = self.providers.get(model.get("providerId")) or {}
        return {
            "id": model["id"],
            "providerId": model.get("providerId"),
            "providerName": provider.get("name") or "",
            "baseUrl": provider.get("baseUrl") or "",
            "model": model.get("model") or "",
            "keyHint": provider.get("keyHint"),
            "isDefault": bool(model.get("isDefault")),
            "createdAt": model.get("createdAt"),
            "updatedAt": model.get("updatedAt"),
        }

    def list_models(self) -> list:
        return [self._public_model(m) for m in self.models.values()]

    def _fix_default(self):
        for model in self.models.values():
            if model.get("isDefault"):
                return
        for model in self.models.values():
            model["isDefault"] = True
            return

    def upsert_model(self, payload: ModelIn) -> dict:
        provider = self.providers.get(payload.providerId)
        if provider is None:
            raise HTTPException(status_code=404, detail="Provider not found")
        model_name = _clip(payload.model, 200).strip()
        if not model_name:
            raise HTTPException(status_code=400, detail="Model name is required")
        now = int(time.time() * 1000)
        model = self.models.get(payload.id or "")
        if model is None:
            if payload.id:
                raise HTTPException(status_code=404, detail="Model not found")
            if len(self.models) >= MAX_MODELS:
                raise HTTPException(status_code=429, detail="Model limit reached")
            model = {"id": f"md-{uuid.uuid4().hex[:12]}", "createdAt": now}
            self.models[model["id"]] = model
        model["providerId"] = payload.providerId
        model["model"] = model_name
        model["isDefault"] = bool(payload.isDefault) or not any(
            m.get("isDefault") for m in self.models.values() if m["id"] != model["id"]
        )
        if model["isDefault"]:
            for other in self.models.values():
                other["isDefault"] = other["id"] == model["id"]
        model["updatedAt"] = now
        self._save()
        return self._public_model(model)

    def delete_model(self, model_id: str) -> bool:
        model = self.models.pop(model_id, None)
        if model is None:
            return False
        if model.get("isDefault"):
            self._fix_default()
        self._save()
        return True

    def resolve_provider(self, payload: ProviderRef) -> tuple:
        stored = self.providers.get(payload.id or "") or {}
        base_url = (payload.baseUrl or stored.get("baseUrl") or "").strip()
        api_key = payload.apiKey or stored.get("apiKey") or ""
        return base_url, api_key


def _clip(value: Any, limit: int) -> str:
    return str(value if value is not None else "")[:limit]


class ScienceRunManager:
    """In-memory demo execution engine + event fan-out.

    All state lives in the event loop thread; callers mutate runs only
    through this class. Subscribers receive FULL state snapshots (never
    deltas), matching the wire contract the frontend validates.
    """

    TERMINAL = {"complete", "cancelled", "error"}
    CONTROL = {"pause": "paused", "resume": "running", "cancel": "cancelled"}

    def __init__(self):
        self.runs: Dict[str, dict] = {}
        self.subscribers: Dict[str, Set[asyncio.Queue]] = {}
        self._ticker: Optional[asyncio.Task] = None

    async def start(self):
        if self._ticker is None:
            self._ticker = asyncio.create_task(self._tick_loop())

    async def stop(self):
        if self._ticker is not None:
            self._ticker.cancel()
            self._ticker = None

    # ---------------------------------------------------------------- state

    def snapshot(self, run_id: str) -> dict:
        run = self.runs.get(run_id)
        if run is None:
            raise KeyError(run_id)
        return {
            "id": run["id"],
            "status": run["status"],
            "progress": run["progress"],
            "isDemo": True,
            "createdAt": run["createdAt"],
            "steps": [dict(step) for step in run["steps"]],
        }

    def create(self, payload: RunCreate) -> str:
        prompt = payload.prompt or ""
        if not prompt.strip() or len(prompt) > MAX_PROMPT_CHARS:
            raise HTTPException(status_code=400, detail="A non-empty prompt of at most 6000 characters is required")
        if not 1 <= len(payload.steps) <= MAX_STEPS:
            raise HTTPException(status_code=400, detail=f"1-{MAX_STEPS} steps are required")
        if len(self.runs) >= MAX_RUNS:
            raise HTTPException(status_code=429, detail="Run limit reached; restart to reset")

        run_id = str(uuid.uuid4())
        run = {
            "id": run_id,
            "status": "running",
            "progress": 0,
            "createdAt": int(time.time() * 1000),
            "prompt": prompt,
            "workflowId": payload.workflowId,
            "projectId": payload.projectId,
            "datasetIds": list(payload.datasetIds or []),
            "config": payload.config or {},
            "steps": [
                {
                    "index": i,
                    "title": _clip(step.title or f"Step {i + 1}", 200),
                    "description": _clip(step.description, 500),
                    "tool": _clip(step.tool, 100),
                    "progress": 0,
                    "status": "waiting",
                    "output": "",
                }
                for i, step in enumerate(payload.steps)
            ],
        }
        self.runs[run_id] = run
        return run_id

    def control(self, run_id: str, action: str) -> dict:
        if action not in self.CONTROL:
            raise HTTPException(status_code=400, detail="action must be pause, resume, or cancel")
        run = self.runs.get(run_id)
        if run is None:
            raise HTTPException(status_code=404, detail="Run not found. Demo state is lost when the server restarts.")
        if run["status"] in self.TERMINAL:
            raise HTTPException(status_code=409, detail="Run is already terminal")
        run["status"] = self.CONTROL[action]
        self.broadcast(run)
        return self.snapshot(run_id)

    # --------------------------------------------------------------- fan-out

    def subscribe(self, run_id: str, queue: asyncio.Queue):
        self.subscribers.setdefault(run_id, set()).add(queue)

    def unsubscribe(self, run_id: str, queue: asyncio.Queue):
        self.subscribers.get(run_id, set()).discard(queue)

    def broadcast(self, run: dict):
        snapshot = self.snapshot(run["id"])
        for queue in list(self.subscribers.get(run["id"], ())):
            queue.put_nowait(snapshot)

    # ---------------------------------------------------------------- ticker

    async def _tick_loop(self):
        while True:
            await asyncio.sleep(TICK_SECONDS)
            self._tick()

    def _tick(self):
        now = int(time.time() * 1000)
        for run_id, run in list(self.runs.items()):
            watched = bool(self.subscribers.get(run_id))
            if now - run["createdAt"] > RUN_TTL_MS and not watched:
                for queue in self.subscribers.pop(run_id, ()):
                    queue.put_nowait(None)
                self.runs.pop(run_id, None)
                continue
            if run["status"] != "running":
                continue
            step = next((s for s in run["steps"] if s["status"] != "complete"), None)
            if step is None:
                run["status"] = "complete"
                run["progress"] = 100
                self.broadcast(run)
                continue
            step["status"] = "running"
            step["progress"] = min(100, step["progress"] + 25)
            if step["progress"] == 100:
                step["status"] = "complete"
                step["output"] = f"模拟步骤「{step['title']}」已完成。未执行真实分析。"
            run["progress"] = round(sum(s["progress"] for s in run["steps"]) / len(run["steps"]))
            if all(s["status"] == "complete" for s in run["steps"]):
                run["status"] = "complete"
            self.broadcast(run)


class ScienceAPI:
    """HTTP/SSE + WebSocket routes for the Science workspace."""

    def __init__(self, pipeline_manager=None):
        self.manager = ScienceRunManager()
        self.model_store = ScienceModelStore()
        self.project_store = ScienceProjectStore()
        router = APIRouter(prefix="/api")

        # ------------------------------------------------------------- HTTP

        @router.get("/health")
        async def health():
            return {
                "status": "ok",
                "demo": True,
                "service": "SigmaFlow Science backend",
                "protocol": "1.1",
                "transports": {"http": True, "sse": True, "websocket": "/api/ws"},
            }

        @router.post("/runs")
        async def create_run(payload: RunCreate, request: Request):
            _check_origin(request)
            run_id = self.manager.create(payload)
            return {"id": run_id, "isDemo": True}

        @router.get("/runs")
        async def list_runs():
            return [
                {"id": run["id"], "status": run["status"], "progress": run["progress"], "createdAt": run["createdAt"]}
                for run in sorted(self.manager.runs.values(), key=lambda r: r["createdAt"])
            ]

        @router.get("/runs/{run_id}")
        async def get_run(run_id: str):
            try:
                return self.manager.snapshot(run_id)
            except KeyError:
                raise HTTPException(status_code=404, detail="Run not found. Demo state is lost when the server restarts.")

        @router.post("/runs/{run_id}/control")
        async def control_run(run_id: str, payload: RunControl, request: Request):
            _check_origin(request)
            return self.manager.control(run_id, payload.action)

        # ---------------------------------------------------- provider & model configs
        # Persisted server-side (JSON file). The API key never travels back
        # to the browser: responses carry only a masked `keyHint`. Providers
        # own the connection (baseUrl + apiKey); models reference a provider.

        @router.get("/providers")
        async def list_providers():
            return {"providers": self.model_store.list_providers()}

        @router.post("/providers")
        async def save_provider(payload: ProviderIn, request: Request):
            _check_origin(request)
            provider = self.model_store.upsert_provider(payload)
            return {"provider": provider, "providers": self.model_store.list_providers()}

        @router.delete("/providers/{provider_id}")
        async def delete_provider(provider_id: str, request: Request):
            _check_origin(request)
            if not self.model_store.delete_provider(provider_id):
                raise HTTPException(status_code=404, detail="Provider not found")
            return {"providers": self.model_store.list_providers(), "models": self.model_store.list_models()}

        @router.post("/providers/test")
        async def test_provider(payload: ProviderRef, request: Request):
            _check_origin(request)
            base_url, api_key = self.model_store.resolve_provider(payload)
            if not base_url:
                raise HTTPException(status_code=400, detail="模型接口地址为空")
            return await asyncio.to_thread(_test_provider, base_url, api_key)

        @router.post("/providers/list-models")
        async def provider_model_list(payload: ProviderRef, request: Request):
            _check_origin(request)
            base_url, api_key = self.model_store.resolve_provider(payload)
            if not base_url:
                raise HTTPException(status_code=400, detail="模型接口地址为空")
            return await asyncio.to_thread(_list_provider_models, base_url, api_key)

        @router.get("/models")
        async def list_models():
            return {"models": self.model_store.list_models()}

        @router.post("/models")
        async def save_model(payload: ModelIn, request: Request):
            _check_origin(request)
            model = self.model_store.upsert_model(payload)
            return {"model": model, "models": self.model_store.list_models()}

        @router.delete("/models/{model_id}")
        async def delete_model(model_id: str, request: Request):
            _check_origin(request)
            if not self.model_store.delete_model(model_id):
                raise HTTPException(status_code=404, detail="Model not found")
            return {"models": self.model_store.list_models()}

        # ------------------------------------------------ projects & conversations
        # Projects group conversations. Deleting a project unassigns (keeps)
        # its conversations.

        @router.get("/projects")
        async def list_projects():
            return {"projects": self.project_store.list_projects()}

        @router.post("/projects")
        async def save_project(payload: ProjectIn, request: Request):
            _check_origin(request)
            project = self.project_store.upsert_project(payload)
            return {"project": project, "projects": self.project_store.list_projects()}

        @router.delete("/projects/{project_id}")
        async def delete_project(project_id: str, request: Request):
            _check_origin(request)
            if not self.project_store.delete_project(project_id):
                raise HTTPException(status_code=404, detail="Project not found")
            return {"projects": self.project_store.list_projects(), "conversations": self.project_store.list_conversations()}

        @router.post("/chat")
        async def chat(payload: ChatIn, request: Request):
            _check_origin(request)
            base_url, api_key, model_name = _resolve_chat(self.model_store, payload.modelId)
            messages = [m for m in (payload.messages or []) if isinstance(m, dict)]
            try:
                content = await asyncio.to_thread(_run_agent_chat, base_url, api_key, model_name, messages)
            except RuntimeError as err:
                raise HTTPException(status_code=400, detail=str(err))
            return {"content": content}

        @router.get("/conversations")
        async def list_conversations():
            return {"conversations": self.project_store.list_conversations()}

        @router.post("/conversations")
        async def save_conversation(payload: ConversationIn, request: Request):
            _check_origin(request)
            conversation = self.project_store.upsert_conversation(payload)
            return {"conversation": conversation, "conversations": self.project_store.list_conversations()}

        @router.get("/conversations/{conversation_id}/content")
        async def get_conversation_content(conversation_id: str):
            conv = self.project_store.conversations.get(conversation_id)
            if conv is None:
                raise HTTPException(status_code=404, detail="Conversation not found")
            return {"id": conversation_id, "title": conv.get("title") or "", "projectId": conv.get("projectId"),
                    "content": conv.get("content") or []}

        @router.delete("/conversations/{conversation_id}")
        async def delete_conversation(conversation_id: str, request: Request):
            _check_origin(request)
            if not self.project_store.delete_conversation(conversation_id):
                raise HTTPException(status_code=404, detail="Conversation not found")
            return {"conversations": self.project_store.list_conversations()}

        # -------------------------------------------------------------- SSE

        @router.get("/runs/{run_id}/events")
        async def run_events(run_id: str):
            try:
                self.manager.snapshot(run_id)
            except KeyError:
                raise HTTPException(status_code=404, detail="Run not found. Demo state is lost when the server restarts.")

            async def event_stream():
                queue: asyncio.Queue = asyncio.Queue()
                self.manager.subscribe(run_id, queue)
                try:
                    first = self.manager.snapshot(run_id)
                    yield f"event: state\ndata: {json.dumps(first)}\n\n"
                    while True:
                        try:
                            item = await asyncio.wait_for(queue.get(), timeout=15)
                        except asyncio.TimeoutError:
                            yield ": keepalive\n\n"
                            continue
                        if item is None:
                            break
                        yield f"event: state\ndata: {json.dumps(item)}\n\n"
                        if item.get("status") in self.manager.TERMINAL:
                            break
                finally:
                    self.manager.unsubscribe(run_id, queue)

            return StreamingResponse(
                event_stream(),
                media_type="text/event-stream",
                headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
            )

        # ------------------------------------------------------ WebSocket
        #
        # Preferred transport. One JSON message per frame; every client
        # message is an `action`, optionally tagged with `requestId`; every
        # reply echoes the `requestId`. Pushed snapshots carry the exact
        # same payload as the SSE `state` event.
        #
        #   -> {"action":"ping"}
        #   -> {"action":"run.create","requestId":..,"prompt":..,"steps":[..]}
        #   -> {"action":"run.get","requestId":..,"id":..}
        #   -> {"action":"run.subscribe","requestId":..,"id":..}   # idempotent
        #   -> {"action":"run.unsubscribe","id":..}
        #   -> {"action":"run.control","requestId":..,"id":..,"control":"pause"|"resume"|"cancel"}
        #   -> {"action":"provider.list","requestId":..}
        #   -> {"action":"provider.save","requestId":..,"id":..?,"name":..,"baseUrl":..,"apiKey":..?}
        #   -> {"action":"provider.delete","requestId":..,"id":..}
        #   -> {"action":"provider.test","requestId":..,"id":..?,"baseUrl":..?,"apiKey":..?}
        #   -> {"action":"provider.models","requestId":..,"id":..?,"baseUrl":..?,"apiKey":..?}
        #   -> {"action":"model.list","requestId":..}
        #   -> {"action":"model.save","requestId":..,"id":..?,"providerId":..,"model":..,"isDefault":..}
        #   -> {"action":"model.delete","requestId":..,"id":..}
        #
        #   <- {"event":"pong"}
        #   <- {"event":"run.created","requestId":..,"data":{"id":..,"isDemo":true}}
        #   <- {"event":"run.snapshot","requestId":..,"data":{snapshot}}
        #   <- {"event":"run.subscribed","requestId":..,"data":{"id":..}}
        #   <- {"event":"run.control","requestId":..,"data":{snapshot}}
        #   <- {"event":"model.list","requestId":..,"data":{"models":[..]}}
        #   <- {"event":"model.saved","requestId":..,"data":{"model":{..},"models":[..]}}
        #   <- {"event":"model.deleted","requestId":..,"data":{"models":[..]}}
        #   <- {"event":"state","data":{snapshot}}                  # push
        #   <- {"event":"error","requestId":..?,"data":{"error":..}}

        @router.websocket("/ws")
        async def websocket_endpoint(ws: WebSocket):
            # 与 HTTP 写接口的同源策略保持一致: 拒绝跨源连接, 防止恶意页面
            # 借 WS 读取会话内容或消耗服务端保存的 API 密钥。
            origin = ws.headers.get("origin")
            host = ws.headers.get("host", "")
            if origin and origin not in (f"http://{host}", f"https://{host}"):
                await ws.close(code=1008)
                return
            await ws.accept()
            queue: asyncio.Queue = asyncio.Queue()
            subscribed: Set[str] = set()
            pump: Optional[asyncio.Task] = None

            async def reply(event: str, request_id, data=None):
                message: Dict[str, Any] = {"event": event, "data": data if data is not None else {}}
                if request_id:
                    message["requestId"] = request_id
                await ws.send_json(message)

            async def fail(request_id, detail: str):
                await reply("error", request_id, {"error": detail})

            def run_id_of(data: dict) -> str:
                return _clip(data.get("id"), 64).strip()

            async def handle(message: dict):
                action = message.get("action")
                request_id = message.get("requestId")
                data = message.get("data") if isinstance(message.get("data"), dict) else message
                if action == "ping":
                    await reply("pong", request_id)
                elif action == "run.create":
                    try:
                        payload = RunCreate(
                            prompt=data.get("prompt", ""),
                            workflowId=data.get("workflowId"),
                            projectId=data.get("projectId"),
                            datasetIds=data.get("datasetIds"),
                            config=data.get("config"),
                            steps=[StepSpec(**s) for s in (data.get("steps") or []) if isinstance(s, dict)],
                        )
                    except Exception:
                        await fail(request_id, "Invalid run payload")
                        return
                    try:
                        run_id = self.manager.create(payload)
                    except HTTPException as err:
                        await fail(request_id, err.detail)
                        return
                    # Creating a run implies subscribing this connection.
                    self.manager.subscribe(run_id, queue)
                    subscribed.add(run_id)
                    await reply("run.created", request_id, {"id": run_id, "isDemo": True})
                elif action == "run.get":
                    run_id = run_id_of(data)
                    if run_id not in self.manager.runs:
                        await fail(request_id, "Run not found")
                        return
                    await reply("run.snapshot", request_id, self.manager.snapshot(run_id))
                elif action == "run.subscribe":
                    run_id = run_id_of(data)
                    if run_id not in self.manager.runs:
                        await fail(request_id, "Run not found")
                        return
                    self.manager.subscribe(run_id, queue)
                    subscribed.add(run_id)
                    await reply("run.subscribed", request_id, {"id": run_id})
                elif action == "run.unsubscribe":
                    run_id = run_id_of(data)
                    self.manager.unsubscribe(run_id, queue)
                    subscribed.discard(run_id)
                    await reply("run.unsubscribed", request_id, {"id": run_id})
                elif action == "run.control":
                    run_id = run_id_of(data)
                    try:
                        snapshot = self.manager.control(run_id, _clip(data.get("control"), 16))
                    except HTTPException as err:
                        await fail(request_id, err.detail)
                        return
                    await reply("run.control", request_id, snapshot)
                elif action == "provider.list":
                    await reply("provider.list", request_id, {"providers": self.model_store.list_providers()})
                elif action == "provider.save":
                    try:
                        payload = ProviderIn(
                            id=data.get("id") or None,
                            name=data.get("name", ""),
                            baseUrl=data.get("baseUrl", ""),
                            apiKey=data.get("apiKey"),
                        )
                    except Exception:
                        await fail(request_id, "Invalid provider payload")
                        return
                    try:
                        provider = self.model_store.upsert_provider(payload)
                    except HTTPException as err:
                        await fail(request_id, err.detail)
                        return
                    await reply("provider.saved", request_id, {"provider": provider, "providers": self.model_store.list_providers()})
                elif action == "provider.delete":
                    if not self.model_store.delete_provider(run_id_of(data)):
                        await fail(request_id, "Provider not found")
                        return
                    await reply("provider.deleted", request_id, {"providers": self.model_store.list_providers(), "models": self.model_store.list_models()})
                elif action == "provider.test":
                    try:
                        ref = ProviderRef(id=data.get("id") or None, baseUrl=data.get("baseUrl"), apiKey=data.get("apiKey"))
                    except Exception:
                        await fail(request_id, "Invalid provider payload")
                        return
                    base_url, api_key = self.model_store.resolve_provider(ref)
                    if not base_url:
                        await fail(request_id, "模型接口地址为空")
                        return
                    result = await asyncio.to_thread(_test_provider, base_url, api_key)
                    await reply("provider.test", request_id, result)
                elif action == "provider.models":
                    try:
                        ref = ProviderRef(id=data.get("id") or None, baseUrl=data.get("baseUrl"), apiKey=data.get("apiKey"))
                    except Exception:
                        await fail(request_id, "Invalid provider payload")
                        return
                    base_url, api_key = self.model_store.resolve_provider(ref)
                    if not base_url:
                        await fail(request_id, "模型接口地址为空")
                        return
                    result = await asyncio.to_thread(_list_provider_models, base_url, api_key)
                    await reply("provider.models", request_id, result)
                elif action == "model.list":
                    await reply("model.list", request_id, {"models": self.model_store.list_models()})
                elif action == "model.save":
                    try:
                        payload = ModelIn(
                            id=data.get("id") or None,
                            providerId=data.get("providerId", ""),
                            model=data.get("model", ""),
                            isDefault=bool(data.get("isDefault")),
                        )
                    except Exception:
                        await fail(request_id, "Invalid model payload")
                        return
                    try:
                        model = self.model_store.upsert_model(payload)
                    except HTTPException as err:
                        await fail(request_id, err.detail)
                        return
                    await reply("model.saved", request_id, {"model": model, "models": self.model_store.list_models()})
                elif action == "model.delete":
                    if not self.model_store.delete_model(run_id_of(data)):
                        await fail(request_id, "Model not found")
                        return
                    await reply("model.deleted", request_id, {"models": self.model_store.list_models()})
                elif action == "project.list":
                    await reply("project.list", request_id, {"projects": self.project_store.list_projects()})
                elif action == "project.save":
                    try:
                        payload = ProjectIn(
                            id=data.get("id") or None,
                            name=data.get("name", ""),
                            description=data.get("description", ""),
                            tags=data.get("tags") or None,
                            icon=data.get("icon", "folder"),
                            remote=data.get("remote"),
                        )
                    except Exception:
                        await fail(request_id, "Invalid project payload")
                        return
                    try:
                        project = self.project_store.upsert_project(payload)
                    except HTTPException as err:
                        await fail(request_id, err.detail)
                        return
                    await reply("project.saved", request_id, {"project": project, "projects": self.project_store.list_projects()})
                elif action == "project.delete":
                    if not self.project_store.delete_project(run_id_of(data)):
                        await fail(request_id, "Project not found")
                        return
                    await reply("project.deleted", request_id, {"projects": self.project_store.list_projects(), "conversations": self.project_store.list_conversations()})
                elif action == "conversation.list":
                    await reply("conversation.list", request_id, {"conversations": self.project_store.list_conversations()})
                elif action == "conversation.save":
                    try:
                        payload = ConversationIn(
                            id=data.get("id") or None,
                            title=data.get("title", ""),
                            projectId=data.get("projectId"),
                            pinned=data.get("pinned"),
                            archived=data.get("archived"),
                            content=data.get("content"),
                        )
                    except Exception:
                        await fail(request_id, "Invalid conversation payload")
                        return
                    try:
                        conversation = self.project_store.upsert_conversation(payload)
                    except HTTPException as err:
                        await fail(request_id, err.detail)
                        return
                    await reply("conversation.saved", request_id, {"conversation": conversation, "conversations": self.project_store.list_conversations()})
                elif action == "conversation.content":
                    conv = self.project_store.conversations.get(run_id_of(data))
                    if conv is None:
                        await fail(request_id, "Conversation not found")
                        return
                    await reply("conversation.content", request_id, {"id": conv["id"], "content": conv.get("content") or []})
                elif action == "conversation.delete":
                    if not self.project_store.delete_conversation(run_id_of(data)):
                        await fail(request_id, "Conversation not found")
                        return
                    await reply("conversation.deleted", request_id, {"conversations": self.project_store.list_conversations()})
                elif action == "chat.send":
                    try:
                        base_url, api_key, model_name = _resolve_chat(self.model_store, data.get("modelId"))
                    except HTTPException as err:
                        await fail(request_id, err.detail)
                        return
                    messages = [m for m in (data.get("messages") or []) if isinstance(m, dict)]
                    if not messages:
                        await fail(request_id, "消息列表为空")
                        return
                    loop = asyncio.get_running_loop()
                    chat_queue: asyncio.Queue = asyncio.Queue()
                    def work():
                        try:
                            _stream_agent_chat(base_url, api_key, model_name, messages,
                                lambda d: loop.call_soon_threadsafe(chat_queue.put_nowait, ("delta", d)),
                                lambda t: loop.call_soon_threadsafe(chat_queue.put_nowait, ("think", t)))
                            loop.call_soon_threadsafe(chat_queue.put_nowait, ("done", None))
                        except Exception as err:
                            loop.call_soon_threadsafe(chat_queue.put_nowait, ("error", str(err)))
                    worker = asyncio.create_task(asyncio.to_thread(work))
                    content = []
                    while True:
                        kind, value = await chat_queue.get()
                        if kind == "delta":
                            content.append(value)
                            await ws.send_json({"event": "chat.delta", "requestId": request_id, "data": {"delta": value}})
                        elif kind == "think":
                            await ws.send_json({"event": "chat.think", "requestId": request_id, "data": {"delta": value}})
                        elif kind == "done":
                            await ws.send_json({"event": "chat.done", "requestId": request_id, "data": {"content": "".join(content)}})
                            break
                        else:
                            await fail(request_id, value)
                            break
                    await worker
                else:
                    await fail(request_id, f"Unknown action: {action}")

            try:
                while True:
                    raw = await ws.receive_text()
                    try:
                        message = json.loads(raw)
                        if not isinstance(message, dict):
                            raise ValueError("not an object")
                    except Exception:
                        await ws.send_json({"event": "error", "data": {"error": "Invalid JSON format"}})
                        continue
                    if pump is None:
                        pump = asyncio.create_task(_push_loop(ws, queue))
                    await handle(message)
            except WebSocketDisconnect:
                pass
            finally:
                if pump:
                    pump.cancel()
                for run_id in subscribed:
                    self.manager.unsubscribe(run_id, queue)

        @router.on_event("startup")
        async def startup_event():
            await self.manager.start()

        @router.on_event("shutdown")
        async def shutdown_event():
            await self.manager.stop()

        self.router = router


def _push_loop(ws: WebSocket, queue: asyncio.Queue):
    """Fan manager snapshots queued for this connection out onto the socket."""

    async def _loop():
        try:
            while True:
                item = await queue.get()
                if item is None:
                    break
                await ws.send_json({"event": "state", "data": item})
        except asyncio.CancelledError:
            pass

    return _loop()


class ChatIn(BaseModel):
    modelId: Optional[str] = None
    messages: list = []


class ScienceProjectStore:
    """Projects + conversations storage (`~/.sigmaflow/science/projects.json`).

    Projects group conversations; a conversation whose projectId is None shows
    up in the "unassigned" section of the sidebar. Deleting a project keeps its
    conversations, unassigned.
    """

    def __init__(self, storage_dir: Optional[str] = None):
        if storage_dir is None:
            storage_dir = os.environ.get("SIGMAFLOW_SCIENCE_DIR") or os.path.join(
                os.path.expanduser("~"), ".sigmaflow", "science"
            )
        self.storage_dir = Path(storage_dir)
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        self.path = self.storage_dir / "projects.json"
        self.projects: Dict[str, dict] = {}
        self.conversations: Dict[str, dict] = {}
        self._load()

    def _load(self):
        data = {}
        if self.path.exists():
            try:
                data = json.loads(self.path.read_text(encoding="utf-8"))
            except Exception:
                data = {}
        if not isinstance(data, dict):
            data = {}
        self.projects = data.get("projects") or {}
        self.conversations = data.get("conversations") or {}

    def _save(self):
        self.path.write_text(
            json.dumps({"projects": self.projects, "conversations": self.conversations}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    @staticmethod
    def _valid_id(value: str) -> bool:
        return 0 < len(value) <= 64 and all(c.isalnum() or c in "-_" for c in value)

    def _public_project(self, project: dict) -> dict:
        return {
            "id": project["id"],
            "name": project.get("name") or "",
            "description": project.get("description") or "",
            "tags": project.get("tags") or [],
            "icon": project.get("icon") or "folder",
            "remote": project.get("remote"),
            "createdAt": project.get("createdAt"),
            "updatedAt": project.get("updatedAt"),
        }

    def list_projects(self) -> list:
        return [self._public_project(p) for p in self.projects.values()]

    def upsert_project(self, payload: ProjectIn) -> dict:
        now = int(time.time() * 1000)
        name = _clip(payload.name, 200).strip()
        if not name:
            raise HTTPException(status_code=400, detail="Project name is required")
        project = self.projects.get(payload.id or "")
        if project is None:
            if payload.id:
                if not self._valid_id(payload.id):
                    raise HTTPException(status_code=400, detail="Invalid project id")
            else:
                payload.id = f"pr-{uuid.uuid4().hex[:12]}"
            project = {"id": payload.id, "createdAt": now}
            self.projects[project["id"]] = project
        project["name"] = name
        project["description"] = _clip(payload.description, 1000)
        project["tags"] = [_clip(t, 50) for t in (payload.tags or [])][:5]
        project["icon"] = _clip(payload.icon or "folder", 50)
        project["remote"] = _clip(payload.remote, 500) if payload.remote else None
        project["updatedAt"] = now
        self._save()
        return self._public_project(project)

    def delete_project(self, project_id: str) -> bool:
        if project_id not in self.projects:
            return False
        self.projects.pop(project_id, None)
        for conv in self.conversations.values():
            if conv.get("projectId") == project_id:
                conv["projectId"] = None
        self._save()
        return True

    def _public_conversation(self, conv: dict) -> dict:
        return {
            "id": conv["id"],
            "title": conv.get("title") or "",
            "projectId": conv.get("projectId"),
            "pinned": bool(conv.get("pinned")),
            "archived": bool(conv.get("archived")),
            "hasContent": bool(conv.get("content")),
            "createdAt": conv.get("createdAt"),
            "updatedAt": conv.get("updatedAt"),
        }

    def list_conversations(self) -> list:
        convs = [self._public_conversation(c) for c in self.conversations.values()]
        convs.sort(key=lambda c: (not c["pinned"], -(c["updatedAt"] or 0)))
        return convs

    def upsert_conversation(self, payload: ConversationIn) -> dict:
        now = int(time.time() * 1000)
        if payload.id and payload.id not in self.conversations and not self._valid_id(payload.id):
            raise HTTPException(status_code=400, detail="Invalid conversation id")
        conv = self.conversations.get(payload.id or "")
        if conv is None:
            conv = {"id": payload.id or f"cn-{uuid.uuid4().hex[:12]}", "createdAt": now}
            self.conversations[conv["id"]] = conv
        conv["title"] = _clip(payload.title, 300) or "新会话"
        conv["projectId"] = payload.projectId if (payload.projectId and payload.projectId in self.projects) else None
        if payload.pinned is not None:
            conv["pinned"] = bool(payload.pinned)
        elif "pinned" not in conv:
            conv["pinned"] = False
        if payload.archived is not None:
            conv["archived"] = bool(payload.archived)
        elif "archived" not in conv:
            conv["archived"] = False
        if payload.content:  # 空列表/None 都视为"不更新内容", 防止空的注册请求清掉已同步的对话
            keep = []
            for msg in payload.content[-100:]:
                if not isinstance(msg, dict):
                    continue
                keep.append({"role": _clip(str(msg.get("role", "")), 16), "content": _clip(str(msg.get("content", "")), 20000)})
            conv["content"] = keep
        conv["updatedAt"] = now
        self._save()
        return self._public_conversation(conv)

    def delete_conversation(self, conversation_id: str) -> bool:
        if conversation_id not in self.conversations:
            return False
        self.conversations.pop(conversation_id, None)
        self._save()
        return True


def _resolve_chat(model_store, model_id: Optional[str]):
    """modelId -> (baseUrl, apiKey, model_name). Raises HTTPException."""
    models = list(model_store.models.values())
    model = model_store.models.get(model_id or "")
    if model is None:
        model = next((m for m in models if m.get("isDefault")), None) or (models[0] if models else None)
    if model is None:
        raise HTTPException(status_code=400, detail="尚未配置模型，请先在设置中添加模型")
    provider = model_store.providers.get(model.get("providerId")) or {}
    base_url = (provider.get("baseUrl") or "").strip()
    if not base_url:
        raise HTTPException(status_code=400, detail="该模型的服务商缺少接口地址")
    model_name = (model.get("model") or "").strip()
    if not model_name:
        raise HTTPException(status_code=400, detail="模型名称为空")
    return base_url, provider.get("apiKey") or "", model_name


def _make_chat_delta_callback(on_delta, on_reasoning):
    """统一 Agent 流式回调: cb(text)→正文; cb(None, think)→思考."""
    if on_delta is None and on_reasoning is None:
        return None
    def _cb(piece, think=None):
        if think is not None:
            if on_reasoning:
                on_reasoning(think)
        elif piece is not None:
            if on_delta:
                on_delta(piece)
    return _cb


def _run_agent_chat(base_url: str, api_key: str, model_name: str, messages: list, on_delta=None, on_reasoning=None) -> str:
    """Run a chat through the SigmaFlow agent/agent.Agent stack.

    Builds an Agent (openai-compatible method) against the configured
    provider, prepends the agent system prompt, and returns the final
    assistant text. Tool support is off for the web chat path.
    """
    try:
        from sigmaflow.agent.agent import Agent
    except ModuleNotFoundError:
        # 未 pip install 时回退到源码目录: 本文件位于 src/sigmaflow/server/, 上溯 4 级即 src 根
        import sys as _sys
        _src_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
        if _src_root not in _sys.path:
            _sys.path.insert(0, _src_root)
        from sigmaflow.agent.agent import Agent

    convo = [{"role": m.get("role"), "content": m.get("content", "")} for m in messages if m.get("role") in ("user", "assistant")]
    # cur_turn counts prior assistant messages, so give the loop enough headroom
    max_turn = max(1, sum(1 for m in convo if m["role"] == "assistant") + 1)
    agent = Agent(
        method="openai",
        model=model_name,
        base_url=base_url,
        api_key=api_key or "sk-empty",
        support_tool=False,
        retry=2,               # 快速失败, 不要把错误拖成分钟级等待
        max_turn=max_turn,
        on_delta=_make_chat_delta_callback(on_delta, on_reasoning),  # 流式回调(文本/思考)
    )
    agent.client.timeout = 90   # 单次请求 90s 超时(openai 默认 600s, 会让前端像"永不结束")
    agent.client.max_retries = 1
    info = agent(convo, is_print=False, max_turn=max_turn)
    last = info["last_response"] if isinstance(info, dict) else None

    if not last:
        raise RuntimeError("模型没有返回内容")
    if isinstance(last, str):
        return last
    # openai-style response object
    choice = getattr(last, "choices", None)
    if choice:
        return choice[0].message.content or ""
    content = getattr(last, "content", None)
    if isinstance(content, list):
        return "".join(getattr(b, "text", "") for b in content)
    return str(content or "")


def _stream_agent_chat(base_url: str, api_key: str, model_name: str, messages: list, on_delta, on_reasoning=None):
    """Streaming chat. Runs synchronously on the caller's worker thread
    (the WS handler invokes it via asyncio.to_thread); on_delta is called
    on this same thread and forwarded into the asyncio queue by the
    caller with loop.call_soon_threadsafe."""
    return _run_agent_chat(base_url, api_key, model_name, messages, on_delta=on_delta, on_reasoning=on_reasoning)


def _check_origin(request: Request):
    """Same-origin write policy, mirroring the demo server contract."""
    origin = request.headers.get("origin")
    host = request.headers.get("host", "")
    if origin and origin not in (f"http://{host}", f"https://{host}"):
        raise HTTPException(status_code=403, detail="Cross-origin writes are disabled in the demo server")
