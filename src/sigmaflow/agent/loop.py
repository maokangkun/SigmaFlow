"""Agent loop 阶段管线(设计 §6.1, P2)。

`Agent.__call__` 的原 1380 行单体拆为七个阶段方法(逐字搬移, 见
agent.py 类体), 本模块提供:

- ``LoopContext``: 跨阶段共享态(消息/信息/工具面/轮次计数等)。
- ``run_agent_loop``: 驱动器 — 按固定顺序调阶段并解释 LOOP_* 控制码。
  阶段边界即钩子边界(P2 Step B 在此开放 agent.* 事件)。
- 阶段表可被替换(loop-as-mod, experimental): 驱动器不关心阶段方法从哪来,
  ``agent.loop`` 扩展点的 mod 提供同名阶段方法子集即可接管对应阶段;
  整表替换则提供自己的 run 函数。

行为契约: 无 mod 干预时, 阶段顺序与控制流与拆分前的单体逐语句等价
(金轨: tests/test_agent_loop_golden.py)。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

# 控制码
LOOP_PROCEED = "proceed"  # 继续本轮后续阶段
LOOP_NEXT_TURN = "next_turn"  # 直接进入下一轮(对应原 continue)
LOOP_END = "end"  # 结束循环(对应原 break)
LOOP_TOOLS = "tools"  # settle 放行 → 工具分发

STAGE_ORDER = (
    "turn_begin",
    "llm_call",
    "settle",
    "exec_tools",
    "turn_end",
)


@dataclass
class LoopContext:
    """一个 Agent 调用(一次 __call__)的全程共享态。

    消息/信息两容器在阶段间按引用共享; 标量一律经 lc 读写。
    阶段方法与钩子都可持有并修改 lc。
    """

    messages: List[dict]
    info: Dict[str, Any] = field(default_factory=dict)
    subagent: bool = False
    is_print: bool = True
    show_processing: bool = True
    print: Callable = lambda *a, **k: None
    usable_tools: Optional[list] = None
    max_turn: float = 1e10
    cur_turn: int = 0
    begin_time: float = 0.0
    ratio: float = 0.0
    manual_compact: bool = False
    silent_tools: int = 0
    nudge_armed: int = 0
    _nudge_at: int = 10
    max_model_len: int = 0
    tried: int = 0
    knight_rider: Any = None
    response: Any = None
    msg: Any = None
    calls: Optional[list] = None
    notifs: list = field(default_factory=list)
    cost_time: float = 0.0
    # P2 Step B: 阶段级覆盖/钩子宿主(None = 内置空转)
    stage_overrides: Dict[str, Callable] = field(default_factory=dict)
    hooks: Any = None


def run_agent_loop(agent, lc: LoopContext):
    """核心驱动: 与原单体循环等价的阶段编排。

    ``agent`` 是 Agent 实例(阶段方法宿主); 阶段可被 lc.stage_overrides
    覆盖(扩展点接线后由 loop 服务注入), 覆盖函数签名 ``fn(agent, lc)``。
    """
    while lc.cur_turn < lc.max_turn:
        r = _run_stage(agent, lc, "_stage_turn_begin")
        if r == LOOP_END:
            break
        r = _run_stage(agent, lc, "_stage_llm_call")
        if r == LOOP_END:
            break
        r = _run_stage(agent, lc, "_stage_settle")
        if r == LOOP_END:
            break
        if r == LOOP_NEXT_TURN:
            continue
        _run_stage(agent, lc, "_stage_exec_tools")
        _run_stage(agent, lc, "_stage_turn_end")
    return agent._loop_teardown(lc)


def _run_stage(agent, lc: LoopContext, attr: str):
    override = lc.stage_overrides.get(attr)
    if override is not None:
        return override(agent, lc)
    return getattr(agent, attr)(lc)
