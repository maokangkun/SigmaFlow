"""Science 管理配置域: agent 工具开关/token 密钥/技能/系统提示词/压缩配置/MCP servers.

全部为落盘配置的读写与应用逻辑, 由 science.py 路由层调用。"""

import json
import os
import logging
import threading

from typing import Any, Dict, Optional

from fastapi import (
    HTTPException,
)

from .science_common import (
    _current_user,
    _science_data_root,
)

from .science_auth import (
    _user_science_root,
)


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


_TOOLS_LOCK = threading.Lock()
_TOOL_ALIASES: Dict[str, str] = {}


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


_TOKEN_IDS = ("sciverse", "anysearch")
_ARXIV_TOOLS = ("arxiv_search", "read_arxiv")
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
    ids: set[str] = set()
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
        # # Skills 标题与 tools.SkillLoader.get_descriptions 同构(标题发给模型, 模板侧占位)
        skill_prompt = f"# Skills\nUse `load_skill` to access specialized knowledge before tackling unfamiliar topics.\nSkills dir: {self.skills_dir}\nSkills available:\n"
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
    payload: Dict[str, Any] = {"servers": servers}
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
        entry: Dict[str, Any] = {"url": url}
        if name in builtin:
            # 认证头等非页面字段以内置资产为准, 不随设置页保存丢失
            for k, v in builtin[name].items():
                if k != "url":
                    entry[k] = v
        if item.get("enabled") is False:
            entry["enabled"] = False
        servers[name] = entry
    return servers


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


def _compaction_config_path() -> str:
    return os.path.join(_science_data_root(), "compaction.json")


def _memory_config_path() -> str:
    return os.path.join(_science_data_root(), "memory.json")


def _load_memory_config() -> dict:
    try:
        with open(_memory_config_path(), encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def _save_memory_config(cfg: dict) -> None:
    path = _memory_config_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(cfg, fh, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def _memory_recall_enabled() -> bool:
    # 跨会话记忆开关: 未配置默认开启; memory.json {"recall": false} 时
    # _bind_main_system 跳过 # Memory 段注入
    return bool(_load_memory_config().get("recall", True))


def _load_compaction_config() -> dict:
    try:
        with open(_compaction_config_path(), encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def _save_compaction_config(cfg: dict) -> None:
    path = _compaction_config_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(cfg, fh, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def _compaction_defaults() -> dict:
    from sigmaflow.agent import conf as agent_conf

    return {
        "enabled": (bool, True, None, None),
        "ratio": (float, float(getattr(agent_conf, "COMPACT_RATIO", 0.85)), 0.3, 0.98),
        "keepRecentTokens": (
            int,
            int(getattr(agent_conf, "COMPACT_KEEP_RECENT_TOKENS", 16000)),
            2000,
            200000,
        ),
        "minDrops": (int, int(getattr(agent_conf, "COMPACT_MIN_DROPS", 4)), 2, 50),
        "summaryTokens": (
            int,
            int(getattr(agent_conf, "COMPACT_TOKENS", 4096)),
            512,
            16384,
        ),
        "resultChars": (
            int,
            int(getattr(agent_conf, "COMPACT_SERIAL_RESULT_CHARS", 2000)),
            200,
            20000,
        ),
        "argChars": (
            int,
            int(getattr(agent_conf, "COMPACT_SERIAL_ARG_CHARS", 200)),
            40,
            4000,
        ),
    }


def _effective_compaction() -> dict:
    # 合并环境默认与设置面板存储的覆盖值, 逐字段做类型与范围钳制
    stored = _load_compaction_config()
    out = {}
    for key, (kind, default_v, lo, hi) in _compaction_defaults().items():
        val = stored.get(key, default_v)
        try:
            val = kind(val) if val is not None else default_v
        except (TypeError, ValueError):
            val = default_v
        if lo is not None and val < lo:
            val = lo
        if hi is not None and val > hi:
            val = hi
        out[key] = val
    out["enabled"] = bool(out["enabled"])
    return out


def _apply_compaction_to(agent) -> None:
    # 把设置面板的压缩参数注入 Agent 内的 Compactor(按 conf 常量名映射)
    try:
        cfg = _effective_compaction()
        compactor = getattr(agent, "compactor", None)
        if compactor is not None:
            compactor.overrides = {
                "COMPACT_ENABLED": bool(cfg["enabled"]),
                "COMPACT_RATIO": float(cfg["ratio"]),
                "COMPACT_KEEP_RECENT_TOKENS": int(cfg["keepRecentTokens"]),
                "COMPACT_MIN_DROPS": int(cfg["minDrops"]),
                "COMPACT_TOKENS": int(cfg["summaryTokens"]),
                "COMPACT_SERIAL_RESULT_CHARS": int(cfg["resultChars"]),
                "COMPACT_SERIAL_ARG_CHARS": int(cfg["argChars"]),
            }
    except Exception as exc:  # 设置注入失败回落 env 默认, 不拦截会话
        logging.getLogger("uvicorn.error").warning(
            "compaction settings apply failed: %s", exc
        )
