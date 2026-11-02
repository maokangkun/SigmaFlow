"""Generic bridge between a browser-hosted simulation and an LLM agent.

Both virtual environments (「虚拟患者」 and 「虚拟病原体」) work the same way: the
simulation engine only exists inside the page, so the page is the environment
host and this module is the transport. A page registers a session, long-polls
for tool calls, executes them on the live engine and posts the result back; the
MCP endpoint the agent talks to simply queues the call and awaits that result.

Everything environment-specific (tool schemas, prompt, sidebar project, wording)
lives in the environment module, so adding an environment is a data description
rather than another copy of this bridge.
"""

from __future__ import annotations

import asyncio
import itertools
import time
from typing import Any, Dict, List, Optional, Sequence


def schema(
    props: Dict[str, Any], required: Optional[Sequence[str]] = None
) -> Dict[str, Any]:
    """JSON-Schema object for one tool's arguments."""
    return {
        "type": "object",
        "properties": props,
        "required": list(required or []),
        "additionalProperties": False,
    }


class EnvSession:
    """One browser tab acting as the environment host."""

    def __init__(self, user: str, session_id: str):
        self.user = user
        self.id = session_id
        self.created = time.time()
        self.seen = time.time()
        self.last_poll = time.time()  # 最近一次长轮询: 宿主"活着"的铁证
        self.conversation_id = ""
        self.pending: asyncio.Queue = asyncio.Queue()
        self.waiters: Dict[str, asyncio.Future] = {}
        self.busy: Optional[str] = None


