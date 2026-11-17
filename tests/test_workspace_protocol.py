"""S5: Workspace 协议契约测试 — 换装新 ComfyUI_frontend 产物后的兼容闸门。

覆盖前端赖以工作的核心端点(object_info/prompt/queue/history/userdata/
system_stats/主题桥)。上游同步 SOP(SIGMAFLOW_SYNC.md)要求: 替换 dist 后
本文件全绿方可入库。
"""

import json

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    home = tmp_path_factory.mktemp("s5-home")
    import os

    os.environ["SIGMAFLOW_HOME"] = str(home)
    os.environ["SIGMAFLOW_SCIENCE_DIR"] = str(home / "science")
    os.environ.pop("SIGMAFLOW_MULTI_USER", None)
    from sigmaflow.cmd import build_server

    app = build_server(None)
    # workspace 常驻 worker 在 startup 事件里启动; TestClient 上下文触发
    with TestClient(app) as c:
        yield c
    os.environ.pop("SIGMAFLOW_HOME")
    os.environ.pop("SIGMAFLOW_SCIENCE_DIR")


class TestObjectInfo:
    def test_200_and_sigmaflow_nodes_present(self, client):
        r = client.get("/workspace/api/object_info")
        assert r.status_code == 200
        data = r.json()
        # SigmaFlow 管线节点必须暴露给编辑器
        for node in ("LLMNode", "LoopNode"):
            assert node in data, f"节点 {node} 缺失于 object_info"
        # 每个节点定义具备 ComfyUI 前端要求的结构面
        llm = data["LLMNode"]
        assert "input" in llm and "output" in llm

    def test_single_node_query(self, client):
        r = client.get("/workspace/api/object_info", params={"node": "LLMNode"})
        assert r.status_code == 200


class TestSystemStats:
    def test_shape(self, client):
        r = client.get("/workspace/api/system_stats")
        assert r.status_code == 200
        sysinfo = r.json()["system"]
        for key in ("os", "comfyui_version", "python_version"):
            assert key in sysinfo


class TestQueueAndHistory:
    def test_queue_empty_shape(self, client):
        r = client.get("/workspace/api/queue")
        assert r.status_code == 200
        q = r.json()
        assert "queue_running" in q and "queue_pending" in q

    def test_history_shape(self, client):
        # 契约: history 必带 max_items 查询参数(前端始终如此)
        r = client.get("/workspace/api/history", params={"max_items": 64})
        assert r.status_code == 200
        assert isinstance(r.json(), dict)


class TestPrompt:
    def test_prompt_rejects_invalid(self, client):
        r = client.post("/workspace/api/prompt", json={"garbage": True})
        assert r.status_code in (400, 422), "畸形 prompt 应被拒"

    def test_prompt_accepts_simple_graph(self, client):
        graph = {
            "id": "contract-test",
            "nodes": [
                {
                    "id": 1,
                    "type": "LLMNode",
                    "pos": [0, 0],
                    "widgets_values": ["hello contract"],
                }
            ],
            "links": [],
        }
        # 契约: prompt 载荷必含 extra_data(前端始终携带)
        r = client.post(
            "/workspace/api/prompt",
            json={
                "prompt": graph,
                "client_id": "contract",
                "extra_data": {},
            },
        )
        assert r.status_code in (200, 400, 422), r.text[:200]
        assert r.status_code != 500


class TestUserdataRoundtrip:
    def test_save_and_read_workflow(self, client):
        payload = {"nodes": [{"id": 1, "type": "LLMNode"}], "links": []}
        r = client.post(
            "/workspace/api/userdata/workflows/contract-flow.json",
            headers={
                "Content-Type": "application/json",
                "Overwrite-If-Exists": "true",
            },
            content=json.dumps(payload),
        )
        assert r.status_code == 200, r.text[:200]
        r2 = client.get("/workspace/api/userdata/workflows/contract-flow.json")
        assert r2.status_code == 200
        assert r2.json() == payload

    def test_v2_list(self, client):
        r = client.get("/workspace/api/v2/userdata", params={"path": "workflows"})
        assert r.status_code == 200

    def test_missing_404(self, client):
        r = client.get("/workspace/api/userdata/workflows/__none__.json")
        assert r.status_code == 404


class TestThemeBridge:
    def test_user_css_served_with_theme(self, client):
        r = client.get("/workspace/api/userdata/user.css")
        assert r.status_code == 200
        body = r.text
        assert "--p-primary-color" in body and "#6c6ab2" in body


class TestStaticDist:
    def test_index_html_mounted(self, client):
        r = client.get("/workspace/")
        assert r.status_code == 200
        assert "vue-app" in r.text
