"""ToolRegistry — 工具注册表(设计 §6.2)。

P0 形态: ``from_legacy`` 适配器把现有 ``conf.TOOLS``/``conf.CHILD_TOOLS``
(schema)与 ``tools.TOOL_HANDLERS``(实现)收编为 ToolSpec 集合, 快照输出
与现有数据结构逐字节一致 — 供金轨测试对拍, science 侧随后切换读取来源。

正式形态(P1+): core 与 mod 都经 ``register(ToolSpec(...))`` 注册;
冲突策略: 同名需在 manifest ``overrides-tools`` 显式声明, 注册表维护
覆盖链(下层可回退), 未声明的同名注册直接拒绝。
"""

from __future__ import annotations

import dataclasses
import threading
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, FrozenSet, Iterable, List, Optional, Tuple

MAIN = "main"
SUBAGENT = "subagent"


class ToolConflictError(ValueError):
    pass


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    input_schema: Dict[str, Any]
    handler: Optional[Callable[..., Any]]
    owner: str = "core"
    audience: FrozenSet[str] = frozenset({MAIN, SUBAGENT})
    timeout_default: Optional[int] = None
    timeout_max: Optional[int] = None
    capabilities: Tuple[str, ...] = ()
    version: str = "0"
    replaces: Optional[str] = None  # 被本工具覆盖的下层工具名(同名)


class ToolSnapshot:
    """某一代(epoch)的工具集只读视图。

    schemas 列表按注册序返回(与现有 TOOLS/CHILD_TOOLS 的静态顺序一致,
    保证发给模型的工具清单字节级稳定, 前缀缓存不受影响)。
    """

    def __init__(self, specs: List[ToolSpec]):
        self._specs = list(specs)
        self._by_name: Dict[str, ToolSpec] = {s.name: s for s in specs}
        self._main = [
            {
                "name": s.name,
                "description": s.description,
                "input_schema": dict(s.input_schema),
            }
            for s in specs
            if MAIN in s.audience
        ]
        self._sub = [
            {
                "name": s.name,
                "description": s.description,
                "input_schema": dict(s.input_schema),
            }
            for s in specs
            if SUBAGENT in s.audience
        ]

    def schemas(self, audience: str = MAIN) -> List[dict]:
        return self._main if audience == MAIN else self._sub

    def handler(self, name: str) -> Optional[Callable[..., Any]]:
        spec = self._by_name.get(name)
        return spec.handler if spec else None

    def spec(self, name: str) -> Optional[ToolSpec]:
        return self._by_name.get(name)

    def names(self, audience: str = MAIN) -> List[str]:
        return [s["name"] for s in self.schemas(audience)]

    @property
    def specs(self) -> List[ToolSpec]:
        return list(self._specs)

    def override_chain(self, name: str) -> List[str]:
        """同名覆盖链(最上层在末尾), 管理界面展示用。"""
        chain = []
        cur = self._by_name.get(name)
        seen = set()
        while cur is not None and cur.name not in seen:
            seen.add(cur.name)
            chain.append(f"{cur.name}@{cur.owner}")
            cur = self._by_name.get(cur.replaces) if cur.replaces else None
        return chain


class ToolRegistry:
    def __init__(self) -> None:
        self._active: Dict[str, ToolSpec] = {}  # name → 生效 spec
        self._all: Dict[str, List[ToolSpec]] = {}  # name → 覆盖栈(0=最底层)
        self._order: List[str] = []  # 生效注册顺序(排序用)
        self._lock = threading.RLock()

    # ------------------------------------------------------------- 注册
    def register(
        self,
        spec: ToolSpec,
        *,
        overrides: Optional[Iterable[str]] = None,
    ) -> ToolSpec:
        """注册/覆盖一个工具。

        同名已存在时: 调用方传入的 ``overrides`` 声明(通常来自 manifest
        的 ``overrides-tools``)包含该名字才允许, 旧的压入覆盖栈。
        """
        with self._lock:
            existing = self._active.get(spec.name)
            if existing is not None:
                allowed = set(overrides or ())
                if spec.name not in allowed:
                    raise ToolConflictError(
                        f"tool {spec.name!r} already registered by "
                        f"{existing.owner!r}; declare overrides-tools to replace it"
                    )
                if spec.replaces is None:
                    spec = dataclasses.replace(spec, replaces=existing.name)
            else:
                self._order.append(spec.name)
            self._all.setdefault(spec.name, []).append(spec)
            self._active[spec.name] = spec
            return spec

    def unregister_owner(self, owner: str) -> List[str]:
        """摘除某属主注册的全部工具(回退到被覆盖的下层, 如有)。"""
        removed: List[str] = []
        with self._lock:
            for name in list(self._active):
                stack = self._all.get(name) or []
                kept = [s for s in stack if s.owner != owner]
                if kept == stack:
                    continue
                removed.append(name)
                if kept:
                    self._all[name] = kept
                    self._active[name] = kept[-1]
                else:
                    self._all.pop(name, None)
                    self._active.pop(name, None)
                    if name in self._order:
                        self._order.remove(name)
        return removed

    # ------------------------------------------------------------- 快照
    def snapshot(self) -> ToolSnapshot:
        with self._lock:
            specs = [self._active[n] for n in self._order if n in self._active]
        return ToolSnapshot(specs)

    def describe(self) -> List[dict]:
        snap = self.snapshot()
        return [
            {
                "name": s.name,
                "owner": s.owner,
                "audience": sorted(s.audience),
                "replaces": s.replaces,
            }
            for s in snap.specs
        ]

    # -------------------------------------------------------- 遗留适配
    @classmethod
    def from_legacy(
        cls,
        main_tools: List[dict],
        child_tools: List[dict],
        handlers: Dict[str, Callable[..., Any]],
    ) -> "ToolRegistry":
        """把 conf.TOOLS / conf.CHILD_TOOLS / tools.TOOL_HANDLERS 收编为注册表。

        顺序契约: main 快照与 ``main_tools`` 同序同内容; subagent 快照与
        ``child_tools`` 同序同内容; handler 查找与 ``handlers`` 同对象。
        """
        reg = cls()
        child_names = {t.get("name") for t in child_tools}
        main_names = {t.get("name") for t in main_tools}
        # 主序来源: main_tools 的静态顺序(tools.py 导入时 TOOLS.extend(SCIVERSE_TOOLS)
        # 也发生在这个顺序里); child 集内的条目 audience 双含。
        for t in main_tools:
            name = t["name"]
            reg.register(
                ToolSpec(
                    name=name,
                    description=t.get("description", ""),
                    input_schema=t.get("input_schema", {}),
                    handler=handlers.get(name),
                    audience=(
                        frozenset({MAIN, SUBAGENT})
                        if name in child_names
                        else frozenset({MAIN})
                    ),
                )
            )
        # 防御: child 独有条目(现状契约下不出现)以 subagent-only 补注册
        for t in child_tools:
            name = t.get("name")
            if name in main_names:
                continue
            reg.register(
                ToolSpec(
                    name=name,
                    description=t.get("description", ""),
                    input_schema=t.get("input_schema", {}),
                    handler=handlers.get(name),
                    audience=frozenset({SUBAGENT}),
                )
            )
        return reg
