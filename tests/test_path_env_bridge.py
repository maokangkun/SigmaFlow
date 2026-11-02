"""虚拟病原体环境(pathenv)单元测试: 工具分层 / MCP 分组端点 / 桥接回路。

目录与引擎在浏览器里, 这里只验证服务端描述层: 31 个工具、五个尺度的互斥分组、
按组过滤的 MCP 行为, 以及与患者环境共用的通用桥(envbridge)在第二个环境上的
语义("页面没有打开"的引导文案、假页面回路)。
"""

import asyncio
import time

from sigmaflow.server import pathenv
from sigmaflow.server.envbridge import EnvHub


def test_tool_surface_is_grouped_and_complete():
    assert len(pathenv.TOOLS) == 31
    assert all(t["name"].startswith("pathogen_") for t in pathenv.TOOLS)
    covered = set()
    for names in pathenv.GROUPS.values():
        covered |= set(names)
    assert covered == {t["name"] for t in pathenv.TOOLS}  # 分组无缝无重
    for tool in pathenv.TOOLS:
        assert tool["description"].strip()
        assert tool["inputSchema"]["type"] == "object"


def test_tools_list_filters_by_group():
    hub = pathenv.PathEnvHub()
    all_ids = {
        t["name"]
        for t in hub.mcp_handle(
            "u", {"jsonrpc": "2.0", "id": 1, "method": "tools/list"}
        )["result"]["tools"]
    }
    host_ids = {
        t["name"]
        for t in hub.mcp_handle("u", {"id": 2, "method": "tools/list"}, group="host")[
            "result"
        ]["tools"]
    }
    assert len(all_ids) == 31
    assert len(host_ids) == len(pathenv.GROUPS["host"]) == 9
    assert host_ids < all_ids
    # serverInfo 带分组名, 便于在智能体侧辨认是哪一层在应答
    info = hub.mcp_handle("u", {"id": 3, "method": "initialize"}, group="molecular")[
        "result"
    ]["serverInfo"]
    assert info["name"] == "pathenv-molecular"


def test_group_gate_rejects_tools_of_other_layers():
    """分子层端点必须拒绝宿主层的工具 —— 分层的意义就是缩小可见工具面。"""
    hub = pathenv.PathEnvHub()

    async def run():
        return await hub.mcp_call(
            "tester",
            {
                "jsonrpc": "2.0",
                "id": 9,
                "params": {
                    "name": "pathogen_dose",
                    "arguments": {"drug": "art", "mg": 100},
                },
            },
            group="molecular",
        )

    reply = asyncio.run(run())
    assert reply["error"]["code"] == -32602


def test_call_without_open_page_returns_pathogen_guidance():
    hub = pathenv.PathEnvHub()

    async def run():
        return await hub.call("nobody", "pathogen_catalog", {})

    outcome = asyncio.run(run())
    assert outcome["ok"] is False
    assert "虚拟病原体" in outcome["text"]  # 文案随环境变化, 不是患者的
    assert "患者" not in outcome["text"]


def test_page_bridge_roundtrip_shared_with_patient():
    """通用桥在第二个环境上语义不变: 假页面领调用 → 执行 → 回传。"""
    hub = pathenv.PathEnvHub()
    session = hub.register("tester")

    async def run():
        task = asyncio.create_task(
            hub.call("tester", "pathogen_inoculate", {"log10_dose": 3})
        )
        await asyncio.sleep(0)
        queued = await asyncio.wait_for(session.pending.get(), timeout=2)
        assert queued["tool"] == "pathogen_inoculate"
        assert queued["args"] == {"log10_dose": 3}
        assert hub.submit(session.id, queued["id"], {"ok": True, "text": "已接种 1e3"})
        return await asyncio.wait_for(task, timeout=2)

    assert asyncio.run(run()) == {"ok": True, "text": "已接种 1e3"}


def test_stale_session_no_longer_hangs_tool_calls():
    """关闭的标签页不能再拖住工具调用: 宿主必须"还在长轮询"才算活着。

    修复前, 注册过一次会话的浏览器关掉页面后, 后续 tools/call 会在队列里
    干等 120s 才报错; 现在超过 POLL_TTL 没轮询就立即按"页面没有打开"引导。
    """
    hub = pathenv.PathEnvHub()
    hub.POLL_TTL = 0.05
    session = hub.register("tester")

    async def no_poller_call():
        await asyncio.sleep(0.1)  # 会话注册后从未轮询
        return await hub.call("tester", "pathogen_catalog", {})

    outcome = asyncio.run(no_poller_call())
    assert outcome["ok"] is False
    assert "虚拟病原体" in outcome["text"]

    async def poller_then_result():
        # 活的宿主: 先有轮询证据(last_poll 刷新), 再领任务执行回传
        session.last_poll = time.time()
        task = asyncio.create_task(hub.call("tester", "pathogen_catalog", {}))
        await asyncio.sleep(0)
        queued = await asyncio.wait_for(session.pending.get(), timeout=2)
        session.last_poll = time.time()
        session.seen = session.last_poll
        assert hub.submit(session.id, queued["id"], {"ok": True, "text": "目录已返回"})
        return await asyncio.wait_for(task, timeout=2)

    assert asyncio.run(poller_then_result()) == {"ok": True, "text": "目录已返回"}


def test_envbridge_is_shared_between_both_environments():
    """患者与病原体环境必须共用同一个桥实现 —— 只改描述不改传输。"""
    import sigmaflow.server.patenv as patenv

    assert isinstance(patenv.HUB, EnvHub)
    assert isinstance(pathenv.HUB, EnvHub)
    assert patenv.HUB is not pathenv.HUB  # 但两者的会话互相独立
    # 不同环境对同一用户的会话不串台
    a = patenv.HUB.register("tester")
    b = pathenv.HUB.register("tester")
    assert a.id != b.id
    assert patenv.HUB.host("tester").id == a.id
    assert pathenv.HUB.host("tester").id == b.id


def test_prompt_is_shipped_and_teaches_discipline():
    text = pathenv.pathogen_agent_prompt()
    assert "pathogen" in text
    assert "测序" in text  # 分子层流程(先测序才能看变异)确实在提示词里
    assert "对照" in text  # 实验纪律: 没有对照不得宣称有效
    assert "tier" in text.lower() or "保真度" in text
    assert "不能" in text  # 沙盒边界声明
