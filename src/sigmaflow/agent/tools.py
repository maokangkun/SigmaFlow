import re
import yaml
import time
import json
import uuid
import arxiv
import asyncio
import aiohttp
import requests
import threading
import subprocess
from rich import print
from pathlib import Path
from collections import defaultdict
from .utils import KnightRiderStatus
from .conf import *

# -- Tools --
def safe_path(p: str) -> Path:
    path = (WORKDIR / p).resolve()
    if not path.is_relative_to(WORKDIR):
        raise ValueError(f"Path escapes workspace: {p}")
    return path

def run_ls(param: str) -> str:
    command = f"ls {param}" if param else "ls"
    try:
        r = subprocess.run(command, shell=True, cwd=WORKDIR,
                            capture_output=True, text=True, timeout=30)
        out = (r.stdout + r.stderr).strip()
        return out or "(no files)"
    except Exception as e:
        return f"Error: {e}"

def run_bash(command: str) -> str:
    if command == "":
        return "Error: command cannot be empty"
    timeout = 600
    dangerous = ["rm -rf /", "sudo", "shutdown", "reboot", "> /dev/"]
    if any(d in command for d in dangerous):
        return "Error: Dangerous command blocked"
    try:
        r = subprocess.run(command, shell=True, cwd=WORKDIR,
                           capture_output=True, text=True, timeout=timeout)
        out = (r.stdout + r.stderr).strip()
        return out or "(no output)"
    except subprocess.TimeoutExpired:
        return f"Error: Timeout ({timeout}s)"
    except Exception as e:
        return f"Error: {e}"

def run_read(path: str, limit: int = None) -> str:
    try:
        path = (WORKDIR / path).resolve()
        text = path.read_text()
        lines = text.splitlines()
        if limit and limit < len(lines):
            lines = lines[:limit] + [f"... ({len(lines) - limit} more lines)"]
        return "\n".join(lines)[:50000]
    except Exception as e:
        return f"Error: {e}"

def run_write(path: str, content: str) -> str:
    if content == "":
        return "Error: content cannot be empty"
    try:
        fp = safe_path(path)
        fp.parent.mkdir(parents=True, exist_ok=True)
        fp.write_text(content)
        return f"Wrote {len(content)} bytes to {path}"
    except Exception as e:
        return f"Error: {e}"

def run_edit(path: str, old_text: str, new_text: str) -> str:
    if old_text == "" or new_text == "":
        return "Error: old_text and new_text cannot be empty"
    try:
        fp = safe_path(path)
        content = fp.read_text()
        if old_text not in content:
            return f"Error: old_text not found in {path}"
        fp.write_text(content.replace(old_text, new_text, 1))
        return f"Edited {path}"
    except Exception as e:
        return f"Error: {e}"

def arxiv_search(query: str, max_results: int = 5) -> str:
    if query == "":
        return "Error: query cannot be empty"
    client = arxiv.Client()
    search = arxiv.Search(query=query, max_results=max_results, sort_by=arxiv.SortCriterion.SubmittedDate)
    results = []
    for result in client.results(search):
        paper = {
            "id": result.entry_id.split('/abs/')[-1],
            "title": result.title,
            "authors": [a.name for a in result.authors],
            "abstract": result.summary,
            "publicationDate": result.published.astimezone().strftime("%Y-%m-%d"),
            "url": result.entry_id,
        }
        results.append(paper)
    return results[::-1] # oldest first

def read_arxiv(paper_id: str) -> str:
    if not paper_id: return "Error: paper_id is required"
    command = f"arxiv2md {paper_id} --remove-refs --remove-toc -o -"
    try:
        r = subprocess.run(command, shell=True, cwd=WORKDIR,
                           capture_output=True, text=True, timeout=120)
        out = (r.stdout + r.stderr).strip()
        return out[:50000] if out else "(no output)"
    except subprocess.TimeoutExpired:
        return "Error: Timeout (120s)"

def rag(query: str):
    if not query: return "Error: query cannot be empty"
    d = {
        "query": query,
        "mode": "naive",
        "chunk_top_k": 5,
        "enable_rerank": False
    }
    r = requests.post(RAG_ENDPOINT, json=d, timeout=300)
    j = r.json()
    return j['data'].get('chunks', [])

