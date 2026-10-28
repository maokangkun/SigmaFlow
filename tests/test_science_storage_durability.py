"""存储耐久性契约: 会话库不允许"一次错误 = 全库蒸发"。

三类历史丢失路径的防线:

- _save 非原子: 半截 JSON 在 _load 时整库判废(断电/被杀时机不好
  相当于丢掉全部 161 个会话) → _atomic_save 用 tmp+rename 保证
  磁盘上任意时刻只有完整旧库或完整新库, 上一版本轮转 .bak;
- 主库损坏无回退: _load 现在主库优先, 损坏/缺失时回退 .bak;
- 投递≠落库缝隙: _conversation_replied 是 work() 投递后观察窗的
  判据——send 即落 user 行, 尾部先遇 assistant 说明本轮已归档。
"""

import json

from sigmaflow.server.science import ScienceProjectStore


def _proj_store(tmp_path):

    store = ScienceProjectStore(storage_dir=str(tmp_path / "s"))
    store.conversations["run-1"] = {
        "id": "run-1",
        "title": "会话一",
        "content": [{"role": "user", "content": "hi", "at": 1}],
        "createdAt": 1,
        "updatedAt": 1,
    }
    return store


def test_atomic_save_rotates_bak(tmp_path):
    store = _proj_store(tmp_path)
    store._save()  # v1: 只有 run-1
    store.conversations["run-2"] = {
        "id": "run-2",
        "title": "会话二",
        "content": [],
        "createdAt": 2,
        "updatedAt": 2,
    }
    store._save()  # v2: run-1 + run-2
    main = json.loads((tmp_path / "s" / "projects.json").read_text())
    bak = json.loads((tmp_path / "s" / "projects.json.bak").read_text())
    assert set(main["conversations"]) == {"run-1", "run-2"}
    assert set(bak["conversations"]) == {"run-1"}  # .bak 是上一版本
    assert not (tmp_path / "s" / "projects.json.tmp").exists()  # 不留残骸


def test_load_falls_back_to_bak_when_main_corrupt(tmp_path):
    store = _proj_store(tmp_path)
    store._save()
    store.conversations["run-2"] = {
        "id": "run-2",
        "title": "会话二",
        "content": [],
        "createdAt": 2,
        "updatedAt": 2,
    }
    store._save()
    # 模拟非原子年代留下的半截库(或外手编辑写坏)
    (tmp_path / "s" / "projects.json").write_text(
        '{"projects": {}, "conversations": {"run-1": {"ti', encoding="utf-8"
    )
    store2 = ScienceProjectStore(storage_dir=str(tmp_path / "s"))
    # 主库损坏 → 从 .bak 恢复上一版本(至少保住 run-1, 而不是空库)
    assert set(store2.conversations) == {"run-1"}
    # 恢复后的继续写入回到健康轨道
    store2._save()
    assert json.loads((tmp_path / "s" / "projects.json").read_text())["conversations"]


def test_model_store_survives_corruption(tmp_path):
    from sigmaflow.server.science import ScienceModelStore

    store = ScienceModelStore(storage_dir=str(tmp_path / "m"))
    store.providers["pv-x"] = {"id": "pv-x", "name": "p", "baseUrl": "http://x"}
    store._save()
    store.providers["pv-y"] = {"id": "pv-y", "name": "q", "baseUrl": "http://y"}
    store._save()  # 第二次 save 才轮转出 .bak(首次无上一版本可言)
    (tmp_path / "m" / "models.json").write_text("not json at all", encoding="utf-8")
    store2 = ScienceModelStore(storage_dir=str(tmp_path / "m"))
    # 主库损坏 → 从 .bak 恢复上一版本: pv-x 在, 后写的 pv-y 已随损坏的主库失去
    assert "pv-x" in store2.providers
    assert "pv-y" not in store2.providers


def test_leftover_tmp_poisons_nothing(tmp_path):
    store = _proj_store(tmp_path)
    store._save()
    # 上一次进程死在 tmp 阶段留下的残骸
    (tmp_path / "s" / "projects.json.tmp").write_text("{broken", encoding="utf-8")
    store2 = ScienceProjectStore(storage_dir=str(tmp_path / "s"))
    assert "run-1" in store2.conversations  # tmp 不参与 load
    store2._save()
    assert "run-1" in json.loads(
        (tmp_path / "s" / "projects.json").read_text()
    )["conversations"]


def test_conversation_replied_semantics():
    from sigmaflow.server.science import _conversation_replied

    class _Store:
        def __init__(self, content=None, convs=None):
            self.conversations = convs if convs is not None else {
                "r": {"id": "r", "content": content if content is not None else []}
            }

    # 空档/无内容: 本轮未归档
    assert _conversation_replied(_Store(), "r") is False
    assert _conversation_replied(_Store(), "missing") is False
    # 尾部是 user(send 已落): 未归档
    assert _conversation_replied(_Store([{"role": "user", "content": "q"}]), "r") is False
    # user 后面有了 assistant: 已归档
    assert (
        _conversation_replied(
            _Store(
                [
                    {"role": "assistant", "content": "旧回复"},
                    {"role": "user", "content": "新问题"},
                    {"role": "assistant", "content": "新回复", "blocks": []},
                ]
            ),
            "r",
        )
        is True
    )
    # 中断形态: user 之后没有 assistant(又问了一句/中断行未落)
    assert (
        _conversation_replied(
            _Store(
                [
                    {"role": "assistant", "content": "旧回复"},
                    {"role": "user", "content": "新问题"},
                ]
            ),
            "r",
        )
        is False
    )
    # 非法行容错: 倒序扫跳过垃圾行
    assert (
        _conversation_replied(
            _Store([{"role": "user", "content": "q"}, "garbage", {"role": "assistant", "content": "a"}]),
            "r",
        )
        is True
    )
