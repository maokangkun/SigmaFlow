"""P1 mod 子系统测试: 内置 env mod 注册、启停持久化、示例工具桥。

不触碰全局 MODS 单例(服务进程语义), 用独立 ModHost/ModStore 实例对拍。
"""

from pathlib import Path

import sigmaflow
from sigmaflow.kernel import HookBus, ModHost, ModStore, ServiceRegistry
from sigmaflow.server.mods import EnvRegistry, LegacyToolBridge, ModSubsystem


BUILTIN = Path(sigmaflow.__file__).parent / "mods"


def _fresh_host(tmp_path, services=None):
    services = services or ServiceRegistry()
    if services.try_get("tools") is None:
        services.provide("tools", LegacyToolBridge())
    host = ModHost(
        services=services,
        hooks=HookBus(),
        store=ModStore(tmp_path / "home"),
    )
    return host, services


class TestBuiltinEnvMods:
    def test_bootstrap_registers_both_envs(self, tmp_path):
        envs = EnvRegistry()
        services = ServiceRegistry()
        services.provide("envs", envs)
        host = ModHost(
            services=services, hooks=HookBus(), store=ModStore(tmp_path / "home")
        )
        stats = host.bootstrap(builtin_dirs=[BUILTIN], target="server")
        prefixes = {s.prefix for s in envs.all()}
        assert "patenv" in prefixes
        assert "pathenv" in prefixes
        pat = envs.get("patenv")
        assert pat.project_id == "pr-patient-env"
        assert pat.project_tags == ["虚拟患者", "病例挑战"]
        pth = envs.get("pathenv")
        assert pth.groups and set(pth.groups) >= {"molecular", "host"}

    def test_example_tools_loaded_and_gates_tool_surface(self, tmp_path):
        host, _ = _fresh_host(tmp_path)
        host.bootstrap(builtin_dirs=[BUILTIN], target="server")
        rec = host.registry.get("example-tools")
        assert rec is not None and rec.state == "enabled"
        # 工具桥写入遗留结构: Agent 无需任何改动即可看到 current_time
        from sigmaflow.agent import conf as agent_conf
        from sigmaflow.agent import tools as agent_tools

        names = {t["name"] for t in agent_conf.TOOLS}
        assert "current_time" in names
        assert callable(agent_tools.TOOL_HANDLERS["current_time"])
        # 清理: 不污染同进程后续测试
        host.unload("example-tools")
        names_after = {t["name"] for t in agent_conf.TOOLS}
        assert "current_time" not in names_after
        assert "current_time" not in agent_tools.TOOL_HANDLERS

    def test_unload_removes_env_registration(self, tmp_path):
        envs = EnvRegistry()
        services = ServiceRegistry()
        services.provide("envs", envs)
        host = ModHost(
            services=services, hooks=HookBus(), store=ModStore(tmp_path / "home")
        )
        host.bootstrap(builtin_dirs=[BUILTIN], target="server")
        assert envs.get("pathenv") is not None
        host.unload("pathogen-env")
        assert envs.get("pathenv") is None
        assert envs.get("patenv") is not None  # 兄弟 mod 不受影响


class TestSubsystemControls:
    def _subsystem(self, tmp_path):
        sub = ModSubsystem.__new__(ModSubsystem)  # 不动单例
        ModSubsystem.__init__(sub)
        sub.bootstrap(home=tmp_path / "home", builtin_dirs=[BUILTIN])
        return sub

    def test_disable_writes_patch_and_unloads(self, tmp_path):
        sub = self._subsystem(tmp_path)
        assert "example-tools" in sub.host.contexts
        rec = sub.set_enabled("example-tools", False)
        assert rec["state"] == "disabled"
        assert "example-tools" not in sub.host.contexts
        entries = sub.host.store.read_patch()
        assert any(e.mod == "example-tools" and e.enabled is False for e in entries)

    def test_reenable_reloads(self, tmp_path):
        sub = self._subsystem(tmp_path)
        sub.set_enabled("example-tools", False)
        rec = sub.set_enabled("example-tools", True)
        assert rec["state"] == "enabled"
        assert "example-tools" in sub.host.contexts

    def test_config_overlay_and_update(self, tmp_path):
        sub = self._subsystem(tmp_path)
        view = sub.config_view("example-tools")
        assert view["config"].get("extra-timezones") == []
        sub.update_config("example-tools", {"extra-timezones": ["Asia/Tokyo"]})
        view = sub.config_view("example-tools")
        assert view["config"]["extra-timezones"] == ["Asia/Tokyo"]
        assert view["provenance"]["extra-timezones"] == "user-patch"

    def test_describe_includes_all_builtin(self, tmp_path):
        sub = self._subsystem(tmp_path)
        d = sub.describe()
        ids = {m["id"] for m in d["mods"]}
        assert ids >= {"patient-env", "pathogen-env", "example-tools"}
        assert d["epoch"] >= 1


class TestLegacyToolBridge:
    def test_register_and_unregister(self):
        bridge = LegacyToolBridge()
        from sigmaflow.agent import conf as agent_conf
        from sigmaflow.agent import tools as agent_tools

        def handler(**kw):
            return "hi"

        bridge.register(
            name="_bridge_test_tool",
            description="test",
            input_schema={"type": "object", "properties": {}},
            handler=handler,
            owner="test-mod",
        )
        try:
            assert any(t["name"] == "_bridge_test_tool" for t in agent_conf.TOOLS)
            assert agent_tools.TOOL_HANDLERS["_bridge_test_tool"] is handler
        finally:
            bridge.unregister_owner("test-mod")
        assert not any(t["name"] == "_bridge_test_tool" for t in agent_conf.TOOLS)
        assert "_bridge_test_tool" not in agent_tools.TOOL_HANDLERS

    def test_duplicate_rejected(self):
        bridge = LegacyToolBridge()
        import pytest

        with pytest.raises(ValueError):
            bridge.register(
                name="bash",  # 已存在的核心工具
                description="dup",
                input_schema={},
                handler=lambda **kw: "",
                owner="evil-mod",
            )
