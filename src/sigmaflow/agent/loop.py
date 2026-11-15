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
    # 多用户隔离(P-用户层): 本次调用的属主用户; 钩子按"属主 mod 对该用户
    # 是否启用"过滤。None = 无用户概念(CLI/单用户), 全部放行。
    user: Optional[str] = None


def run_agent_loop(agent, lc: LoopContext):
    """核心驱动: 与原单体循环等价的阶段编排。

    钩子面(P2 Step B):
    - observe: ``agent.turn.begin`` / ``agent.turn.end`` / ``agent.loop.end``
    - around:  ``agent.stage.<name>``(<name> ∈ turn_begin/llm_call/settle/
      exec_tools/turn_end)包裹整阶段; ``agent.tool.exec`` 在工具执行点包裹
      (见 _stage_exec_tools 内 _exec_chain)。
    ``agent`` 是 Agent 实例(阶段方法宿主); 阶段可被 lc.stage_overrides
    覆盖(loop 服务注入, fn(agent, lc)); _LOOP_DRIVER 可整体替换 loop。
    无订阅时钩子为零行为差(金轨对拍守护)。
    """
    if _LOOP_DRIVER is not None:
        return _LOOP_DRIVER(agent, lc)
    hooks = lc.hooks
    while lc.cur_turn < lc.max_turn:
        if hooks is not None:
            hooks.emit("agent.turn.begin", lc)
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
            if hooks is not None:
                hooks.emit("agent.turn.end", lc, "next_turn")
            continue
        _run_stage(agent, lc, "_stage_exec_tools")
        _run_stage(agent, lc, "_stage_turn_end")
        if hooks is not None:
            hooks.emit("agent.turn.end", lc, "tools")
    if hooks is not None:
        hooks.emit("agent.loop.end", lc)
    return agent._loop_teardown(lc)


def _run_stage(agent, lc: LoopContext, attr: str):
    override = lc.stage_overrides.get(attr)
    if override is not None:
        return override(agent, lc)
    fn = getattr(agent, attr)
    if lc.hooks is not None:
        event = "agent.stage." + attr.removeprefix("_stage_")
        fn = lc.hooks.resolve(event, fn)
    return fn(lc)


# --------------------------------------------------------------- mod 接线面
# 进程级 loop 扩展点状态: Agent 每次 __call__ 时快照(= 世代语义, 设计 §8 L1)。
_STAGE_OVERRIDES: Dict[str, Callable] = {}
_LOOP_DRIVER: Optional[Callable] = None
_LOOP_DRIVER_OWNER: Optional[str] = None

# 进程共享的 agent 事件总线(服务端由 MODS 接管同一实例, CLI 由 agent 侧引导装配)
LOOP_HOOKS = None  # 延迟创建, 避免 import 期拉起 kernel


def loop_hooks():
    """惰性取进程总线; server/mods 与 agent/mods 各自 ensure 后共享。"""
    global LOOP_HOOKS
    if LOOP_HOOKS is None:
        from ..kernel.hooks import HookBus

        LOOP_HOOKS = HookBus()
    return LOOP_HOOKS


