import os
import json
import shutil
from pathlib import Path
from dotenv import load_dotenv
from dataclasses import dataclass
from typing import Dict, List, Any
from prompt_toolkit.formatted_text import HTML
load_dotenv()

class Prompt:
    # Version   = "[black on #cb7375]  VERSION  [/] "
    System    = "[black on #fbd367]   SYSTEM  [/] " # yellow
    Baseurl   = "[black on #dccebe]  BASEURL  [/] "
    APIkey    = "[black on #a77c61]  API KEY  [/] "
    Model     = "[black on #73BF94]   MODEL   [/] " # green
    ToolList  = "[black on #72C0F1]   TOOLS   [/] " # blue
    MCP       = "[black on #84764d]    MCP    [/] "
    Config    = "[black on #cb7375]   CONFIG  [/] "
    Tokens    = "[black on dark_cyan]   TOKENS  [/] "
    Tips      = "[white on grey19 ]   TIPS    [/] [dim]使用 /+Tab 查看命令 | ↑↓ 切换历史输入 -> 补全输入 | 输入空格, /q, /exit 或 Ctrl+C 退出 [/]"
    User      = "[black on #e5c07b]   USER    [/] "
    UserHTML  = HTML("<style fg='black' bg='#e5c07b'>   USER    </style> ")
    Assistant = "[black on cyan   ] ASSISTANT [/] "
    Tool      = "[black on orange3]   TOOL    [/] "
    Error     = "[white on #bb0000]   ERROR   [/] "
    History   = "[white on grey19 ]  HISTORY  [/] "
    Session   = "[white on grey19 ]  SESSION  [/] [dim]new session created[/]"
    Compact   = "[black on #ff4d00]  COMPACT  [/] "
    Interrupt = "[black on #F3476F] INTERRUPT [/] "
    Bgtask    = "[black on #8B4513]   BGTASK  [/] "
    Unknown   = "[white on #444444]  UNKNOWN  [/] "
    Warning   = "[black on #F7EC4D]  WARNING  [/] "
    Ended     = "[black on #F68D2E]   ENDED   [/] "
    RedLine   = "[red]━[/]"
    BlueLine  = "[blue]━[/]"

MAX_MODEL_LEN = {
    "qwen3.6-27b": 262144,
    "default": 131072,
}
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
COMPACT_TOKENS = int(os.getenv("COMPACT_TOKENS", 2048))
COMPACT_THRESHOLD = int(os.getenv("COMPACT_THRESHOLD", 1e20))
COMPACT_RATIO = float(os.getenv("COMPACT_RATIO", 0.95))
KEEP_RECENT_TOOL = int(os.getenv("KEEP_RECENT_TOOL", 1e8))
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
TOOL_TIMEOUTS = json.loads(os.getenv("TOOL_TIMEOUTS", '{"ask":0,"bash":360,"rag":330,"arxiv_search":330,"read_arxiv":330,"background_run":60,"run_job":60}'))
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
    "sift": "Sift - A fast and powerful alternative to grep, designed for searching codebases with support for various file types and encodings."
}
AVAILABLE_GREP_TOOLS = [tool for tool in GREP_TOOL_CANDIDATES if shutil.which(tool)]

SYSTEM = f"""You are a team lead and coding agent at {WORKDIR}.
Use `task` tools to plan and track work. Use run_job for long-running commands; check_job to inspect and kill_job to stop them. Spawn teammates and communicate via inboxes.
"""
SUBAGENT_SYSTEM = f"""You are a coding subagent at {WORKDIR}. Complete the given task, then summarize your findings.
"""


