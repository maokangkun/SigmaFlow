"""Virtual-pathogen environment: molecular → within-host → population → bench.

Like the patient environment, the simulation engine lives in the page
(``science/js/pathogen.js`` + ``science/js/patho/*``) and this module only
describes the environment for the agent: the tool surface, its grouping by
scale, the prompt and the sidebar project that collects the runs.

The tool set is split into five groups so several MCP endpoints can expose
slices of one environment — an agent that only needs within-host pharmacology
does not have to pay context for molecular epidemiology:

``molecular``  sequence, variants, resistance, escape, forecast, drug match,
               vaccine design, phylogeny, source attribution
``host``       scenario setup, inoculation, dosing, immunity, advance, catalog
``diag``       assays, sequencing reads, pathogen identification
``pop``        metapopulation, interventions, vaccination, surveillance,
               spillover watch
``trial``      protocol definition, replicated runs, A/B comparison, export

Every tool executes on the live page, so whatever the agent does shows up in
the charts, the event log and the bench table as it happens.
"""

from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

from .envbridge import EnvHub
from .envbridge import schema as _schema

# Conversations of pathogen experiments get their own sidebar project.
PATHOGEN_PROJECT_ID = "pr-pathogen-env"
PATHOGEN_PROJECT_NAME = "虚拟病原体"
PATHOGEN_PAGE_TITLE = "虚拟病原体"

_PROMPT_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "science",
    "prompts",
    "pathogen_agent.md",
)

_FALLBACK_PROMPT = """你是一名在虚拟病原体 (SimPathogen) 环境里做实验的智能体。
所有数值只能来自 pathogen_ 工具, 不得凭记忆推断。
循环: 观测 → 提出假设 → 设计对照 → 运行 → 复核。结论必须带保真度 tier 与不确定区间。
这是教学/训练沙盒, 参数为教科书量级, 不能作为临床或流行病学预测依据。"""


def pathogen_agent_prompt() -> str:
    """The pathogen-experiment system prompt shipped with the workspace."""
    try:
        with open(_PROMPT_PATH, "r", encoding="utf-8") as fh:
            text = fh.read().strip()
        return text or _FALLBACK_PROMPT
    except OSError:
        return _FALLBACK_PROMPT


_TS = _schema  # short alias for the many timestamped/intervention args below

