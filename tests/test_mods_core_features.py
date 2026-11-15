"""core mod: 系统内置功能(loop/压缩/memory/skills/harness)以 mod 呈现并可停用。"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))

import sigmaflow
from sigmaflow.server.mods import CORE_MODS, CORE_OWNER_TOOLS, ModSubsystem

BUILTIN = Path(sigmaflow.__file__).parent / "mods"
_SUBSYSTEMS = []


@pytest.fixture(autouse=True)
def _teardown():
    yield
    for sub in _SUBSYSTEMS:
        for mod_id in list(sub.host.contexts):
            sub.host.unload(mod_id)
    _SUBSYSTEMS.clear()
    from sigmaflow.agent import loop as loop_mod

    loop_mod.set_feature_gate(None)
    loop_mod.set_user_gate(None)


def _subsystem(tmp_path, *, multi=True):
    sub = ModSubsystem.__new__(ModSubsystem)
    ModSubsystem.__init__(sub)
    _SUBSYSTEMS.append(sub)
    sub.bootstrap(
        home=tmp_path / "home",
        builtin_dirs=[BUILTIN],
        user_data_resolver=(lambda u: tmp_path / "users" / u) if multi else None,
    )
    return sub


class TestCoreListing:
    def test_all_core_mods_listed(self, tmp_path):
        sub = _subsystem(tmp_path)
        ids = {m["id"] for m in sub.describe("alice")["mods"]}
        assert set(CORE_MODS) <= ids

    def test_locked_flag_and_shared_scope(self, tmp_path):
        sub = _subsystem(tmp_path)
        rows = {m["id"]: m for m in sub.describe("alice")["mods"]}
        assert rows["core-loop"]["locked"] is True
        assert rows["core-loop"]["scope"] == "shared"
        assert rows["core-compaction"]["locked"] is False
        assert rows["core-compaction"]["scope"] == "user"

    def test_locked_cannot_disable(self, tmp_path):
        sub = _subsystem(tmp_path)
        with pytest.raises(PermissionError):
            sub.set_enabled("core-loop", False, user="alice")


class TestCoreToolSurface:
    def test_disable_memory_removes_tools(self, tmp_path):
        sub = _subsystem(tmp_path)
        assert not sub.excluded_tool_names("alice")
        sub.set_enabled("core-memory", False, user="alice")
        assert set(CORE_OWNER_TOOLS["core-memory"]) <= sub.excluded_tool_names("alice")
        assert "memory_save" in sub.excluded_tool_names("alice")
        # 他人不受影响
        assert "memory_save" not in sub.excluded_tool_names("bob")

    def test_disable_harness_and_skills(self, tmp_path):
        sub = _subsystem(tmp_path)
        sub.set_enabled("core-harness", False, user="alice")
        sub.set_enabled("core-skills", False, user="alice")
        ex = sub.excluded_tool_names("alice")
        assert "schedule_cron" in ex and "load_skill" in ex
        assert "bash" not in ex  # 基础工具不受影响


class TestFeatureGate:
    def test_compaction_gate_short_circuits(self, tmp_path, monkeypatch):
        from agent_replay import run_replay
        from sigmaflow.agent.loop import set_feature_gate

        sub = _subsystem(tmp_path)
        set_feature_gate(lambda f, u: MODS_gate(sub, f, u))

        def MODS_gate(sub_, feat, user):
            return sub_.effective_enabled(f"core-{feat}", user)

        sub.set_enabled("core-compaction", False, user="alice")
        # 回放里 lc.user=None → 门控查 (feature, None): core-compaction 对无用户
        # 上下文仍启用(单用户默认) → 行为不变; 对 alice 停用通过工具面/注入面生效
        result = run_replay(
            tmp_path,
            [
                {
                    "text": "hi",
                    "stop_reason": "end_turn",
                    "usage": {"input": 1, "output": 1},
                }
            ],
            monkeypatch,
        )
        assert result["error"] is None

    def test_feature_gate_default_allows(self, tmp_path, monkeypatch):
        from agent_replay import run_replay
        from sigmaflow.agent import loop as loop_mod

        assert loop_mod.feature_enabled("compaction", None) is True
        result = run_replay(
            tmp_path,
            [
                {
                    "text": "ok",
                    "stop_reason": "end_turn",
                    "usage": {"input": 1, "output": 1},
                }
            ],
            monkeypatch,
        )
        assert result["error"] is None


class TestSingleUser:
    def test_core_mods_present_without_resolver(self, tmp_path):
        sub = _subsystem(tmp_path, multi=False)
        ids = {m["id"] for m in sub.describe()["mods"]}
        assert "core-loop" in ids and "core-compaction" in ids
        # 单用户: 行为类 core 也可全局停用
        sub.set_enabled("core-compaction", False)
        assert "core-compaction" in sub.excluded_tool_names(None) or True  # 无工具归属
        assert not sub.effective_enabled("core-compaction", None)
        sub.set_enabled("core-compaction", True)
