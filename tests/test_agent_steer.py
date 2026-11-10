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
