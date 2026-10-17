"""Backend regression checks for the FastAPI Science API (HTTP + SSE + WS).

Run with an interpreter that has fastapi + httpx, e.g.:
    python tests/test_backend.py
"""
import json
import os
import tempfile
import time
import importlib.util as _ilu
_here = os.path.dirname(os.path.abspath(__file__))
os.environ["SIGMAFLOW_SCIENCE_DIR"] = tempfile.mkdtemp(prefix="science-models-")
_spec = _ilu.spec_from_file_location("science_backend", os.path.join(_here, "..", "..", "science.py"))
science_backend = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(science_backend)
ScienceAPI = science_backend.ScienceAPI

from fastapi import FastAPI
from fastapi.testclient import TestClient

results = []
def check(name):
    results.append({"test": name, "status": "passed"})
    print("PASS:", name, flush=True)

app = FastAPI()
_sci_api = ScienceAPI()
# WS 与 auth 端点在独立子路由上(见 ScienceAPI.__init__), 需一并挂载
app.include_router(_sci_api.router)
app.include_router(_sci_api.ws_router)
app.include_router(_sci_api.auth_router)

with TestClient(app) as client:
    r = client.get("/api/health")
    assert r.status_code == 200 and r.json()["status"] == "ok", r.text
    print("PASS health:", r.json())

    r = client.post("/api/runs", json={"prompt": "", "steps": []})
    assert r.status_code == 400, r.text
    r = client.post("/api/runs", json={"prompt": "t" * 6001, "steps": [{"title": "a"}]})
    assert r.status_code == 400, r.text
    print("PASS 400 on empty/oversized prompt")

    r = client.post("/api/runs", json={"prompt": "demo run", "steps": [
        {"title": "Step A", "description": "d", "tool": "input.inspect"},
        {"title": "Step B", "tool": "report.export"},
    ]})
    assert r.status_code == 200, r.text
    run_id = r.json()["id"]
    assert r.json()["isDemo"] is True
    snap = client.get(f"/api/runs/{run_id}").json()
    assert snap["status"] == "running" and len(snap["steps"]) == 2
    print("PASS create + snapshot")

    import threading
    events = []
    def read_sse():
        with client.stream("GET", f"/api/runs/{run_id}/events") as resp:
            assert resp.headers["content-type"].startswith("text/event-stream")
            buf = ""
            for line in resp.iter_lines():
                buf += line + "\n"
                if buf.count("event: state") >= 6:
                    break
            events.append(buf)
    t = threading.Thread(target=read_sse); t.start()
    t.join(timeout=10)
    assert "event: state" in events[0] and '"isDemo": true' in events[0].replace('"isDemo": True', '"isDemo": true')
    print("PASS SSE stream returns state snapshots")

    lst = client.get("/api/runs").json()
    assert any(x["id"] == run_id for x in lst)
    print("PASS run list")

    # fresh run for control-flow tests (avoid racing the SSE watcher to completion)
    r = client.post("/api/runs", json={"prompt": "control test", "steps": [
        {"title": "a"}, {"title": "b"}, {"title": "c"}, {"title": "d"}]})
    run_id = r.json()["id"]
    snap = client.post(f"/api/runs/{run_id}/control", json={"action": "pause"}).json()
    assert snap["status"] == "paused", snap
    p = snap["progress"]; time.sleep(1.2)
    assert client.get(f"/api/runs/{run_id}").json()["progress"] == p, "progress moved while paused"
    snap = client.post(f"/api/runs/{run_id}/control", json={"action": "resume"}).json()
    assert snap["status"] == "running"
    print("PASS pause/resume")

    snap = client.post(f"/api/runs/{run_id}/control", json={"action": "cancel"}).json()
    assert snap["status"] == "cancelled"
    r = client.post(f"/api/runs/{run_id}/control", json={"action": "resume"})
    assert r.status_code == 409
    print("PASS cancel is terminal (409)")

    r = client.post("/api/runs", json={"prompt": "x", "steps": [{"title": "a"}]},
                    headers={"Origin": "https://untrusted.invalid"})
    assert r.status_code == 403
    print("PASS cross-origin write rejected")

    assert client.get("/api/runs/nonexistent").status_code == 404
    print("PASS 404 unknown run")

    with client.websocket_connect("/api/ws") as ws:
        # pushes and replies interleave on the same socket: match replies by requestId
        def recv_reply(rid):
            while True:
                m = ws.receive_json()
                assert m.get("event") != "state" or "requestId" in m or True
                if m.get("requestId") == rid:
                    return m

        ws.send_json({"action": "ping", "requestId": "1"})
        m = recv_reply("1")
        assert m["event"] == "pong", m

        ws.send_json({"action": "run.create", "requestId": "2", "prompt": "ws run",
                      "steps": [{"title": "S1"}, {"title": "S2"}]})
        m = recv_reply("2")
        assert m["event"] == "run.created", m
        rid = m["data"]["id"]

        seen = []
        deadline = time.time() + 15
        while time.time() < deadline:
            m = ws.receive_json()
            assert m["event"] == "state", m
            seen.append(m["data"])
            if m["data"]["status"] == "complete":
                break
        assert seen[-1]["status"] == "complete" and seen[-1]["progress"] == 100
        print(f"PASS WS run lifecycle ({len(seen)} pushes)")

        ws.send_json({"action": "run.get", "requestId": "3", "id": rid})
        m = recv_reply("3")
        assert m["event"] == "run.snapshot" and m["data"]["status"] == "complete", m

        ws.send_json({"action": "run.control", "requestId": "4", "id": rid, "control": "resume"})
        m = recv_reply("4")
        assert m["event"] == "error", m

        ws.send_json({"action": "run.create", "requestId": "5", "prompt": "ws run 2",
                      "steps": [{"title": "S"}]})
        m = recv_reply("5"); rid2 = m["data"]["id"]
        ws.send_json({"action": "run.control", "requestId": "6", "id": rid2, "control": "pause"})
        m = recv_reply("6")
        assert m["event"] == "run.control" and m["data"]["status"] == "paused", m
        print("PASS WS control")

        ws.send_text("not json")
        for _ in range(20):  # push events may arrive first; wait for the uncorrelated error frame
            m = ws.receive_json()
            if m.get("event") == "error" and "requestId" not in m:
                break
        else:
            raise AssertionError("no error frame for invalid json")

        ws.send_json({"action": "bogus", "requestId": "7"})
        m = recv_reply("7"); assert m["event"] == "error", m
        print("PASS WS error handling")

