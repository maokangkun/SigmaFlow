"""agent 流中断重试辅助: 错误分类与请求瘦身(_slim_tool_results)。

背景: pjlab 等网关慢性掐断流式响应(peer closed / incomplete chunked read),
超大请求(百余轮工具结果)全量重传只会同样失败——见 agent.py 的快速重试与
历史工具结果收紧策略。
"""

import copy

from sigmaflow.agent.agent import _is_stream_drop, _slim_tool_results


class TestIsStreamDrop:
    def test_matches_known_stream_drop_errors(self):
        assert _is_stream_drop(
            "peer closed connection without sending complete message body "
            "(incomplete chunked read)"
        )
        assert _is_stream_drop("Server disconnected without sending a response")
        assert _is_stream_drop("[Errno 104] Connection reset by peer")
        assert _is_stream_drop("Connection aborted by remote")

    def test_ignores_other_errors(self):
        assert not _is_stream_drop("Rate limit reached, retry_after: 46")
        assert not _is_stream_drop("Model returned an empty response")
        assert not _is_stream_drop("Incorrect API key provided")


def _openai_history(n_tools=20, result_len=2000):
    """构造 OpenAI 形态的多轮工具历史: assistant(tool_calls) + tool(result) 交替。"""
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


class TestSlimToolResults:
    def test_trims_old_results_keeps_recent_full(self):
        msgs = _openai_history(n_tools=20, result_len=2000)
        # 前 8 条(20-12)被截断, 最近 12 条原样
        n = _slim_tool_results(msgs, keep_last=12, cap=800)
        tools = [m for m in msgs if m.get("role") == "tool"]
        assert n == 8
        assert len(tools[0]["content"]) < 2000
        assert "result elided" in tools[0]["content"]
        assert len(tools[-1]["content"]) == 2000  # 最近的不动

    def test_idempotent_on_second_pass(self):
        msgs = _openai_history(n_tools=15, result_len=1500)
        first = _slim_tool_results(msgs, keep_last=5, cap=600)
        snapshot = [m.get("content") for m in msgs if m.get("role") == "tool"]
        second = _slim_tool_results(msgs, keep_last=5, cap=600)
        assert first > 0
        assert second == 0  # 带尾标记的不再二次截断
        assert snapshot == [m.get("content") for m in msgs if m.get("role") == "tool"]

    def test_anthropic_format_untouched(self):
        # anthropic 形态: 工具结果在 user 消息的 content 块列表里, 不应被改写
        msgs = [
            {
                "role": "user",
                "content": [
                    {"type": "tool_result", "tool_use_id": "t1", "content": "x" * 3000}
                ],
            },
            {"role": "assistant", "content": [{"type": "text", "text": "done"}]},
        ]
        before = copy.deepcopy(msgs)
        assert _slim_tool_results(msgs, keep_last=0, cap=100) == 0
        assert msgs == before

    def test_short_results_untouched(self):
        msgs = [
            {
                "role": "assistant",
                "tool_calls": [
                    {
                        "id": "c1",
                        "type": "function",
                        "function": {"name": "f", "arguments": "{}"},
                    }
                ],
            },
            {"role": "tool", "tool_call_id": "c1", "content": "short"},
        ]
        assert _slim_tool_results(msgs, keep_last=0, cap=800) == 0
        assert msgs[1]["content"] == "short"
