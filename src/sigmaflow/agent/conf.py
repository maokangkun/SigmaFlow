import os
from pathlib import Path
from dotenv import load_dotenv
from dataclasses import dataclass
from typing import Dict, List, Any
from prompt_toolkit.formatted_text import HTML
load_dotenv(override=True)

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
MAX_TOKENS = 8000
COMPACT_TOKENS = 2000
KEEP_RECENT = 10000
THRESHOLD = 5000000000
RAG_ENDPOINT = os.getenv("RAG_ENDPOINT")

VALID_MSG_TYPES = {
    "message",
    "broadcast",
    "shutdown_request",
    "shutdown_response",
    "plan_approval_response",
}

SYSTEM = f"""You are a team lead and coding agent at {WORKDIR}.
Use load_skill to access specialized knowledge before tackling unfamiliar topics. Use task tools to plan and track work. Use background_run for long-running commands. Spawn teammates and communicate via inboxes.

Skills available:
"""
SUBAGENT_SYSTEM = f"""You are a coding subagent at {WORKDIR}. Complete the given task, then summarize your findings.

Skills available:
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
        "name": "read_file", 
        "description": "Read file contents.",
        "input_schema": {
            "type": "object", 
            "properties": {
                "path": {"type": "string"}, 
                "limit": {"type": "integer"}
            }, 
            "required": ["path"]
        }
    },
    {
        "name": "write_file", 
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
        "name": "edit_file", 
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
        "name": "background_run", 
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
        "name": "check_background", 
        "description": "Check background task status. Omit task_id to list all.",
        "input_schema": {
            "type": "object", 
            "properties": {
                "task_id": {"type": "string"}
            }
        }
    }
]

HEADERS = {
    "Content-Type": "application/json",
    "Accept": "application/json"
}

MCP_CONF = {
    "mcpServers": {
        "medical-apis": {
            "url": "https://mcp.cloud.curiloo.com/tools/unified/mcp"
        }
    }
}

API_ERRORS = [
    '相同的请求之前已经失败，请修改请求后重试', 
    'Your input image may contain content that is not allowed by our content safety system',
    'Input data may contain inappropriate content.',
    'thinking is enabled but reasoning_content is missing in assistant tool call message',
    'The request was rejected because it was considered high risk',
]

@dataclass
class MCPTool:
    name: str
    description: str
    input_schema: Dict[str, Any]
    server_name: str
    server_url: str

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