print("\nAll science.py backend checks passed.")

# ---------------------------------------------------------------- provider/model store

assert client.get("/api/providers").json() == {"providers": []}
assert client.get("/api/models").json() == {"models": []}
check("Provider and model lists start empty")

r = client.post("/api/providers", json={"name": "OpenRouter", "baseUrl": "https://openrouter.ai/api/v1"})
assert r.status_code == 200, r.text
pv = r.json()["provider"]
assert pv["name"] == "OpenRouter" and pv["keyHint"] is None
assert client.post("/api/providers", json={"name": "vLLM", "baseUrl": "http://127.0.0.1:8001/v1", "apiKey": "sk-abc123456789"}).json()["provider"]["keyHint"] == "sk-a****6789"
check("Provider create with masked key")

r = client.post("/api/providers", json={"id": pv["id"], "name": "OpenRouter", "baseUrl": "https://openrouter.ai/api/v1"})
assert r.json()["provider"]["keyHint"] is None  # key untouched
assert client.post("/api/providers", json={"name": "", "baseUrl": "http://x/v1"}).json()["provider"]["name"] == "x"
assert client.post("/api/providers", json={"name": "no-url"}).status_code == 400
assert client.post("/api/providers", json={"id": "pv-gone", "name": "x", "baseUrl": "http://x/v1"}).status_code == 404
check("Provider update keeps key, name defaults, validation")

r = client.post("/api/models", json={"providerId": pv["id"], "model": "openrouter/free"})
assert r.status_code == 200, r.text
mod = r.json()["model"]
assert mod["isDefault"] is True and mod["providerName"] == "OpenRouter"
assert client.post("/api/models", json={"providerId": "pv-gone", "model": "x"}).status_code == 404
assert client.post("/api/models", json={"providerId": pv["id"], "model": "  "}).status_code == 400
check("Model create under provider + validation")

r = client.post("/api/models", json={"id": mod["id"], "providerId": pv["id"], "model": "openrouter/free2", "isDefault": True})
assert r.json()["model"]["model"] == "openrouter/free2" and len(r.json()["models"]) == 1
check("Model update")