TOOLS: List[Dict[str, Any]] = [
    # ---------------------------------------------------------------- generic
    {
        "name": "pathogen_catalog",
        "description": (
            "List the pathogen catalog with taxonomy, genome type, transmission, "
            "incubation, intrinsic resistance, drug targets, vaccine platforms, "
            "reservoirs/vectors and fidelity tier. Filter by name, kind (virus / "
            "bacterium / fungus / protozoan / helminth / prion) or free text."
        ),
        "inputSchema": _schema(
            {
                "query": {"type": "string"},
                "kind": {
                    "type": "string",
                    "enum": [
                        "virus",
                        "bacterium",
                        "fungus",
                        "protozoan",
                        "helminth",
                        "prion",
                        "any",
                    ],
                    "default": "any",
                },
                "limit": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 200,
                    "default": 40,
                },
            }
        ),
    },
    {
        "name": "pathogen_setup",
        "description": (
            "Configure the scenario: pathogen id from the catalog, strain/lineage, "
            "host immunity (naive / vaccinated / prior infection / immunosuppressed), "
            "active scales and random seed. Resets the run and seeds the ground truth "
            "registry (hidden from you unless the trial asks to reveal it)."
        ),
        "inputSchema": _schema(
            {
                "pathogen": {"type": "string"},
                "strain": {"type": "string"},
                "immunity": {
                    "type": "string",
                    "enum": ["naive", "vaccinated", "prior", "immunosuppressed"],
                    "default": "naive",
                },
                "seed": {"type": "integer", "minimum": 1, "maximum": 99999999},
                "scales": {
                    "type": "array",
                    "items": {
                        "type": "string",
                        "enum": ["molecular", "host", "diag", "pop"],
                    },
                },
            },
            ["pathogen"],
        ),
    },
    {
        "name": "pathogen_log",
        "description": "Recent event log entries (newest last) of the running experiment.",
        "inputSchema": _schema(
            {"limit": {"type": "integer", "minimum": 5, "maximum": 80, "default": 20}}
        ),
    },
    {
        "name": "pathogen_reset",
        "description": "Reset the environment to an empty scenario (all scales cleared).",
        "inputSchema": _schema({}),
    },
    # ------------------------------------------------------------- molecular
    {
        "name": "pathogen_genome",
        "description": (
            "Inspect the current genome: genome type and length, gene/locus map with "
            "function class and essentiality, epitope-dense regions, resistance "
            "determinants present, and the lineage label of the working strain."
        ),
        "inputSchema": _schema(
            {
                "sample": {
                    "type": "string",
                    "description": "sample id; omit for the working strain",
                }
            }
        ),
    },
    {
        "name": "pathogen_variants",
        "description": (
            "Variant calls of a sequenced sample (position, gene, ref/alt, allele "
            "frequency, predicted effect class). Call pathogen_sequence first — this "
            "returns what the reads support, not the hidden truth."
        ),
        "inputSchema": _schema(
            {
                "sample": {"type": "string"},
                "min_af": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 1,
                    "default": 0.05,
                },
                "limit": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 200,
                    "default": 60,
                },
            },
            ["sample"],
        ),
    },
    {
        "name": "pathogen_resistance",
        "description": (
            "Resistance annotation for a sample: mechanism per determinant (target "
            "SNP, acquired gene, promoter/expression, plasmid context, efflux), "
            "evidence strength from read support, and predicted S/I/R per drug."
        ),
        "inputSchema": _schema(
            {
                "sample": {"type": "string"},
                "drugs": {"type": "array", "items": {"type": "string"}},
            },
            ["sample"],
        ),
    },
    {
        "name": "pathogen_escape",
        "description": (
            "Immune-escape analysis: per-epitope distance against the host's antibody "
            "and T-cell profiles, predicted neutralization fold-drop, and which positions "
            "are under positive selection."
        ),
        "inputSchema": _schema(
            {
                "sample": {"type": "string"},
                "profile": {
                    "type": "string",
                    "enum": ["convalescent", "vaccinated", "hybrid", "naive"],
                    "default": "convalescent",
                },
            }
        ),
    },
    {
        "name": "pathogen_forecast",
        "description": (
            "Project variant frequencies forward under a selection scenario (drug "
            "exposure, vaccination coverage, transmission advantage): dominant lineage, "
            "time to dominance, intervals, and which mutations are being enriched."
        ),
        "inputSchema": _schema(
            {
                "days": {
                    "type": "integer",
                    "minimum": 7,
                    "maximum": 720,
                    "default": 60,
                },
                "drug_pressure": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 1,
                    "default": 0,
                },
                "vaccine_coverage": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 1,
                    "default": 0,
                },
                "transmission_advantage": {
                    "type": "number",
                    "minimum": -0.5,
                    "maximum": 1.0,
                    "default": 0,
                },
            },
            ["days"],
        ),
    },
    {
        "name": "pathogen_drug_match",
        "description": (
            "Genotype-guided drug matching: per-drug predicted phenotype, recommended "
            "regimen (drug, dose, interval, duration), resistance barrier (mutations "
            "still needed), cross-resistance and a suppression-of-mutants suggestion."
        ),
        "inputSchema": _schema(
            {
                "sample": {"type": "string"},
                "drugs": {"type": "array", "items": {"type": "string"}},
                "host": {
                    "type": "string",
                    "enum": ["adult", "pediatric", "renal", "hepatic", "pregnant"],
                    "default": "adult",
                },
            }
        ),
    },
    {
        "name": "pathogen_vaccine_design",
        "description": (
            "Design a vaccine: choose antigen set (conserved epitopes vs strain-matched), "
            "platform (inactivated / subunit / mRNA / viral vector / live-attenuated) and "
            "schedule; returns predicted coverage against current and forecast variants, "
            "escape-risk positions and a protection curve."
        ),
        "inputSchema": _schema(
            {
                "antigens": {"type": "array", "items": {"type": "string"}},
                "platform": {
                    "type": "string",
                    "enum": [
                        "inactivated",
                        "subunit",
                        "mrna",
                        "vector",
                        "live_attenuated",
                    ],
                    "default": "subunit",
                },
                "doses": {"type": "integer", "minimum": 1, "maximum": 3, "default": 2},
                "strategy": {
                    "type": "string",
                    "enum": ["conserved", "matched", "cocktail"],
                    "default": "conserved",
                },
            },
            ["platform"],
        ),
    },
    {
        "name": "pathogen_phylo",
        "description": (
            "Phylogeny of the sequenced samples: SNP distance matrix, clusters above a "
            "threshold, and a tree in Newick form with support ordering by distance."
        ),
        "inputSchema": _schema(
            {
                "samples": {"type": "array", "items": {"type": "string"}},
                "threshold": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 50,
                    "default": 2,
                },
            }
        ),
    },
    {
        "name": "pathogen_trace",
        "description": (
            "Source attribution / transmission-chain inference from case genomes plus "
            "onset time and location: likely infector per case, clusters with a common "
            "source, index case, and confidence. Compare with the hidden ground truth "
            "in evaluation mode."
        ),
        "inputSchema": _schema(
            {
                "samples": {"type": "array", "items": {"type": "string"}},
                "use_dates": {"type": "boolean", "default": True},
                "use_locations": {"type": "boolean", "default": True},
            }
        ),
    },
    # ------------------------------------------------------------ within host
    {
        "name": "pathogen_inoculate",
        "description": (
            "Inoculate the simulated host with the configured pathogen at a given dose "
            "(log10 units, e.g. 3 = 1e3 particles/CFU). Starts within-host dynamics and "
            "the infectiousness curve."
        ),
        "inputSchema": _schema(
            {
                "log10_dose": {
                    "type": "number",
                    "minimum": -1,
                    "maximum": 12,
                    "default": 3,
                },
                "route": {
                    "type": "string",
                    "enum": ["respiratory", "oral", "blood", "vector", "contact"],
                    "default": "respiratory",
                },
            },
            ["log10_dose"],
        ),
    },
    {
        "name": "pathogen_dose",
        "description": (
            "Give a drug to the simulated host: drug id from the matching table, dose in "
            "milligrams, interval in hours (0 = single dose) and duration in days. PK/PD "
            "and mutant selection run on the live engine."
        ),
        "inputSchema": _schema(
            {
                "drug": {"type": "string"},
                "mg": {"type": "number", "minimum": 0.01, "maximum": 5000},
                "interval_h": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 168,
                    "default": 12,
                },
                "days": {
                    "type": "number",
                    "minimum": 0.25,
                    "maximum": 90,
                    "default": 5,
                },
            },
            ["drug", "mg"],
        ),
    },
    {
        "name": "pathogen_host_immune",
        "description": (
            "Modify host immune state: prior exposure, vaccination status, immunosuppression "
            "level, or passive antibody level (e.g. monoclonal / convalescent plasma)."
        ),
        "inputSchema": _schema(
            {
                "prior_exposure": {"type": "boolean"},
                "vaccinated": {"type": "boolean"},
                "immunosuppression": {"type": "number", "minimum": 0, "maximum": 1},
                "passive_antibody": {"type": "number", "minimum": 0, "maximum": 1},
            }
        ),
    },
    {
        "name": "pathogen_host_observe",
        "description": (
            "Read the within-host state: log10 load per compartment, immune effectors "
            "(innate / CD8 / antibody / memory), drug concentration and AUC vs MIC, "
            "resistant fraction, tissue damage signals and the infectiousness curve."
        ),
        "inputSchema": _schema(
            {
                "series": {
                    "type": "boolean",
                    "default": False,
                    "description": "include the sampled time series",
                }
            }
        ),
    },
    {
        "name": "pathogen_advance",
        "description": (
            "Advance simulated time by N days (fractional allowed, max 30) with the engine "
            "stepping internally; the page renders the whole interval. Use after every "
            "intervention."
        ),
        "inputSchema": _schema(
            {"days": {"type": "number", "minimum": 0.05, "maximum": 30, "default": 1}},
            ["days"],
        ),
    },
    # ------------------------------------------------------------ diagnostics
    {
        "name": "pathogen_diagnose",
        "description": (
            "Run an assay on the simulated host and return its reading: qPCR Ct, antigen "
            "test result, culture CFU, serology IgM/IgG, or a MIC panel. Sensitivity and "
            "turnaround depend on load and timing, so results can be falsely negative."
        ),
        "inputSchema": _schema(
            {
                "assay": {
                    "type": "string",
                    "enum": [
                        "pcr",
                        "antigen",
                        "culture",
                        "serology",
                        "mic_panel",
                        "panel",
                    ],
                    "default": "pcr",
                },
                "specimen": {
                    "type": "string",
                    "enum": ["respiratory", "blood", "stool", "csf", "tissue", "urine"],
                    "default": "respiratory",
                },
            }
        ),
    },
    {
        "name": "pathogen_sequence",
        "description": (
            "Sequence a specimen: returns a sample id with depth, quality, detected "
            "lineage, and the variant calls the reads support. Higher depth resolves "
            "low-frequency resistance mutations; low depth may miss them entirely."
        ),
        "inputSchema": _schema(
            {
                "specimen": {
                    "type": "string",
                    "enum": ["respiratory", "blood", "stool", "csf", "tissue", "urine"],
                    "default": "respiratory",
                },
                "depth": {
                    "type": "integer",
                    "minimum": 50,
                    "maximum": 200000,
                    "default": 1000,
                },
                "label": {
                    "type": "string",
                    "description": "sample label for later tools",
                },
            }
        ),
    },
    {
        "name": "pathogen_identify",
        "description": (
            "Identify the pathogen from the sequenced/metagenomic reads: candidate "
            "species with confidence, abundance ranking, and contamination or background "
            "flora notes."
        ),
        "inputSchema": _schema(
            {
                "sample": {"type": "string"},
                "method": {
                    "type": "string",
                    "enum": ["mngs", "panel", "culture"],
                    "default": "mngs",
                },
            }
        ),
    },
    # ------------------------------------------------------------- population
    {
        "name": "pathogen_pop_init",
        "description": (
            "Initialise the metapopulation: regions, age structure, contact matrix, "
            "initial cases, immunity profile and mobility. Needed before population "
            "tools work."
        ),
        "inputSchema": _schema(
            {
                "regions": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 12,
                    "default": 3,
                },
                "population": {
                    "type": "number",
                    "minimum": 10000,
                    "maximum": 100000000,
                    "default": 1000000,
                },
                "initial_cases": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 100000,
                    "default": 50,
                },
                "mobility": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 1,
                    "default": 0.1,
                },
            }
        ),
    },
    {
        "name": "pathogen_intervene",
        "description": (
            "Apply a population intervention from day X to day Y: masking, distancing, "
            "school closure, lockdown, travel restriction, test-trace-isolate (with "
            "sensitivity, delay and coverage) or treatment allocation."
        ),
        "inputSchema": _schema(
            {
                "kind": {
                    "type": "string",
                    "enum": [
                        "mask",
                        "distancing",
                        "school",
                        "lockdown",
                        "travel",
                        "tti",
                        "treatment",
                    ],
                },
                "strength": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 1,
                    "default": 0.5,
                },
                "start_day": {"type": "number", "minimum": 0, "default": 0},
                "end_day": {"type": "number", "minimum": 0, "default": 180},
                "coverage": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 1,
                    "default": 0.6,
                },
            },
            ["kind"],
        ),
    },
    {
        "name": "pathogen_vaccinate",
        "description": (
            "Run a vaccination campaign: platform/product, coverage target, allocation "
            "strategy (age-first / risk-first / ring / uniform), start day and doses. "
            "Efficacy and escape follow from the designed vaccine."
        ),
        "inputSchema": _schema(
            {
                "coverage": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 1,
                    "default": 0.6,
                },
                "allocation": {
                    "type": "string",
                    "enum": ["age", "risk", "ring", "uniform"],
                    "default": "age",
                },
                "start_day": {"type": "number", "minimum": 0, "default": 0},
                "efficacy": {"type": "number", "minimum": 0, "maximum": 1},
            },
            ["coverage"],
        ),
    },
    {
        "name": "pathogen_surveillance",
        "description": (
            "Genomic + case surveillance report: variant frequency estimates with "
            "sampling noise, sequencing fraction, Rt with reporting delay, and a "
            "nowcast of the true incidence."
        ),
        "inputSchema": _schema(
            {
                "seq_fraction": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 1,
                    "default": 0.01,
                },
                "day": {"type": "number"},
            }
        ),
    },
    {
        "name": "pathogen_spillover",
        "description": (
            "Spillover early-warning score for the configured pathogen: reservoir and "
            "vector terms, human-animal interface exposure, receptor compatibility, "
            "genetic barrier to human adaptation and surveillance sensitivity, with the "
            "factor breakdown and a ranked watchlist."
        ),
        "inputSchema": _schema(
            {
                "interface": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 1,
                    "default": 0.5,
                },
                "what_if": {"type": "boolean", "default": False},
            }
        ),
    },
    {
        "name": "pathogen_pop_observe",
        "description": (
            "Read the population state: compartment counts, Rt, cumulative infections, "
            "hospital occupancy vs capacity, deaths, variant shares and intervention "
            "history."
        ),
        "inputSchema": _schema(
            {"day": {"type": "number"}, "series": {"type": "boolean", "default": False}}
        ),
    },
    # ------------------------------------------------------------------ trial
    {
        "name": "pathogen_trial_define",
        "description": (
            "Define an experiment protocol: name, arms (each arm is a parameter set with "
            "a scheduled intervention list), replicates per arm, duration and which "
            "metrics to collect. Replaces the current protocol."
        ),
        "inputSchema": _schema(
            {
                "name": {"type": "string"},
                "arms": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "label": {"type": "string"},
                            "patient_scale": {"type": "boolean"},
                            "interventions": {
                                "type": "array",
                                "items": {"type": "object"},
                            },
                        },
                    },
                },
                "replicates": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 200,
                    "default": 3,
                },
                "days": {"type": "number", "minimum": 1, "maximum": 720, "default": 30},
                "metrics": {
                    "type": "array",
                    "items": {
                        "type": "string",
                        "enum": [
                            "peak_load",
                            "auc",
                            "time_to_clearance",
                            "resistance_emergence",
                            "severe_outcomes",
                            "cost",
                        ],
                    },
                },
            },
            ["name"],
        ),
    },
    {
        "name": "pathogen_trial_run",
        "description": "Run the defined protocol: every arm × replicate with a distinct seed; returns per-arm metric summaries with bootstrap intervals.",
        "inputSchema": _schema({"reveal_truth": {"type": "boolean", "default": False}}),
    },
    {
        "name": "pathogen_trial_compare",
        "description": "Compare two arms of the last run: metric deltas, ratio, intervals and a plain-language verdict (is the difference bigger than the noise?).",
        "inputSchema": _schema(
            {"arm_a": {"type": "string"}, "arm_b": {"type": "string"}},
            ["arm_a", "arm_b"],
        ),
    },
    {
        "name": "pathogen_trial_export",
        "description": "Export the last run as CSV (one row per replicate) plus a JSON header with scenario, seed and protocol so the run can be reproduced.",
        "inputSchema": _schema(
            {"format": {"type": "string", "enum": ["csv", "json"], "default": "csv"}}
        ),
    },
]

