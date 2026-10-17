"""SigmaFlow Science backend.

Implements the Science Agent protocol (see science/API.md) on the main
FastAPI server, with a single run manager serving two transports:

* WebSocket  -- preferred transport (`/api/ws`);
* HTTP + SSE -- the original protocol, kept for compatibility.

Runs are still a DEMO executor (synthetic progress ticks). The chat
path, however, runs the real SigmaFlow agent: with tool support
enabled it may execute bash, file IO, MCP servers and load_skill ON
THIS SERVER, using the model/provider configured in the settings.
"""

import asyncio
import base64
import atexit
import contextvars
import fcntl
import getpass
import hashlib
import hmac
import json
import math
import os
import pty as _pty_mod
import re
import secrets
import select
import signal
import struct
import subprocess
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

_TOOLS_LOCK = threading.Lock()
_TOOL_ALIASES: Dict[str, str] = {}


def _agent_tools_module():
    """Load sigmaflow.agent.tools with the same sys.path fallback as _run_agent_chat;
    publish the current MCP server config first so import-time wiring sees it."""
    _sync_mcp_env()
    try:
        from sigmaflow.agent import tools
    except ModuleNotFoundError:
        import sys as _sys

        _src_root = os.path.dirname(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        )
        if _src_root not in _sys.path:
            _sys.path.insert(0, _src_root)
        from sigmaflow.agent import tools
    _apply_sciverse_key()
    return tools


def _science_data_root() -> str:
    return os.environ.get("SIGMAFLOW_SCIENCE_DIR") or os.path.join(
        os.path.expanduser("~"), ".sigmaflow", "science"
    )


# ==================== 单用户 / 多用户模式 ====================
# 通过环境变量 SIGMAFLOW_MULTI_USER=1 在服务启动时启用多用户模式。
# 单用户模式(默认)与历史行为完全一致: 数据仍在共享根目录, 页面右下角
# 显示运行服务的系统用户名。多用户模式下注册/登录后按用户隔离全部
# 配置与会话数据(projects/models/tools/tokens/skills/system_prompt),
# 运行任务的归属也按用户过滤。

_MULTI_USER_ENV = "SIGMAFLOW_MULTI_USER"
_SESSION_COOKIE = "sigmaflow_session"
_SESSION_TTL = 7 * 24 * 3600


def _multi_user() -> bool:
    """Multi-user mode is opt-in via environment at server start."""
    return os.environ.get(_MULTI_USER_ENV, "").strip() in ("1", "true", "yes")


def _os_user() -> str:
    """Name of the OS account running this service (single-user identity)."""
    try:
        return getpass.getuser() or "default"
    except Exception:
        return "default"


_CURRENT_USER: "contextvars.ContextVar[str]" = contextvars.ContextVar(
    "sigmaflow_user", default=""
)


def _current_user() -> str:
    """Requested user for this task: logged-in account or service user name."""
    user = _CURRENT_USER.get()
    return user if user else _os_user()


_USER_REGISTRY_LOCK = threading.Lock()


def _users_registry_path() -> str:
    return os.path.join(_science_data_root(), "users.json")


