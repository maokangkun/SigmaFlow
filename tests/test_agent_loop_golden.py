"""Agent 主循环金轨回放(loop 重构的前后对拍基准)。

fixture 由 `python tests/test_agent_loop_golden.py --bless` 生成于当前实现;
重构后跑测试即对拍, 行为漂移立即可见。
"""

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))
from agent_replay import run_replay

FIXTURE = Path(__file__).parent / "fixtures" / "agent_loop_golden.json"


def _script_basic():
    return [
        {
            "thinking": "I should run the command.",
            "text": "Let me run that for you.",
            "tool_calls": [
                {
                    "id": "tu_1",
                    "name": "bash",
                    "input": {"command": "echo hello-replay"},
                }
            ],
            "stop_reason": "tool_use",
            "usage": {"input": 100, "output": 20},
        },
        {
            "text": "The command printed `hello-replay`. Done.",
            "stop_reason": "end_turn",
            "usage": {"input": 150, "output": 12},
        },
    ]


def _script_steer():
    return [
        {
            "text": "First answer.",
            "stop_reason": "end_turn",
            "usage": {"input": 50, "output": 5},
        },
        {
            "text": "Steered answer.",
            "stop_reason": "end_turn",
            "usage": {"input": 60, "output": 6},
        },
    ]


def _script_read_write():
    return [
        {
            "tool_calls": [
                {
                    "id": "tu_w",
                    "name": "write",
                    "input": {"path": "note.txt", "content": "line1\nline2\n"},
                }
            ],
            "stop_reason": "tool_use",
            "usage": {"input": 80, "output": 10},
        },
        {
            "tool_calls": [
                {"id": "tu_r", "name": "read", "input": {"path": "note.txt"}}
            ],
            "stop_reason": "tool_use",
            "usage": {"input": 90, "output": 8},
        },
        {
            "text": "Read back successfully.",
            "stop_reason": "end_turn",
            "usage": {"input": 95, "output": 9},
        },
    ]


def _steer_poll_once():
    """插话队列: 首次轮询(注入点①, 回合顶)为空; 第二次轮询(注入点②,
    模型已给终文)返回一条; 之后排空。覆盖两个注入边界的语义。"""
    state = {"calls": 0}

    def poll():
        state["calls"] += 1
        if state["calls"] == 2:
            return ["先看这里"]
        return []

    return poll


SCENARIOS = {
    "basic_tool": lambda tmp_path, monkeypatch, **kw: run_replay(
        tmp_path, _script_basic(), monkeypatch, **kw
    ),
    "steer_injection": lambda tmp_path, monkeypatch, **kw: run_replay(
        tmp_path, _script_steer(), monkeypatch, steer=_steer_poll_once(), **kw
    ),
    "file_roundtrip": lambda tmp_path, monkeypatch, **kw: run_replay(
        tmp_path, _script_read_write(), monkeypatch, **kw
    ),
}


@pytest.mark.parametrize("name", sorted(SCENARIOS))
def test_loop_replay_golden(name, tmp_path, monkeypatch):
    if not FIXTURE.is_file():
        pytest.skip("golden fixture not generated yet; run with --bless")
    blessed = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert name in blessed, f"scenario {name} missing in fixture"
    result = SCENARIOS[name](tmp_path, monkeypatch)
    assert result == blessed[name], _diff_hint(result, blessed[name])


def _diff_hint(got, want):
    import difflib

    got_s = json.dumps(got, ensure_ascii=False, indent=1, sort_keys=True).splitlines()
    want_s = json.dumps(want, ensure_ascii=False, indent=1, sort_keys=True).splitlines()
    return "\n".join(difflib.unified_diff(want_s, got_s, "golden", "current"))[:4000]


def test_replay_is_deterministic(tmp_path, monkeypatch):
    """同一实现连跑两遍结果一致(金轨的前提)。"""
    a = SCENARIOS["basic_tool"](tmp_path, monkeypatch)
    b = SCENARIOS["basic_tool"](tmp_path, monkeypatch)
    assert a == b


if __name__ == "__main__" and "--bless" in sys.argv:
    FIXTURE.parent.mkdir(parents=True, exist_ok=True)
    out = {}
    import tempfile

    for name in sorted(SCENARIOS):
        with tempfile.TemporaryDirectory() as td:

            class _MP:
                def setattr(self, obj, name, value):
                    old = getattr(obj, name)
                    setattr(obj, name, value)
                    self._undo = getattr(self, "_undo", [])
                    self._undo.append((obj, name, old))

                def undo(self):
                    for obj, name, old in reversed(self._undo):
                        setattr(obj, name, old)

            mp = _MP()
            try:
                out[name] = SCENARIOS[name](Path(td), mp)
            finally:
                mp.undo()
    FIXTURE.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"blessed {len(out)} scenarios -> {FIXTURE}")
