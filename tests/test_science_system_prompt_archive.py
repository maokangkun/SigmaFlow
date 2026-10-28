"""会话实发 system 提示词的持久化契约。

work() 在每轮回复后把 agent 实际使用的 bound system(含工作目录/计划
模式/记忆块注入)写进会话属性 systemPrompt 并随 chat.system 推给前端;
Trace 页据此合成 #0 系统消息条。三重契约: 幂等写入、未知会话拒绝、
前端整表归档不会把它抹掉。
"""

from sigmaflow.server.science import ScienceProjectStore


def _store_with_conv(tmp_path):
    store = ScienceProjectStore(storage_dir=str(tmp_path / "s"))
    store.conversations["run-x"] = {
        "id": "run-x",
        "title": "会话",
        "content": [],
        "createdAt": 1,
        "updatedAt": 1,
    }
    return store


def test_set_conversation_system_persists(tmp_path):
    store = _store_with_conv(tmp_path)
    assert store.set_conversation_system("run-x", "You are SigmaFlow.") is True
    # 幂等: 相同文本不改写不落盘
    assert store.set_conversation_system("run-x", "You are SigmaFlow.") is True
    # 未知会话/空文本拒绝
    assert store.set_conversation_system("run-missing", "x") is False
    assert store.set_conversation_system("run-x", "") is False
    # 变更时覆盖
    store.set_conversation_system("run-x", "You are SigmaFlow v2.")
    assert store.conversations["run-x"]["systemPrompt"].startswith("You are SigmaFlow v2")


def test_system_prompt_survives_frontend_upsert(tmp_path):
    from sigmaflow.server.science import ConversationIn

    store = _store_with_conv(tmp_path)
    store.set_conversation_system("run-x", "You are SigmaFlow.")
    # 前端整表归档(upsert 只更新自己认识的键)
    store.upsert_conversation(
        ConversationIn(id="run-x", title="归档标题", content=[
            {"role": "user", "content": "q", "at": 1},
            {"role": "assistant", "content": "a", "at": 2},
        ])
    )
    conv = store.conversations["run-x"]
    assert conv["title"] == "归档标题"
    assert [r["role"] for r in conv["content"]] == ["user", "assistant"]
    # system 属性由服务端持有, 不被前端归档抹掉
    assert conv["systemPrompt"] == "You are SigmaFlow."
