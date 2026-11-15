"""P4: mod 贡献流水线节点类型 — 注册/匹配/卸载回收。"""

from sigmaflow.server.mods import NodeContribService


def test_node_module_registration_and_dispose(tmp_path):
    node_file = tmp_path / "node_demo.py"
    node_file.write_text(
        "from sigmaflow.nodes.base import Base\n"
        "\n"
        "\n"
        "class DemoNode(Base):\n"
        "    @staticmethod\n"
        "    def match(conf):\n"
        '        return conf.get("type") == "demo-mod"\n',
        encoding="utf-8",
    )
    svc = NodeContribService()
    from sigmaflow.nodes.base import Base

    base_count = len(Base.registered_nodes)
    added = svc.register_module(node_file, "test-mod")
    assert added == ["DemoNode"]
    assert len(Base.registered_nodes) == base_count + 1
    # create 按 match 分发到新节点
    node = Base.create("demo1", {"type": "demo-mod", "next": []}, graph=None)
    assert type(node).__name__ == "DemoNode"
    # 卸载回收
    gone = svc.dispose_owner("test-mod")
    assert gone == ["DemoNode"]
    assert not any(c.__name__ == "DemoNode" for c in Base.registered_nodes)
    assert len(Base.registered_nodes) == base_count


def test_describe(tmp_path):
    svc = NodeContribService()
    assert svc.describe() == []