# -- SkillLoader: scan skills/<name>/SKILL.md with YAML frontmatter --
class SkillLoader:
    def __init__(self, skills_dir: Path):
        self.skills_dir = skills_dir
        self.skills = {}
        self._load_all()

    def _load_all(self):
        if not self.skills_dir.exists():
            return
        for f in sorted(self.skills_dir.rglob("SKILL.md")):
            text = f.read_text()
            meta, body = self._parse_frontmatter(text)
            name = meta.get("name", f.parent.name)
            self.skills[name] = {"meta": meta, "body": body, "path": str(f)}

    def _parse_frontmatter(self, text: str) -> tuple:
        """Parse YAML frontmatter between --- delimiters."""
        match = re.match(r"^---\n(.*?)\n---\n(.*)", text, re.DOTALL)
        if not match:
            return {}, text
        meta = yaml.safe_load(match.group(1).strip())
        return meta, match.group(2).strip()

    def get_descriptions(self) -> str:
        skill_prompt = f"Use `load_skill` to access specialized knowledge before tackling unfamiliar topics.\nSkills dir: {self.skills_dir}\nSkills available:\n"

        """Layer 1: short descriptions for the system prompt."""
        if not self.skills:
            return skill_prompt + "(no skills available)"
        lines = []
        for name, skill in self.skills.items():
            desc = skill["meta"].get("description", "No description")
            tags = skill["meta"].get("tags", "")
            line = f"  - {name}: {desc}"
            if tags:
                line += f" [{tags}]"
            lines.append(line.strip())
        return skill_prompt + "\n".join(lines)

    def get_content(self, name: str) -> str:
        """Layer 2: full skill body returned in tool_result."""
        skill = self.skills.get(name)
        if not skill:
            return f"Error: Unknown skill '{name}'. Available: {', '.join(self.skills.keys())}"
        return f"<skill name=\"{name}\">\n{skill['body']}\n</skill>"

skill_loader = SkillLoader(SKILLS_DIR)

# -- Compactor: compact history --
class Compactor:
    def __init__(self, transript_dir: Path, client=None):
        self.transript_dir = transript_dir
        self.client = client

    # -- Layer 1: tool_compact - replace old tool results with placeholders --
    def tool_compact(self, messages: list) -> list:
        # Collect (msg_index, part_index, tool_result_dict) for all tool_result entries
        tool_results = []
        for msg_idx, msg in enumerate(messages):
            if msg["role"] == "user" and isinstance(msg.get("content"), list):
                for part_idx, part in enumerate(msg["content"]):
                    if isinstance(part, dict) and part.get("type") == "tool_result":
                        tool_results.append((msg_idx, part_idx, part))
        if len(tool_results) <= KEEP_RECENT:
            return messages
        # Find tool_name for each result by matching tool_use_id in prior assistant messages
        tool_name_map = {}
        for msg in messages:
            if msg["role"] == "assistant":
                content = msg.get("content", [])
                if isinstance(content, list):
                    for block in content:
                        if hasattr(block, "type") and block.type == "tool_use":
                            tool_name_map[block.id] = block.name
        # Clear old results (keep last KEEP_RECENT)
        to_clear = tool_results[:-KEEP_RECENT]
        for _, _, result in to_clear:
            if isinstance(result.get("content"), str) and len(result["content"]) < 100: continue
            tool_id = result.get("tool_use_id", "")
            tool_name = tool_name_map.get(tool_id, "unknown")
            result["content"] = f"[Previous: used {tool_name}]"
        return messages

    # -- Layer 2: summary_compact - save transcript, summarize, replace messages --
    def summary_compact(self, messages: list) -> list:
        # Save full transcript to disk
        self.transript_dir.mkdir(exist_ok=True)
        transcript_path = self.transript_dir / f"transcript_{int(time.time())}.jsonl"
        with open(transcript_path, "w") as f:
            for msg in messages:
                f.write(json.dumps(msg, default=str, ensure_ascii=False) + "\n")
        print(f"{' '*12}transcript saved: {transcript_path}")
        # Ask LLM to summarize
        conversation_text = json.dumps(messages, default=str)
        with KnightRiderStatus("", width=11, color="#5c9cf5", fps=30):
            response = self.client.messages.create(
                model=MODEL,
                messages=[{"role": "user", "content":
                    "Summarize this conversation for continuity. Include: "
                    "1) What was accomplished, 2) Current state, 3) Key decisions made. "
                    "Be concise but preserve critical details.\n\n" + conversation_text}],
                max_tokens=COMPACT_TOKENS,
            )
        summary = response.content[0].text
        print(f"{Prompt.Tokens}compress to: {response.usage.output_tokens}")

        return [
            {"role": "user", "content": f"[Conversation compressed. Transcript: {transcript_path}]\n\n{summary}"},
            {"role": "assistant", "content": "Understood. I have the context from the summary. Continuing."},
        ]

    def estimate_tokens(self, messages: list) -> int:
        """Rough token count: ~4 chars per token."""
        return len(str(messages)) // 4

    def auto_compact(self, messages: list, force=False) -> list:
        messages = self.tool_compact(messages)
        if force or (n := self.estimate_tokens(messages)) > THRESHOLD:
            info = f"{Prompt.Compact}manual compact" if force else f"{Prompt.Compact}estimate tokens: {n}, auto compact triggered"
            print(info)
            messages = self.summary_compact(messages)
        return messages

