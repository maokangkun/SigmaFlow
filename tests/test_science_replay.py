"""chat journal 续播契约: 断线后事件无损重放, 消费即删, 停止补发 stopped 终态"""

import asyncio
import sys

sys.path.insert(0, "src")
from sigmaflow.server.science import ScienceAPI  # noqa: E402

API = ScienceAPI.__new__(ScienceAPI)
# __new__ 跳过了初始化: 手工补上 pump 依赖的最小实例状态
API._chat_journals = {}


class _FakeWs:
    """send_json 收集器: 支持注入 send 失败模拟断线"""

    def __init__(self):
        self.sent = []
        self.fail = False

    async def send_json(self, message):
        if self.fail:
            raise RuntimeError("connection closed")
        self.sent.append(message)


def _mk(n, terminal=True):
    """构造 work 产出的 state: n 条 delta(正文同步累积), 可选 done 终态"""
    st = {
        "journal": [],
        "content": [],
        "stats": {"completion_tokens": 7},
        "terminal": False,
        "stopped": False,
        "delivered": False,
        "stop": False,
    }
    for i in range(n):
        st["journal"].append(("delta", f"d{i}"))
        st["content"].append(f"d{i}")  # work 的 on_delta 同步累积正文
    if terminal:
        st["journal"].append(("done", {}))
    return st


def test_replay_full_and_seq_labels():
    st = _mk(3)
    API._chat_journals["r1"] = st
    ws = _FakeWs()
    asyncio.run(API._chat_pump(ws, "r1", st, -1))
    assert [m["event"] for m in ws.sent] == ["chat.delta"] * 3 + ["chat.done"]
    assert [m["seq"] for m in ws.sent] == [0, 1, 2, 3]
    # 终态消息带全量正文与 usage; 终置位且孤儿 journal 消费即删
    assert ws.sent[-1]["data"]["content"] == "d0d1d2"
    assert ws.sent[-1]["data"]["tokens"] == 7
    assert st["delivered"] and st["terminal"]
    assert "r1" not in API._chat_journals


def test_replay_from_start_seq_skips_consumed():
    st = _mk(4)
    ws = _FakeWs()
    # 从 seq=1 后续播: 只发 journal[2:] 直至终态
    asyncio.run(API._chat_pump(ws, "r1", st, 1))
    assert [m["data"].get("delta") for m in ws.sent] == ["d2", "d3", None]
    assert [m["seq"] for m in ws.sent] == [2, 3, 4]
    assert st["delivered"] and st["terminal"]


def test_replay_send_failure_keeps_journal():
    st = _mk(2)
    ws = _FakeWs()
    ws.fail = True
    asyncio.run(API._chat_pump(ws, "r1", st, -1))
    # 连接死: journal 完整保留, 任务状态不受影响
    assert len(st["journal"]) == 3
    assert not st["delivered"] and not st["terminal"]


def test_stop_midstream_forges_stopped_done():
    st = _mk(2, terminal=False)
    st["stop"] = True
    asyncio.run(API._chat_pump(_FakeWs(), "r1", st, -1))
    assert st["terminal"] and st["stopped"]
    kinds = [k for k, _ in st["journal"]]
    assert kinds[-1] == "done"
    assert st["journal"][-1][1] == {"stopped": True}


def test_concurrent_replay_pump_takeover():
    """并发两次 replay: 后启 pump 抢占, 先启 pump 不再推送, 事件不重复"""

    async def _run():
        st = _mk(4, terminal=False)
        ws1, ws2 = _FakeWs(), _FakeWs()
        t1 = asyncio.create_task(API._chat_pump(ws1, "r1", st, -1))
        await asyncio.sleep(0.12)  # t1 先把已有 4 条 delta 全部送达
        t2 = asyncio.create_task(API._chat_pump(ws2, "r1", st, -1))
        await asyncio.sleep(0.12)  # t2 启动并抢占令牌
        st["journal"].append(("done", {}))  # work 侧终态
        await asyncio.wait_for(t2, 2)
        await asyncio.wait_for(t1, 2)  # 被抢占者应自行退出而非卡死
        return st, ws1, ws2

    st, ws1, ws2 = asyncio.run(_run())
    # 抢占者送满全程(重放 4 条 + 终态), 被抢占者止步于抢占点的 4 条
    assert [m["event"] for m in ws2.sent].count("chat.done") == 1
    assert len(ws2.sent) == 5
    assert all(m["event"] == "chat.delta" for m in ws1.sent)
    assert st["delivered"] and st["terminal"]
