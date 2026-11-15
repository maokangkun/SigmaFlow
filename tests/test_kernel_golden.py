"""kernel P0 金轨与单元测试。

金轨目标(P0 验收): ToolRegistry/PromptComposer 的遗留适配器输出与
现有 conf.TOOLS / conf.CHILD_TOOLS / conf.SYSTEM / SUBAGENT_SYSTEM
逐字节一致 — 后续阶段把消费方切到注册表后, 同一对拍继续守护。
"""

import json

import pytest

from sigmaflow.kernel import (
    HookBus,
    ManifestError,
    ModHost,
    ModRegistry,
    ModStore,
    PromptComposer,
    PromptSection,
    ServiceRegistry,
    ToolRegistry,
    ToolSpec,
    parse_manifest,
    parse_patch,
    parse_profile,
    resolve_config,
)


# --------------------------------------------------------------- HookBus
class TestHookBus:
    def test_order_by_weight_then_registration(self):
        bus = HookBus()
        calls = []
        bus.subscribe("e", lambda: calls.append("c100"), weight=100)
        bus.subscribe("e", lambda: calls.append("a50"), weight=50)
        bus.subscribe("e", lambda: calls.append("b50"), weight=50)
        bus.emit("e")
        assert calls == ["a50", "b50", "c100"]

    def test_error_isolation_fail_open(self):
        bus = HookBus()
        calls = []
        errors = []
        bus.error_sink = errors.append
        bus.subscribe("e", lambda: 1 / 0, owner="bad-mod")
        bus.subscribe("e", lambda: calls.append("after"))
        bus.emit("e")
        assert calls == ["after"]  # 坏钩子不阻断后续
        assert errors and errors[0]["owner"] == "bad-mod"

    def test_fail_closed_raises(self):
        bus = HookBus()
        bus.subscribe("e", lambda: 1 / 0, fail_closed=True)
        with pytest.raises(ZeroDivisionError):
            bus.emit("e")

    def test_filter_chain(self):
        bus = HookBus()
        bus.add_filter("t", lambda v: v + 1)  # weight 100, 后执行
        bus.add_filter("t", lambda v: v * 10, weight=50)  # 先执行
        assert bus.apply("t", 1) == 11  # 1*10=10, 10+1=11

    def test_wrapper_onion_and_fallback(self):
        bus = HookBus()
        log = []

        def base(x):
            log.append("base")
            return x + 1

        def good(next_fn, x):
            log.append("good-in")
            r = next_fn(x)
            log.append("good-out")
            return r * 2

        def bad(next_fn, x):
            raise RuntimeError("boom")

        bus.add_wrapper("w", good, weight=100)
        bus.add_wrapper("w", bad, weight=50)  # 最外层, fail-open → 跳过
        assert bus.resolve("w", base)(3) == 8
        assert log == ["good-in", "base", "good-out"]

    def test_wrapper_replace_semantics(self):
        bus = HookBus()
        bus.add_wrapper("w", lambda next_fn, x: "replaced")
        assert bus.resolve("w", lambda x: x)(42) == "replaced"

    def test_unsubscribe_owner(self):
        bus = HookBus()
        bus.subscribe("e", lambda: None, owner="m1")
        bus.subscribe("e", lambda: None, owner="m1")
        bus.subscribe("e", lambda: None, owner="core")
        assert bus.unsubscribe_owner("m1") == 2
        assert len(bus.describe()) == 1

    def test_emit_async(self):
        import asyncio

        bus = HookBus()

        async def hook():
            return "ok"

        assert asyncio.run(bus.emit_async("e")) == []

        bus.subscribe("e", hook)
        assert asyncio.run(bus.emit_async("e")) == ["ok"]


# ------------------------------------------------------------- Manifest
class TestManifest:
    def test_minimal(self):
        m = parse_manifest(
            """
[mod]
id = "my-tool"
name = "My Tool"
version = "1.0.0"
"""
        )
        assert m.id == "my-tool"
        assert m.reload == "run-boundary"  # 默认
        assert m.capabilities.exec is False

    def test_full(self):
        m = parse_manifest(
            """
[mod]
id = "pathogen-env"
version = "1.4.0"
reload = "run-boundary"
replaces = ["core-loop"]
overrides-tools = ["bash"]

[api]
tools = 1
loop = 1

[capabilities]
exec = true
fs-read = ["<project>", "/tmp"]
network = ["*"]

[requires]
sigmaflow = ">=1.0"

[requires.mods]
sciverse = ">=2.0"

[contributions]
tools = ["tools/*.py"]

[config.defaults]
trial-replicas = 10
"""
        )
        assert m.capabilities.exec
        assert m.capabilities.grants("fs-read", "/tmp/x")
        assert not m.capabilities.grants("fs-write", "/tmp")
        assert m.requires_mods == {"sciverse": ">=2.0"}
        assert m.replaces == ["core-loop"]
        assert m.config_defaults == {"trial-replicas": 10}

    def test_invalid_id(self):
        with pytest.raises(ManifestError):
            parse_manifest('[mod]\nid = "Bad_Id"\nversion = "1"')

    def test_unknown_api_contract(self):
        with pytest.raises(ManifestError):
            parse_manifest('[mod]\nid = "x"\nversion = "1"\n[api]\nquantum = 1\n')

    def test_unknown_capability(self):
        with pytest.raises(ManifestError):
            parse_manifest(
                '[mod]\nid = "x"\nversion = "1"\n[capabilities]\nroot = true\n'
            )


