"""ModContext — mod 视角的受控 API(设计 §4.3)。

mod 的 ``entry.py`` 暴露 ``activate(ctx)``(可选 ``deactivate(ctx)``);
一切注册都经由 ctx 完成, 内核据此知道"谁注册了什么", 卸载时精确回收。
"""

from __future__ import annotations

import logging
import threading
from typing import Any, Callable, Dict, List, Optional

from .hooks import HookBus, Subscription
from .permissions import SERVICE_CAPABILITY, CapabilityGate
from .services import ServiceRegistry, ServiceView

# 加载期"当前 mod"线程局部: 服务实现据此把注册归属到 mod(卸载时回收),
# mod 侧 API 无需显式传 owner。
_current_mod = threading.local()


def current_mod_id() -> Optional[str]:
    return getattr(_current_mod, "id", None)


def _set_current_mod(mod_id: Optional[str]) -> None:
    _current_mod.id = mod_id


class ModContext:
    def __init__(
        self,
        mod_id: str,
        epoch: int,
        services: ServiceRegistry,
        hooks: HookBus,
        capabilities: CapabilityGate,
        config: Dict[str, Any],
        config_provenance: Optional[Dict[str, str]] = None,
    ):
        self.mod_id = mod_id
        self.epoch = epoch
        self._services = services
        self._hooks = hooks
        self.capabilities = capabilities
        self.config = dict(config)
        self.config_provenance = dict(config_provenance or {})
        self._unload_callbacks: List[Callable[["ModContext"], None]] = []
        self._contributions: List[dict] = []
        self.log = logging.getLogger(f"sfmod.{mod_id}")

    # ------------------------------------------------------------- 服务
    @property
    def services(self) -> ServiceView:
        allowed = {
            name
            for name, cap in SERVICE_CAPABILITY.items()
            if cap is None or self.capabilities.allows(cap)
        }
        return self._services.view(allowed)

    # ------------------------------------------------------------- 钩子
    def on(
        self, event: str, fn: Callable, *, weight: float = 100, **kw: Any
    ) -> Subscription:
        """observe/filter 订阅。"""
        kw.setdefault("owner", self.mod_id)
        return self._hooks.subscribe(event, fn, weight=weight, **kw)

    def around(
        self, event: str, fn: Callable, *, weight: float = 100, **kw: Any
    ) -> Subscription:
        """around 包裹器注册。"""
        kw.setdefault("owner", self.mod_id)
        return self._hooks.add_wrapper(event, fn, weight=weight, **kw)

    # ------------------------------------------------------------- 卸载
    def on_unload(self, fn: Callable[["ModContext"], None]) -> None:
        """登记卸载回调: 关后台任务/浏览器会话/释放句柄。"""
        self._unload_callbacks.append(fn)

    def track(self, kind: str, ref: Any, **meta: Any) -> None:
        """登记一条贡献(内核卸载时按 kind 决定回收方式)。"""
        self._contributions.append({"kind": kind, "ref": ref, **meta})

    # -------------------------------------------------------- 内核内部用
    def run_unload_callbacks(self) -> List[str]:
        errors: List[str] = []
        for fn in reversed(self._unload_callbacks):
            try:
                fn(self)
            except Exception as exc:  # noqa: BLE001 — 卸载尽力而为
                errors.append(f"{type(exc).__name__}: {exc}")
        self._unload_callbacks.clear()
        return errors

    @property
    def contributions(self) -> List[dict]:
        return list(self._contributions)
