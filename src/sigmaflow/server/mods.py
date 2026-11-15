"""服务端 mod 子系统(P1): ModHost 单例装配、envs 服务、/api/mods 管理路由。

绞杀者路线(设计 §12): 本模块不改动既有行为, 只把"接线"从 science.py 的
硬编码迁到注册表 — patenv/pathenv 的装配代码从 science.py 移入
``sigmaflow/mods/{patient-env,pathogen-env}``, science 侧改为遍历 envs 注册表。

工具兼容桥(LegacyToolBridge): P1 阶段 conf.TOOLS/CHILD_TOOLS/TOOL_HANDLERS
仍是权威数据源, mod 注册的新工具同时写入注册表与遗留结构, 现有 Agent
零改动即可使用; P2 注册表翻转后本桥转为只写注册表。
"""

from __future__ import annotations

import logging
import os
import threading
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request

from ..kernel import (
    HookBus,
    ModHost,
    ModStore,
    PatchEntry,
    ServiceRegistry,
    ToolSpec,
)

log = logging.getLogger("uvicorn.error.sfmods")


# ---------------------------------------------------------------- envs 服务
@dataclass
class EnvSpec:
    """一个虚拟环境(env mod)的注册描述 — 与 _register_env_routes 的参数一一对应。"""

    hub: Any
    prefix: str
    page_title: str
    project_id: str
    project_name: str
    project_description: str
    project_tags: List[str]
    project_icon: str
    prompt_fn: Callable[[], str]
    groups: Optional[Dict[str, List[str]]] = None
    owner: str = ""


class EnvRegistry:
    """env mod 注册表: science 启动时遍历它装配路由与侧栏项目。"""

    def __init__(self) -> None:
        self._specs: Dict[str, EnvSpec] = {}
        self._lock = threading.RLock()

    def register(self, spec: EnvSpec, *, replace: bool = False) -> None:
        with self._lock:
            existing = self._specs.get(spec.prefix)
            if existing is not None and not replace:
                raise ValueError(
                    f"env prefix {spec.prefix!r} already registered by "
                    f"{existing.owner or 'core'!r}"
                )
            self._specs[spec.prefix] = spec

    def unregister_owner(self, owner: str) -> List[str]:
        with self._lock:
            gone = [p for p, s in self._specs.items() if s.owner == owner]
            for p in gone:
                self._specs.pop(p, None)
            return gone

    # kernel 卸载约定(与工具桥同款)
    dispose_owner = unregister_owner

    def all(self) -> List[EnvSpec]:
        with self._lock:
            return list(self._specs.values())

    def get(self, prefix: str) -> Optional[EnvSpec]:
        return self._specs.get(prefix)


# ---------------------------------------------------------- 工具兼容桥
class LegacyToolBridge:
    """mod 工具注册 → 遗留结构 + kernel 注册表双写(P1 过渡, 设计 §12)。

    延迟导入 sigmaflow.agent: mods 模块在服务进程早期装配, agent 包按需
    实例化, 不应在 import 期被拖起。
    """

    def __init__(self) -> None:
        self._registry = None  # kernel ToolRegistry(有则双写)
        self._owned: Dict[str, List[str]] = {}  # owner → 注册的工具名
        self._lock = threading.RLock()

    def bind_registry(self, registry) -> None:
        self._registry = registry

    def register(
        self,
        *,
        name: str,
        description: str,
        input_schema: Dict[str, Any],
        handler: Callable[..., Any],
        audience: str = "main",  # main | subagent | both
        owner: str = "core",
        overrides: Optional[List[str]] = None,
    ) -> None:
        with self._lock:
            from sigmaflow.agent import conf as agent_conf
            from sigmaflow.agent import tools as agent_tools

            entry = {
                "name": name,
                "description": description,
                "input_schema": input_schema,
            }
            aud = {"main", "subagent"} if audience == "both" else {audience}
            if "main" in aud and not any(
                t.get("name") == name for t in agent_conf.TOOLS
            ):
                agent_conf.TOOLS.append(entry)
            if "subagent" in aud and not any(
                t.get("name") == name for t in agent_conf.CHILD_TOOLS
            ):
                agent_conf.CHILD_TOOLS.append(entry)
            if name in agent_tools.TOOL_HANDLERS and (
                not overrides or name not in overrides
            ):
                raise ValueError(
                    f"tool {name!r} already exists; declare overrides to replace"
                )
            agent_tools.TOOL_HANDLERS[name] = handler
            self._owned.setdefault(owner, []).append(name)
            if self._registry is not None:
                self._registry.register(
                    ToolSpec(
                        name=name,
                        description=description,
                        input_schema=input_schema,
                        handler=handler,
                        owner=owner,
                        audience=frozenset(aud),
                    ),
                    overrides=overrides,
                )
            _invalidate_tool_caches()

    def unregister_owner(self, owner: str) -> None:
        with self._lock:
            names = list(self._owned.pop(owner, []))
            if self._registry is not None:
                names.extend(self._registry.unregister_owner(owner))
            if not names:
                return
            from sigmaflow.agent import conf as agent_conf
            from sigmaflow.agent import tools as agent_tools

            gone = set(names)
            agent_conf.TOOLS = [
                t for t in agent_conf.TOOLS if t.get("name") not in gone
            ]
            agent_conf.CHILD_TOOLS = [
                t for t in agent_conf.CHILD_TOOLS if t.get("name") not in gone
            ]
            for name in gone:
                agent_tools.TOOL_HANDLERS.pop(name, None)
            _invalidate_tool_caches()

    # kernel 卸载约定: ModHost.unload 对每个服务调 dispose_owner(mod_id)
    dispose_owner = unregister_owner


