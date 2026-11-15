"""Agent 全循环回放桩: 固定脚本 LLM + 事件捕获, 供 loop 重构金轨对拍。

用法:
    from agent_replay import FakeAnthropic, run_replay
    result = run_replay(tmp_path, script=[...])   # 见 test_agent_loop_golden

脚本条目 = 一次模型调用的最终消息(anthropic 形态):
    {"text": "...", "thinking": "...", "tool_calls": [{"id","name","input"}],
     "stop_reason": "end_turn"|"tool_use", "usage": {"input": n, "output": n}}
"""

import json
from types import SimpleNamespace


# ------------------------------------------------------------------ 桩客户端
class ThinkingEvent:
    def __init__(self, thinking):
        self.thinking = thinking


class TextEvent:
    def __init__(self, text):
        self.text = text


class _FakeStreamCtx:
    def __init__(self, script_entry, events_out):
        self._entry = script_entry
        self._events = events_out
        self._used = False

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def __iter__(self):
        if self._used:
            return iter(())
        self._used = True
        evs = []
        if self._entry.get("thinking"):
            evs.append(ThinkingEvent(self._entry["thinking"]))
        for piece in self._entry.get("text_pieces", [self._entry.get("text", "")]):
            if piece:
                evs.append(TextEvent(piece))
        return iter(evs)

    def get_final_message(self):
        return _final_message(self._entry)


class _Block:
    """anthropic SDK 内容块的最小替身: 属性访问 + .dict()(agent 循环会调用)。"""

    def __init__(self, type_, **fields):
        self.type = type_
        self._fields = {"type": type_, **fields}
        for k, v in fields.items():
            setattr(self, k, v)

    def dict(self):
        return dict(self._fields)

    def __repr__(self):
        return f"_Block({self._fields})"


def _block(b):
    if b["type"] == "text":
        return _Block("text", text=b.get("text", ""))
    if b["type"] == "thinking":
        return _Block("thinking", thinking=b.get("thinking", ""))
    if b["type"] == "tool_use":
        return _Block(
            "tool_use", id=b.get("id", "t1"), name=b["name"], input=b.get("input", {})
        )
    raise ValueError(b)


def _final_message(entry):
    blocks = []
    if entry.get("thinking"):
        blocks.append(_block({"type": "thinking", "thinking": entry["thinking"]}))
    if entry.get("text"):
        blocks.append(_block({"type": "text", "text": entry["text"]}))
    for tc in entry.get("tool_calls", []):
        blocks.append(_block({"type": "tool_use", **tc}))
    usage = entry.get("usage", {})
    return SimpleNamespace(
        content=blocks,
        stop_reason=entry.get("stop_reason", "end_turn"),
        usage=SimpleNamespace(
            input_tokens=usage.get("input", 10),
            output_tokens=usage.get("output", 5),
        ),
    )


class FakeAnthropicMessages:
    def __init__(self, script, calls_log):
        self._script = script
        self._calls = calls_log

    def stream(self, **kw):
        self._calls.append(
            {"model": kw.get("model"), "n_msgs": len(kw.get("messages") or [])}
        )
        if not self._script:
            raise AssertionError("replay script exhausted")
        return _FakeStreamCtx(self._script.pop(0), None)

    def create(self, **kw):
        self._calls.append(
            {"model": kw.get("model"), "n_msgs": len(kw.get("messages") or [])}
        )
        return _final_message(self._script.pop(0))


class FakeAnthropic:
    """client.messages.stream/create 的最小桩; 每次调用消耗一个脚本条目。"""

    def __init__(self, script):
        self.calls_log = []
        self.messages = FakeAnthropicMessages(list(script), self.calls_log)


# ------------------------------------------------------------------ 回放
def _norm_content(c):
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        return [
            json.loads(json.dumps(b, default=str, ensure_ascii=False, sort_keys=True))
            for b in c
        ]
    return json.loads(json.dumps(c, default=str, ensure_ascii=False, sort_keys=True))


def run_replay(tmp_path, script, monkeypatch, *, messages=None, steer=None, tools=None):
    """跑一次完整 Agent 循环, 返回规范化的事件/消息快照。"""
    from sigmaflow.agent import agent as agent_module
    from sigmaflow.agent.agent import Agent

    monkeypatch.setattr(agent_module, "TRANSCRIPT_DIR", tmp_path / "transcripts")

    fake = FakeAnthropic(script)
    agent = Agent(
        method="anthropic",
        model="fake-model",
        base_url="http://127.0.0.1:9",
        api_key="replay-key",
        max_model_len=8000,
        support_tool=True,
        retry=1,
    )
    agent.client = fake
    if tools is not None:
        agent.tools = [t for t in agent.tools if t["name"] in tools]
    if steer is not None:
        agent.steer_poll = steer

    tool_events = []
    deltas = []
    agent.on_tool = lambda ev: tool_events.append(ev)
    agent.on_delta = lambda text, *a, **k: deltas.append(text)

    msgs = messages or [{"role": "user", "content": "run echo hello then report"}]
    info = agent(msgs, is_print=False, show_processing=False) or {}

    transcript = [
        {"role": m.get("role"), "content": _norm_content(m.get("content"))}
        for m in info.get("messages", [])
    ]
    norm_events = []
    for ev in tool_events:
        norm_events.append(
            {
                k: ev.get(k)
                for k in ("kind", "name", "subagent", "status", "compaction")
                if isinstance(ev, dict) and k in ev
            }
        )
    return json.loads(
        json.dumps(
            {
                "transcript": transcript,
                "tool_events": norm_events,
                "deltas": [d for d in deltas if d is not None],
                "used_tools": info.get("used_tools"),
                "used_skills": info.get("used_skills"),
                "error": info.get("error"),
                "llm_calls": fake.calls_log,
            },
            ensure_ascii=False,
            default=str,
        )
    )
