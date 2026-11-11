"""pi 式引导(steering): 会话流式期间的用户插话注入。

Agent 在两个边界取走排队插话(pi 语义: 当前 assistant 回合结束、下一次
模型调用前):
  ① 多轮工具循环的回合边界(注入点①, 循环顶);
  ② 模型已给出终文但队列仍有插话 —— 排队消息要求再一次响应(注入点②)。
本文件覆盖注入助手与队列排空语义; WS 链路(chat.steer → journal 回显 →
前端渲染)由 E2E 验证。
"""

from sigmaflow.agent.agent import Agent


def _bare_agent(steer_poll=None):
    """只构造 steer 相关状态的最小 Agent(不触网/不起客户端)。"""
    agent = Agent.__new__(Agent)
    agent.steer_poll = steer_poll
    return agent


def test_drain_returns_queued_texts():
    agent = _bare_agent(steer_poll=lambda: ["先看这里", "再补充一点"])
    assert agent._drain_steer() == ["先看这里", "再补充一点"]


def test_drain_without_poll_is_noop():
    agent = _bare_agent(steer_poll=None)
    assert agent._drain_steer() == []


def test_drain_swallows_poller_errors():
    def boom():
        raise RuntimeError("queue gone")

    agent = _bare_agent(steer_poll=boom)
    assert agent._drain_steer() == []


def test_drain_drops_blank_items():
    agent = _bare_agent(steer_poll=lambda: ["", "   ", None, "有效"])
    assert agent._drain_steer() == ["有效"]


def test_inject_appends_user_messages_to_messages_and_info():
    agent = _bare_agent(steer_poll=lambda: ["注意口径"])
    messages = [{"role": "user", "content": "初始"}]
    info = {"messages": []}
    assert agent._inject_steer(messages, info) is True
    assert messages[-1] == {"role": "user", "content": "注意口径"}
    assert info["messages"][-1] == {"role": "user", "content": "注意口径"}


def test_inject_returns_false_when_queue_empty():
    agent = _bare_agent(steer_poll=lambda: [])
    messages, info = [], {"messages": []}
    assert agent._inject_steer(messages, info) is False
    assert messages == []


# ---------------------------------------------------------------------------
# 存档层: 引导行不去重 + steerId 白名单保留(见 review #2/#13)
# ---------------------------------------------------------------------------

def _store_with_conversation(tmp_path):
    from sigmaflow.server.science import ScienceProjectStore

    store = ScienceProjectStore(storage_dir=str(tmp_path / "s"))
    store.conversations["cn-steer"] = {
        "id": "cn-steer",
        "title": "t",
        "content": [],
        "createdAt": 1,
        "updatedAt": 1,
    }
    return store


def test_steering_row_skips_content_dedup(tmp_path):
    """同内容"继续": 普通 user 行去重, 引导行不去重(去重会让已回显的引导
    在刷新后凭空消失)。"""
    store = _store_with_conversation(tmp_path)
    assert store.archive_user_row("cn-steer", "继续") is True
    # 普通重发: 内容相同 → 去重
    assert store.archive_user_row("cn-steer", "继续") is False
    # 引导插话: 内容相同也必须落行
    assert (
        store.archive_user_row("cn-steer", "继续", steering=True, steer_id="s1")
        is True
    )
    rows = store.conversations["cn-steer"]["content"]
    assert len(rows) == 2
    assert rows[-1]["steering"] is True
    assert rows[-1]["steerId"] == "s1"


def test_upsert_preserves_steering_and_steer_id(tmp_path):
    """前端整表归档(更完整版本)不得抹掉 steering/steerId 标志。"""
    from sigmaflow.server.science import ConversationIn

    store = _store_with_conversation(tmp_path)
    store.archive_user_row("cn-steer", "看看结果", steering=True, steer_id="s9")
    store.upsert_conversation(
        ConversationIn(
            id="cn-steer",
            title="t",
            projectId=None,
            content=[
                {"role": "user", "content": "看看结果", "steering": True, "steerId": "s9"},
                {"role": "assistant", "content": "好的"},
            ],
        )
    )
    rows = store.conversations["cn-steer"]["content"]
    assert rows[0]["steering"] is True
    assert rows[0]["steerId"] == "s9"


def test_steered_texts_drive_another_response():
    """注入点语义: 队列非空时 _inject_steer 返回 True(调用方据此续跑)。

    steer_poll 必须是排空语义(取走即清空, 与服务端 _steer_poll 闭包一致),
    mock 用可耗尽的容器而非常量 lambda。"""
    queue = ["补一句"]

    def drain():
        items = list(queue)
        queue.clear()
        return items

    agent = _bare_agent(steer_poll=drain)
    messages, info = [], {"messages": []}
    assert agent._inject_steer(messages, info) is True
    assert agent._inject_steer(messages, info) is False  # 队列已排空
