"""P3: UI mod 服务端装配测试(注册表端点判据/静态伺服判据/能力门控)。"""

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


def _bootstrapped(tmp_path):
    sub = ModSubsystem.__new__(ModSubsystem)
    ModSubsystem.__init__(sub)
    _SUBSYSTEMS.append(sub)
    sub.bootstrap(home=tmp_path / "home", builtin_dirs=[BUILTIN])
    return sub


class TestUiRegistry:
    def test_example_ui_enlisted_with_epoch(self, tmp_path):
        sub = _bootstrapped(tmp_path)
        mods = [m for m in sub.host.registry.all() if m.mod_id == "example-ui"]
        assert mods and mods[0].state == "enabled"
        # 判据复刻端点逻辑
        rec = mods[0]
        assert (rec.path / "ui" / "entry.js").is_file()
        assert rec.manifest.capabilities.ui

    def test_non_ui_mods_excluded(self, tmp_path):
        sub = _bootstrapped(tmp_path)
        patient = sub.host.registry.get("patient-env")
        assert not (patient.path / "ui" / "entry.js").exists()

    def test_disabled_ui_mod_would_drop_out(self, tmp_path):
        sub = _bootstrapped(tmp_path)
        sub.set_enabled("example-ui", False)
        rec = sub.host.registry.get("example-ui")
        assert rec.state == "disabled"  # 端点只出 enabled

    def test_route_mounted_in_app(self, tmp_path):
        import os

        os.environ["SIGMAFLOW_HOME"] = str(tmp_path / "home2")
        try:
            from sigmaflow.cmd import build_server

            app = build_server(None)
            paths = {getattr(r, "path", "") for r in app.routes}
            assert "/science/m/{mod_id}/{file_path:path}" in paths
            assert "/api/mods/ui/registry" in paths
        finally:
            os.environ.pop("SIGMAFLOW_HOME", None)
