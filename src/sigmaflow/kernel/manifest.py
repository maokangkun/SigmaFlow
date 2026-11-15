"""mod.toml 清单解析与校验 — kernel 三件套之三的输入侧。

清单规范见 mod 架构设计 §5.1。解析保持宽松(未知字段进 ``raw`` 供后续
版本演进), 校验只卡会破坏加载的字段: id 合法性、version 可解析、
reload 级别合法、api 契约已知、capabilities 键已知。

TOML 解析: Python ≥3.11 用内置 tomllib; 3.10 回落 tomli(可选依赖)。
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

try:  # Python ≥3.11
    import tomllib as _toml
except ModuleNotFoundError:  # pragma: no cover - 3.10
    try:
        import tomli as _toml  # type: ignore[no-redef]
    except ModuleNotFoundError:
        _toml = None  # type: ignore[assignment]

# 内核 API 契约版本: mod 声明的 api 段必须落在已知域上。
# 变更规则: 新增域或提升 minor 不破坏; 提升 major 意味着旧 mod 需迁移。
API_VERSIONS: Dict[str, int] = {
    "core": 1,
    "tools": 1,
    "prompts": 1,
    "loop": 1,
    "server": 1,
    "ui": 1,
    "env": 1,
    "pipeline": 1,
}

RELOAD_LEVELS = ("instant", "run-boundary", "restart")

# 运行面: mod 代码需要在哪里执行。服务进程内 agent 工具也在服务进程跑,
# 所以 "agent 工具类 mod" 用默认 all 即可; 纯 server 接线类(如 env 桥)标
# server, CLI 进程跳过; 极少数只该在 CLI 跑的标 cli。
TARGETS = ("all", "server", "cli")

_VALID_ID = re.compile(r"^[a-z][a-z0-9-]*$")

_KNOWN_CAPS = {
    "fs-read": list,
    "fs-write": list,
    "exec": bool,
    "network": list,
    "mcp": bool,
    "ui": bool,
    "prompt": bool,
    "registry": bool,
}


class ManifestError(ValueError):
    pass


@dataclass
class CapabilitySet:
    fs_read: List[str] = field(default_factory=list)
    fs_write: List[str] = field(default_factory=list)
    exec: bool = False
    network: List[str] = field(default_factory=list)
    mcp: bool = False
    ui: bool = False
    prompt: bool = False
    registry: bool = False

    def grants(self, cap: str, detail: Optional[str] = None) -> bool:
        """运行时门控: 布尔能力直接看值; 列表能力需前缀/占位符匹配。

        路径占位符: ``<project>`` = 当前会话项目目录, ``<tmp>`` = 系统临时目录。
        网络能力: ``["*"]`` 表示不限。
        """
        if cap == "fs-read":
            return detail is None or _list_match(self.fs_read, detail)
        if cap == "fs-write":
            return detail is None or _list_match(self.fs_write, detail)
        if cap == "exec":
            return self.exec
        if cap == "network":
            return detail is None or _list_match(self.network, detail or "")
        if cap == "mcp":
            return self.mcp
        if cap == "ui":
            return self.ui
        if cap == "prompt":
            return self.prompt
        if cap == "registry":
            return self.registry
        return False

    def summary(self) -> Dict[str, Any]:
        return {
            "fs-read": self.fs_read,
            "fs-write": self.fs_write,
            "exec": self.exec,
            "network": self.network,
            "mcp": self.mcp,
            "ui": self.ui,
            "prompt": self.prompt,
            "registry": self.registry,
        }


def _list_match(rules: List[str], value: str) -> bool:
    if "*" in rules:
        return True
    val = (value or "").rstrip("/\\")
    for rule in rules:
        r = (rule or "").rstrip("/\\")
        if not r:
            continue
        if val == r or val.startswith(r + "/") or val.startswith(r + "\\"):
            return True
    return False


@dataclass
class Manifest:
    id: str
    name: str
    version: str
    description: str = ""
    authors: List[str] = field(default_factory=list)
    license: str = ""
    reload: str = "run-boundary"
    target: str = "all"
    api: Dict[str, int] = field(default_factory=dict)
    requires_sigmaflow: Optional[str] = None
    requires_mods: Dict[str, str] = field(default_factory=dict)
    replaces: List[str] = field(
        default_factory=list
    )  # 独占扩展点声明, 如 ["core-loop"]
    overrides_tools: List[str] = field(default_factory=list)
    capabilities: CapabilitySet = field(default_factory=CapabilitySet)
    contributions: Dict[str, Any] = field(default_factory=dict)
    config_defaults: Dict[str, Any] = field(default_factory=dict)
    raw: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "version": self.version,
            "description": self.description,
            "authors": self.authors,
            "license": self.license,
            "reload": self.reload,
            "target": self.target,
            "api": self.api,
            "requires": {
                "sigmaflow": self.requires_sigmaflow,
                "mods": self.requires_mods,
            },
            "replaces": self.replaces,
            "overrides_tools": self.overrides_tools,
            "capabilities": self.capabilities.summary(),
            "contributions": self.contributions,
            "config_defaults": self.config_defaults,
        }


def parse_manifest(text: str, *, source: str = "<memory>") -> Manifest:
    if _toml is None:
        raise ManifestError(
            "TOML parser unavailable (need Python >=3.11 or the tomli package)"
        )
    try:
        data = _toml.loads(text)
    except Exception as exc:  # noqa: BLE001
        raise ManifestError(f"{source}: invalid TOML: {exc}") from exc
    return manifest_from_dict(data, source=source)


def manifest_from_dict(data: Dict[str, Any], *, source: str = "<memory>") -> Manifest:
    mod = data.get("mod")
    if not isinstance(mod, dict):
        raise ManifestError(f"{source}: missing [mod] section")
    mod_id = str(mod.get("id") or "").strip()
    if not _VALID_ID.match(mod_id):
        raise ManifestError(
            f"{source}: mod.id {mod_id!r} invalid (kebab-case, e.g. 'my-tool')"
        )
    version = str(mod.get("version") or "").strip() or "0.0.0"

    reload_level = str(mod.get("reload") or "run-boundary")
    if reload_level not in RELOAD_LEVELS:
        raise ManifestError(
            f"{source}: mod.reload must be one of {RELOAD_LEVELS}, got {reload_level!r}"
        )

    target = str(mod.get("target") or "all")
    if target not in TARGETS:
        raise ManifestError(
            f"{source}: mod.target must be one of {TARGETS}, got {target!r}"
        )

    api_raw = data.get("api") or {}
    if not isinstance(api_raw, dict):
        raise ManifestError(f"{source}: [api] must be a table")
    api: Dict[str, int] = {}
    for k, v in api_raw.items():
        if k not in API_VERSIONS:
            raise ManifestError(
                f"{source}: api.{k} unknown contract (known: {sorted(API_VERSIONS)})"
            )
        if int(v) != API_VERSIONS[k]:
            raise ManifestError(
                f"{source}: api.{k}={v} unsupported (kernel provides {API_VERSIONS[k]})"
            )
        api[k] = int(v)

    caps = CapabilitySet()
    caps_raw = data.get("capabilities") or {}
    if not isinstance(caps_raw, dict):
        raise ManifestError(f"{source}: [capabilities] must be a table")
    for key, val in caps_raw.items():
        if key not in _KNOWN_CAPS:
            raise ManifestError(
                f"{source}: capabilities.{key} unknown (known: {sorted(_KNOWN_CAPS)})"
            )
        if key in ("fs-read", "fs-write"):
            setattr(
                caps,
                key.replace("-", "_"),
                [str(x) for x in val] if isinstance(val, list) else [str(val)],
            )
        elif key == "network":
            caps.network = (
                [str(x) for x in val] if isinstance(val, list) else [str(val)]
            )
        else:
            setattr(caps, key.replace("-", "_"), bool(val))

    req = data.get("requires") or {}
    req_mods = req.get("mods") or {}
    if not isinstance(req_mods, dict):
        raise ManifestError(f"{source}: requires.mods must be a table")

    contrib = data.get("contributions") or {}
    if not isinstance(contrib, dict):
        raise ManifestError(f"{source}: [contributions] must be a table")

    cfg = data.get("config") or {}
    defaults = cfg.get("defaults") if isinstance(cfg, dict) else None
    if defaults is not None and not isinstance(defaults, dict):
        raise ManifestError(f"{source}: config.defaults must be a table")

    return Manifest(
        id=mod_id,
        name=str(mod.get("name") or mod_id),
        version=version,
        description=str(mod.get("description") or ""),
        authors=[str(a) for a in (mod.get("authors") or [])],
        license=str(mod.get("license") or ""),
        reload=reload_level,
        target=target,
        api=api,
        requires_sigmaflow=(str(req["sigmaflow"]) if req.get("sigmaflow") else None),
        requires_mods={str(k): str(v) for k, v in req_mods.items()},
        replaces=[str(x) for x in (mod.get("replaces") or [])],
        overrides_tools=[str(x) for x in (mod.get("overrides-tools") or [])],
        capabilities=caps,
        contributions=dict(contrib),
        config_defaults=dict(defaults or {}),
        raw=dict(data),
    )