class LoopService:
    """``ctx.services.loop`` — loop 扩展点的注册面(experimental, 设计 §6.1)。

    - override_stage: 替换单个阶段(签名 fn(agent, lc) -> LOOP_*)
    - replace_driver: 整体替换驱动循环(声明 replaces=["core-loop"] 的 mod)
    - on/around: 直接挂 agent.* 事件
    注册自动归属到当前加载的 mod, 卸载时回收(kernel dispose_owner 约定)。
    """

    def __init__(self) -> None:
        self.hooks = loop_hooks()
        self._owned_stages: Dict[str, List[str]] = {}
        self._owned_driver: Dict[str, None] = {}

    # ---------------------------------------------------------- 阶段替换
    def override_stage(self, stage: str, fn: Callable) -> None:
        """stage ∈ turn_begin/llm_call/settle/exec_tools/turn_end。"""
        attr = "_stage_" + stage
        if attr not in STAGE_ATTRS:
            raise ValueError(f"unknown stage {stage!r}; known: {sorted(STAGE_ATTRS)}")
        owner = _current_owner()
        _STAGE_OVERRIDES[attr] = fn
        if owner:
            self._owned_stages.setdefault(owner, []).append(attr)

    def replace_driver(self, fn: Callable) -> None:
        """整体替换驱动循环; 同一时刻仅一个 driver(后注册者覆盖并记审计)。"""
        global _LOOP_DRIVER, _LOOP_DRIVER_OWNER
        owner = _current_owner()
        _LOOP_DRIVER = fn
        _LOOP_DRIVER_OWNER = owner
        if owner:
            self._owned_driver[owner] = None

    # -------------------------------------------------------------- 钩子
    def on(self, event: str, fn: Callable, **kw: Any) -> None:
        owner = _current_owner() or "core"
        kw.setdefault("owner", owner)

        def _gated(lc_or_arg, *a, **k):
            if not _gate(owner, _event_user(lc_or_arg)):
                return None
            return fn(lc_or_arg, *a, **k)

        _gated.__name__ = getattr(fn, "__name__", "gated")
        self.hooks.subscribe(event, _gated, **kw)

    def around(self, event: str, fn: Callable, **kw: Any) -> None:
        owner = _current_owner() or "core"
        kw.setdefault("owner", owner)

        def _gated(next_fn, *a, **k):
            if not _gate(owner, _loop_user_ctx.get()):
                return next_fn(*a, **k)  # 属主 mod 对该用户停用: 直通不拦截
            return fn(next_fn, *a, **k)

        _gated.__name__ = getattr(fn, "__name__", "gated")
        self.hooks.add_wrapper(event, _gated, **kw)

    # ---------------------------------------------------------- 卸载回收
    def dispose_owner(self, owner: str) -> None:
        global _LOOP_DRIVER, _LOOP_DRIVER_OWNER
        for attr in self._owned_stages.pop(owner, []):
            _STAGE_OVERRIDES.pop(attr, None)
        if owner in self._owned_driver:
            self._owned_driver.pop(owner, None)
            if _LOOP_DRIVER_OWNER == owner:
                _LOOP_DRIVER = None
                _LOOP_DRIVER_OWNER = None
        self.hooks.unsubscribe_owner(owner)

    # -------------------------------------------------------------- 内省
    def describe(self) -> dict:
        return {
            "stage_overrides": dict(_STAGE_OVERRIDES),
            "driver_replaced": _LOOP_DRIVER is not None,
            "driver_owner": _LOOP_DRIVER_OWNER,
            "hooks": self.hooks.describe(),
        }


STAGE_ATTRS = {
    "_stage_" + name
    for name in ("turn_begin", "llm_call", "settle", "exec_tools", "turn_end")
}


def _current_owner() -> Optional[str]:
    """当前注册归属: 加载期是 mod id; 非加载期(测试/内核直用)记匿名哨兵。"""
    from ..kernel.context import current_mod_id

    return current_mod_id() or "__anonymous__"


# 用户门控谓词: server 侧(ModSubsystem)启动时注入; None=放行一切
_mod_enabled_for = None


def set_user_gate(fn) -> None:
    """注入 ``fn(owner_mod_id, user) -> bool``(多用户隔离的服务端接线)。"""
    global _mod_enabled_for
    _mod_enabled_for = fn


# core 功能门控: agent 内部行为(压缩/记忆/技能)按 core-<name> mod 的启停
# 短路; 注入方为 server(MODS.effective_enabled), 未注入=全放行(CLI/单用户)
_feature_gate = None


def set_feature_gate(fn) -> None:
    """注入 ``fn(feature, user) -> bool``, feature ∈ compaction/memory/skills。"""
    global _feature_gate
    _feature_gate = fn


def feature_enabled(feature: str, user: Optional[str] = None) -> bool:
    if _feature_gate is None:
        return True
    try:
        return bool(_feature_gate(feature, user))
    except Exception:  # noqa: BLE001 — 门控故障放行
        return True


def _gate(owner: Optional[str], user: Optional[str]) -> bool:
    if _mod_enabled_for is None or owner in (None, "__anonymous__", "core"):
        return True
    try:
        return bool(_mod_enabled_for(owner, user))
    except Exception:  # noqa: BLE001 — 门控故障放行(fail-open, 与钩子隔离一致)
        return True


def _event_user(first_arg: Any) -> Optional[str]:
    """从钩子首参(LoopContext 或其他)取 user。"""
    return getattr(first_arg, "user", None)


# 工具执行点的用户上下文: agent.tool.exec 包裹器签名固定(next_fn, func, inp),
# 不能加 kwargs; _tool_exec 闭包持 lc, 执行线程内经 contextvar 传递用户
import contextvars  # noqa: E402

_loop_user_ctx: contextvars.ContextVar = contextvars.ContextVar(
    "sf_loop_user", default=None
)


def set_loop_user(user: Optional[str]) -> None:
    _loop_user_ctx.set(user)


def loop_overrides_snapshot() -> Dict[str, Callable]:
    """__call__ 装配期取当前世代快照(运行中的对话持旧代跑完)。"""
    return dict(_STAGE_OVERRIDES)
