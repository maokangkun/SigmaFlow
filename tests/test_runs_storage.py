"""运行记录(runs)存档层: 生命周期/容量/并发字段更新。

服务端每次模型回复都会在会话 JSON 里落一条运行记录(turns/tokens/steers/
终态), 重启后仍可查 —— Trace 页与事后调试的数据源。
"""

import sys

sys.path.insert(0, "src")

from sigmaflow.server.science import ScienceProjectStore  # noqa: E402


def _store(tmp_path):
    store = ScienceProjectStore(storage_dir=str(tmp_path / "s"))
    store.conversations["run-1"] = {
        "id": "run-1",
        "title": "t",
        "content": [],
        "createdAt": 1,
        "updatedAt": 1,
    }
    return store


def test_begin_and_update_run_lifecycle(tmp_path):
    store = _store(tmp_path)
    rec = {"id": "rr-1", "status": "running", "steers": [], "startedAt": 100}
    store.begin_run("run-1", rec)
    # 同引用更新字段后 update_run 落盘
    rec["status"] = "done"
    rec["steers"].append({"id": "steer-a", "at": 120, "len": 8})
    store.update_run("run-1")

    # 重新加载(模拟服务重启): runs 随会话持久化
    store2 = ScienceProjectStore(storage_dir=str(tmp_path / "s"))
    runs = store2.conversations["run-1"]["runs"]
    assert len(runs) == 1
    assert runs[0]["status"] == "done"
    assert runs[0]["steers"][0]["id"] == "steer-a"


def test_begin_run_caps_at_20(tmp_path):
    store = _store(tmp_path)
    for i in range(25):
        store.begin_run("run-1", {"id": f"rr-{i}", "status": "done"})
    runs = store.conversations["run-1"]["runs"]
    assert len(runs) == 20
    assert runs[0]["id"] == "rr-5"  # 最老的 5 条被裁
    assert runs[-1]["id"] == "rr-24"


def test_begin_run_unknown_conversation_is_noop(tmp_path):
    store = _store(tmp_path)
    store.begin_run("nope", {"id": "rr-x"})
    assert "nope" not in store.conversations
    store.update_run("nope")  # 不抛错


def test_old_conversations_without_runs_load_cleanly(tmp_path):
    """旧库存档没有 runs 键: _load 后访问不炸, begin_run 从空建。"""
    store = _store(tmp_path)
    assert store.conversations["run-1"].get("runs") is None
    store.begin_run("run-1", {"id": "rr-new"})
    assert len(store.conversations["run-1"]["runs"]) == 1
