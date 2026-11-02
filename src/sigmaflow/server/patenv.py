"""Virtual-patient environment: tools, prompt and hub for the patient page.

The transport itself is generic (``envbridge.py``); this module only describes
the patient environment: which tools exist, which prompt the agent gets and
which sidebar project collects the case-challenge conversations.

The physiology engine only exists in the browser (``science/js/patient.js``),
so the page acts as the environment host: it long-polls for tool calls,
executes them on the live engine and returns the result, which means the vitals,
waveforms, event log and case HUD update as the challenge is played.
"""

from __future__ import annotations

import os
from typing import Any, Dict, List

from .envbridge import EnvHub
from .envbridge import schema as _schema

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
                    "enum": [
                        "IVPush",
                        "Oral",
                        "Muscle",
                        "ContinuousInfusion",
                        "Inhale",
                    ],
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
            {
                "seconds": {
                    "type": "number",
                    "minimum": 1,
                    "maximum": 120,
                    "default": 10,
                }
            },
            ["seconds"],
        ),
    },
    {
        "name": "patient_log",
        "description": "Recent event log entries (newest last) with timestamps, for reconstructing what already happened.",
        "inputSchema": _schema(
            {"limit": {"type": "integer", "minimum": 5, "maximum": 80, "default": 20}}
        ),
    },
    {
        "name": "patient_reset",
        "description": "Reset the patient to a healthy baseline and clear the case.",
        "inputSchema": _schema({}),
    },
]

PATIENT_PAGE_TITLE = "虚拟患者"


class PatEnvHub(EnvHub):
    """The patient environment's hub: fixed tool set and wording."""

    def __init__(self) -> None:
        super().__init__(
            name="patenv",
            tools=TOOLS,
            page_title=PATIENT_PAGE_TITLE,
            prefix="pe",
        )


HUB = PatEnvHub()
