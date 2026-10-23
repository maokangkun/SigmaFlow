"""轮次预算耗尽(死寂截停)的服务端契约测试。

_run_agent_chat 在模型从未产出正文、但工具轨迹已存在时必须返回
(进度说明, info) 且 info 带轮次上限语义的 error —— HTTP 调用方拿它当
content 兜底, WS work() 据此补发 delta(note) + error 事件, 前端才能看到
"为什么循环停了" 而不是工具轨迹戛然而止。
"""

import types


def test_budget_deadstop_returns_note_and_error(monkeypatch):
    import sigmaflow.agent.agent as agent_module
    import sigmaflow.server.science as science

    deadstop_error = (
        "已达单次回复的轮次上限(10轮): 长任务在预算内未完成, "
        "工具轨迹已保留, 可发送『继续』接续执行。"
    )

    class _DeadstopAgent:
        """预算耗尽形态: 工具已执行但模型无最终正文。"""

        def __init__(self, **_kw):
            self.compactor = types.SimpleNamespace(last_meta=None)
            self.client = types.SimpleNamespace(timeout=90)

        def __call__(self, _messages, is_print=False, max_turn=None, **_kw):
            return {
                "config": {},
                "messages": [],
                "last_response": None,
                "cost_tokens": 0,
                "completion_tokens": 7,
                "prompt_tokens": 11,
                "last_prompt_tokens": 11,
                "cache_read_tokens": 0,
                "cost_time": 0.0,
                "used_tools": [("bash", {"command": "echo hi"}, "hi")],
                "used_skills": [],
                "deliverables": [{"path": "/tmp/out.txt"}],
                "error": deadstop_error,
            }

    monkeypatch.setattr(agent_module, "Agent", _DeadstopAgent)
    stats: dict = {}
    text, info = science._run_agent_chat(
        "http://example.invalid",
        "k",
        "m",
        [{"role": "user", "content": "跑一个长任务"}],
        stats=stats,
    )

    # info 原样保留死寂原因, 供 work() 以 error 事件转发
    assert info.get("error") == deadstop_error
    assert info.get("last_response") is None
    # 兜底进度说明: 预算语义 + 接续提示 + 产出文件清单
    assert "轮次预算已用完" in text
    assert "继续" in text
    assert "/tmp/out.txt" in text
    # token 统计照常回填, 前端 usage 展示不受截停影响
    assert stats["completion_tokens"] == 7
    assert stats["prompt_tokens"] == 11


def test_no_tools_deadstop_still_raises(monkeypatch):
    """无工具轨迹也无正文的彻底死响应保持 RuntimeError, 调用方按失败呈现。"""

    import sigmaflow.agent.agent as agent_module
    import sigmaflow.server.science as science

    class _EmptyAgent:
        def __init__(self, **_kw):
            self.compactor = types.SimpleNamespace(last_meta=None)
            self.client = types.SimpleNamespace(timeout=90)
            self.client = types.SimpleNamespace(timeout=90)

        def __call__(self, _messages, is_print=False, max_turn=None, **_kw):
            return {
                "config": {},
                "messages": [],
                "last_response": None,
                "cost_tokens": 0,
                "completion_tokens": 0,
                "prompt_tokens": 0,
                "last_prompt_tokens": 0,
                "cache_read_tokens": 0,
                "cost_time": 0.0,
                "used_tools": [],
                "used_skills": [],
                "deliverables": [],
                "error": None,
            }

    monkeypatch.setattr(agent_module, "Agent", _EmptyAgent)
    try:
        science._run_agent_chat(
            "http://example.invalid", "k", "m", [{"role": "user", "content": "你好"}]
        )
    except RuntimeError as err:
        assert "没有返回内容" in str(err)
    else:
        raise AssertionError("彻底死响应应抛 RuntimeError")


def _mk_turn(reasoning=None, key="reasoning", n_calls=0, content=None):
    """构造 info["messages"] 里一轮 assistant 记录(与流式分支写回的形态一致)。"""
    m: dict = {"role": "assistant"}
    if content is not None:
        m["content"] = content
    if reasoning:
        m[key] = reasoning
    if n_calls:
        m["tool_calls"] = [{"id": f"c{i}"} for i in range(n_calls)]
    return m


def test_blocks_interleave_think_tool_turns():
    """思考块按轮次与工具块交错, 末轮思考紧贴正文之前, 与流式渲染顺序一致。"""
    import sigmaflow.server.science as science

    info = {
        "used_tools": [
            ("bash", {"command": "echo 1"}, "1"),
            ("bash", {"command": "echo 2"}, "2"),
            ("bash", {"command": "echo 3"}, "3"),
        ],
        "messages": [
            {"role": "user", "content": "跑三步"},
            _mk_turn("第一二步一起规划", n_calls=2),
            _mk_turn("再补第三步", key="reasoning_content", n_calls=1),
        ],
        "last_reasoning": "最后总结一下",
        "last_response": "三步完成",
    }
    blocks = science._blocks_from_agent_info(info)
    assert [b["t"] for b in blocks] == [
        "think",
        "tool",
        "tool",
        "think",
        "tool",
        "think",
        "text",
    ]
    # think 块是 {t,x} 压缩格式, 与前端存档块同构(不是 r 字段)
    assert blocks[0]["x"] == "第一二步一起规划"
    assert blocks[1]["r"] == "1" and blocks[1]["n"] == "bash"
    assert blocks[2]["r"] == "2"
    assert blocks[3]["x"] == "再补第三步"
    assert blocks[4]["r"] == "3"
    assert blocks[5]["x"] == "最后总结一下"
    assert blocks[6]["x"] == "三步完成"


def test_blocks_support_anthropic_thinking_blocks():
    """anthropic 形态的轮记录: content 列表里的 thinking/tool_use 内容块。"""
    import sigmaflow.server.science as science

    info = {
        "used_tools": [("read", {"path": "/a"}, "abc")],
        "messages": [
            {
                "role": "assistant",
                "content": [
                    {"type": "thinking", "thinking": "先用想一下"},
                    {"type": "tool_use", "id": "t1"},
                ],
            }
        ],
        "last_response": "done",
    }
    blocks = science._blocks_from_agent_info(info)
    assert [b["t"] for b in blocks] == ["think", "tool", "text"]
    assert blocks[0]["x"] == "先用想一下"


def test_blocks_keep_leftover_tools_on_count_mismatch():
    """轮次调用数与执行序失配时不丢工具, 剩余部分按原序补齐。"""
    import sigmaflow.server.science as science

    info = {
        "used_tools": [
            ("bash", {"command": "echo 1"}, "1"),
            ("bash", {"command": "echo 2"}, "2"),
        ],
        "messages": [_mk_turn("只声明了一个调用", n_calls=1)],
        "last_response": "ok",
    }
    blocks = science._blocks_from_agent_info(info)
    assert [b["t"] for b in blocks] == ["think", "tool", "tool", "text"]
    assert blocks[2]["r"] == "2"
