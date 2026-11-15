"""P3 补全: mod 变更广播(事件环 + broadcaster 通道)。"""

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
        sub.set_broadcaster(None)
        for mod_id in list(sub.host.contexts):
            sub.host.unload(mod_id)
    _SUBSYSTEMS.clear()


def _subsystem(tmp_path):
    sub = ModSubsystem.__new__(ModSubsystem)
    ModSubsystem.__init__(sub)
    _SUBSYSTEMS.append(sub)
    sub.bootstrap(home=tmp_path / "home", builtin_dirs=[BUILTIN])
    return sub


def test_broadcaster_receives_enable_disable(tmp_path):
    sub = _subsystem(tmp_path)
    received = []
    sub.set_broadcaster(lambda ev: received.append(ev))
    sub.set_enabled("example-tools", False)
    sub.set_enabled("example-tools", True)
    kinds = [(e["kind"], e["mod"]) for e in received]
    assert kinds == [
        ("mod.disabled", "example-tools"),
        ("mod.enabled", "example-tools"),
    ]
    assert all(isinstance(e["epoch"], int) for e in received)


def test_broadcaster_receives_reload(tmp_path):
    sub = _subsystem(tmp_path)
    received = []
    sub.set_broadcaster(lambda ev: received.append(ev))
    sub.reload_mod("example-tools")
    assert received[-1]["kind"] == "mod.reloaded"
    assert received[-1]["mod"] == "example-tools"


def test_broadcast_without_broadcaster_is_safe(tmp_path):
    sub = _subsystem(tmp_path)
    sub.set_broadcaster(None)
    sub.reload_mod("example-tools")  # 不应抛异常
    assert any(e.get("kind") == "mod.reloaded" for e in sub.events())


def test_broken_broadcaster_does_not_break_mutation(tmp_path):
    sub = _subsystem(tmp_path)
    sub.set_broadcaster(lambda ev: 1 / 0)
    rec = sub.set_enabled("example-tools", False)  # 广播抛错不影响主流程
    assert rec["state"] == "disabled"


def test_ws_end_to_end_broadcast(tmp_path, monkeypatch):
    """REST 触发启停 → 在线 WS 客户端收到 mods.changed(真实管道)。"""

    monkeypatch.setenv("SIGMAFLOW_HOME", str(tmp_path / "home"))
    from fastapi.testclient import TestClient
    from sigmaflow.cmd import build_server
    from sigmaflow.server import science as sci
    from sigmaflow.server.mods import MODS

    app = build_server(None)
    MODS.set_broadcaster(sci._mods_ws_broadcast)
    try:
        with TestClient(app) as client:
            with client.websocket_connect("/api/ws") as ws:
                ws.send_json({"action": "ping"})
                assert ws.receive_json()["event"] == "pong"
                r = client.post("/api/mods/example-tools/disable")
                assert r.status_code == 200
                got = None
                for _ in range(5):
                    msg = ws.receive_json()
                    if msg.get("event") == "mods.changed":
                        got = msg["data"]
                        break
                assert got and got["kind"] == "mod.disabled"
                assert got["mod"] == "example-tools"
                client.post("/api/mods/example-tools/enable")
    finally:
        # 全局单例彻底重建: 卸载已加载 mod 并清空服务注册表(防跨文件污染)
        ModSubsystem.reset_singleton()