# -- TaskManager: CRUD with dependency graph, persisted as JSON files --
class TaskManager:
    def __init__(self, tasks_dir: Path):
        self.dir = tasks_dir
        self.dir.mkdir(exist_ok=True)
        self._next_id = self._max_id() + 1

    def _max_id(self) -> int:
        ids = [int(f.stem.split("_")[1]) for f in self.dir.glob("task_*.json")]
        return max(ids) if ids else 0

    def _load(self, task_id: int) -> dict:
        path = self.dir / f"task_{task_id}.json"
        if not path.exists():
            raise ValueError(f"Task {task_id} not found")
        return json.loads(path.read_text())

    def _save(self, task: dict):
        path = self.dir / f"task_{task['id']}.json"
        path.write_text(json.dumps(task, indent=2))

    def create(self, subject: str, description: str = "") -> str:
        task = {
            "id": self._next_id, "subject": subject, "description": description,
            "status": "pending", "blockedBy": [], "blocks": [], "owner": "",
        }
        self._save(task)
        self._next_id += 1
        return json.dumps(task, indent=2)

    def get(self, task_id: int) -> str:
        return json.dumps(self._load(task_id), indent=2)

    def update(self, task_id: int, status: str = None,
               add_blocked_by: list = None, add_blocks: list = None) -> str:
        task = self._load(task_id)
        if status:
            if status not in ("pending", "in_progress", "completed"):
                raise ValueError(f"Invalid status: {status}")
            task["status"] = status
            # When a task is completed, remove it from all other tasks' blockedBy
            if status == "completed":
                self._clear_dependency(task_id)
        if add_blocked_by:
            task["blockedBy"] = list(set(task["blockedBy"] + add_blocked_by))
        if add_blocks:
            task["blocks"] = list(set(task["blocks"] + add_blocks))
            # Bidirectional: also update the blocked tasks' blockedBy lists
            for blocked_id in add_blocks:
                try:
                    blocked = self._load(blocked_id)
                    if task_id not in blocked["blockedBy"]:
                        blocked["blockedBy"].append(task_id)
                        self._save(blocked)
                except ValueError:
                    pass
        self._save(task)
        return json.dumps(task, indent=2)

    def _clear_dependency(self, completed_id: int):
        """Remove completed_id from all other tasks' blockedBy lists."""
        for f in self.dir.glob("task_*.json"):
            task = json.loads(f.read_text())
            if completed_id in task.get("blockedBy", []):
                task["blockedBy"].remove(completed_id)
                self._save(task)

    def list_all(self) -> str:
        tasks = []
        for f in sorted(self.dir.glob("task_*.json")):
            tasks.append(json.loads(f.read_text()))
        if not tasks:
            return "No tasks."
        lines = []
        for t in tasks:
            marker = {"pending": "[ ]", "in_progress": "[>]", "completed": "[x]"}.get(t["status"], "[?]")
            blocked = f" (blocked by: {t['blockedBy']})" if t.get("blockedBy") else ""
            lines.append(f"{marker} #{t['id']}: {t['subject']}{blocked}")
        return "\n".join(lines)

TM = TaskManager(TASKS_DIR)

