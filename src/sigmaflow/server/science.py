import asyncio
import atexit
import hmac
import json
import math
import os
import re
import secrets
import logging
import threading
import time
import urllib.parse
import urllib.request
import uuid

import requests
from pathlib import Path
from typing import Any, Dict, Optional, Set

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Request,
    Response,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from .science_common import (
    _CURRENT_USER,
    _SESSION_COOKIE,
    _SESSION_TTL,
    _clip,
    _current_user,
    _multi_user,
    _os_user,
)

from .science_auth import (
    _USER_REGISTRY_LOCK,
    _cookie_user,
    _hash_password,
    _load_users,
    _load_wechat_config,
    _save_users,
    _session_token,
    _user_data_dir,
    _wechat_account_name,
    _wechat_appid,
    _wechat_consume_state,
    _wechat_enabled,
    _wechat_fetch_json,
    _wechat_qrconnect_url,
)

from .science_admin import (
    _ScienceSkillView,
    _TOOL_ALIASES,
    _agent_agent_module,
    _agent_tools_module,
    _apply_compaction_to,
    _apply_token_updates,
    _build_mcp_servers,
    _build_skill_overrides,
    _build_tool_overrides,
    _builtin_mcp_servers,
    _compaction_config_path,
    _compaction_defaults,
    _default_system_prompts,
    _discover_skills,
    _effective_agent_tools,
    _effective_compaction,
    _effective_system_prompts,
    _load_compaction_config,
    _load_skill_overrides,
    _load_system_prompt_config,
    _load_tool_overrides,
    _mcp_listing,
    _rebuild_agent_mcp,
    _save_compaction_config,
    _save_mcp_servers,
    _save_skill_overrides,
    _save_system_prompt_config,
    _save_tool_overrides,
    _seed_builtin_skills,
    _seed_mcp_config,
    _skill_listing,
    _token_listing,
    _tool_defaults,
    _tool_listing,
)

from .science_fs import (
    _PTY_SESSIONS_MAX,
    _PtySession,
    _fs_exec_payload,
    _fs_file_payload,
    _fs_tree_payload,
    _fs_upload_payload,
    _pty_key_of,
)


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
    contextWindow: Optional[int] = None


class ProjectIn(BaseModel):
    id: Optional[str] = None
    name: str
    description: str = ""
    tags: Optional[list] = None
    icon: str = "folder"
    remote: Optional[str] = None
    dir: Optional[str] = None


class TitleIn(BaseModel):
    modelId: Optional[str] = None
    prompt: str = ""
    reply: str = ""


class FeedbackIn(BaseModel):
    conversationId: str = ""
    messageId: str = ""
    rating: str = ""
    category: str = ""
    note: str = ""
    snippet: str = ""


class ConversationIn(BaseModel):
    id: Optional[str] = None
    title: str = ""
    projectId: Optional[str] = None
    pinned: Optional[bool] = None
    archived: Optional[bool] = None
    content: Optional[list] = None


class ToolsUpdateIn(BaseModel):
    tools: Optional[list] = None
    reset: Optional[bool] = None


class SkillsUpdateIn(BaseModel):
    skills: Optional[list] = None
    reset: Optional[bool] = None


class MCPIn(BaseModel):
    servers: Optional[list] = None
    reset: Optional[bool] = None


class SystemPromptIn(BaseModel):
    prompt: Optional[str] = None
    enabled: Optional[bool] = None


class CompactionIn(BaseModel):
    # 上下文压缩参数: None 表示不修改对应字段
    enabled: Optional[bool] = None
    ratio: Optional[float] = None
    keepRecentTokens: Optional[int] = None
    minDrops: Optional[int] = None
    summaryTokens: Optional[int] = None
    resultChars: Optional[int] = None
    argChars: Optional[int] = None
    reset: Optional[bool] = None


class TokensUpdateIn(BaseModel):
    tokens: Dict[str, Optional[str]] = Field(default_factory=dict)


def _test_provider(base_url: str, api_key: str) -> dict:
    """Ping `{base_url}/models` on the provider and report real latency."""
    url = base_url.rstrip("/") + "/models"
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    start = time.time()
    try:
        resp = requests.get(url, headers=headers, timeout=10)
    except Exception as err:
        return {
            "ok": False,
            "latencyMs": round((time.time() - start) * 1000),
            "status": 0,
            "modelCount": None,
            "error": str(err),
        }
    latency = round((time.time() - start) * 1000)
    result = {
        "ok": resp.status_code == 200,
        "latencyMs": latency,
        "status": resp.status_code,
        "modelCount": None,
        "error": None,
    }
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
            detail = (
                body.get("error", {}).get("message")
                if isinstance(body.get("error"), dict)
                else body.get("error") or body.get("message")
            )
        except Exception:
            pass
        result["error"] = f"HTTP {resp.status_code}" + (
            f"：{str(detail)[:200]}" if detail else ""
        )
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


# ==================== LiteLLM 模型价格与上下文数据库 ====================
# 只读取 litellm 包内置的 model_prices 数据文件(500+ 模型的价格与上下文窗口),
# 不 import litellm 模块本身, 避免其启动开销; 数据缺失时所有查询静默降级。

_LITELLM_LOCK = threading.Lock()
_LITELLM_DB: Optional[Dict[str, dict]] = None
_LITELLM_MODULE: Any = None  # 懒加载的 litellm 模块; 未加载为 None, 导入失败为 False
_LITELLM_LOOKUP_CACHE: Dict[str, Optional[dict]] = {}


def _litellm_module():
    """Import litellm on demand (its import takes ~2s, so it runs in a
    background thread at startup and callers may get None before it's ready)."""
    global _LITELLM_MODULE
    if _LITELLM_MODULE is not None:
        return _LITELLM_MODULE
    with _LITELLM_LOCK:
        if _LITELLM_MODULE is not None:
            return _LITELLM_MODULE
        try:
            os.environ.setdefault(
                "LITELLM_LOCAL_MODEL_COST_MAP", "True"
            )  # 无外网时禁止远程拉取价格表
            import logging

            logging.getLogger("LiteLLM").setLevel(logging.ERROR)
            import litellm

            _LITELLM_MODULE = litellm
        except Exception:
            _LITELLM_MODULE = False
    return _LITELLM_MODULE


def _litellm_warm():
    """Synchronously warm up the litellm import.

    Must NOT be a background thread: while litellm is half-imported any log
    record routed through its logging filter re-enters its module space and
    crashes the process (KeyError litellm). Doing it during app startup keeps
    the fully-initialized guarantee before the first request is served."""
    _litellm_module()


# 匹配到多个 <provider>/<model> 候选时, 优先模型厂商官方与主流平台的定价,
# 避免选中 azure/bedrock/databricks 等托管变体的高价条目
_LITELLM_PRIMARY_PROVIDERS = {
    "openai",
    "anthropic",
    "gemini",
    "deepseek",
    "zai",
    "zhipuai",
    "moonshot",
    "moonshotai",
    "xai",
    "mistral",
    "dashscope",
    "qwen",
    "cohere",
    "groq",
    "perplexity",
    "together_ai",
    "fireworks_ai",
    "volcengine",
    "nvidia_nim",
    "sambanova",
    "cerebras",
    "custom_openai",
}


def _litellm_db() -> Dict[str, dict]:
    """Load LiteLLM's bundled model database once from its package files."""
    global _LITELLM_DB
    if _LITELLM_DB is not None:
        return _LITELLM_DB
    with _LITELLM_LOCK:
        if _LITELLM_DB is not None:
            return _LITELLM_DB
        dicc: Dict[str, dict] = {}
        module = _litellm_module()
        if module and module is not False:
            # 首选官方 API 暴露的 model_cost 数据
            mc = getattr(module, "model_cost", None)
            if isinstance(mc, dict):
                dicc = mc
        if not dicc:
            # litellm 未就绪或导入失败: 直接读包内价格表文件兜底
            try:
                import importlib.util

                spec = importlib.util.find_spec("litellm")
                if spec and spec.submodule_search_locations:
                    base = Path(list(spec.submodule_search_locations)[0])
                    for name in (
                        "model_prices_and_context_window.json",
                        "model_prices_and_context_window_backup.json",
                    ):
                        path = base / name
                        if path.exists():
                            loaded = json.loads(path.read_text(encoding="utf-8"))
                            if isinstance(loaded, dict):
                                dicc = loaded
                            break
            except Exception:
                dicc = {}
        db = dicc
        # 只保留带有效价格或窗口数据的条目, 滤掉 map_config_to_model 等元数据键
        _LITELLM_DB = {
            k: v
            for k, v in db.items()
            if isinstance(v, dict)
            and (
                isinstance(v.get("input_cost_per_token"), (int, float))
                or isinstance(v.get("output_cost_per_token"), (int, float))
                or v.get("max_input_tokens")
                or v.get("max_tokens")
            )
        }
    return _LITELLM_DB


def _litellm_lookup(model_name):
    """Resolve a configured model name against LiteLLM's database.

    Exact (case-insensitive) keys win; then `<provider>/<name>` suffix keys,
    preferring canonical provider entries over cloud-hosted variants."""
    if not model_name:
        return None
    key = str(model_name).strip().lower()
    cache = _LITELLM_LOOKUP_CACHE
    if key in cache:
        return cache[key]
    db = _litellm_db()
    hit: Optional[dict] = None
    exact = db.get(key)
    if exact is not None:
        hit = dict(exact)
        hit["_litellm_key"] = key  # 官方 API(completion_cost 等)需要的精确目录键
    else:
        suffix = "/" + key
        hits: list = [(k, v) for k, v in db.items() if k.lower().endswith(suffix)]

        def _rank(item):
            k, v = item
            provider = str(v.get("litellm_provider") or "").lower()
            if "/" not in k:
                tier = 0
            elif provider in _LITELLM_PRIMARY_PROVIDERS:
                tier = 1
            else:
                tier = 2
            return (tier, len(k))

        if hits:
            matched_key, entry = sorted(hits, key=_rank)[0]
            hit = dict(entry)
            hit["_litellm_key"] = matched_key
    cache[key] = hit
    return hit


def _model_pricing(entry) -> tuple:
    """(input, output) USD per token for a LiteLLM model-info entry."""
    if not entry:
        return 0.0, 0.0
    edge = entry.get("input_cost_per_token")
    edp = entry.get("output_cost_per_token")
    pin = float(edge) if isinstance(edge, (int, float)) else 0.0
    pout = float(edp) if isinstance(edp, (int, float)) else 0.0
    return pin, pout


def _litellm_message_cost(
    model_name: str, prompt_tokens: int, completion_tokens: int
) -> Optional[float]:
    """Price one message via LiteLLM's official completion_cost API.

    Uses the resolved catalog key so short names (e.g. glm-5.3-flash) map to
    their provider entry (zai/glm-5.3-flash); returns None when unavailable."""
    module = _litellm_module()
    if not module or module is False or not hasattr(module, "completion_cost"):
        return None
    try:
        from litellm.types.utils import ModelResponse, Usage

        entry = _litellm_lookup(model_name)
        model_ref = (entry or {}).get("_litellm_key") or model_name
        resp = ModelResponse(
            model=model_ref,
            usage=Usage(
                prompt_tokens=prompt_tokens, completion_tokens=completion_tokens
            ),
        )
        cost = module.completion_cost(completion_response=resp)
        return float(cost) if isinstance(cost, (int, float)) else None
    except Exception:
        return None


def _model_context_window(model_name: str, override: Optional[int] = None) -> int:
    """Resolve a model's context window (tokens). Explicit configuration takes
    precedence; otherwise LiteLLM's database, then the agent's per-model table."""
    if override and int(override) > 0:
        return int(override)
    entry = _litellm_lookup(model_name)
    if entry:
        cw = entry.get("max_input_tokens") or entry.get("max_tokens")
        if isinstance(cw, (int, float)) and cw > 0:
            return int(cw)
    try:
        from sigmaflow.agent.conf import MAX_MODEL_LEN

        return int(
            MAX_MODEL_LEN.get(
                (model_name or "").lower(), MAX_MODEL_LEN.get("default", 131072)
            )
        )
    except Exception:
        return 131072


# ==================== Agent 工具配置 ====================
# 设置页可对内置工具做启用开关、改名与描述覆盖, 落盘到 <science_dir>/tools.json;
# 请求时组合出实际生效的工具清单, 并在 TOOL_HANDLERS 中同步别名, 保证改名不影响执行


# ==================== 单用户 / 多用户模式 ====================
# 通过环境变量 SIGMAFLOW_MULTI_USER=1 在服务启动时启用多用户模式。
# 单用户模式(默认)与历史行为完全一致: 数据仍在共享根目录, 页面右下角
# 显示运行服务的系统用户名。多用户模式下注册/登录后按用户隔离全部
# 配置与会话数据(projects/models/tools/tokens/skills/system_prompt),
# 运行任务的归属也按用户过滤。

