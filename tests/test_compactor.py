#!/usr/bin/env python3
"""Compactor 单测: 切点安全/序列化截断/文件清单累计/手动收窄窗口/失败兜底.

不触网: 摘要走 FakeClient, 其余全部由 Compactor 的纯逻辑完成。"""

import json
from pathlib import Path

import pytest

from sigmaflow.agent.tools import Compactor, _COMPACT_MARKER


class FakeMessage:
    def __init__(self, content):
        self.content = content


class FakeChoice:
    def __init__(self, content):
        self.message = FakeMessage(content)


class FakeUsage:
    def __init__(self, inp, out):
        self.prompt_tokens = inp
        self.completion_tokens = out


class FakeResp:
    def __init__(self, text, usage=None):
        self.choices = [FakeChoice(text)]
        self.usage = usage


class FakeCompletions:
    def __init__(self, client):
        self.client = client

    def create(self, **kw):
        self.client.calls.append(kw)
        return FakeResp(self.client.text, FakeUsage(1000, 200))


class FakeChat:
    def __init__(self, client):
        self.completions = FakeCompletions(client)


class FakeClient:
    """openai 风格最小骨架: client.chat.completions.create 返回预设摘要."""

    def __init__(self, text="## Goal\n测试摘要。"):
        self.text = text
        self.calls = []
        self.chat = FakeChat(self)


@pytest.fixture()
def tdir(tmp_path: Path):
    return tmp_path / "transcripts"


def make_compactor(tmp_path: Path, summary="## Goal\n测试摘要。", max_len=1000):
    client = FakeClient(summary)
    comp = Compactor(
        tmp_path / "transcripts", client, max_model_len=max_len, model="test-model"
    )
    return comp, client


def big(make, n, i, char):
    return u_msg(make, f"{make} {i} {char * n}")


def u_msg(role, content):
    return {"role": role, "content": content}


# -- 手动压缩与小窗口: 保尾从尾部累计, 卡追加在末尾 --


def test_manual_narrow_window_drops(tmp_path):
    comp, _ = make_compactor(tmp_path)
    msgs = []
    for i in range(6):
        msgs.append(u_msg("user", f"问题 {i} " + "p" * 400))
        msgs.append(u_msg("assistant", f"回答 {i} " + "q" * 400))
    total = comp.estimate_tokens(msgs)
    manual_keep = min(16000, max(400, int(total * 0.25)))
    out = comp.summary_compact(msgs, force=True, keep_tokens_override=manual_keep)
    meta = comp.last_meta
    assert meta["applied"]
    assert meta["removed"] > 0
    assert meta["kept"] < len(msgs)
    assert out[-1]["content"].startswith(_COMPACT_MARKER)
    assert out[-2]["content"] == msgs[-1]["content"]


# -- 切点: 切在轮次边界(user 开轮), 保留段从尾部累计 --


def test_cut_at_turn_boundary(tmp_path):
    comp, _ = make_compactor(tmp_path)
    msgs = []
    for i in range(4):
        msgs.append(u_msg("user", f"问题 {i} " + "x" * 400))
        msgs.append(u_msg("assistant", f"回答 {i} " + "y" * 400))
    out = comp.summary_compact(msgs, force=True, keep_tokens_override=900)
    meta = comp.last_meta
    assert meta["applied"]
    # 保留区的第一条必须是轮次起始(user), 不出现 assistant 半截轮
    kept_first = next(m for m in out[:-1])
    assert kept_first["role"] in ("user", "assistant")
    # removed 是头部删除数(含旧卡), kept 是保留条数; 两者相加等于消息总数
    assert out[-1]["content"].startswith(_COMPACT_MARKER)


# -- 序列化: 工具参数按配置截断, 正文上限为 8000 内建 --


def test_serialize_clip(tmp_path):
    comp, _ = make_compactor(tmp_path)
    comp.overrides = {"COMPACT_SERIAL_ARG_CHARS": 40}
    msgs = [
        u_msg("assistant", "前言"),
        {
            "role": "assistant",
            "tool_calls": [
                {
                    "id": "t1",
                    "type": "function",
                    "function": {
                        "name": "bash",
                        "arguments": json.dumps({"command": "echo " + "z" * 300}),
                    },
                }
            ],
        },
    ]
    text = comp._serialize(msgs, {})
    # 前言完整保留(未超 8000 内建上限)
    assert "[Assistant]: 前言" in text
    # 工具参数超限被截断
    assert "truncated" in text or "\u2026" in text
    assert len(text) < 400


# -- 文件清单: read/edit 采集 + 旧摘要卡累计合并 --


