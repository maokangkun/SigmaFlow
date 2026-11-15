"""优先级钩子总线 — kernel 三件套之一。

设计约束(对应 mod 架构设计 §4.2 / §9):

- 事件名为带点的稳定标识(``agent.turn.begin``); 订阅按 ``(weight, 序号, mod_id)``
  排序, weight 越小越靠近核心(默认 100)。
- 三类语义:
  * **observe** — ``subscribe``/``emit``: 顺序调用, 收集返回值, 异常隔离。
  * **filter** — ``add_filter``/``apply``: 值变换链, 每个钩子拿上一个的返回值。
  * **around** — ``add_wrapper``/``resolve``: 洋葱包裹一个基础实现, 用于
    ``agent.tool.exec`` / ``agent.llm.call`` 这类"可整段替换但要能回退"的点。
- 错误隔离默认 fail-open(记为事件并继续); 订阅时可声明 ``fail_closed=True``
  (如安全审计类钩子, 失败必须中断)。
- 内核自身不依赖任何第三方库。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional, Sequence

log = logging.getLogger("sigmaflow.kernel.hooks")


@dataclass
class Subscription:
    event: str
    fn: Callable[..., Any]
    weight: float
    order: int  # 注册序号, 同 weight 时先注册先执行
    owner: str  # 贡献者(mod id 或 "core")
    fail_closed: bool = False

    def sort_key(self) -> tuple:
        return (self.weight, self.order)


class HookError(Exception):
    """fail-closed 钩子抛出时携带的聚合异常。"""

    def __init__(self, event: str, errors: List[BaseException]):
        self.event = event
        self.errors = errors
        super().__init__(
            f"hook {event!r} failed closed with {len(errors)} error(s): "
            + "; ".join(repr(e)[:200] for e in errors)
        )


class HookBus:
    """一个 epoch 生命周期内的钩子注册表。

    线程模型: 注册/触发都在调用方线程; 钩子函数自行保证线程安全
    (与现有 agent 工具执行的线程模型一致)。
    """

    def __init__(self) -> None:
        self._subs: Dict[str, List[Subscription]] = {}
        self._wrappers: Dict[str, List[Subscription]] = {}
        self._order = 0
        self.error_sink: Optional[Callable[[dict], None]] = None

    # ------------------------------------------------------------ subscribe
    def subscribe(
        self,
        event: str,
        fn: Callable[..., Any],
        *,
        weight: float = 100,
        owner: str = "core",
        fail_closed: bool = False,
    ) -> Subscription:
        """注册 observe 型钩子: 顺序调用, 返回值收集进列表。"""
        sub = Subscription(event, fn, weight, self._next_order(), owner, fail_closed)
        self._subs.setdefault(event, []).append(sub)
        self._subs[event].sort(key=Subscription.sort_key)
        return sub

    def unsubscribe(self, sub: Subscription) -> None:
        """移除一个订阅(幂等)。mod 卸载时内核按 owner 批量清理。"""
        for bucket in (self._subs, self._wrappers):
            lst = bucket.get(sub.event)
            if lst and sub in lst:
                lst.remove(sub)

    def unsubscribe_owner(self, owner: str) -> int:
        """移除某贡献者的全部订阅; 返回移除数。"""
        removed = 0
        for bucket in (self._subs, self._wrappers):
            for event, lst in list(bucket.items()):
                keep = [s for s in lst if s.owner != owner]
                removed += len(lst) - len(keep)
                if keep:
                    bucket[event] = keep
                else:
                    bucket.pop(event, None)
        return removed

    # ----------------------------------------------------------------- emit
    def emit(self, event: str, *args: Any, **kwargs: Any) -> List[Any]:
        """顺序调用 observe 型钩子; 返回非 None 返回值列表(保持顺序)。"""
        results: List[Any] = []
        for sub in list(self._subs.get(event, ())):
            ret = self._call(event, sub, args, kwargs)
            if ret is not None:
                results.append(ret)
        return results

    async def emit_async(self, event: str, *args: Any, **kwargs: Any) -> List[Any]:
        """emit 的协程版: 钩子可为同步或异步函数。"""
        results: List[Any] = []
        for sub in list(self._subs.get(event, ())):
            ret = self._call(event, sub, args, kwargs)
            if ret is not None:
                if hasattr(ret, "__await__"):
                    ret = await ret
                results.append(ret)
        return results

    # -------------------------------------------------------------- filter
    def add_filter(
        self, event: str, fn: Callable[[Any], Any], **kw: Any
    ) -> Subscription:
        """注册 filter 型钩子: ``fn(value, *args) -> value``。"""
        return self.subscribe(event, fn, **kw)

    def apply(self, event: str, value: Any, *args: Any) -> Any:
        """值变换链: 逐个应用, fail-open 的钩子异常时跳过该钩子。"""
        for sub in list(self._subs.get(event, ())):
            ret = self._call(event, sub, (value, *args), {})
            if ret is not None:
                value = ret
        return value

    # -------------------------------------------------------------- around
    def add_wrapper(self, event: str, fn: Callable, **kw: Any) -> Subscription:
        """注册 around 型包裹器。

        ``fn(next_fn, *args, **kwargs)`` — 可在调用前后做事、改参改返回值、
        或干脆不调 next(整段替换)。多个包裹器按 weight 顺序洋葱嵌套
        (weight 小者在最外层)。
        """
        sub = Subscription(
            event,
            fn,
            kw.get("weight", 100),
            self._next_order(),
            kw.get("owner", "core"),
            kw.get("fail_closed", False),
        )
        self._wrappers.setdefault(event, []).append(sub)
        self._wrappers[event].sort(key=Subscription.sort_key)
        return sub

    def resolve(self, event: str, base: Callable) -> Callable:
        """把注册的包裹器组合到 ``base`` 上, 返回可直接调用的合成函数。

        包裹器自身异常按其 fail_closed 处理: fail-open 时回退到被包裹
        实现(设计 §9 错误隔离), fail-closed 时向上抛。
        """

        def _chain(subs: Sequence[Subscription]) -> Callable:
            if not subs:
                return base
            head, rest = subs[0], list(subs[1:])
            inner = _chain(rest)

            def wrapped(*args: Any, **kwargs: Any):
                try:
                    return head.fn(inner, *args, **kwargs)
                except Exception as exc:  # noqa: BLE001 — 隔离边界
                    self._report(head, exc)
                    if head.fail_closed:
                        raise
                    # fail-open: 跳过该包裹器, 执行其内层
                    return inner(*args, **kwargs)

            return wrapped

        return _chain(list(self._wrappers.get(event, ())))

    # --------------------------------------------------------------- 内部
    def _next_order(self) -> int:
        self._order += 1
        return self._order

    def _call(self, event: str, sub: Subscription, args: tuple, kwargs: dict) -> Any:
        try:
            return sub.fn(*args, **kwargs)
        except Exception as exc:  # noqa: BLE001 — 隔离边界
            self._report(sub, exc)
            if sub.fail_closed:
                raise
            return None

    def _report(self, sub: Subscription, exc: BaseException) -> None:
        log.warning("hook %s (owner=%s) failed: %s", sub.event, sub.owner, exc)
        if self.error_sink is not None:
            try:
                self.error_sink(
                    {
                        "kind": "hook_error",
                        "event": sub.event,
                        "owner": sub.owner,
                        "error": f"{type(exc).__name__}: {exc}",
                    }
                )
            except Exception:  # noqa: BLE001 — sink 不可再抛
                pass

    # -------------------------------------------------------------- 内省
    def describe(self) -> List[dict]:
        """列出全部订阅(调试端点与 SFM_TRACE_HOOKS 用)。"""
        out = []
        for kind, bucket in (
            ("observe", self._subs),
            ("around", self._wrappers),
        ):
            for event, subs in sorted(bucket.items()):
                for s in subs:
                    out.append(
                        {
                            "kind": kind,
                            "event": event,
                            "owner": s.owner,
                            "weight": s.weight,
                            "fn": getattr(s.fn, "__name__", repr(s.fn))[:120],
                        }
                    )
        return out
