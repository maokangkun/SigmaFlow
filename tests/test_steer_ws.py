"""steering 服务端链路单元层: pump 的 steer 事件分支 + 会话互斥查找。

WS 动作(chat.steer/chat.send)的完整链路属 E2E 范畴(tests/e2e); 这里覆盖
可直测的两块: journal 事件的推送形态与 (用户, 会话) 在途回复查找。
"""

import asyncio
import sys

sys.path.insert(0, "src")

from sigmaflow.server.science import (  # noqa: E402
    ScienceAPI,
    _find_active_state,
)

API = ScienceAPI.__new__(ScienceAPI)
API._chat_journals = {}


class _FakeWs:
    def __init__(self):
        self.sent = []

    async def send_json(self, message):
        self.sent.append(message)


def _pump(state, start_seq=-1):
    ws = _FakeWs()
    asyncio.run(API._chat_pump(ws, "r1", state, start_seq))
    return ws.sent


# ---------------------------------------------------------------------------
# pump: steer 事件分支
# ---------------------------------------------------------------------------


def test_pump_forwards_steer_event_with_id_and_seq():
    state = {
        "journal": [("steer", {"id": "steer-abc", "text": "继续", "at": "T"})],
        "content": [],
        "stats": {},
        "terminal": True,
        "stop": False,
        "pump_next": 0,
        "pump_token": 0,
    }
    # journal 里再补一条 done, 让 pump 消费完 steer 后进入终态退出
    state["journal"].append(("done", {}))
    sent = _pump(state)
    steer = next(m for m in sent if m["event"] == "chat.steer")
    assert steer["data"] == {"id": "steer-abc", "text": "继续", "at": "T"}
    assert steer["seq"] == 0  # 游标从 0 起
    done = next(m for m in sent if m["event"] == "chat.done")
    assert done["seq"] == 1  # steer 之后顺序推进


def test_pump_steer_branch_tolerates_malformed_value():
    state = {
        "journal": [("steer", "not-a-dict"), ("done", {})],
        "content": [],
        "stats": {},
        "terminal": True,
        "stop": False,
        "pump_next": 0,
        "pump_token": 0,
    }
    sent = _pump(state)
    steer = next(m for m in sent if m["event"] == "chat.steer")
    assert steer["data"] == {"id": "", "text": "", "at": ""}


def test_pump_steer_replays_from_last_seq():
    """断线重连(chat.replay)从游标续播: 只补缺失的 steer 事件, 不重复已消费的。"""
    state = {
        "journal": [
            ("delta", "a"),
            ("steer", {"id": "s2", "text": "插入", "at": "T"}),
            ("delta", "b"),
            ("done", {}),
        ],
        "content": ["a", "b"],
        "stats": {},
        "terminal": True,
        "stop": False,
        "pump_next": 0,
        "pump_token": 0,
    }
    sent = _pump(state, start_seq=1)  # 前端已收到 seq<=1(delta + steer)
    events = [m["event"] for m in sent]
    assert "chat.steer" not in events  # 已消费的 steer 不重放
    assert events[-1] == "chat.done"


# ---------------------------------------------------------------------------
# 会话互斥查找(chat.steer 投放 / chat.send 拒绝共用)
# ---------------------------------------------------------------------------


def _runs():
    return {
        ("alice", 3): {"runId": "run-a", "state": {"steer": [], "journal": []}},
        ("bob", 1): {"runId": "run-b", "state": {"terminal": True}},
        ("alice", 7): {"runId": "run-done", "state": {"terminal": True}},
    }


def test_find_active_state_matches_user_and_run():
    st = _find_active_state(_runs(), "alice", "run-a")
    assert st is not None and "steer" in st


def test_find_active_state_ignores_terminal_runs():
    assert _find_active_state(_runs(), "alice", "run-done") is None


def test_find_active_state_is_per_user():
    # 会话 id 相同但属于别的用户: 不可见(多用户隔离)
    assert _find_active_state(_runs(), "bob", "run-a") is None


def test_find_active_state_missing_run():
    assert _find_active_state(_runs(), "alice", "run-none") is None
