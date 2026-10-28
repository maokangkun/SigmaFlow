import os
import json
import shutil
from pathlib import Path
from dotenv import load_dotenv
from dataclasses import dataclass
from typing import Any, Dict
from prompt_toolkit.formatted_text import HTML

load_dotenv()


class Prompt:
    # Version   = "[black on #cb7375]  VERSION  [/] "
    System = "[black on #fbd367]   SYSTEM  [/] "  # yellow
    Baseurl = "[black on #dccebe]  BASEURL  [/] "
    APIkey = "[black on #a77c61]  API KEY  [/] "
    Model = "[black on #73BF94]   MODEL   [/] "  # green
    ToolList = "[black on #72C0F1]   TOOLS   [/] "  # blue
    MCP = "[black on #84764d]    MCP    [/] "
    Config = "[black on #cb7375]   CONFIG  [/] "
    Tokens = "[black on dark_cyan]   TOKENS  [/] "
    Tips = "[white on grey19 ]   TIPS    [/] [dim]使用 /+Tab 查看命令 | ↑↓ 切换历史输入 -> 补全输入 | 输入空格, /q, /exit 或 Ctrl+C 退出 [/]"
    User = "[black on #e5c07b]   USER    [/] "
    UserHTML = HTML("<style fg='black' bg='#e5c07b'>   USER    </style> ")
    Assistant = "[black on cyan   ] ASSISTANT [/] "
    Tool = "[black on orange3]   TOOL    [/] "
    Error = "[white on #bb0000]   ERROR   [/] "
    History = "[white on grey19 ]  HISTORY  [/] "
    Session = "[white on grey19 ]  SESSION  [/] [dim]new session created[/]"
    Compact = "[black on #ff4d00]  COMPACT  [/] "
    Interrupt = "[black on #F3476F] INTERRUPT [/] "
    Bgtask = "[black on #8B4513]   BGTASK  [/] "
    Unknown = "[white on #444444]  UNKNOWN  [/] "
    Warning = "[black on #F7EC4D]  WARNING  [/] "
    Ended = "[black on #F68D2E]   ENDED   [/] "
    RedLine = "[red]━[/]"
    BlueLine = "[blue]━[/]"


MAX_OUT_LEN = {
    "qwen3.6-27b": 262144,
    "default": 16384,
}

# ===== Configuration =====
WORKDIR = Path.cwd()
SKILLS_DIR = WORKDIR / "skills"
DATA_DIR = WORKDIR / ".data"
TRANSCRIPT_DIR = DATA_DIR / "transcripts"
INPUT_HISTORY = DATA_DIR / "chat_input_history"
TASKS_DIR = DATA_DIR / "tasks"
TEAM_DIR = DATA_DIR / "team"
INBOX_DIR = TEAM_DIR / "inbox"
DATA_DIR.mkdir(exist_ok=True, parents=True)