# ----------------------------------------------------------------- Store
class TestStore:
    def test_profile_and_patch_roundtrip(self, tmp_path):
        store = ModStore(tmp_path)
        store.ensure_layout()
        store.write_profile(["a", "b"])
        assert store.read_profile() == ["a", "b"]
        store.write_patch(
            [parse_patch('[[patch]]\nmod = "a"\n[patch.config]\nx = 1\n')[0]]
        )
        entries = store.read_patch()
        assert entries[0].mod == "a"
        assert entries[0].config == {"x": 1}

    def test_config_overlay_provenance(self):
        e1 = parse_patch('[[patch]]\nmod = "m"\n[patch.config]\na = 2\n')[0]
        e2 = parse_patch('[[patch]]\nmod = "m"\n[patch.config]\na = 3\nb = 9\n')[0]
        rc = resolve_config({"a": 1}, [e1], [e2], mod_id="m")
        assert rc.value == {"a": 3, "b": 9}
        assert rc.provenance["a"] == "project-patch"
        assert rc.provenance["b"] == "project-patch"

    def test_state_audit_append(self, tmp_path):
        store = ModStore(tmp_path)
        store.audit("mod.installed", mod="x")
        store.audit("mod.enabled", mod="x")
        state = store.read_state()
        assert len(state["audit"]) == 2


# ----------------------------------------------------------- ToolRegistry
class TestToolRegistry:
    def _legacy(self):
        from sigmaflow.agent import conf, tools as agent_tools

        return conf, agent_tools

    def test_golden_legacy_adapter_byte_identical(self):
        """金轨: 注册表快照与现有 TOOLS/CHILD_TOOLS/TOOL_HANDLERS 完全一致。"""
        conf, agent_tools = self._legacy()
        reg = ToolRegistry.from_legacy(
            conf.TOOLS, conf.CHILD_TOOLS, agent_tools.TOOL_HANDLERS
        )
        snap = reg.snapshot()
        assert snap.schemas("main") == conf.TOOLS
        assert snap.schemas("subagent") == conf.CHILD_TOOLS
        for name in snap.names("main"):
            assert snap.handler(name) is agent_tools.TOOL_HANDLERS.get(name)

    def test_conf_tools_shape_contract(self):
        """现有 conf 的静态契约(TOOLS ⊇ CHILD_TOOLS, 逐项三键), 适配器的前提。"""
        conf, _ = self._legacy()
        child_names = {t["name"] for t in conf.CHILD_TOOLS}
        main_names = {t["name"] for t in conf.TOOLS}
        assert child_names <= main_names
        for t in conf.TOOLS + conf.CHILD_TOOLS:
            assert set(t.keys()) >= {"name", "description", "input_schema"}

    def test_conflict_policy(self):
        reg = ToolRegistry()
        reg.register(ToolSpec(name="t", description="d", input_schema={}, handler=None))
        with pytest.raises(Exception):
            reg.register(
                ToolSpec(name="t", description="d2", input_schema={}, handler=None)
            )
        reg.register(
            ToolSpec(name="t", description="d2", input_schema={}, handler=None),
            overrides=["t"],
        )
        snap = reg.snapshot()
        assert snap.spec("t").description == "d2"

    def test_unregister_owner_falls_back(self):
        reg = ToolRegistry()
        reg.register(
            ToolSpec(
                name="t",
                description="core",
                input_schema={},
                handler=None,
                owner="core",
            )
        )
        reg.register(
            ToolSpec(
                name="t", description="mod", input_schema={}, handler=None, owner="m1"
            ),
            overrides=["t"],
        )
        assert reg.unregister_owner("m1") == ["t"]
        assert reg.snapshot().spec("t").description == "core"