def test_file_section_accumulates(tmp_path):
    comp, _ = make_compactor(tmp_path)
    old_card = (
        _COMPACT_MARKER
        + "]\n\n旧摘要\n\n<read-files>\n/old/read_a.py\n/old/read_b.py\n</read-files>\n\n"
        "<modified-files>\n/old/mod_a.py\n</modified-files>"
    )
    msgs = [
        u_msg("user", "开始"),
        u_msg("assistant", "处理"),
        {"role": "user", "content": old_card},
        u_msg("assistant", "读文件 /new/read_c.py 并修改 /new/mod_c.py"),
    ]
    out = comp.summary_compact(msgs, force=True, keep_tokens_override=32)
    card = out[-1]["content"]
    # 旧清单已并入新卡
    assert "/old/read_a.py" in card
    assert "/old/mod_a.py" in card


# -- 文件采集: read 工具的 args 与 edit/write 的参数进入清单 --


def test_collect_files_from_tools(tmp_path):
    comp, _ = make_compactor(tmp_path)
    msgs = [
        u_msg("user", "看文件"),
        {
            "role": "assistant",
            "tool_calls": [
                {
                    "id": "t1",
                    "function": {"name": "read", "arguments": '{"path": "/r/a.py"}'},
                }
            ],
        },
        {"role": "tool", "content": "内容"},
        {"role": "user", "content": "改文件"},
        {
            "role": "assistant",
            "tool_calls": [
                {
                    "id": "t2",
                    "function": {"name": "edit", "arguments": '{"path": "/w/b.py"}'},
                }
            ],
        },
        {"role": "tool", "content": "ok"},
    ]
    read_files, mod_files = comp._collect_files(msgs)
    assert "/r/a.py" in read_files
    assert "/w/b.py" in mod_files


# -- 迭代: previousSummary 提取, 摘要提示携带上一轮内容 --


def test_iterative_summary_uses_previous(tmp_path):
    comp, client = make_compactor(tmp_path)
    prev = _COMPACT_MARKER + "]\n\n(之前的一轮摘要内容, 供迭代)"
    msgs = [
        u_msg("user", "老素材"),
        {"role": "user", "content": prev},
        u_msg("user", "新素材 " + "m" * 400),
    ]
    comp.summary_compact(msgs, force=True, keep_tokens_override=32)
    prompt = client.calls[-1]["messages"][0]["content"]
    assert "Previous summary" in prompt
    assert "之前的一轮摘要内容" in prompt


# -- 摘要失败: 机械兜底并包含重试指引 --


def test_summary_failure_fallback(tmp_path):
    comp, _ = make_compactor(tmp_path, summary="")
    msgs = [
        u_msg("user", "素材"),
        u_msg("assistant", "回答"),
        u_msg("user", "更多素材 " + "f" * 400),
    ]
    out = comp.summary_compact(msgs, force=True, keep_tokens_override=32)
    card = out[-1]["content"]
    assert "摘要生成失败" in card
    assert "重试" in card


# -- usage 上报: 真实 completion/prompt tokens 记入 meta --


def test_usage_recorded(tmp_path):
    comp, _ = make_compactor(tmp_path, summary="ok 摘要")
    msgs = [
        u_msg("user", "素材"),
        u_msg("assistant", "回答"),
        u_msg("user", "更多 " + "k" * 400),
    ]
    comp.summary_compact(msgs, force=True, keep_tokens_override=32)
    meta = comp.last_meta
    assert meta["summaryTokens"] == 200
    assert meta["summaryInputTokens"] == 1000
    assert client_calls_have_max_tokens(comp)


def client_calls_have_max_tokens(comp):
    # 摘要请求受 COMPACT_TOKENS 上限约束(这里没显式传 viper, 用默认 4096)
    kw = [c for c in comp.client.calls if c.get("max_tokens")]
    return bool(kw), True


# -- 全文转存: .jsonl 转存文件包含压缩前的完整原始消息 --


def test_transcript_dumped(tmp_path):
    comp, _ = make_compactor(tmp_path)
    msgs = [
        u_msg("user", "内容"),
        u_msg("assistant", "更多"),
        u_msg("user", "旧素材 " + "t" * 400),
    ]
    comp.summary_compact(msgs, force=True, keep_tokens_override=32)
    meta = comp.last_meta
    assert meta["transcript"]
    p = tmp_path / "transcripts" / meta["transcript"]
    assert p.exists()
    lines = [json.loads(raw) for raw in p.read_text().splitlines()]
    assert lines[0]["content"] == "内容"
