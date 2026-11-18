"""agent 重试循环的流中断接线测试: 快速退避 + 反复失败后请求瘦身。

直接驱动 Agent._stage_llm_call 的 openai 失败路径(伪 client 恒抛
httpx.RemoteProtocolError), 验证:
- 前两次流中断退避 1.5s/4s(on_retry 的 wait = 1/4), 之后回落指数退避;
- 第 3 次失败起, 历史工具结果被收紧(最近 12 条保持原样, 更早的截短)。
"""

from types import SimpleNamespace

import httpx
import pytest

import sigmaflow.agent.agent as agent_mod
from sigmaflow.agent.agent import Agent


class _AlwaysDropClient:
    """chat.completions.create 恒抛流中断错误, 模拟网关掐断响应。"""

    def __init__(self):
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    @staticmethod
    def _create(**_kw):
        raise httpx.RemoteProtocolError(
            "peer closed connection without sending complete message body "
            "(incomplete chunked read)"
        )


def _make_agent(recorder):
    a = object.__new__(Agent)
    a.method = "openai"
    a.model = "test-model"
    a.retry = 5
    a.client = _AlwaysDropClient()
    a.on_retry = recorder
    a.on_delta = lambda piece: None  # 走流式分支
    a.on_usage = None
    a.on_tool = None
    a.max_model_len = None
    a.tool_result_limit = 30000
    a.support_tool = False
    return a


def _history(n_tools=20, result_len=2000):
    msgs = [{"role": "user", "content": "task"}]
    for i in range(n_tools):
        msgs.append(
            {
                "role": "assistant",
                "tool_calls": [
                    {
                        "id": f"call_{i}",
                        "type": "function",
                        "function": {"name": "bash", "arguments": "{}"},
                    }
                ],
            }
        )
        msgs.append(
            {"role": "tool", "tool_call_id": f"call_{i}", "content": "x" * result_len}
        )
    return msgs


@pytest.fixture()
def _no_sleep(monkeypatch):
    slept = []
    monkeypatch.setattr(agent_mod.time, "sleep", lambda s: slept.append(s))
    return slept


def test_stream_drop_retry_fast_backoff_then_slim(_no_sleep, capsys):
    attempts = []

    def rec(ev):
        attempts.append(ev)

    msgs = _history(n_tools=20, result_len=2000)
    lc = SimpleNamespace(messages=msgs, info={}, knight_rider=None, usable_tools=[])
    agent = _make_agent(rec)

    agent._stage_llm_call(lc)  # 伪 client 恒失败 → 烧光 5 次重试

    assert lc.info["error"].startswith("peer closed connection")
    assert [ev["wait"] for ev in attempts] == [1, 4, 45, 135]
    # 前两次短路快速退避(1.5/4s + 抖动), 之后 45/135 + 抖动
    assert _no_sleep[0] < 4.0 and 4.0 <= _no_sleep[1] < 6.1
    assert 45 <= _no_sleep[2] < 48.0
    # 第 3 次失败起触发了瘦身: 8 条旧结果被截短, 最近 12 条原样
    tools = [m for m in msgs if m.get("role") == "tool"]
    assert sum(1 for t in tools if "result elided" in t["content"]) == 8
    assert all(len(t["content"]) == 2000 for t in tools[-12:])
    out = capsys.readouterr().out
    assert "trimmed 8 old tool results" in out


def test_small_request_never_slimmed(_no_sleep):
    attempts = []
    msgs = _history(n_tools=10, result_len=100)  # 全部短结果: 无可截断
    lc = SimpleNamespace(messages=msgs, info={}, knight_rider=None, usable_tools=[])
    agent = _make_agent(lambda ev: attempts.append(ev))
    agent._stage_llm_call(lc)
    assert all(len(m["content"]) == 100 for m in msgs if m.get("role") == "tool")
