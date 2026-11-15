"""PromptComposer — system prompt 分层贡献(设计 §6.3)。

现状事实: system prompt 已经是拼装产物 — conf.SYSTEM 基底 + science 侧
的目录块/模型块/memory 注入/skills 列表/项目技能段。本模块把"分段 + 定序"
形式化:

- ``PromptSection(id, weight, builder, when)`` — builder 拿组装上下文
  (dict) 返回该段文本; weight 定序, 段与段之间以两个换行连接
  (与现有 += 拼接的空白语义一致)。
- 同 id 覆盖需 ``replace=True``(对应 manifest 的显式覆盖原则)。
- compose(kind, ctx) 输出按 weight 排序的全部命中段。

P0 金轨: 以 conf.SYSTEM/SUBAGENT_SYSTEM 为唯一基底段时, compose 输出与
常量逐字节一致(见 tests/test_kernel_golden.py)。
"""

from __future__ import annotations

import threading
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional

PromptBuilder = Callable[[Dict[str, Any]], str]


@dataclass(frozen=True)
class PromptSection:
    id: str
    weight: float
    builder: PromptBuilder
    when: Optional[Callable[[Dict[str, Any]], bool]] = None
    owner: str = "core"

    def applies(self, ctx: Dict[str, Any]) -> bool:
        return self.when is None or bool(self.when(ctx))


class PromptSectionConflict(ValueError):
    pass


class PromptComposer:
    def __init__(self) -> None:
        self._sections: Dict[str, PromptSection] = {}
        self._superseded: Dict[str, List[PromptSection]] = {}
        self._lock = threading.RLock()

    def add_section(self, section: PromptSection, *, replace: bool = False) -> None:
        with self._lock:
            existing = self._sections.get(section.id)
            if existing is not None and not replace:
                raise PromptSectionConflict(
                    f"prompt section {section.id!r} already contributed by "
                    f"{existing.owner!r}; pass replace=True"
                )
            if existing is not None:
                self._superseded.setdefault(section.id, []).append(existing)
            self._sections[section.id] = section

    def remove_owner(self, owner: str) -> List[str]:
        """摘除某属主的段; 被其覆盖的下层段恢复(覆盖栈退栈)。"""
        removed: List[str] = []
        with self._lock:
            for sid in list(self._sections):
                sec = self._sections[sid]
                if sec.owner == owner:
                    removed.append(sid)
                    stack = self._superseded.get(sid) or []
                    if stack:
                        self._sections[sid] = stack.pop()
                    else:
                        self._sections.pop(sid)
                        self._superseded.pop(sid, None)
            for sid in list(self._superseded):
                self._superseded[sid] = [
                    s for s in self._superseded[sid] if s.owner != owner
                ]
        return removed

    def compose(self, kind: str = "main", ctx: Optional[Dict[str, Any]] = None) -> str:
        """按 weight 排序拼接命中段; kind/ctx 供 when 过滤与 builder 取值。"""
        ctx = dict(ctx or {})
        ctx.setdefault("kind", kind)
        with self._lock:
            sections = sorted(self._sections.values(), key=lambda s: (s.weight, s.id))
        parts = [sec.builder(ctx) for sec in sections if sec.applies(ctx)]
        # 过滤空段(与现有"条件块不拼接"语义一致), 但保留显式的空串行为
        parts = [p for p in parts if p is not None]
        return "\n\n".join(parts)

    def describe(self) -> List[dict]:
        with self._lock:
            return [
                {
                    "id": s.id,
                    "owner": s.owner,
                    "weight": s.weight,
                    "superseded": [x.id for x in self._superseded.get(s.id, [])],
                }
                for s in sorted(self._sections.values(), key=lambda s: (s.weight, s.id))
            ]
