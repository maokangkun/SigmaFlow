"""present 工具路径黑名单策略: 项目内/项目外(/tmp 等)放行, 系统敏感目录拒绝。

同时覆盖 /fs/file 的绝对路径取件(present 卡片预览的数据通道): 同一黑名单。
"""

import pytest
from fastapi import HTTPException

from sigmaflow.agent import tools
from sigmaflow.server import science_fs
from sigmaflow.utils import is_protected_path


@pytest.fixture
def workdir(tmp_path, monkeypatch):
    proj = tmp_path / "proj"
    proj.mkdir()
    monkeypatch.setattr(tools, "WORKDIR", proj)
    return proj


def _present(path, monkeypatch=None):
    """收集 _notify 事件的便捷调用: 返回 (工具返回文本, 事件或 None)。"""
    box = {}
    out = tools.run_present(path, _notify=lambda ev: box.update(ev))
    return out, (box or None)


def test_relative_project_file_allowed(tmp_path, workdir):
    f = workdir / "report.md"
    f.write_text("# hi")
    out, ev = _present("report.md")
    assert out.startswith("Presented")
    assert ev["path"] == "report.md"


def test_absolute_inside_workdir_projected_to_relative(tmp_path, workdir):
    f = workdir / "sub" / "plot.png"
    f.parent.mkdir()
    f.write_bytes(b"png")
    out, ev = _present(str(f))
    assert out.startswith("Presented")
    assert ev["path"] == "sub/plot.png"


def test_tmp_file_allowed_with_absolute_path(tmp_path, workdir):
    f = tmp_path / "outside.txt"  # tmp_path 根不在项目目录内 → 项目外路径
    f.write_text("data")
    out, ev = _present(str(f))
    assert out.startswith("Presented")
    assert ev["path"] == str(f)  # 项目外保留绝对路径


def test_etc_blocked(workdir):
    out, ev = _present("/etc/passwd")
    assert out.startswith("Error: path is in a protected system location")
    assert ev is None


def test_home_ssh_blocked(workdir):
    out, _ = _present("~/.ssh/id_rsa")
    assert out.startswith("Error: path is in a protected system location")


def test_relative_escape_to_etc_blocked(tmp_path, workdir):
    # expanduser + realpath 链: ~/../../etc/passwd 解析回 /etc/passwd, 黑名单拦截
    out, _ = _present("~/../../etc/passwd")
    assert out.startswith("Error: path is in a protected system location")


def test_missing_file_reports_not_found(tmp_path, workdir):
    out, _ = _present(tmp_path / "nope.txt")
    assert out.startswith("Error: file not found")


def test_is_protected_path_prefix_semantics():
    assert is_protected_path("/etc")
    assert is_protected_path("/etc/hosts")
    assert not is_protected_path("/etcetera/x")  # 前缀必须按目录边界匹配
    assert not is_protected_path("/tmp/a.png")


# ---- /fs/file 绝对路径取件(前端 present 卡片预览的数据通道) ----


def test_fs_file_payload_absolute_outside_project(tmp_path):
    f = tmp_path / "out.md"
    f.write_text("# outside")
    payload = science_fs._fs_file_payload({}, str(f))
    assert payload["content"] == "# outside"


def test_fs_file_payload_absolute_protected(tmp_path):
    with pytest.raises(HTTPException) as ei:
        science_fs._fs_file_payload({}, "/etc/hosts")
    assert ei.value.status_code == 403


def test_fs_file_payload_relative_still_confined(tmp_path):
    proj = tmp_path / "proj"
    proj.mkdir()
    (proj / "a.md").write_text("x")
    payload = science_fs._fs_file_payload({"dir": str(proj)}, "a.md")
    assert payload["content"] == "x"
    with pytest.raises(HTTPException) as ei:
        science_fs._fs_file_payload({"dir": str(proj)}, "../../etc/hosts")
    assert ei.value.status_code == 403