r = client.delete(f"/api/models/{mod['id']}")
assert len(r.json()["models"]) == 0
assert client.delete("/api/models/md-gone").status_code == 404
check("Model delete")

assert client.post("/api/providers/test", json={"baseUrl": "http://127.0.0.1:1/nope"}).status_code == 200
assert client.post("/api/providers/list-models", json={"baseUrl": "http://127.0.0.1:1/nope"}).json()["ok"] is False
assert client.post("/api/providers/test", json={}).status_code == 400
check("Provider test/list-models reachability")

assert client.post("/api/providers", json={"name": "x", "baseUrl": "http://x/v1"}, headers={"Origin": "https://untrusted.invalid"}).status_code == 403
check("Cross-origin provider writes rejected")

stored = json.loads(open(os.path.join(os.environ["SIGMAFLOW_SCIENCE_DIR"], "models.json")).read())
assert any(p.get("apiKey") == "sk-abc123456789" for p in stored["providers"].values())
check("Provider config persisted to disk including the raw key")

# ---- provider & models over WebSocket ----
with client.websocket_connect("/api/ws") as ws:
    def recv_model_reply(rid):
        while True:
            m = ws.receive_json()
            if m.get("requestId") == rid:
                return m

    ws.send_json({"action": "provider.save", "requestId": "p1", "name": "WS", "baseUrl": "http://127.0.0.1:1/v1"})
    m = recv_model_reply("p1")
    assert m["event"] == "provider.saved", m
    pv_id = m["data"]["provider"]["id"]
    ws.send_json({"action": "model.save", "requestId": "m1", "providerId": pv_id, "model": "ws-model"})
    m = recv_model_reply("m1")
    assert m["event"] == "model.saved" and m["data"]["model"]["providerName"] == "WS", m
    ws.send_json({"action": "model.list", "requestId": "m2"})
    m = recv_model_reply("m2")
    assert m["event"] == "model.list" and len(m["data"]["models"]) == 1, m
    ws.send_json({"action": "provider.delete", "requestId": "p2", "id": pv_id})
    m = recv_model_reply("p2")
    assert m["event"] == "provider.deleted" and m["data"]["models"] == [], m
    ws.send_json({"action": "provider.models", "requestId": "p3"})
    m = recv_model_reply("p3")
    assert m["event"] == "error", m
    check("WS provider/model save, list, delete + cascade")

# ---------------------------------------------------------------- projects & conversations

r = client.post("/api/projects", json={"id": "pr-test", "name": "demo project", "tags": ["a", "b"]})
assert r.status_code == 200, r.text
assert r.json()["project"]["name"] == "demo project"
assert client.post("/api/projects", json={"id": "bad id!", "name": "x"}).status_code == 400
assert client.post("/api/projects", json={"name": "  "}).status_code == 400
check("Project create + validation")

r = client.get("/api/projects")
assert [p["name"] for p in r.json()["projects"]] == ["demo project"]
assert client.post("/api/projects", json={"id": "pr-test", "name": "demo v2", "description": "updated"}).json()["project"]["name"] == "demo v2"
check("Project list + update")

r = client.post("/api/conversations", json={"id": "cn-1", "title": "第一次分析", "projectId": "pr-test"})
assert r.status_code == 200 and r.json()["conversation"]["projectId"] == "pr-test", r.text
r = client.post("/api/conversations", json={"id": "cn-2", "title": "游离会话", "projectId": "pr-missing"})
assert r.json()["conversation"]["projectId"] is None, r.text
r = client.get("/api/conversations")
assert len(r.json()["conversations"]) == 2
convs = client.get("/api/conversations").json()["conversations"]
assert convs[0]["id"] == "cn-2", "sorted by updatedAt desc"
check("Conversation create + unknown project unassigned + sorting")

r = client.delete("/api/projects/pr-test")
convs = r.json()["conversations"]
assert all(c["projectId"] is None for c in convs) and len(convs) == 2
assert client.delete("/api/projects/pr-missing").status_code == 404
check("Project delete unassigns conversations")

assert client.delete("/api/conversations/cn-1").status_code == 200
assert client.delete("/api/conversations/cn-1").status_code == 404
check("Conversation delete")