def _invalidate_tool_caches() -> None:
    """工具集变化后让 /context-info 等缓存重新测量(与 /api/tools 行为一致)。"""
    try:
        from sigmaflow.server import science as _science

        _science._AGENT_CONTEXT_SIZES.clear()
    except Exception:  # noqa: BLE001 — 缓存清理尽力而为
        pass


# ------------------------------------------------------------ 子系统单例
class ModSubsystem:
    _instance: Optional["ModSubsystem"] = None
    _instance_lock = threading.Lock()

    @classmethod
    def instance(cls) -> "ModSubsystem":
        with cls._instance_lock:
            if cls._instance is None:
                cls._instance = cls()
            return cls._instance

    def __init__(self) -> None:
        self.services = ServiceRegistry()
        self.hooks = HookBus()
        self.envs = EnvRegistry()
        self.tools = LegacyToolBridge()
        self._events: deque = deque(maxlen=500)
        self.hooks.error_sink = self._push_event
        self.host = ModHost(
            services=self.services,
            hooks=self.hooks,
            event_sink=self._push_event,
        )
        self._bootstrapped = False
        self._lock = threading.RLock()

    # ------------------------------------------------------------- 事件
    def _push_event(self, event: dict) -> None:
        import time

        event = dict(event)
        event.setdefault("at", time.time())
        self._events.append(event)
        if len(self._events) > 500:
            self._events.popleft()

    def events(self, limit: int = 100) -> List[dict]:
        return list(self._events)[-limit:]

    # ----------------------------------------------------------- 装配
    def bootstrap(
        self,
        *,
        force: bool = False,
        home: Optional[Path] = None,
        builtin_dirs: Optional[List[Path]] = None,
    ) -> Dict[str, int]:
        """服务进程装配: 内置 mod 目录 + 用户 ~/.sigmaflow; 幂等。

        ``home``/``builtin_dirs`` 仅供测试注入; 生产路径走默认目录。
        """
        with self._lock:
            if self._bootstrapped and not force:
                return {"loaded": 0, "blocked": 0, "errored": 0, "skipped": 0}
            self.services.provide("envs", self.envs, owner="core")
            self.services.provide("tools", self.tools, owner="core")
            store = ModStore(home or self.home_dir())
            self.host.store = store
            stats = self.host.bootstrap(
                builtin_dirs=builtin_dirs or self.builtin_dirs(),
                target="server",
            )
            self._bootstrapped = True
            log.info(
                "mods bootstrap: %s loaded, %s blocked, %s errored, %s skipped",
                stats.get("loaded"),
                stats.get("blocked"),
                stats.get("errored"),
                stats.get("skipped"),
            )
            return stats

    @staticmethod
    def home_dir() -> Path:
        env = os.environ.get("SIGMAFLOW_HOME")
        return Path(env) if env else Path.home() / ".sigmaflow"

    @staticmethod
    def builtin_dirs() -> List[Path]:
        """内置 mod 目录: 包内 sigmaflow/mods + SIGMAFLOW_MODS 冒号分隔附加。"""
        import sigmaflow

        dirs = [Path(sigmaflow.__file__).parent / "mods"]
        extra = os.environ.get("SIGMAFLOW_MODS", "")
        dirs.extend(Path(p) for p in extra.split(":") if p.strip())
        return dirs

    # ------------------------------------------------------- 启停/重载
    def set_enabled(self, mod_id: str, enabled: bool) -> dict:
        with self._lock:
            rec = self.host.registry.get(mod_id)
            if rec is None:
                raise KeyError(mod_id)
            store = self.host.store
            assert store is not None
            entries = store.read_patch()
            entry = next((e for e in entries if e.mod == mod_id), None)
            if entry is None:
                entry = PatchEntry(mod=mod_id)
                entries.append(entry)
            entry.enabled = enabled
            store.write_patch(entries)
            if enabled:
                if rec.state == "enabled" and mod_id in self.host.contexts:
                    pass  # 已在运行, patch 只影响下次
                else:
                    self.host.load(rec)
            else:
                self.host.unload(mod_id)
                rec.state = "disabled"
                rec.state_reason = "disabled by patch"
            self.host.registry.bump_epoch()
            store.audit("mod.enabled" if enabled else "mod.disabled", mod=mod_id)
            return rec.to_dict()

    def reload_mod(self, mod_id: str) -> dict:
        with self._lock:
            rec = self.host.registry.get(mod_id)
            if rec is None:
                raise KeyError(mod_id)
            errors = self.host.unload(mod_id)
            ok = self.host.load(rec)
            self.host.registry.bump_epoch()
            if self.host.store is not None:
                self.host.store.audit("mod.reloaded", mod=mod_id, ok=ok, errors=errors)
            return rec.to_dict()

    def config_view(self, mod_id: str) -> dict:
        """叠加求值后的生效配置 + 每键来源层(设置页"为什么是这个值"视图)。

        始终现算而非读 ctx 快照: run-boundary mod 的 ctx.config 在下次重载
        前保持旧值(设计 §8), 但管理界面必须展示"下一次将生效的值"。
        """
        rec = self.host.registry.get(mod_id)
        if rec is None:
            raise KeyError(mod_id)
        from ..kernel import resolve_config

        layers: List[List[PatchEntry]] = []
        if self.host.store is not None:
            layers.append(self.host.store.read_patch())
        rc = resolve_config(rec.manifest.config_defaults, *layers, mod_id=mod_id)
        return {"config": rc.value, "provenance": rc.provenance}

    def update_config(self, mod_id: str, updates: Dict[str, Any]) -> dict:
        with self._lock:
            rec = self.host.registry.get(mod_id)
            if rec is None:
                raise KeyError(mod_id)
            store = self.host.store
            assert store is not None
            entries = store.read_patch()
            entry = next((e for e in entries if e.mod == mod_id), None)
            if entry is None:
                entry = PatchEntry(mod=mod_id)
                entries.append(entry)
            entry.config.update(updates)
            store.write_patch(entries)
            store.audit("mod.config", mod=mod_id, keys=sorted(updates))
            if rec.manifest.reload == "instant" and rec.state == "enabled":
                self.reload_mod(mod_id)
            return self.config_view(mod_id)

    def describe(self) -> dict:
        return {
            "epoch": self.host.registry.epoch,
            "mods": self.host.describe(),
            "events": list(self._events)[-50:],
        }


