"""P2 Step B: loop 扩展面(钩子/阶段覆盖/驱动替换)测试。

金轨(test_agent_loop_golden)证明无订阅时零行为差; 本文件证明各扩展点
确实生效且相互隔离。
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))
from agent_replay import run_replay  # noqa: E402

from sigmaflow.agent.loop import (  # noqa: E402
    LOOP_END,
    LOOP_NEXT_TURN,
    LoopService,
    loop_hooks,
    loop_overrides_snapshot,
)


@pytest.fixture(autouse=True)
def _clean_loop_state():
    yield
    # 全量复位(含匿名注册): loop 扩展面是进程级状态, 泄漏会污染其他测试
    import sigmaflow.agent.loop as loop_mod

    loop_mod._STAGE_OVERRIDES.clear()
    loop_mod._LOOP_DRIVER = None
    loop_mod._LOOP_DRIVER_OWNER = None
    for owner in ("test", "__anonymous__"):
        loop_hooks().unsubscribe_owner(owner)


def _basic_script():
    return [
        {
            "tool_calls": [
                {"id": "t1", "name": "bash", "input": {"command": "echo hook-test"}}
            ],
            "stop_reason": "tool_use",
            "usage": {"input": 10, "output": 5},
        },
        {
            "text": "done",
            "stop_reason": "end_turn",
            "usage": {"input": 20, "output": 5},
        },
    ]


class TestToolExecWrapper:
    def test_wrapper_observes_and_preserves_result(self, tmp_path, monkeypatch):
        seen = []

        def audit(next_fn, *, func=None, inp=None):
            seen.append((func, inp))
            return next_fn()

        loop_hooks().add_wrapper("agent.tool.exec", audit, owner="test")
        result = run_replay(tmp_path, _basic_script(), monkeypatch)
        assert seen == [("bash", {"command": "echo hook-test"})]
        # 行为不变: 工具结果照常进入 transcript
        assert result["used_tools"][0][0] == "bash"
        assert "hook-test" in result["used_tools"][0][2]

    def test_wrapper_can_rewrite_result(self, tmp_path, monkeypatch):
        def rewrite(next_fn, **kw):
            next_fn()
            return "intercepted"

        loop_hooks().add_wrapper("agent.tool.exec", rewrite, owner="test")
        result = run_replay(tmp_path, _basic_script(), monkeypatch)
        assert result["used_tools"][0][2] == "intercepted"

    def test_broken_wrapper_fails_open(self, tmp_path, monkeypatch):
        def boom(next_fn, **kw):
            raise RuntimeError("bad wrapper")

        loop_hooks().add_wrapper("agent.tool.exec", boom, owner="test")
        result = run_replay(tmp_path, _basic_script(), monkeypatch)
        # fail-open: 跳过坏包裹器, 真实调用照常执行
        assert "hook-test" in result["used_tools"][0][2]


class TestTurnEvents:
    def test_turn_begin_emitted_per_turn(self, tmp_path, monkeypatch):
        counter = []
        loop_hooks().subscribe(
            "agent.turn.begin", lambda lc: counter.append(1), owner="test"
        )
        run_replay(tmp_path, _basic_script(), monkeypatch)
        assert len(counter) == 2  # 两个模型轮次

    def test_loop_end_emitted(self, tmp_path, monkeypatch):
        hits = []
        loop_hooks().subscribe(
            "agent.loop.end", lambda lc: hits.append(lc.cur_turn), owner="test"
        )
        run_replay(tmp_path, _basic_script(), monkeypatch)
        # 第二轮终文直接 LOOP_END 退出: cur_turn 停在 1(推进发生在 turn_end)
        assert hits == [1]


class TestStageOverride:
    def test_turn_begin_override_ends_loop_immediately(self, tmp_path, monkeypatch):
        svc = LoopService()
        svc.override_stage("turn_begin", lambda agent, lc: LOOP_END)
        try:
            result = run_replay(tmp_path, _basic_script(), monkeypatch)
            # 未发生任何模型调用: 脚本未被消耗
            assert len(result["llm_calls"]) == 0
            # info["messages"] 的组装语义(原行为): system + messages[1:]
            roles = [m["role"] for m in result["transcript"]]
            assert roles == ["system"]
        finally:
            svc.dispose_owner("__anonymous__")

    def test_snapshot_semantics_new_calls_see_override(self, tmp_path, monkeypatch):
        svc = LoopService()
        svc.override_stage("settle", lambda agent, lc: LOOP_NEXT_TURN)
        try:
            assert "_stage_settle" in loop_overrides_snapshot()
        finally:
            svc.dispose_owner("__anonymous__")
        assert "_stage_settle" not in loop_overrides_snapshot()


class TestDriverReplacement:
    def test_replace_driver(self, tmp_path, monkeypatch):
        svc = LoopService()
        svc.replace_driver(lambda agent, lc: {"custom": True, "turns": lc.cur_turn})
        try:
            from sigmaflow.agent.agent import Agent

            monkeypatch.setattr(
                sys.modules["sigmaflow.agent.agent"], "TRANSCRIPT_DIR", tmp_path / "t"
            )
            agent = Agent(
                method="anthropic",
                model="m",
                base_url="http://127.0.0.1:9",
                api_key="k",
                max_model_len=8000,
                support_tool=True,
                retry=1,
            )
            info = agent([{"role": "user", "content": "hi"}], is_print=False)
            assert info == {"custom": True, "turns": 0}
        finally:
            svc.dispose_owner("test")

    def test_dispose_restores_core_driver(self):
        svc = LoopService()
        svc.replace_driver(lambda agent, lc: None)
        assert svc._owned_driver  # 匿名哨兵也追踪
        svc.dispose_owner("__anonymous__")
        from sigmaflow.agent import loop as loop_mod

        assert loop_mod._LOOP_DRIVER is None


class TestExampleLoopMod:
    def test_builtin_mod_registers_hooks(self, tmp_path):
        import sigmaflow
        from sigmaflow.kernel import ModHost, ModStore, ServiceRegistry
        from sigmaflow.agent.loop import LoopService

        services = ServiceRegistry()
        loop = LoopService()
        services.provide("loop", loop, owner="core")
        host = ModHost(
            services=services,
            hooks=loop.hooks,
            store=ModStore(tmp_path / "home"),
        )
        stats = host.bootstrap(
            builtin_dirs=[Path(sigmaflow.__file__).parent / "mods"],
            target="server",
        )
        rec = host.registry.get("example-loop-hooks")
        assert rec is not None and rec.state == "enabled"
        assert any(h["event"] == "agent.tool.exec" for h in loop.hooks.describe())
        host.unload("example-loop-hooks")
        assert not any(h["event"] == "agent.tool.exec" for h in loop.hooks.describe())