# 分层 MCP: 一个环境五个端点, 智能体只开需要的尺度(上下文预算)
GROUPS: Dict[str, List[str]] = {
    "molecular": [
        "pathogen_genome",
        "pathogen_variants",
        "pathogen_resistance",
        "pathogen_escape",
        "pathogen_forecast",
        "pathogen_drug_match",
        "pathogen_vaccine_design",
        "pathogen_phylo",
        "pathogen_trace",
    ],
    "host": [
        "pathogen_catalog",
        "pathogen_setup",
        "pathogen_log",
        "pathogen_reset",
        "pathogen_inoculate",
        "pathogen_dose",
        "pathogen_host_immune",
        "pathogen_host_observe",
        "pathogen_advance",
    ],
    "diag": ["pathogen_diagnose", "pathogen_sequence", "pathogen_identify"],
    "pop": [
        "pathogen_pop_init",
        "pathogen_intervene",
        "pathogen_vaccinate",
        "pathogen_surveillance",
        "pathogen_spillover",
        "pathogen_pop_observe",
    ],
    "trial": [
        "pathogen_trial_define",
        "pathogen_trial_run",
        "pathogen_trial_compare",
        "pathogen_trial_export",
    ],
}


class PathEnvHub(EnvHub):
    """The pathogen environment's hub: five scale groups over one page."""

    def __init__(self) -> None:
        super().__init__(
            name="pathenv",
            tools=TOOLS,
            page_title=PATHOGEN_PAGE_TITLE,
            prefix="ph",
            groups=GROUPS,
        )


def tool_names(group: Optional[str] = None) -> List[str]:
    return [t["name"] for t in TOOLS if not group or t["name"] in GROUPS.get(group, [])]


HUB = PathEnvHub()