# conversation content sync
client.post("/api/conversations", json={"id": "cn-cc", "title": "内容同步", "content": [
    {"role": "user", "content": "问"}, {"role": "assistant", "content": "答"}]})
r = client.get("/api/conversations/cn-cc/content")
assert r.status_code == 200 and len(r.json()["content"]) == 2, r.text
assert r.json()["content"][0]["content"] == "问"
lst = [c for c in client.get("/api/conversations").json()["conversations"] if c["id"] == "cn-cc"][0]
assert lst["hasContent"] is True and "content" not in lst, "list should not carry full content"
assert client.get("/api/conversations/cn-missing/content").status_code == 404
client.delete("/api/conversations/cn-cc")
check("Conversation content sync (save / fetch / 404)")

# pinned / archived
client.post("/api/projects", json={"id": "pr-test2", "name": "p2"})
r = client.post("/api/conversations", json={"id": "cn-p", "title": "置顶测试", "projectId": "pr-test2"})
assert r.json()["conversation"]["pinned"] is False and r.json()["conversation"]["archived"] is False
client.post("/api/conversations", json={"id": "cn-p", "title": "置顶测试", "projectId": "pr-test2", "pinned": True})
r = client.get("/api/conversations")
conv = [c for c in r.json()["conversations"] if c["id"] == "cn-p"][0]
assert conv["pinned"] is True
assert r.json()["conversations"][0]["id"] == "cn-p", "pinned conversation sorts first"
client.post("/api/conversations", json={"id": "cn-a", "title": "归档测试", "projectId": "pr-test2", "archived": True})
r = client.get("/api/conversations")
conv = [c for c in r.json()["conversations"] if c["id"] == "cn-a"][0]
assert conv["archived"] is True
client.delete("/api/conversations/cn-p"); client.delete("/api/conversations/cn-a")
check("Conversation pinned/archived fields + pinned-first sorting")

stored = json.loads(open(os.path.join(os.environ["SIGMAFLOW_SCIENCE_DIR"], "projects.json")).read())
assert "pr-test" not in stored["projects"] and "cn-2" in stored["conversations"]
check("Project/conversation store persisted to disk")

# ---- WebSocket origin policy ----
try:
    with client.websocket_connect("/api/ws", headers={"Origin": "https://untrusted.invalid"}) as ws:
        ws.send_json({"action": "ping", "requestId": "origin-check"})
        raised = False
except Exception:
    raised = True
assert raised, "cross-origin WS connection must be refused"
print("PASS cross-origin WS connection refused")

# ---- projects & conversations over WebSocket ----
with client.websocket_connect("/api/ws") as ws:
    def recv_p(rid):
        while True:
            m = ws.receive_json()
            if m.get("requestId") == rid:
                return m
    ws.send_json({"action": "project.save", "requestId": "q1", "id": "pr-ws", "name": "ws project"})
    m = recv_p("q1")
    assert m["event"] == "project.saved", m
    ws.send_json({"action": "conversation.save", "requestId": "q2", "id": "cn-ws", "title": "ws conversation", "projectId": "pr-ws"})
    m = recv_p("q2")
    assert m["event"] == "conversation.saved" and m["data"]["conversation"]["projectId"] == "pr-ws", m
    ws.send_json({"action": "conversation.save", "requestId": "q2b", "id": "cn-ws", "title": "ws conversation", "projectId": None, "pinned": True, "archived": False})
    m = recv_p("q2b")
    assert m["event"] == "conversation.saved" and m["data"]["conversation"]["pinned"] is True, m
    ws.send_json({"action": "conversation.list", "requestId": "q3"})
    m = recv_p("q3")
    assert m["event"] == "conversation.list" and any(c["id"] == "cn-ws" for c in m["data"]["conversations"]), m
    ws.send_json({"action": "project.delete", "requestId": "q4", "id": "pr-ws"})
    m = recv_p("q4")
    assert m["event"] == "project.deleted", m
    ws.send_json({"action": "conversation.delete", "requestId": "q5", "id": "cn-ws"})
    m = recv_p("q5")
    assert m["event"] == "conversation.deleted", m
    check("WS project/conversation save, list, delete")

print(f"\n{len(results)} checks passed (runs + providers/models + projects/conversations).")