# -- BackgroundManager: threaded execution + notification queue --
class BackgroundManager:
    def __init__(self):
        self.tasks = {}  # task_id -> {status, result, command}
        self._notification_queue = []  # completed task results
        self._lock = threading.Lock()

    def run(self, command: str) -> str:
        """Start a background thread, return task_id immediately."""
        task_id = str(uuid.uuid4())[:8]
        self.tasks[task_id] = {"status": "running", "result": None, "command": command}
        thread = threading.Thread(
            target=self._execute, args=(task_id, command), daemon=True
        )
        thread.start()
        return f"Background task {task_id} started: {command[:80]}"

    def _execute(self, task_id: str, command: str):
        """Thread target: run subprocess, capture output, push to queue."""
        try:
            r = subprocess.run(
                command, shell=True, cwd=WORKDIR,
                capture_output=True, text=True, timeout=300
            )
            output = (r.stdout + r.stderr).strip()[:50000]
            status = "completed"
        except subprocess.TimeoutExpired:
            output = "Error: Timeout (300s)"
            status = "timeout"
        except Exception as e:
            output = f"Error: {e}"
            status = "error"
        self.tasks[task_id]["status"] = status
        self.tasks[task_id]["result"] = output or "(no output)"
        with self._lock:
            self._notification_queue.append({
                "task_id": task_id,
                "status": status,
                "command": command[:80],
                "result": (output or "(no output)")[:500],
            })

    def check(self, task_id: str = None) -> str:
        """Check status of one task or list all."""
        if task_id:
            t = self.tasks.get(task_id)
            if not t:
                return f"Error: Unknown task {task_id}"
            return f"[{t['status']}] {t['command'][:60]}\n{t.get('result') or '(running)'}"
        lines = []
        for tid, t in self.tasks.items():
            lines.append(f"{tid}: ({t['status']}) {t['command'][:60]}")
        return "\n".join(lines) if lines else "No background tasks."

    def drain_notifications(self) -> list:
        """Return and clear all pending completion notifications."""
        with self._lock:
            notifs = list(self._notification_queue)
            self._notification_queue.clear()
        return notifs

    @property
    def is_finished(self):
        return all(t["status"] != "running" for t in self.tasks.values())

BG = BackgroundManager()

# -- MessageBus: JSONL inbox per teammate --
class MessageBus:
    def __init__(self, inbox_dir: Path):
        self.dir = inbox_dir
        self.dir.mkdir(parents=True, exist_ok=True)

    def send(self, sender: str, to: str, content: str,
             msg_type: str = "message", extra: dict = None) -> str:
        if msg_type not in VALID_MSG_TYPES:
            return f"Error: Invalid type '{msg_type}'. Valid: {VALID_MSG_TYPES}"
        msg = {
            "type": msg_type,
            "from": sender,
            "content": content,
            "timestamp": time.time(),
        }
        if extra:
            msg.update(extra)
        inbox_path = self.dir / f"{to}.jsonl"
        with open(inbox_path, "a") as f:
            f.write(json.dumps(msg) + "\n")
        return f"Sent {msg_type} to {to}"

    def read_inbox(self, name: str) -> list:
        inbox_path = self.dir / f"{name}.jsonl"
        if not inbox_path.exists():
            return []
        messages = []
        for line in inbox_path.read_text().strip().splitlines():
            if line:
                messages.append(json.loads(line))
        inbox_path.write_text("")
        return messages

    def broadcast(self, sender: str, content: str, teammates: list) -> str:
        count = 0
        for name in teammates:
            if name != sender:
                self.send(sender, name, content, "broadcast")
                count += 1
        return f"Broadcast to {count} teammates"

BUS = MessageBus(INBOX_DIR)

# -- MCPClient: list tools and call tools on configured MCP servers --
# class MCPClient:
#     def __init__(self):
#         self.config = MCP_CONF
#         self.session: aiohttp.ClientSession | None = None
#         self.tools = {}
#         self.meta = defaultdict(int)
#         asyncio.run(self._init_mcp())

#     async def __aenter__(self):
#         self.session = aiohttp.ClientSession()
#         return self

#     async def __aexit__(self, *args):
#         if self.session:
#             await self.session.close()

#     async def _init_mcp(self):
#         async with self:
#             for server_name in self.config["mcpServers"]:
#                 tools = await self.list_tools(server_name)
#                 for tool in tools:
#                     self.tools[tool.name] = tool
#                     self.meta[tool.server_name] += 1

#     async def list_tools(self, server_name: str) -> List[MCPTool]:
#         server_cfg = self.config["mcpServers"][server_name]
#         url = server_cfg["url"]

#         payload = {
#             "jsonrpc": "2.0",
#             "id": 1,
#             "method": "tools/list",
#             "params": {}
#         }

#         async with self.session.post(
#             url,
#             json=payload,
#             headers=HEADERS
#         ) as resp:
#             resp.raise_for_status()
#             data = await resp.json()

#             return [
#                 MCPTool(
#                     name=t["name"],
#                     description=t.get("description", ""),
#                     input_schema=t.get("inputSchema", {}),
#                     server_name=server_name,
#                     server_url=url,
#                 )
#                 for t in data.get("result", {}).get("tools", [])
#             ]

