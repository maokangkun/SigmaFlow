"""bound system 组装与历史会话读时兜底的契约。

_bind_main_system 是执行路径与 conversation.content 惰性兜底共用的
组装函数: 历史会话(部署前完成轮次, 无 systemPrompt 属性)打开 Trace
时同样能看到 #0 系统条(按当前配置组装的近似 bound)。
"""

from sigmaflow.server.science import ScienceAPI, _bind_main_system


def test_agent_model_max_len_litellm_first(monkeypatch):
    """agent 侧模型上下文统一走 litellm(conf 表已删)。"""
    import sys
    import types as _t

    fake_litellm = _t.SimpleNamespace(
        model_cost={"gpt-x": {"max_input_tokens": 258000}}
    )
    monkeypatch.setitem(sys.modules, "litellm", fake_litellm)
    from sigmaflow.agent.agent import _model_max_len

    assert _model_max_len("GPT-X") == 258000
    assert _model_max_len("unknown-model") == 131072
    assert _model_max_len("") == 131072


def test_bind_main_system_plain():
    base = _bind_main_system(None, False, "")
    assert "You are" in base or base  # 内置提示词存在
    assert "# Working directory" not in base


def test_bind_main_system_with_workdir():
    bound = _bind_main_system("/tmp/proj", False, "")
    assert "# Working directory" in bound
    assert "/tmp/proj" in bound


def test_bind_main_system_plan_mode_appends():
    base = _bind_main_system(None, False, "")
    plan = _bind_main_system(None, True, "")
    assert len(plan) > len(base)


def test_conversation_system_or_bind_prefers_stored(tmp_path):
    from sigmaflow.server.science import ScienceProjectStore

    store = ScienceProjectStore(storage_dir=str(tmp_path))
    store.conversations["r1"] = {"id": "r1", "content": [], "projectId": None}
    store.conversations["r2"] = {
        "id": "r2",
        "content": [{"role": "user", "content": "q"}],
        "projectId": None,
        "systemPrompt": "REAL PROMPT",
    }
    import types as _t

    fake = _t.SimpleNamespace(project_store=store, model_store=_t.SimpleNamespace(models={}))
    # 有属性用存量
    assert ScienceAPI._conversation_system_or_bind(fake, store.conversations["r2"]) == "REAL PROMPT"
    # 无属性: 惰性组装(非空字符串)而非空
    got = ScienceAPI._conversation_system_or_bind(fake, store.conversations["r1"])
    assert isinstance(got, str) and len(got) > 40


def test_bind_main_system_expands_workdir():
    bound = _bind_main_system("/data/proj-x", False, "")
    assert "run inside the project working directory `/data/proj-x`" in bound
    assert "`{workdir}`" not in bound


def test_stored_prompt_with_literal_workdir_is_rebound(tmp_path):
    from sigmaflow.server.science import ScienceProjectStore

    store = ScienceProjectStore(storage_dir=str(tmp_path))
    # f-string 修复前入库的缺陷属性(字面量未插值)
    store.conversations["r1"] = {
        "id": "r1",
        "content": [{"role": "user", "content": "q"}],
        "projectId": None,
        "systemPrompt": "旧提示 # 工作目录 本次会话绑定项目工作目录 `{workdir}`。",
    }
    import types as _t

    fake = _t.SimpleNamespace(project_store=store, model_store=_t.SimpleNamespace(models={}))
    got = ScienceAPI._conversation_system_or_bind(fake, store.conversations["r1"])
    assert "`{workdir}`" not in got


def test_model_caption_text_model(monkeypatch):
    import sigmaflow.server.science as sci

    monkeypatch.setattr(
        sci, "_litellm_lookup", lambda name: None
    )
    cap = _bind_main_system(None, False, "", "deepseek-v4.1-flash", 1048576)
    assert "# Current model" in cap
    assert "`deepseek-v4.1-flash`, a text-only model" in cap
    assert "1,048,576" in cap


def test_model_caption_multimodal(monkeypatch):
    import sigmaflow.server.science as sci

    monkeypatch.setattr(
        sci, "_litellm_lookup", lambda name: {"supports_vision": True}
    )
    # 窗口查询桩: 避免 litellm 冷导入(重模块, 拖慢测试)
    monkeypatch.setattr(sci, "_model_context_window", lambda name, override=None: 200000)
    cap = _bind_main_system(None, False, "", "vision-x", None)
    assert "multimodal model" in cap
    assert "200,000" in cap


def test_model_caption_absent_without_name():
    assert "# 当前模型" not in _bind_main_system(None, False, "", "")