CHILD_TOOLS = [
    {
        "name": "bash", 
        "description": "Run a shell command.",
        "input_schema": {
            "type": "object", 
            "properties": {
                "command": {"type": "string"}
            }, 
            "required": ["command"]
        }
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
                    "description": "The grep-like command to use.\n" + "\n".join([GREP_TOOL_DESCRIPTION[t] for t in AVAILABLE_GREP_TOOLS])
                },
                "args": {
                    "type": "string",
                    "description": "Arguments passed after the grep-like command. Do not use the pipe symbol '|' to chain commands. Example: -n \"pattern\" <file>."
                }
            },
            "required": ["tool", "args"]
        }
    },
    {
        "name": "read", 
        "description": "Reads a file from the local filesystem. If the file is too long, you can specify a line offset (0-indexed) and limit to read a portion of the file.",
        "input_schema": {
            "type": "object", 
            "properties": {
                "path": {"type": "string"},
                "offset": {"type": "integer"},
                "limit": {"type": "integer"}
            }, 
            "required": ["path"]
        }
    },
    {
        "name": "write", 
        "description": "Write content to file.",
        "input_schema": {
            "type": "object", 
            "properties": {
                "path": {"type": "string"}, 
                "content": {"type": "string"}
            }, 
            "required": ["path", "content"]
        }
    },
    {
        "name": "edit", 
        "description": "Replace exact text in file.",
        "input_schema": {
            "type": "object", 
            "properties": {
                "path": {"type": "string"}, 
                "old_text": {"type": "string"}, 
                "new_text": {"type": "string"}
            }, 
            "required": ["path", "old_text", "new_text"]
        }
    },
    {
        "name": "load_skill",
        "description": "Load specialized knowledge by name.",
        "input_schema": {
            "type": "object", 
            "properties": {
                "name": {"type": "string", "description": "Skill name to load"}
            }, 
            "required": ["name"]
        }
    },
    {
        "name": "arxiv_search", 
        "description": "Search papers on arXiv.",
        "input_schema": {
            "type": "object", 
            "properties": {
                "query": {"type": "string"}, 
                "max_results": {"type": "integer"}
            },
            "required": ["query"]
        }
    },
    {
        "name": "read_arxiv", 
        "description": "Read paper content from arXiv by ID.", 
        "input_schema": {
            "type": "object", 
            "properties": {
                "paper_id": {"type": "string"}
            }, 
            "required": ["paper_id"]
        }
    },
    {
        "name": "compact", 
        "description": "Trigger manual conversation compression.",
        "input_schema": {
            "type": "object", 
            "properties": {
                "focus": {
                    "type": "string", 
                    "description": "What to preserve in the summary"
                }
            }
        }
    },
    {
        "name": "task_create", 
        "description": "Create a new task.",
        "input_schema": {
            "type": "object", 
            "properties": {
                "subject": {"type": "string"}, 
                "description": {"type": "string"}
            }, 
            "required": ["subject"]
        }
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
                    "enum": ["pending", "in_progress", "completed"]
                }, 
                "addBlockedBy": {
                    "type": "array", 
                    "items": {"type": "integer"}
                }, 
                "addBlocks": {
                    "type": "array", 
                    "items": {"type": "integer"}
                }
            }, 
            "required": ["task_id"]
        }
    },
    {
        "name": "task_list", 
        "description": "List all tasks with status summary.",
        "input_schema": {
            "type": "object", 
            "properties": {}
        }
    },
    {
        "name": "task_get", 
        "description": "Get full details of a task by ID.",
        "input_schema": {
            "type": "object", 
            "properties": {
                "task_id": {"type": "integer"}
            }, 
            "required": ["task_id"]
        }
    },
    {
        "name": "spawn_teammate", 
        "description": "Spawn a persistent teammate that runs in its own thread.",
        "input_schema": {
            "type": "object", 
            "properties": {
                "name": {"type": "string"}, 
                "role": {"type": "string"}, 
                "prompt": {"type": "string"}
            }, 
            "required": ["name", "role", "prompt"]
        }
    },
    {
        "name": "list_teammates", 
        "description": "List all teammates with name, role, status.",
        "input_schema": {
            "type": "object", 
            "properties": {}
        }
    },
    {
        "name": "send_message", 
        "description": "Send a message to a teammate's inbox.",
        "input_schema": {
            "type": "object", 
            "properties": {
                "to": {"type": "string"}, 
                "content": {"type": "string"}, 
                "msg_type": {
                    "type": "string", 
                    "enum": list(VALID_MSG_TYPES)
                }
            }, 
            "required": ["to", "content"]
        }
    },
    {
        "name": "read_inbox", 
        "description": "Read and drain the lead's inbox.",
        "input_schema": {
            "type": "object", 
            "properties": {}
        }
    },
    {
        "name": "broadcast", 
        "description": "Send a message to all teammates.",
        "input_schema": {
            "type": "object", 
            "properties": {
                "content": {"type": "string"}
            }, 
            "required": ["content"]
        }
    },
    {
        "name": "rag",
        "description": "Retrieve relevant information from database based on query.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string"}
            },
            "required": ["query"]
        }
    }
]
TOOLS = CHILD_TOOLS + [
    {
        "name": "subagent",
        "description": "Spawn a subagent with fresh context.",
        "input_schema": {
            "type": "object",
            "properties": {"prompt": {"type": "string"}},
            "required": ["prompt"],
        }
    },
    {
        "name": "run_job", 
        "description": "Run command in background thread. Returns task_id immediately.",
        "input_schema": {
            "type": "object", 
            "properties": {
                "command": {"type": "string"}
            }, 
            "required": ["command"]
        }
    },
    {
        "name": "check_job", 
        "description": "Check background task status. Omit task_id to list all.",
        "input_schema": {
            "type": "object", 
            "properties": {
                "task_id": {"type": "string"}
            }
        }
    },
    {
        "name": "kill_job",
        "description": "Kill a running background task by task_id. Omit task_id to kill all running tasks. Only running tasks can be killed.",
        "input_schema": {
            "type": "object",
            "properties": {
                "task_id": {"type": "string"}
            }
        }
    },
    {
        "name": "ask",
        "description": (
            "Ask the user a concise question when you need confirmation, a choice, "
            "or missing information before proceeding. This pauses the session until "
            "the user replies. Use stable ids per question; every answer echoes them. "
            "If you recommend an option, put it first and append \"(Recommended)\" to its label."
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
                                "description": "Stable id for this question; echoed in the answer."
                            },
                            "question": {"type": "string"},
                            "header": {
                                "type": "string",
                                "description": "Optional short heading, such as \"Confirm\" or \"Choose Mode\"."
                            },
                            "options": {
                                "type": "array",
                                "description": "Optional choices; put your recommended one first with \"(Recommended)\".",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "label": {"type": "string"},
                                        "description": {"type": "string"}
                                    },
                                    "required": ["label"]
                                }
                            },
                            "multi_select": {
                                "type": "boolean",
                                "description": "Whether more than one option may be selected. Defaults to false."
                            }
                        },
                        "required": ["question"]
                    }
                }
            },
            "required": ["questions"]
        }
    }
]

