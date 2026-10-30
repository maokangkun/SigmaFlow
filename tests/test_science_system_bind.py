"""bound system 组装与历史会话读时兜底的契约。

_bind_main_system 是执行路径与 conversation.content 惰性兜底共用的
组装函数: 历史会话(部署前完成轮次, 无 systemPrompt 属性)打开 Trace
时同样能看到 #0 系统条(按当前配置组装的近似 bound)。
"""

from sigmaflow.server.science import (
    ScienceAPI,
    _bind_main_system,
    _system_prompt_template,
)


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
    # 目录段始终存在: 未绑定项目时回落服务进程工作目录
    assert "# Directories" in base
    assert "The user's home directory is" in base
    assert "{workdir}" not in base and "{home}" not in base


def test_bind_main_system_with_workdir():
    bound = _bind_main_system("/tmp/proj", False, "")
    assert "# Directories" in bound
    assert "/tmp/proj" in bound
    # 只在工作目录内操作的约束语
    assert "operate only inside" in bound


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
    assert "The active project working directory is `/data/proj-x`" in bound
    assert "operate only inside `/data/proj-x`" in bound
    assert "{workdir}" not in bound and "{home}" not in bound


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


def test_template_skills_dir_placeholder_single_source():
    """模板反替走 agent.tools 单点(skills_dir_field/skills_dir_from_listing),
    措辞或 # Skills 标题调整时仅同步这两个函数即可, 无需改模板代码。"""
    import os

    import sigmaflow.server.science as sci
    from sigmaflow.agent import tools as agent_tools

    tpl = _system_prompt_template()
    assert "Skills dir: {skills_dir}" in tpl
    assert "agent at {workdir}" in tpl
    # 占位反替后预览不含运行时真路径(服务 cwd 或数据根)
    from sigmaflow.agent.conf import WORKDIR

    assert str(WORKDIR) not in tpl
    real_dir = agent_tools.skill_loader.skills_dir
    assert str(real_dir) not in tpl
    # 单点解析函数能从 bind 文本中找回真值
    bound = _bind_main_system(None, False, "", "", None)
    assert agent_tools.skills_dir_from_listing(bound) == str(real_dir)


def test_conversation_page_rows_byte_cap():
    """会话分页: limit 条为界, 服务端按 shape 后累计字节提前收刀(至少 1 条)。

    单条 600KB 级的存量消息曾让 30 条一页拖到十几兆; tool.r 已被 shape 截短,
    巨型字节实际来自 reasoning/content 等未被截短的字段。"""
    import json

    from sigmaflow.server.science import (
        _CONVERSATION_PAGE_MAX_BYTES,
        _conversation_page_rows,
    )

    small = [{"role": "user", "content": "x" * 100} for _ in range(30)]
    assert len(_conversation_page_rows(small, 0, 30)) == 30

    msg = {"role": "assistant", "content": "c" * 600_000}
    page = _conversation_page_rows([msg] * 30, 0, 30)
    total = sum(len(json.dumps(r, ensure_ascii=False).encode()) for r in page)
    assert len(page) <= 8
    assert total < _CONVERSATION_PAGE_MAX_BYTES + 700_000

    # 游标推进: 循环以 rows.length 前进, 有限页内走完全存档
    off, pages = 0, 0
    while off < 30:
        batch = _conversation_page_rows([msg] * 30, off, 30)
        assert batch, "空页会死循环"
        off += len(batch)
        pages += 1
        assert pages <= 40

    # 巨条(单条>上限)至少放行 1 条, 下一页从其后继续
    big = {"role": "assistant", "reasoning": "z" * 2_500_000, "content": "c" * 2_500_000}
    p1 = _conversation_page_rows([big, {"role": "user", "content": "ok"}], 0, 30)
    p2 = _conversation_page_rows([big, {"role": "user", "content": "ok"}], 1, 30)
    assert len(p1) == 1 and len(p2) == 1 and p2[0]["content"] == "ok"
