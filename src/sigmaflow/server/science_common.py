"""Science 底层共享: 数据根/单多用户模式/当前用户上下文/通用截断.

不含路由与业务状态; 由 science.py 与其余 science_* 域模块共同引用。"""

import contextvars
import getpass
import os

from typing import Any


def _science_data_root() -> str:
    return os.environ.get("SIGMAFLOW_SCIENCE_DIR") or os.path.join(
        os.path.expanduser("~"), ".sigmaflow", "science"
    )


def _multi_user() -> bool:
    """Multi-user mode is opt-in via environment at server start."""
    return os.environ.get(_MULTI_USER_ENV, "").strip() in ("1", "true", "yes")


def _os_user() -> str:
    """Name of the OS account running this service (single-user identity)."""
    try:
        return getpass.getuser() or "default"
    except Exception:
        return "default"


_CURRENT_USER: "contextvars.ContextVar[str]" = contextvars.ContextVar(
    "sigmaflow_user", default=""
)


def _current_user() -> str:
    """Requested user for this task: logged-in account or service user name."""
    user = _CURRENT_USER.get()
    return user if user else _os_user()


def _clip(value: Any, limit: int) -> str:
    return str(value if value is not None else "")[:limit]


_MULTI_USER_ENV = "SIGMAFLOW_MULTI_USER"
_SESSION_COOKIE = "sigmaflow_session"
_SESSION_TTL = 7 * 24 * 3600