_LOGGER_WS = logging.getLogger(
    "uvicorn.error"
)  # 复用 uvicorn 已配置的输出通道访问 web.log


def _ensure_user_data(user: str) -> None:
    """Prepare per-user storage: mirror builtin skills on first sight."""
    if not _multi_user():
        return
    root = _user_data_dir(user)
    marker = os.path.join(root, ".ready")
    if os.path.exists(marker):
        return
    os.makedirs(root, exist_ok=True)
    try:
        _seed_builtin_skills()
    except Exception:
        pass
    try:
        Path(marker).write_text(time.strftime("%Y-%m-%dT%H:%M:%S"), encoding="utf-8")
    except Exception:
        pass


# ------------------------------------------------------------- 微信扫码登录


# ==================== Agent 技能配置 ====================
# 设置页可对技能做启用开关、名称与描述覆盖, 落盘到 <science_dir>/skills.json;
# 技能正文来自 <science_dir>/skills/<id>/SKILL.md, 内置技能在启动时从包资源种子化;
# 技能清单随系统提示词发给模型, 因此覆盖生效需要同时替换 skill_loader 并换出清单文本


# ==================== MCP 服务配置 ====================
# 设置页可增删改 MCP 服务器 (名称/地址/启用开关), 落盘到 <science_dir>/mcp.json;
# 内置服务器 (medical-apis) 在首次运行时种子化; 生效路径: 导入 agent 工具模块前通过
# MCP_ENDPOINT 环境变量注入, 已导入时在保存后重建 MCPClient 并重挂其工具


# Interactive terminal: one real PTY per project, shared across websocket
# connections. The reader thread copies master output into a ring buffer and
# fans it out to every attached websocket; a reconnect replays the buffer.


# ==================== 系统提示词配置 ====================
# 设置页可提供自定义系统提示词替换内置默认; 技能清单自动附加在末尾;
# 子代理提示词保持内置不随覆盖变化; 配置落盘 <science_dir>/system_prompt.json