# --------------------------------------------------------- PromptComposer
class TestPromptComposer:
    def test_golden_base_sections_byte_identical(self):
        """金轨: 基底段 compose 输出与 conf 常量逐字节一致。"""
        from sigmaflow.agent import conf

        composer = PromptComposer()
        composer.add_section(
            PromptSection(
                id="core-base",
                weight=0,
                builder=lambda ctx: conf.SYSTEM,
                when=lambda ctx: ctx["kind"] == "main",
            )
        )
        composer.add_section(
            PromptSection(
                id="core-subagent-base",
                weight=0,
                builder=lambda ctx: conf.SUBAGENT_SYSTEM,
                when=lambda ctx: ctx["kind"] == "subagent",
            )
        )
        assert composer.compose("main") == conf.SYSTEM
        assert composer.compose("subagent") == conf.SUBAGENT_SYSTEM

    def test_ordering_and_condition(self):
        c = PromptComposer()
        c.add_section(PromptSection(id="a", weight=200, builder=lambda ctx: "A"))
        c.add_section(PromptSection(id="b", weight=100, builder=lambda ctx: "B"))
        c.add_section(
            PromptSection(
                id="c",
                weight=150,
                builder=lambda ctx: "C",
                when=lambda ctx: ctx.get("plan"),
            )
        )
        assert c.compose("main") == "B\n\nA"
        assert c.compose("main", {"plan": True}) == "B\n\nC\n\nA"

    def test_override_and_restore(self):
        c = PromptComposer()
        c.add_section(
            PromptSection(id="s", weight=1, builder=lambda ctx: "core", owner="core")
        )
        c.add_section(
            PromptSection(id="s", weight=1, builder=lambda ctx: "mod", owner="m1"),
            replace=True,
        )
        assert c.compose() == "mod"
        assert c.remove_owner("m1") == ["s"]
        assert c.compose() == "core"


# ---------------------------------------------------------------- ModHost
class TestModHost:
    def _make_mod(self, tmp_path, mod_id, entry_body=None):
        d = tmp_path / mod_id
        d.mkdir()
        (d / "mod.toml").write_text(
            f'[mod]\nid = "{mod_id}"\nname = "{mod_id}"\nversion = "1.0.0"\n',
            encoding="utf-8",
        )
        if entry_body:
            (d / "entry.py").write_text(entry_body, encoding="utf-8")
        return d

    def test_bootstrap_and_hooks(self, tmp_path):
        from sigmaflow.kernel import ServiceRegistry as SR

        d = self._make_mod(
            tmp_path,
            "greet",
            entry_body="""
COUNTER = {"n": 0}

def activate(ctx):
    ctx.on("test.ping", lambda: "pong", owner=ctx.mod_id)
    ctx.on_unload(lambda c: COUNTER.update(unloaded=True))
""",
        )
        store = ModStore(tmp_path / "home")
        host = ModHost(store=store)
        stats = host.bootstrap(builtin_dirs=[tmp_path])
        assert stats["loaded"] == 1
        assert host.hooks.emit("test.ping") == ["pong"]
        assert host.registry.get("greet").state == "enabled"

    def test_unload_cleans_hooks(self, tmp_path):
        d = self._make_mod(
            tmp_path,
            "hooker",
            entry_body="""
def activate(ctx):
    ctx.on("test.e", lambda: 1)
""",
        )
        store = ModStore(tmp_path / "home")
        host = ModHost(store=store)
        host.bootstrap(builtin_dirs=[tmp_path])
        assert host.hooks.emit("test.e")
        host.unload("hooker")
        assert host.hooks.emit("test.e") == []

    def test_bad_mod_isolated(self, tmp_path):
        self._make_mod(
            tmp_path,
            "good",
            entry_body="def activate(ctx):\n    ctx.on('x.y', lambda: 'ok')\n",
        )
        self._make_mod(tmp_path, "broken", entry_body="raise RuntimeError('bad mod')\n")
        host = ModHost(store=ModStore(tmp_path / "home"))
        stats = host.bootstrap(builtin_dirs=[tmp_path])
        assert stats["loaded"] == 1
        assert stats["errored"] == 1
        rec = host.registry.get("broken")
        assert rec.state == "error"
        assert "bad mod" in rec.state_reason
        assert host.hooks.emit("x.y") == ["ok"]

    def test_dependency_blocking(self, tmp_path):
        self._make_mod(
            tmp_path,
            "needy",
            entry_body="def activate(ctx):\n    pass\n",
        )
        # needy 依赖 missing-mod: 在 manifest 里补 requires
        (tmp_path / "needy" / "mod.toml").write_text(
            '[mod]\nid = "needy"\nversion = "1"\n\n[requires.mods]\nmissing-mod = ">=1"\n',
            encoding="utf-8",
        )
        host = ModHost(store=ModStore(tmp_path / "home"))
        stats = host.bootstrap(builtin_dirs=[tmp_path])
        assert stats["blocked"] == 1
        assert host.registry.get("needy").state == "blocked"

    def test_epoch_bumps(self, tmp_path):
        host = ModHost(store=ModStore(tmp_path / "home"))
        e1 = host.registry.epoch
        host.registry.bump_epoch()
        assert host.registry.epoch > e1


# ----------------------------------------------------------- ServiceRegistry
class TestServiceRegistry:
    def test_provide_get_remove(self):
        reg = ServiceRegistry()
        reg.provide("models", {"x": 1})
        assert reg.get("models") == {"x": 1}
        reg.remove("models", owner="core")
        with pytest.raises(KeyError):
            reg.get("models")

    def test_override_needs_flag(self):
        reg = ServiceRegistry()
        reg.provide("models", object(), owner="core")
        with pytest.raises(Exception):
            reg.provide("models", object(), owner="m1")
        reg.provide("models", object(), owner="m1", replace=True)
        assert reg.names()["models"] == "m1"
