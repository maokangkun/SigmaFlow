"""mod 用户隔离: 每用户独立启停/配置/自装, 共享 mod 全局一致。"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))

import sigmaflow
from sigmaflow.server.mods import ModSubsystem

BUILTIN = Path(sigmaflow.__file__).parent / "mods"
_SUBSYSTEMS = []


@pytest.fixture(autouse=True)
def _teardown_subsystems():
    yield
    for sub in _SUBSYSTEMS:
        for mod_id in list(sub.host.contexts):
            sub.host.unload(mod_id)
    _SUBSYSTEMS.clear()
    from sigmaflow.agent import loop as loop_mod

    loop_mod._STAGE_OVERRIDES.clear()
    loop_mod._LOOP_DRIVER = None


def _subsystem(tmp_path, *, multi_user=True):
    sub = ModSubsystem.__new__(ModSubsystem)
    ModSubsystem.__init__(sub)
    _SUBSYSTEMS.append(sub)
    resolver = (lambda u: tmp_path / "users" / u) if multi_user else None
    sub.bootstrap(
        home=tmp_path / "home", builtin_dirs=[BUILTIN], user_data_resolver=resolver
    )
    return sub


def _make_source(tmp_path, name, tool="hello"):
    d = tmp_path / "src" / name
    d.mkdir(parents=True)
    (d / "mod.toml").write_text(
        f'[mod]\nid = "{name}"\nname = "{name}"\nversion = "0.1"\n',
        encoding="utf-8",
    )
    (d / "entry.py").write_text(
        "def activate(ctx):\n"
        f"    ctx.services.tools.register(name='{tool}', description='t',\n"
        "        input_schema={'type':'object','properties':{}},\n"
        "        handler=lambda **kw: 'ok', owner=ctx.mod_id)\n",
        encoding="utf-8",
    )
    return d


class TestPerUserEnable:
    def test_alice_disable_bob_unaffected(self, tmp_path):
        sub = _subsystem(tmp_path)
        assert sub.effective_enabled("example-tools", "alice")
        sub.set_enabled("example-tools", False, user="alice")
        assert not sub.effective_enabled("example-tools", "alice")
        assert sub.effective_enabled("example-tools", "bob")  # 他人不受影响
        # 描述视角: 各自的 effectiveState
        d_a = sub.describe("alice")
        row_a = next(m for m in d_a["mods"] if m["id"] == "example-tools")
        assert row_a["effectiveState"] == "disabled"
        d_b = sub.describe("bob")
        row_b = next(m for m in d_b["mods"] if m["id"] == "example-tools")
        assert row_b["effectiveState"] == "enabled"

    def test_shared_mod_toggle_is_global(self, tmp_path):
        sub = _subsystem(tmp_path)
        assert sub.scope_of("pathogen-env") == "shared"
        # 共享 mod 的启停走全局(对所有人一致)
        sub.set_enabled("pathogen-env", False, user="alice")
        assert not sub.effective_enabled("pathogen-env", "alice")
        assert not sub.effective_enabled("pathogen-env", "bob")
        sub.set_enabled("pathogen-env", True, user="alice")

    def test_tool_surface_per_user(self, tmp_path):
        from sigmaflow.agent import conf as agent_conf

        sub = _subsystem(tmp_path)
        assert "current_time" in sub.owner_visible_tools("alice")
        sub.set_enabled("example-tools", False, user="alice")
        assert sub.excluded_tool_names("alice") == {"current_time"}
        assert sub.excluded_tool_names("bob") == set()
        assert agent_conf.TOOLS  # 全局注册表不动, 过滤发生在会话装配


class TestPerUserInstall:
    def test_user_install_visible_only_to_owner(self, tmp_path):
        from sigmaflow.agent import conf as agent_conf

        sub = _subsystem(tmp_path)
        src = _make_source(tmp_path, "alice-tool", tool="alice_hello")
        rec = sub.install(str(src), user="alice")
        assert rec["loaded"] is True
        # alice: 可见且生效; bob: 不可见不可用
        assert sub.effective_enabled("alice-tool", "alice")
        assert not sub.effective_enabled("alice-tool", "bob")
        d_bob = sub.describe("bob")
        assert not any(m["id"] == "alice-tool" for m in d_bob["mods"])
        assert "alice_hello" in sub.excluded_tool_names("bob")
        assert "alice_hello" not in sub.excluded_tool_names("alice")
        # 卸载仅属主
        out = sub.uninstall("alice-tool", user="alice")
        assert out["uninstalled"]
        assert not any(t["name"] == "alice_hello" for t in agent_conf.TOOLS)

    def test_user_mod_dir_scanned_on_refresh(self, tmp_path):
        sub = _subsystem(tmp_path)
        src = _make_source(tmp_path, "bob-tool", tool="bob_hello")
        sub.install(str(src), user="bob")
        # 模拟重启后: 新子系统 + refresh 扫描用户目录
        sub2 = ModSubsystem.__new__(ModSubsystem)
        ModSubsystem.__init__(sub2)
        _SUBSYSTEMS.append(sub2)
        sub2.bootstrap(
            home=tmp_path / "home",
            builtin_dirs=[BUILTIN],
            user_data_resolver=(lambda u: tmp_path / "users" / u),
        )
        sub2.refresh_user_mods("bob")
        assert sub2.effective_enabled("bob-tool", "bob")
        assert not sub2.effective_enabled("bob-tool", "alice")


class TestPerUserConfig:
    def test_config_overlay_per_user(self, tmp_path):
        sub = _subsystem(tmp_path)
        sub.update_config(
            "example-tools", {"extra-timezones": ["Asia/Tokyo"]}, user="alice"
        )
        va = sub.config_view("example-tools", user="alice")
        vb = sub.config_view("example-tools", user="bob")
        assert va["config"]["extra-timezones"] == ["Asia/Tokyo"]
        assert va["provenance"]["extra-timezones"] == "user"
        assert vb["config"]["extra-timezones"] == []  # bob 仍是默认


class TestLoopGate:
    def test_hook_gate_by_user(self, tmp_path, monkeypatch):
        from sigmaflow.agent.loop import set_user_gate

        sub = _subsystem(tmp_path)
        set_user_gate(lambda owner, user: sub.effective_enabled(owner, user))
        try:
            from agent_replay import run_replay

            seen = []
            from sigmaflow.agent.loop import loop_hooks

            # 用共享总线直挂一个带属主的钩子(模拟 mod 注册)
            loop_hooks().subscribe(
                "agent.turn.begin",
                lambda lc: seen.append(getattr(lc, "user", None) or "anon"),
                owner="example-tools",
            )
            # alice 停用 example-tools → 该钩子对 alice 静默, 对 bob 生效
            sub.set_enabled("example-tools", False, user="alice")

            class _U:
                pass

            result = run_replay(
                tmp_path,
                [
                    {
                        "text": "hi",
                        "stop_reason": "end_turn",
                        "usage": {"input": 1, "output": 1},
                    },
                ],
                monkeypatch,
            )
            assert result["error"] is None
            # 无用户上下文(单用户默认)时: 恢复启用的 alice 视角下钩子放行
            sub.set_enabled("example-tools", True, user="alice")
            result2 = run_replay(
                tmp_path,
                [
                    {
                        "text": "hi",
                        "stop_reason": "end_turn",
                        "usage": {"input": 1, "output": 1},
                    },
                ],
                monkeypatch,
            )
            assert result2["error"] is None
        finally:
            set_user_gate(None)
            from sigmaflow.agent.loop import loop_hooks as _lh

            _lh().unsubscribe_owner("example-tools")


class TestSingleUserCompat:
    def test_no_resolver_keeps_global_behavior(self, tmp_path):
        sub = _subsystem(tmp_path, multi_user=False)
        d = (
            sub.describe()
        )  # 单用户: 普通 mod 无作用域标注; core 记录恒带(core 语义与用户层无关)
        assert all("scope" not in m for m in d["mods"] if m.get("origin") != "core")
        core_rows = [m for m in d["mods"] if m.get("origin") == "core"]
        assert core_rows and all("locked" in m and "scope" in m for m in core_rows)
        sub.set_enabled("example-tools", False)  # 全局启停(历史行为)
        assert not sub.effective_enabled("example-tools", None)
        sub.set_enabled("example-tools", True)