HEADERS = {
    "Content-Type": "application/json",
    "Accept": "application/json"
}

MCP_CONF = {
    "mcpServers": json.loads(os.getenv("MCP_ENDPOINT", "{}"))
}

API_ERRORS = [
    '相同的请求之前已经失败，请修改请求后重试', 
    'Your input image may contain content that is not allowed by our content safety system',
    'Input data may contain inappropriate content.',
    'Input image data may contain inappropriate content.',
    'thinking is enabled but reasoning_content is missing in assistant tool call message',
    'The request was rejected because it was considered high risk',
    'You exceeded your current quota, please check your plan and billing details.',
    'Failed to deserialize the JSON body into the target type: messages[1]: unknown variant `image_url`',
    '用户额度不足',
]

SUMMARY_PROMPT = """Summarize this conversation for continuity in the corresponding language. Include: 
1) Core mission, 2) What was accomplished, 3) Current state, 4) Key decisions made.
Be concise but preserve critical details (e.g. IDs, error messages, configs, paths). Keep it brief.\n
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
    history = '/history'
    compact = '/compact'
    team = '/team'
    inbox = '/inbox'
    reset = ['/new', '/reset']
    exit = ["", "/q", "/exit", "/quit"]

    @classmethod
    def all(cls):
        commands = []
        for attr_name, attr_value in cls.__dict__.items():
            if attr_name.startswith('__') and attr_name.endswith('__'):
                continue
            if callable(attr_value):
                continue
                
            if isinstance(attr_value, str):
                if attr_value.startswith('/'):
                    commands.append(attr_value)
            elif isinstance(attr_value, list):
                for item in attr_value:
                    if isinstance(item, str) and item.startswith('/'):
                        commands.append(item)
        return commands
