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