MODEL = os.getenv("MODEL")
API_KEY = os.getenv("API_KEY")
ANTHROPIC_BASE_URL = os.getenv("ANTHROPIC_BASE_URL")
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL")
MAX_TOKENS = int(os.getenv("MAX_TOKENS", MAX_OUT_LEN["default"]))
COMPACT_TOKENS = int(os.getenv("COMPACT_TOKENS", 4096))
COMPACT_THRESHOLD = int(os.getenv("COMPACT_THRESHOLD", 1e20))
# 触发阈值从 0.95 提前到 0.85(pi: window - reserveTokens, 给回答留余量)
COMPACT_RATIO = float(os.getenv("COMPACT_RATIO", 0.85))
KEEP_RECENT_TOOL = int(os.getenv("KEEP_RECENT_TOOL", 1e8))
# pi 式压缩: 保留最近若干 token 的原文, 只摘要更早部分(pi keepRecentTokens)
COMPACT_KEEP_RECENT_TOKENS = int(os.getenv("COMPACT_KEEP_RECENT_TOKENS", "16000"))
# 被摘要的消息少于这个数时不压缩, 避免频繁摘要小会话
COMPACT_MIN_DROPS = int(os.getenv("COMPACT_MIN_DROPS", "4"))
# 序列化正文时单条工具结果与单个工具参数的截断长度(pi: 工具结果 2000 字符)
COMPACT_SERIAL_RESULT_CHARS = int(os.getenv("COMPACT_SERIAL_RESULT_CHARS", "2000"))
COMPACT_SERIAL_ARG_CHARS = int(os.getenv("COMPACT_SERIAL_ARG_CHARS", "200"))
# 工具结果裁剪(dsh pruner 思路): 上下文逼近阈值时, 把较早的大结果保头截尾,
# 缓解 token 压力以推迟全量 summary 压缩; 原文转存到 transcripts 目录留档
PRUNE_TOOL_RESULTS = bool(int(os.getenv("PRUNE_TOOL_RESULTS", "1")))
PRUNE_SOFT_RATIO = float(os.getenv("PRUNE_SOFT_RATIO", "0.6"))
PRUNE_KEEP_RECENT = int(os.getenv("PRUNE_KEEP_RECENT", "6"))
PRUNE_MIN_CHARS = int(os.getenv("PRUNE_MIN_CHARS", "2000"))
PRUNE_HEAD_CHARS = int(os.getenv("PRUNE_HEAD_CHARS", "1200"))
PRUNE_TAIL_CHARS = int(os.getenv("PRUNE_TAIL_CHARS", "400"))
# 统一工具调用超时(秒): 外层兜底, 工具内部的超时(bash 300s 等)仍在里层生效;
# 特定工具可用 TOOL_TIMEOUTS 覆盖, 设 0 表示不限时(ask 由用户回答节奏决定, 默认不限时)
TOOL_TIMEOUT_DEFAULT = int(os.getenv("TOOL_TIMEOUT_DEFAULT", "180"))
TOOL_TIMEOUTS = json.loads(
    os.getenv(
        "TOOL_TIMEOUTS",
        '{"ask":0,"bash":360,"rag":330,"arxiv_search":330,"read_arxiv":330,"background_run":60,"run_job":60}',
    )
)
RAG_ENDPOINT = os.getenv("RAG_ENDPOINT")
Sciverse_API_KEY = os.getenv("Sciverse_API_KEY")

CMD_TIMEOUT = 600

VALID_MSG_TYPES = {
    "message",
    "broadcast",
    "shutdown_request",
    "shutdown_response",
    "plan_approval_response",
}

GREP_TOOL_CANDIDATES = [
    "rg",
    "rga",
    "grep",
    "ag",
    "ack",
    "ug",
    "pt",
    "sift",
]
GREP_TOOL_DESCRIPTION = {
    "rg": "ripgrep (rg) - A line-oriented search tool that recursively searches the current directory for a regex pattern. Known for its speed and efficiency.",
    "rga": "ripgrep-all (rga) - An extension of ripgrep that supports searching within various file types, including PDFs, Word documents, and more.",
    "grep": "GNU grep - A widely used command-line utility for searching plain-text data sets for lines that match a regular expression.",
    "ag": "The Silver Searcher (ag) - A code-searching tool similar to ack, but faster. It ignores files in .gitignore and other VCS ignore files by default.",
    "ack": "Ack - A tool like grep, optimized for programmers. It searches source code and ignores files that aren't likely to be relevant.",
    "ug": "ugrep - An ultra-fast grep tool with additional features like context-aware search and support for various encodings.",
    "pt": "The Platinum Searcher (pt) - A code search tool similar to ag, designed to be fast and user-friendly.",
    "sift": "Sift - A fast and powerful alternative to grep, designed for searching codebases with support for various file types and encodings.",
}
AVAILABLE_GREP_TOOLS = [tool for tool in GREP_TOOL_CANDIDATES if shutil.which(tool)]

SYSTEM = f"""You are a team lead and coding agent at {WORKDIR}.
Use `task` tools to plan and track work. Use run_job for long-running commands; check_job to inspect and kill_job to stop them. Spawn teammates and communicate via inboxes.
Save durable user preferences, feedback and project facts with `memory_save` so later sessions can recall them. Schedule future work with `schedule_cron`. For 'keep working until X holds' requests, set a `goal_set` condition instead of relying on a single pass.
"""

