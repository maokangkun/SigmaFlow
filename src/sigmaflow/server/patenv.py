"""Virtual-patient environment bridge.

The physiology engine only exists in the browser (``science/js/patient.js``),
so the training environment cannot be re-implemented server-side without
drifting away from what the page shows. Instead the page acts as the
environment host and this module is the transport:

* the page registers a session and long-polls for tool calls;
* an MCP client (the agent) posts ``tools/call`` here, which is queued for
  the page and awaits the page's result;
* everything the agent does therefore happens on the live engine, so the
  vitals, waveforms, event log and case HUD update as the challenge is played.

MCP itself is the tiny JSON-RPC dialect the in-process client speaks
(``tools/list`` + ``tools/call``), see ``agent/tools.py``.
"""

from __future__ import annotations

import asyncio
import itertools
import os
import time
from typing import Any, Dict, List, Optional

# The project that collects every case-challenge conversation. Fixed id so the
# sidebar entry is stable across restarts and multiple browsers.
PATIENT_PROJECT_ID = "pr-patient-env"
PATIENT_PROJECT_NAME = "虚拟患者"

_PROMPT_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "science", "prompts", "patient_agent.md"
)

_FALLBACK_PROMPT = """你是一名在虚拟患者 (SimPatient) 环境里做临床决策的智能体。
所有数值只能来自 patient_observe / patient_lab, 不得凭记忆推断。
循环: patient_observe → 判断 → 执行干预 → patient_advance → 再看结果。"""


def patient_agent_prompt() -> str:
    """The case-challenge system prompt shipped with the workspace."""
    try:
        with open(_PROMPT_PATH, "r", encoding="utf-8") as fh:
            text = fh.read().strip()
        return text or _FALLBACK_PROMPT
    except OSError:
        return _FALLBACK_PROMPT


def _schema(props: Dict[str, Any], required: Optional[List[str]] = None) -> Dict[str, Any]:
    return {
        "type": "object",
        "properties": props,
        "required": required or [],
        "additionalProperties": False,
    }


TOOLS: List[Dict[str, Any]] = [
    {
        "name": "patient_observe",
        "description": (
            "Read the live patient state: vitals (HR/MAP/SpO2/RR/temp/glucose/GCS), "
            "rhythm, electrolytes and blood gas, active pathologies, blood drug "
            "levels, case goals with hold progress, elapsed case time and the tail "
            "of the event log. Always call this before acting, and again after "
            "advancing time."
        ),
        "inputSchema": _schema({}),
    },
    {
        "name": "patient_list_cases",
        "description": "List the built-in case challenges with id, name, difficulty, time limit and goals.",
        "inputSchema": _schema({}),
    },
    {
        "name": "patient_case_start",
        "description": "Reset the patient and load a case challenge. Starts its clock.",
        "inputSchema": _schema(
            {
                "case_id": {
                    "type": "string",
                    "description": "Case id from patient_list_cases, e.g. 'sca'.",
                }
            },
            ["case_id"],
        ),
    },
    {
        "name": "patient_case_status",
        "description": "Case clock, per-goal hold progress, operation count and the final result once the case ends.",
        "inputSchema": _schema({}),
    },
    {
        "name": "patient_administer",
        "description": (
            "Give a drug / chemical. Names are the engine's chemical ids "
            "(e.g. Epinephrine, Insulin, Glucose, CalciumGluconate, Naloxone, "
            "Amiodarone, SodiumBicarbonate, Furosemide); Chinese names from the "
            "pharmacy list also work. Dose is in the page's dose units (1 = the "
            "usual bolus shown in the UI)."
        ),
        "inputSchema": _schema(
            {
                "chemical": {"type": "string"},
                "dose": {"type": "number", "default": 1, "minimum": 0.1, "maximum": 50},
                "route": {
                    "type": "string",
                    "enum": ["IVPush", "Oral", "Muscle", "ContinuousInfusion", "Inhale"],
                    "default": "IVPush",
                },
            },
            ["chemical"],
        ),
    },
    {
        "name": "patient_shock",
        "description": "Charge and deliver a defibrillation shock at the given energy.",
        "inputSchema": _schema(
            {
                "joules": {
                    "type": "integer",
                    "enum": [120, 200, 300, 360],
                    "default": 200,
                }
            }
        ),
    },
    {
        "name": "patient_ventilate",
        "description": "Switch mechanical ventilation (A/C) on or off and set RR / tidal volume / PEEP / FiO2.",
        "inputSchema": _schema(
            {
                "on": {"type": "boolean", "default": True},
                "rr": {"type": "integer", "minimum": 6, "maximum": 40},
                "vt": {"type": "integer", "minimum": 200, "maximum": 800},
                "peep": {"type": "integer", "minimum": 0, "maximum": 15},
                "fio2": {"type": "integer", "minimum": 21, "maximum": 100},
            },
            ["on"],
        ),
    },
    {
        "name": "patient_oxygen",
        "description": "Set supplemental oxygen: fio2 is a percentage (21 = room air, 100 = pure O2).",
        "inputSchema": _schema(
            {"fio2": {"type": "integer", "minimum": 21, "maximum": 100}}, ["fio2"]
        ),
    },
    {
        "name": "patient_cpr",
        "description": "Start or stop chest compressions.",
        "inputSchema": _schema({"on": {"type": "boolean", "default": True}}, ["on"]),
    },
    {
        "name": "patient_fluid",
        "description": "Give an IV fluid bolus in millilitres (positive) or draw blood (negative).",
        "inputSchema": _schema(
            {"ml": {"type": "integer", "minimum": -500, "maximum": 2000}}, ["ml"]
        ),
    },
    {
        "name": "patient_lab",
        "description": "Draw blood and return the full lab panel with reference ranges and flags.",
        "inputSchema": _schema({}),
    },
    {
        "name": "patient_advance",
        "description": (
            "Fast-forward the simulation by N seconds (max 120) without waiting in "
            "real time. Use it after every intervention so downstream effects can "
            "develop; the page renders the whole interval."
        ),
        "inputSchema": _schema(
            {"seconds": {"type": "number", "minimum": 1, "maximum": 120, "default": 10}},
            ["seconds"],
        ),
    },
    {
        "name": "patient_log",
        "description": "Recent event log entries (newest last) with timestamps, for reconstructing what already happened.",
        "inputSchema": _schema({"limit": {"type": "integer", "minimum": 5, "maximum": 80, "default": 20}}),
    },
    {
        "name": "patient_reset",
        "description": "Reset the patient to a healthy baseline and clear the case.",
        "inputSchema": _schema({}),
    },
]