# 压缩参数的定义域: (类型, 默认值, 最小, 最大), 默认值取 agent conf 的环境变量基线


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
                        "name": old["baseUrl"].split("//", 1)[-1].split("/", 1)[0]
                        or "provider",
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
            json.dumps(
                {"providers": self.providers, "models": self.models},
                ensure_ascii=False,
                indent=2,
            ),
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
            provider = {
                "id": f"pv-{uuid.uuid4().hex[:12]}",
                "apiKey": "",
                "createdAt": now,
            }
            self.providers[provider["id"]] = provider
        base_url = payload.baseUrl.strip()
        if not base_url:
            raise HTTPException(status_code=400, detail="Base URL is required")
        provider["name"] = _clip(
            payload.name or base_url.split("//", 1)[-1].split("/", 1)[0], 200
        )
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
        for mid in [
            k for k, m in self.models.items() if m.get("providerId") == provider_id
        ]:
            lost_default = bool(lost_default or self.models[mid].get("isDefault"))
            self.models.pop(mid, None)
        if lost_default:
            self._fix_default()
        self._save()
        return True

    # --------------------------------------------------------------- models

    def _public_model(self, model: dict) -> dict:
        provider = self.providers.get(str(model.get("providerId") or "")) or {}
        name = model.get("model") or ""
        entry = _litellm_lookup(name)
        pin, pout = _model_pricing(entry)
        max_output = entry.get("max_tokens") if entry else None
        return {
            "id": model["id"],
            "providerId": model.get("providerId"),
            "providerName": provider.get("name") or "",
            "baseUrl": provider.get("baseUrl") or "",
            "model": name,
            "keyHint": provider.get("keyHint"),
            "isDefault": bool(model.get("isDefault")),
            "contextWindow": _model_context_window(name, model.get("contextWindow")),
            "maxOutputTokens": int(max_output)
            if isinstance(max_output, (int, float)) and max_output > 0
            else None,
            "priceInUsdPerM": round(pin * 1e6, 4) if pin > 0 else None,
            "priceOutUsdPerM": round(pout * 1e6, 4) if pout > 0 else None,
            "catalogMatched": bool(entry),
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
        # contextWindow 仅接受正整数, 其余取值一律清除该字段
        if payload.contextWindow and payload.contextWindow > 0:
            model["contextWindow"] = int(payload.contextWindow)
        else:
            model.pop("contextWindow", None)
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

    def create(self, payload: RunCreate, owner: str = "") -> str:
        prompt = payload.prompt or ""
        if not prompt.strip() or len(prompt) > MAX_PROMPT_CHARS:
            raise HTTPException(
                status_code=400,
                detail="A non-empty prompt of at most 6000 characters is required",
            )
        if not 1 <= len(payload.steps) <= MAX_STEPS:
            raise HTTPException(
                status_code=400, detail=f"1-{MAX_STEPS} steps are required"
            )
        if len(self.runs) >= MAX_RUNS:
            raise HTTPException(
                status_code=429, detail="Run limit reached; restart to reset"
            )

        run_id = str(uuid.uuid4())
        run = {
            "id": run_id,
            "owner": owner,
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
            raise HTTPException(
                status_code=400, detail="action must be pause, resume, or cancel"
            )
        run = self.runs.get(run_id)
        if run is None:
            raise HTTPException(
                status_code=404,
                detail="Run not found. Demo state is lost when the server restarts.",
            )
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
            run["progress"] = round(
                sum(s["progress"] for s in run["steps"]) / len(run["steps"])
            )
            if all(s["status"] == "complete" for s in run["steps"]):
                run["status"] = "complete"
            self.broadcast(run)


class ScienceAPI:
    """HTTP/SSE + WebSocket routes for the Science workspace."""

    @property
    def model_store(self) -> ScienceModelStore:
        """Model config store scoped to the request user (multi-user aware)."""
        return self._scoped_store("m")

    @property
    def project_store(self) -> "ScienceProjectStore":
        """Project/conversation store scoped to the request user."""
        return self._scoped_store("p")

    def _scoped_store(self, kind: str):
        """Create and cache one store instance per user and kind."""
        user = _current_user()
        key = (kind, user)
        cached = self._store_cache.get(key)
        if cached is None:
            storage_dir = _user_data_dir(user)
            cached = (
                ScienceModelStore(storage_dir=storage_dir)
                if kind == "m"
                else ScienceProjectStore(storage_dir=storage_dir)
            )
            self._store_cache[key] = cached
        return cached

    def __init__(self, pipeline_manager=None):
        self.manager = ScienceRunManager()
        # 存储: 单用户即共享根目录; 多用户按请求用户懒加载独立目录。
        self._store_cache: Dict[tuple, Any] = {}
        try:
            _litellm_warm()  # 先完成 litellm 导入再对外服务, 避免半初始化竞态
        except Exception:
            pass
        try:
            _seed_mcp_config()  # 启动即补种内置 MCP(如新增的 rcsb), agent 导入时即可激活
        except Exception:
            pass
        router = APIRouter(prefix="/api", dependencies=[Depends(_auth_http)])
        # WebSocket 路由单独挂载: router 级依赖对 WS 握手不可用(Request 注解无法解析),
        # 且 WS 端点内部已手动做同源与会话校验。
        ws_router = APIRouter(prefix="/api")
        auth_router = APIRouter(prefix="/api/auth")

        self._register_auth_routes(auth_router)

        self.ws_router = ws_router
        self.auth_router = auth_router

        self._register_system_routes(router)

        self._register_fs_routes(router)

        self._register_chat_routes(router)

        self._register_admin_routes(router)

        self._register_conversation_routes(router)

        self._register_pty_routes(router, ws_router)

        @router.on_event("startup")
        async def startup_event():
            await self.manager.start()

        @router.on_event("shutdown")
        async def shutdown_event():
            await self.manager.stop()

        self.router = router

    def _check_run_owner(self, run_id: str) -> None:
        """Multi-user isolation: a run is only visible to its owner."""
        run = self.manager.runs.get(run_id)
        if run is None:
            return
        if _multi_user() and run.get("owner") != _current_user():
            raise HTTPException(status_code=404, detail="Run not found")

    def _register_auth_routes(self, auth_router: APIRouter) -> None:
        """Register routes for this domain (order preserved)."""

        # ------------------------------------------------------- auth API

        @auth_router.get("/me")
        async def auth_me(request: Request):
            if not _multi_user():
                return {"mode": "single", "user": {"name": _os_user()}}
            user = _cookie_user(request)
            return {"mode": "multi", "user": {"name": user} if user else None}

        @auth_router.post("/register")
        async def auth_register(
            payload: _AuthCredentials, request: Request, response: Response
        ):
            _check_origin(request)
            if not _multi_user():
                raise HTTPException(status_code=400, detail="当前为单用户模式")
            name = _clip(str(payload.username or "").strip(), 64)
            if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{2,31}", name):
                raise HTTPException(
                    status_code=400,
                    detail="用户名需 3-32 位字母、数字、- 或 _ 开头字母",
                )
            password = str(payload.password or "")
            if len(password) < 6:
                raise HTTPException(status_code=400, detail="密码至少 6 位")
            salt = secrets.token_bytes(16)
            with _USER_REGISTRY_LOCK:
                users = _load_users()
                if name in users:
                    raise HTTPException(status_code=409, detail="用户名已存在")
                users[name] = {
                    "salt": salt.hex(),
                    "hash": _hash_password(password, salt),
                    "createdAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
                }
                _save_users(users)
            _ensure_user_data(name)
            response.set_cookie(
                _SESSION_COOKIE,
                _session_token(name),
                max_age=_SESSION_TTL,
                httponly=True,
                samesite="lax",
            )
            return {"mode": "multi", "user": {"name": name}}

        @auth_router.post("/login")
        async def auth_login(
            payload: _AuthCredentials, request: Request, response: Response
        ):
            _check_origin(request)
            if not _multi_user():
                raise HTTPException(status_code=400, detail="当前为单用户模式")
            name = _clip(str(payload.username or "").strip(), 64)
            password = str(payload.password or "")
            users = _load_users()
            record = users.get(name)
            if not isinstance(record, dict):
                record = {}
            stored = str(record.get("hash") or "")
            try:
                salt = bytes.fromhex(str(record.get("salt") or ""))
            except ValueError:
                salt = b""
            ok = stored and hmac.compare_digest(stored, _hash_password(password, salt))
            if not ok:
                raise HTTPException(status_code=401, detail="用户名或密码不正确")
            _ensure_user_data(name)
            response.set_cookie(
                _SESSION_COOKIE,
                _session_token(name),
                max_age=_SESSION_TTL,
                httponly=True,
                samesite="lax",
            )
            return {"mode": "multi", "user": {"name": name}}

        @auth_router.post("/logout")
        async def auth_logout(request: Request, response: Response):
            response.delete_cookie(_SESSION_COOKIE)
            return {"ok": True}

        # --------------------------------------------------- 微信扫码登录

        @auth_router.get("/wechat/config")
        async def auth_wechat_config():
            return {"enabled": _wechat_enabled()}

        @auth_router.get("/wechat/start")
        async def auth_wechat_start(request: Request):
            """Return the WeChat QR page URL; the SPA opens it in a popup."""
            if not _wechat_enabled():
                raise HTTPException(status_code=503, detail="微信扫码登录未配置")
            url = _wechat_qrconnect_url(request)
            return {"url": url}

        @auth_router.post("/wechat/exchange")
        async def auth_wechat_exchange(request: Request, response: Response):
            """Trade a one-time code for a local session; auto-registers."""
            _check_origin(request)
            if not _wechat_enabled():
                raise HTTPException(status_code=503, detail="微信扫码登录未配置")
            try:
                body = await request.json()
            except Exception:
                body = {}
            body = body if isinstance(body, dict) else {}
            code = str(body.get("code") or "").strip()
            state = str(body.get("state") or "").strip()
            if not (code and _wechat_consume_state(state)):
                raise HTTPException(
                    status_code=400, detail="登录会话已失效，请重新扫码"
                )
            cfg = _load_wechat_config()
            appid = _wechat_appid()
            token = _wechat_fetch_json(
                "https://api.weixin.qq.com/sns/oauth2/access_token"
                + "?"
                + urllib.parse.urlencode(
                    {
                        "appid": appid,
                        "secret": str(cfg.get("app_secret") or "").strip(),
                        "code": code,
                        "grant_type": "authorization_code",
                    }
                )
            )
            openid = str(token.get("openid") or "")
            unionid = str(token.get("unionid") or "")
            if not openid:
                raise HTTPException(
                    status_code=401, detail="微信登录未完成，请稍后重新扫码"
                )
            key_union = unionid or f"{appid}:{openid}"
            userinfo = _wechat_fetch_json(
                "https://api.weixin.qq.com/sns/userinfo"
                + "?"
                + urllib.parse.urlencode(
                    {
                        "access_token": str(token.get("access_token") or ""),
                        "openid": openid,
                    }
                )
            )
            nickname = _clip(str(userinfo.get("nickname") or ""), 48)
            name = ""
            with _USER_REGISTRY_LOCK:
                users = _load_users()
                for rec_name, rec in users.items():
                    wx = rec.get("wechat") if isinstance(rec, dict) else None
                    key = str(wx.get("key") or "") if isinstance(wx, dict) else ""
                    if key and hmac.compare_digest(key, key_union):
                        name = rec_name
                        break
                if not name:
                    name = _wechat_account_name(users, key_union)
                    users[name] = {
                        "salt": "",
                        "hash": "",
                        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
                        "wechat": {
                            "key": key_union,
                            "openid": openid,
                            "unionid": unionid,
                            "nickname": nickname,
                        },
                    }
                    _save_users(users)
            _ensure_user_data(name)
            response.set_cookie(
                _SESSION_COOKIE,
                _session_token(name),
                max_age=_SESSION_TTL,
                httponly=True,
                samesite="lax",
            )
            return {"mode": "multi", "user": {"name": name}}

    def _register_system_routes(self, router: APIRouter) -> None:
        """Register routes for this domain (order preserved)."""

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

        @router.get("/system")
        async def system_stats():
            return await asyncio.to_thread(_system_stats)

        @router.post("/runs")
        async def create_run(payload: RunCreate, request: Request):
            _check_origin(request)
            run_id = self.manager.create(payload, _current_user())
            return {"id": run_id, "isDemo": True}

        @router.get("/runs")
        async def list_runs():
            runs = [
                run
                for run in self.manager.runs.values()
                if not _multi_user() or run.get("owner") == _current_user()
            ]
            return [
                {
                    "id": run["id"],
                    "status": run["status"],
                    "progress": run["progress"],
                    "createdAt": run["createdAt"],
                }
                for run in sorted(runs, key=lambda r: r["createdAt"])
            ]

        @router.get("/runs/{run_id}")
        async def get_run(run_id: str):
            self._check_run_owner(run_id)
            try:
                return self.manager.snapshot(run_id)
            except KeyError:
                raise HTTPException(
                    status_code=404,
                    detail="Run not found. Demo state is lost when the server restarts.",
                )

        @router.post("/runs/{run_id}/control")
        async def control_run(run_id: str, payload: RunControl, request: Request):
            _check_origin(request)
            self._check_run_owner(run_id)
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
            return {
                "provider": provider,
                "providers": self.model_store.list_providers(),
            }

        @router.delete("/providers/{provider_id}")
        async def delete_provider(provider_id: str, request: Request):
            _check_origin(request)
            if not self.model_store.delete_provider(provider_id):
                raise HTTPException(status_code=404, detail="Provider not found")
            return {
                "providers": self.model_store.list_providers(),
                "models": self.model_store.list_models(),
            }

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

        @router.get("/context-info")
        async def context_info():
            """Token estimate of the agent's fixed request overhead (system
            prompt + tool definitions), used by the ring widget."""
            return await asyncio.to_thread(_agent_context_sizes)

        @router.get("/model-meta")
        async def model_meta(model: str = ""):
            """LiteLLM catalog lookup for one model name (form auto-fill preview)."""

            def _work():
                entry = _litellm_lookup(model or "")
                pin, pout = _model_pricing(entry)
                max_output = entry.get("max_tokens") if entry else None
                ctx = (
                    entry.get("max_input_tokens") or entry.get("max_tokens")
                    if entry
                    else None
                )
                return {
                    "model": model or "",
                    "matched": bool(entry),
                    "litellmKey": (entry or {}).get("_litellm_key") or None,
                    "contextWindow": int(ctx)
                    if isinstance(ctx, (int, float)) and ctx > 0
                    else None,
                    "maxOutputTokens": int(max_output)
                    if isinstance(max_output, (int, float)) and max_output > 0
                    else None,
                    "priceInUsdPerM": round(pin * 1e6, 4) if pin > 0 else None,
                    "priceOutUsdPerM": round(pout * 1e6, 4) if pout > 0 else None,
                }

            return await asyncio.to_thread(_work)

        @router.get("/usage-tokens")
        async def usage_tokens(request: Request):
            """Token usage of SigmaFlow's own conversations for the settings card.

            Aggregated on the fly from the persisted conversation records
            (each assistant message carries tokens/promptTokens/elapsed);
            no external usage service is involved.
            """
            _check_origin(request)
            return _sigma_usage(self.project_store.conversations)

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

    def _register_fs_routes(self, router: APIRouter) -> None:
        """Register routes for this domain (order preserved)."""

        # ------------------------------------------------ projects & conversations
        # Projects group conversations. Deleting a project unassigns (keeps)
        # its conversations.

        @router.get("/fs/tree")
        async def fs_tree(request: Request, projectId: str = "", path: str = ""):
            """项目目录一层列表 + git 状态(供侧栏文件浏览器懒加载)。"""
            _check_origin(request)
            project = self.project_store.projects.get(projectId or "")
            return await asyncio.to_thread(_fs_tree_payload, project, path or "")

        @router.get("/fs/file")
        async def fs_file(request: Request, projectId: str = "", path: str = ""):
            _check_origin(request)
            project = self.project_store.projects.get(projectId or "")
            return await asyncio.to_thread(_fs_file_payload, project, path or "")

        @router.post("/fs/exec")
        async def fs_exec(payload: _FsExecIn, request: Request):
            """在项目目录执行一条 shell 命令(非交互, 逐条提交)。"""
            _check_origin(request)
            project = self.project_store.projects.get(payload.projectId or "")
            return await asyncio.to_thread(
                _fs_exec_payload, project, payload.cmd, payload.cwd
            )

        @router.post("/fs/upload")
        async def fs_upload(payload: _FsUploadIn, request: Request):
            """上传一个文件到项目目录(base64, 不覆盖已有文件)。"""
            _check_origin(request)
            project = self.project_store.projects.get(payload.projectId or "")
            return await asyncio.to_thread(
                _fs_upload_payload, project, payload.name, payload.dataBase64
            )

        @router.get("/projects")
        async def list_projects():
            return {"projects": self.project_store.list_projects()}

        @router.get("/fs/dirs")
        async def list_dirs(request: Request, path: str = ""):
            _check_origin(request)
            root = os.environ.get("SIGMAFLOW_PROJECTS_DIR") or os.path.expanduser("~")
            base = (
                os.path.realpath(os.path.expanduser(path))
                if path
                else os.path.realpath(root)
            )
            dirs, error = [], ""
            try:
                for entry in os.scandir(base):
                    if entry.is_dir() and not entry.name.startswith("."):
                        dirs.append({"name": entry.name, "path": entry.path})
            except OSError:
                error = "目录不存在或不可访问"
            dirs.sort(key=lambda d: d["name"].lower())
            parent = os.path.dirname(base.rstrip("/")) or "/"
            return {
                "root": root,
                "path": base,
                "parent": parent if parent != base else None,
                "dirs": dirs,
                "error": error,
            }

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
            return {
                "projects": self.project_store.list_projects(),
                "conversations": self.project_store.list_conversations(),
            }

    def _register_chat_routes(self, router: APIRouter) -> None:
        """Register routes for this domain (order preserved)."""

        @router.post("/chat")
        async def chat(payload: ChatIn, request: Request):
            _check_origin(request)
            base_url, api_key, model_name = _resolve_chat(
                self.model_store, payload.modelId
            )
            messages = [m for m in (payload.messages or []) if isinstance(m, dict)]
            conv_ref = self.project_store.conversations.get(payload.runId or "") or {}
            effective_pid = payload.projectId or conv_ref.get("projectId")
            workdir = self.project_store.projects.get(effective_pid or "", {}).get(
                "dir"
            )
            try:
                stats: dict = {}
                content = await asyncio.to_thread(
                    _run_agent_chat,
                    base_url,
                    api_key,
                    model_name,
                    messages,
                    None,
                    None,
                    None,
                    None,
                    stats,
                    workdir,
                    bool(payload.planMode),
                )
            except RuntimeError as err:
                raise HTTPException(status_code=400, detail=str(err))
            return {
                "content": content,
                "tokens": stats.get("completion_tokens") or 0,
                "promptTokens": stats.get("prompt_tokens") or 0,
                "compaction": stats.get("compaction"),
            }

    def _register_admin_routes(self, router: APIRouter) -> None:
        """Register routes for this domain (order preserved)."""

        @router.get("/tools")
        async def list_tools():
            overrides = await asyncio.to_thread(_load_tool_overrides)
            defaults = await asyncio.to_thread(_tool_defaults)
            return {"tools": _tool_listing(defaults, overrides)}

        @router.post("/tools")
        async def save_tools(payload: ToolsUpdateIn, request: Request):
            _check_origin(request)
            defaults = await asyncio.to_thread(_tool_defaults)
            known = {t["name"]: t for t in defaults}
            if payload.reset:
                overrides = {}
            else:
                overrides = _build_tool_overrides(payload.tools or [], known)
            await asyncio.to_thread(_save_tool_overrides, overrides)
            # 工具集变化后固定开销随之变化, 清空缓存让 /context-info 重新测量
            _AGENT_CONTEXT_SIZES.clear()
            return {"tools": _tool_listing(defaults, overrides)}

        @router.get("/skills")
        async def list_skills():
            overrides = await asyncio.to_thread(_load_skill_overrides)
            defaults = await asyncio.to_thread(_discover_skills)
            return {"skills": _skill_listing(defaults, overrides)}

        @router.post("/skills")
        async def save_skills(payload: SkillsUpdateIn, request: Request):
            _check_origin(request)
            defaults = await asyncio.to_thread(_discover_skills)
            known = {s["id"]: s for s in defaults}
            if payload.reset:
                overrides = {}
            else:
                overrides = _build_skill_overrides(payload.skills or [], known)
            await asyncio.to_thread(_save_skill_overrides, overrides)
            _AGENT_CONTEXT_SIZES.clear()
            # 已装 loader 时立即重建视图, 下一次会话用新清单
            loader = _agent_tools_module().skill_loader
            if isinstance(loader, _ScienceSkillView):
                await asyncio.to_thread(loader.rebuild)
            return {"skills": _skill_listing(defaults, overrides)}

        @router.get("/mcp")
        async def list_mcp():
            _seed_mcp_config()
            return {"servers": _mcp_listing()}

        @router.post("/mcp")
        async def save_mcp(payload: MCPIn, request: Request):
            _check_origin(request)
            servers = _build_mcp_servers(
                payload.servers or [], reset=bool(payload.reset)
            )
            # 记录被移除的内置服务器, 避免每次启动回填复活
            removed = (
                []
                if payload.reset
                else [n for n in _builtin_mcp_servers() if n not in servers]
            )
            await asyncio.to_thread(_save_mcp_servers, servers, removed)
            # 重建 MCPClient 会真实调用各服务器的 tools/list, 放到线程里避免阻塞事件循环
            await asyncio.to_thread(_rebuild_agent_mcp)
            _AGENT_CONTEXT_SIZES.clear()
            return {"servers": _mcp_listing()}

        @router.get("/system-prompt")
        async def get_system_prompt():
            def _builtin_text():
                return _default_system_prompts()[0]

            builtin = await asyncio.to_thread(_builtin_text)
            cfg = _load_system_prompt_config()
            prompt = str(cfg.get("prompt") or "")
            enabled = bool(cfg.get("enabled")) and bool(prompt.strip())
            return {
                "prompt": prompt,
                "enabled": enabled,
                "builtin": builtin,
                "builtinTokens": math.ceil(len(builtin) / 3.7),
            }

        @router.post("/system-prompt")
        async def save_system_prompt(payload: SystemPromptIn, request: Request):
            _check_origin(request)
            prompt_text = str(payload.prompt or "")[:32000]
            enabled = bool(payload.enabled)
            if enabled and not prompt_text.strip():
                raise HTTPException(
                    status_code=400, detail="启用自定义系统提示词时内容不能为空"
                )
            await asyncio.to_thread(
                _save_system_prompt_config, {"prompt": prompt_text, "enabled": enabled}
            )
            # 自定义提示词改变系统提示长度, 清空缓存让 /context-info 重新测量
            _AGENT_CONTEXT_SIZES.clear()
            return {"prompt": prompt_text, "enabled": enabled}

        @router.get("/compaction")
        async def get_compaction():
            return {"compaction": await asyncio.to_thread(_effective_compaction)}

        @router.post("/compaction")
        async def save_compaction(payload: CompactionIn, request: Request):
            _check_origin(request)
            if payload.reset:
                # 恢复默认: 删除存储文件, 下次读取回落环境基线
                def _drop_compaction_file() -> None:
                    p = _compaction_config_path()
                    if os.path.exists(p):
                        os.remove(p)

                await asyncio.to_thread(_drop_compaction_file)
                return {"compaction": await asyncio.to_thread(_effective_compaction)}
            stored = {
                k: v
                for k, v in {
                    "enabled": payload.enabled,
                    "ratio": payload.ratio,
                    "keepRecentTokens": payload.keepRecentTokens,
                    "minDrops": payload.minDrops,
                    "summaryTokens": payload.summaryTokens,
                    "resultChars": payload.resultChars,
                    "argChars": payload.argChars,
                }.items()
                if v is not None
            }
            merged = dict(await asyncio.to_thread(_load_compaction_config))
            merged.update(stored)
            # 写入前按同样规则钳制, 非法输入不能保存生效
            out = {}
            for key, (kind, default_v, lo, hi) in _compaction_defaults().items():
                if key in merged:
                    try:
                        val = (
                            kind(merged[key]) if merged[key] is not None else default_v
                        )
                        if lo is not None and val < lo:
                            val = lo
                        if hi is not None and val > hi:
                            val = hi
                        out[key] = val
                    except (TypeError, ValueError):
                        continue
            await asyncio.to_thread(_save_compaction_config, out)
            return {"compaction": await asyncio.to_thread(_effective_compaction)}

        @router.get("/tokens")
        async def list_tokens():
            return {"tokens": await asyncio.to_thread(_token_listing)}

        @router.post("/tokens")
        async def save_tokens(payload: TokensUpdateIn, request: Request):
            _check_origin(request)
            await asyncio.to_thread(_apply_token_updates, payload.tokens or {})
            # 密钥变化会同步调整 Sciverse 工具启用状态, 固定开销随之变化
            _AGENT_CONTEXT_SIZES.clear()
            return {"tokens": await asyncio.to_thread(_token_listing)}

    def _register_conversation_routes(self, router: APIRouter) -> None:
        """Register routes for this domain (order preserved)."""

        @router.get("/conversations")
        async def list_conversations():
            return {"conversations": self.project_store.list_conversations()}

        @router.post("/conversations")
        async def save_conversation(payload: ConversationIn, request: Request):
            _check_origin(request)
            conversation = self.project_store.upsert_conversation(payload)
            return {
                "conversation": conversation,
                "conversations": self.project_store.list_conversations(),
            }

        @router.post("/conversations/{conversation_id}/title")
        async def generate_conversation_title(
            conversation_id: str, payload: TitleIn, request: Request
        ):
            """用当前配置的模型为会话生成短标题(dsh session-title-llm 思路)。

            每个会话只应调用一次: 由前端在首轮回复完成后触发, 失败静默保留兜底标题,
            不重试不阻塞主流程。标题落在服务端, 会话列表与回放都以它为准。
            """
            _check_origin(request)

            def _gen():
                base_url, api_key, model_name = _resolve_chat(
                    self.model_store, payload.modelId
                )
                prompt_text = (payload.prompt or "")[:1200]
                reply_text = (payload.reply or "")[:800]
                sys_text = (
                    "为一轮对话生成一个简洁的中文会话标题。必须只输出中文汉字标题本身: "
                    "6-16 个汉字, 概括用户意图; 禁止英文单词、拼音、引号、句号、"
                    "冒号、表情、思维过程和任何解释; 不要复述原文句子。"
                )
                user_text = f"用户: {prompt_text}" + (
                    f"\n助手: {reply_text}" if reply_text else ""
                )
                resp = requests.post(
                    base_url.rstrip("/") + "/chat/completions",
                    headers={"Authorization": f"Bearer {api_key}"},
                    json={
                        "model": model_name,
                        "messages": [
                            {"role": "system", "content": sys_text},
                            {"role": "user", "content": user_text},
                        ],
                        "max_tokens": 500,
                        "temperature": 0.3,
                        "stream": False,
                        # glm/qwen 走思考模式的模型会先烧 reasoning 再出 content,
                        # 常见关思考开关(不支持该参数的网关会忽略, 无害)
                        "enable_thinking": False,
                        "thinking": {"type": "disabled"},
                    },
                    timeout=20,
                )
                resp.raise_for_status()
                data = resp.json()
                _raw_msg = (data.get("choices") or [{}])[0].get("message") or {}
                title = _raw_msg.get("content")
                reasoning_only = ""
                if not title:
                    reasoning_only = (
                        _raw_msg.get("reasoning_content")
                        or _raw_msg.get("reasoning")
                        or ""
                    )
                title = (title or "").strip()  # 去包裹引号
                for _q in ('"', chr(39)):
                    title = title.strip(_q)
                title = title.strip(chr(0x201C) + chr(0x201D))
                title = re.sub(r"[\n\u3002.!\uff01\uff1f?]", "", title).strip()
                if not title and reasoning_only:
                    # 思考型模型 content 为空时, 从 reasoning 兜底提炼中文短语作标题
                    zh = re.findall(r"[\u4e00-\u9fff]{2,24}", reasoning_only)
                    title = zh[-1] if zh else ""
                # 模型爱在标题前塞英文说明(如 "The user wants..."); 优先提取开头的连续中文段
                zh_lead = re.findall(
                    r"[\u4e00-\u9fff][\u4e00-\u9fff\u3000-\u303fA-Za-z0-9A-Za-z0-9]{0,23}",
                    title,
                )
                if zh_lead:
                    title = zh_lead[0].strip()
                # 最终校验必须在收敛后的结果上做: 不含汉字一律视为失败, 保留兜底标题
                if not title or not re.search(r"[\u4e00-\u9fff]", title):
                    raise ValueError("title must contain Chinese")
                if len(title) > 24:
                    title = title[:24].strip()
                return self.project_store.set_title(conversation_id, title)

            try:
                conv = await asyncio.to_thread(_gen)
            except Exception as err:
                logging.getLogger("uvicorn.error").info(
                    "title generation failed for %s: %s", conversation_id, err
                )
                return {"ok": False, "title": None}
            return {"ok": True, "title": conv.get("title") if conv else None}

        @router.post("/feedback")
        async def submit_feedback(payload: FeedbackIn, request: Request):
            """消息反馈落 append-only 日志(dsh message-feedback 思路): 只进日志,
            永不进入模型上下文; 不回读、不改会话内容。"""
            _check_origin(request)
            rating = payload.rating if payload.rating in ("up", "down") else ""
            if not rating:
                raise HTTPException(status_code=400, detail="rating 必须是 up/down")
            record = {
                "ts": int(time.time() * 1000),
                "user": _current_user(),
                "conversationId": _clip(payload.conversationId, 64),
                "messageId": _clip(payload.messageId, 64),
                "rating": rating,
                "category": _clip(payload.category, 60),
                "note": _clip(payload.note, 2000),
                "snippet": _clip(payload.snippet, 500),
            }
            feedback_path = self.project_store.storage_dir / "feedback.jsonl"
            try:
                await asyncio.to_thread(_append_jsonl, feedback_path, record)
            except Exception as err:
                logging.getLogger("uvicorn.error").info(
                    "feedback append failed: %s", err
                )
                raise HTTPException(status_code=500, detail="反馈写入失败")
            return {"ok": True}

        @router.post("/conversations/{conversation_id}/compact")
        async def compact_conversation(conversation_id: str, request: Request):
            # 手动压缩: 圆环弹卡触发, 独立于会话请求, 复用 Compactor 全量逻辑
            conv, base_url, api_key, model_name, msgs, compactor, manual_keep = (
                _compact_utils(conversation_id, request)
            )

            def _run_compact():
                compactor.summary_compact(
                    msgs, force=True, keep_tokens_override=manual_keep
                )
                return _compact_result_payload(compactor.last_meta, len(msgs))

            return await asyncio.to_thread(_run_compact)

        @router.post("/conversations/{conversation_id}/compact-stream")
        async def compact_conversation_stream(conversation_id: str, request: Request):
            # 流式手动压缩: SSE 逐段推送摘要增量(delta), 结束后一条 done 携带完整结果;
            # 前端等待消息实时渲染 markdown 摘要, 观感与模型回复流式一致
            conv, base_url, api_key, model_name, msgs, compactor, manual_keep = (
                _compact_utils(conversation_id, request)
            )

            loop = asyncio.get_running_loop()
            aq: asyncio.Queue = asyncio.Queue()

            def _on_delta(text):
                loop.call_soon_threadsafe(aq.put_nowait, ("delta", text))

            def _run():
                try:
                    compactor.summary_compact(
                        msgs,
                        force=True,
                        keep_tokens_override=manual_keep,
                        on_delta=_on_delta,
                    )
                except Exception as e:
                    loop.call_soon_threadsafe(aq.put_nowait, ("error", str(e)))
                loop.call_soon_threadsafe(aq.put_nowait, ("end", None))

            threading.Thread(target=_run, daemon=True).start()

            async def event_stream():
                err = None
                while True:
                    kind, payload = await aq.get()
                    if kind == "delta":
                        yield f"event: delta\ndata: {json.dumps({'text': payload}, ensure_ascii=False)}\n\n"
                    elif kind == "error":
                        err = payload
                    elif kind == "end":
                        break
                if err is not None:
                    yield f"event: error\ndata: {json.dumps({'detail': err}, ensure_ascii=False)}\n\n"
                    return
                # 摘要本身失败时 Compactor 已产出机械兜底文案, 照常发 done 保证前端收尾
                yield f"event: done\ndata: {json.dumps(_compact_result_payload(compactor.last_meta, len(msgs)), ensure_ascii=False)}\n\n"

            return StreamingResponse(
                event_stream(),
                media_type="text/event-stream",
                headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
            )

        def _compact_utils(conversation_id: str, request: Request):
            # 流式/非流式压缩端点的公共准备: 校验 + Compactor 构建 + 手动窗口收窄
            conv = self.project_store.conversations.get(conversation_id)
            if conv is None:
                raise HTTPException(status_code=404, detail="Conversation not found")
            msgs = [
                {"role": m.get("role"), "content": m.get("content", "")}
                for m in (conv.get("content") or [])
                if m.get("role") in ("user", "assistant")
            ]
            if len(msgs) < 2:
                raise HTTPException(status_code=400, detail="会话内容过少，无需压缩")
            _check_origin(request)
            base_url, api_key, model_name = _resolve_chat(self.model_store, None)
            from openai import OpenAI

            agent_module = _agent_agent_module()
            compactor_mod = _agent_tools_module()
            window = agent_module.MAX_MODEL_LEN.get(
                model_name.lower(), agent_module.MAX_MODEL_LEN["default"]
            )
            compactor = compactor_mod.Compactor(
                agent_module.TRANSCRIPT_DIR,
                OpenAI(
                    base_url=base_url,
                    api_key=api_key or "sk-empty",
                    timeout=300,
                    max_retries=0,
                ),
                window,
                model=model_name,
            )
            cfg = _effective_compaction()
            compactor.overrides = {
                "COMPACT_ENABLED": bool(cfg["enabled"]),
                "COMPACT_RATIO": float(cfg["ratio"]),
                "COMPACT_KEEP_RECENT_TOKENS": int(cfg["keepRecentTokens"]),
                "COMPACT_MIN_DROPS": int(cfg["minDrops"]),
                "COMPACT_TOKENS": int(cfg["summaryTokens"]),
                "COMPACT_SERIAL_RESULT_CHARS": int(cfg["resultChars"]),
                "COMPACT_SERIAL_ARG_CHARS": int(cfg["argChars"]),
            }
            # 手动语义: 保留窗口动态收窄到当前会话的约 25%(下限 400, 上限为设置值),
            # 避免小会话完全落进默认保尾窗口而无事可做(pi 的 auto 有阈值兜底, 手动按钮需要立刻见效)
            est = compactor.estimate_tokens(msgs)
            manual_keep = min(int(cfg["keepRecentTokens"]), max(400, int(est * 0.25)))
            return conv, base_url, api_key, model_name, msgs, compactor, manual_keep

        def _compact_result_payload(meta, total):
            if not (meta and meta.get("applied")):
                return {
                    "applied": False,
                    "removed": 0,
                    "kept": total,
                    "text": "",
                    "transcript": "",
                }
            return {
                "applied": True,
                "summaryTokens": int(meta.get("summaryTokens") or 0),
                "summaryInputTokens": int(meta.get("summaryInputTokens") or 0),
                "removed": int(meta.get("removed") or 0),
                "dropOldIdx": int(meta.get("dropOldIdx", -1) or 0)
                if meta.get("dropOldIdx", -1) is not None
                else -1,
                "kept": int(meta.get("kept") or 0),
                "text": str(meta.get("text") or ""),
                "transcript": str(meta.get("transcript") or ""),
            }

        @router.get("/conversations/{conversation_id}/content")
        async def get_conversation_content(conversation_id: str):
            conv = self.project_store.conversations.get(conversation_id)
            if conv is None:
                raise HTTPException(status_code=404, detail="Conversation not found")
            return {
                "id": conversation_id,
                "title": conv.get("title") or "",
                "projectId": conv.get("projectId"),
                "content": conv.get("content") or [],
            }

        @router.delete("/conversations/{conversation_id}")
        async def delete_conversation(conversation_id: str, request: Request):
            _check_origin(request)
            if not self.project_store.delete_conversation(conversation_id):
                raise HTTPException(status_code=404, detail="Conversation not found")
            return {"conversations": self.project_store.list_conversations()}

        # -------------------------------------------------------------- SSE

        @router.get("/runs/{run_id}/events")
        async def run_events(run_id: str):
            self._check_run_owner(run_id)
            try:
                self.manager.snapshot(run_id)
            except KeyError:
                raise HTTPException(
                    status_code=404,
                    detail="Run not found. Demo state is lost when the server restarts.",
                )

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

    def _register_pty_routes(self, router: APIRouter, ws_router: APIRouter) -> None:
        """Register routes for this domain (order preserved)."""

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

        self._pty_sessions: Dict[str, "_PtySession"] = {}
        self._pty_exit_hook_done = False

        def _pty_shutdown_all():
            for session in list(self._pty_sessions.values()):
                try:
                    session.kill()
                except Exception:
                    pass
            self._pty_sessions.clear()

        @router.on_event("shutdown")
        async def _pty_shutdown_event():
            _pty_shutdown_all()

        @ws_router.websocket("/ws")
        async def websocket_endpoint(ws: WebSocket):
            # 与 HTTP 写接口的同源策略保持一致: 拒绝跨源连接, 防止恶意页面
            # 借 WS 读取会话内容或消耗服务端保存的 API 密钥。
            origin = ws.headers.get("origin")
            host = ws.headers.get("host", "")
            if origin and origin not in (f"http://{host}", f"https://{host}"):
                await ws.close(code=1008)
                return
            ws_user = ""
            if _multi_user():
                # WS 不走 router 依赖, 握手阶段直接校验会话 cookie。
                ws_user = _cookie_user(ws)
                if not ws_user:
                    await ws.close(code=1008)
                    return
            await ws.accept()
            if ws_user:
                _CURRENT_USER.set(ws_user)
                _ensure_user_data(ws_user)
            queue: asyncio.Queue = asyncio.Queue()
            subscribed: Set[str] = set()
            pump: Optional[asyncio.Task] = None
            # 正在进行的 chat.send 流式任务; 生成期间接收循环继续处理
            # 其他 action(ping/run.subscribe 等), 不再被长生成阻塞。
            chat_tasks: Set[asyncio.Task] = set()
            # 请求级停止标记: chat.stop 置 True, 流式循环轮询后自行收尾
            chat_stops: dict = {}
            # 每个请求尚未回答的 ask id 集合: 停止/断开时统一取消
            chat_asks: dict = {}
            # 交互终端: 本连接当前 attach 的 PTY(一个连接同一时刻只挂一个项目会话)
            pty_attached: Dict[str, asyncio.Queue] = {}
            pty_queue: asyncio.Queue = asyncio.Queue()
            pty_pump: Optional[asyncio.Task] = None

            async def _pty_pump_loop():
                try:
                    while True:
                        kind, payload = await pty_queue.get()
                        if kind == "out":
                            await ws.send_bytes(payload)
                        elif kind == "closed":
                            await ws.send_json({"event": "pty.closed"})
                except Exception:
                    pass

            def _pty_get(project_id: str) -> Optional["_PtySession"]:
                session = self._pty_sessions.get(_pty_key_of(project_id))
                return session if session is not None and session.alive else None

            def _pty_detach_all():
                for key, att_queue in list(pty_attached.items()):
                    session = self._pty_sessions.get(key)
                    if session is not None:
                        session.unsubscribe(att_queue)
                pty_attached.clear()

            async def reply(event: str, request_id, data=None):
                message: Dict[str, Any] = {
                    "event": event,
                    "data": data if data is not None else {},
                }
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
                data = message.get("data")
                if not isinstance(data, dict):
                    data = message
                if action == "ping":
                    await reply("pong", request_id)
                elif action == "run.create":
                    try:
                        run_payload = RunCreate(
                            prompt=data.get("prompt", ""),
                            workflowId=data.get("workflowId"),
                            projectId=data.get("projectId"),
                            datasetIds=data.get("datasetIds"),
                            config=data.get("config"),
                            steps=[
                                StepSpec(**s)
                                for s in (data.get("steps") or [])
                                if isinstance(s, dict)
                            ],
                        )
                    except Exception:
                        await fail(request_id, "Invalid run payload")
                        return
                    try:
                        run_id = self.manager.create(run_payload, _current_user())
                    except HTTPException as err:
                        await fail(request_id, err.detail)
                        return
                    # Creating a run implies subscribing this connection.
                    self.manager.subscribe(run_id, queue)
                    subscribed.add(run_id)
                    await reply(
                        "run.created", request_id, {"id": run_id, "isDemo": True}
                    )
                elif action == "run.get":
                    run_id = run_id_of(data)
                    self._check_run_owner(run_id)
                    if run_id not in self.manager.runs:
                        await fail(request_id, "Run not found")
                        return
                    await reply(
                        "run.snapshot", request_id, self.manager.snapshot(run_id)
                    )
                elif action == "run.subscribe":
                    run_id = run_id_of(data)
                    self._check_run_owner(run_id)
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
                        snapshot = self.manager.control(
                            run_id, _clip(data.get("control"), 16)
                        )
                    except HTTPException as err:
                        await fail(request_id, err.detail)
                        return
                    await reply("run.control", request_id, snapshot)
                elif action == "provider.list":
                    await reply(
                        "provider.list",
                        request_id,
                        {"providers": self.model_store.list_providers()},
                    )
                elif action == "provider.save":
                    try:
                        pv_payload = ProviderIn(
                            id=data.get("id") or None,
                            name=data.get("name", ""),
                            baseUrl=data.get("baseUrl", ""),
                            apiKey=data.get("apiKey"),
                        )
                    except Exception:
                        await fail(request_id, "Invalid provider payload")
                        return
                    try:
                        provider = self.model_store.upsert_provider(pv_payload)
                    except HTTPException as err:
                        await fail(request_id, err.detail)
                        return
                    await reply(
                        "provider.saved",
                        request_id,
                        {
                            "provider": provider,
                            "providers": self.model_store.list_providers(),
                        },
                    )
                elif action == "provider.delete":
                    if not self.model_store.delete_provider(run_id_of(data)):
                        await fail(request_id, "Provider not found")
                        return
                    await reply(
                        "provider.deleted",
                        request_id,
                        {
                            "providers": self.model_store.list_providers(),
                            "models": self.model_store.list_models(),
                        },
                    )
                elif action == "provider.test":
                    try:
                        ref = ProviderRef(
                            id=data.get("id") or None,
                            baseUrl=data.get("baseUrl"),
                            apiKey=data.get("apiKey"),
                        )
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
                        ref = ProviderRef(
                            id=data.get("id") or None,
                            baseUrl=data.get("baseUrl"),
                            apiKey=data.get("apiKey"),
                        )
                    except Exception:
                        await fail(request_id, "Invalid provider payload")
                        return
                    base_url, api_key = self.model_store.resolve_provider(ref)
                    if not base_url:
                        await fail(request_id, "模型接口地址为空")
                        return
                    result = await asyncio.to_thread(
                        _list_provider_models, base_url, api_key
                    )
                    await reply("provider.models", request_id, result)
                elif action == "model.list":
                    await reply(
                        "model.list",
                        request_id,
                        {"models": self.model_store.list_models()},
                    )
                elif action == "context.info":
                    await reply(
                        "context.info",
                        request_id,
                        await asyncio.to_thread(_agent_context_sizes),
                    )
                elif action == "model.save":
                    try:
                        md_payload = ModelIn(
                            id=data.get("id") or None,
                            providerId=data.get("providerId", ""),
                            model=data.get("model", ""),
                            isDefault=bool(data.get("isDefault")),
                            contextWindow=data.get("contextWindow") or None,
                        )
                    except Exception:
                        await fail(request_id, "Invalid model payload")
                        return
                    try:
                        model = self.model_store.upsert_model(md_payload)
                    except HTTPException as err:
                        await fail(request_id, err.detail)
                        return
                    await reply(
                        "model.saved",
                        request_id,
                        {"model": model, "models": self.model_store.list_models()},
                    )
                elif action == "model.delete":
                    if not self.model_store.delete_model(run_id_of(data)):
                        await fail(request_id, "Model not found")
                        return
                    await reply(
                        "model.deleted",
                        request_id,
                        {"models": self.model_store.list_models()},
                    )
                elif action == "project.list":
                    await reply(
                        "project.list",
                        request_id,
                        {"projects": self.project_store.list_projects()},
                    )
                elif action == "project.save":
                    try:
                        pj_payload = ProjectIn(
                            id=data.get("id") or None,
                            name=data.get("name", ""),
                            description=data.get("description", ""),
                            tags=data.get("tags") or None,
                            icon=data.get("icon", "folder"),
                            remote=data.get("remote"),
                            dir=data.get("dir"),
                        )
                    except Exception:
                        await fail(request_id, "Invalid project payload")
                        return
                    try:
                        project = self.project_store.upsert_project(pj_payload)
                    except HTTPException as err:
                        await fail(request_id, err.detail)
                        return
                    await reply(
                        "project.saved",
                        request_id,
                        {
                            "project": project,
                            "projects": self.project_store.list_projects(),
                        },
                    )
                elif action == "project.delete":
                    if not self.project_store.delete_project(run_id_of(data)):
                        await fail(request_id, "Project not found")
                        return
                    await reply(
                        "project.deleted",
                        request_id,
                        {
                            "projects": self.project_store.list_projects(),
                            "conversations": self.project_store.list_conversations(),
                        },
                    )
                elif action == "conversation.list":
                    await reply(
                        "conversation.list",
                        request_id,
                        {"conversations": self.project_store.list_conversations()},
                    )
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
                    await reply(
                        "conversation.saved",
                        request_id,
                        {
                            "conversation": conversation,
                            "conversations": self.project_store.list_conversations(),
                        },
                    )
                elif action == "conversation.content":
                    conv = self.project_store.conversations.get(run_id_of(data))
                    if conv is None:
                        await fail(request_id, "Conversation not found")
                        return
                    await reply(
                        "conversation.content",
                        request_id,
                        {
                            "id": conv["id"],
                            "title": conv.get("title") or "",
                            "projectId": conv.get("projectId"),
                            "content": conv.get("content") or [],
                        },
                    )
                elif action == "conversation.delete":
                    if not self.project_store.delete_conversation(run_id_of(data)):
                        await fail(request_id, "Conversation not found")
                        return
                    await reply(
                        "conversation.deleted",
                        request_id,
                        {"conversations": self.project_store.list_conversations()},
                    )
                elif action == "ask.answer":
                    # ask 工具回答: 把 UI 的答复投递给阻塞中的 ask() 等待者
                    ask_id = _clip(data.get("id"), 64).strip()
                    try:
                        ok = _agent_tools_module().ASK.answer(
                            ask_id, data.get("answers")
                        )
                    except Exception:
                        ok = False
                    if ok:
                        await reply("ask.answer.ack", request_id, {"id": ask_id})
                    else:
                        await fail(request_id, "问题已失效或已被回答")
                elif action == "chat.stop":
                    # 置位停止标记, 流式循环会在收尾时补发 chat.done
                    if request_id in chat_stops:
                        chat_stops[request_id] = True
                    # 未回答的 ask 一并取消, 让阻塞的工具线程立刻返回
                    for ask_id in chat_asks.pop(request_id, ()) or ():
                        try:
                            _agent_tools_module().ASK.cancel(ask_id)
                        except Exception:
                            pass
                    await reply("chat.stop.ack", request_id, {"stopped": True})
                elif action == "chat.send":
                    try:
                        base_url, api_key, model_name = _resolve_chat(
                            self.model_store, data.get("modelId")
                        )
                    except HTTPException as err:
                        await fail(request_id, err.detail)
                        return
                    messages = [
                        m for m in (data.get("messages") or []) if isinstance(m, dict)
                    ]
                    if not messages:
                        await fail(request_id, "消息列表为空")
                        return
                    conv_ref = (
                        self.project_store.conversations.get(data.get("runId") or "")
                        or {}
                    )
                    effective_pid = data.get("projectId") or conv_ref.get("projectId")
                    chat_workdir = self.project_store.projects.get(
                        effective_pid or "", {}
                    ).get("dir")
                    # 同一 requestId 重发前先复位停止标记
                    chat_stops[request_id] = False

                    # 工作线程阻塞产出事件, 经线程安全回调投递回队列
                    async def stream_chat() -> None:
                        loop = asyncio.get_running_loop()
                        chat_queue: asyncio.Queue = asyncio.Queue()
                        content: list = []
                        stats: dict = {}
                        closed = False

                        # 事件元组 (kind, value): delta/think/tool/done/error
                        def work():
                            def on_tool_wrap(ev):
                                # ask 轮次: 记录 id 供停止/断开时取消;
                                # isAsk 标记让前端在工具被改名时也能识别 ask 卡片
                                if isinstance(ev, dict) and ev.get("kind") in (
                                    "call",
                                    "result",
                                ):
                                    base = _TOOL_ALIASES.get(
                                        ev.get("name"), ev.get("name")
                                    )
                                    if base == "ask":
                                        ev["isAsk"] = True
                                if (
                                    isinstance(ev, dict)
                                    and ev.get("kind") == "ask"
                                    and ev.get("id")
                                ):
                                    chat_asks.setdefault(request_id, set()).add(
                                        ev["id"]
                                    )
                                loop.call_soon_threadsafe(
                                    chat_queue.put_nowait, ("tool", ev)
                                )

                            try:
                                _stream_agent_chat(
                                    base_url,
                                    api_key,
                                    model_name,
                                    messages,
                                    lambda d: loop.call_soon_threadsafe(
                                        chat_queue.put_nowait, ("delta", d)
                                    ),
                                    lambda t: loop.call_soon_threadsafe(
                                        chat_queue.put_nowait, ("think", t)
                                    ),
                                    on_tool_wrap,
                                    lambda r: loop.call_soon_threadsafe(
                                        chat_queue.put_nowait, ("retry", r)
                                    ),
                                    stats,
                                    chat_workdir,
                                    bool(data.get("planMode")),
                                )
                                loop.call_soon_threadsafe(
                                    chat_queue.put_nowait, ("done", None)
                                )
                            except Exception as err:
                                loop.call_soon_threadsafe(
                                    chat_queue.put_nowait, ("error", str(err))
                                )

                        # to_thread 在默认执行器中运行 work, 不阻塞事件循环
                        worker = asyncio.create_task(asyncio.to_thread(work))
                        while not closed:
                            if chat_stops.get(request_id):
                                # 客户端请求停止: 直接补发 chat.done(stopped=true)
                                closed = True
                                try:
                                    await ws.send_json(
                                        {
                                            "event": "chat.done",
                                            "requestId": request_id,
                                            "data": {
                                                "content": "".join(content),
                                                "stopped": True,
                                            },
                                        }
                                    )
                                except Exception:
                                    pass
                                break
                            # 等下一轮模型时队列可能长时间无事件, 若无限阻塞在 get(),
                            # 停止标记就永远得不到检查; 用短超时让循环有机会轮询停止。
                            try:
                                kind, value = await asyncio.wait_for(
                                    chat_queue.get(), timeout=0.5
                                )
                            except asyncio.TimeoutError:
                                continue
                            if kind == "delta":
                                content.append(value)
                                event, message = (
                                    "chat.delta",
                                    {
                                        "event": "chat.delta",
                                        "requestId": request_id,
                                        "data": {"delta": value},
                                    },
                                )
                            elif kind == "think":
                                event, message = (
                                    "chat.think",
                                    {
                                        "event": "chat.think",
                                        "requestId": request_id,
                                        "data": {"delta": value},
                                    },
                                )
                            elif kind == "tool":
                                event, message = (
                                    "chat.tool",
                                    {
                                        "event": "chat.tool",
                                        "requestId": request_id,
                                        "data": {"tool": value},
                                    },
                                )
                            elif kind == "retry":
                                event, message = (
                                    "chat.retry",
                                    {
                                        "event": "chat.retry",
                                        "requestId": request_id,
                                        "data": {"retry": value},
                                    },
                                )
                            elif kind == "done":
                                event, message = (
                                    "chat.done",
                                    {
                                        "event": "chat.done",
                                        "requestId": request_id,
                                        "data": {
                                            "content": "".join(content),
                                            "tokens": stats.get("completion_tokens")
                                            or 0,
                                            "promptTokens": stats.get("prompt_tokens")
                                            or 0,
                                        },
                                    },
                                )
                            else:
                                event, message = (
                                    "error",
                                    {
                                        "event": "error",
                                        "requestId": request_id,
                                        "data": {"error": value},
                                    },
                                )
                            try:
                                await ws.send_json(message)
                            except Exception:
                                # 发送失败一般意味着客户端已断开
                                # 置位 closed 以退出循环并回收工作线程
                                closed = True
                            if event in ("chat.done", "error"):
                                break
                        await worker
                        chat_stops.pop(request_id, None)
                        # 流结束(含停止后的收尾)时取消该请求残留的未答 ask
                        for ask_id in chat_asks.pop(request_id, ()) or ():
                            try:
                                _agent_tools_module().ASK.cancel(ask_id)
                            except Exception:
                                pass

                    # 流式任务与请求解耦: handle 立即返回, 事件异步推送
                    # 停止通过 chat_stops 轮询生效, 不强杀工作线程
                    # 任务句柄收进 chat_tasks, 服务退出时统一取消
                    chat_task = asyncio.create_task(stream_chat())
                    chat_tasks.add(chat_task)
                    chat_task.add_done_callback(chat_tasks.discard)
                elif action == "pty.open":
                    project_id = str(data.get("projectId") or data.get("id") or "")[:64]
                    project_entry = self.project_store.projects.get(project_id or "")
                    basedir = str((project_entry or {}).get("dir") or "").strip()
                    if not basedir or not os.path.isdir(basedir):
                        await fail(
                            request_id, "项目未配置本地目录，先在项目设置里填写路径"
                        )
                        return
                    key = _pty_key_of(project_id)
                    _pty_detach_all()
                    session = _pty_get(project_id)
                    if session is None:
                        if len(self._pty_sessions) >= _PTY_SESSIONS_MAX:
                            victim = min(
                                self._pty_sessions.items(),
                                key=lambda kv: kv[1].created,
                            )
                            victim_key, victim_session = victim
                            try:
                                victim_session.kill()
                            except Exception:
                                pass
                            self._pty_sessions.pop(victim_key, None)
                        try:
                            # 与 resize 同范围收敛: 非法值会让 ioctl/struct 抛出未捕获异常
                            cols = max(2, min(500, int(data.get("cols") or 90)))
                            rows = max(1, min(300, int(data.get("rows") or 28)))
                        except Exception:
                            cols, rows = 90, 28
                        session = _PtySession(key, basedir, cols=cols, rows=rows)
                        self._pty_sessions[key] = session
                    snapshot, _seq = session.subscribe(
                        asyncio.get_running_loop(), pty_queue
                    )
                    pty_attached[key] = pty_queue
                    if not self._pty_exit_hook_done:
                        self._pty_exit_hook_done = True
                        atexit.register(_pty_shutdown_all)
                    if snapshot:
                        try:
                            await ws.send_bytes(snapshot)
                        except Exception:
                            return
                    await reply(
                        "pty.opened",
                        request_id,
                        {
                            "projectId": project_id,
                            "cwd": basedir,
                            "cols": session.cols,
                            "rows": session.rows,
                        },
                    )
                elif action == "pty.input":
                    project_id = str(data.get("projectId") or data.get("id") or "")[:64]
                    session = _pty_get(project_id)
                    if session is None:
                        await fail(request_id, "终端会话已退出")
                        return
                    px_payload = data.get("data")
                    if isinstance(px_payload, str) and len(px_payload) <= 8192:
                        session.write(px_payload.encode("utf-8", "replace"))
                    await reply("pty.input", request_id)
                elif action == "pty.resize":
                    project_id = str(data.get("projectId") or data.get("id") or "")[:64]
                    session = _pty_get(project_id)
                    if session is None:
                        await fail(request_id, "终端会话已退出")
                        return
                    try:
                        session.resize(
                            int(data.get("cols") or 0), int(data.get("rows") or 0)
                        )
                    except Exception:
                        pass
                    await reply("pty.resize", request_id)
                elif action == "pty.kill":
                    project_id = str(data.get("projectId") or data.get("id") or "")[:64]
                    key = _pty_key_of(project_id)
                    _pty_detach_all()
                    session = self._pty_sessions.pop(key, None)
                    if session is not None:
                        try:
                            session.kill()
                        except Exception:
                            pass
                    await reply("pty.kill", request_id)
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
                        await ws.send_json(
                            {"event": "error", "data": {"error": "Invalid JSON format"}}
                        )
                        continue
                    if message.get("action") == "ws.close":
                        # 客户端主动退出: 记录并结束本连接
                        _LOGGER_WS.info(
                            "[ws] client close requested: %r", message.get("reason")
                        )
                        await ws.close(code=1000)
                        break
                    if pump is None:
                        pump = asyncio.create_task(_push_loop(ws, queue))
                    if pty_pump is None:
                        pty_pump = asyncio.create_task(_pty_pump_loop())
                    await handle(message)
            except WebSocketDisconnect as disconnect_ev:
                # 记录断开码/原因: 便于与 Caddy、节点前缀代理的断开时间对账定位掐断方
                _LOGGER_WS.info(
                    "[ws] disconnected code=%s reason=%r",
                    disconnect_ev.code,
                    disconnect_ev.reason,
                )
            finally:
                if pump:
                    pump.cancel()
                if pty_pump:
                    pty_pump.cancel()
                _pty_detach_all()
                for task in chat_tasks:
                    task.cancel()
                # 连接断开: 所有未回答的 ask 都失效, 让阻塞的工具线程返回
                for ask_ids in chat_asks.values():
                    for ask_id in ask_ids or ():
                        try:
                            _agent_tools_module().ASK.cancel(ask_id)
                        except Exception:
                            pass
                chat_asks.clear()
                for run_id in subscribed:
                    self.manager.unsubscribe(run_id, queue)


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


class _FsExecIn(BaseModel):
    projectId: str = ""
    cmd: str = Field(min_length=1, max_length=8000)
    cwd: str = Field(default="", max_length=2000)


class _FsUploadIn(BaseModel):
    projectId: str = ""
    name: str = Field(min_length=1, max_length=200)
    dataBase64: str = Field(min_length=4, max_length=46_000_000)


class ChatIn(BaseModel):
    modelId: Optional[str] = None
    projectId: Optional[str] = None
    runId: Optional[str] = None
    messages: list = []
    planMode: Optional[bool] = None


class _AuthCredentials(BaseModel):
    username: str = ""
    password: str = ""


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
            json.dumps(
                {"projects": self.projects, "conversations": self.conversations},
                ensure_ascii=False,
                indent=2,
            ),
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
            "dir": project.get("dir"),
            "createdAt": project.get("createdAt"),
            "updatedAt": project.get("updatedAt"),
        }

    def list_projects(self) -> list:
        # 最近活动优先排序: 取项目自身更新时间与项目下未归档会话的最新时间中的较大者。
        # 新建的项目 updatedAt 最新, 自然排最上; 老项目有新对话时同样被顶到最上方。
        latest: dict[str, Any] = {}
        for conv in self.conversations.values():
            pid = conv.get("projectId")
            if pid and not conv.get("archived"):
                latest[pid] = max(latest.get(pid, 0), conv.get("updatedAt") or 0)
        projects = [self._public_project(p) for p in self.projects.values()]
        projects.sort(
            key=lambda p: max(p.get("updatedAt") or 0, latest.get(p["id"], 0)),
            reverse=True,
        )
        return projects

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
        project["dir"] = _clip(payload.dir, 500) if payload.dir else None
        self._ensure_project_dir(project["dir"])
        project["updatedAt"] = now
        self._save()
        return self._public_project(project)

    def _ensure_project_dir(self, dirpath) -> None:
        """Create the project folder when saving, so terminal and fs open work."""
        if not dirpath or os.path.isdir(dirpath):
            return
        try:
            os.makedirs(dirpath, exist_ok=True)
        except OSError:
            pass  # fs/timeout turns later report the unusable path explicitly

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
        if (
            payload.id
            and payload.id not in self.conversations
            and not self._valid_id(payload.id)
        ):
            raise HTTPException(status_code=400, detail="Invalid conversation id")
        conv = self.conversations.get(payload.id or "")
        if conv is None:
            conv = {
                "id": payload.id or f"cn-{uuid.uuid4().hex[:12]}",
                "createdAt": now,
            }
            self.conversations[conv["id"]] = conv
        conv["title"] = _clip(payload.title, 300) or "新会话"
        conv["projectId"] = (
            payload.projectId
            if payload.projectId and payload.projectId in self.projects
            else None
        )
        if payload.pinned is not None:
            conv["pinned"] = bool(payload.pinned)
        elif "pinned" not in conv:
            conv["pinned"] = False
        if payload.archived is not None:
            conv["archived"] = bool(payload.archived)
        elif "archived" not in conv:
            conv["archived"] = False
        if payload.content:
            keep = []
            for msg in payload.content[-100:]:
                if not isinstance(msg, dict):
                    continue
                item: dict[str, Any] = {
                    "role": _clip(str(msg.get("role", "")), 16),
                    "content": _clip(str(msg.get("content", "")), 20000),
                }
                # 保留思考与工具调用记录, 便于前端回放
                # 每条消息截断到固定长度, 防止历史无限膨胀
                reasoning = msg.get("reasoning")
                if isinstance(reasoning, str) and reasoning.strip():
                    item["reasoning"] = _clip(reasoning, 20000)
                tools = msg.get("tools")
                if isinstance(tools, list):
                    saved_tools = []
                    for t in tools:
                        if not isinstance(t, dict):
                            continue
                        saved_tools.append(
                            {
                                "name": _clip(str(t.get("name", "")), 200),
                                "args": t.get("args")
                                if isinstance(t.get("args"), (dict, list))
                                else {},
                                "result": _clip(str(t.get("result", "")), 5000),
                            }
                        )
                    if saved_tools:
                        item["tools"] = saved_tools
                deliverables = msg.get("deliverables")
                if isinstance(deliverables, list):
                    # 本轮产出文件(dsh deliverables 思路): edit/write 的参数位置记录
                    saved_files = []
                    for d in deliverables[:40]:
                        if not isinstance(d, dict):
                            continue
                        _path = _clip(str(d.get("path", "")), 500)
                        if not _path:
                            continue
                        saved_files.append(
                            {"path": _path, "op": _clip(str(d.get("op", "")), 16)}
                        )
                    if saved_files:
                        item["deliverables"] = saved_files
                if msg.get("tokens") is not None:
                    item["tokens"] = msg.get("tokens")
                if msg.get("promptTokens") is not None:
                    item["promptTokens"] = msg.get("promptTokens")
                if msg.get("model"):
                    item["model"] = _clip(str(msg.get("model")), 120)
                if msg.get("at"):
                    item["at"] = _clip(str(msg.get("at")), 40)
                if msg.get("error") is not None:
                    _err = msg.get("error")
                    if isinstance(_err, dict):
                        item["error"] = {
                            "message": _clip(str(_err.get("message", "")), 2000),
                            "detail": _clip(str(_err.get("detail", "")), 20000),
                        }
                    else:
                        item["error"] = {"message": _clip(str(_err), 2000)}
                if msg.get("elapsed") is not None:
                    item["elapsed"] = msg.get("elapsed")
                asks = msg.get("asks")
                if isinstance(asks, list):
                    # ask 交互记录: 问题与用户答复一并回放
                    saved_asks = []
                    for a in asks:
                        if not isinstance(a, dict):
                            continue
                        questions = (
                            a.get("questions")
                            if isinstance(a.get("questions"), list)
                            else []
                        )
                        if not questions:
                            continue
                        answers = []
                        if isinstance(a.get("answers"), list):
                            # 结构化用户答复: 供折叠卡展开态回放选中项与自定义文本
                            for ans in a["answers"][:20]:
                                if not isinstance(ans, dict):
                                    continue
                                answers.append(
                                    {
                                        "id": _clip(str(ans.get("id", "")), 64),
                                        "selected": [
                                            _clip(str(s), 300)
                                            for s in (ans.get("selected") or [])[:12]
                                        ],
                                        "custom": _clip(
                                            str(ans.get("custom") or ""), 2000
                                        ),
                                    }
                                )
                        saved_asks.append(
                            {
                                "id": _clip(str(a.get("id", "")), 64),
                                "questions": questions[:20],
                                "answered": bool(a.get("answered")),
                                "result": _clip(str(a.get("result", "")), 5000),
                                **({"answers": answers} if answers else {}),
                            }
                        )
                    if saved_asks:
                        item["asks"] = saved_asks
                keep.append(item)
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

    def set_title(self, conversation_id: str, title: str) -> dict | None:
        """LLM 生成的会话标题落地(dsh session-title-llm 思路: 失败保留兜底)。"""
        conv = self.conversations.get(conversation_id)
        if conv is None:
            return None
        conv["title"] = _clip(title, 300)
        conv["updatedAt"] = int(time.time() * 1000)
        self._save()
        return self._public_conversation(conv)


def _append_jsonl(path: Path, record: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(record, ensure_ascii=False) + "\n")


def _resolve_chat(model_store, model_id: Optional[str]):
    """modelId -> (baseUrl, apiKey, model_name). Raises HTTPException."""
    models = list(model_store.models.values())
    model = model_store.models.get(model_id or "")
    if model is None:
        model = next((m for m in models if m.get("isDefault")), None) or (
            models[0] if models else None
        )
    if model is None:
        raise HTTPException(
            status_code=400, detail="尚未配置模型，请先在设置中添加模型"
        )
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


# 计划模式提示词(dsh plan-mode 思路): 只探查不落盘, 末尾产 <plan> 块供前端渲染审核卡
_PLAN_MODE_PROMPT = (
    "\n\n# Plan mode\n"
    "You are in plan mode: the user wants you to explore and design first.\n"
    "- Use read-only actions only (read/grep/ls, non-mutating bash); do NOT call "
    "write/edit or run commands that modify files.\n"
    "- If information is missing, ask the user concise questions before planning.\n"
    "- At the END of your reply, output the final plan inside a single "
    "<plan>...</plan> block: goal, numbered concrete steps, files to touch, and risks. "
    "Keep the plan in the user's language.\n"
    "- Do NOT start executing the plan. Wait for the user's explicit approval.\n"
)


def _run_agent_chat(
    base_url: str,
    api_key: str,
    model_name: str,
    messages: list,
    on_delta=None,
    on_reasoning=None,
    on_tool=None,
    on_retry=None,
    stats: dict | None = None,
    workdir: Optional[str] = None,
    plan_mode: bool = False,
) -> str:
    """Run a chat through the SigmaFlow agent/agent.Agent stack.

    Builds an Agent (openai-compatible method) against the configured
    provider, prepends the agent system prompt, and returns the final
    assistant text. Tool/MCP/skill support is enabled: tools execute on
    this server (bash, file IO, MCP servers, load_skill).
    """
    agent_module = _agent_agent_module()
    Agent = agent_module.Agent

    tools_mod = _agent_tools_module()
    tools_mod.set_session_workdir(workdir)

    raw = [
        {"role": m.get("role"), "content": m.get("content", "")}
        for m in messages
        if m.get("role") in ("user", "assistant")
    ]
    # 压缩契约: 界面保留全部历史, 但最后一处压缩摘要卡之前的内容不再发送,
    # 由卡内摘要开场(pi CompactionEntry 语义); 旧卡内容已随迭代并入最新摘要
    marker = getattr(
        _agent_tools_module(), "_COMPACT_MARKER", "[Conversation compressed"
    )
    card_idx = -1
    for i, m in enumerate(raw):
        if str(m.get("content", "")).startswith(marker):
            card_idx = i
    convo = (
        [
            {"role": "user", "content": str(raw[card_idx].get("content") or "")},
            *raw[card_idx + 1 :],
        ]
        if card_idx >= 0
        else raw
    )
    logging.getLogger("uvicorn.error").info(
        "contract: raw=%d card_idx=%d convo=%d est=%d",
        len(raw),
        card_idx,
        len(convo),
        sum(len(str(m.get("content") or "")) for m in convo),
    )
    # 仅保留 user/assistant 两类角色, 其余消息直接丢弃
    # 轮次上限按助手消息数加预留余量, 防止无限循环
    max_turn = max(1, sum(1 for m in convo if m["role"] == "assistant") + 17)
    system, sub_system = _effective_system_prompts()
    sub_system = (
        re.sub(
            r"(subagent at )\S+",
            lambda mo: mo.group(1) + (workdir or mo.group(0)),
            sub_system,
            count=1,
        )
        if workdir
        else sub_system
    )
    bound_system = system
    if workdir:
        # 内置提示词首句形如 "You are a ... agent at <服务进程 cwd>", 会覆盖末尾的
        # 项目目录说明; 先把这类句子里的路径改写为会话工作目录, 再附加显式说明。
        bound_system = re.sub(
            r"(agent at )\S+", lambda mo: mo.group(1) + workdir, f"{system}", count=1
        )
        bound_system = (
            f"{bound_system}"
            "\n\n# 工作目录\n本次会话绑定项目工作目录 `{workdir}`。"
            "bash 命令、文件读写与数据处理的相对路径都相对该目录执行；"
            "向用户答复时必须以该目录为当前工作目录。"
        )
    if plan_mode:
        bound_system = bound_system + _PLAN_MODE_PROMPT
    agent = Agent(
        method="openai",
        model=model_name,
        base_url=base_url,
        api_key=api_key or "sk-empty",
        support_tool=True,
        retry=3,  # 模型请求失败/超时重试三次, SDK 内部重试关闭避免叠加
        max_turn=max_turn,
        tools=_effective_agent_tools(),
        system=bound_system,
        sub_system=sub_system,
        on_delta=_make_chat_delta_callback(on_delta, on_reasoning),
        on_tool=on_tool,
        on_retry=on_retry,
    )
    agent.client.timeout = 90
    agent.client.max_retries = 0  # 不用 SDK 内置重试; 统一由 agent 循环重试三次
    _apply_compaction_to(agent)  # 设置面板的压缩参数即时生效
    info = agent(convo, is_print=False, max_turn=max_turn)
    try:
        if stats is not None and isinstance(info, dict):
            # 回填本次请求的 token 用量, 供 /chat 返回统计
            stats["completion_tokens"] = info.get("completion_tokens") or 0
            stats["prompt_tokens"] = info.get("prompt_tokens") or 0
            # 自动压缩元数据回传: HTTP 降级路径没有 on_tool 事件流,
            # 前端靠响应里的 compaction.text 插摘要卡, 下轮请求契约才会按卡收窄;
            # WS 通道的卡经 on_tool kind=compact 推送, done 里不透传避免双插
            cmeta = getattr(agent.compactor, "last_meta", None)
            if cmeta and isinstance(cmeta, dict) and cmeta.get("applied"):
                stats["compaction"] = {
                    "removed": cmeta.get("removed"),
                    "kept": cmeta.get("kept"),
                    "tokensBefore": cmeta.get("tokens_before"),
                    "transcript": cmeta.get("transcript"),
                    "text": cmeta.get("text"),
                }
        last = info["last_response"] if isinstance(info, dict) else None
    finally:
        tools_mod.set_session_workdir(None)

    if not last:
        raise RuntimeError("模型没有返回内容")
    if isinstance(last, str):
        return last

    choice = getattr(last, "choices", None)
    if choice:
        return choice[0].message.content or ""
    content = getattr(last, "content", None)
    if isinstance(content, list):
        return "".join(getattr(b, "text", "") for b in content)
    return str(content or "")


_AGENT_CONTEXT_SIZES: Dict[str, int] = {}


def _sigma_usage(conversations: Dict[str, dict]) -> Dict[str, object]:
    """Aggregate SigmaFlow's own token usage from persisted conversations.

    Each assistant message may carry tokens (completion), promptTokens (input)
    and an ISO timestamp; the result mirrors the usage payload shape the
    settings card expects (days/models/sessions/streaks), minus fields
    SigmaFlow has no data for (cache read/write, per-model cost).
    """
    from datetime import date, datetime, timedelta, timezone

    day_stats: Dict[str, dict] = {}
    model_stats: Dict[str, dict] = {}
    session_rows: list = []
    total_in = total_out = 0
    total_cost = 0.0
    total_sessions = 0
    longest_session_ms = 0
    pricing_cache: Dict[str, tuple] = {}

    def _price(model_name: str) -> tuple:
        """(input, output) USD/token for a message model name, cached."""
        if model_name not in pricing_cache:
            entry = _litellm_lookup(model_name)
            pricing_cache[model_name] = _model_pricing(entry)
        return pricing_cache[model_name]

    def _msg_cost(model_name: str, prompt_tokens: int, completion_tokens: int) -> float:
        """Cost of one assistant message: LiteLLM's official API first, price table as fallback."""
        official = _litellm_message_cost(model_name, prompt_tokens, completion_tokens)
        if official is not None:
            return official
        pin, pout = _price(model_name)
        return prompt_tokens * pin + completion_tokens * pout

    def _ms(conv_msg_at) -> int:
        """ISO 字符串转 epoch 毫秒; 非法值回退 0。"""
        if not conv_msg_at or not isinstance(conv_msg_at, str):
            return 0
        try:
            dt = datetime.fromisoformat(conv_msg_at.replace("Z", "+00:00"))
            return int(dt.timestamp() * 1000)
        except Exception:
            return 0

    for conv in conversations.values():
        content = conv.get("content") or []
        first_ms = last_ms = 0
        conv_in = conv_out = 0
        conv_cost = 0.0
        conv_models: set = set()
        has_usage = False
        for msg in content:
            if msg.get("role") != "assistant":
                if not first_ms and msg.get("at"):
                    first_ms = _ms(msg.get("at"))
                continue
            at_ms = _ms(msg.get("at"))
            if at_ms:
                if not last_ms or at_ms > last_ms:
                    last_ms = at_ms
            tokens = msg.get("tokens") or 0
            prompt = msg.get("promptTokens") or 0
            if not tokens and not prompt:
                continue
            has_usage = True
            conv_in += prompt
            conv_out += tokens
            model = (msg.get("model") or "").strip() or "未记录"
            conv_models.add(model)
            cost = _msg_cost(model, prompt, tokens)
            day_key = (msg.get("at") or "")[:10]
            if not day_key:
                day_key = str(date.today())
            day = day_stats.setdefault(
                day_key,
                {
                    "inputTokens": 0,
                    "outputTokens": 0,
                    "totalTokens": 0,
                    "costUsd": 0.0,
                    "sessions": set(),
                },
            )
            day["inputTokens"] += prompt
            day["outputTokens"] += tokens
            day["totalTokens"] += prompt + tokens
            day["costUsd"] += cost
            day["sessions"].add(conv["id"])
            m = model_stats.setdefault(
                model,
                {
                    "inputTokens": 0,
                    "outputTokens": 0,
                    "totalTokens": 0,
                    "costUsd": 0.0,
                    "sessions": set(),
                },
            )
            m["inputTokens"] += prompt
            m["outputTokens"] += tokens
            m["totalTokens"] += prompt + tokens
            m["costUsd"] += cost
            m["sessions"].add(conv["id"])
            conv_cost = conv_cost + cost
        if has_usage:
            total_in += conv_in
            total_out += conv_out
            total_cost += conv_cost
            total_sessions += 1
            duration = max(0, last_ms - first_ms) if first_ms and last_ms else 0
            longest_session_ms = max(longest_session_ms, duration)
            session_rows.append(
                {
                    "sessionId": conv.get("id") or "",
                    "title": conv.get("title") or "",
                    "startMs": first_ms,
                    "endMs": last_ms,
                    "durationMs": duration,
                    "inputTokens": conv_in,
                    "outputTokens": conv_out,
                    "totalTokens": conv_in + conv_out,
                    "costUsd": round(conv_cost, 6),
                    "models": sorted(conv_models) if conv_models else [],
                }
            )

    days = sorted(
        (
            {
                "date": key,
                "inputTokens": v["inputTokens"],
                "outputTokens": v["outputTokens"],
                "totalTokens": v["totalTokens"],
                "sessions": len(v["sessions"]),
                "costUsd": round(v["costUsd"], 6),
            }
            for key, v in day_stats.items()
        ),
        key=lambda x: x["date"],
    )

    def _longest_streak(day_keys: list) -> int:
        """历史最长连续有用量天数: 相邻日期逐段累计。"""
        ds = sorted(set(day_keys))
        if not ds:
            return 0
        best = run = 1
        for prev, cur in zip(ds, ds[1:]):
            if (date.fromisoformat(cur) - date.fromisoformat(prev)).days == 1:
                run += 1
            else:
                run = 1
            best = max(best, run)
        return best

    def _current_streak(day_keys: list) -> int:
        """当前连续天数: 从今天(或昨天)往回连续有用量的天数。"""
        days_set = set(day_keys)
        cur = date.today()
        if str(cur) not in days_set:
            cur -= timedelta(days=1)
        streak = 0
        while str(cur) in days_set:
            streak += 1
            cur -= timedelta(days=1)
        return streak

    day_keys = [d["date"] for d in days]
    peak = max(days, key=lambda x: x["totalTokens"]) if days else None
    return {
        "totalInputTokens": total_in,
        "totalOutputTokens": total_out,
        "totalTokens": total_in + total_out,
        "totalSessions": total_sessions,
        "totalCostUsd": round(total_cost, 4),
        "longestSessionMs": longest_session_ms,
        "currentStreakDays": _current_streak(day_keys),
        "longestStreakDays": _longest_streak(day_keys),
        "peakDay": peak,
        "days": days,
        "models": [
            {
                "model": name,
                "inputTokens": v["inputTokens"],
                "outputTokens": v["outputTokens"],
                "totalTokens": v["totalTokens"],
                "sessions": len(v["sessions"]),
                "costUsd": round(v["costUsd"], 6),
            }
            for name, v in sorted(
                model_stats.items(), key=lambda kv: -(kv[1]["totalTokens"])
            )
        ],
        "sessions": sorted(session_rows, key=lambda x: -(x["endMs"] or x["startMs"]))[
            :30
        ],
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "user": "sigmaflow",
        "version": "sigmaflow-1.0",
    }


def _agent_context_sizes() -> Dict[str, int]:
    """Estimate the token cost of the agent's fixed request overhead:
    the system prompt and the (OpenAI-format) tool definitions.

    Rebuilds the exact payloads `_run_agent_chat` sends (method=openai,
    support_tool=True) and estimates tokens from character counts. The
    divisor was calibrated against real glm-5.3 usage numbers (a full
    fresh-request overhead of ~2780 prompt tokens).
    """
    if _AGENT_CONTEXT_SIZES:
        return _AGENT_CONTEXT_SIZES
    agent_module = _agent_agent_module()
    Agent = agent_module.Agent

    system, sub_system = _effective_system_prompts()
    agent = Agent(
        method="openai",
        model="estimate",
        base_url="http://127.0.0.1:9/v1",
        api_key="sk-empty",
        support_tool=True,
        tools=_effective_agent_tools(),
        system=system,
        sub_system=sub_system,
    )
    tools_wire = json.dumps(agent.tools, ensure_ascii=False, separators=(",", ":"))
    sizes = {
        "systemTokens": math.ceil(len(agent.system) / 3.7),
        "toolsTokens": math.ceil(len(tools_wire) / 3.7),
    }
    _AGENT_CONTEXT_SIZES.update(sizes)
    return sizes


def _stream_agent_chat(
    base_url: str,
    api_key: str,
    model_name: str,
    messages: list,
    on_delta,
    on_reasoning=None,
    on_tool=None,
    on_retry=None,
    stats: dict | None = None,
    workdir: Optional[str] = None,
    plan_mode: bool = False,
):
    """Streaming chat. Runs synchronously on the caller's worker thread
    (the WS handler invokes it via asyncio.to_thread); on_delta is called
    on this same thread and forwarded into the asyncio queue by the
    caller with loop.call_soon_threadsafe."""
    return _run_agent_chat(
        base_url,
        api_key,
        model_name,
        messages,
        on_delta=on_delta,
        on_reasoning=on_reasoning,
        on_tool=on_tool,
        on_retry=on_retry,
        stats=stats,
        workdir=workdir,
        plan_mode=plan_mode,
    )


async def _auth_http(request: Request) -> None:
    """Router-wide guard: resolve the request user for multi-user mode.

    In single-user mode every request runs as the service OS account, which
    keeps the historical behaviour of a shared workspace. Multi-user mode
    accepts only logged-in users; everything under /api except /health and
    the /auth endpoints requires a valid session cookie.
    """
    if not _multi_user():
        _CURRENT_USER.set(_os_user())
        return
    scope_type = request.scope.get("type")
    if scope_type == "websocket":
        # WebSocket 握手在 endpoint 内自行校验 cookie 并设置上下文。
        return
    if scope_type != "http" or request.url.path == "/api/health":
        return
    user = _cookie_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="未登录")
    _CURRENT_USER.set(user)
    _ensure_user_data(user)