def _load_users() -> dict:
    try:
        with open(_users_registry_path(), encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def _save_users(users: dict) -> None:
    path = _users_registry_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(users, fh, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def _hash_password(password: str, salt: bytes) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 200_000).hex()


def _session_secret() -> bytes:
    """Stable HMAC secret persisted in the shared data root."""
    path = os.path.join(_science_data_root(), "session_secret")
    try:
        with open(path, encoding="utf-8") as fh:
            value = fh.read().strip()
    except OSError:
        value = ""
    if not value:
        value = secrets.token_hex(32)
        try:
            os.makedirs(_science_data_root(), exist_ok=True)
            tmp = path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as fh:
                fh.write(value)
            os.replace(tmp, path)
        except Exception:
            pass
    return value.encode("utf-8")


def _session_token(user: str) -> str:
    """Signed and expiring session token, given out as an HttpOnly cookie."""
    payload = f"{user}.{int(time.time()) + _SESSION_TTL}"
    sig = hmac.new(
        _session_secret(), payload.encode("utf-8"), hashlib.sha256
    ).hexdigest()
    return f"{payload}.{sig}"


def _user_from_token(token: str) -> str:
    try:
        user, exp, sig = str(token).rsplit(".", 2)
        payload = f"{user}.{exp}"
        expected = hmac.new(
            _session_secret(), payload.encode("utf-8"), hashlib.sha256
        ).hexdigest()
    except Exception:
        return ""
    if not hmac.compare_digest(sig, expected):
        return ""
    if not exp.isdigit() or int(exp) < time.time():
        return ""
    return user or ""


def _cookie_user(request: Any) -> str:
    try:
        raw = request.cookies.get(_SESSION_COOKIE)
    except Exception:
        raw = ""
    return _user_from_token(raw) if raw else ""


def _user_data_dir(user: str) -> str:
    """Storage root for the given user's configs; common layout when single."""
    if not _multi_user():
        return _science_data_root()
    return os.path.join(_science_data_root(), "users", str(user)[:64])


def _user_science_root() -> str:
    """Per-request storage root for user-scoped config files."""
    return _user_data_dir(_current_user())


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

_WECHAT_STATE_TTL = 300.0
_WECHAT_STATE_LOCK = threading.Lock()
_WECHAT_STATES: Dict[str, float] = {}


def _wechat_config_path() -> str:
    return os.path.join(_science_data_root(), "wechat.json")


def _load_wechat_config() -> dict:
    """WeChat OAuth app credentials kept server-side; absent file disables it."""
    try:
        with open(_wechat_config_path(), encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def _wechat_appid() -> str:
    cfg = _load_wechat_config()
    return str(cfg.get("app_id") or "").strip()


def _wechat_enabled() -> bool:
    """Toggle is on when credentials exist; users without them see no button."""
    if not _multi_user():
        return False
    cfg = _load_wechat_config()
    if cfg.get("enabled") is False:
        return False
    return bool(_wechat_appid() and str(cfg.get("app_secret") or "").strip())


def _wechat_redirect_uri(request: Any) -> str:
    """OAuth return address; redirect_base in wechat.json wins over heuristics."""
    cfg = _load_wechat_config()
    base = str(cfg.get("redirect_base") or "").strip()
    if base:
        return base.rstrip("/") + "/"
    proto = request.url.scheme
    forwarded = str(request.headers.get("x-forwarded-proto") or "").split(",")[0]
    forwarded = forwarded.strip().lower()
    if forwarded:
        proto = forwarded
    host = request.headers.get("host") or "localhost"
    prefix = str(request.headers.get("x-forwarded-prefix") or "").strip()
    if not prefix:
        prefix = "/sigmaflow"  # 网关约定路径; 例外场景用 redirect_base 覆盖
    return f"{proto}://{host}{prefix}/science/"


def _wechat_qrconnect_url(request: Any) -> str:
    """Build the WeChat QR page URL; issues a one-shot state for CSRF checks."""
    state = secrets.token_urlsafe(16)
    now = time.time()
    with _WECHAT_STATE_LOCK:
        for key in [k for k, exp in _WECHAT_STATES.items() if exp < now]:
            _WECHAT_STATES.pop(key, None)
        _WECHAT_STATES[state] = now + _WECHAT_STATE_TTL
    redirect = _wechat_redirect_uri(request)
    query = urllib.parse.urlencode(
        {
            "appid": _wechat_appid(),
            "redirect_uri": redirect,
            "response_type": "code",
            "scope": "snsapi_login",
            "state": state,
        }
    )
    return "https://open.weixin.qq.com/connect/qrconnect?" + query + "#wechat_redirect"


def _wechat_consume_state(state: str) -> bool:
    """Accept a pending state exactly once within its TTL."""
    with _WECHAT_STATE_LOCK:
        expiry = _WECHAT_STATES.pop(state or "", None)
    return bool(expiry and expiry >= time.time())


def _wechat_fetch_json(url: str) -> dict:
    """Minimal timed GET returning parsed JSON; failures become empty dicts."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "SigmaFlow-Science"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode("utf-8", "replace"))
    except Exception:
        return {}


def _wechat_account_name(users: dict, key_union: str) -> str:
    """Unique account name derived from the stable WeChat identity key."""
    base = "wx_" + hashlib.sha256(key_union.encode("utf-8")).hexdigest()[:8]
    name = base
    n = 2
    while name in users:
        name = f"{base}_{n}"
        n += 1
    return name


def _tool_config_path() -> str:
    return os.path.join(_user_science_root(), "tools.json")


def _tokens_config_path() -> str:
    return os.path.join(_user_science_root(), "tokens.json")


def _sciverse_key_file() -> str:
    """Sciverse API key saved through the settings page, if any."""
    try:
        with open(_tokens_config_path(), encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception:
        return ""
    tokens = data.get("tokens") if isinstance(data, dict) else None
    return str((tokens or {}).get("sciverse") or "") if isinstance(tokens, dict) else ""


def _sciverse_key() -> str:
    """Effective Sciverse API key: the settings-page token first, then the agent config default."""
    saved = _sciverse_key_file().strip()
    if saved:
        return saved
    # 回退只查已加载的 tools 模块绑定, 不经过 _agent_tools_module(): 该函数每次调用都会
    # 再走 _apply_sciverse_key(), 与这里构成无基准情形的相互递归——未保存密钥时每次
    # 请求都烧穿递归栈, 靠内层吞 RecursionError 才得到正确结果。
    import sys as _sys

    tools_mod = _sys.modules.get("sigmaflow.agent.tools")
    try:
        return (
            str(getattr(tools_mod, "Sciverse_API_KEY", "") or "")
            if tools_mod is not None
            else ""
        )
    except Exception:
        return ""


def _anysearch_key() -> str:
    """Effective Anysearch API key: the settings-page token first, then the environment."""
    try:
        with open(_tokens_config_path(), encoding="utf-8") as fh:
            data = json.load(fh)
        tokens = data.get("tokens") if isinstance(data, dict) else None
    except Exception:
        tokens = {}
    saved = str((tokens or {}).get("anysearch") or "").strip()
    if saved:
        return saved
    return os.getenv("ANYSEARCH_API_KEY", "").strip()


def _apply_sciverse_key() -> None:
    """Push the effective key into the sciverse client module;
    SciverseAPI reads the module global at request time, so cached clients pick it up."""
    try:
        from sigmaflow.agent import sciverse_api

        if hasattr(sciverse_api, "Sciverse_API_KEY"):
            sciverse_api.Sciverse_API_KEY = _sciverse_key()
    except Exception:
        pass


def _load_tool_overrides() -> Dict[str, dict]:
    try:
        with open(_tool_config_path(), encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception:
        return {}
    overrides = data.get("overrides") if isinstance(data, dict) else None
    if not isinstance(overrides, dict):
        return {}
    return {str(k): dict(v) for k, v in overrides.items() if isinstance(v, dict)}


def _save_tool_overrides(overrides: Dict[str, dict]) -> None:
    path = _tool_config_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump({"overrides": overrides}, fh, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def _token_listing() -> list:
    """Settings-page view of configured third-party API tokens; secrets only appear masked."""
    try:
        with open(_tokens_config_path(), encoding="utf-8") as fh:
            data = json.load(fh)
        tokens = (
            data.get("tokens")
            if isinstance(data, dict) and isinstance(data.get("tokens"), dict)
            else {}
        )
    except Exception:
        tokens = {}
    tokens = tokens if isinstance(tokens, dict) else {}

    def _row(token_id: str, label: str, saved: str, env: str) -> dict:
        saved = str(saved or "").strip()
        env = str(env or "").strip()
        effective = saved or env
        return {
            "id": token_id,
            "label": label,
            "configured": bool(effective),
            "saved": bool(saved),
            "fromEnv": not saved and bool(env),
            "keyHint": (
                effective
                if len(effective) <= 8
                else f"{effective[:4]}****{effective[-4:]}"
            )
            if effective
            else "",
        }

    try:
        env_sciverse = str(getattr(_agent_tools_module(), "Sciverse_API_KEY", "") or "")
    except Exception:
        env_sciverse = ""
    return [
        _row(
            "sciverse", "Sciverse API", str(tokens.get("sciverse") or ""), env_sciverse
        ),
        _row(
            "anysearch",
            "Anysearch API",
            str(tokens.get("anysearch") or ""),
            os.getenv("ANYSEARCH_API_KEY", ""),
        ),
    ]


_TOKEN_IDS = ("sciverse", "anysearch")


def _apply_token_updates(updates: dict) -> None:
    """Persist submitted tokens, refresh the Sciverse client, and auto-sync
    dependent enablement: sciverse tools in tools.json and the anysearch MCP
    server (joins/leaves the active set through its token template)."""
    path = _tokens_config_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        tokens = (
            data.get("tokens")
            if isinstance(data, dict) and isinstance(data.get("tokens"), dict)
            else {}
        )
    except Exception:
        tokens = {}
    tokens = dict(tokens) if isinstance(tokens, dict) else {}
    for key, value in (updates or {}).items():
        if key not in _TOKEN_IDS:
            raise HTTPException(status_code=400, detail=f"Unknown token: {key}")
        text = str(value or "").strip()
        if text:
            tokens[key] = text
        else:
            tokens.pop(key, None)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump({"tokens": tokens}, fh, ensure_ascii=False, indent=2)
    os.replace(tmp, path)
    _apply_sciverse_key()
    # 同步 Sciverse 工具: 无密钥 → 覆盖里显式 enabled=False; 有密钥 → 移除 enabled 覆盖恢复默认开启
    overrides = _load_tool_overrides()
    on = bool(_sciverse_key())
    changed = False
    for t in _tool_defaults():
        name = str(t.get("name") or "")
        if not name.startswith("sciverse_"):
            continue
        entry = dict(overrides.get(name) or {})
        if on:
            entry.pop("enabled", None)
        else:
            entry["enabled"] = False
        if entry != (overrides.get(name) or {}):
            if entry:
                overrides[name] = entry
            else:
                overrides.pop(name, None)
            changed = True
    if changed:
        _save_tool_overrides(overrides)
    # anysearch 密钥变化后重建 MCP 客户端: 模板解析后的 header 生效, 服务随密钥有无进入/退出活动集
    if "anysearch" in (updates or {}):
        try:
            _rebuild_agent_mcp()
        except Exception:
            pass


def _tool_defaults() -> list:
    """Copy of sigmaflow.agent.tools.TOOLS; empty list when the agent package is unavailable."""
    try:
        return [dict(t) for t in _agent_tools_module().TOOLS]
    except Exception:
        return []


def _effective_agent_tools() -> list:
    """Compose the active tool list: drop disabled tools, apply name/description
    overrides, and register TOOL_HANDLERS aliases so renamed tools still execute."""
    defaults = _tool_defaults()
    if not defaults:
        return []
    handlers = _agent_tools_module().TOOL_HANDLERS
    overrides = _load_tool_overrides()
    with _TOOLS_LOCK:
        original = {t["name"] for t in defaults}
        for alias in list(_TOOL_ALIASES):
            if alias not in original:
                handlers.pop(alias, None)
            del _TOOL_ALIASES[alias]
        tools = []
        for t in defaults:
            override = overrides.get(t["name"]) or {}
            if override.get("enabled") is False:
                continue
            # 未配置 Sciverse API 时 Sciverse 工具不进入会话 payload, 也不注册别名
            if t["name"].startswith("sciverse_") and not _sciverse_key():
                continue
            entry = dict(t)
            display = str(override.get("name") or "").strip()
            if display and display != t["name"]:
                entry["name"] = display
                handlers[display] = handlers.get(t["name"])
                _TOOL_ALIASES[display] = t["name"]
            description = str(override.get("description") or "").strip()
            if description:
                entry["description"] = description
            schema = override.get("schema")
            if isinstance(schema, dict) and schema:
                entry["input_schema"] = schema
            tools.append(entry)
    return tools


_ARXIV_TOOLS = ("arxiv_search", "read_arxiv")


def _tool_origin(name: str) -> str:
    """Origin of a tool for the settings grouping: MCP server name for tools exposed
    by the active MCP client, otherwise one of the builtin taxonomy buckets
    (sciverse / arxiv / generic builtin)."""
    try:
        tool = _agent_tools_module().MCP.tools.get(name)
        if tool:
            return tool.server_name
    except Exception:
        pass
    if name.startswith("sciverse_"):
        return "sciverse"
    if name in _ARXIV_TOOLS:
        return "arxiv"
    return "builtin"


def _tool_listing(defaults: list, overrides: Dict[str, dict]) -> list:
    """Settings-page view of the tool set: original id plus effective name/description/schema/enabled."""
    sciverse_locked = not _sciverse_key()
    out = []
    for t in defaults:
        override = overrides.get(t["name"]) or {}
        schema = (
            override.get("schema")
            if isinstance(override.get("schema"), dict)
            else (t.get("input_schema") or {})
        )
        enabled = override.get("enabled") is not False
        # 未配置 Sciverse API 时 Sciverse 工具固定关闭, 忽略历史覆盖
        if t["name"].startswith("sciverse_") and sciverse_locked:
            enabled = False
        out.append(
            {
                "id": t["name"],
                "name": str(override.get("name") or "").strip() or t["name"],
                "description": str(override.get("description") or "").strip()
                or t.get("description")
                or "",
                "enabled": enabled,
                "schema": json.dumps(schema, ensure_ascii=False, separators=(",", ":")),
                "modified": bool(override),
                "origin": _tool_origin(t["name"]),
            }
        )
    return out


def _build_tool_overrides(items: list, known: Dict[str, dict]) -> Dict[str, dict]:
    """Validate the submitted tool settings and compress them into overrides;
    unchanged tools are not persisted."""
    overrides: Dict[str, dict] = {}
    seen: Dict[str, str] = {}
    for item in items or []:
        if not isinstance(item, dict):
            raise HTTPException(status_code=400, detail="Invalid tools payload")
        tool_id = str(item.get("id") or "")
        if tool_id not in known:
            raise HTTPException(status_code=400, detail=f"Unknown tool: {tool_id}")
        display = str(item.get("name") or "").strip()[:64]
        if not display:
            display = tool_id
        if display in seen:
            raise HTTPException(status_code=400, detail=f"工具名称重复: {display}")
        seen[display] = tool_id
        description = str(item.get("description") or "").strip()[:2000]
        entry: Dict[str, Any] = {}
        if display != tool_id:
            entry["name"] = display
        if description and description != (known[tool_id].get("description") or ""):
            entry["description"] = description
        if item.get("enabled") is False:
            entry["enabled"] = False
        schema_text = str(item.get("schema") or "").strip()
        if schema_text:
            try:
                schema = json.loads(schema_text)
            except Exception:
                raise HTTPException(
                    status_code=400, detail=f"工具 {tool_id} 参数 schema 不是合法 JSON"
                )
            if not isinstance(schema, dict):
                raise HTTPException(
                    status_code=400,
                    detail=f"工具 {tool_id} 参数 schema 必须是 JSON 对象",
                )
            # 长度按解析结果的紧凑形式计算, 允许前端提交带缩进的格式化文本
            if (
                len(json.dumps(schema, ensure_ascii=False, separators=(",", ":")))
                > 8000
            ):
                raise HTTPException(
                    status_code=400, detail=f"工具 {tool_id} 参数 schema 过长"
                )
            if schema != (known[tool_id].get("input_schema") or {}):
                entry["schema"] = schema
        if entry:
            overrides[tool_id] = entry
    return overrides


# ==================== Agent 技能配置 ====================
# 设置页可对技能做启用开关、名称与描述覆盖, 落盘到 <science_dir>/skills.json;
# 技能正文来自 <science_dir>/skills/<id>/SKILL.md, 内置技能在启动时从包资源种子化;
# 技能清单随系统提示词发给模型, 因此覆盖生效需要同时替换 skill_loader 并换出清单文本

_SKILLS_INSTALL_LOCK = threading.Lock()
_SKILL_BLOCK_BASE: Optional[Dict[str, str]] = None


def _skills_data_dir() -> str:
    return os.path.join(_user_science_root(), "skills")


def _skill_config_path() -> str:
    return os.path.join(_user_science_root(), "skills.json")


def _builtin_skills_src() -> str:
    """Packaged built-in skill assets live under the science web app directory."""
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "science", "skills")


def _seed_builtin_skills() -> None:
    """Copy packaged built-in skills into the science skills dir; never overwrite user edits."""
    src_root = _builtin_skills_src()
    try:
        entries = sorted(os.listdir(src_root))
    except OSError:
        return
    for name in entries:
        src = os.path.join(src_root, name, "SKILL.md")
        if not os.path.isfile(src):
            continue
        dst = os.path.join(_skills_data_dir(), name, "SKILL.md")
        if os.path.exists(dst):
            continue
        try:
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            with open(src, encoding="utf-8") as fh:
                text = fh.read()
            with open(dst, "w", encoding="utf-8") as fh:
                fh.write(text)
        except OSError:
            pass


def _load_skill_overrides() -> Dict[str, dict]:
    try:
        with open(_skill_config_path(), encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception:
        return {}
    overrides = data.get("overrides") if isinstance(data, dict) else None
    if not isinstance(overrides, dict):
        return {}
    return {str(k): dict(v) for k, v in overrides.items() if isinstance(v, dict)}


def _save_skill_overrides(overrides: Dict[str, dict]) -> None:
    path = _skill_config_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump({"overrides": overrides}, fh, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def _parse_skill_frontmatter(text: str) -> tuple:
    """Split YAML frontmatter from a SKILL.md body without extra dependencies."""
    if not text.startswith("---\n"):
        return {}, text
    end = text.find("\n---\n", 4)
    if end == -1:
        return {}, text
    try:
        import yaml

        meta = yaml.safe_load(text[4:end].strip())
    except Exception:
        meta = {}
    if not isinstance(meta, dict):
        meta = {}
    return meta, text[end + 5 :].strip()


def _discover_skills() -> list:
    """Scan skill dirs; frontmatter name wins over dir name as the stable id."""
    _seed_builtin_skills()
    root = _skills_data_dir()
    out = []
    seen = set()
    for dirpath, _dirnames, filenames in os.walk(root):
        if "SKILL.md" not in filenames:
            continue
        path = os.path.join(dirpath, "SKILL.md")
        try:
            with open(path, encoding="utf-8") as fh:
                text = fh.read()
        except OSError:
            continue
        meta, body = _parse_skill_frontmatter(text)
        skill_id = str(meta.get("name") or "").strip() or os.path.basename(
            dirpath.rstrip("/\\")
        )
        if skill_id in seen:
            continue
        seen.add(skill_id)
        out.append({"id": skill_id, "meta": meta, "body": body, "path": path})
    return out


def _builtin_skill_ids() -> set:
    """Ids of packaged built-in skills (frontmatter names, falling back to dir names)."""
    ids = set()
    src_root = _builtin_skills_src()
    try:
        names = os.listdir(src_root)
    except OSError:
        return ids
    for name in names:
        path = os.path.join(src_root, name, "SKILL.md")
        if not os.path.isfile(path):
            continue
        try:
            with open(path, encoding="utf-8") as fh:
                text = fh.read()
        except OSError:
            continue
        meta, _body = _parse_skill_frontmatter(text)
        ids.add(str(meta.get("name") or "").strip() or name)
    return ids


class _ScienceSkillView:
    """Override-aware replacement for tools.skill_loader (same duck-type interface);
    get_descriptions feeds the system prompt, get_content serves load_skill calls."""

    def __init__(self):
        self.skills_dir = _skills_data_dir()
        self.user = _current_user()
        self.skills = {}
        self.rebuild()

    def rebuild(self):
        # 多用户模式下不同用户的技能目录与开关不同, 按 current user 切换缓存
        self.user = _current_user()
        self.skills_dir = _user_science_root()
        overrides = _load_skill_overrides()
        skills = {}
        for skill in _discover_skills():
            override = overrides.get(skill["id"]) or {}
            if override.get("enabled") is False:
                continue
            meta = dict(skill["meta"])
            name = str(override.get("name") or "").strip() or skill["id"]
            meta["name"] = name
            description = str(override.get("description") or "").strip()
            if description:
                meta["description"] = description
            skills[name] = {"meta": meta, "body": skill["body"], "path": skill["path"]}
        self.skills = skills

    def get_descriptions(self) -> str:
        skill_prompt = f"Use `load_skill` to access specialized knowledge before tackling unfamiliar topics.\nSkills dir: {self.skills_dir}\nSkills available:\n"
        if not self.skills:
            return skill_prompt + "(no skills available)"
        lines = []
        for name, skill in self.skills.items():
            desc = skill["meta"].get("description", "No description")
            tags = skill["meta"].get("tags", "")
            line = f"  - {name}: {desc}"
            if tags:
                line += f" [{tags}]"
            lines.append(line.strip())
        return skill_prompt + "\n".join(lines)

    def get_content(self, name: str) -> str:
        skill = self.skills.get(name)
        if not skill:
            return f"Error: Unknown skill '{name}'. Available: {', '.join(self.skills.keys())}"
        return (
            f'<skill name="{name}" path="{skill["path"]}">\n{skill["body"]}\n</skill>'
        )


def _ensure_skills_installed() -> None:
    """Install the override-aware skill loader into the agent tools module (idempotent).
    Importing sigmaflow.agent.tools runs the package __init__, which builds the agent
    module's default system prompts from the original loader, so the original listing
    text is recorded here and swapped out later by _effective_system_prompts."""
    global _SKILL_BLOCK_BASE
    with _SKILLS_INSTALL_LOCK:
        tools_mod = _agent_tools_module()
        if isinstance(tools_mod.skill_loader, _ScienceSkillView):
            return
        try:
            original_block = tools_mod.skill_loader.get_descriptions()
        except Exception:
            original_block = ""
        tools_mod.skill_loader = _ScienceSkillView()
        import sigmaflow.agent.agent as agent_module

        if original_block and original_block in agent_module.SYSTEM:
            _SKILL_BLOCK_BASE = {"system": original_block, "sub": original_block}
        else:
            _SKILL_BLOCK_BASE = {"system": "", "sub": ""}


def _agent_agent_module():
    """Import sigmaflow.agent.agent with the same sys.path fallback as _run_agent_chat."""
    _ensure_skills_installed()
    try:
        import sigmaflow.agent.agent as agent_module
    except ModuleNotFoundError:
        import sys as _sys

        _src_root = os.path.dirname(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        )
        if _src_root not in _sys.path:
            _sys.path.insert(0, _src_root)
        import sigmaflow.agent.agent as agent_module
    return agent_module


def _default_system_prompts() -> tuple:
    """(system, sub_system) with the current skill listing swapped into the agent
    module's default prompts; Agent captures those defaults at import, so the swap is
    done textually against the original block recorded by _ensure_skills_installed."""
    agent_module = _agent_agent_module()
    global _SKILL_BLOCK_BASE
    if _SKILL_BLOCK_BASE is None:
        _SKILL_BLOCK_BASE = {"system": "", "sub": ""}
    listing = _agent_tools_module().skill_loader.get_descriptions()
    system = (
        agent_module.SYSTEM.replace(_SKILL_BLOCK_BASE["system"], listing)
        if _SKILL_BLOCK_BASE["system"]
        else agent_module.SYSTEM
    )
    sub_system = (
        agent_module.SUBAGENT_SYSTEM.replace(_SKILL_BLOCK_BASE["sub"], listing)
        if _SKILL_BLOCK_BASE["sub"]
        else agent_module.SUBAGENT_SYSTEM
    )
    return system, sub_system


def _effective_system_prompts() -> tuple:
    """Effective main-agent system prompt: default with skills swap, optionally
    overridden by the settings-page custom prompt (skills listing re-appended);
    the subagent prompt keeps the built-in text."""
    system, sub_system = _default_system_prompts()
    cfg = _load_system_prompt_config()
    if cfg.get("enabled"):
        custom = str(cfg.get("prompt") or "").strip()
        if custom:
            listing = _agent_tools_module().skill_loader.get_descriptions()
            system = f"{custom}\n\n{listing}"
    return system, sub_system


def _skill_listing(defaults: list, overrides: Dict[str, dict]) -> list:
    """Settings-page view of the skills: original id plus effective name/description/enabled."""
    builtin = _builtin_skill_ids()
    out = []
    for s in defaults:
        override = overrides.get(s["id"]) or {}
        out.append(
            {
                "id": s["id"],
                "name": str(override.get("name") or "").strip() or s["id"],
                "description": str(override.get("description") or "").strip()
                or str(s["meta"].get("description") or ""),
                "enabled": override.get("enabled") is not False,
                "builtin": s["id"] in builtin,
                "modified": bool(override),
            }
        )
    return out


def _build_skill_overrides(items: list, known: Dict[str, dict]) -> Dict[str, dict]:
    """Validate the submitted skill settings and compress them into overrides;
    unchanged skills are not persisted."""
    overrides: Dict[str, dict] = {}
    seen: Dict[str, str] = {}
    for item in items or []:
        if not isinstance(item, dict):
            raise HTTPException(status_code=400, detail="Invalid skills payload")
        skill_id = str(item.get("id") or "")
        if skill_id not in known:
            raise HTTPException(status_code=400, detail=f"Unknown skill: {skill_id}")
        display = str(item.get("name") or "").strip()[:64]
        if not display:
            display = skill_id
        if display in seen:
            raise HTTPException(status_code=400, detail=f"技能名称重复: {display}")
        seen[display] = skill_id
        description = str(item.get("description") or "").strip()[:2000]
        entry: Dict[str, Any] = {}
        if display != skill_id:
            entry["name"] = display
        if (
            description
            and description
            != str(known[skill_id]["meta"].get("description") or "").strip()[:2000]
        ):
            entry["description"] = description
        if item.get("enabled") is False:
            entry["enabled"] = False
        if entry:
            overrides[skill_id] = entry
    return overrides


# ==================== MCP 服务配置 ====================
# 设置页可增删改 MCP 服务器 (名称/地址/启用开关), 落盘到 <science_dir>/mcp.json;
# 内置服务器 (medical-apis) 在首次运行时种子化; 生效路径: 导入 agent 工具模块前通过
# MCP_ENDPOINT 环境变量注入, 已导入时在保存后重建 MCPClient 并重挂其工具

_FS_HIDDEN_NAMES = {".git", "__pycache__", "node_modules", ".DS_Store"}
_GIT_STATUS_TTL = 3.0
_GIT_STATUS_CACHE: Dict[str, tuple] = {}
_FS_TEXT_MAX = 512 * 1024


def _fs_resolve(project_dir: str, rel: str):
    """Resolve `rel` inside the project dir, refusing escapes (returns abs path)."""
    root = os.path.realpath(project_dir)
    target = os.path.realpath(os.path.join(root, rel)) if rel else root
    if target != root and not target.startswith(root + os.sep):
        return None, root
    return target, root


_FS_UPLOAD_MAX = 32 * 1024 * 1024
_FS_EXEC_TIMEOUT = 180.0
_FS_CWD_SENTINEL = "SIGMAFLOW_CWD"
_FS_EXEC_RE = None


# Interactive terminal: one real PTY per project, shared across websocket
# connections. The reader thread copies master output into a ring buffer and
# fans it out to every attached websocket; a reconnect replays the buffer.
_PTY_BUFFER_MAX = 200 * 1024
_PTY_SESSIONS_MAX = 8


class _PtySession:
    """One bash running on a PTY, with a bounded replay buffer and fan-out."""

    def __init__(self, key: str, cwd: str, cols: int = 90, rows: int = 28):
        self.key = key
        self.cwd = cwd
        self.created = time.time()
        self.lock = threading.Lock()
        self.buffer = bytearray()
        self.seq = 0
        self.subs: list = []
        self.alive = True
        self.cols, self.rows = cols, rows
        self.master, slave = _pty_mod.openpty()
        try:
            fcntl.ioctl(slave, 0x5414, struct.pack("HHHH", rows, cols, 0, 0))
        except OSError:
            pass
        env = dict(os.environ)
        env.update(
            {
                "TERM": "xterm-256color",
                "COLORTERM": "truecolor",
                "PS1": r"\u@\h \w $ ",
                "PAGER": "cat",
            }
        )
        self.proc = subprocess.Popen(
            ["/bin/bash", "--login", "-i"],
            stdin=slave,
            stdout=slave,
            stderr=slave,
            cwd=cwd,
            env=env,
            start_new_session=True,
            close_fds=True,
        )
        os.close(slave)
        self.thread = threading.Thread(target=self._pump, daemon=True)
        self.thread.start()

    def _dispatch(self, kind: str, payload: bytes = None):
        """Deliver a frame to every attached websocket queue (thread safe)."""
        with self.lock:
            subs = [(sub["queue"], sub["loop"], sub["seq"]) for sub in self.subs]
        for queue, loop, sub_seq in subs:
            try:
                loop.call_soon_threadsafe(queue.put_nowait, (kind, payload))
            except RuntimeError:
                pass

    def _pump(self):
        try:
            while True:
                try:
                    ready, _, _ = select.select([self.master], [], [], 0.5)
                except (OSError, ValueError):
                    break
                if not ready:
                    if self.proc.poll() is not None:
                        break
                    continue
                try:
                    data = os.read(self.master, 65536)
                except OSError:
                    break
                if not data:
                    break
                with self.lock:
                    self.buffer.extend(data)
                    overflow = len(self.buffer) - _PTY_BUFFER_MAX
                    if overflow > 0:
                        del self.buffer[:overflow]
                    self.seq += 1
                    current = self.seq
                    for sub in self.subs:
                        if current > sub["seq"]:
                            sub["seq"] = current
                            try:
                                sub["loop"].call_soon_threadsafe(
                                    sub["queue"].put_nowait, ("out", data)
                                )
                            except RuntimeError:
                                pass
            self.proc.wait(timeout=2)
        except Exception:
            pass
        finally:
            self.alive = False
            self._dispatch("closed")
            with self.lock:
                subs = self.subs
                self.subs = []
            for queue, loop, _seq in subs:
                try:
                    loop.call_soon_threadsafe(queue.put_nowait, ("closed", None))
                except RuntimeError:
                    pass

    def subscribe(self, loop, queue):
        """Register a websocket; returns (snapshot bytes, seq start)."""
        with self.lock:
            sub = {"loop": loop, "queue": queue, "seq": self.seq}
            self.subs.append(sub)
            return bytes(self.buffer), self.seq

    def unsubscribe(self, queue):
        with self.lock:
            self.subs = [s for s in self.subs if s["queue"] is not queue]

    def write(self, data: bytes):
        try:
            os.write(self.master, data)
        except OSError:
            pass

    def resize(self, cols: int, rows: int):
        if cols < 2 or rows < 1 or cols > 500 or rows > 300:
            return
        self.cols, self.rows = cols, rows
        try:
            fcntl.ioctl(self.master, 0x5414, struct.pack("HHHH", rows, cols, 0, 0))
            os.killpg(self.proc.pid, signal.SIGWINCH)
        except OSError:
            pass

    def kill(self):
        self.alive = False
        try:
            os.killpg(self.proc.pid, signal.SIGKILL)
        except OSError:
            pass
        for fd in (self.master,):
            try:
                os.close(fd)
            except OSError:
                pass


def _pty_key_of(project_id: str) -> str:
    return f"pty:{(project_id or '').strip()[:64]}"


def _fs_exec_payload(project, cmd: str, cwd: str) -> dict:
    """Run one shell command under the project dir; bash session cwd is kept by
    the client passing the previously reported directory back each time."""
    base = str((project or {}).get("dir") or "").strip()
    if not base or not os.path.isdir(base):
        raise HTTPException(
            status_code=404, detail="项目目录不存在，请编辑项目并填写本地路径"
        )
    start, root = _fs_resolve(base, cwd or "")
    if start is None or not os.path.isdir(start):
        raise HTTPException(status_code=400, detail="工作目录不可用，已重置到项目根")
    script = (
        cmd
        + "\n__sf_code=$?\n"
        + 'printf "\001'
        + _FS_CWD_SENTINEL
        + ':%s\001\n" "$PWD"\n'
        + "exit $__sf_code"
    )

    def _text(value) -> str:
        if value is None:
            return ""
        if isinstance(value, bytes):
            return value.decode("utf-8", "replace")
        return value

    try:
        proc = subprocess.run(
            ["bash", "-c", script],
            cwd=start,
            capture_output=True,
            text=True,
            timeout=_FS_EXEC_TIMEOUT,
        )
        out, err, code = _text(proc.stdout), _text(proc.stderr), proc.returncode
    except subprocess.TimeoutExpired as exc:
        out, err, code = (
            _text(exc.stdout),
            _text(exc.stderr) + "\n[命令执行超时，已终止]",
            124,
        )
    newcwd = start
    marker = f"\x01{_FS_CWD_SENTINEL}:"
    sbegin = out.find(marker)
    if sbegin >= 0:
        send = out.find("\x01", sbegin + len(marker))
        if send > sbegin:
            candidate = out[sbegin + len(marker) : send]
            resolved = None
            if candidate:
                resolved, _ = _fs_resolve(
                    base,
                    os.path.relpath(candidate, root)
                    if os.path.isabs(candidate)
                    else candidate,
                )
            if resolved and os.path.isdir(resolved):
                newcwd = resolved
            out = out[:sbegin] + out[send + 1 :]
    return {
        "stdout": out,
        "stderr": err,
        "code": code,
        "cwd": os.path.relpath(newcwd, root).replace(os.sep, "/")
        if newcwd != root
        else "",
        "root": root.replace(os.sep, "/"),
    }


def _fs_upload_payload(project, name: str, data_base64: str) -> dict:
    """Upload one file into the project directory (no overwrite)."""
    base = str((project or {}).get("dir") or "").strip()
    if not base or not os.path.isdir(base):
        raise HTTPException(
            status_code=404, detail="项目目录不存在，请编辑项目并填写本地路径"
        )
    clean = os.path.basename(str(name or "").replace("\\", "/").replace("\x00", ""))[
        :200
    ]
    if not clean or clean in (".", ".."):
        raise HTTPException(status_code=400, detail="文件名无效")
    try:
        raw = base64.b64decode(data_base64.split(",")[-1], validate=False)
    except Exception:
        raw = b""
    if not raw:
        raise HTTPException(status_code=400, detail="文件内容为空")
    if len(raw) > _FS_UPLOAD_MAX:
        raise HTTPException(status_code=400, detail="文件超过 32 MB 限制")
    target, root = _fs_resolve(base, clean)
    if target is None or os.path.isdir(target):
        raise HTTPException(status_code=400, detail="目标路径无效")
    if os.path.exists(target):
        raise HTTPException(status_code=400, detail="同名文件已存在，请改名后再上传")
    with open(target, "wb") as fh:
        fh.write(raw)
    try:
        subprocess.run(
            ["git", "-C", root, "add", "-A", "--", clean],
            capture_output=True,
            timeout=10,
        )
    except Exception:
        pass
    return {"name": clean, "size": len(raw), "path": clean.replace(os.sep, "/")}


def _git_status_map(root: str) -> Dict[str, str]:
    """Repo-relative path -> one-letter git status (M/A/D/R/U for untracked).

    Cached briefly per project so expanding a few directories does not re-run
    `git status` each time.
    """
    cached = _GIT_STATUS_CACHE.get(root)
    now = time.time()
    if cached and now - cached[0] < _GIT_STATUS_TTL:
        return cached[1]
    result: Dict[str, str] = {}
    try:
        proc = subprocess.run(
            [
                "git",
                "-C",
                root,
                "status",
                "--porcelain=v1",
                "-z",
                "--untracked-files=all",
            ],
            capture_output=True,
            text=True,
            timeout=8,
        )
        if proc.returncode == 0:
            items = proc.stdout.split("\0")
            i = 0
            while i < len(items):
                item = items[i]
                i += 1
                if len(item) < 4:
                    continue
                xy = item[:2]
                path = item[3:]
                if xy == "??":
                    status = "U"
                else:
                    status = xy[1].strip() or xy[0].strip() or "M"
                if status == "R" and i < len(items) - 1:
                    i += 1  # rename records carry the old path in the next field
                if path:
                    result[path] = status
    except Exception:
        return {}
    _GIT_STATUS_CACHE[root] = (now, result)
    return result


def _fs_tree_payload(project, rel: str) -> dict:
    """Directory listing + git status for the project file browser."""
    base = str((project or {}).get("dir") or "").strip()
    if not base or not os.path.isdir(base):
        raise HTTPException(
            status_code=404, detail="项目目录不存在，请编辑项目并填写本地路径"
        )
    target, root = _fs_resolve(base, rel)
    if target is None or not os.path.isdir(target):
        raise HTTPException(status_code=404, detail="目录不存在")
    entries = []
    try:
        names = os.listdir(target)
    except PermissionError:
        names = []
    for name in sorted(names, key=str.lower):
        if name in _FS_HIDDEN_NAMES or name.startswith("."):
            continue
        full = os.path.join(target, name)
        is_dir = os.path.isdir(full)
        if not is_dir and not os.path.isfile(full):
            continue  # sockets / broken symlinks 等
        entries.append(
            {
                "name": name,
                "type": "dir" if is_dir else "file",
                "path": os.path.relpath(full, root).replace(os.sep, "/"),
            }
        )
        if len(entries) >= 500:
            break
    return {
        "root": root.replace(os.sep, "/"),
        "path": rel,
        "entries": entries,
        "git": _git_status_map(root),
    }


def _fs_file_payload(project, rel: str) -> dict:
    """Read one file for the read-only preview modal."""
    base = str((project or {}).get("dir") or "").strip()
    if not base or not os.path.isdir(base):
        raise HTTPException(status_code=404, detail="项目目录不存在")
    target, root = _fs_resolve(base, rel)
    if target is None:
        raise HTTPException(status_code=403, detail="越界路径")
    if not os.path.isfile(target):
        raise HTTPException(status_code=404, detail="文件不存在")
    size = os.path.getsize(target)
    with open(target, "rb") as fh:
        head = fh.read(min(size, _FS_TEXT_MAX + 64 * 1024))
    if b"\x00" in head[:8192]:
        return {"path": rel, "size": size, "binary": True, "content": ""}
    truncated = size > _FS_TEXT_MAX
    text = head[:_FS_TEXT_MAX].decode("utf-8", "replace")
    return {
        "path": rel,
        "size": size,
        "binary": False,
        "content": text,
        "truncated": truncated,
    }


_MCP_REBUILD_LOCK = threading.Lock()


def _mcp_config_path() -> str:
    return os.path.join(_science_data_root(), "mcp.json")


def _builtin_mcp_servers() -> Dict[str, dict]:
    """Built-in MCP servers shipped as a package asset next to the science app."""
    try:
        with open(
            os.path.join(
                os.path.dirname(os.path.abspath(__file__)),
                "science",
                "mcp_servers.json",
            ),
            encoding="utf-8",
        ) as fh:
            data = json.load(fh)
    except Exception:
        return {}
    servers = data.get("servers") if isinstance(data, dict) else None
    if not isinstance(servers, dict):
        return {}
    return {
        str(k): dict(v)
        for k, v in servers.items()
        if isinstance(v, dict) and v.get("url")
    }


def _load_mcp_servers() -> Dict[str, dict]:
    try:
        with open(_mcp_config_path(), encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception:
        return _builtin_mcp_servers()
    servers = data.get("servers") if isinstance(data, dict) else None
    if not isinstance(servers, dict):
        return _builtin_mcp_servers()
    return {str(k): dict(v) for k, v in servers.items() if isinstance(v, dict)}


def _save_mcp_servers(servers: Dict[str, dict], removed: Optional[list] = None) -> None:
    path = _mcp_config_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if removed is None:
        # 未显式传入时保留文件中已有的移除记录, 避免内置服务器被回填复活
        try:
            with open(path, encoding="utf-8") as fh:
                old = json.load(fh)
            removed = old.get("removedBuiltins") if isinstance(old, dict) else None
        except Exception:
            removed = None
    payload = {"servers": servers}
    if removed:
        payload["removedBuiltins"] = sorted(str(x) for x in removed)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def _removed_builtins() -> set:
    """Builtin server names the user explicitly deleted from the MCP settings."""
    try:
        with open(_mcp_config_path(), encoding="utf-8") as fh:
            data = json.load(fh)
        removed = data.get("removedBuiltins") if isinstance(data, dict) else None
    except Exception:
        return set()
    return {str(x) for x in removed} if isinstance(removed, list) else set()


def _seed_mcp_config() -> None:
    """Create the config with builtin servers on first run; later runs backfill
    newly shipped builtin servers unless the user removed them on purpose."""
    servers = _load_mcp_servers()
    skip = _removed_builtins()
    missing = {
        k: v
        for k, v in _builtin_mcp_servers().items()
        if k not in servers and k not in skip
    }
    if missing or not os.path.exists(_mcp_config_path()):
        servers.update(missing)
        _save_mcp_servers(servers)


def _active_mcp_servers() -> Dict[str, dict]:
    """Enabled servers in the wire format MCP_CONF expects (enabled flag stripped);
    ${ANYSEARCH_API_KEY} placeholders in headers are replaced with the saved token,
    and gated servers whose token is missing are dropped entirely."""
    servers = _load_mcp_servers()
    active = {}
    for name, cfg in servers.items():
        if cfg.get("enabled") is False or not str(cfg.get("url") or "").strip():
            continue
        if name == "anysearch" and not _anysearch_key():
            continue  # 未配置 Anysearch API key 时该服务器等同禁用
        entry = {}
        for k, v in cfg.items():
            if k != "enabled":
                entry[k] = v
        headers = entry.get("headers")
        if isinstance(headers, dict):
            key = _anysearch_key()
            resolved = {}
            for hk, hv in headers.items():
                if isinstance(hv, str) and "${ANYSEARCH_API_KEY}" in hv:
                    if not key:
                        continue  # 双保险: 无 key 时不发送哨兵头
                    hv = hv.replace("${ANYSEARCH_API_KEY}", key)
                resolved[hk] = hv
            if resolved:
                entry["headers"] = resolved
            else:
                entry.pop("headers", None)
        active[name] = entry
    return active


def _sync_mcp_env() -> None:
    """Publish enabled MCP servers via MCP_ENDPOINT so the agent tools module picks
    them up at import; also refresh the in-memory conf if already imported."""
    active = _active_mcp_servers()
    os.environ["MCP_ENDPOINT"] = json.dumps(active, ensure_ascii=False)
    try:
        import sigmaflow.agent.conf as agent_conf

        agent_conf.MCP_CONF = {"mcpServers": active}
    except Exception:
        pass


def _rebuild_agent_mcp() -> dict:
    """Re-apply MCP config to an already-imported agent tools module: re-list tools
    over the network, rewire TOOLS/CHILD_TOOLS/TOOL_HANDLERS and return the new client."""
    _sync_mcp_env()
    try:
        import sigmaflow.agent.tools as tools_mod
    except Exception:
        return {}
    with _MCP_REBUILD_LOCK:
        active = _active_mcp_servers()
        # MCP_CONF 在 tools 模块里是独立绑定(from .conf import *), 必须在重建前刷新, 否则新客户端仍用旧配置
        tools_mod.MCP_CONF = {"mcpServers": active}
        old = tools_mod.MCP
        old_names = set(old.tools.keys())
        for name in old_names:
            tools_mod.TOOL_HANDLERS.pop(name, None)
        tools_mod.TOOLS[:] = [
            t for t in tools_mod.TOOLS if t.get("name") not in old_names
        ]
        tools_mod.CHILD_TOOLS[:] = [
            t for t in tools_mod.CHILD_TOOLS if t.get("name") not in old_names
        ]
        client = tools_mod.MCPClient()
        tools_mod.MCP = client
        for mcp_tool in client.tools.values():
            t = {
                "name": mcp_tool.name,
                "description": mcp_tool.description,
                "input_schema": mcp_tool.input_schema,
            }
            tools_mod.CHILD_TOOLS.append(dict(t))
            tools_mod.TOOLS.append(dict(t))
            tools_mod.TOOL_HANDLERS[mcp_tool.name] = (
                lambda n: lambda **kw: client.call_tool(n, kw)
            )(mcp_tool.name)
    return client.tools


def _mcp_listing() -> list:
    builtin = _builtin_mcp_servers()
    servers = _load_mcp_servers()
    out = []
    for name, cfg in servers.items():
        enabled = cfg.get("enabled") is not False
        locked = name == "anysearch" and not _anysearch_key()
        out.append(
            {
                "id": name,
                "name": name,
                "url": str(cfg.get("url") or ""),
                "enabled": enabled and not locked,
                "builtin": name in builtin,
                "locked": locked,  # 需先在第三方 API Key 中配置密钥, 服务端强制关闭
                "modified": builtin.get(name) != cfg,
            }
        )
    return out


def _build_mcp_servers(items: list, reset: bool) -> Dict[str, dict]:
    """Validate the submitted MCP server list and convert it into the stored config;
    builtin servers keep their packaged headers (e.g. the anysearch token template)."""
    builtin = _builtin_mcp_servers()
    if reset:
        return {k: dict(v) for k, v in builtin.items()}
    servers: Dict[str, dict] = {}
    for item in items or []:
        if not isinstance(item, dict):
            raise HTTPException(status_code=400, detail="Invalid mcp payload")
        name = str(item.get("name") or "").strip()[:64]
        if not name:
            raise HTTPException(status_code=400, detail="MCP 服务器名称不能为空")
        url = str(item.get("url") or "").strip()[:500]
        if not url.startswith(("http://", "https://")):
            raise HTTPException(
                status_code=400, detail=f"MCP 地址需要以 http(s):// 开头: {name}"
            )
        if name in servers:
            raise HTTPException(status_code=400, detail=f"MCP 服务器名称重复: {name}")
        entry = {"url": url}
        if name in builtin:
            # 认证头等非页面字段以内置资产为准, 不随设置页保存丢失
            for k, v in builtin[name].items():
                if k != "url":
                    entry[k] = v
        if item.get("enabled") is False:
            entry["enabled"] = False
        servers[name] = entry
    return servers


# ==================== 系统提示词配置 ====================
# 设置页可提供自定义系统提示词替换内置默认; 技能清单自动附加在末尾;
# 子代理提示词保持内置不随覆盖变化; 配置落盘 <science_dir>/system_prompt.json


def _system_prompt_config_path() -> str:
    return os.path.join(_science_data_root(), "system_prompt.json")


def _load_system_prompt_config() -> dict:
    try:
        with open(_system_prompt_config_path(), encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def _save_system_prompt_config(cfg: dict) -> None:
    path = _system_prompt_config_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(cfg, fh, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


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
            lost_default = lost_default or self.models[mid].get("isDefault")
            self.models.pop(mid, None)
        if lost_default:
            self._fix_default()
        self._save()
        return True

    # --------------------------------------------------------------- models

    def _public_model(self, model: dict) -> dict:
        provider = self.providers.get(model.get("providerId")) or {}
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
        auth_router = APIRouter(prefix="/api/auth")

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
            record = users.get(name) if isinstance(users.get(name), dict) else {}
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
                raise HTTPException(status_code=400, detail="登录会话已失效，请重新扫码")
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

        self.auth_router = auth_router

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

        def _check_run_owner(run_id: str) -> None:
            """Multi-user isolation: a run is only visible to its owner."""
            run = self.manager.runs.get(run_id)
            if run is None:
                return
            if _multi_user() and run.get("owner") != _current_user():
                raise HTTPException(status_code=404, detail="Run not found")

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
            _check_run_owner(run_id)
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
            _check_run_owner(run_id)
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
                    stats,
                    workdir,
                )
            except RuntimeError as err:
                raise HTTPException(status_code=400, detail=str(err))
            return {
                "content": content,
                "tokens": stats.get("completion_tokens") or 0,
                "promptTokens": stats.get("prompt_tokens") or 0,
            }

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
            _check_run_owner(run_id)
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

        @router.websocket("/ws")
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
                data = (
                    message.get("data")
                    if isinstance(message.get("data"), dict)
                    else message
                )
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
                    _check_run_owner(run_id)
                    if run_id not in self.manager.runs:
                        await fail(request_id, "Run not found")
                        return
                    await reply(
                        "run.snapshot", request_id, self.manager.snapshot(run_id)
                    )
                elif action == "run.subscribe":
                    run_id = run_id_of(data)
                    _check_run_owner(run_id)
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
                elif action == "chat.stop":
                    # 置位停止标记, 流式循环会在收尾时补发 chat.done
                    if request_id in chat_stops:
                        chat_stops[request_id] = True
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
                                    lambda e: loop.call_soon_threadsafe(
                                        chat_queue.put_nowait, ("tool", e)
                                    ),
                                    stats,
                                    chat_workdir,
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
                            kind, value = await chat_queue.get()
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

                    # 流式任务与请求解耦: handle 立即返回, 事件异步推送
                    # 停止通过 chat_stops 轮询生效, 不强杀工作线程
                    # 任务句柄收进 chat_tasks, 服务退出时统一取消
                    chat_task = asyncio.create_task(stream_chat())
                    chat_tasks.add(chat_task)
                    chat_task.add_done_callback(chat_tasks.discard)
                elif action == "pty.open":
                    project_id = str(data.get("projectId") or data.get("id") or "")[:64]
                    project = self.project_store.projects.get(project_id or "")
                    basedir = str((project or {}).get("dir") or "").strip()
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
                            cols = int(data.get("cols") or 90)
                            rows = int(data.get("rows") or 28)
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
                    if pump is None:
                        pump = asyncio.create_task(_push_loop(ws, queue))
                    if pty_pump is None:
                        pty_pump = asyncio.create_task(_pty_pump_loop())
                    await handle(message)
            except WebSocketDisconnect:
                pass
            finally:
                if pump:
                    pump.cancel()
                if pty_pump:
                    pty_pump.cancel()
                _pty_detach_all()
                for task in chat_tasks:
                    task.cancel()
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
            "createdAt": project.get("createdAt"),
            "updatedAt": project.get("updatedAt"),
        }

    def list_projects(self) -> list:
        # 最近活动优先排序: 取项目自身更新时间与项目下未归档会话的最新时间中的较大者。
        # 新建的项目 updatedAt 最新, 自然排最上; 老项目有新对话时同样被顶到最上方。
        latest = {}
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
                item: dict[str, str] = {
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


def _run_agent_chat(
    base_url: str,
    api_key: str,
    model_name: str,
    messages: list,
    on_delta=None,
    on_reasoning=None,
    on_tool=None,
    stats: dict = None,
    workdir: Optional[str] = None,
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

    convo = [
        {"role": m.get("role"), "content": m.get("content", "")}
        for m in messages
        if m.get("role") in ("user", "assistant")
    ]
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
    agent = Agent(
        method="openai",
        model=model_name,
        base_url=base_url,
        api_key=api_key or "sk-empty",
        support_tool=True,
        retry=2,
        max_turn=max_turn,
        tools=_effective_agent_tools(),
        system=bound_system,
        sub_system=sub_system,
        on_delta=_make_chat_delta_callback(on_delta, on_reasoning),
        on_tool=on_tool,
    )
    agent.client.timeout = 90
    agent.client.max_retries = 1
    info = agent(convo, is_print=False, max_turn=max_turn)
    try:
        if stats is not None and isinstance(info, dict):
            # 回填本次请求的 token 用量, 供 /chat 返回统计
            stats["completion_tokens"] = info.get("completion_tokens") or 0
            stats["prompt_tokens"] = info.get("prompt_tokens") or 0
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
    stats: dict = None,
    workdir: Optional[str] = None,
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
        stats=stats,
        workdir=workdir,
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