MODS = ModSubsystem.instance()


# ---------------------------------------------------------------- REST API
def mods_api(subsystem: ModSubsystem = MODS) -> APIRouter:
    from .science import _auth_http, _check_origin

    router = APIRouter(prefix="/api/mods", dependencies=[Depends(_auth_http)])

    @router.get("")
    async def list_mods():
        return subsystem.describe()

    @router.get("/events")
    async def mod_events(limit: int = 100):
        return {"events": subsystem.events(limit)}

    @router.post("/{mod_id}/enable")
    async def enable_mod(mod_id: str):
        try:
            rec = subsystem.set_enabled(mod_id, True)
        except KeyError:
            raise HTTPException(status_code=404, detail=f"unknown mod: {mod_id}")
        return {"mod": rec}

    @router.post("/{mod_id}/disable")
    async def disable_mod(mod_id: str):
        try:
            rec = subsystem.set_enabled(mod_id, False)
        except KeyError:
            raise HTTPException(status_code=404, detail=f"unknown mod: {mod_id}")
        return {"mod": rec}

    @router.post("/{mod_id}/reload")
    async def reload_mod(mod_id: str):
        try:
            rec = subsystem.reload_mod(mod_id)
        except KeyError:
            raise HTTPException(status_code=404, detail=f"unknown mod: {mod_id}")
        return {"mod": rec}

    @router.get("/{mod_id}/config")
    async def get_config(mod_id: str):
        try:
            return subsystem.config_view(mod_id)
        except KeyError:
            raise HTTPException(status_code=404, detail=f"unknown mod: {mod_id}")

    @router.put("/{mod_id}/config")
    async def put_config(mod_id: str, request: Request):
        _check_origin(request)
        body = await request.json()
        if not isinstance(body, dict):
            raise HTTPException(status_code=400, detail="invalid config payload")
        try:
            return subsystem.update_config(mod_id, body)
        except KeyError:
            raise HTTPException(status_code=404, detail=f"unknown mod: {mod_id}")

    return router