def _check_origin(request: Request):
    """Same-origin write policy, mirroring the demo server contract."""
    origin = request.headers.get("origin")
    host = request.headers.get("host", "")
    if origin and origin not in (f"http://{host}", f"https://{host}"):
        raise HTTPException(
            status_code=403,
            detail="Cross-origin writes are disabled in the demo server",
        )


# ==================== 系统状态面板 ====================
# 全局缓存: 网速上次采样与 GPU 最近一次查询结果
# nvidia-smi 结果缓存 5 秒, 避免每次 /system 请求都 fork 子进程
# 网速按两次请求间隔内的计数差值估算
# 首次请求没有基准, 网速恒为 0
_sys_state: Dict[str, Any] = {"net": None, "gpu_at": 0.0, "gpu": None}


def _gpu_stats() -> list:
    """nvidia-smi 查询 GPU 利用率/显存; 不可用时静默返回空列表(结果缓存 5s)。"""
    now = time.time()
    if _sys_state["gpu"] is not None and now - _sys_state["gpu_at"] < 5:
        return _sys_state["gpu"]
    gpus: list = []
    try:
        import subprocess

        out = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=name,utilization.gpu,memory.used,memory.total",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=3,
            check=True,
        ).stdout
        for line in out.strip().splitlines():
            parts = [p.strip() for p in line.split(",")]
            if len(parts) == 4:
                gpus.append(
                    {
                        "name": parts[0],
                        "usage": float(parts[1]),
                        "mem_used_gb": round(float(parts[2]) / 1024, 1),
                        "mem_total_gb": round(float(parts[3]) / 1024, 1),
                    }
                )
    except Exception:
        gpus = []
    _sys_state["gpu"], _sys_state["gpu_at"] = gpus, now
    return gpus


