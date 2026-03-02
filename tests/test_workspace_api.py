import os
from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from sigmaflow.server import workspace


@pytest.fixture(autouse=True)
def temp_userdata_dir(monkeypatch, tmp_path):
    """Monkeypatch get_userdata_dir to use a temporary directory for the duration of the test."""
    monkeypatch.setattr(workspace, "get_userdata_dir", lambda: str(tmp_path))
    # ensure the folder exists
    os.makedirs(str(tmp_path), exist_ok=True)
    yield


def create_file(path, content=""):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(content)


def test_list_userdata_basic(tmp_path):
    # prepare a small hierarchy
    base = tmp_path / "sub"
    base.mkdir()
    (base / "file1.txt").write_text("hello")
    nested = base / "nested"
    nested.mkdir()
    (nested / "file2.txt").write_text("world")

    api = workspace.WorkspaceAPI(pipeline_manager=None)
    app = FastAPI()
    app.include_router(api.router)
    client = TestClient(app)

    # missing dir parameter should return 400
    r = client.get("/workspace/api/userdata")
    assert r.status_code == 400

    # list non-recursively
    r = client.get("/workspace/api/userdata", params={"dir": "sub"})
    assert r.status_code == 200
    assert r.json() == ["file1.txt"]

    # request recursion
    r = client.get("/workspace/api/userdata", params={"dir": "sub", "recurse": "true"})
    assert r.status_code == 200
    data = r.json()
    assert "file1.txt" in data
    assert "nested/file2.txt" in data

    # request full_info - expect dictionaries
    r = client.get(
        "/workspace/api/userdata",
        params={"dir": "sub", "recurse": "true", "full_info": "true"},
    )
    assert r.status_code == 200
    info_list = r.json()
    assert isinstance(info_list[0], dict)
    assert "path" in info_list[0]

    # split option should break into list components when not full_info
    r = client.get(
        "/workspace/api/userdata",
        params={"dir": "sub", "split": "true"},
    )
    assert r.status_code == 200
    split_entry = r.json()[0]
    assert isinstance(split_entry, list)
    assert split_entry[0] == "file1.txt"


def test_list_userdata_errors(tmp_path):
    api = workspace.WorkspaceAPI(pipeline_manager=None)
    app = FastAPI()
    app.include_router(api.router)
    client = TestClient(app)

    # directory does not exist
    r = client.get("/workspace/api/userdata", params={"dir": "nonexistent"})
    assert r.status_code == 404

    # path is a file
    file_path = tmp_path / "foo.txt"
    file_path.write_text("x")
    r = client.get("/workspace/api/userdata", params={"dir": "foo.txt"})
    assert r.status_code == 400


def test_delete_userdata(tmp_path):
    # create file and attempt deletion
    api = workspace.WorkspaceAPI(pipeline_manager=None)
    app = FastAPI()
    app.include_router(api.router)
    client = TestClient(app)

    # create file under userdata
    userdata = Path(workspace.get_userdata_dir())
    f = userdata / "to_delete.txt"
    os.makedirs(userdata, exist_ok=True)
    f.write_text("bye")

    r = client.delete("/workspace/api/userdata/to_delete.txt")
    assert r.status_code == 204
    # file should be gone
    assert not f.exists()

    # deleting again yields 404
    r = client.delete("/workspace/api/userdata/to_delete.txt")
    assert r.status_code == 404

    # not a file (directory)
    d = userdata / "somedir"
    d.mkdir(exist_ok=True)
    r = client.delete("/workspace/api/userdata/somedir")
    assert r.status_code == 400


def test_missing_index_json_returns_empty(tmp_path):
    api = workspace.WorkspaceAPI(pipeline_manager=None)
    app = FastAPI()
    app.include_router(api.router)
    client = TestClient(app)

    # no file exists yet
    r = client.get("/workspace/api/userdata/workflows/.index.json")
    assert r.status_code == 200
    assert r.json() == {}

    # after saving some content, it returns that
    userdata = Path(workspace.get_userdata_dir())
    idx = userdata / "workflows" / ".index.json"
    idx.parent.mkdir(exist_ok=True)
    idx.write_text('{"favorites":["a"]}')
    r = client.get("/workspace/api/userdata/workflows/.index.json")
    assert r.status_code == 200
    assert r.json() == {"favorites":["a"]}
