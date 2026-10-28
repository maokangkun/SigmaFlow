"""有状态工具的会话隔离: task/job/inbox 三件套按 scope 分片互不可见"""

import sys
import time

sys.path.insert(0, "src")

from sigmaflow.agent import tools  # noqa: E402


def _fresh(scope):
    tools._SCOPE_INSTANCES.clear()
    tools.set_session_scope(scope)


def test_task_scope_isolation_and_per_scope_ids(monkeypatch, tmp_path):
    import pathlib

    monkeypatch.setattr(tools, "TASKS_DIR", pathlib.Path(tmp_path / "tasks"))
    _fresh("run-isol-a")
    tools.TM.create("任务甲", "描述甲")
    tools.TM.create("任务乙", "描述乙")
    listing_a = tools.TM.list_all()

    _fresh("run-isol-b")
    listing_b = tools.TM.list_all()
    # B 会话看不到 A 的任务, 且编号在新 scope 从 1 重新计起
    assert "任务甲" not in listing_b
    assert listing_b == "No tasks."
    tools.TM.create("任务丙", "描述")
    listing_b = tools.TM.list_all()
    assert "#1: 任务丙" in listing_b
    assert "#1: 任务甲" in listing_a and "#2: 任务乙" in listing_a


def test_job_scope_isolation():
    _fresh("run-isol-job-a")
    tools.BG.run("sleep 0.2")
    check_a = tools.BG.check()  # 无参=列出本会话作业
    assert "sleep 0.2" in check_a

    _fresh("run-isol-job-b")
    check_b = tools.BG.check()
    assert check_b == "No background jobs."
    id_list = ["sleep"]  # find job id from A
    # A 的作业 id 在 B 里不可查
    import re

    aid = re.search(r"\b(\w{8}): \(running\)", check_a).group(1)
    assert "unknown job" in tools.BG.check(aid)
    time.sleep(0.4)


def test_inbox_scope_isolation(tmp_path, monkeypatch):
    monkeypatch.setattr(tools, "INBOX_DIR", tools.Path(tmp_path / "inbox"))
    tools._SCOPE_INSTANCES.clear()
    _fresh("run-isol-inbox-a")
    tools.BUS.send("lead", "teammate", "给甲的消息")
    msgs_a = tools.BUS.read_inbox("teammate")
    assert any("给甲的消息" in (m.get("content") or "") for m in msgs_a)

    _fresh("run-isol-inbox-b")
    msgs_b = tools.BUS.read_inbox("teammate")
    assert msgs_b == []
    # B 的收件箱目录与 A 分开
    assert (tools.Path(tmp_path / "inbox" / "run-isol-inbox-b")).exists()


def test_default_scope_backward_compatible():
    # 未绑 scope(本地 SDK)为 "default": 代理落地到原全局目录, 行为不变
    _fresh(None)
    assert tools.get_session_scope() == "default"
    inst = tools._scoped_instance("task", tools._tm_factory, "default")
    assert str(inst.dir).startswith(str(tools.TASKS_DIR))
