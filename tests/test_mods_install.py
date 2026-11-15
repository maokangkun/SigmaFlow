"""P5: mod 安装/卸载闭环(本地目录)。

注意: 工具桥写进程级遗留结构(conf.TOOLS/TOOL_HANDLERS), 装/卸断言必须
在同一个子系统的同一个测试内完成, 避免跨测试遗留污染。
"""

from pathlib import Path

import pytest

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


def _subsystem(tmp_path):
    sub = ModSubsystem.__new__(ModSubsystem)
    ModSubsystem.__init__(sub)
    _SUBSYSTEMS.append(sub)
    sub.bootstrap(home=tmp_path / "home", builtin_dirs=[BUILTIN])
    return sub


def _make_source(tmp_path):
    src = tmp_path / "src" / "hello-tool"
    src.mkdir(parents=True)
    (src / "mod.toml").write_text(
        '[mod]\nid = "hello-tool"\nname = "Hello"\nversion = "0.1.0"\n',
        encoding="utf-8",
    )
    (src / "entry.py").write_text(
        "def activate(ctx):\n"
        "    ctx.services.tools.register(\n"
        "        name='hello_world', description='say hello',\n"
        "        input_schema={'type': 'object', 'properties': {}},\n"
        "        handler=lambda **kw: 'hello from mod', owner=ctx.mod_id,\n"
        "    )\n",
        encoding="utf-8",
    )
    return src


def test_install_uninstall_roundtrip(tmp_path):
    from sigmaflow.agent import conf as agent_conf, tools as agent_tools

    sub = _subsystem(tmp_path)
    src = _make_source(tmp_path)
    rec = sub.install(str(src))
    assert rec["loaded"] is True
    assert any(t["name"] == "hello_world" for t in agent_conf.TOOLS)
    assert agent_tools.TOOL_HANDLERS["hello_world"]() == "hello from mod"
    assert (sub.host.store.mods_dir / "hello-tool" / "mod.toml").is_file()

    out = sub.uninstall("hello-tool")
    assert out["uninstalled"] is True
    assert not any(t["name"] == "hello_world" for t in agent_conf.TOOLS)
    assert "hello_world" not in agent_tools.TOOL_HANDLERS
    assert sub.host.registry.get("hello-tool") is None
    assert not (sub.host.store.mods_dir / "hello-tool").exists()


def test_builtin_uninstall_refused(tmp_path):
    sub = _subsystem(tmp_path)
    with pytest.raises(PermissionError):
        sub.uninstall("example-tools")


def test_install_missing_manifest(tmp_path):
    sub = _subsystem(tmp_path)
    with pytest.raises(FileNotFoundError):
        sub.install(str(tmp_path))