TOOL_NAMES = {t["name"] for t in TOOLS}


class _Session:
    """One browser tab acting as the environment host."""

    def __init__(self, user: str, session_id: str):
        self.user = user
        self.id = session_id
        self.created = time.time()
        self.seen = time.time()
        self.conversation_id = ""
        self.pending: asyncio.Queue = asyncio.Queue()
        self.waiters: Dict[str, asyncio.Future] = {}
        self.busy: Optional[str] = None


class PatEnvHub:
    """Session registry + request/response bridge to the live page."""

    CALL_TIMEOUT = 120.0
    SESSION_TTL = 6 * 3600.0

    def __init__(self) -> None:
        self._sessions: Dict[str, _Session] = {}
        self._by_user: Dict[str, str] = {}
        self._ids = itertools.count(1)

    # ---- registration -------------------------------------------------
    def register(self, user: str) -> _Session:
        session = _Session(user, f"pe-{next(self._ids)}-{int(time.time()) % 100000}")
        # One live host per user: a reloaded/duplicate tab replaces the old one.
        old = self._by_user.get(user)
        if old and old in self._sessions:
            stale = self._sessions.pop(old)
            self._fail_pending(stale, "环境会话已被新的页面实例替换")
        self._sessions[session.id] = session
        self._by_user[user] = session.id
        return session

    def get(self, session_id: str) -> Optional[_Session]:
        session = self._sessions.get(session_id)
        if session is None:
            return None
        if time.time() - session.seen > self.SESSION_TTL:
            self._sessions.pop(session_id, None)
            return None
        return session

    def host(self, user: str) -> Optional[_Session]:
        session_id = self._by_user.get(user)
        return self.get(session_id) if session_id else None

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
            return {
                "ok": False,
                "text": (
                    "患者页没有打开: 虚拟患者环境只存在于浏览器里的实时页面。"
                    "请让用户打开「虚拟患者」页并保持 AI 面板开启后重试。"
                ),
            }
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
                "text": f"环境在 {int(self.CALL_TIMEOUT)}s 内没有回应({tool})——页面可能已关闭或卡住。",
            }

    def _fail_pending(self, session: _Session, reason: str) -> None:
        for future in list(session.waiters.values()):
            if not future.done():
                future.set_result({"ok": False, "text": reason})
        session.waiters.clear()

    # ---- MCP -----------------------------------------------------------
    def mcp_handle(self, user: str, payload: dict) -> dict:
        """Handle one JSON-RPC message; tool calls are awaited by the caller."""
        method = str(payload.get("method") or "")
        rid = payload.get("id")
        if method == "tools/list":
            return {"jsonrpc": "2.0", "id": rid, "result": {"tools": TOOLS}}
        if method == "initialize":
            return {
                "jsonrpc": "2.0",
                "id": rid,
                "result": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "patenv", "version": "1.0.0"},
                },
            }
        if method == "ping":
            return {"jsonrpc": "2.0", "id": rid, "result": {}}
        return {
            "jsonrpc": "2.0",
            "id": rid,
            "error": {"code": -32601, "message": f"unsupported method: {method}"},
        }

    async def mcp_call(self, user: str, payload: dict) -> dict:
        rid = payload.get("id")
        params = payload.get("params") or {}
        name = str(params.get("name") or "")
        if name not in TOOL_NAMES:
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


HUB = PatEnvHub()