class EnvHub:
    """Session registry plus the request/response bridge to the live page.

    ``groups`` optionally partitions the tool set (e.g. by simulation scale) so
    several MCP endpoints can expose slices of one environment; the agent then
    only pays context for the layers it needs.
    """

    CALL_TIMEOUT = 120.0
    SESSION_TTL = 6 * 3600.0
    # 宿主存活判据: 页面必须持续长轮询才算是活的浏览器环境。见过标签页
    # 直接关闭/刷新的会话条目还在 —— 没有这个判据, 后续工具调用会在队列
    # 里干等 120s 才报错。轮询最长 25s 一轮, 再留出执行长工具的时间。
    POLL_TTL = 90.0

    def __init__(
        self,
        name: str,
        tools: List[Dict[str, Any]],
        page_title: str,
        prefix: str = "env",
        groups: Optional[Dict[str, List[str]]] = None,
    ) -> None:
        self.name = name
        self.tools = list(tools)
        self.tool_names = {t["name"] for t in self.tools}
        self.page_title = page_title
        self.prefix = prefix
        self.groups = {k: list(v) for k, v in (groups or {}).items()}
        self._sessions: Dict[str, EnvSession] = {}
        self._by_user: Dict[str, str] = {}
        self._ids = itertools.count(1)

    # ---- tool surface -------------------------------------------------
    def tools_for(self, group: Optional[str] = None) -> List[Dict[str, Any]]:
        """Tools of one group (or the whole set when ``group`` is empty)."""
        if not group:
            return self.tools
        wanted = set(self.groups.get(group) or [])
        return [t for t in self.tools if t["name"] in wanted]

    def _accepts(self, tool: str, group: Optional[str]) -> bool:
        if group and tool not in (self.groups.get(group) or []):
            return False
        return tool in self.tool_names

    # ---- registration -------------------------------------------------
    def register(self, user: str) -> EnvSession:
        session = EnvSession(
            user, f"{self.prefix}-{next(self._ids)}-{int(time.time()) % 100000}"
        )
        # One live host per user: a reloaded/duplicate tab replaces the old one.
        old = self._by_user.get(user)
        if old and old in self._sessions:
            stale = self._sessions.pop(old)
            self._fail_pending(stale, "环境会话已被新的页面实例替换")
        self._sessions[session.id] = session
        self._by_user[user] = session.id
        return session

    def get(self, session_id: str) -> Optional[EnvSession]:
        session = self._sessions.get(session_id)
        if session is None:
            return None
        if time.time() - session.seen > self.SESSION_TTL:
            self._sessions.pop(session_id, None)
            return None
        return session

    def host(self, user: str) -> Optional[EnvSession]:
        """The live host page for a user: present AND still long-polling."""
        session_id = self._by_user.get(user)
        session = self.get(session_id) if session_id else None
        if session is None:
            return None
        if time.time() - session.last_poll > self.POLL_TTL:
            return None  # 会话记录在, 但页面已停止取任务(关闭/刷新/挂起)
        return session

    def heartbeat(self, session_id: str) -> None:
        session = self._sessions.get(session_id)
        if session is not None:
            session.seen = time.time()

    # ---- page side ----------------------------------------------------
    async def next_call(self, session_id: str, wait: float = 20.0) -> Optional[dict]:
        session = self._sessions.get(session_id)
        if session is None:
            return None
        session.seen = time.time()
        session.last_poll = time.time()
        try:
            return await asyncio.wait_for(session.pending.get(), timeout=wait)
        except asyncio.TimeoutError:
            return None

    def submit(self, session_id: str, call_id: str, payload: dict) -> bool:
        session = self._sessions.get(session_id)
        if session is None:
            return False
        session.seen = time.time()
        future = session.waiters.pop(call_id, None)
        if future is None or future.done():
            return False
        future.set_result(payload)
        return True

    # ---- tool side ----------------------------------------------------
    async def call(self, user: str, tool: str, args: dict) -> dict:
        session = self.host(user)
        if session is None:
            return {"ok": False, "text": self._no_host_text()}
        call_id = f"call-{next(self._ids)}-{int(time.time()) % 100000}"
        loop = asyncio.get_running_loop()
        future: asyncio.Future = loop.create_future()
        session.waiters[call_id] = future
        session.pending.put_nowait({"id": call_id, "tool": tool, "args": args or {}})
        try:
            return await asyncio.wait_for(future, timeout=self.CALL_TIMEOUT)
        except asyncio.TimeoutError:
            session.waiters.pop(call_id, None)
            return {
                "ok": False,
                "text": (
                    f"环境在 {int(self.CALL_TIMEOUT)}s 内没有回应({tool})"
                    "——页面可能已关闭或卡住。"
                ),
            }

    def _no_host_text(self) -> str:
        return (
            f"{self.page_title}页没有打开: 该环境只存在于浏览器里的实时页面。"
            f"请让用户打开「{self.page_title}」页并保持 AI 面板开启后重试。"
        )

    def _fail_pending(self, session: EnvSession, reason: str) -> None:
        for future in list(session.waiters.values()):
            if not future.done():
                future.set_result({"ok": False, "text": reason})
        session.waiters.clear()

    # ---- MCP -----------------------------------------------------------
    def mcp_handle(self, user: str, payload: dict, group: Optional[str] = None) -> dict:
        """Handle one JSON-RPC message; tool calls are awaited by the caller."""
        method = str(payload.get("method") or "")
        rid = payload.get("id")
        if method == "tools/list":
            return {
                "jsonrpc": "2.0",
                "id": rid,
                "result": {"tools": self.tools_for(group)},
            }
        if method == "initialize":
            return {
                "jsonrpc": "2.0",
                "id": rid,
                "result": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {"tools": {}},
                    "serverInfo": {
                        "name": self.name + (f"-{group}" if group else ""),
                        "version": "1.0.0",
                    },
                },
            }
        if method == "ping":
            return {"jsonrpc": "2.0", "id": rid, "result": {}}
        return {
            "jsonrpc": "2.0",
            "id": rid,
            "error": {"code": -32601, "message": f"unsupported method: {method}"},
        }

    async def mcp_call(
        self, user: str, payload: dict, group: Optional[str] = None
    ) -> dict:
        rid = payload.get("id")
        params = payload.get("params") or {}
        name = str(params.get("name") or "")
        if not self._accepts(name, group):
            return {
                "jsonrpc": "2.0",
                "id": rid,
                "error": {"code": -32602, "message": f"unknown tool: {name}"},
            }
        args = params.get("arguments")
        if not isinstance(args, dict):
            args = {}
        try:
            outcome = await self.call(user, name, args)
        except Exception as err:  # pragma: no cover - defensive
            outcome = {"ok": False, "text": f"环境桥接异常: {err}"}
        text = outcome.get("text") or ""
        if not outcome.get("ok") and not text:
            text = "环境返回空结果"
        return {"jsonrpc": "2.0", "id": rid, "result": {"content": text}}
