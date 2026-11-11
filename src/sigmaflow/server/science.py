import asyncio
import atexit
import datetime as _dtmod
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
from starlette.concurrency import iterate_in_threadpool
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

from sigmaflow.agent import conf as _agent_conf
from .patenv import (
    HUB as PATENV_HUB,
    PATIENT_PROJECT_ID,
    PATIENT_PROJECT_NAME,
    patient_agent_prompt,
)
from .pathenv import (
    HUB as PATHENV_HUB,
    GROUPS as PATHENV_GROUPS,
    PATHOGEN_PROJECT_ID,
    PATHOGEN_PROJECT_NAME,
    pathogen_agent_prompt,
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
    _discover_skills,
    _effective_agent_tools,
    _effective_compaction,
    _effective_system_prompts,
    _load_compaction_config,
    _memory_recall_enabled,
    _save_memory_config,
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

from ..utils import is_protected_path
from .science_fs import (
    _fs_resolve,
    _PTY_SESSIONS_MAX,
    _PtySession,
    _fs_exec_payload,
    _fs_file_payload,
    _fs_op_payload,
    _fs_tree_payload,
    _fs_upload_payload,
    _pty_key_of,
)


# 会话分页单页字节上限(shape 后序列化), 与前端传的 limit 条数参数并行兜底
_CONVERSATION_PAGE_MAX_BYTES = 4_000_000


def _shape_conversation_row(m):
    """回放视图传输瘦身: 超长工具结果截到 4000 字并标 rc(存储不动);
    展开详情与 Trace 页的完整版走各自的数据通路。"""
    if not isinstance(m, dict) or not isinstance(m.get("blocks"), list):
        return m
    changed = False
    shaped = []
    for b in m["blocks"]:
        if (
            isinstance(b, dict)
            and b.get("t") == "tool"
            and isinstance(b.get("r"), str)
            and len(b["r"]) > 4000
        ):
            b2 = dict(b)
            b2["r"] = b["r"][:4000]
            b2["rc"] = 1
            shaped.append(b2)
            changed = True
        else:
            shaped.append(b)
    if changed:
        m2 = dict(m)
        m2["blocks"] = shaped
        return m2
    return m


def _conversation_page_rows(content, offset, limit):
    """会话分页切片: limit 条为界, shape 后按累计序列化字节提前收刀。

    单条 600KB 级的存量消息会让 30 条一页拖到十几兆, 字节上限由
    服务端兜底; 至少放行 1 条保证分页游标可前进。"""
    out = []
    acc = 0
    for raw in content[offset : offset + limit]:
        row = _shape_conversation_row(raw)
        try:
            acc += len(json.dumps(row, ensure_ascii=False).encode("utf-8"))
        except Exception:
            acc += 60000
        out.append(row)
        if acc >= _CONVERSATION_PAGE_MAX_BYTES:
            break
    return out


MAX_RUNS = 100
MAX_PROMPT_CHARS = 6000
MAX_STEPS = 10
MAX_MODELS = 50
RUN_TTL_MS = 3_600_000  # evict runs older than 1h once nobody is watching
TICK_SECONDS = 0.7


_TOOL_LIMIT_CACHE: dict = {}
_TURN_BUDGET_CACHE: dict = {}
_NUDGE_CACHE: dict = {}


def _turn_budget() -> int:
    """单次回复的工具轮次上限: 前端设置页可调(存 settings.json 的 turnBudget), 默认 100。

    分析型任务一轮一个工具, 预算不足会被截停; 读取时实时查盘(与 toolResultLimit 同样的
    mtime 缓存策略), 设置变更即时生效。"""
    d = os.environ.get("SIGMAFLOW_SCIENCE_DIR") or os.path.join(
        os.path.expanduser("~"), ".sigmaflow", "science"
    )
    path = os.path.join(d, "settings.json")
    try:
        st = os.stat(path)
        key = (st.st_mtime_ns, st.st_size)
    except OSError:
        key = None
    if key is not None and _TURN_BUDGET_CACHE.get("key") == key:
        return _TURN_BUDGET_CACHE["value"]
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8")) if key else {}
        v = int(data.get("turnBudget") or 100)
    except Exception:
        v = 100
    v = max(10, min(v, 400))
    if key is not None:
        _TURN_BUDGET_CACHE["key"] = key
        _TURN_BUDGET_CACHE["value"] = v
    return v


def _truncation_note(info, files):
    """无最终正文时的截断说明: 轮次耗尽与上游接口失败要分开表述。

    agent 只在真·轮次耗尽时把 error 写成"轮次上限"语义; 其余 error(限流 429/
    网络/Max tokens)是上游失败, 此前也被兜底文案说成"轮次预算已用完", 用户会
    去查自己从没设过的预算。"""
    _err = str(info.get("error") or "").strip()
    if _err and "轮次上限" not in _err:
        note = (
            "上游模型接口连续失败，任务被迫中断：\n"
            f"{_err[:200]}\n\n已完成的执行轨迹与产出都保留在上方，"
            "稍后发送『继续』即可从中断处接续执行。"
        )
    else:
        note = (
            "本轮的工具轮次预算已用完，任务在此预期内截断："
            "已完成的执行轨迹与产出都保留在上方，发送『继续』即可接续执行。"
        )
    if files:
        note += "\n\n本轮产出文件:\n" + "\n".join(f"- {f}" for f in files[:10])
    return note


def _nudge_threshold() -> int:
    """静默工具 nudge 阈值: 连续调用多少个工具不产出文字时注入提醒, 默认 10, 0 为禁用。

    前端设置页可调(存 settings.json 的 nudgeThreshold), mtime 缓存策略与
    turnBudget 一致, 设置变更即时生效。"""
    d = os.environ.get("SIGMAFLOW_SCIENCE_DIR") or os.path.join(
        os.path.expanduser("~"), ".sigmaflow", "science"
    )
    path = os.path.join(d, "settings.json")
    try:
        st = os.stat(path)
        key = (st.st_mtime_ns, st.st_size)
    except OSError:
        key = None
    if key is not None and _NUDGE_CACHE.get("key") == key:
        return _NUDGE_CACHE["value"]
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8")) if key else {}
        v = int(data["nudgeThreshold"])
    except Exception:
        v = 10
    v = max(0, min(v, 100))
    if key is not None:
        _NUDGE_CACHE["key"] = key
        _NUDGE_CACHE["value"] = v
    return v


def _tool_result_limit() -> int:
    """工具结果与块内容的入库截断上限: 前端设置页可调, 存放在 science 数据目录的 settings.json。

    会话持久化时每个工具结果/块都会调用一次; 按 settings.json 的
    mtime+size 缓存, 避免 upsert_conversation 内反复做文件 IO。
    """
    d = os.environ.get("SIGMAFLOW_SCIENCE_DIR") or os.path.join(
        os.path.expanduser("~"), ".sigmaflow", "science"
    )
    path = os.path.join(d, "settings.json")
    try:
        st = os.stat(path)
        key = (st.st_mtime_ns, st.st_size)
    except OSError:
        key = None
    if key is not None and _TOOL_LIMIT_CACHE.get("key") == key:
        return _TOOL_LIMIT_CACHE["value"]
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8")) if key else {}
        v = int(data.get("toolResultLimit") or 30000)
    except Exception:
        v = 30000
    v = max(2000, min(v, 30000))
    if key is not None:
        _TOOL_LIMIT_CACHE["key"] = key
        _TOOL_LIMIT_CACHE["value"] = v
    return v


class ToolLimitIn(BaseModel):
    limit: int = 30000


class TurnBudgetIn(BaseModel):
    limit: int = 100


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
    # title/projectId 为 None 时保留原值: 部分更新(如仅同步 content)不应
    # 把已有标题打回"新会话"、把项目归属清空
    title: Optional[str] = None
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


class MemorySettingsIn(BaseModel):
    # 跨会话记忆: recall=None 表示不修改
    recall: Optional[bool] = None


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


_FLY_URL_ENV = "SIGMAFLOW_FLY_URL"
_FLY_REPO_ENV = "SIGMAFLOW_FLY_REPO"


def _fly_base() -> str:
    """FlyChat 引擎基址(去尾斜杠)。"""
    return (os.environ.get(_FLY_URL_ENV) or "http://127.0.0.1:4116").rstrip("/")


def _fly_repo() -> str:
    """权重/部署脚本所在的 GitHub 仓库(一键部署入口, 可为 releases 页)。"""
    return os.environ.get(_FLY_REPO_ENV) or "https://github.com/maokangkun/flychat"


def _list_provider_models(base_url: str, api_key: str) -> dict:
    """Fetch the provider's model catalogue.

    OpenAI-dialect endpoints answer ``GET {base}/models``. Anthropic-dialect
    base URLs (path containing "anthropic", e.g. bigmodel's compat endpoint)
    answer ``{base}/v1/models`` with ``x-api-key`` headers instead. Gateways
    that wrap inner 404s in an HTTP 200 error body (bigmodel returns
    ``{"code":500,"msg":"404 NOT_FOUND"}`` with status 200) are detected and
    skipped to the next candidate instead of surfacing an empty list.
    """
    base = base_url.rstrip("/")
    attempts = []
    if "anthropic" in base.lower():
        if base.endswith("/v1"):
            attempts.append((base + "/models", True))
        else:
            attempts.append((base + "/v1/models", True))
            attempts.append((base + "/models", False))
    else:
        attempts.append((base + "/models", False))
    names, last_err = [], "无可用模型列表端点"
    for url, anthropic in attempts:
        headers = (
            {"x-api-key": api_key, "anthropic-version": "2023-06-01"}
            if anthropic
            else ({"Authorization": f"Bearer {api_key}"} if api_key else {})
        )
        try:
            resp = requests.get(url, headers=headers, timeout=15)
        except Exception as err:
            last_err = str(err)
            continue
        if resp.status_code != 200:
            last_err = f"HTTP {resp.status_code}"
            continue
        try:
            data = resp.json()
        except Exception:
            last_err = "响应不是 JSON"
            continue
        if isinstance(data, dict) and (
            data.get("success") is False or (data.get("code") and not data.get("data"))
        ):
            # 网关把内部 404/500 包成 200: 视为该端点不可用, 换下一个候选
            last_err = str(data.get("msg") or "网关返回错误")[:200]
            continue
        entries = data.get("data") if isinstance(data, dict) else data
        if isinstance(entries, list):
            for item in entries:
                if isinstance(item, dict) and item.get("id"):
                    names.append(str(item["id"]))
                elif isinstance(item, str):
                    names.append(item)
        if names:
            return {"ok": True, "models": sorted(set(names)), "error": None}
        last_err = "列表为空"
    return {"ok": False, "models": [], "error": last_err}


# ==================== LiteLLM 模型价格与上下文数据库 ====================
# 只读取 litellm 包内置的 model_prices 数据文件(500+ 模型的价格与上下文窗口),
# 不 import litellm 模块本身, 避免其启动开销; 数据缺失时所有查询静默降级。

_LITELLM_LOCK = threading.Lock()
# 断线孤儿 journal 的容量上限: 超出时按最旧淘汰(运行中的任务 journal
# 挂在活跃注册表上, 不占此区; 被淘汰的极端场景仍有服务端兑底归档兜底)
_CHAT_JOURNAL_MAX = 16
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
    # module 获取必须在锁外: _litellm_module 内部拿的是同一把
    # threading.Lock(不可重入), 锁内互调会在无 warm 的进程里自死锁
    # (生产进程启动期 warm 先行, module 已缓存走 fast path, 从未暴露)
    module = _litellm_module()
    with _LITELLM_LOCK:
        if _LITELLM_DB is not None:
            return _LITELLM_DB
        dicc: Dict[str, dict] = {}
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
    # 模型信息统一走 litellm; 库里也没有的私网模型落到保守默认值
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
        self.bak_path = self.path.with_name(self.path.name + ".bak")
        self.providers: Dict[str, dict] = {}
        self.models: Dict[str, dict] = {}
        self._load()

    def _load(self):
        data = {}
        # 主库优先, 损坏/缺失时回退上一版本 .bak: 单个损坏文件不再等于全库置零
        for _candidate in (self.path, self.bak_path):
            if not _candidate.exists():
                continue
            try:
                parsed = json.loads(_candidate.read_text(encoding="utf-8"))
            except Exception:
                continue
            if isinstance(parsed, dict):
                data = parsed
                break
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
        # 原子落盘(见 _atomic_save): 半截 JSON 会在 _load 时整库判废,
        # 是灾难性的全量丢失窗口; 上一版本轮转 .bak 供损坏回退。
        _atomic_save(
            self.path,
            json.dumps(
                {"providers": self.providers, "models": self.models},
                ensure_ascii=False,
                indent=2,
            ),
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
        # 活跃 chat.send 注册表: request_id -> {"runId": ...}。
        # chat.send 启动时登记, stream_chat 终态退出时注销;
        # 优雅停机时遍历它给"仍在跑"的会话写中断行, 防止任务无声丢失。
        self._active_runs: Dict[str, Dict[str, Any]] = {}
        # 断线孤儿 journal: 任务已在后台跑完但终态未送出的请求
        # (request_id -> state)。无期限保留至前端续播消费(消费即删)。
        self._chat_journals: Dict[str, Dict[str, Any]] = {}
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
        # MCP 入口给工具客户端用(服务进程内直连 127.0.0.1), 不带 cookie 依赖;
        # 端点内部自己做本机来源校验。
        mcp_router = APIRouter(prefix="/api")

        self._register_auth_routes(auth_router)

        self.ws_router = ws_router
        self.auth_router = auth_router
        self.mcp_router = mcp_router

        self._register_system_routes(router)

        self._register_fs_routes(router)

        self._register_chat_routes(router)

        self._register_admin_routes(router)

        self._register_conversation_routes(router)

        self._register_patenv_routes(router, mcp_router)
        self._register_pathenv_routes(router, mcp_router)

        self._register_pty_routes(router, ws_router)

        @router.on_event("startup")
        async def startup_event():
            await self.manager.start()
            # 侧栏「虚拟患者」「虚拟病原体」项目启动即就位, 会话才能落在固定项目里
            self._patenv_ensure_project()
            self._pathenv_ensure_project()
            # MCP 工具在 tools 模块 import 时接线, 而本服务自托管的 patenv MCP
            # 走 127.0.0.1:<自身端口>——此时端口可能还没监听, 首次列工具会落空。
            # 监听就绪后再重挂一次, 顺便把远端 MCP(rcsb/anysearch) 的临时失败补上。
            asyncio.create_task(asyncio.to_thread(_safe_rebuild_agent_mcp))

        @router.on_event("shutdown")
        async def shutdown_event():
            await self.manager.stop()
            # 优雅停机兜底: 仍在执行的对话落"服务重启中断"行,
            # 用户重连后能看到明确原因而不是只剩标题的黑箱空会话。
            self._interrupt_active_chats()

        self.router = router

    async def _chat_pump(
        self,
        ws: WebSocket,
        request_id: str,
        state: dict,
        start_seq: int,
    ) -> None:
        """journal 消费循环: 从 start_seq 起向连接推送事件直至终态。

        正常流与断线续播(chat.replay)共用本循环。事件先由工作线程累积进
        state["journal"]((kind, value) 元组), pump 以游标轮询消费并给每条
        消息标注 seq——前端记录最后收到的 seq, 重连后即可无损续播缺失的
        中间消息。send 失败(连接死亡)时静默退出, journal 随任务继续保留,
        任务的执行与终态兑底归档完全不受连接生命周期影响。
        """
        cursor = start_seq if isinstance(start_seq, int) and start_seq >= -1 else -1
        # 令牌抢占: 同一 state 同时只允许一个 pump 推送。chat.replay 再次
        # 到达时旧 pump 在下一个事件前发现令牌易主即静默退出, 防止重复
        # 流(如双标签页/重连竞态)把事件翻倍渲染
        state["pump_next"] = int(state.get("pump_next") or 0) + 1
        token = state["pump_next"]
        state["pump_token"] = token
        while True:
            # 停止请求(经 state 置位, 跨连接生效): 补发 stopped 终态
            if state.get("stop") and not state.get("terminal"):
                state["terminal"] = True
                state["stopped"] = True
                if len(state["journal"]) < 50000:
                    state["journal"].append(("done", {"stopped": True}))
            items = state["journal"][cursor + 1 :]
            if not items:
                if state.get("terminal") and cursor + 1 >= len(state["journal"]):
                    return
                await asyncio.sleep(0.05)
                continue
            for kind, value in items:
                if state.get("pump_token") != token:
                    # 已被更新的 pump 抢占: 本连接不再是权威订阅方
                    return
                cursor += 1
                if kind == "delta":
                    event, message = (
                        "chat.delta",
                        {
                            "event": "chat.delta",
                            "requestId": request_id,
                            "seq": cursor,
                            "data": {"delta": value},
                        },
                    )
                elif kind == "think":
                    event, message = (
                        "chat.think",
                        {
                            "event": "chat.think",
                            "requestId": request_id,
                            "seq": cursor,
                            "data": {"delta": value},
                        },
                    )
                elif kind == "tool":
                    event, message = (
                        "chat.tool",
                        {
                            "event": "chat.tool",
                            "requestId": request_id,
                            "seq": cursor,
                            "data": {"tool": value},
                        },
                    )
                elif kind == "progress":
                    event, message = (
                        "chat.progress",
                        {
                            "event": "chat.progress",
                            "requestId": request_id,
                            "seq": cursor,
                            "data": value or {},
                        },
                    )
                elif kind == "retry":
                    event, message = (
                        "chat.retry",
                        {
                            "event": "chat.retry",
                            "requestId": request_id,
                            "seq": cursor,
                            "data": {"retry": value},
                        },
                    )
                elif kind == "usage":
                    event, message = (
                        "chat.usage",
                        {
                            "event": "chat.usage",
                            "requestId": request_id,
                            "seq": cursor,
                            "data": value or {},
                        },
                    )
                elif kind == "system":
                    event, message = (
                        "chat.system",
                        {
                            "event": "chat.system",
                            "requestId": request_id,
                            "seq": cursor,
                            "data": {"content": value or ""},
                        },
                    )
                elif kind == "steer":
                    _sv = value if isinstance(value, dict) else {}
                    event, message = (
                        "chat.steer",
                        {
                            "event": "chat.steer",
                            "requestId": request_id,
                            "seq": cursor,
                            "data": {
                                "id": str(_sv.get("id") or ""),
                                "text": str(_sv.get("text") or ""),
                                "at": str(_sv.get("at") or ""),
                            },
                        },
                    )
                elif kind == "done":
                    _d = value if isinstance(value, dict) else {}
                    _stats = state.get("stats") or {}
                    event, message = (
                        "chat.done",
                        {
                            "event": "chat.done",
                            "requestId": request_id,
                            "seq": cursor,
                            "data": {
                                "content": "".join(state.get("content") or []),
                                "stopped": bool(
                                    _d.get("stopped") or state.get("stopped")
                                ),
                                "tokens": _stats.get("completion_tokens") or 0,
                                "promptTokens": _stats.get("prompt_tokens") or 0,
                                "contextTokens": _stats.get("last_prompt_tokens") or 0,
                                "cacheTokens": _stats.get("cache_read_tokens") or 0,
                            },
                        },
                    )
                else:
                    event, message = (
                        "error",
                        {
                            "event": "error",
                            "requestId": request_id,
                            "seq": cursor,
                            "data": {"error": value},
                        },
                    )
                try:
                    await ws.send_json(message)
                except Exception:
                    # 连接已死: journal 随任务保留, 等待重连续播
                    return
                if event in ("chat.done", "error"):
                    state["terminal"] = True
                    state["delivered"] = True
                    # 孤儿 journal 的续播至此完成, 消费即删。
                    # 优先按注册键删(生产路径); 键缺失时按 state 身份匹配
                    # (单测直接用平键挂 journal 的场景)
                    _jk = state.get("registry_key")
                    if _jk is None or self._chat_journals.get(_jk) is not state:
                        _jk = next(
                            (k for k, v in self._chat_journals.items() if v is state),
                            None,
                        )
                    self._chat_journals.pop(_jk, None)
                    return

    def _interrupt_active_chats(self) -> None:
        """停机时把仍活跃的对话写成中断行(见 shutdown_event)。

        只写"前端拿不到终态"的注册项: 正常终态投递后 stream_chat 已在
        finally 里注销, 不在此列。普通重启(改样式等)不再无声吞任务。
        """
        for _request_id, _info in list(self._active_runs.items()):
            _rid = str(((_info or {}).get("runId")) or "")
            if not _rid or _rid not in self.project_store.conversations:
                continue
            try:
                self.project_store.archive_assistant_row(
                    _rid,
                    {
                        "role": "assistant",
                        "content": "服务重启，任务已被中断。请重新发送以接续。",
                        "error": "服务重启，任务中断",
                    },
                )
            except Exception:
                # 停机路径尽力而为, 单会话失败不影响其余注册项
                pass
            finally:
                try:
                    self.project_store.set_conversation_status(_rid, "done")
                except Exception:
                    # 停机路径尽力而为, 状态归位失败不影响其余注册项
                    pass
        self._active_runs.clear()

    def _conversation_system_or_bind(self, conv: dict) -> str:
        """存量 systemPrompt 属性, 缺失时按当前配置惰性组装近似 bound。"""
        prompt = str(conv.get("systemPrompt") or "")
        # f-string 修复前入库的存量属性带未插值的 `{workdir}` 字面量,
        # 视同无效: 降级走惰性重组, 让 #0 系统条展示修正后的真目录
        if prompt and "`{workdir}`" not in prompt:
            return prompt
        try:
            pid = conv.get("projectId")
            pdir = (
                self.project_store.projects.get(pid or "", {}).get("dir")
                if pid
                else None
            )
            _last_user = next(
                (
                    str(r.get("content") or "")
                    for r in reversed(conv.get("content") or [])
                    if isinstance(r, dict) and r.get("role") == "user"
                ),
                "",
            )
            # 模型取会话最后一次回复所用模型(归档行带 model 字段), 缺省取默认模型
            _mdl = next(
                (
                    str(r.get("model") or "")
                    for r in reversed(conv.get("content") or [])
                    if isinstance(r, dict)
                    and r.get("role") == "assistant"
                    and r.get("model")
                ),
                "",
            ) or next(
                (
                    str(m.get("model") or "")
                    for m in self.model_store.models.values()
                    if m.get("isDefault")
                ),
                "",
            )
            _mctx = next(
                (
                    m.get("contextWindow")
                    for m in self.model_store.models.values()
                    if (m.get("model") or "") == _mdl and m.get("contextWindow")
                ),
                None,
            )
            return _bind_main_system(
                pdir, False, _last_user, model_name=_mdl, model_ctx=_mctx
            )
        except Exception:
            return ""

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

        # ---------------- 虚拟果蝇(FlyChat)引擎代理 ----------------
        # 引擎(全脑 LIF 仿真 + Qwen LoRA, 含 50GB 级权重)独立部署为常驻服务,
        # 不随 python 包分发; 本组路由只做同源代理(免 CORS + 隐藏内网地址)。
        # 地址/发布页均可经环境变量覆盖:
        #   SIGMAFLOW_FLY_URL   引擎基址(默认本机 4116, 即 flychat-web.service)
        #   SIGMAFLOW_FLY_REPO  权重与部署脚本所在的 GitHub 仓库(页面一键部署入口)
        @router.get("/fly/status")
        async def fly_status(request: Request):
            """探测引擎; 不可达时返回部署引导信息(前端渲染一键部署卡)。"""
            _check_origin(request)
            base = _fly_base()
            try:
                resp = await asyncio.to_thread(
                    requests.get, base + "/api/status", timeout=4.0
                )
                data = resp.json() if resp.status_code == 200 else {}
                return {
                    "ok": resp.status_code == 200,
                    "engine": base,
                    "repo": _fly_repo(),
                    "status": data,
                    "error": None
                    if resp.status_code == 200
                    else f"HTTP {resp.status_code}",
                }
            except Exception as err:
                return {
                    "ok": False,
                    "engine": base,
                    "repo": _fly_repo(),
                    "status": None,
                    "error": str(err)[:200],
                }

        @router.post("/fly/chat")
        async def fly_chat(payload: _FlyChatIn, request: Request):
            """对话一次(全脑仿真 + 前缀投影 + LLM 生成, 引擎内串行)。"""
            _check_origin(request)
            try:
                resp = await asyncio.to_thread(
                    requests.post,
                    _fly_base() + "/api/chat",
                    json={"text": payload.text},
                    timeout=600.0,
                )
                return resp.json()
            except Exception as err:
                raise HTTPException(
                    status_code=502, detail=f"果蝇引擎不可达：{str(err)[:150]}"
                )

        @router.post("/fly/reset")
        async def fly_reset(request: Request):
            _check_origin(request)
            try:
                resp = await asyncio.to_thread(
                    requests.post, _fly_base() + "/api/reset", timeout=15.0
                )
                return resp.json() if resp.content else {"ok": True}
            except Exception as err:
                raise HTTPException(
                    status_code=502, detail=f"果蝇引擎不可达：{str(err)[:150]}"
                )

        @router.get("/fly/activity")
        async def fly_activity(request: Request):
            """最近一个 token 子窗的全脑放电快照(3D 实时高亮轮询)。"""
            _check_origin(request)
            try:
                resp = await asyncio.to_thread(
                    requests.get, _fly_base() + "/api/activity", timeout=5.0
                )
                return resp.json()
            except Exception as err:
                raise HTTPException(
                    status_code=502, detail=f"果蝇引擎不可达：{str(err)[:150]}"
                )

        @router.get("/fly/data/meta.json")
        async def fly_meta(request: Request):
            """viewer 元数据(胞体坐标等, ~9MB JSON)。"""
            _check_origin(request)
            try:
                resp = await asyncio.to_thread(
                    requests.get, _fly_base() + "/data/meta.json", timeout=60.0
                )
                return Response(
                    content=resp.content,
                    media_type="application/json; charset=utf-8",
                    headers={"Cache-Control": "public, max-age=86400"},
                )
            except Exception as err:
                raise HTTPException(
                    status_code=502, detail=f"果蝇引擎不可达：{str(err)[:150]}"
                )

        @router.get("/fly/data/lod2/{chunk}")
        async def fly_lod2(chunk: str, request: Request):
            """LOD2 线框分块(懒加载, 仅放行 chunk_NNN.bin 形态的文件名)。"""
            _check_origin(request)
            if not re.fullmatch(r"chunk_\d{3}\.bin", chunk):
                raise HTTPException(status_code=400, detail="分块名无效")
            try:
                # 建连与逐块读取都放线程池: 阻塞 IO 留在事件循环里时, 引擎
                # 慢/断会把整个服务(聊天 WS 等)一起冻住最长 120s。
                upstream = await asyncio.to_thread(
                    requests.get,
                    _fly_base() + "/data/lod2/" + chunk,
                    stream=True,
                    timeout=120.0,
                )

                def gen():
                    try:
                        for part in upstream.iter_content(chunk_size=1 << 20):
                            yield part
                    finally:
                        upstream.close()

                return StreamingResponse(
                    # iterate_in_threadpool: 逐块读取放线程池(引擎慢/断时不冻事件循环)
                    iterate_in_threadpool(gen()),
                    media_type="application/octet-stream",
                    headers={"Cache-Control": "public, max-age=86400"},
                )
            except Exception as err:
                raise HTTPException(
                    status_code=502, detail=f"果蝇引擎不可达：{str(err)[:150]}"
                )

        @router.post("/fs/upload")
        async def fs_upload(payload: _FsUploadIn, request: Request):
            """上传一个文件到项目目录(base64, 不覆盖已有文件)。

            未关联项目时落到用户级暂存目录(science/uploads), 返回绝对路径。
            """
            _check_origin(request)
            project = self.project_store.projects.get(payload.projectId or "")
            if project is None and payload.projectId:
                raise HTTPException(status_code=404, detail="项目不存在")
            return await asyncio.to_thread(
                _fs_upload_payload, project, payload.name, payload.dataBase64
            )

        @router.post("/fs/op")
        async def fs_op(payload: _FsOpIn, request: Request):
            """文件浏览器右键菜单操作(规定动作白名单, 不开放任意 shell)。"""
            _check_origin(request)
            project = self.project_store.projects.get(payload.projectId or "")
            return await asyncio.to_thread(
                _fs_op_payload,
                project,
                payload.action or "",
                payload.src or "",
                payload.dst or "",
                payload.name or "",
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

        @router.post("/fs/mkdir")
        async def create_dir(payload: FsMkdirIn, request: Request):
            """项目目录浏览弹层里的「新建文件夹」: 浏览可达的任意目录下均可创建,
            名字仍做单段校验(禁止分隔符与点项), 目标父目录必须真实存在."""
            _check_origin(request)
            root = os.environ.get("SIGMAFLOW_PROJECTS_DIR") or os.path.expanduser("~")
            base = (
                os.path.realpath(os.path.expanduser(payload.path))
                if payload.path
                else os.path.realpath(root)
            )
            if not os.path.isdir(base):
                raise HTTPException(status_code=400, detail="目标目录不存在或不可访问")
            name = _clip(payload.name, 120).strip().strip("/")
            if not name or name in (".", ".."):
                raise HTTPException(status_code=400, detail="文件夹名称无效")
            if "/" in name or "\\" in name:
                raise HTTPException(
                    status_code=400, detail="文件夹名称不能包含路径分隔符"
                )
            target = os.path.join(base, name)
            try:
                os.makedirs(target, exist_ok=False)
            except FileExistsError:
                raise HTTPException(status_code=400, detail="同名文件夹已存在")
            except OSError as err:
                raise HTTPException(status_code=400, detail=f"创建失败：{err}")
            dirs, error = [], ""
            try:
                for entry in os.scandir(base):
                    if entry.is_dir() and not entry.name.startswith("."):
                        dirs.append({"name": entry.name, "path": entry.path})
            except OSError:
                error = "目录不存在或不可访问"
            dirs.sort(key=lambda d: d["name"].lower())
            return {
                "root": root,
                "path": base,
                "parent": os.path.dirname(base.rstrip("/")) or "/",
                "dirs": dirs,
                "created": name,
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
                content, _info = await asyncio.to_thread(
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
                    conversation_id=str(getattr(payload, "runId", "") or ""),
                )
            except RuntimeError as err:
                raise HTTPException(status_code=400, detail=str(err))
            return {
                "content": content,
                "tokens": stats.get("completion_tokens") or 0,
                "promptTokens": stats.get("prompt_tokens") or 0,
                "contextTokens": stats.get("last_prompt_tokens") or 0,
                "cacheTokens": stats.get("cache_read_tokens") or 0,
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
                # 设置页展示模板版: 动态值(home/workdir/model/window/memory)按占位符显示;
                # 记忆已关闭时预览不再展示 # Memory 段(与实际发送的提示词一致)
                tpl = _system_prompt_template()
                if not _memory_recall_enabled():
                    tpl = tpl.split("\n\n# Memory\n")[0]
                return tpl

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

        @router.get("/memory-settings")
        async def get_memory_settings():
            return {
                "memory": {"recall": await asyncio.to_thread(_memory_recall_enabled)}
            }

        @router.post("/memory-settings")
        async def save_memory_settings(payload: MemorySettingsIn, request: Request):
            _check_origin(request)
            if payload.recall is not None:
                await asyncio.to_thread(
                    _save_memory_config, {"recall": bool(payload.recall)}
                )
            return {
                "memory": {"recall": await asyncio.to_thread(_memory_recall_enabled)}
            }

        @router.get("/tool-result-limit")
        async def get_tool_result_limit():
            """查询工具结果入库截断上限(设置页展示)。"""
            return {"limit": await asyncio.to_thread(_tool_result_limit)}

        @router.post("/tool-result-limit")
        async def set_tool_result_limit(payload: ToolLimitIn, request: Request):
            """写回工具结果入库截断上限; 即时生效, 无需重启。"""
            _check_origin(request)
            v = max(2000, min(int(payload.limit or 30000), 30000))
            d = os.environ.get("SIGMAFLOW_SCIENCE_DIR") or os.path.join(
                os.path.expanduser("~"), ".sigmaflow", "science"
            )
            path = Path(d) / "settings.json"
            try:
                data = (
                    json.loads(path.read_text(encoding="utf-8"))
                    if path.exists()
                    else {}
                )
            except Exception:
                data = {}
            data["toolResultLimit"] = v
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(
                json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            return {"limit": v}

        @router.get("/turn-budget")
        async def get_turn_budget():
            """查询单次回复工具轮次上限(设置页展示)。"""
            return {"limit": await asyncio.to_thread(_turn_budget)}

        @router.post("/turn-budget")
        async def set_turn_budget(payload: TurnBudgetIn, request: Request):
            """写回工具轮次上限; 即时生效, 无需重启。"""
            _check_origin(request)
            v = max(10, min(int(payload.limit or 100), 400))
            d = os.environ.get("SIGMAFLOW_SCIENCE_DIR") or os.path.join(
                os.path.expanduser("~"), ".sigmaflow", "science"
            )
            path = Path(d) / "settings.json"
            try:
                data = (
                    json.loads(path.read_text(encoding="utf-8"))
                    if path.exists()
                    else {}
                )
            except Exception:
                data = {}
            data["turnBudget"] = v
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(
                json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            return {"limit": v}

        @router.get("/nudge-threshold")
        async def get_nudge_threshold():
            """查询静默工具 nudge 阈值(设置页展示)。"""
            return {"limit": await asyncio.to_thread(_nudge_threshold)}

        @router.post("/nudge-threshold")
        async def set_nudge_threshold(payload: TurnBudgetIn, request: Request):
            """写回静默工具 nudge 阈值; 即时生效, 0 表示禁用。"""
            _check_origin(request)
            v = max(
                0, min(int(payload.limit if payload.limit is not None else 10), 100)
            )
            d = os.environ.get("SIGMAFLOW_SCIENCE_DIR") or os.path.join(
                os.path.expanduser("~"), ".sigmaflow", "science"
            )
            path = Path(d) / "settings.json"
            try:
                data = (
                    json.loads(path.read_text(encoding="utf-8"))
                    if path.exists()
                    else {}
                )
            except Exception:
                data = {}
            data["nudgeThreshold"] = v
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(
                json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            return {"limit": v}

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
            window = _model_context_window(model_name)
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
        async def get_conversation_content(conversation_id: str, request: Request):
            conv = self.project_store.conversations.get(conversation_id)
            if conv is None:
                raise HTTPException(status_code=404, detail="Conversation not found")
            content = conv.get("content") or []
            out = {
                "id": conversation_id,
                "title": conv.get("title") or "",
                "projectId": conv.get("projectId"),
                "status": conv.get("status") or "done",
                # total 供前端分页循环判断进度; 不带分页参数仍是全量(兼容旧调用)
                "total": len(content),
                "content": content,
            }
            # 本次会话实际使用的 system 提示词(Trace 页 #0 系统条); 惰性组装不轻
            # 每页都算, 只有第一页带, 后续页前端沿用首页结果
            if not int(request.query_params.get("offset") or 0):
                out["systemPrompt"] = self._conversation_system_or_bind(conv)
            # 分块传输: offset/limit 切片, 大存档逐页拉逐步渲染
            try:
                _off = max(0, int(request.query_params.get("offset") or 0))
                _lim = max(0, int(request.query_params.get("limit") or 0))
            except Exception:
                _off = _lim = 0
            if _lim:
                # 分页参数协商: 条数上限由前端传, 字节上限由服务端兜底,
                # 前端按 rows.length 推进 offset 无需感知
                out["content"] = _conversation_page_rows(content, _off, _lim)
                out["offset"] = _off
                out["limit"] = _lim
            else:
                out["content"] = [_shape_conversation_row(x) for x in out["content"]]
            return out

        @router.delete("/conversations/{conversation_id}")
        async def delete_conversation(conversation_id: str, request: Request):
            _check_origin(request)
            if not self.project_store.delete_conversation(conversation_id):
                raise HTTPException(status_code=404, detail="Conversation not found")
            return {"conversations": self.project_store.list_conversations()}

        # ---------------- 网页展示台(webview 工具) ----------------
        # webview 工具的代理入口与本地预览路由; Cookie 罐在 agent/tools.py。
        @router.api_route(
            "/wv/{sid}", methods=["GET", "POST", "HEAD", "PUT", "DELETE", "OPTIONS"]
        )
        async def wv_proxy(sid: str, request: Request, u: str = ""):
            """反向代理目标页: 剥框架头 + HTML 同源改写 + 共享 Cookie 罐。"""
            _check_origin(request)
            if not u:
                return Response(content=_wv_expired_html(), media_type="text/html")
            from .science_admin import _agent_tools_module

            try:
                jars, lock = _agent_tools_module().webview_session_state()
            except Exception:
                jars, lock = None, None
            st = None
            if jars is not None:
                with lock:
                    st = jars.get(sid)
                    if st:
                        st["at"] = time.time()
            if st is None:
                return Response(content=_wv_expired_html(), media_type="text/html")
            sess = st["session"]
            method = "GET" if request.method == "HEAD" else request.method
            fwd = {
                k: v
                for k, v in request.headers.items()
                if k.lower() not in _WV_FWD_DROP
            }
            fwd.setdefault("Accept", "text/html,application/xhtml+xml,*/*")
            fwd["User-Agent"] = _agent_tools_module()._WEBVIEW_UA
            body = await request.body()

            def _do():
                return sess.request(
                    method,
                    u,
                    headers=fwd,
                    data=body or None,
                    timeout=30.0,
                    allow_redirects=True,
                )

            try:
                resp = await asyncio.to_thread(_do)
            except Exception as err:
                return Response(
                    content=(
                        "<!doctype html><meta charset='utf-8'><body"
                        f" style='font:14px/1.7 sans-serif;padding:32px;color:#b00'>"
                        f"无法访问目标页面：{str(err)[:200]}</body>"
                    ),
                    media_type="text/html",
                    status_code=200,
                )
            ctype = resp.headers.get("content-type", "")
            if "text/html" in ctype:
                try:
                    txt = resp.content.decode("utf-8", "replace")
                except Exception:
                    txt = ""
                html = _wv_inject_cf_banner(_wv_rewrite_html(txt, str(resp.url), sid))
                return Response(
                    content=html,
                    status_code=200,
                    headers={
                        "Content-Type": "text/html; charset=utf-8",
                        "Cache-Control": "no-store",
                    },
                )
            passthrough = {
                k.title(): v
                for k, v in resp.headers.items()
                if k.lower() not in _WV_STRIP_HEADERS
            }
            passthrough.setdefault("Cache-Control", "no-store")
            return Response(
                content=resp.content,
                status_code=resp.status_code,
                headers=passthrough,
            )

        @router.post("/wv/{sid}/cookies")
        async def wv_cookies(sid: str, payload: dict, request: Request):
            """Cookie 交接: 用户在真实浏览器完成强质询后, 把 Cookie 请求头
            交来注入服务端罐子(UA 一并同步), 模型的 webview_fetch 即可复用。"""
            _check_origin(request)
            cookie = str((payload or {}).get("cookie") or "").strip()
            ua = str((payload or {}).get("ua") or "").strip()
            if not cookie:
                raise HTTPException(status_code=400, detail="Cookie 为空")
            from .science_admin import _agent_tools_module

            try:
                count = _agent_tools_module()._webview_ingest_cookies(sid, cookie, ua)
            except Exception as err:
                raise HTTPException(status_code=500, detail=str(err)[:150])
            if count < 0:
                raise HTTPException(
                    status_code=404, detail="网页会话已过期，请让助手重新打开"
                )
            return {"ok": True, "cookies": count}

        @self.ws_router.websocket("/wv/live/{sid}")
        async def wv_live_ws(ws: WebSocket, sid: str):
            """browser-use 式真浏览器帧流: screencast JPEG 下行, 输入事件上行。"""
            origin = ws.headers.get("origin")
            host = ws.headers.get("host", "")
            if origin and origin not in (f"http://{host}", f"https://{host}"):
                await ws.close(code=1008)
                return
            if _multi_user():
                if not _cookie_user(ws):
                    await ws.close(code=1008)
                    return
            from .science_admin import _agent_tools_module

            m = _agent_tools_module()
            jars, lock = m._webview_live_state()
            with lock:
                live = jars.get(sid)
            if live is None or live.dead:
                await ws.accept()
                await ws.send_text(
                    json.dumps({"t": "err", "msg": "会话已过期，请让助手重新打开"})
                )
                await ws.close()
                return
            await ws.accept()
            loop = asyncio.get_event_loop()
            last_sig = [None]
            last_sent = [0.0]

            async def _sender():
                while True:
                    # 帧事件从 threading.Event 桥到 asyncio(线程池等 0.25s)
                    await loop.run_in_executor(None, live.frame_ev.wait, 0.25)
                    live.frame_ev.clear()
                    if live.dead:
                        await ws.send_text(json.dumps({"t": "done"}))
                        return
                    try:
                        frame = live.frames[-1]
                    except IndexError:
                        continue
                    sig = (frame[0][:32], frame[1], frame[2])
                    now = time.time()
                    # 同帧不重发; 最快 120ms 一帧
                    if sig == last_sig[0] and now - last_sent[0] < 1.5:
                        continue
                    last_sig[0], last_sent[0] = sig, now
                    await ws.send_text(
                        json.dumps(
                            {"t": "frame", "d": frame[0], "w": frame[1], "h": frame[2]}
                        )
                    )
                    await ws.send_text(
                        json.dumps({"t": "url", "url": live.cur_url[:500]})
                    )

            send_task = asyncio.create_task(_sender())
            try:
                while True:
                    raw = await ws.receive_text()
                    try:
                        cmd = json.loads(raw)
                    except Exception:
                        continue
                    if cmd.get("t") == "bye":
                        live.close()
                        break
                    if cmd.get("t") == "hello":
                        # 新连接/重连握手: 唤醒发送器立即下发当前帧
                        live.frame_ev.set()
                        continue
                    live.feed(cmd)
            except Exception:
                pass
            finally:
                send_task.cancel()
                try:
                    await ws.close()
                except Exception:
                    pass

        @router.get("/wv/file/{rel:path}")
        async def wv_file(rel: str, request: Request, projectId: str = ""):
            """本地 HTML 预览: 项目内(或绝对路径)文件按扩展名直出。"""
            _check_origin(request)
            project = self.project_store.projects.get(projectId or "")
            target = None
            # 绝对路径经 ~abs~ 哨兵前缀传递(路由 path 会吞掉开头的 /)
            if rel.startswith("~abs~/"):
                target = os.path.realpath(rel[len("~abs~") :])
                if is_protected_path(target):
                    raise HTTPException(status_code=403, detail="受保护的系统路径")
            else:
                base = str((project or {}).get("dir") or "").strip()
                if not base or not os.path.isdir(base):
                    raise HTTPException(status_code=404, detail="项目目录不存在")
                resolved, _root = _fs_resolve(base, rel)
                if resolved is None:
                    raise HTTPException(status_code=403, detail="越界路径")
                target = resolved
            if not os.path.isfile(target):
                raise HTTPException(status_code=404, detail="文件不存在")
            ext = os.path.splitext(target)[1].lower().lstrip(".")
            mtype = {
                "html": "text/html; charset=utf-8",
                "htm": "text/html; charset=utf-8",
                "css": "text/css; charset=utf-8",
                "js": "text/javascript; charset=utf-8",
                "mjs": "text/javascript; charset=utf-8",
                "json": "application/json; charset=utf-8",
                "svg": "image/svg+xml",
                "png": "image/png",
                "jpg": "image/jpeg",
                "jpeg": "image/jpeg",
                "gif": "image/gif",
                "webp": "image/webp",
                "ico": "image/x-icon",
                "mp3": "audio/mpeg",
                "wav": "audio/wav",
                "mp4": "video/mp4",
                "woff": "font/woff",
                "woff2": "font/woff2",
            }.get(ext, "application/octet-stream")
            if mtype == "application/octet-stream" and ext not in (
                "",
                "map",
                "txt",
                "csv",
            ):
                raise HTTPException(status_code=403, detail="该类型不支持预览")
            with open(target, "rb") as fh:
                data = fh.read()
            return Response(
                content=data,
                media_type=mtype,
                headers={"Cache-Control": "no-store"},
            )

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

    # ==================== 浏览器宿主型虚拟环境(患者 / 病原体) ====================
    # 两个环境的传输完全一致, 区别只在工具清单/提示词/侧栏项目与文案, 因此路由
    # 写一份、按 EnvSpec 参数化注册。页面是环境宿主: 注册会话 → 长轮询领调用 →
    # 在实时引擎上执行 → 回传结果; 智能体侧只看到 MCP 工具调用与结果。
    def _ensure_env_project(
        self, project_id: str, name: str, description: str, tags: list, icon: str
    ) -> str:
        """侧栏固定项目: 某个环境的会话都归到它下面(启动时补种)。"""
        try:
            if project_id not in self.project_store.projects:
                self.project_store.upsert_project(
                    ProjectIn(
                        id=project_id,
                        name=name,
                        description=description,
                        tags=list(tags),
                        icon=icon,
                    )
                )
        except Exception as err:  # 补种失败不影响运行
            logging.getLogger("uvicorn.error").info(
                "env project seed skipped (%s): %s", project_id, err
            )
        return project_id

    def _patenv_ensure_project(self) -> str:
        """侧栏固定项目「虚拟患者」: 所有病例挑战会话都归到这里。"""
        return self._ensure_env_project(
            PATIENT_PROJECT_ID,
            PATIENT_PROJECT_NAME,
            "AI 智能体在虚拟患者环境里做病例挑战的会话集合",
            ["虚拟患者", "病例挑战"],
            "patient",
        )

    def _pathenv_ensure_project(self) -> str:
        """侧栏固定项目「虚拟病原体」: 所有病原体实验会话都归到这里。"""
        return self._ensure_env_project(
            PATHOGEN_PROJECT_ID,
            PATHOGEN_PROJECT_NAME,
            "AI 智能体在虚拟病原体环境里做仿真实验的会话集合",
            ["虚拟病原体", "仿真实验"],
            "virus",
        )

    def _register_env_routes(
        self,
        router: APIRouter,
        mcp_router: APIRouter,
        *,
        hub,
        prefix: str,
        project_id: str,
        project_name: str,
        prompt_fn,
        page_title: str,
        ensure_project,
        groups: Optional[Dict[str, str]] = None,
    ) -> None:
        """浏览器(环境宿主)侧路由 + 智能体侧 MCP 路由。

        ``groups`` 非空时额外为每个分层建一个 MCP 端点 (``/<prefix>/mcp/<group>``),
        智能体可以只挂需要的尺度, 不必为整套工具付上下文。
        """
        groups = dict(groups or {})

        @router.post(f"/{prefix}/session")
        async def env_session(request: Request):
            _check_origin(request)
            try:
                body = await request.json()
            except Exception:
                body = {}
            if not isinstance(body, dict):
                body = {}
            pid = ensure_project()
            session = hub.register(_current_user())
            cid = str(body.get("conversationId") or "")
            conv = self.project_store.conversations.get(cid) if cid else None
            if conv is None:
                cid = ""
            session.conversation_id = cid
            content = (conv or {}).get("content") or []
            return {
                "sessionId": session.id,
                "conversationId": cid,
                "projectId": pid,
                "projectName": project_name,
                "pageTitle": page_title,
                "messages": [
                    {
                        "role": m.get("role"),
                        "content": str(m.get("content") or ""),
                        "tools": m.get("tools") or [],
                    }
                    for m in content
                    if isinstance(m, dict) and m.get("role") in ("user", "assistant")
                ],
                "tools": [tool["name"] for tool in hub.tools],
                "groups": {k: len(v) for k, v in groups.items()},
            }

        @router.get(f"/{prefix}/poll")
        async def env_poll(request: Request, sessionId: str = "", wait: float = 20):
            sid = sessionId.strip()
            if not sid:
                host_session = hub.host(_current_user())
                sid = host_session.id if host_session else ""
            if not sid:
                raise HTTPException(status_code=400, detail="没有活动的环境会话")
            # 显式 sessionId 校验属主: 会话 id 可枚举, 别人的正在等待的
            # 工具调用(含参数)不能被他人领走
            _sess = hub.get(sid)
            if _sess is None or _sess.user != _current_user():
                raise HTTPException(status_code=403, detail="无权访问该环境会话")
            call = await hub.next_call(sid, min(25.0, max(1.0, wait)))
            return {"call": call}

        @router.post(f"/{prefix}/result")
        async def env_result(request: Request):
            _check_origin(request)
            body = await request.json()
            # 回传也校验属主: 会话 id 可枚举, 不能替/给他人的调用提交结果
            _sess = hub.get(str(body.get("sessionId") or ""))
            if _sess is None or _sess.user != _current_user():
                raise HTTPException(status_code=403, detail="无权访问该环境会话")
            accepted = hub.submit(
                str(body.get("sessionId") or ""),
                str(body.get("id") or ""),
                {"ok": bool(body.get("ok")), "text": str(body.get("text") or "")},
            )
            return {"accepted": accepted}

        @router.post(f"/{prefix}/chat")
        async def env_chat(request: Request):
            """跑一轮智能体: 环境提示词 + MCP 工具, SSE 流式回传。"""
            _check_origin(request)
            body = await request.json()
            cid = str(body.get("conversationId") or "")
            text = str(body.get("text") or "").strip()
            if not text:
                raise HTTPException(status_code=400, detail="消息为空")
            conv = self.project_store.conversations.get(cid) or {}
            if not conv:
                # 首轮才落库: 会话只在真有消息时出现在侧栏项目里
                created = self.project_store.upsert_conversation(
                    ConversationIn(title=text[:60], projectId=ensure_project())
                )
                cid = created["id"]
                conv = self.project_store.conversations.get(cid) or {}
            host_session = hub.host(_current_user())
            if host_session is not None:
                host_session.conversation_id = cid
            history = [
                {"role": m.get("role"), "content": str(m.get("content") or "")}
                for m in (conv.get("content") or [])
                if isinstance(m, dict)
                and m.get("role") in ("user", "assistant")
                and str(m.get("content") or "").strip()
            ][-40:]
            messages = history + [{"role": "user", "content": text}]
            base_url, api_key, model_name = _resolve_chat(
                self.model_store, body.get("modelId")
            )
            host = hub.host(_current_user())
            loop = asyncio.get_running_loop()
            aq: asyncio.Queue = asyncio.Queue()
            stats: dict = {}
            asks: list = []

            def _emit(kind, value=None):
                loop.call_soon_threadsafe(aq.put_nowait, (kind, value))

            def _on_tool(ev):
                # ask 轮次要记住 id, 面板作答时据此投递; 其余工具事件原样透传
                if isinstance(ev, dict):
                    if ev.get("kind") == "ask" and ev.get("id"):
                        asks.append(str(ev["id"]))
                    if ev.get("kind") == "progress":
                        return  # 心跳不渲染
                _emit("tool", ev)

            extra = prompt_fn() + (
                "\n\n## 本轮环境\n- 环境连接: "
                + (
                    "已连接, 工具直接读改浏览器里的实时引擎"
                    if host
                    else f"未连接 —— 先请用户打开「{page_title}」页并保持 AI 面板开着"
                )
                + "\n- 会话 ID: "
                + (cid or "-")
            )

            def work():
                try:
                    _run_agent_chat(
                        base_url,
                        api_key,
                        model_name,
                        messages,
                        on_delta=lambda d: _emit("delta", d),
                        on_reasoning=lambda r: _emit("think", r),
                        on_tool=_on_tool,
                        stats=stats,
                        workdir=None,
                        plan_mode=False,
                        conversation_id=cid,
                        system_extra=extra,
                    )
                except Exception as err:
                    _emit("error", str(err))
                finally:
                    _emit(
                        "done",
                        {
                            "tokens": stats.get("completion_tokens") or 0,
                            "promptTokens": stats.get("prompt_tokens") or 0,
                            "askIds": asks,
                            "conversationId": cid,
                        },
                    )

            threading.Thread(target=work, daemon=True).start()

            async def event_stream():
                while True:
                    try:
                        kind, payload = await asyncio.wait_for(aq.get(), timeout=15)
                    except asyncio.TimeoutError:
                        yield ": keepalive\n\n"  # 长工具等待期间保活
                        continue
                    if kind == "done":
                        yield f"event: done\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"
                        return
                    if kind == "error":
                        yield f"event: error\ndata: {json.dumps({'detail': payload}, ensure_ascii=False)}\n\n"
                        continue
                    yield f"event: {kind}\ndata: {json.dumps({'text': payload} if kind in ('delta', 'think') else payload, ensure_ascii=False)}\n\n"

            return StreamingResponse(
                event_stream(),
                media_type="text/event-stream",
                headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
            )

        @router.post(f"/{prefix}/answer")
        async def env_answer(request: Request):
            _check_origin(request)
            body = await request.json()
            try:
                ok = _agent_tools_module().ASK.answer(
                    str(body.get("id") or ""), body.get("answers")
                )
            except Exception:
                ok = False
            return {"answered": bool(ok)}

        async def _mcp_endpoint(request: Request, group: str = ""):
            """MCP 入口(仅本机): 服务进程内的 MCP 客户端直连 127.0.0.1。"""
            client = getattr(request, "client", None)
            host = getattr(client, "host", "") if client else ""
            if host not in ("127.0.0.1", "::1", "localhost"):
                raise HTTPException(
                    status_code=403, detail=f"{prefix} MCP is local-only"
                )
            payload = await request.json()
            if not isinstance(payload, dict):
                raise HTTPException(status_code=400, detail="invalid JSON-RPC payload")
            if str(payload.get("method") or "") == "tools/call":
                return await hub.mcp_call(_current_user(), payload, group or None)
            return hub.mcp_handle(_current_user(), payload, group or None)

        mcp_router.add_api_route(f"/{prefix}/mcp", _mcp_endpoint, methods=["POST"])
        for group in groups:
            # 分层端点必须用带注解的真实函数注册: FastAPI 按签名解析参数,
            # lambda 里的 request 没有 Request 注解会被当成必填查询参数(422)。
            def _make(group: str = group):
                async def handler(request: Request):
                    return await _mcp_endpoint(request, group)

                return handler

            mcp_router.add_api_route(
                f"/{prefix}/mcp/{group}", _make(), methods=["POST"]
            )

    def _register_patenv_routes(self, router: APIRouter, mcp_router: APIRouter) -> None:
        self._register_env_routes(
            router,
            mcp_router,
            hub=PATENV_HUB,
            prefix="patenv",
            project_id=PATIENT_PROJECT_ID,
            project_name=PATIENT_PROJECT_NAME,
            prompt_fn=patient_agent_prompt,
            page_title="虚拟患者",
            ensure_project=self._patenv_ensure_project,
        )

    def _register_pathenv_routes(
        self, router: APIRouter, mcp_router: APIRouter
    ) -> None:
        self._register_env_routes(
            router,
            mcp_router,
            hub=PATHENV_HUB,
            prefix="pathenv",
            project_id=PATHOGEN_PROJECT_ID,
            project_name=PATHOGEN_PROJECT_NAME,
            prompt_fn=pathogen_agent_prompt,
            page_title="虚拟病原体",
            ensure_project=self._pathenv_ensure_project,
            groups=PATHENV_GROUPS,
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
                            # 与 HTTP 路由一致: 实发 system 提示词(缺属性时惰性组装)
                            "systemPrompt": self._conversation_system_or_bind(conv),
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
                    # 按 runId 停止: requestId 只存在于页面连接内存, 刷新后的
                    # 页面拿不到; 服务端注册表记录了 runId, 据此仍能停掉在途任务
                    _stop_runid = _clip(str(data.get("runId") or ""), 64)
                    if _stop_runid:
                        _user = _current_user()
                        _stopped_any = False
                        for _k, _rec in list(self._active_runs.items()):
                            if _k[0] != _user or _rec.get("runId") != _stop_runid:
                                continue
                            _st = _rec.get("state")
                            if isinstance(_st, dict):
                                _st["stop"] = True
                                _stopped_any = True
                            for ask_id in chat_asks.pop(_k[1], ()) or ():
                                try:
                                    _agent_tools_module().ASK.cancel(ask_id)
                                except Exception:
                                    pass
                        await reply(
                            "chat.stop.ack",
                            request_id,
                            {"stopped": _stopped_any, "runId": _stop_runid},
                        )
                        return
                    # 置位停止标记, pump 据此合成 done(stopped=true) 终态并收割:
                    # 工作线程不强制杀死(工具轮次自然收尾), 但前端在收到终态前
                    # 一直停在"停止中"。旧 chat_stops dict 已无消费方, 新链路全
                    # 走 per-run state["stop"]。
                    if request_id in chat_stops:
                        chat_stops[request_id] = True
                    _stop_key = (_current_user(), request_id)
                    _stop_rec = self._active_runs.get(_stop_key)
                    if not isinstance(_stop_rec, dict):
                        _stop_st = self._chat_journals.get(_stop_key)
                    else:
                        _stop_st = _stop_rec.get("state")
                    if isinstance(_stop_st, dict):
                        _stop_st["stop"] = True
                    # 未回答的 ask 一并取消, 让阻塞的工具线程立刻返回
                    for ask_id in chat_asks.pop(request_id, ()) or ():
                        try:
                            _agent_tools_module().ASK.cancel(ask_id)
                        except Exception:
                            pass
                    await reply("chat.stop.ack", request_id, {"stopped": True})
                elif action == "chat.replay":
                    # 断线续播: 前端携带最后收到的 seq 重连后按原 requestId
                    # 申请从断点继续推送, 中途缺失的事件无损补齐。
                    # 注册键含登录用户(见 chat.send 处注释): 他人的同号
                    # requestId 既覆盖不了注册项、也取不到 journal
                    _replay_key = (_current_user(), request_id)
                    _info = self._active_runs.get(_replay_key) or {}
                    _state = _info.get("state") if isinstance(_info, dict) else None
                    if not isinstance(_state, dict):
                        _state = self._chat_journals.get(_replay_key)
                    if not isinstance(_state, dict) or "journal" not in _state:
                        await fail(
                            request_id,
                            "该任务已在服务端结束或不存在，无法续播；将从会话存档同步最新内容",
                        )
                        return
                    try:
                        _last_seq = int(data.get("lastSeq", -1))
                    except (TypeError, ValueError):
                        _last_seq = -1
                    _replay = asyncio.create_task(
                        self._chat_pump(ws, request_id, _state, _last_seq)
                    )
                    chat_tasks.add(_replay)
                    _replay.add_done_callback(chat_tasks.discard)
                elif action == "chat.steer":
                    # pi 式引导: 会话仍在流式时把用户新消息排进该会话的
                    # steer 队列, 由 agent 在当前回合(工具批)结束、下一次
                    # 模型调用前注入 —— 不再并发跑第二个交叉回复。事件回显
                    # 进 journal, 所有订阅端(含发送者)以同一条 user 消息渲染。
                    _steer_text = _clip(
                        str(data.get("text") or "").strip(), 6000
                    )
                    _steer_run = str(data.get("runId") or "")
                    # steerId: 引导行的唯一标识 —— 前端按它去重(journal 回显与
                    # 断线重放各送达一次时不会渲染两条), 存档行也带(刷新后徽章
                    # 与去重依据都在)
                    _steer_id = f"steer-{uuid.uuid4().hex[:10]}"
                    if not _steer_text or not _steer_run:
                        await reply("error", request_id, "引导消息为空")
                    else:
                        _hit_state = None
                        for _k, _v in self._active_runs.items():
                            if (
                                _k[0] == _current_user()
                                and _v.get("runId") == _steer_run
                            ):
                                _st = _v.get("state") or {}
                                if not _st.get("terminal"):
                                    _hit_state = _st
                                    break
                        if _hit_state is None:
                            await reply(
                                "error",
                                request_id,
                                "该会话当前没有正在进行的回复，可直接发送。",
                            )
                        else:
                            _hit_state.setdefault("steer", []).append(_steer_text)
                            if len(_hit_state["journal"]) < 50000:
                                _hit_state["journal"].append(
                                    (
                                        "steer",
                                        {
                                            "id": _steer_id,
                                            "text": _steer_text,
                                            "at": _dtmod.datetime.now().isoformat(
                                                timespec="milliseconds"
                                            ),
                                        },
                                    )
                                )
                            # 引导消息即落库(与 chat.send 的 user 行同路径):
                            # 刷新/断线重连后从存档也能看到这条插话
                            try:
                                self.project_store.archive_user_row(
                                    _steer_run,
                                    _steer_text,
                                    steering=True,
                                    steer_id=_steer_id,
                                )
                            except Exception:
                                pass
                            await reply(
                                "steer.ack",
                                request_id,
                                {"queued": len(_hit_state["steer"])},
                            )
                elif action == "chat.send":
                    # 同会话在途回复互斥(steering 的服务端兜底): 前端已在流式期间
                    # 把新消息转 chat.steer, 这里拦截的是竞态残留 —— 刷新恢复窗口、
                    # noSteer 回退、双标签页同时发送等, 否则两个 agent 交叉写同一
                    # 会话(两条回复互相穿插)。引导场景应走 chat.steer。
                    _dup_run = str(data.get("runId") or "")
                    if _dup_run:
                        for _k, _v in self._active_runs.items():
                            if (
                                _k[0] == _current_user()
                                and _v.get("runId") == _dup_run
                                and not (_v.get("state") or {}).get("terminal")
                            ):
                                await fail(
                                    request_id,
                                    "该会话已有回复正在生成，请等它完成或用引导消息插入（生成期间直接发送即引导）。",
                                )
                                return
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
                    # user 消息发送即落库: 此前只有 done 时前端才整表归档,
                    # 服务重启/进程中断会把"用户问了什么"一并丢成空会话。
                    try:
                        _last_user = next(
                            (
                                m
                                for m in reversed(messages)
                                if m.get("role") == "user"
                                and str(m.get("content") or "").strip()
                            ),
                            None,
                        )
                        if _last_user is not None:
                            self.project_store.archive_user_row(
                                str(data.get("runId") or ""),
                                str(_last_user.get("content") or ""),
                            )
                    except Exception:
                        # 归档失败不阻断发送主流程
                        pass
                    # per-request 事件 journal: work 线程只管把事件按序
                    # 追加进 state["journal"], pump 以游标消费推送。断线不
                    # 影响任务执行, 重连后 chat.replay 从最后收到的 seq 续
                    # 播, 中途缺失的消息无损补齐。
                    stats: dict = {}
                    state: Dict[str, Any] = {
                        "journal": [],
                        "content": [],
                        "stats": stats,
                        "steer": [],  # 排队中的引导插话(chat.steer 写入, agent 轮询取走)
                        "terminal": False,
                        "stopped": False,
                        "delivered": False,
                        "stop": False,
                        "pump_token": 0,
                        "pump_next": 0,
                    }
                    # 注册表按(用户, requestId)复合键: WS 的 requestId 是各连接
                    # 自增的小整数, 平键下并发用户的 "3" 会互相覆盖注册项、
                    # 猜中即可劫持他人在途对话的 journal 续播流。
                    _run_key = (_current_user(), request_id)
                    state["registry_key"] = _run_key
                    _run_id = str(data.get("runId") or "")
                    self._active_runs[_run_key] = {
                        "runId": _run_id,
                        "state": state,
                    }
                    # 运行状态是服务端事实: 页面刷新/关闭不影响任务, 前端
                    # 重新加载会话列表时据此对齐"运行中/已结束"显示
                    self.project_store.set_conversation_status(_run_id, "running")

                    # 工作线程阻塞产出事件, 经 _emit 累积进 journal
                    async def stream_chat() -> None:
                        def work():
                            t0 = time.time()

                            def _emit(kind, value=None):
                                # 事件入 journal: cap 防御极端长流(超限后
                                # 续播已无意义); GIL 下 list.append 线程安全
                                if len(state["journal"]) >= 50000:
                                    return
                                state["journal"].append((kind, value))

                            archive_last = [0.0]

                            def _partial_archive(force=False):
                                # 流式快照节流落库: 刷新页面也能从存档看到已生成的
                                # 部分内容; 终态行由收尾处的最终 upsert 原位替换
                                now = time.time()
                                if not force and now - archive_last[0] < 3.0:
                                    return
                                archive_last[0] = now
                                try:
                                    row = _archive_row_from_journal(state, model_name)
                                    if row:
                                        self.project_store.archive_streaming_row(
                                            str(data.get("runId") or ""), row
                                        )
                                except Exception:
                                    pass  # 快照落库失败不影响对话主流程

                            def on_delta(d):
                                # 正文在 emit 侧累积, 断线期间 pump 消费
                                # 不工作也不影响兑底归档取到完整正文
                                state["content"].append(d)
                                _emit("delta", d)
                                _partial_archive()

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
                                if (
                                    isinstance(ev, dict)
                                    and ev.get("kind") == "progress"
                                ):
                                    # 长工具心跳: 单独事件类型, 前端只保活不进块
                                    _emit(
                                        "progress",
                                        {
                                            "name": ev.get("name"),
                                            "elapsed": ev.get("elapsed"),
                                        },
                                    )
                                    return
                                _emit("tool", ev)
                                # 工具收尾(带结果)强制落一次快照: 工具块是刷新
                                # 恢复观感的关键节点, 不等 3s 节流窗口
                                if isinstance(ev, dict) and ev.get("kind") == "result":
                                    _partial_archive(force=True)

                            _agent_info_holder = {"info": None}
                            _except_err = None

                            def _steer_poll():
                                # 排空引导队列(GIL 下 list 赋值原子, 与 chat.steer
                                # 的 append 不会丢项); agent 在回合边界取走
                                _items = state.get("steer") or []
                                state["steer"] = []
                                return _items

                            try:
                                # _stream_agent_chat 返回 (text, info): info 携工具轨迹,
                                # 前端断线时兑底归档要用
                                # 私网模型 LiteLLM 库无条目: 用 store 显式配置的
                                # contextWindow 作为窗口 override, 避免"当前模型"段
                                # 落到 131072 默认值与实际不符
                                _ctx_hit = next(
                                    (
                                        m.get("contextWindow")
                                        for m in self.model_store.models.values()
                                        if (m.get("model") or "") == model_name
                                        and m.get("contextWindow")
                                    ),
                                    None,
                                )
                                _final_text, _agent_info_holder["info"] = (
                                    _stream_agent_chat(
                                        base_url,
                                        api_key,
                                        model_name,
                                        messages,
                                        on_delta,
                                        lambda t: _emit("think", t),
                                        on_tool_wrap,
                                        lambda r: _emit("retry", r),
                                        stats,
                                        chat_workdir,
                                        bool(data.get("planMode")),
                                        lambda u: _emit("usage", u),
                                        model_ctx=_ctx_hit,
                                        conversation_id=str(data.get("runId") or ""),
                                        steer_poll=_steer_poll,
                                    )
                                )
                                _agent_info = (
                                    _agent_info_holder["info"]
                                    if isinstance(_agent_info_holder["info"], dict)
                                    else {}
                                )
                                # 实发 system 提示词: 落库(会话属性, Trace #0 行)
                                # 并推给在线前端; 幂等写, 每轮携带相同文本
                                _sys_prompt = str(_agent_info.get("system") or "")
                                if _sys_prompt:
                                    try:
                                        self.project_store.set_conversation_system(
                                            str(data.get("runId") or ""), _sys_prompt
                                        )
                                        _emit("system", _sys_prompt)
                                    except Exception:
                                        pass
                                # 服务端终态(轮次预算耗尽/重试耗尽/Max tokens)不能静默 done:
                                # 原因要随 error 事件带回前端, 否则用户只看到工具轨迹
                                # 戛然而止, 不知道循环为什么退出; 无模型正文时
                                # _run_agent_chat 生成的进度说明作为尾段 delta 补发
                                # (有正文时正文早已流式送达, 不能重复发)
                                # 终态语义分流: 轮次预算耗尽是预期内截断, 补偿说明
                                # 作为正文流出、终态走 done; 上游接口连续失败是真错误,
                                # 完整说明(含原始错误与接续指引)必须以红错块呈现,
                                # 混进正文流会让失败看起来像正常回复
                                _budget_cut = "轮次上限" in str(
                                    _agent_info.get("error") or ""
                                )
                                _note_served = bool(
                                    _budget_cut
                                    and not _agent_info.get("last_response")
                                    and _final_text
                                    and _final_text.strip()
                                )
                                if _agent_info.get("error"):
                                    if _note_served:
                                        on_delta(_final_text)
                                    if not state["terminal"]:
                                        if _note_served:
                                            _emit("done", {})
                                        elif _budget_cut:
                                            _emit("error", _agent_info["error"])
                                        else:
                                            _emit(
                                                "error",
                                                _final_text or _agent_info["error"],
                                            )
                                elif not state["terminal"]:
                                    _emit("done", {})
                            except Exception as err:
                                if not state["terminal"]:
                                    _emit("error", str(err))
                                _except_err = str(err)
                            # 终态事件已入 journal。pump 在线时会把它送达前端, 前端收到
                            # done/error 后自行归档完整行; 此时服务端再 append 一行就是
                            # 「前端同步先落、worker 归档后到」的双行竞态, 而尾条查重只拦
                            # 无块的纯文本行。因此兑底归档只在「前端拿不到终态」时进行:
                            # 连接断开(pump 死信)或用户主动停止(前端归档停止态)。
                            # 短等待是给 pump 的投递窗口, 在线时毫秒级置位即返回。
                            _deadline = time.time() + 1.5
                            while (
                                time.time() < _deadline
                                and not state["delivered"]
                                and not state.get("stop")
                            ):
                                time.sleep(0.05)
                            # 投递成功 ≠ 落库: 前端可能死在「收到终态 →
                            # conversation.save 归档」的缝隙里(刷新/被杀/断网),
                            # 此前 worker 已让位退出, 回复将永久丢失。
                            # 因此投递成功后进入观察窗: 等存档里本轮出现
                            # assistant 尾行(前端归档的证据), 逾期未见则兑底
                            # 补写。多补无害——前端若存活, 它的整表归档最终
                            # 覆盖一切; 前端已死, 兜底行就是唯一幸存。
                            _need_fallback = False
                            if not state.get("stop"):
                                if not state["delivered"]:
                                    _need_fallback = True
                                else:
                                    _rid_v = str(data.get("runId") or "")
                                    _verify_until = time.time() + 2.5
                                    while (
                                        time.time() < _verify_until
                                        and not state.get("stop")
                                        and not _conversation_replied(
                                            self.project_store, _rid_v
                                        )
                                    ):
                                        time.sleep(0.1)
                                    if not state.get(
                                        "stop"
                                    ) and not _conversation_replied(
                                        self.project_store, _rid_v
                                    ):
                                        # 观察窗耗尽仍未归档: 前端大概率死在缝隙里
                                        _need_fallback = True
                            if _need_fallback:
                                # 服务端兑底存档: 前端断线(关闭/刷新)期间 agent 在后台
                                # 跑完时, 把结果直接落进会话存储, 用户重连回放即可看到。
                                # 走 store 的 archive_assistant_row: 与前端同步共用互斥
                                # 锁, 避免读旧内容整体覆写吞掉并发追加
                                try:
                                    _now_ms = int(time.time() * 1000)
                                    _fb_info = (
                                        _agent_info_holder["info"]
                                        if isinstance(_agent_info_holder["info"], dict)
                                        else {}
                                    )
                                    # 兜底行也要带上思考/工具轨迹块, 否则前端断线重连后
                                    # 只看到一句正文, 中间的执行记录全丢
                                    self.project_store.archive_assistant_row(
                                        str(data.get("runId") or ""),
                                        {
                                            "role": "assistant",
                                            "content": _clip(
                                                "".join(state["content"]), 20000
                                            )
                                            or _clip(
                                                str(
                                                    _fb_info.get("last_response") or ""
                                                ),
                                                20000,
                                            ),
                                            "blocks": _blocks_from_agent_info(_fb_info)
                                            if _fb_info
                                            else None,
                                            # 截停/异常原因一并持久化, 回放时错误块可见;
                                            # 预期内截断(说明已作正文)例外, 保持在线/回放一致
                                            "error": None
                                            if _note_served
                                            else (
                                                _except_err
                                                or (
                                                    _final_text
                                                    if not _budget_cut
                                                    else None
                                                )
                                                or (
                                                    _fb_info.get("error")
                                                    if _fb_info
                                                    else None
                                                )
                                                or None
                                            ),
                                            "at": time.strftime(
                                                "%Y-%m-%dT%H:%M:%S.000Z",
                                                time.gmtime(_now_ms / 1000.0),
                                            ),
                                            "tokens": stats.get("completion_tokens")
                                            or 0,
                                            "promptTokens": stats.get("prompt_tokens")
                                            or 0,
                                            "contextTokens": stats.get(
                                                "last_prompt_tokens"
                                            )
                                            or 0,
                                            "cacheTokens": stats.get(
                                                "cache_read_tokens"
                                            )
                                            or 0,
                                            "elapsed": int((time.time() - t0) * 1000),
                                            "model": model_name,
                                        },
                                    )
                                except Exception:
                                    pass

                        # to_thread 在默认执行器中运行 work, 不阻塞事件循环
                        worker = asyncio.create_task(asyncio.to_thread(work))

                        async def _finalize_run() -> None:
                            """worker 终止后立即收尾(终态行/状态收敛/注册注销)。

                            不等 pump: pump 可能长期阻塞在向已死连接的 send 上
                            (TCP 重传超时以十分钟计), 收尾被它拖住期间注册表残留
                            已结束的任务, 停机清扫会给早已完成的会话误写
                            "服务重启中断"行(run-dcb61010 事故)。
                            """
                            try:
                                await worker
                            except BaseException:
                                # work 抛错(如重试耗尽的网关错误)同样走收尾:
                                # 跳过会让存档尾行永远停在 streaming 残影
                                pass
                            finally:
                                # 终态落库: 完整 journal 合成终态行(streaming=False),
                                # 原位替换流式快照行——刷新过页面的用户再次拉存档
                                # 即得到最终完整内容(正常完成/停止/出错都适用)
                                try:
                                    row = _archive_row_from_journal(
                                        state, model_name, streaming=False
                                    )
                                    if row:
                                        self.project_store.archive_streaming_row(
                                            str(data.get("runId") or ""), row
                                        )
                                except Exception:
                                    pass
                                chat_stops.pop(request_id, None)
                                # 活跃注销: 正常终态投递后停机不再写中断行
                                self._active_runs.pop(state.get("registry_key"), None)
                                # 会话运行状态收敛为 done(正常完成/停止/出错都是终态);
                                # 同一会话还有另一个在途请求时保留 running
                                _still = any(
                                    k[0] == _current_user()
                                    and (rec or {}).get("runId") == _run_id
                                    for k, rec in self._active_runs.items()
                                )
                                if not _still:
                                    self.project_store.set_conversation_status(
                                        _run_id, "done"
                                    )
                                # 流结束(含停止后的收尾)时取消该请求残留的未答 ask
                                for ask_id in chat_asks.pop(request_id, ()) or ():
                                    try:
                                        _agent_tools_module().ASK.cancel(ask_id)
                                    except Exception:
                                        pass
                                if not state["delivered"]:
                                    # 断线孤儿: 任务已在后台跑完但终态未送出。
                                    # journal 无期限保留, 前端续播消费即删; 仅以
                                    # 容量上限 LRU 淘汰防长期运行泄漏, 被淘汰的
                                    # 极端场景仍有服务端兑底归档与存档合并兜底。
                                    self._chat_journals[state.get("registry_key")] = (
                                        state
                                    )
                                    while len(self._chat_journals) > _CHAT_JOURNAL_MAX:
                                        self._chat_journals.pop(
                                            next(iter(self._chat_journals)), None
                                        )

                        finalizer = asyncio.create_task(_finalize_run())
                        chat_tasks.add(finalizer)
                        finalizer.add_done_callback(chat_tasks.discard)
                        await self._chat_pump(ws, request_id, state, -1)
                        # pump 返回(连接关闭/令牌抢占)后即结束: 终态收尾已由
                        # _finalize_run 承担, 不再依赖本协程等待 worker

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
                # 注意: 不 cancel chat_tasks(后台 agent 流)。同步线程无法被 cancel 终止,
                # 但 cancel 会关掉它正在读的 httpx 流式响应 → GeneratorExit(BaseException)
                # 逃过所有 except Exception → agent 循环静默死亡, 前端表现
                # 为“最后一张工具卡后停止”(run-39e29a61 事故)。聊天流与连接解耦,
                # 断开由 chat_stops/ASK.cancel(下两条)处理。
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


class _FlyChatIn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


class _FsUploadIn(BaseModel):
    projectId: str = ""
    name: str = Field(min_length=1, max_length=200)
    dataBase64: str = Field(min_length=4, max_length=46_000_000)


class FsMkdirIn(BaseModel):
    path: str = Field(default="", max_length=2000)
    name: str = Field(default="", max_length=120)


class _FsOpIn(BaseModel):
    projectId: Optional[str] = None
    action: Optional[str] = None
    src: Optional[str] = None
    dst: Optional[str] = None
    name: Optional[str] = None


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
        self.bak_path = self.path.with_name(self.path.name + ".bak")
        self.projects: Dict[str, dict] = {}
        self.conversations: Dict[str, dict] = {}
        # 会话内容互斥写锁: conversation.save(前端同步,HTTP to_thread)与
        # WS 后台归档(stream_chat worker 线程)是并发的两路写者,
        # 不加锁时"读旧内容→整体覆写"会互相吞掉对方的追加。
        self._lock = threading.Lock()
        self._load()
        # 会话运行状态由服务端进程维护: 进程重启后工作线程不复存在,
        # 存档里残留的 running 状态全部归位为 done, 避免前端永远显示"运行中"
        self.reset_running_statuses()

    def reset_running_statuses(self) -> None:
        """把残留的 running 会话状态归位为 done(进程重启清扫)。"""
        changed = False
        for conv in self.conversations.values():
            if conv.get("status") == "running":
                conv["status"] = "done"
                changed = True
        if changed:
            self._save()

    def set_conversation_status(self, conversation_id: str, status: str) -> None:
        """维护会话运行状态(running/done), 前端刷新后据此对齐本地显示。"""
        with self._lock:
            conv = self.conversations.get(conversation_id or "")
            if not conv or conv.get("status") == status:
                return
            conv["status"] = status
            self._save()

    def _load(self):
        data = {}
        # 主库优先, 损坏/缺失时回退上一版本 .bak(见 _atomic_save 的轮转语义)
        for _candidate in (self.path, self.bak_path):
            if not _candidate.exists():
                continue
            try:
                parsed = json.loads(_candidate.read_text(encoding="utf-8"))
            except Exception:
                continue
            if isinstance(parsed, dict):
                data = parsed
                break
        if not isinstance(data, dict):
            data = {}
        self.projects = data.get("projects") or {}
        self.conversations = data.get("conversations") or {}

    def _save(self):
        _atomic_save(
            self.path,
            json.dumps(
                {"projects": self.projects, "conversations": self.conversations},
                ensure_ascii=False,
                indent=2,
            ),
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
            # 运行状态(running/done): 服务端工作线程的真实生命周期
            "status": conv.get("status") or "done",
        }

    def list_conversations(self) -> list:
        convs = [self._public_conversation(c) for c in self.conversations.values()]
        convs.sort(key=lambda c: (not c["pinned"], -(c["updatedAt"] or 0)))
        return convs

    def upsert_conversation(self, payload: ConversationIn) -> dict:
        # 全程持锁: read-modify-write 必须与归档/删除路径互斥
        with self._lock:
            return self._upsert_conversation_locked(payload)

    def _upsert_conversation_locked(self, payload: ConversationIn) -> dict:
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
        if payload.title is not None:
            conv["title"] = _clip(payload.title, 300) or "新会话"
        if payload.projectId is not None:
            conv["projectId"] = (
                payload.projectId if payload.projectId in self.projects else None
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
                if msg.get("steering"):
                    item["steering"] = True
                    if msg.get("steerId"):
                        item["steerId"] = _clip(str(msg.get("steerId")), 64)
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
                                "result": _clip(
                                    str(t.get("result", "")), _tool_result_limit()
                                ),
                            }
                        )
                    if saved_tools:
                        item["tools"] = saved_tools
                # 块级时间线(前端流式的交错结构): think/tool/ask/text 原始顺序持久化,
                # 加载时按此重放, 让轨迹热力图与压缩前的多段思考一一对应
                raw_blocks = msg.get("blocks")
                if isinstance(raw_blocks, list):
                    saved_blocks: list[dict[str, Any]] = []
                    for b in raw_blocks:
                        if not isinstance(b, dict):
                            continue
                        _t = str(b.get("t") or b.get("type") or "")[:16]
                        if _t == "think":
                            saved_blocks.append(
                                {
                                    "t": "think",
                                    "x": _clip(
                                        str(b.get("x", b.get("text", ""))), 20000
                                    ),
                                }
                            )
                        elif _t == "tool":
                            saved: dict[str, Any] = {
                                "t": "tool",
                                "n": _clip(str(b.get("n", b.get("name", "工具"))), 200),
                                "a": b.get("a", b.get("args"))
                                if isinstance(b.get("a", b.get("args")), dict)
                                else {},
                                "r": _clip(
                                    str(b.get("r", b.get("result", ""))),
                                    _tool_result_limit(),
                                ),
                            }
                            if b.get("isError"):
                                saved["e"] = True
                            saved_blocks.append(saved)
                        elif _t == "ask":
                            saved_blocks.append(
                                {
                                    "t": "ask",
                                    "id": _clip(str(b.get("id", "")), 64),
                                    "qs": b.get("qs", b.get("questions"))
                                    if isinstance(b.get("qs", b.get("questions")), list)
                                    else [],
                                    "ok": bool(b.get("ok", b.get("answered"))),
                                    "r": _clip(
                                        str(b.get("r", b.get("result", ""))),
                                        _tool_result_limit(),
                                    ),
                                    "ans": b.get("ans", b.get("answers"))
                                    if isinstance(b.get("ans", b.get("answers")), list)
                                    else None,
                                }
                            )
                        elif _t == "text":
                            saved_blocks.append(
                                {
                                    "t": "text",
                                    "x": _clip(
                                        str(b.get("x", b.get("text", ""))), 20000
                                    ),
                                }
                            )
                        elif _t == "deliverables":
                            _files = b.get("files")
                            if isinstance(_files, list) and _files:
                                saved_blocks.append(
                                    {
                                        "t": "deliverables",
                                        "files": [
                                            {
                                                "path": _clip(
                                                    str(d.get("path", "")), 500
                                                ),
                                                "op": _clip(str(d.get("op", "")), 16),
                                            }
                                            for d in _files[:40]
                                            if isinstance(d, dict)
                                        ],
                                    }
                                )
                        elif _t == "compact":
                            saved_blocks.append(
                                {
                                    "t": "compact",
                                    "x": _clip(
                                        str(b.get("x", b.get("text", ""))), 5000
                                    ),
                                }
                            )
                        elif _t == "sysnote":
                            saved_blocks.append(
                                {
                                    "t": "sysnote",
                                    "x": _clip(
                                        str(b.get("x", b.get("text", ""))), 5000
                                    ),
                                }
                            )
                        elif _t == "present":
                            # 富媒介展示卡: 字段原样透传(尺寸/分类/项目归属都轻量)
                            saved_blocks.append(
                                {
                                    "t": "present",
                                    "typ": _clip(str(b.get("typ", "file")), 16),
                                    "path": _clip(str(b.get("path", "")), 500),
                                    "name": _clip(str(b.get("name", "")), 300),
                                    "ext": _clip(str(b.get("ext", "")), 32),
                                    "klass": _clip(str(b.get("klass", "other")), 16),
                                    "size": int(b.get("size") or 0),
                                    "title": _clip(str(b.get("title", "")), 200),
                                    "note": _clip(str(b.get("note", "")), 500),
                                    "pid": _clip(str(b.get("pid", "")), 64),
                                }
                            )
                        elif _t == "webview":
                            # 网页展示台: sid/高度/标题等轻量字段透传, url 截断
                            saved_blocks.append(
                                {
                                    "t": "webview",
                                    "mode": _clip(str(b.get("mode", "remote")), 16),
                                    "url": _clip(str(b.get("url", "")), 800),
                                    "path": _clip(str(b.get("path", "")), 500),
                                    "sid": _clip(str(b.get("sid", "")), 32),
                                    "title": _clip(str(b.get("title", "")), 200),
                                    "note": _clip(str(b.get("note", "")), 500),
                                    "height": max(
                                        240, min(900, int(b.get("height") or 420))
                                    ),
                                    "live": 1 if b.get("live") else 0,
                                    "pid": _clip(str(b.get("pid", "")), 64),
                                }
                            )
                    if saved_blocks:
                        item["blocks"] = saved_blocks
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
                if msg.get("contextTokens") is not None:
                    item["contextTokens"] = msg.get("contextTokens")
                if msg.get("cacheTokens") is not None:
                    item["cacheTokens"] = msg.get("cacheTokens")
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
                                "result": _clip(
                                    str(a.get("result", "")), _tool_result_limit()
                                ),
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
        with self._lock:
            if conversation_id not in self.conversations:
                return False
            self.conversations.pop(conversation_id, None)
            self._save()
            return True

    def set_title(self, conversation_id: str, title: str) -> dict | None:
        """LLM 生成的会话标题落地(dsh session-title-llm 思路: 失败保留兜底)。"""
        with self._lock:
            conv = self.conversations.get(conversation_id)
            if conv is None:
                return None
            conv["title"] = _clip(title, 300)
            conv["updatedAt"] = int(time.time() * 1000)
            self._save()
            return self._public_conversation(conv)

    def archive_assistant_row(self, conversation_id: str, row: dict) -> bool:
        """WS 后台归档兑底(edb5ce0): 前端断线期间 agent 跑完后追加结果行。

        与 upsert_conversation 走同一把互斥锁并在锁内重建基线, 保证与
        前端同步路径串行化——不再有"读到旧 content 后整体覆写"的丢失窗口。
        去重口径与原实现一致: 尾条同为 assistant 且前 200 字符相同视为重复。
        返回是否实际写入。
        """
        if not conversation_id or not isinstance(row, dict):
            return False
        with self._lock:
            conv = self.conversations.get(conversation_id)
            if conv is None:
                return False
            base = list(conv.get("content") or [])
            content = str(row.get("content") or "")
            blocks = row.get("blocks")
            if not content and not row.get("tokens") and not blocks:
                return False
            last = base[-1] if base else None
            if (
                isinstance(last, dict)
                and last.get("role") == "assistant"
                and str(last.get("content") or "")[:200] == content[:200]
                and not last.get("blocks")
            ):
                return False
            row_out = {k: v for k, v in row.items() if v is not None}
            base.append(row_out)
            conv["content"] = base[-200:]
            conv["updatedAt"] = int(time.time() * 1000)
            self._save()
            return True

    def archive_streaming_row(self, conversation_id: str, row: dict) -> bool:
        """流式过程行 upsert: 尾条是本请求的 streaming 快照行则原位替换,
        否则追加。刷新页面后从存档即可读到已生成的部分内容; 终态行
        (streaming=False)到达时同函数原位替换掉快照行, 不产生重复行。
        """
        if not conversation_id or not isinstance(row, dict):
            return False
        with self._lock:
            conv = self.conversations.get(conversation_id)
            if conv is None:
                return False
            base = list(conv.get("content") or [])
            last = base[-1] if base else None
            row_out = {k: v for k, v in row.items() if v is not None}
            last_c = str(last.get("content") or "") if isinstance(last, dict) else ""
            new_c = str(row.get("content") or "")
            # 同一回复的快照判定: 尾行 streaming(本机制的快照行) 或 内容呈
            # 前缀生长关系(关页整表保存留下的非流式旧快照 ⊂ 新快照)。
            # 替换要求新内容不短于尾行, 防止新回复的短快照吃掉旧长回复。
            snapshot_rel = (
                isinstance(last, dict)
                and last.get("role") == "assistant"
                and (
                    last.get("streaming")
                    or (
                        bool(last_c)
                        and len(new_c) >= len(last_c)
                        and (
                            new_c[:120].startswith(last_c[:120])
                            or last_c[:120].startswith(new_c[:120])
                        )
                    )
                )
            )
            last_streaming = bool(isinstance(last, dict) and last.get("streaming"))
            if snapshot_rel and not (
                not row.get("streaming") and not last_streaming and last_c == new_c
            ):
                # 同内容同形态(如终态行撞上前端整表归档的更完整版本): 保留尾行
                base[-1] = row_out
                _ls = last.get("streaming") if isinstance(last, dict) else None
                print(
                    f"[stream-archive] replace len={len(new_c)} streaming={row.get('streaming')} lastLen={len(last_c)} lastStreaming={_ls}",
                    flush=True,
                )
            elif (
                isinstance(last, dict)
                and last.get("role") == "assistant"
                and not row.get("streaming")
                and not last.get("streaming")
                and str(last.get("content") or "")[:200]
                == str(row.get("content") or "")[:200]
            ):
                # 终态行撞上前端整表归档(更完整的块/统计): 保留前端版本
                return False
            else:
                base.append(row_out)
                print(
                    f"[stream-archive] APPEND len={len(new_c)} streaming={row.get('streaming')} lastRole={last.get('role') if isinstance(last, dict) else None} lastStreaming={last.get('streaming') if isinstance(last, dict) else None} lastLen={len(last_c)}",
                    flush=True,
                )
            conv["content"] = base[-200:]
            conv["updatedAt"] = int(time.time() * 1000)
            self._save()
            return True

    def set_conversation_system(self, conversation_id: str, text: str) -> bool:
        """记录会话实际使用的 system 提示词(Trace 页 #0 系统消息条)。

        每轮回复都会回写相同文本, 内容未变时不触发落盘(幂等)。
        与前端归档路径共用互斥锁, upsert 不触碰该键, 归档不会把它抹掉。
        """
        if not conversation_id or not text:
            return False
        with self._lock:
            conv = self.conversations.get(conversation_id)
            if conv is None:
                return False
            if conv.get("systemPrompt") == text:
                return True
            conv["systemPrompt"] = text
            conv["updatedAt"] = int(time.time() * 1000)
            self._save()
            return True

    def archive_user_row(
        self,
        conversation_id: str,
        content: str,
        steering: bool = False,
        steer_id: str = "",
    ) -> bool:
        """chat.send 即落 user 消息行(与 WS 归档共锁)。

        尾条同为 user 且内容一致视为重复(停止后原样重发的场景),
        不再追加。引导行(steering)不参与内容去重 —— "继续"这类高频短句
        完全可能与上一条撞车, 去重会让引导行凭空消失(前端已回显、存档
        没有)。返回是否实际写入。steering/steer_id 标记引导插话行(刷新后
        前端仍渲染「引导」角标并按 id 去重)。
        """
        text = str(content or "")
        if not conversation_id or not text.strip():
            return False
        with self._lock:
            conv = self.conversations.get(conversation_id)
            if conv is None:
                return False
            base = list(conv.get("content") or [])
            last = base[-1] if base else None
            if (
                not steering
                and isinstance(last, dict)
                and last.get("role") == "user"
                and str(last.get("content") or "")[:200] == text[:200]
            ):
                return False
            row = {
                "role": "user",
                "content": _clip(text, 30000),
                "at": int(time.time() * 1000),
            }
            if steering:
                row["steering"] = True
                if steer_id:
                    row["steerId"] = _clip(str(steer_id), 64)
            base.append(row)
            conv["content"] = base[-200:]
            conv["updatedAt"] = int(time.time() * 1000)
            self._save()
            return True


def _atomic_save(path: Path, payload: str) -> None:
    """原子写 + 上一版本 .bak 轮转(两个 store 共用)。

    半截 JSON 会在 _load 时整库判废, 相当于一次写入失败蒸发全部记录;
    tmp + rename 保证磁盘上任意时刻只有"完整旧库"或"完整新库",
    .bak 额外保住上一版本供损坏回退。tmp 阶段失败时主库未被触碰。
    """
    tmp = path.with_name(path.name + ".tmp")
    try:
        tmp.write_text(payload, encoding="utf-8")
        if path.exists():
            # 上一版本轮转到 .bak(os.replace 同文件系统原子覆盖)
            os.replace(path, path.with_name(path.name + ".bak"))
        os.replace(tmp, path)
    except Exception:
        # 主库此刻尚未被触碰, 清理 tmp 残骸后按旧方式直写一次
        # (tmp 与主库同目录, 同目录不可写时直写同样会失败, 行为退化为旧行为)
        try:
            tmp.unlink(missing_ok=True)
        except Exception:
            pass
        path.write_text(payload, encoding="utf-8")


# 动态系统提示段模板: 发给模型前由 _bind_main_system 填实际值,
# 设置页的内置默认预览按占位符展示(home/workdir/model/window 随会话与模型变化)
_DIRECTORY_BLOCK = (
    "# Directories\n"
    "The user's home directory is `{home}`. The active project working directory is `{workdir}`. "
    "All project data, scripts and produced artifacts read or write through this directory; "
    "operate only inside `{workdir}` and do not create or modify files elsewhere unless the user asks explicitly. "
    "Relative paths in bash commands and file I/O resolve against `{workdir}`; report paths to the user relative to it."
)

_MODEL_BLOCK = (
    "\n\n# Current model\n"
    "Replies are generated by `{model}`, a {kind}. "
    "The context window is about {window} tokens and covers all input including the system prompt, chat history and tool results; "
    "long conversations are compacted automatically to fit the window."
)


def _system_prompt_template() -> str:
    """设置页展示用的系统提示词模板: 与 _bind_main_system 同序但保留占位符。

    预览里 {home}/{workdir}/{model}/{kind}/{window} 由运行时填实际值,
    {memory} 处注入与当前请求召回相关的记忆条目。
    """
    base, _sub = _effective_system_prompts()
    # 动态真值反替为占位符: 首句服务 cwd 与 skills 目录随部署环境变化, 预览不再写死;
    # skills 的取值与反替 key 都走 agent.tools 单点(skills_dir_field/skills_dir_from_listing),
    # 文案或 "# Skills" 标题调整时不用再手工对齐本函数
    sd = ""
    try:
        _tools_mod = _agent_tools_module()
        sd = _tools_mod.skills_dir_from_listing(base)
        if sd is None:
            sd = str(_tools_mod.skill_loader.skills_dir)
        t2 = base.replace(
            _tools_mod.skills_dir_field(sd), _tools_mod.skills_dir_field("{skills_dir}")
        )
    except Exception:
        t2 = base
    t2 = re.sub(
        r"agent at " + re.escape(str(_agent_conf.WORKDIR)),
        "agent at {workdir}",
        t2,
        count=1,
    )
    return (
        f"{t2}\n\n{_DIRECTORY_BLOCK}"
        f"{_MODEL_BLOCK}"
        "\n\n# Memory\nSelected memory records recalled for the current request are injected here. ({memory})"
    )


def _model_caption(model_name: str, model_ctx: Optional[int]) -> str:
    """ "# 当前模型"段文本: 模型名 + 文本/多模态 + 上下文窗口。"""
    if not model_name:
        return ""
    entry = _litellm_lookup(model_name) or {}
    multi = bool(
        entry.get("supports_vision")
        or entry.get("supports_audio_input")
        or entry.get("supports_video_input")
        or entry.get("supports_image_input")
    )
    try:
        cw = _model_context_window(model_name, model_ctx)
    except Exception:
        cw = 0
    kind = (
        "multimodal model supporting text, image and other input types"
        if multi
        else "text-only model"
    )
    return (
        _MODEL_BLOCK.replace("{model}", model_name)
        .replace("{kind}", kind)
        .replace("{window}", f"{cw:,}")
    )


def _bind_main_system(
    workdir: Optional[str],
    plan_mode: bool,
    last_user: str = "",
    model_name: str = "",
    model_ctx: Optional[int] = None,
) -> str:
    """按执行路径同序组装主 agent 的 bound system(工作目录/计划模式/记忆块)。

    双消费方: _run_agent_chat 的实发 system, 以及 conversation.content 在
    会话缺 systemPrompt 属性时(属性写入机制部署前完成轮次的历史会话)
    的读时兜底——保证 Trace #0 系统条对老会话同样可见。
    """
    system, _sub = _effective_system_prompts()
    bound_system = system
    active_dir = str(workdir or _agent_conf.WORKDIR)
    if workdir:
        # 内置提示词首句形如 "You are a ... agent at <服务进程 cwd>", 会覆盖末尾的
        # 项目目录说明; 先把这类句子里的路径改写为会话工作目录, 再附加显式说明。
        bound_system = re.sub(
            r"(agent at )\S+", lambda mo: mo.group(1) + workdir, f"{system}", count=1
        )
    # 目录段模板: 用户目录 + 项目工作目录 + 仅在工作目录内操作; 占位符由 _fill_dynamic_blocks 填值
    bound_system += "\n\n" + _DIRECTORY_BLOCK.replace(
        "{home}", os.path.expanduser("~")
    ).replace("{workdir}", active_dir)
    # 当前模型段: 名称/形态/窗口; 私网模型靠 store 显式配置的 contextWindow
    # 兜住 LiteLLM 库缺条目的精度(否则会落到 131072 默认值误导)
    bound_system += _model_caption(model_name, model_ctx)
    if plan_mode:
        bound_system = bound_system + _PLAN_MODE_PROMPT
    if _memory_recall_enabled():
        # s09 记忆注入: 索引常驻 + 与当前请求关键词相关的记录(零模型调用, 纯词法召回);
        # 设置页 memory.json 可整体关闭(recall=false 时不注入 # Memory 段)
        try:
            from sigmaflow.agent import harness as _harness

            _memory_block = _harness.memory_recall_for(last_user)
            if _memory_block:
                bound_system += f"\n\n# Memory\n{_memory_block}"
        except Exception as _mem_err:
            logging.getLogger("uvicorn.error").info(
                "memory recall skipped: %s", _mem_err
            )
    return bound_system


def _conversation_replied(store, run_id: str) -> bool:
    """本轮回复是否已在会话存档里(投递后观察窗的判据)。

    chat.send 即落 user 行, 因此从尾部倒序看: 先遇到 assistant 说明
    本轮回复已入库(前端归档或兜底行), 先遇到 user 说明仍未入库。
    会话不存在/无内容/未知行类型一律按"未归档"处理。
    """
    conv = (getattr(store, "conversations", {}) or {}).get(run_id) or {}
    for row in reversed(list(conv.get("content") or [])):
        if not isinstance(row, dict):
            continue
        if row.get("role") == "assistant":
            return True
        if row.get("role") == "user":
            return False
    return False


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
    on_usage=None,
    model_ctx: Optional[int] = None,
    conversation_id: str = "",
    system_extra: str = "",
    steer_poll=None,
) -> str:
    """Run a chat through the SigmaFlow agent/agent.Agent stack.

    pjlab 网关只在流式响应的 usage 里回报缓存字段(prompt_tokens_details.cached_tokens),
    非流式响应恒为空; 因此无人订阅增量时也用 no-op 回调强制走流式分支, 保住缓存统计。
    Builds an Agent (openai-compatible method) against the configured
    provider, prepends the agent system prompt, and returns the final
    assistant text. Tool/MCP/skill support is enabled: tools execute on
    this server (bash, file IO, MCP servers, load_skill).
    """
    agent_module = _agent_agent_module()
    Agent = agent_module.Agent

    # anthropic 兼容端点(如 bigmodel 的 /api/anthropic)不实现 OpenAI 风格
    # /chat/completions(一律返回 200 包 404 错误体), 走 Agent 的 anthropic
    # 分支(/v1/messages, x-api-key); 工具定义也要转成 input_schema 形态
    anthropic_dialect = "anthropic" in (base_url or "").lower()
    effective_tools_arg = _effective_agent_tools()
    if anthropic_dialect:
        effective_tools_arg = [
            {
                "name": t.get("name", ""),
                "description": t.get("description", ""),
                # 工具定义原生即 input_schema 键(anthropic 形态); 空键兜底必须是
                # 宽松对象而非空 properties —— 空schema会让网关按schema生成空参数
                "input_schema": t.get("input_schema")
                or t.get("parameters")
                or {"type": "object", "properties": {}},
            }
            for t in effective_tools_arg
        ]

    tools_mod = _agent_tools_module()
    tools_mod.set_session_workdir(workdir)
    # 会话作用域: task/job/inbox 等有状态工具按 runId 分片, 会话间互不可见
    tools_mod.set_session_scope(conversation_id or None)

    def _msg_content(m: dict):
        """user 消息可携带 images(dataUrl 列表, 上传图片附件):
        按服务商方言组装多模态内容块 —— OpenAI 兼容端点用 image_url,
        anthropic 兼容端点(如 bigmodel)用 image source(base64);
        纯文本消息保持字符串, 不改变既有载荷形态。"""
        imgs = m.get("images")
        if m.get("role") == "user" and isinstance(imgs, list) and imgs:
            blocks = []
            text = str(m.get("content", "") or "")
            if text.strip():
                blocks.append({"type": "text", "text": text})
            for url in imgs[:4]:
                if not (isinstance(url, str) and url.startswith("data:image/")):
                    continue
                if anthropic_dialect:
                    try:
                        head, b64 = url.split(",", 1)
                        blocks.append(
                            {
                                "type": "image",
                                "source": {
                                    "type": "base64",
                                    "media_type": head[5:].split(";")[0],
                                    "data": b64,
                                },
                            }
                        )
                    except ValueError:
                        continue
                else:
                    blocks.append({"type": "image_url", "image_url": {"url": url}})
            return blocks or text
        return m.get("content", "")

    raw = [
        {"role": m.get("role"), "content": _msg_content(m)}
        for m in messages
        if m.get("role") in ("user", "assistant")
    ]
    import sys as _sys

    print(
        "[dbg multimodal] shapes="
        + str(
            [
                (
                    m.get("role"),
                    type(m.get("content")).__name__,
                    len(m.get("content"))
                    if isinstance(m.get("content"), (str, list))
                    else 0,
                )
                for m in raw
            ]
        ),
        file=_sys.stderr,
        flush=True,
    )
    # harness 会话上下文: cron 投递按会话绑定; 队友/goal 评估器用同一模型配置
    from sigmaflow.agent import harness as _harness

    _harness_run_id = (
        str(stats.get("runId", "") or "") if isinstance(stats, dict) else ""
    )
    _harness.set_session_run_id(_harness_run_id)
    _harness.set_model_context(base_url, api_key, model_name)
    # 到期 cron + 队友消息投递: 以 [Scheduled]/[Team events] 用户消息注入本轮开头,
    # 投递成功即确认(一次性任务移除), 与 lcc 的 at-least-once 语义一致
    _pre: list = []
    try:
        _due = _harness.CRON.due_for(_harness_run_id)
        if _due:
            for _job in _due:
                _pre.append({"role": "user", "content": f"[Scheduled] {_job.prompt}"})
            _harness.CRON.acknowledge(_due)
        _lead_inbox = tools_mod.BUS.read_inbox("lead")
        if _lead_inbox:
            _event_lines = [
                f"[{m.get('type', 'message')}|{m.get('from', '?')}] {m.get('content', '')}"
                for m in _lead_inbox
            ]
            _pre.append(
                {"role": "user", "content": "[Team events]\n" + "\n".join(_event_lines)}
            )
    except Exception as _h_err:
        logging.getLogger("uvicorn.error").info("harness inject skipped: %s", _h_err)

    # 压缩契约: 界面保留全部历史, 但最后一处压缩摘要卡之前的内容不再发送,
    # 由卡内摘要开场(pi CompactionEntry 语义); 旧卡内容已随迭代并入最新摘要
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
    # harness 注入的投递消息([Scheduled]/[Team events])插在对话最前, 先于压缩卡
    if _pre:
        convo = [*_pre, *convo]
    logging.getLogger("uvicorn.error").info(
        "contract: raw=%d card_idx=%d convo=%d est=%d",
        len(raw),
        card_idx,
        len(convo),
        sum(len(str(m.get("content") or "")) for m in convo),
    )
    # 仅保留 user/assistant 两类角色, 其余消息直接丢弃
    # 轮次上限按助手消息数加预留余量, 防止无限循环
    # 轮次预算: 助手消息数 + 余量(设置页 turnBudget 可调, 默认 100)。
    # 分析型会话一轮一个工具(sleep 30 的长命令更甚), 余量不足会在长任务首条消息打满,
    # 导出"模型没有返回内容"的困惑报错; 保留 max_turn-1 的 finalize 提示兜底无限循环
    max_turn = max(
        1, sum(1 for m in convo if m["role"] == "assistant") + _turn_budget()
    )
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
    # 执行路径与读时兜底共用的 bound system 组装(见 _bind_main_system)
    bound_system = _bind_main_system(
        workdir,
        bool(plan_mode),
        next(
            (
                str(m.get("content", ""))
                for m in reversed(convo)
                if m.get("role") == "user"
            ),
            "",
        ),
        model_name=model_name,
        model_ctx=model_ctx,
    )
    if system_extra:
        # 场景化追加段(如虚拟患者病例挑战的角色与工具协议): 放在 bound system 末尾,
        # 保证它比通用提示词更靠近对话, 模型优先遵循
        bound_system = bound_system + "\n\n" + system_extra
    agent = Agent(
        method="anthropic" if anthropic_dialect else "openai",
        model=model_name,
        base_url=base_url,
        api_key=api_key or "sk-empty",
        support_tool=True,
        retry=5,  # 模型请求失败/超时重试五次(间隔递增), SDK 内部重试关闭避免叠加
        max_turn=max_turn,
        nudge_threshold=_nudge_threshold(),
        max_model_len=model_ctx,  # 网关自定模型名 litellm 不识, fallback 会低估窗口导致误压缩
        tool_result_limit=_tool_result_limit(),  # 与设置页 toolResultLimit 同源
        tools=effective_tools_arg,
        system=bound_system,
        sub_system=sub_system,
        # pjlab 网关无流式不响应存; 无人订阅增量时也要走流式分支拿缓存字段
        on_delta=_make_chat_delta_callback(on_delta, on_reasoning)
        or (lambda piece, think=None: None),
        on_tool=on_tool,
        on_retry=on_retry,
        on_usage=on_usage,
        steer_poll=steer_poll,
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
            # 最后一轮当次 prompt(真实窗口占用, 与累计口径分离)
            stats["last_prompt_tokens"] = info.get("last_prompt_tokens") or 0
            stats["cache_read_tokens"] = info.get("cache_read_tokens") or 0
            logging.getLogger("uvicorn.error").info(
                "agent usage diag: prompt=%d cache=%d turns=%.0f",
                stats["prompt_tokens"],
                stats["cache_read_tokens"],
                info.get("messages", [])
                and sum(
                    1
                    for m_ in info.get("messages", [])
                    if m_.get("role") == "assistant"
                )
                or 0,
            )
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
        # 本次会话实际使用的 system(bound: 工作目录/计划模式/记忆块注入后),
        # 随 info 返回给 WS work(): 持久化到会话并以 chat.system 推给
        # 在线前端, Trace 页据此展示 #0 系统消息条
        if isinstance(info, dict):
            info["system"] = bound_system
        last = info["last_response"] if isinstance(info, dict) else None
    finally:
        tools_mod.set_session_workdir(None)
        # 作用域复位必须与工作目录同在 finally: 若放外面, 会话中途抛异常时
        # 线程池复用的线程会把本会话的 task/job/inbox 作用域泄漏给下一个会话
        tools_mod.set_session_scope(None)

    if not last:
        # 轮次耗尽的截停(agent 侧已写入轮次上限语义的 error): 生成一段可用的进度回复,
        # 保留工具轨迹, 前端不再弹出"模型没有返回内容"
        if isinstance(info, dict) and (
            info.get("used_tools") or info.get("deliverables")
        ):
            tool_count = len(info.get("used_tools") or [])
            files = [
                d.get("path", "")
                for d in (info.get("deliverables") or [])
                if isinstance(d, dict)
            ]
            note = _truncation_note(info, files)
            logging.getLogger("uvicorn.error").info(
                "chat truncated at max_turn: tools=%d files=%d err=%s",
                tool_count,
                len(files),
                str(info.get("error") or "")[:120],
            )
            return note, (info if isinstance(info, dict) else {})
        raise RuntimeError("模型没有返回内容")
    text = last if isinstance(last, str) else None
    if text is None:
        choice = getattr(last, "choices", None)
        if choice:
            text = choice[0].message.content or ""
        else:
            content = getattr(last, "content", None)
            if isinstance(content, list):
                text = "".join(getattr(b, "text", "") for b in content)
            else:
                text = str(content or "")
    return text, (info if isinstance(info, dict) else {})


def _think_of_turn(m: dict):
    """从 info 里一轮 assistant 记录提取思考文本: openai 记 reasoning(_content)
    字段, anthropic 记 thinking 内容块。无思考返回 None。"""
    r = m.get("reasoning_content") or m.get("reasoning")
    if isinstance(r, str) and r.strip():
        return r.strip()
    content = m.get("content")
    if isinstance(content, list):
        pieces = [
            str(b.get("thinking") or "")
            for b in content
            if isinstance(b, dict) and b.get("type") == "thinking"
        ]
        joined = "\n".join(pieces).strip()
        return joined or None
    return None


def _tool_calls_of_turn(m: dict) -> int:
    """从一轮 assistant 记录数出本轮的工具调用个数(openai: tool_calls 列表,
    anthropic: tool_use 内容块)。用于把扁平的 used_tools 切回轮次区间。"""
    content = m.get("content")
    if isinstance(content, list):
        return sum(
            1 for b in content if isinstance(b, dict) and b.get("type") == "tool_use"
        )
    return len(m.get("tool_calls") or [])


def _tool_block_of(func, args, output) -> dict:
    """单个工具块的存档形态, 与前端流式块的 {t,n,a,r} 压缩格式同构。"""
    return {
        "t": "tool",
        "n": _clip(str(func or "工具"), 200),
        "a": args if isinstance(args, dict) else {},
        "r": _clip(str(output or ""), _tool_result_limit()),
    }


def _text_of_turn(m: dict) -> str:
    """轮次叙述文本: 纯字符串 content 直接取, anthropic 块列表取 text 部件。"""
    content = m.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                parts.append(str(item.get("text") or ""))
            elif isinstance(item, str):
                parts.append(item)
        return "".join(parts)
    return ""


def _blocks_from_agent_info(info: dict) -> list:
    """把 agent info 的轨迹压成存档块序列(与前端流式块同构), 兜底归档用。

    思考块按 info["messages"] 的轮次记录还原, 与工具块按「每轮先思考后工具」
    交错; 工具块内容取自 used_tools(那里有参数与结果, messages 里只有结果);
    正文块只在有文本时追加在尾部, 末轮思考紧贴正文之前, 与流式渲染顺序一致。
    """
    blocks: list = []
    used = list((info.get("used_tools") or [])[:400])

    turns: list = []
    for m in info.get("messages") or []:
        if not isinstance(m, dict) or m.get("role") != "assistant":
            continue
        turns.append((_think_of_turn(m), _tool_calls_of_turn(m), _text_of_turn(m)))

    idx = 0
    last_turn_text = ""
    for think, n_calls, turn_text in turns:
        if think:
            blocks.append({"t": "think", "x": _clip(think, 20000)})
        # 每轮的叙述文本(与工具调用同消息发出的正文)按流式顺序织入:
        # 只追加末轮正文会丢掉中间轮的说明文字, 刷新后"只剩 think 和工具"
        if turn_text.strip():
            blocks.append({"t": "text", "x": _clip(turn_text, 20000)})
            last_turn_text = turn_text
        take = min(int(n_calls or 0), max(0, len(used) - idx))
        for func, args, output in used[idx : idx + take]:
            blocks.append(_tool_block_of(func, args, output))
        idx += take
    # 轮次边界与执行序失配时不丢工具: 剩余部分按原序补齐
    for func, args, output in used[idx:]:
        blocks.append(_tool_block_of(func, args, output))

    last_reasoning = info.get("last_reasoning")
    if isinstance(last_reasoning, str) and last_reasoning.strip():
        blocks.append({"t": "think", "x": _clip(last_reasoning, 20000)})
    last = info.get("last_response")
    text = last if isinstance(last, str) else ""
    if text.strip() and text != last_turn_text:
        blocks.append({"t": "text", "x": _clip(text, 20000)})
    return blocks


def _archive_row_from_journal(state, model_name: str, streaming: bool = True):
    """从事件 journal 合成存档行(块形状与前端流式块同构)。

    流式中途周期性落库与终态行共用本合成: 刷新页面后从存档即可看到
    已生成的部分内容(streaming 标记), 终态行再整体替换。think 连续
    追加; 工具结果回填最近的同名未收尾块; 正文按到达序累积。
    """
    blocks: list = []
    text_parts: list = []
    think_idx = -1
    open_tools: list = []
    row_error = None
    for kind, value in state.get("journal") or []:
        if kind == "think":
            d = (
                str((value or {}).get("delta") or "")
                if isinstance(value, dict)
                else str(value or "")
            )
            if d:
                if think_idx >= 0 and blocks[think_idx].get("t") == "think":
                    blocks[think_idx]["x"] += d
                else:
                    blocks.append({"t": "think", "x": d})
                    think_idx = len(blocks) - 1
        elif kind == "delta":
            think_idx = -1
            d = (
                str((value or {}).get("delta") or "")
                if isinstance(value, dict)
                else str(value or "")
            )
            if d:
                text_parts.append(d)
                # 正文必须以 text 块进入时间线: 前端渲染块时间线时不读 content
                # 字段, 缺 text 块的快照在刷新后只剩 think/工具块(正文"消失")
                if blocks and blocks[-1].get("t") == "text":
                    blocks[-1]["x"] += d
                else:
                    blocks.append({"t": "text", "x": d})
        elif kind == "error":
            # 终态错误物化为行的 error 字段: 刷新后红错块可见
            row_error = str(value or "")[:2000] or None
        elif kind == "tool" and isinstance(value, dict):
            k = value.get("kind")
            if k in ("call", "result"):
                name = str(value.get("name") or "工具")
                think_idx = -1
                if k == "call":
                    args = value.get("args")
                    blocks.append(
                        {
                            "t": "tool",
                            "n": name,
                            "a": args if isinstance(args, dict) else {},
                            "r": "",
                        }
                    )
                    open_tools.append(len(blocks) - 1)
                else:
                    # FIFO 配对: call 事件是整批广播、结果按完成序回填, 而
                    # 工具是顺序执行的——结果属于最早未收尾的同名调用。
                    # 取最新会把结果错位挂到后发的调用上(参数/结果交叉)。
                    tgt = None
                    for i in open_tools:
                        if blocks[i].get("n") == name:
                            tgt = i
                            break
                    if tgt is None:
                        blocks.append(
                            {
                                "t": "tool",
                                "n": name,
                                "a": {},
                                "r": str(value.get("result") or ""),
                            }
                        )
                    else:
                        blocks[tgt]["r"] = str(value.get("result") or "")
                        blocks[tgt]["e"] = bool(value.get("isError"))
                        open_tools = [i for i in open_tools if i != tgt]
            elif k == "ask":
                think_idx = -1
                blocks.append(
                    {
                        "t": "ask",
                        "id": value.get("id"),
                        "qs": value.get("questions")
                        if isinstance(value.get("questions"), list)
                        else [],
                        "ok": False,
                        "r": "",
                    }
                )
            elif k == "compact":
                think_idx = -1
                blocks.append({"t": "compact", "x": str(value.get("text") or "")})
            elif k == "present":
                think_idx = -1
                blocks.append(
                    {
                        "t": "present",
                        "typ": value.get("typ") or "file",
                        "path": value.get("path"),
                        "name": value.get("name"),
                        "ext": value.get("ext"),
                        "klass": value.get("klass"),
                        "size": value.get("size"),
                        "title": value.get("title"),
                        "note": value.get("note"),
                    }
                )
            elif k == "webview":
                think_idx = -1
                blocks.append(
                    {
                        "t": "webview",
                        "mode": str(value.get("mode") or "remote")[:16],
                        "url": str(value.get("url") or "")[:800],
                        "path": str(value.get("path") or "")[:500],
                        "sid": str(value.get("sid") or "")[:32],
                        "title": str(value.get("title") or "")[:200],
                        "note": str(value.get("note") or "")[:500],
                        "height": max(240, min(900, int(value.get("height") or 420))),
                        "live": 1 if value.get("live") else 0,
                    }
                )
    content = "".join(text_parts)
    if not content and not blocks:
        return None
    row = {
        "role": "assistant",
        "blocks": blocks,
        "at": int(time.time() * 1000),
        "model": model_name,
        "streaming": bool(streaming),
    }
    if content:
        row["content"] = content
    if row_error:
        row["error"] = row_error
    return row


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


def _safe_rebuild_agent_mcp() -> None:
    """Re-wire MCP tools once the listener is up (best effort, never raises)."""
    try:
        from .science_admin import _rebuild_agent_mcp

        client = _rebuild_agent_mcp()
        _AGENT_CONTEXT_SIZES.clear()  # 工具集变了, 固定开销需重新测量
        logging.getLogger("uvicorn.error").info(
            "mcp tools re-wired after startup: %d",
            len(getattr(client, "tools", {}) or {}),
        )
    except Exception as err:
        logging.getLogger("uvicorn.error").info("mcp rewire skipped: %s", err)


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
    on_usage=None,
    model_ctx: Optional[int] = None,
    conversation_id: str = "",
    steer_poll=None,
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
        on_usage=on_usage,
        model_ctx=model_ctx,
        conversation_id=conversation_id,
        steer_poll=steer_poll,
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


# ==================== 网页展示台(webview 工具)代理 ====================
# /wv/{sid}?u=<目标URL>: 服务端反向代理, 目的有三——
#   1) 剥掉 X-Frame-Options/CSP, 让反爬验证页可以进 iframe;
#   2) 所有请求共享 sid 的 Cookie 罐(agent/tools.py _WEBVIEW_SESSIONS),
#      用户在会话里完成的验证对模型的 webview_fetch 立即可见;
#   3) HTML 内同源链接改写成继续走代理, 站内导航/表单不脱离罐子。
_WV_STRIP_HEADERS = {
    "x-frame-options",
    "content-security-policy",
    "content-security-policy-report-only",
    "permissions-policy",
    "cross-origin-opener-policy",
    "cross-origin-embedder-policy",
    "cross-origin-resource-policy",
    "strict-transport-security",
    "content-encoding",
    "transfer-encoding",
    "content-length",
    "connection",
    "set-cookie",  # 响应 cookie 由罐子记录, 不透传给浏览器(浏览器域不对)
}
_WV_FWD_DROP = {
    "host",
    "cookie",
    "origin",
    "referer",
    "content-length",
    "connection",
    "accept-encoding",
    "sec-fetch-site",
    "sec-fetch-mode",
    "sec-fetch-dest",
    "sec-fetch-user",
    "sec-ch-ua",
    "sec-ch-ua-mobile",
    "sec-ch-ua-platform",
}
# 注入到被代理页 <head> 的首段脚本: 页面 JS 的同源 fetch/XHR 一律重定向回
# 代理入口(页面自以为在目标域上, 相对路径其实落在本站根路径上会 404)
_WV_JS_PATCH = """<script>(function(){
var T=__WV_TARGET__;var P=location.pathname+'?u=';
function map(u){
  try{
    var s=String(u);
    if(!s||/^(data:|blob:|javascript:)/i.test(s))return s;
    var a=new URL(s,location.href);
    if(a.origin!==location.origin)return s;
    if(a.pathname.indexOf('/wv/')>-1)return s;
    return P+encodeURIComponent(T+a.pathname+a.search);
  }catch(e){return u;}
}
var of=window.fetch;
if(of){window.fetch=function(input,init){
  try{
    if(typeof input==='string')input=map(input);
    else if(input&&input.url)input=new Request(map(input.url),input);
  }catch(e){}
  return of.call(this,input,init);
};}
var oo=XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open=function(){arguments[1]=map(arguments[1]);return oo.apply(this,arguments);};
})();</script>"""


def _wv_proxied_url(sid: str, target: str) -> str:
    """目标绝对 URL → 代理入口 URL。

    用纯查询串相对形态 "?u=..." 而非根绝对 "/api/wv/...": 浏览器按当前 iframe
    URL 解析(自动落在真实挂载前缀下, 如 /sigmaflow), 且不被外层 prefix-proxy
    的根绝对 src/href 改写二次触碰, 表单 action 也一并正确。
    """
    from urllib.parse import quote

    return f"?u={quote(target, safe='')}"


def _wv_rewrite_html(html: str, final_url: str, sid: str) -> str:
    """同源 href/src/action 改写为代理地址; 注入 fetch/XHR 补丁。"""
    from urllib.parse import urljoin, urlparse

    try:
        t = urlparse(final_url)
        target_origin = f"{t.scheme}://{t.netloc}"
    except Exception:
        return html

    def _map(val: str) -> str:
        v = val.strip()
        if (
            not v
            or v.startswith(
                (
                    "#",
                    "data:",
                    "blob:",
                    "javascript:",
                    "mailto:",
                    "tel:",
                    "about:",
                    "{",
                    "http://www.w3.org",
                )
            )
            or v.lower().startswith("{{")
        ):
            return val
        try:
            if v.startswith("//"):
                v = f"{t.scheme}:{v}"
            if v.startswith(("http://", "https://")):
                p = urlparse(v)
                if p.netloc != t.netloc:
                    return val  # 跨域资源直连(地图/统计脚本等), 不经罐子
                return _wv_proxied_url(sid, v)
            absu = urljoin(final_url, v)
            p = urlparse(absu)
            if p.scheme not in ("http", "https") or p.netloc != t.netloc:
                return val
            return _wv_proxied_url(sid, absu)
        except Exception:
            return val

    def _sub_dq(m):
        return f'{m.group(1)}="{_map(m.group(2))}"'

    def _sub_sq(m):
        return f"{m.group(1)}='{_map(m.group(2))}'"

    html = re.sub(
        r'\b(href|src|action|formaction|poster|data-src)\s*=\s*"([^"]*)"', _sub_dq, html
    )
    html = re.sub(
        r"\b(href|src|action|formaction|poster|data-src)\s*=\s*'([^']*)'", _sub_sq, html
    )

    def _ss(m):
        parts = [p.strip() for p in m.group(2).split(",") if p.strip()]
        out = []
        for part in parts:
            bits = part.split()
            if bits:
                bits[0] = _map(bits[0])
                out.append(" ".join(bits))
        return f'{m.group(1)}="{", ".join(out)}"'

    html = re.sub(r'\b(srcset|data-srcset)\s*=\s*"([^"]*)"', _ss, html)
    patch = _WV_JS_PATCH.replace("__WV_TARGET__", json.dumps(target_origin)).replace(
        "__WV_SID__", sid
    )
    if re.search(r"<head[^>]*>", html, re.I):
        html = re.sub(r"<head[^>]*>", lambda m: m.group(0) + patch, html, count=1)
    else:
        html = patch + html
    return html


_WV_CF_MARKERS = (
    "challenge-platform",
    "cf-chl",
    "cf_chl_opt",
    "Just a moment",
    "Verifying your browser",
    "Attention Required",
)
_WV_CF_BANNER = (
    '<div style="all:initial;display:block;font:14px/1.7 -apple-system,'
    "'Segoe UI',sans-serif;position:sticky;top:0;z-index:2147483647;"
    "padding:12px 18px;background:#fff7e0;color:#7a5b00;"
    'border-bottom:1px solid #ecd9a0">⚠ 本站启用了 Cloudflare 人机验证,'
    "无法在此嵌入页内完成。请点击消息卡片上的「新窗口」在真实浏览器打开原始"
    "网址完成验证;完成后让助手用 webview_fetch 复查是否放行。</div>"
)


def _wv_inject_cf_banner(html: str) -> str:
    """识别 Cloudflare 质询页并在顶部插说明横幅, 免得用户对着失败的
    挑战 iframe 疑惑(「无法连接到网站」是质询脚本在代理域下必然报的错)。"""
    low = html.lower()
    if not any(m.lower() in low for m in _WV_CF_MARKERS):
        return html
    if re.search(r"<body[^>]*>", html, re.I):
        return re.sub(
            r"<body[^>]*>", lambda m: m.group(0) + _WV_CF_BANNER, html, count=1
        )
    return _WV_CF_BANNER + html


def _wv_expired_html() -> str:
    return (
        "<!doctype html><meta charset='utf-8'><body style='font:14px/1.7"
        " sans-serif;padding:32px;color:#555'>该网页会话已过期(约 2 小时)。"
        "请让助手重新调用 webview 工具打开此页面。</body>"
    )


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
