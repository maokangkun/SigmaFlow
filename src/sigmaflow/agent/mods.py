"""agent 侧 mod 引导(CLI 进程用; 服务进程走 server.mods.MODS)。

CLI 是独立进程: sigmaflow 命令启动时调用 agent_bootstrap(), 扫描同一批
mod 目录(内置 + ~/.sigmaflow), target="cli"(server 接线类 mod 跳过),
提供 tools/loop 两个服务 — 工具 mod 与 loop mod 在 CLI 同样生效。
"""

from __future__ import annotations

import threading
from pathlib import Path
from typing import Optional

from ..kernel import ModHost, ModStore, ServiceRegistry
from .loop import LoopService, loop_hooks


class _CliAgentMods:
    _instance: Optional["_CliAgentMods"] = None
    _lock = threading.Lock()

    @classmethod
    def instance(cls) -> "_CliAgentMods":
        with cls._lock:
            if cls._instance is None:
                cls._instance = cls()
            return cls._instance

    def __init__(self) -> None:
        self.services = ServiceRegistry()
        self.hooks = loop_hooks()
        self.loop = LoopService()
        self.host = ModHost(services=self.services, hooks=self.hooks)
        self._bootstrapped = False

    def bootstrap(self, *, home: Optional[Path] = None, builtin_dirs=None) -> dict:
        if self._bootstrapped:
            return {"loaded": 0, "blocked": 0, "errored": 0, "skipped": 0}
        import os

        from ..kernel.tools import ToolRegistry

        # CLI 侧工具桥: 直接复用 server 侧实现(纯 agent 模块操作)
        from ..server.mods import LegacyToolBridge

        bridge = LegacyToolBridge()
        bridge.bind_registry(ToolRegistry())
        self.services.provide("tools", bridge, owner="core")
        self.services.provide("loop", self.loop, owner="core")
        env = home or os.environ.get("SIGMAFLOW_HOME")
        self.host.store = ModStore(Path(env) if env else Path.home() / ".sigmaflow")
        if builtin_dirs is None:
            import sigmaflow

            dirs = [Path(sigmaflow.__file__).parent / "mods"]
            extra = os.environ.get("SIGMAFLOW_MODS", "")
            dirs.extend(Path(p) for p in extra.split(":") if p.strip())
            builtin_dirs = dirs
        stats = self.host.bootstrap(builtin_dirs=builtin_dirs, target="cli")
        self._bootstrapped = True
        return stats


def agent_bootstrap() -> dict:
    """CLI 进程装配(幂等); sigmaflow 命令入口调用。"""
    return _CliAgentMods.instance().bootstrap()


def agent_mods() -> _CliAgentMods:
    return _CliAgentMods.instance()
