"""停机兜底归档的服务端契约测试。

服务重启(sigterm)会腰斩正在执行的对话: 此前 send 不落库、done 才由前端
归档, 中断后服务端只剩会话标题, 用户重连只见黑箱空会话。两个契约:

- archive_user_row: chat.send 即落 user 消息行, 尾条重复不追加;
- _interrupt_active_chats: 停机时给仍活跃的会话写"服务重启中断"行
  (带 error 字段), 且注销全部注册项。
"""

import types


def _store_with_conv(tmp_path, conv_id="run-x"):
    from sigmaflow.server.science import ScienceProjectStore

    store = ScienceProjectStore(storage_dir=str(tmp_path))
    store.conversations[conv_id] = {
        "id": conv_id,
        "title": "测试会话",
        "content": [],
        "createdAt": 1,
        "updatedAt": 1,
    }
    return store


def test_archive_user_row_appends_once(tmp_path):
    store = _store_with_conv(tmp_path)
    assert store.archive_user_row("run-x", "帮我分析这组数据") is True
    assert store.archive_user_row("run-x", "帮我分析这组数据") is False  # 重发防重
    rows = store.conversations["run-x"]["content"]
    assert len(rows) == 1
    assert rows[0]["role"] == "user"
    assert rows[0]["content"] == "帮我分析这组数据"
    assert rows[0]["at"] > 0


def test_archive_user_row_keeps_distinct_sends(tmp_path):
    store = _store_with_conv(tmp_path)
    store.archive_user_row("run-x", "第一个问题")
    store.archive_user_row("run-x", "第二个问题")
    rows = store.conversations["run-x"]["content"]
    assert [r["content"] for r in rows] == ["第一个问题", "第二个问题"]


def test_archive_user_row_ignores_missing_conv(tmp_path):
    store = _store_with_conv(tmp_path)
    assert store.archive_user_row("run-不存在", "内容") is False
    assert store.archive_user_row("run-x", "") is False


def test_interrupt_active_chats_writes_error_row(tmp_path):
    from sigmaflow.server.science import ScienceAPI, ScienceProjectStore

    store = _store_with_conv(tmp_path)
    store.archive_user_row("run-x", "长任务的问题")
    # 注册两个活跃请求, 其中一个的 runId 并不存在(半路会话)
    fake = types.SimpleNamespace(
        project_store=store,
        _active_runs={
            "req-1": {"runId": "run-x"},
            "req-2": {"runId": "run-missing"},
        },
    )
    ScienceAPI._interrupt_active_chats(fake)
    rows = store.conversations["run-x"]["content"]
    assert rows[-1]["role"] == "assistant"
    assert rows[-1]["error"] == "服务重启，任务中断"
    assert "服务重启" in rows[-1]["content"]
    # user 行仍在, 中断说明紧随其后
    assert rows[0]["role"] == "user"
    # 全部注册项已注销: 二次停机不重复写
    assert fake._active_runs == {}
    ScienceAPI._interrupt_active_chats(fake)
    assert len(store.conversations["run-x"]["content"]) == 2


def test_interrupt_active_chats_survives_store_error(tmp_path):
    """project_store 抛异常时停机仍清空注册表, 不因单会话失败卡死其余项。"""

    from sigmaflow.server.science import ScienceAPI

    class _BoomStore:
        def archive_assistant_row(self, *_a, **_k):
            raise RuntimeError("disk full")

        conversations = {"run-x": {}}

    fake = types.SimpleNamespace(
        project_store=_BoomStore(), _active_runs={"req-1": {"runId": "run-x"}}
    )
    ScienceAPI._interrupt_active_chats(fake)
    assert fake._active_runs == {}