SUBAGENT_SYSTEM = f"""You are a coding subagent at {WORKDIR}. Complete the given task, then summarize your findings.
"""

CHILD_TOOLS = [
    {
        "name": "bash",
        "description": "Run a shell command.",
        "input_schema": {
            "type": "object",
            "properties": {"command": {"type": "string"}},
            "required": ["command"],
        },
    },
    {
        "name": "grep",
        "description": "Search text with an installed grep-like tool.",
        "input_schema": {
            "type": "object",
            "properties": {
                "tool": {
                    "type": "string",
                    "enum": AVAILABLE_GREP_TOOLS,
                    "description": "The grep-like command to use.\n"
                    + "\n".join(
                        [GREP_TOOL_DESCRIPTION[t] for t in AVAILABLE_GREP_TOOLS]
                    ),
                },
                "args": {
                    "type": "string",
                    "description": "Arguments passed after the grep-like command. Do not use the pipe symbol '|' to chain commands. Example: -n \"pattern\" <file>.",
                },
            },
            "required": ["tool", "args"],
        },
    },
    {
        "name": "read",
        "description": "Reads a file from the local filesystem. If the file is too long, you can specify a line offset (0-indexed) and limit to read a portion of the file.",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "offset": {"type": "integer"},
                "limit": {"type": "integer"},
            },
            "required": ["path"],
        },
    },
    {
        "name": "write",
        "description": "Write content to file.",
        "input_schema": {
            "type": "object",
            "properties": {"path": {"type": "string"}, "content": {"type": "string"}},
            "required": ["path", "content"],
        },
    },
    {
        "name": "edit",
        "description": "Replace exact text in file.",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "old_text": {"type": "string"},
                "new_text": {"type": "string"},
            },
            "required": ["path", "old_text", "new_text"],
        },
    },
    {
        "name": "load_skill",
        "description": "Load specialized knowledge by name.",
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Skill name to load"}
            },
            "required": ["name"],
        },
    },
    {
        "name": "arxiv_search",
        "description": "Search papers on arXiv.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "max_results": {"type": "integer"},
            },
            "required": ["query"],
        },
    },
    {
        "name": "read_arxiv",
        "description": "Read paper content from arXiv by ID.",
        "input_schema": {
            "type": "object",
            "properties": {"paper_id": {"type": "string"}},
            "required": ["paper_id"],
        },
    },
    {
        "name": "compact",
        "description": "Trigger manual conversation compression.",
        "input_schema": {
            "type": "object",
            "properties": {
                "focus": {
                    "type": "string",
                    "description": "What to preserve in the summary",
                }
            },
        },
    },
    {
        "name": "task_create",
        "description": "Create a new task.",
        "input_schema": {
            "type": "object",
            "properties": {
                "subject": {"type": "string"},
                "description": {"type": "string"},
            },
            "required": ["subject"],
        },
    },
    {
        "name": "task_update",
        "description": "Update a task's status or dependencies.",
        "input_schema": {
            "type": "object",
            "properties": {
                "task_id": {"type": "integer"},
                "status": {
                    "type": "string",
                    "enum": ["pending", "in_progress", "completed"],
                },
                "addBlockedBy": {"type": "array", "items": {"type": "integer"}},
                "addBlocks": {"type": "array", "items": {"type": "integer"}},
            },
            "required": ["task_id"],
        },
    },
    {
        "name": "task_list",
        "description": "List all tasks with status summary.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "task_get",
        "description": "Get full details of a task by ID.",
        "input_schema": {
            "type": "object",
            "properties": {"task_id": {"type": "integer"}},
            "required": ["task_id"],
        },
    },
    {
        "name": "spawn_teammate",
        "description": "Spawn a persistent teammate that runs in its own thread.",
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "role": {"type": "string"},
                "prompt": {"type": "string"},
            },
            "required": ["name", "role", "prompt"],
        },
    },
    {
        "name": "list_teammates",
        "description": "List all teammates with name, role, status.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "send_message",
        "description": "Send a message to a teammate's inbox.",
        "input_schema": {
            "type": "object",
            "properties": {
                "to": {"type": "string"},
                "content": {"type": "string"},
                "msg_type": {"type": "string", "enum": list(VALID_MSG_TYPES)},
            },
            "required": ["to", "content"],
        },
    },
    {
        "name": "read_inbox",
        "description": "Read and drain the lead's inbox.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "broadcast",
        "description": "Send a message to all teammates.",
        "input_schema": {
            "type": "object",
            "properties": {"content": {"type": "string"}},
            "required": ["content"],
        },
    },
    {
        "name": "rag",
        "description": "Retrieve relevant information from database based on query.",
        "input_schema": {
            "type": "object",
            "properties": {"query": {"type": "string"}},
            "required": ["query"],
        },
    },
]
TOOLS = CHILD_TOOLS + [
    {
        "name": "memory_save",
        "description": (
            "Save a durable, reusable memory for future sessions (user preference, "
            "repeated feedback, stable project fact, or external reference). "
            "Do NOT store temporary session/task state."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Short unique memory name"},
                "type": {
                    "type": "string",
                    "enum": ["user", "feedback", "project", "reference"],
                    "description": "Memory type",
                },
                "description": {"type": "string", "description": "One-line summary"},
                "body": {
                    "type": "string",
                    "description": "Full memory content in Markdown",
                },
            },
            "required": ["name", "type", "description", "body"],
        },
    },
    {
        "name": "memory_list",
        "description": "List stored memories with filenames and descriptions.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "memory_read",
        "description": "Read one memory record by filename (from memory_list).",
        "input_schema": {
            "type": "object",
            "properties": {"filename": {"type": "string"}},
            "required": ["filename"],
        },
    },
    {
        "name": "schedule_cron",
        "description": (
            "Schedule a prompt with a 5-field cron expression "
            "(minute hour day month weekday). It is delivered as a [Scheduled] "
            "message to this conversation when due (or set recurring for repeats)."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "cron": {
                    "type": "string",
                    "description": "e.g. '0 9 * * *' weekdays at 09:00",
                },
                "prompt": {"type": "string"},
                "recurring": {
                    "type": "boolean",
                    "description": "Defaults to true; false = one-shot",
                },
                "durable": {
                    "type": "boolean",
                    "description": "Survive service restarts. Default true.",
                },
            },
            "required": ["cron", "prompt"],
        },
    },
    {
        "name": "list_crons",
        "description": "List scheduled cron jobs.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "cancel_cron",
        "description": "Cancel a cron job by ID.",
        "input_schema": {
            "type": "object",
            "properties": {"job_id": {"type": "string"}},
            "required": ["job_id"],
        },
    },
    {
        "name": "goal_set",
        "description": (
            "Set a completion goal for this session. Until an independent evaluator "
            "confirms the goal is met, stopping is blocked and you are asked to keep "
            "working. Use for tasks like 'keep fixing until tests pass'."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "condition": {
                    "type": "string",
                    "description": "Verifiable completion condition, e.g. 'pytest tests/ exits 0 and lint passes'",
                }
            },
            "required": ["condition"],
        },
    },
    {
        "name": "goal_status",
        "description": "Show the current goal state and last evaluation reason.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "goal_clear",
        "description": "Clear the session goal and allow stopping freely.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "subagent",
        "description": "Spawn a subagent with fresh context.",
        "input_schema": {
            "type": "object",
            "properties": {"prompt": {"type": "string"}},
            "required": ["prompt"],
        },
    },
    {
        "name": "run_job",
        "description": "Run command as a background job. Returns job_id immediately.",
        "input_schema": {
            "type": "object",
            "properties": {"command": {"type": "string"}},
            "required": ["command"],
        },
    },
    {
        "name": "check_job",
        "description": "Check background job status or output. Omit job_id to list all jobs.",
        "input_schema": {
            "type": "object",
            "properties": {"job_id": {"type": "string"}},
        },
    },
    {
        "name": "kill_job",
        "description": "Kill a running background job by job_id. Omit job_id to kill all running jobs. Only running jobs can be killed.",
        "input_schema": {
            "type": "object",
            "properties": {"job_id": {"type": "string"}},
        },
    },
    {
        "name": "ask",
        "description": (
            "Ask the user a concise question when you need confirmation, a choice, "
            "or missing information before proceeding. This pauses the session until "
            "the user replies. Use stable ids per question; every answer echoes them. "
            'If you recommend an option, put it first and append "(Recommended)" to its label.'
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "questions": {
                    "type": "array",
                    "description": "Questions to ask the user before continuing. Usually one; each has a stable id.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "id": {
                                "type": "string",
                                "description": "Stable id for this question; echoed in the answer.",
                            },
                            "question": {"type": "string"},
                            "header": {
                                "type": "string",
                                "description": 'Optional short heading, such as "Confirm" or "Choose Mode".',
                            },
                            "options": {
                                "type": "array",
                                "description": 'Optional choices; put your recommended one first with "(Recommended)".',
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "label": {"type": "string"},
                                        "description": {"type": "string"},
                                    },
                                    "required": ["label"],
                                },
                            },
                            "multi_select": {
                                "type": "boolean",
                                "description": "Whether more than one option may be selected. Defaults to false.",
                            },
                        },
                        "required": ["question"],
                    },
                }
            },
            "required": ["questions"],
        },
    },
]

