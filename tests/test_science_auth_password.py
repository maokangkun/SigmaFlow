"""多用户模式修改密码端点的行为契约。

/auth/change-password 需验证当前密码(微信扫码注册的无密码账户除外,
首次修改即设置密码), 成功后旧密码失效、新密码可登录, 并换发会话
cookie 使当前登录保持有效。
"""

import json
import os

import pytest
from fastapi import APIRouter, FastAPI
from fastapi.testclient import TestClient

from sigmaflow.server.science import ScienceAPI
from sigmaflow.server.science_auth import _SESSION_COOKIE, _session_token


@pytest.fixture()
def auth_client(monkeypatch, tmp_path):
    """Only mount the auth sub-router; skip ScienceAPI's heavy __init__."""
    monkeypatch.setenv("SIGMAFLOW_MULTI_USER", "1")
    monkeypatch.setenv("SIGMAFLOW_SCIENCE_DIR", str(tmp_path))
    api = object.__new__(ScienceAPI)
    auth_router = APIRouter(prefix="/api/auth")
    ScienceAPI._register_auth_routes(api, auth_router)
    app = FastAPI()
    app.include_router(auth_router)
    return TestClient(app)


def test_change_password_round_trip(auth_client):
    client = auth_client
    r = client.post(
        "/api/auth/register", json={"username": "alice", "password": "secret1"}
    )
    assert r.status_code == 200, r.text
    me = client.get("/api/auth/me").json()
    assert me["user"]["name"] == "alice"
    assert me["user"]["hasPassword"] is True

    # 旧密码错误 → 400(而非 401, 避免触发前端会话丢失浮层), 且密码未变
    r = client.post(
        "/api/auth/change-password",
        json={"oldPassword": "wrong!", "newPassword": "secret2"},
    )
    assert r.status_code == 400
    assert "当前密码" in r.json()["detail"]
    r = client.post(
        "/api/auth/login", json={"username": "alice", "password": "secret1"}
    )
    assert r.status_code == 200

    # 新密码太短 → 400
    r = client.post(
        "/api/auth/change-password",
        json={"oldPassword": "secret1", "newPassword": "123"},
    )
    assert r.status_code == 400

    # 正确流程 → 200, 会话令牌换发后仍登录有效
    r = client.post(
        "/api/auth/change-password",
        json={"oldPassword": "secret1", "newPassword": "secret2"},
    )
    assert r.status_code == 200, r.text
    assert client.get("/api/auth/me").json()["user"]["name"] == "alice"

    # 旧密码登录失败, 新密码成功
    r = client.post(
        "/api/auth/login", json={"username": "alice", "password": "secret1"}
    )
    assert r.status_code == 401
    r = client.post(
        "/api/auth/login", json={"username": "alice", "password": "secret2"}
    )
    assert r.status_code == 200


def test_change_password_requires_login(auth_client):
    client = auth_client
    # 注册拿到 cookie 后手动清掉, 再改密 → 401
    client.post("/api/auth/register", json={"username": "bob", "password": "secret1"})
    client.cookies.clear()
    r = client.post(
        "/api/auth/change-password",
        json={"oldPassword": "secret1", "newPassword": "secret2"},
    )
    assert r.status_code == 401


def test_change_password_sets_password_for_wechat_account(auth_client, tmp_path):
    """微信扫码账户(salt/hash 为空)首次改密跳过旧密码校验。"""
    client = auth_client
    users_path = os.path.join(str(tmp_path), "users.json")
    with open(users_path, "w", encoding="utf-8") as fh:
        json.dump(
            {
                "wx_abcd1234": {
                    "salt": "",
                    "hash": "",
                    "createdAt": "2025-01-01T00:00:00",
                    "wechat": {"key": "union-key", "openid": "o1"},
                }
            },
            fh,
        )
    client.cookies.set(_SESSION_COOKIE, _session_token("wx_abcd1234"))

    me = client.get("/api/auth/me").json()
    assert me["user"]["hasPassword"] is False

    # 旧密码留空也可设置成功
    r = client.post(
        "/api/auth/change-password",
        json={"oldPassword": "", "newPassword": "secret9"},
    )
    assert r.status_code == 200, r.text
    # 设置后即可用密码登录, wechat 字段保留
    r = client.post(
        "/api/auth/login", json={"username": "wx_abcd1234", "password": "secret9"}
    )
    assert r.status_code == 200
    with open(users_path, encoding="utf-8") as fh:
        record = json.load(fh)["wx_abcd1234"]
    assert record["hash"] and record["salt"]
    assert record["wechat"]["key"] == "union-key"


def test_change_password_rejected_in_single_user_mode(monkeypatch):
    monkeypatch.delenv("SIGMAFLOW_MULTI_USER", raising=False)
    api = object.__new__(ScienceAPI)
    auth_router = APIRouter(prefix="/api/auth")
    ScienceAPI._register_auth_routes(api, auth_router)
    app = FastAPI()
    app.include_router(auth_router)
    client = TestClient(app)
    r = client.post(
        "/api/auth/change-password",
        json={"oldPassword": "old", "newPassword": "secret2"},
    )
    assert r.status_code == 400
    assert "单用户" in r.json()["detail"]
