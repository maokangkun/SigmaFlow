"""具名服务注册表 — kernel 三件套之二。

服务 = 系统中可被 mod 通过 ``ctx.services.<name>`` 访问的功能对象
(models / runs / fs / projects / mcp / skills / tools / prompts / envs …)。
本模块只做注册与解析; 各服务的真实实现由 core 或 server 侧提供,
kernel 对其类型不做任何假设(保持零第三方依赖)。

覆盖规则: 默认先注册先得; 显式 ``replace=True`` 方可覆盖(管理界面展示
覆盖链), 与 mod 架构设计 §5.3 的"同名需显式声明"一致。
"""

from __future__ import annotations

import logging
import threading
from typing import Any, Callable, Dict, Optional

log = logging.getLogger("sigmaflow.kernel.services")


class ServiceOverrideError(RuntimeError):
    pass


class ServiceRegistry:
    def __init__(self) -> None:
        self._services: Dict[str, Any] = {}
        self._owners: Dict[str, str] = {}
        self._factories: Dict[str, Callable[[], Any]] = {}
        self._lock = threading.RLock()

    def provide(
        self,
        name: str,
        service: Any,
        *,
        owner: str = "core",
        replace: bool = False,
    ) -> None:
        """注册一个服务实例(立即物化)。"""
        with self._lock:
            if name in self._services and not replace:
                raise ServiceOverrideError(
                    f"service {name!r} already provided by "
                    f"{self._owners.get(name)!r}; pass replace=True to override"
                )
            self._services[name] = service
            self._owners[name] = owner
            self._factories.pop(name, None)

    def provide_factory(
        self, name: str, factory: Callable[[], Any], *, owner: str = "core"
    ) -> None:
        """注册惰性工厂: 首次 ``get`` 时物化(重内核启动用)。"""
        with self._lock:
            self._factories[name] = factory
            self._owners[name] = owner
            self._services.pop(name, None)

    def get(self, name: str) -> Any:
        with self._lock:
            if name in self._services:
                return self._services[name]
            if name in self._factories:
                svc = self._factories[name]()
                self._services[name] = svc
                self._factories.pop(name)
                return svc
        raise KeyError(
            f"service {name!r} not provided; available: {sorted(self._owners)}"
        )

    def try_get(self, name: str) -> Optional[Any]:
        try:
            return self.get(name)
        except KeyError:
            return None

    def remove(self, name: str, *, owner: str = "core") -> None:
        """仅属主可摘除自己提供的服务(core 可摘除任何)。"""
        with self._lock:
            current = self._owners.get(name)
            if current is None:
                return
            if owner != "core" and current != owner:
                raise PermissionError(
                    f"service {name!r} owned by {current!r}, not removable by {owner!r}"
                )
            self._services.pop(name, None)
            self._owners.pop(name, None)
            self._factories.pop(name, None)

    def names(self) -> Dict[str, str]:
        """服务名 → 属主清单(管理界面用)。"""
        with self._lock:
            return dict(self._owners)

    def view(self, allowed: Optional[set] = None) -> "ServiceView":
        """按能力过滤的只读视图(mod 视角)。``allowed=None`` 表示全量。"""
        return ServiceView(self, allowed)


class ServiceView:
    """受限访问视图: 未授权名字的属性访问直接报 KeyError, 而不是暴露一切。"""

    def __init__(self, registry: ServiceRegistry, allowed: Optional[set]):
        self._registry = registry
        self._allowed = allowed

    def __getattr__(self, name: str) -> Any:
        if name.startswith("_"):
            raise AttributeError(name)
        if self._allowed is not None and name not in self._allowed:
            raise KeyError(
                f"service {name!r} not granted to this mod (check capabilities)"
            )
        return self._registry.get(name)