def _system_stats() -> Dict[str, Any]:
    """Chat 页状态栏数据: 系统 / CPU / 内存 / 磁盘 / GPU / 网速。"""
    import platform
    import psutil

    # 发行版名称优先取 PRETTY_NAME
    # 读取失败时保留 uname 兜底
    os_name = f"{platform.system()} {platform.release()}"
    try:
        with open("/etc/os-release", encoding="utf-8") as fh:
            for line in fh:
                if line.startswith("PRETTY_NAME="):
                    os_name = line.split("=", 1)[1].strip().strip('"')
                    break
    except Exception:
        pass
    # CPU 型号取自 /proc/cpuinfo
    # 缺文件时保留空串
    cpu_model = ""
    try:
        with open("/proc/cpuinfo", encoding="utf-8") as fh:
            for line in fh:
                if line.startswith("model name"):
                    cpu_model = line.split(":", 1)[1].strip()
                    break
    except Exception:
        pass
    # 磁盘统计指向数据目录, /data 作为常见数据盘一并展示
    # 同一设备只统计一次
    disk_path = os.environ.get("SIGMAFLOW_SCIENCE_DIR") or os.path.join(
        os.path.expanduser("~"), ".sigmaflow", "science"
    )
    disks: list = []
    disk = {"used_gb": 0, "total_gb": 0, "percent": 0, "path": disk_path}
    seen_devs: set = set()
    for path in (disk_path, "/data"):
        try:
            du = psutil.disk_usage(path)
            dev = os.stat(path).st_dev
            if dev in seen_devs:
                continue
            seen_devs.add(dev)
            disks.append(
                {
                    "used_gb": round(du.used / 2**30, 1),
                    "total_gb": round(du.total / 2**30, 1),
                    "percent": du.percent,
                    "path": path,
                }
            )
        except Exception:
            continue
    if disks:
        disk = disks[0]
    # 无可用磁盘统计时使用零值占位
    # 网速按两次采样差值估算
    up_bps = down_bps = 0.0
    net = psutil.net_io_counters()
    prev = _sys_state.get("net")
    if prev:
        dt = time.time() - prev[0]
        if dt > 0:
            up_bps = max(0, net.bytes_sent - prev[1].bytes_sent) / dt
            down_bps = max(0, net.bytes_recv - prev[1].bytes_recv) / dt
    _sys_state["net"] = (time.time(), net)
    # 快照存入全局状态, 供下次计算差值
    vm = psutil.virtual_memory()
    return {
        "os": os_name,
        "cpu": {
            "model": cpu_model,
            "cores": psutil.cpu_count() or 0,
            "usage": psutil.cpu_percent(interval=None),
        },
        "memory": {
            "used_gb": round((vm.total - vm.available) / 2**30, 1),
            "total_gb": round(vm.total / 2**30, 1),
            "percent": vm.percent,
        },
        "disk": disk,
        "disks": disks,
        "gpus": _gpu_stats(),
        "net": {"up_bps": round(up_bps, 1), "down_bps": round(down_bps, 1)},
    }
