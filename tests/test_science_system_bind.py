"""bound system 组装与历史会话读时兜底的契约。

_bind_main_system 是执行路径与 conversation.content 惰性兜底共用的
组装函数: 历史会话(部署前完成轮次, 无 systemPrompt 属性)打开 Trace
时同样能看到 #0 系统条(按当前配置组装的近似 bound)。
"""

from sigmaflow.server.science import ScienceAPI, _bind_main_system


def test_bind_main_system_plain():
    base = _bind_main_system(None, False, "")
    assert "You are" in base or base  # 内置提示词存在
    assert "# 工作目录" not in base


def test_bind_main_system_with_workdir():
    bound = _bind_main_system("/tmp/proj", False, "")
    assert "# 工作目录" in bound
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
    fake = type("F", (), {})()
    fake.project_store = store
    # 有属性用存量
    assert ScienceAPI._conversation_system_or_bind(fake, store.conversations["r2"]) == "REAL PROMPT"
    # 无属性: 惰性组装(非空字符串)而非空
    got = ScienceAPI._conversation_system_or_bind(fake, store.conversations["r1"])
    assert isinstance(got, str) and len(got) > 40
