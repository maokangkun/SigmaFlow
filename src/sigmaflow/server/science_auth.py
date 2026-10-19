"""认证域: 用户注册表+会话令牌+微信扫码登录.

由 science.py 路由层调用; _ensure_user_data 因跨界 seed skills 保留在 science.py。"""

import hashlib
import hmac
import json
import os
import secrets
import threading
import time
import urllib.parse
import urllib.request

from typing import Any, Dict


from .science_common import (
    _SESSION_COOKIE,
    _SESSION_TTL,
    _current_user,
    _multi_user,
    _science_data_root,
)

_USER_REGISTRY_LOCK = threading.Lock()


def _users_registry_path() -> str:
    return os.path.join(_science_data_root(), "users.json")


def _load_users() -> dict:
    try:
        with open(_users_registry_path(), encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def _save_users(users: dict) -> None:
    path = _users_registry_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(users, fh, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def _hash_password(password: str, salt: bytes) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 200_000).hex()


def _session_secret() -> bytes:
    """Stable HMAC secret persisted in the shared data root."""
    path = os.path.join(_science_data_root(), "session_secret")
    try:
        with open(path, encoding="utf-8") as fh:
            value = fh.read().strip()
    except OSError:
        value = ""
    if not value:
        value = secrets.token_hex(32)
        try:
            os.makedirs(_science_data_root(), exist_ok=True)
            tmp = path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as fh:
                fh.write(value)
            os.replace(tmp, path)
        except Exception:
            pass
    return value.encode("utf-8")


def _session_token(user: str) -> str:
    """Signed and expiring session token, given out as an HttpOnly cookie."""
    payload = f"{user}.{int(time.time()) + _SESSION_TTL}"
    sig = hmac.new(
        _session_secret(), payload.encode("utf-8"), hashlib.sha256
    ).hexdigest()
    return f"{payload}.{sig}"


def _user_from_token(token: str) -> str:
    try:
        user, exp, sig = str(token).rsplit(".", 2)
        payload = f"{user}.{exp}"
        expected = hmac.new(
            _session_secret(), payload.encode("utf-8"), hashlib.sha256
        ).hexdigest()
    except Exception:
        return ""
    if not hmac.compare_digest(sig, expected):
        return ""
    if not exp.isdigit() or int(exp) < time.time():
        return ""
    return user or ""


def _cookie_user(request: Any) -> str:
    try:
        raw = request.cookies.get(_SESSION_COOKIE)
    except Exception:
        raw = ""
    return _user_from_token(raw) if raw else ""


def _user_data_dir(user: str) -> str:
    """Storage root for the given user's configs; common layout when single."""
    if not _multi_user():
        return _science_data_root()
    return os.path.join(_science_data_root(), "users", str(user)[:64])


def _user_science_root() -> str:
    """Per-request storage root for user-scoped config files."""
    return _user_data_dir(_current_user())


_WECHAT_STATE_TTL = 300.0
_WECHAT_STATE_LOCK = threading.Lock()
_WECHAT_STATES: Dict[str, float] = {}


def _wechat_config_path() -> str:
    return os.path.join(_science_data_root(), "wechat.json")


def _load_wechat_config() -> dict:
    """WeChat OAuth app credentials kept server-side; absent file disables it."""
    try:
        with open(_wechat_config_path(), encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def _wechat_appid() -> str:
    cfg = _load_wechat_config()
    return str(cfg.get("app_id") or "").strip()


def _wechat_enabled() -> bool:
    """Toggle is on when credentials exist; users without them see no button."""
    if not _multi_user():
        return False
    cfg = _load_wechat_config()
    if cfg.get("enabled") is False:
        return False
    return bool(_wechat_appid() and str(cfg.get("app_secret") or "").strip())


def _wechat_redirect_uri(request: Any) -> str:
    """OAuth return address; redirect_base in wechat.json wins over heuristics."""
    cfg = _load_wechat_config()
    base = str(cfg.get("redirect_base") or "").strip()
    if base:
        return base.rstrip("/") + "/"
    proto = request.url.scheme
    forwarded = str(request.headers.get("x-forwarded-proto") or "").split(",")[0]
    forwarded = forwarded.strip().lower()
    if forwarded:
        proto = forwarded
    host = request.headers.get("host") or "localhost"
    prefix = str(request.headers.get("x-forwarded-prefix") or "").strip()
    if not prefix:
        prefix = "/sigmaflow"  # 网关约定路径; 例外场景用 redirect_base 覆盖
    return f"{proto}://{host}{prefix}/science/"


def _wechat_qrconnect_url(request: Any) -> str:
    """Build the WeChat QR page URL; issues a one-shot state for CSRF checks."""
    state = secrets.token_urlsafe(16)
    now = time.time()
    with _WECHAT_STATE_LOCK:
        for key in [k for k, exp in _WECHAT_STATES.items() if exp < now]:
            _WECHAT_STATES.pop(key, None)
        _WECHAT_STATES[state] = now + _WECHAT_STATE_TTL
    redirect = _wechat_redirect_uri(request)
    query = urllib.parse.urlencode(
        {
            "appid": _wechat_appid(),
            "redirect_uri": redirect,
            "response_type": "code",
            "scope": "snsapi_login",
            "state": state,
        }
    )
    return "https://open.weixin.qq.com/connect/qrconnect?" + query + "#wechat_redirect"


def _wechat_consume_state(state: str) -> bool:
    """Accept a pending state exactly once within its TTL."""
    with _WECHAT_STATE_LOCK:
        expiry = _WECHAT_STATES.pop(state or "", None)
    return bool(expiry and expiry >= time.time())


def _wechat_fetch_json(url: str) -> dict:
    """Minimal timed GET returning parsed JSON; failures become empty dicts."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "SigmaFlow-Science"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode("utf-8", "replace"))
    except Exception:
        return {}


def _wechat_account_name(users: dict, key_union: str) -> str:
    """Unique account name derived from the stable WeChat identity key."""
    base = "wx_" + hashlib.sha256(key_union.encode("utf-8")).hexdigest()[:8]
    name = base
    n = 2
    while name in users:
        name = f"{base}_{n}"
        n += 1
    return name