#     async def call_tool(self, tool_name: str, arguments: Dict[str, Any]) -> str:
#         tool = self.tools[tool_name]
#         payload = {
#             "jsonrpc": "2.0",
#             "id": 1,
#             "method": "tools/call",
#             "params": {
#                 "name": tool.name,
#                 "arguments": arguments
#             }
#         }
#         try:
#             async with self:
#                 async with self.session.post(
#                     tool.server_url,
#                     json=payload,
#                     headers=HEADERS
#                 ) as resp:
#                     resp.raise_for_status()
#                     data = await resp.json()
#                     return data.get("result", {}).get("content", "")
#         except Exception as e:
#             return f'Error: {str(e)}'
class MCPClient:
    def __init__(self):
        self.config = MCP_CONF
        self.session = requests.Session()
        self.session.headers.update(HEADERS)
        # self.session.proxies.update({
        #     "http": "socks5h://127.0.0.1:1080",
        #     "https": "socks5h://127.0.0.1:1080",
        # })
        self.tools = {}
        self.meta = defaultdict(int)
        self._init_mcp()

    def _init_mcp(self):
        for server_name in self.config["mcpServers"]:
            tools = self.list_tools(server_name)
            for tool in tools:
                self.tools[tool.name] = tool
                self.meta[tool.server_name] += 1

    def list_tools(self, server_name: str) -> List['MCPTool']:
        server_cfg = self.config["mcpServers"][server_name]
        url = server_cfg["url"]
        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/list",
            "params": {}
        }
        resp = self.session.post(url, json=payload, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        return [
            MCPTool(
                name=t["name"],
                description=t.get("description", ""),
                input_schema=t.get("inputSchema", {}),
                server_name=server_name,
                server_url=url,
            )
            for t in data.get("result", {}).get("tools", [])
        ]

    def call_tool(self, tool_name: str, arguments: Dict[str, Any]) -> str:
        tool = self.tools[tool_name]
        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": tool.name,
                "arguments": arguments
            }
        }
        try:
            resp = self.session.post(tool.server_url, json=payload, timeout=60)
            resp.raise_for_status()
            data = resp.json()
            return data.get("result", {}).get("content", "")
        except Exception as e:
            return f'Error: {str(e)}'

    def close(self):
        self.session.close()


# -- The dispatch map: {tool_name: handler} --
TOOL_HANDLERS = {
    "bash":       lambda **kw: run_bash(kw.get("command", "")),
    "read_file":  lambda **kw: run_read(kw["path"], kw.get("limit")),
    "write_file": lambda **kw: run_write(kw["path"], kw.get("content", "")),
    "edit_file":  lambda **kw: run_edit(kw["path"], kw.get("old_text", ""), kw.get("new_text", "")),
    "load_skill": lambda **kw: skill_loader.get_content(kw.get("name", "")),
    "arxiv_search": lambda **kw: arxiv_search(kw.get("query", ""), kw.get("max_results", 5)),
    "read_arxiv":   lambda **kw: read_arxiv(kw.get("paper_id", "")),
    "compact":    lambda **kw: "Manual compression requested.",
    "task_create": lambda **kw: TM.create(kw["subject"], kw.get("description", "")),
    "task_update": lambda **kw: TM.update(kw["task_id"], kw.get("status"), kw.get("addBlockedBy"), kw.get("addBlocks")),
    "task_list":   lambda **kw: TM.list_all(),
    "task_get":    lambda **kw: TM.get(kw["task_id"]),
    "background_run":   lambda **kw: BG.run(kw["command"]),
    "check_background": lambda **kw: BG.check(kw.get("task_id")),
    "send_message":    lambda **kw: BUS.send("lead", kw["to"], kw["content"], kw.get("msg_type", "message")),
    "read_inbox":      lambda **kw: json.dumps(BUS.read_inbox("lead"), indent=2),
    "broadcast":       lambda **kw: BUS.broadcast("lead", kw["content"], TEAM.member_names()),
    "rag":             lambda **kw: rag(kw.get("query", "")),
    "ls":              lambda **kw: run_ls(kw.get("param", "")),
}

MCP = MCPClient()
for mcp_tool in MCP.tools.values():
    t = {
        "name": mcp_tool.name,
        "description": mcp_tool.description,
        "input_schema": mcp_tool.input_schema
    }
    CHILD_TOOLS.append(t)
    TOOLS.append(t)

    def make_handler(name, **kwargs):
        def _handler(**kwargs):
            # return asyncio.run(MCP.call_tool(name, kwargs))
            return MCP.call_tool(name, kwargs)
        return _handler

    TOOL_HANDLERS[mcp_tool.name] = make_handler(mcp_tool.name)
