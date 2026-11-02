"""虚拟患者环境桥(patenv)单元测试: 会话注册 / 工具清单 / 调用回传 / 超时语义。

环境本体在浏览器里跑真实生理引擎, 服务端只是把智能体的工具调用转给页面并等结果,
因此这里用"假页面"(直接消费 hub 队列并回传)覆盖整条链路, 不需要真实浏览器。
"""

import asyncio


from sigmaflow.server import patenv


def test_tool_specs_are_mcp_shaped():
    names = [t["name"] for t in patenv.TOOLS]
    assert len(names) == len(set(names)) >= 10
    assert all(n.startswith("patient_") for n in names)
    for tool in patenv.TOOLS:
        assert tool["description"].strip()
        schema = tool["inputSchema"]
        assert schema["type"] == "object"
        assert isinstance(schema["properties"], dict)


def test_tools_list_over_jsonrpc():
    hub = patenv.PatEnvHub()
    reply = hub.mcp_handle(
        "tester", {"jsonrpc": "2.0", "id": 7, "method": "tools/list"}
    )
    assert reply["id"] == 7
    assert [t["name"] for t in reply["result"]["tools"]] == [
        t["name"] for t in patenv.TOOLS
    ]


def test_unknown_tool_is_rejected():
    hub = patenv.PatEnvHub()

    async def run():
        return await hub.mcp_call(
            "tester",
            {
                "jsonrpc": "2.0",
                "id": 1,
                "params": {"name": "patient_nope", "arguments": {}},
            },
        )

    reply = asyncio.run(run())
    assert reply["error"]["code"] == -32602


def test_call_without_open_page_returns_guidance():
    hub = patenv.PatEnvHub()

    async def run():
        return await hub.call("nobody", "patient_observe", {})

    outcome = asyncio.run(run())
    assert outcome["ok"] is False
    assert "患者页" in outcome["text"]


def test_page_bridge_roundtrip():
    """假页面: 领到调用 → 执行 → 回传, 智能体侧拿到结果。"""
    hub = patenv.PatEnvHub()
    session = hub.register("tester")

    async def run():
        task = asyncio.create_task(
            hub.call("tester", "patient_case_start", {"case_id": "sca"})
        )
        await asyncio.sleep(0)  # 让 call() 先入队
        queued = await asyncio.wait_for(session.pending.get(), timeout=2)
        assert queued["tool"] == "patient_case_start"
        assert queued["args"] == {"case_id": "sca"}
        assert hub.submit(session.id, queued["id"], {"ok": True, "text": "病例已载入"})
        return await task

    outcome = asyncio.run(run())
    assert outcome == {"ok": True, "text": "病例已载入"}


def test_new_page_instance_replaces_stale_host():
    hub = patenv.PatEnvHub()
    first = hub.register("tester")
    second = hub.register("tester")
    assert first.id != second.id
    assert hub.host("tester").id == second.id
    assert hub.get(first.id) is None


def test_prompt_is_shipped_and_mentions_tools():
    text = patenv.patient_agent_prompt()
    assert "patient_observe" in text
    assert "patient_advance" in text
    assert "观察" in text  # 中文提示词确实被读到, 不是兜底英文