HEADERS = {"Content-Type": "application/json", "Accept": "application/json"}

MCP_CONF = {"mcpServers": json.loads(os.getenv("MCP_ENDPOINT", "{}"))}

API_ERRORS = [
    "相同的请求之前已经失败，请修改请求后重试",
    "Your input image may contain content that is not allowed by our content safety system",
    "Input data may contain inappropriate content.",
    "Input image data may contain inappropriate content.",
    "thinking is enabled but reasoning_content is missing in assistant tool call message",
    "The request was rejected because it was considered high risk",
    "You exceeded your current quota, please check your plan and billing details.",
    "Failed to deserialize the JSON body into the target type: messages[1]: unknown variant `image_url`",
    "用户额度不足",
]

# pi 结构化摘要: Goal/Progress/Decisions/Next Steps/Critical Context,
# 语言跟随对话; 文件清单由程序追加(不信任模型枚举)
SUMMARY_PROMPT = """You are compacting a long agent conversation so a fresh context can continue the work seamlessly. Summarize the conversation below in the SAME LANGUAGE the user used. Output ONLY the summary, in this exact structure:

## Goal
What the user is ultimately trying to accomplish.

## Constraints & Preferences
- Requirements, style or environment constraints the user stated.

## Progress
### Done
- [x] Completed work, with concrete outcomes
### In Progress
- [ ] Current work and its exact state
### Blocked
- Known issues, errors or blockers

## Key Decisions
- **Decision**: why it was made

## Next Steps
1. What should happen next, in order

## Critical Context
- Data, IDs, paths, error messages, configs and numbers the next context MUST keep (verbatim).

Rules: keep filenames, function names, identifiers, numbers, error text and commands exactly as they appear; omit small talk; no preamble like "Here is the summary".\n
"""


@dataclass
class MCPTool:
    name: str
    description: str
    input_schema: Dict[str, Any]
    server_name: str
    server_url: str
    server_headers: Dict[str, Any]


class SLASH_CMD:
    history = "/history"
    compact = "/compact"
    team = "/team"
    inbox = "/inbox"
    reset = ["/new", "/reset"]
    exit = ["", "/q", "/exit", "/quit"]

    @classmethod
    def all(cls):
        commands = []
        for attr_name, attr_value in cls.__dict__.items():
            if attr_name.startswith("__") and attr_name.endswith("__"):
                continue
            if callable(attr_value):
                continue

            if isinstance(attr_value, str):
                if attr_value.startswith("/"):
                    commands.append(attr_value)
            elif isinstance(attr_value, list):
                for item in attr_value:
                    if isinstance(item, str) and item.startswith("/"):
                        commands.append(item)
        return commands
