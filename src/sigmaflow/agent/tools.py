import re
import shlex
from typing import Any
import yaml
import time
import json
import uuid
import difflib
import arxiv
import requests
import threading
import subprocess
import shutil
from rich import print
from pathlib import Path
from collections import defaultdict
from .utils import KnightRiderStatus
from .conf import *
from .sciverse_api import SCIVERSE_TOOL_HANDLERS, SCIVERSE_TOOLS

# -- Tools --
# 会话工作目录: Science 的聊天按项目绑定工作目录(存 thread-local, 由服务层在
# 工具执行线程上设置); 未设置时保持默认 WORKDIR(应用根), 行为不变。
# 沙箱语义随之切换: 相对路径解析与越界检查都以当前会话工作目录为根。
_SESSION_WORKDIR = threading.local()


def set_session_workdir(path) -> None:
    """Bind the calling thread's session workdir; None restores the default."""
    _SESSION_WORKDIR.workdir = Path(path).resolve() if path else None


def get_session_workdir() -> Path:
    """Resolve the effective workdir for tool execution on this thread."""
    override = getattr(_SESSION_WORKDIR, "workdir", None)
    return Path(override) if override else WORKDIR


def safe_path(p: str) -> Path:
    root = get_session_workdir()
    path = (root / p).resolve()
    if not path.is_relative_to(root):
        raise ValueError(f"Path escapes workspace: {p}")
    return path

def run_bash(command: str) -> str:
    if command == "":
        return "Error: command cannot be empty"
    dangerous = ["rm -rf /", "sudo", "shutdown", "reboot", "> /dev/"]
    if any(d in command for d in dangerous):
        return "Error: Dangerous command blocked"
    try:
        r = subprocess.run(command, shell=True, cwd=get_session_workdir(),
                           capture_output=True, text=True, timeout=CMD_TIMEOUT)
        out = (r.stdout + r.stderr).strip()
        return out or "(no output)"
    except subprocess.TimeoutExpired:
        return f"Error: Timeout ({CMD_TIMEOUT}s)"
    except Exception as e:
        return f"Error: {e}"

def run_grep(tool: str, args: str) -> str:
    if not tool:
        return f"Error: tool is required. Available: {', '.join(AVAILABLE_GREP_TOOLS) or '(none)'}"
    if not args:
        return "Error: args cannot be empty"
    if tool not in AVAILABLE_GREP_TOOLS or not shutil.which(tool):
        return f"Error: unavailable grep tool '{tool}'. Available: {', '.join(AVAILABLE_GREP_TOOLS) or '(none)'}"
    try:
        argv = shlex.split(args)
        if argv[0] == tool: argv = argv[1:]
    except ValueError as e:
        return f"Error: failed to parse args: {e}"
    if not argv:
        return "Error: args cannot be empty"
    try:
        r = subprocess.run(
            [tool, *argv],
            cwd=get_session_workdir(),
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            timeout=CMD_TIMEOUT,
        )
        out = (r.stdout + r.stderr).strip()
        return (out or "(no matches)")[:50000]
    except subprocess.TimeoutExpired:
        return f"Error: Timeout ({CMD_TIMEOUT}s)"
    except Exception as e:
        return f"Error: {e}"

def run_read(path: str, offset: int = None, limit: int = None) -> str:
    if path == "":
        return "Error: path cannot be empty"
    try:
        path = (get_session_workdir() / path).resolve()
        text = path.read_text()
        lines = text.splitlines()

        if offset and 0 < offset < len(lines):
            lines = [f"[{offset} lines skipped] ..."] + lines[offset:]
            if limit: limit += 1

        if limit and limit < len(lines):
            lines = lines[:limit] + [f"... [{len(lines) - limit} more lines]"]

        return "\n".join(lines)[:50000]
    except Exception as e:
        return f"Error: {e}"

def run_write(path: str, content: str) -> str:
    if path == "":
        return "Error: path cannot be empty"
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
    if path == "":
        return "Error: path cannot be empty"
    if old_text == "" or new_text == "":
        return "Error: old_text and new_text cannot be empty"
    try:
        fp = safe_path(path)
        content = fp.read_text()
        if old_text not in content:
            return f"Error: old_text not found in {path}"
        new_content = content.replace(old_text, new_text, 1)
        fp.write_text(new_content)
        diff = difflib.unified_diff(
            content.splitlines(),
            new_content.splitlines(),
            fromfile=f"old: {path}",
            tofile=f"new: {path}",
            lineterm="",
        )
        return "\n".join(diff) or f"Edited {path} (no changes)"
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
        r = subprocess.run(command, shell=True, cwd=get_session_workdir(),
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
        return f"<skill name=\"{name}\" path=\"{skill['path']}\">\n{skill['body']}\n</skill>"

skill_loader = SkillLoader(SKILLS_DIR)

# -- Compactor: compact history --
# 参考 pi 的 compaction 设计重写: 触发提前(window-reserve)/保尾窗口/
# 结构化摘要/previousSummary 迭代/文件清单累计/序列化截断/切点永不落在
# 工具结果上。旧方案一次性丢掉全部历史, 模型失去近期工作细节; 新方案
# 保留最近约 COMPACT_KEEP_RECENT_TOKENS 的原文, 只替换更早的部分。

_COMPACT_MARKER = "[Conversation compressed"

# 摘要时视为文件操作的工具名: read_* 只读, write/edit 修改
_COMPACT_READ_TOOLS = {"read", "read_arxiv", "rag"}
_COMPACT_WRITE_TOOLS = {"write", "edit"}


class Compactor:
    def __init__(self, transript_dir: Path, client=None, max_model_len=None, model=None, overrides=None):
        self.transript_dir = transript_dir
        self.client = client
        self.max_model_len = max_model_len
        self.model = model
        self.last_meta: Any = None  # 上次压缩的事件元数据(dict)或 None
        # 运行参数覆盖: web 设置面板按 key 写入; 缺省回落到模块常量(env 可调)
        self.overrides: dict = dict(overrides or {})

    def _cfg(self, key: str, kind, default_value):
        # 读取一个压缩参数: overrides(设置面板) > 模块常量(env) > 内置默认
        try:
            v = self.overrides.get(key)
            if v is None:
                v = globals().get(key, default_value)
            return kind(v) if v is not None else default_value
        except Exception:
            return default_value

    # -- token 估算: 中日韩字符约 1 token/字, 其余约 3.5 字符/token --
    @staticmethod
    def _tokens_of(text: object) -> int:
        if not isinstance(text, str):
            text = str(text or "")
        if not text:
            return 0
        cjk = sum(1 for ch in text if "\u4e00" <= ch <= "\u9fff")
        return max(1, int(cjk + (len(text) - cjk) / 3.5))

    def estimate_tokens(self, messages: list) -> int:
        return sum(self._tokens_of(self._msg_text(m)) for m in messages) + 8 * len(messages)

    @staticmethod
    def _msg_text(m: dict) -> str:
        c = m.get("content")
        if isinstance(c, str):
            return c
        if isinstance(c, list):
            parts = []
            for part in c:
                if isinstance(part, dict):
                    parts.append(str(part.get("text") or part.get("content") or ""))
                else:
                    parts.append(str(part))
            return "\n".join(parts)
        return str(c or "")

    @staticmethod
    def _clip(text: str, limit: int) -> str:
        if len(text) <= limit:
            return text
        return text[:limit] + f"\n[... {len(text) - limit} chars truncated]"

    @staticmethod
    def _is_turn_start(m: dict) -> bool:
        # 安全切点: user 消息且不携带 tool_result(pi: 切点永不落在工具结果上,
        # 工具结果必须与其 tool_call 成对保留)
        if m.get("role") != "user":
            return False
        c = m.get("content")
        if isinstance(c, list) and any(
            isinstance(p, dict) and p.get("type") == "tool_result" for p in c
        ):
            return False
        return True

    # -- 切点: 从尾部往前累计 token 到保尾预算; 切点必须落在轮首 --
    def _cut_index(self, messages: list, keep_tokens: int) -> int:
        n = len(messages)
        if self.max_model_len:
            keep_tokens = min(keep_tokens, max(1500, int(self.max_model_len * 0.15)))
        total = 0
        cut = n
        # 含 index 0: 越过预算的那条作为保留头(pi: 近期重消息原文保留)
        for i in range(n - 1, -1, -1):
            total += self._tokens_of(self._msg_text(messages[i]))
            if total >= keep_tokens:
                cut = i
                break
        else:
            return n  # 全部消息都在保留窗口内, 无可压缩段
        # 落在轮中时回退到轮首(窗口略大, 保证工具结果与其 tool_call 成对)
        while cut > 0 and not self._is_turn_start(messages[cut]):
            cut -= 1
        if cut == 0:
            # split-turn 精神的近似: 越界发生在首条消息 → 首轮整体过大,
            # 从下一个轮首切断, 让巨轮进入摘要段; 没有下一个轮首则整体保留
            for j in range(1, n):
                if self._is_turn_start(messages[j]):
                    return j
            return n
        return cut

    # -- 序列化正文: [User]/[Assistant]/[Tool result] 风格, 单条截断 --
    @staticmethod
    def _call_parts(tc) -> tuple:
        if isinstance(tc, dict):
            fn = tc.get("function") or {}
            tid, name, args = tc.get("id"), fn.get("name"), fn.get("arguments", {})
        else:
            fn = getattr(tc, "function", None)
            tid = getattr(tc, "id", None)
            name = getattr(fn, "name", None)
            args = getattr(fn, "arguments", {})
        if isinstance(args, str):
            args_s = args
        else:
            args_s = json.dumps(args, ensure_ascii=False, default=str)
        return tid, name or "tool", args_s

    def _tool_name_map(self, messages: list) -> dict:
        names = {}
        for m in messages:
            if m.get("role") != "assistant":
                continue
            for tc in m.get("tool_calls") or []:
                tid, name, _ = self._call_parts(tc)
                if tid and name:
                    names[tid] = name
        return names

    def _serialize(self, messages: list, names: dict) -> str:
        result_chars = self._cfg("COMPACT_SERIAL_RESULT_CHARS", int, 2000)
        arg_chars = self._cfg("COMPACT_SERIAL_ARG_CHARS", int, 200)
        lines = []
        for m in messages:
            role = m.get("role")
            if role == "assistant":
                text = self._msg_text(m).strip()
                if text:
                    lines.append(f"[Assistant]: {self._clip(text, 8000)}")
                calls = m.get("tool_calls") or []
                if calls:
                    parts = []
                    for tc in calls:
                        _, name, args_s = self._call_parts(tc)
                        parts.append(f"{name}({self._clip(args_s, arg_chars)})")
                    lines.append("[Assistant tool calls]: " + "; ".join(parts))
            elif role == "user":
                c = m.get("content")
                if isinstance(c, list):
                    for part in c:
                        if isinstance(part, dict) and part.get("type") == "tool_result":
                            tid = part.get("tool_use_id")
                            body = part.get("content")
                            if not isinstance(body, str):
                                body = self._msg_text({"content": body})
                            lines.append(
                                f"[Tool result of {names.get(tid, '') or 'tool'}]: "
                                + self._clip(body.strip(), result_chars)
                            )
                        else:
                            text = str(part.get("text") or "") if isinstance(part, dict) else str(part)
                            if text:
                                lines.append(f"[User]: {self._clip(str(text), 8000)}")
                else:
                    text = self._msg_text(m).strip()
                    if text:
                        lines.append(f"[User]: {self._clip(text, 8000)}")
            elif role == "tool":
                tid = m.get("tool_call_id")
                body = self._msg_text(m).strip()
                lines.append(
                    f"[Tool result of {names.get(tid, '') or 'tool'}]: "
                    + self._clip(body, result_chars)
                )
        return "\n".join(lines)

    # -- 文件清单: 从 tool_calls 参数位收集(pi details: read/modified files) --
    def _collect_files(self, messages: list) -> tuple:
        read_files, modified_files = [], []
        for m in messages:
            if m.get("role") != "assistant":
                continue
            for tc in m.get("tool_calls") or []:
                _, name, args_s = self._call_parts(tc)
                base = str(name).split("__")[-1].lower()
                try:
                    args = json.loads(args_s) if args_s.strip().startswith("{") else {}
                except Exception:
                    args = {}
                path = next(
                    (args[k] for k in ("path", "file_path", "filepath", "file") if isinstance(args.get(k), str)),
                    "",
                )
                if not path:
                    continue
                path = str(path)[:200]
                if base in _COMPACT_WRITE_TOOLS:
                    if path not in modified_files:
                        modified_files.append(path)
                elif base in _COMPACT_READ_TOOLS and path not in read_files:
                    read_files.append(path)
        return read_files, modified_files

    @staticmethod
    def _file_section(prev_summary, tag) -> list:
        if not prev_summary:
            return []
        match = re.search(rf"<{tag}>\n([\s\S]*?)</{tag}>", prev_summary)
        if not match:
            return []
        return [ln.strip() for ln in match.group(1).splitlines() if ln.strip()]

    # -- Layer 2: summary_compact - 摘要较早部分 + 摘要卡追加到会话末尾 --
    # 摘要卡按时间顺序作为最新消息放在保留轮次之后(pi 的 compaction entry 语义);
    # 旧摘要卡(任意位置)移除, 其内容经 previousSummary 并入新摘要
    def summary_compact(self, messages: list, force: bool = False, keep_tokens_override: int = 0, on_delta=None) -> list:
        self.last_meta = None
        keep_tokens = int(keep_tokens_override or 0) or self._cfg("COMPACT_KEEP_RECENT_TOKENS", int, 16000)
        # 旧摘要卡可在列表任意位置(首次在头部, 之后始终是上轮追加的尾部)
        marker_idx = -1
        for i, m in enumerate(messages):
            c = m.get("content")
            if isinstance(c, str) and c.startswith(_COMPACT_MARKER):
                marker_idx = i
        prev_summary = messages[marker_idx].get("content") if marker_idx >= 0 else None
        cut = self._cut_index(messages, keep_tokens)
        if cut >= len(messages):
            return messages  # 保留窗口覆盖了全部消息, 无可摘要段
        # 摘要跨度 = [0, cut) 且不含旧卡; 旧卡若落在保留区则单独剔除
        span = [m for i, m in enumerate(messages[:cut]) if i != marker_idx]
        old_card_in_kept = marker_idx >= cut
        dropped = len(span) + (1 if marker_idx >= 0 else 0)
        if dropped <= 0 or (not force and dropped < self._cfg("COMPACT_MIN_DROPS", int, 4)):
            return messages
        kept = [m for i, m in enumerate(messages[cut:]) if i + cut != marker_idx]
        names = self._tool_name_map(messages)
        # 全文转存 transcripts, 供事后审计
        transcript_path = None
        try:
            tdir = Path(self.transript_dir)
            tdir.mkdir(parents=True, exist_ok=True)
            transcript_path = tdir / f"transcript_{int(time.time())}.jsonl"
            with open(transcript_path, "w", encoding="utf-8") as f:
                for msg in messages:
                    f.write(json.dumps(msg, default=str, ensure_ascii=False) + "\n")
            print(f"{' ' * 12}transcript saved: {transcript_path}")
        except Exception as e:
            print(f"{' ' * 12}compact transcript dump failed (compaction still applies): {e}")
        # 文件清单 = 本段 tool_calls 采集 + 旧摘要清单(跨压缩累计)
        sec_read, sec_mod = self._collect_files(span)
        for p2 in self._file_section(prev_summary, "read-files"):
            if p2 not in sec_read:
                sec_read.append(p2)
        for p2 in self._file_section(prev_summary, "modified-files"):
            if p2 not in sec_mod:
                sec_mod.append(p2)
        summary = self._summarize(span, names, prev_summary, on_delta=on_delta)
        if not summary:
            # 摘要失败不阻塞会话: 机械兜底说明, 保尾照常生效
            summary = (
                "(本次压缩的摘要生成失败（模型请求未返回内容）, 早期消息已按原文保留在上方, 上下文占位不变; "
                + (f"原始会话已转存 {transcript_path.name}。 " if transcript_path else "")
                + "可稍后在圆环弹卡再次点击「压缩」重试生成摘要。）"
            )
        marker_text = _COMPACT_MARKER
        if transcript_path is not None:
            marker_text += f" · transcript {transcript_path.name}"
        marker_text += f"]\n\n{summary}"
        if sec_read:
            marker_text += "\n\n<read-files>\n" + "\n".join(sec_read[:200]) + "\n</read-files>"
        if sec_mod:
            marker_text += "\n\n<modified-files>\n" + "\n".join(sec_mod[:200]) + "\n</modified-files>"
        # 新摘要卡按时间顺序追加到末尾(用户视角: 压缩那一刻的最新一条消息)
        new_messages = [*kept, {"role": "user", "content": marker_text}]
        drop_old_idx = (marker_idx - cut) if old_card_in_kept else -1
        self.last_meta = {
            "summaryTokens": int(getattr(self, "last_usage_tokens", 0) or 0),
            "summaryInputTokens": int(getattr(self, "last_input_tokens", 0) or 0),
            "applied": True,
            "removed": cut,          # 前端需从头部删除的条数(含落在其中的旧卡)
            "dropOldIdx": drop_old_idx,  # 旧卡若在保留区, 删头后的相对索引(-1=已随头部删除)
            "kept": len(kept),
            "droppedTotal": dropped,
            "tokens_before": self.estimate_tokens(messages),
            "transcript": transcript_path.name if transcript_path else "",
            "text": marker_text,
        }
        print(f"{' ' * 12}compacted: dropped {dropped}, kept {len(kept)}, tokens before ~{self.estimate_tokens(messages)}")
        return new_messages

    # -- 摘要请求: 结构化 pi 摘要 + 迭代 previousSummary; 失败返回空 --
    def _summary_prompt(self, span: list, names: dict, prev_summary=None) -> str:
        conversation = self._serialize(span, names)
        prompt = SUMMARY_PROMPT
        if prev_summary:
            prompt += f"\n\n### Previous summary (iterate on it; keep still-relevant points, do not repeat verbatim):\n{prev_summary}\n"
        prompt += f"\n\n### Conversation:\n{conversation}"
        return prompt

    def _summarize(self, span: list, names: dict, prev_summary=None, on_delta=None) -> str:
        if self.client is None:
            return ""
        prompt = self._summary_prompt(span, names, prev_summary)
        # 流式优先: delta 逐段推给调用方(手动压缩的等待消息可以实时渲染);
        # 网关不支持流式时退回非流式路径, 结果一致
        if on_delta is not None:
            text = self._summarize_stream(prompt, on_delta)
            if text is not None:
                return text
        model = self.model or MODEL
        self.last_usage_tokens = 0
        self.last_input_tokens = 0
        try:
            if self.client.__class__.__name__ == "Anthropic":
                response = self.client.messages.create(
                    model=model, messages=[{"role": "user", "content": prompt}], max_tokens=self._cfg("COMPACT_TOKENS", int, 4096),
                )
                summary = response.content[0].text
                self.last_usage_tokens = getattr(getattr(response, "usage", None), "output_tokens", 0) or 0
                self.last_input_tokens = getattr(getattr(response, "usage", None), "input_tokens", 0) or 0
            else:
                response = self.client.chat.completions.create(
                    model=model, messages=[{"role": "user", "content": prompt}], max_tokens=self._cfg("COMPACT_TOKENS", int, 4096),
                )
                summary = (response.choices[0].message.content or "").strip()
                self.last_usage_tokens = getattr(getattr(response, "usage", None), "completion_tokens", 0) or 0
                self.last_input_tokens = getattr(getattr(response, "usage", None), "prompt_tokens", 0) or 0
            print(f"{' ' * 12}summary({len(summary)} chars, {self.last_usage_tokens} tokens) via {model}")
            return summary
        except Exception as e:
            # 摘要失败: 上层走机械兜底, 会话不中断
            print(f"{' ' * 12}compact summary failed, fallback note: {e}")
            return ""

    def _summarize_stream(self, prompt: str, on_delta):
        # 流式摘要: 逐 delta 回调, 返回全文; 失败返回 None 交由非流式路径重试
        if self.client is None:
            return None
        model = self.model or MODEL
        self.last_usage_tokens = 0
        self.last_input_tokens = 0
        try:
            parts = []
            buf = []

            def _flush(final=False):
                # 服务端先按 ~48 字符合并, 降低回调/SSE 频率
                if buf and (final or sum(len(x) for x in buf) >= 48):
                    text = "".join(buf)
                    buf.clear()
                    parts.append(text)
                    try:
                        on_delta(text)
                    except Exception:
                        # on_delta 故障只影响展示, 压缩照常
                        pass

            if self.client.__class__.__name__ == "Anthropic":
                with self.client.messages.stream(
                    model=model,
                    messages=[{"role": "user", "content": prompt}],
                    max_tokens=self._cfg("COMPACT_TOKENS", int, 4096),
                ) as stream:
                    for t in stream.text_stream:
                        if t:
                            buf.append(t)
                            _flush()
                    _flush(final=True)
                    final_msg = stream.get_final_message()
                    usage = getattr(final_msg, "usage", None)
                    self.last_usage_tokens = getattr(usage, "output_tokens", 0) or 0
                    self.last_input_tokens = getattr(usage, "input_tokens", 0) or 0
            else:
                try:
                    stream = self.client.chat.completions.create(
                        model=model,
                        messages=[{"role": "user", "content": prompt}],
                        max_tokens=self._cfg("COMPACT_TOKENS", int, 4096),
                        stream=True,
                        stream_options={"include_usage": True},
                    )
                except Exception:
                    # 个别网关不识别 stream_options, 去掉后重试
                    stream = self.client.chat.completions.create(
                        model=model,
                        messages=[{"role": "user", "content": prompt}],
                        max_tokens=self._cfg("COMPACT_TOKENS", int, 4096),
                        stream=True,
                    )
                usage_seen = None
                for chunk in stream:
                    ch_usage = getattr(chunk, "usage", None)
                    if ch_usage is not None:
                        usage_seen = ch_usage
                    choices = getattr(chunk, "choices", None) or []
                    delta = ""
                    if choices:
                        delta = getattr(getattr(choices[0], "delta", None), "content", None) or ""
                    if delta:
                        buf.append(delta)
                        _flush()
                _flush(final=True)
                if usage_seen is not None:
                    self.last_usage_tokens = getattr(usage_seen, "completion_tokens", 0) or 0
                    self.last_input_tokens = getattr(usage_seen, "prompt_tokens", 0) or 0
            text = "".join(parts).strip()
            if not text:
                raise RuntimeError("empty stream")
            if not self.last_usage_tokens:
                # 网关流式下没回 usage: 用本地估算兜底
                self.last_usage_tokens = self._tokens_of(text)
            if not self.last_input_tokens:
                self.last_input_tokens = self._tokens_of(prompt)
            print(f"{' ' * 12}summary({len(text)} chars, ~{self.last_usage_tokens} tokens) via {model} [stream]")
            return text
        except Exception as e:
            print(f"{' ' * 12}compact summary stream failed, falling back to non-stream: {e}")
            return None

    # -- 触发器: 实际用量与估算取大者决定是否走摘要压缩(pi: tokens > window-reserve) --
    def auto_compact(self, messages: list, force=False, context_ratio=0) -> list:
        est_ratio = self.estimate_tokens(messages) / self.max_model_len if self.max_model_len else 0
        ratio = max(est_ratio, context_ratio or 0)
        threshold = self._cfg("COMPACT_RATIO", float, 0.85)
        hard_limit = self._cfg("COMPACT_THRESHOLD", int, 10**20)
        enabled = self._cfg("COMPACT_ENABLED", bool, True)
        # pi 语义: enabled=False 只关自动触发, 手动 /compact 仍然可用
        window = self.max_model_len or 0
        auto = enabled and (ratio >= threshold or (ratio * window if window else 0) > hard_limit)
        if force or auto:
            print(f"{Prompt.Compact}manual compact" if force else f"{Prompt.Compact}auto compact triggered")
            return self.summary_compact(messages, force=force)
        # 未触发: 只做轻量裁剪; 未发生压缩时清掉上次的事件残留
        messages = self.tool_compact(messages, context_ratio=context_ratio)
        self.last_meta = None
        return messages

    # -- Layer 1: tool_compact - replace old tool results with placeholders --
    def tool_compact(self, messages: list, context_ratio: float = 0) -> list:
        # Collect tool results while tracking the tool names already seen.
        tool_results = []
        tool_name_map = {}
        for msg in messages:
            content = msg.get("content", [])
            match msg["role"]:
                case "assistant":
                    if isinstance(content, list):
                        for block in content:
                            if hasattr(block, "type") and block.type == "tool_use":
                                tool_name_map[block.id] = block.name
                    for tool_call in msg.get("tool_calls", []):
                        if isinstance(tool_call, dict):
                            tool_id = tool_call.get("id")
                            tool_name = tool_call.get("function", {}).get("name")
                        else:
                            tool_id = getattr(tool_call, "id", None)
                            function = getattr(tool_call, "function", None)
                            tool_name = getattr(function, "name", None)
                        if tool_id and tool_name:
                            tool_name_map[tool_id] = tool_name
                case "user" if isinstance(content, list):
                    for part in content:
                        if isinstance(part, dict) and part.get("type") == "tool_result":
                            tool_name = tool_name_map.get(
                                part.get("tool_use_id", ""), "unknown"
                            )
                            tool_results.append((part, tool_name))
                case "tool":
                    tool_name = tool_name_map.get(
                        msg.get("tool_call_id", ""), "unknown"
                    )
                    tool_results.append((msg, tool_name))
                case _:
                    continue
        if len(tool_results) <= KEEP_RECENT_TOOL:
            pass
        else:
            # Clear old results (keep last KEEP_RECENT_TOOL). 默认禁用, 旧逻辑仅作开关保留
            to_clear = tool_results[:-KEEP_RECENT_TOOL] if KEEP_RECENT_TOOL > 0 else tool_results
            for result, tool_name in to_clear:
                if isinstance(result.get("content"), str) and len(result["content"]) < 100:
                    continue
                result["content"] = f"[Previous: used {tool_name}]"
        # 软压力裁剪(dsh pruner 思路): 估算 token 或真实占用占比超过阈值时,
        # 把较早的大结果保头截尾 — 零模型调用即可缓解压力, 推迟全量 summary;
        # 原文转存入 transcripts 目录, 可事后审计
        if PRUNE_TOOL_RESULTS:
            token_ratio = (
                self.estimate_tokens(messages) / self.max_model_len
                if self.max_model_len
                else 0
            )
            if max(token_ratio, context_ratio) >= PRUNE_SOFT_RATIO:
                self._prune_tool_results(tool_results)
        return messages

    def _prune_tool_results(self, tool_results: list) -> None:
        """Trim old oversized tool results to head+tail, dumping originals first."""
        if len(tool_results) <= PRUNE_KEEP_RECENT:
            return
        to_prune = tool_results[:-PRUNE_KEEP_RECENT]
        marker = "[middle pruned:"
        dumped = []
        for result, tool_name in to_prune:
            content = result.get("content")
            if not isinstance(content, str) or len(content) < PRUNE_MIN_CHARS:
                continue
            if marker in content:
                continue  # 已经裁剪过, 不重复处理
            dumped.append({"tool": tool_name, "content": content})
            result["content"] = (
                content[:PRUNE_HEAD_CHARS]
                + f"\n[middle pruned: {len(content) - PRUNE_HEAD_CHARS - PRUNE_TAIL_CHARS} chars omitted, "
                  f"full result saved to transcript]\n"
                + content[-PRUNE_TAIL_CHARS:]
            )
        if not dumped:
            return
        try:
            Path(self.transript_dir).mkdir(exist_ok=True, parents=True)
            dump_path = Path(self.transript_dir) / f"pruned_results_{time.time_ns() // 1000000}.jsonl"
            with open(dump_path, "a", encoding="utf-8") as f:
                for d in dumped:
                    f.write(json.dumps(d, ensure_ascii=False, default=str) + "\n")
            print(f"{' '*12}pruned {len(dumped)} tool result(s), originals saved: {dump_path}")
        except Exception as e:
            # 转存失败不阻断裁剪本体, 只提示
            print(f"{' '*12}prune dump failed (trim still applied): {e}")

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
        path.write_text(json.dumps(task, indent=2, ensure_ascii=False))

    def create(self, subject: str, description: str = "") -> str:
        task = {
            "id": self._next_id, "subject": subject, "description": description,
            "status": "pending", "blockedBy": [], "blocks": [], "owner": "",
        }
        self._save(task)
        self._next_id += 1
        return json.dumps(task, indent=2, ensure_ascii=False)

    def get(self, task_id: int) -> str:
        return json.dumps(self._load(task_id), indent=2, ensure_ascii=False)

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
        return json.dumps(task, indent=2, ensure_ascii=False)

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
        self.tasks[task_id] = {"status": "running", "result": None, "command": command, "proc": None}
        thread = threading.Thread(
            target=self._execute, args=(task_id, command, get_session_workdir()), daemon=True
        )
        thread.start()
        return f"Background job {task_id} started: {command[:80]}"

    def _execute(self, task_id: str, command: str, workdir=None):
        """Thread target: run subprocess, capture output, push to queue.

        workdir is captured on the caller thread (thread-local does not cross
        threads); background tasks run where the session was bound.

        Popen 而非 subprocess.run: 保留进程句柄供 kill_job 中止任务。
        """
        status, output = "completed", ""
        proc = None
        try:
            proc = subprocess.Popen(
                command, shell=True, cwd=workdir or WORKDIR,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
            )
            self.tasks[task_id]["proc"] = proc
            out, err = proc.communicate(timeout=300)
            output = (out + err).strip()[:50000]
            if proc.returncode != 0:
                status = "error"
            with self._lock:
                if self.tasks[task_id].get("status") == "killed":
                    status = "killed"
        except subprocess.TimeoutExpired:
            try:
                proc.kill()
                proc.communicate()
            except Exception:
                pass
            output = "Error: Timeout (300s)"
            status = "timeout"
        except Exception as e:
            output = f"Error: {e}"
            status = "error"
        # kill 竞态保护: 若执行期间被 kill_job 标记, 不覆盖 killed 状态;
        # killed 的完成通知已由 kill() 入队, 这里不再重复
        killed = self.tasks[task_id].get("status") == "killed"
        if not killed:
            self.tasks[task_id]["status"] = status
            self.tasks[task_id]["result"] = output or "(no output)"
            with self._lock:
                self._notification_queue.append({
                    "task_id": task_id,
                    "status": status,
                    "command": command[:80],
                    "result": (output or "(no output)")[:500],
                })

    def kill(self, task_id: str = None) -> str:
        """Kill a running background task (or all running when id omitted)."""
        with self._lock:
            targets = [tid for tid, t in self.tasks.items() if t["status"] == "running"] if task_id is None \
                else ([task_id] if self.tasks.get(task_id, {}).get("status") == "running" else [])
            if task_id and not targets:
                return f"Error: no running background job {task_id}"
            for tid in targets:
                self.tasks[tid]["status"] = "killed"
                self.tasks[tid]["result"] = "(killed by request)"
                proc = self.tasks[tid].get("proc")
                if proc is not None and proc.poll() is None:
                    try:
                        proc.kill()
                    except Exception:
                        pass
                self._notification_queue.append({
                    "task_id": tid, "status": "killed",
                    "command": self.tasks[tid]["command"][:80],
                    "result": "(killed by request)",
                })
        return f"Killed {len(targets)} background job(s): {', '.join(targets)}"

    def check(self, task_id: str = None) -> str:
        """Check status of one task or list all."""
        if task_id:
            t = self.tasks.get(task_id)
            if not t:
                return f"Error: unknown job {task_id}"
            return f"[{t['status']}] {t['command'][:60]}\n{t.get('result') or '(running)'}"
        lines = []
        for tid, t in self.tasks.items():
            lines.append(f"{tid}: ({t['status']}) {t['command'][:60]}")
        return "\n".join(lines) if lines else "No background jobs."

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
        try:
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
                    server_headers=server_cfg.get("headers", {})
                )
                for t in data.get("result", {}).get("tools", [])
            ]
        except Exception as e:
            print(f"{Prompt.Error}MCP from {server_name}: {e}")
            return []

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
            resp = self.session.post(tool.server_url, json=payload, headers=tool.server_headers, timeout=60)
            resp.raise_for_status()
            data = resp.json()
            return data.get("result", {}).get("content", "")
        except Exception as e:
            return f'Error: {str(e)}'

    def close(self):
        self.session.close()


# -- The dispatch map: {tool_name: handler} --
class AskManager:
    """Bridge between the `ask` tool and the web UI.

    `ask()` blocks the calling tool thread until the UI replies via `answer()`,
    the chat is stopped via `cancel()`, or the timeout elapses.
    """

    def __init__(self, timeout: int = 3600):
        self.timeout = timeout
        self._lock = threading.Lock()
        self._waiters: dict = {}

    def ask(self, questions: list, notify=None) -> str:
        """Block until the user answers from the UI; return the model-facing result."""
        ask_id = "ask-" + uuid.uuid4().hex[:12]
        entry = {"event": threading.Event(), "answers": None, "cancelled": False}
        with self._lock:
            self._waiters[ask_id] = entry
        if notify is not None:
            try:
                notify({"kind": "ask", "id": ask_id, "questions": questions})
            except Exception:
                pass
        entry["event"].wait(self.timeout)
        with self._lock:
            self._waiters.pop(ask_id, None)
            answers, cancelled = entry["answers"], entry["cancelled"]
        if cancelled:
            return (
                "Error: the user stopped this chat before answering. "
                "Do not call ask again; finalize with what you already have."
            )
        if answers is None:
            return (
                "Error: no answer arrived (timeout or no live UI). "
                "Do not call ask again; finalize with what you already have."
            )
        return "User answers (JSON list of {id, selected, custom}):\n" + json.dumps(
            answers, ensure_ascii=False, indent=2
        )

    def answer(self, ask_id: str, answers) -> bool:
        """Deliver UI answers to the blocked ask(); False when nobody is waiting."""
        with self._lock:
            entry = self._waiters.get(ask_id)
            if entry is None or entry["event"].is_set():
                return False
            entry["answers"] = answers
            entry["event"].set()
            return True

    def cancel(self, ask_id: str) -> None:
        """Wake a pending ask() without answers (chat stopped or socket dropped)."""
        with self._lock:
            entry = self._waiters.get(ask_id)
            if entry is not None and not entry["event"].is_set():
                entry["cancelled"] = True
                entry["event"].set()


ASK = AskManager()


def _ask_loads_lenient(s: str):
    """Parse a possibly JSON-encoded string; repair bracket truncation or salvage texts."""
    if not isinstance(s, str) or s.strip()[:1] not in ("{", "["):
        return None
    try:
        return json.loads(s)
    except Exception:
        pass
    try:
        # 截断容错: 按括号配平补齐后再试一次
        stack, in_str, esc = [], False, False
        for ch in s:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = not in_str
            elif not in_str:
                if ch in "[{":
                    stack.append(ch)
                elif ch in "]}":
                    if stack and stack[-1] == {"}": "{", "]": "["}.get(ch):
                        stack.pop()
        if not in_str and stack:
            return json.loads(s + "".join("]" if c == "[" else "}" for c in reversed(stack)))
    except Exception:
        pass
    # 兜底: 正则抠出所有 question 文本, 至少不把整坨 JSON 当问题展示
    salvaged = [q.strip() for q in re.findall(r'"question"\s*:\s*"((?:[^"\\]|\\.)*)"', s) if q.strip()]
    return [{"question": q} for q in salvaged] if salvaged else None


def _ask_flatten(item, out, depth=0):
    """Flatten one model-supplied question entry into out; tolerates double-encoded
    JSON strings, wrapper dicts without question text, and question dicts nested
    inside the options array (deepseek occasionally emits all of these)."""
    if depth > 4 or len(out) >= 20:
        return
    if isinstance(item, str):
        parsed = _ask_loads_lenient(item)
        if parsed is not None:
            item = parsed
        else:
            s = item.strip()
            if s:
                out.append({"id": f"q{len(out) + 1}", "question": s})
            return
    if isinstance(item, list):
        for sub in item:
            _ask_flatten(sub, out, depth + 1)
        return
    if not isinstance(item, dict):
        return
    question = str(item.get("question") or "").strip()
    opts_raw = item.get("options") if isinstance(item.get("options"), list) else []
    if not question:
        # 无正文的包装层: 嵌套项都藏在 options/questions 里
        for key in ("questions", "options"):
            if isinstance(item.get(key), list):
                for sub in item[key]:
                    _ask_flatten(sub, out, depth + 1)
        return
    nested = [o for o in opts_raw if isinstance(o, dict) and str(o.get("question") or "").strip()]
    if opts_raw and len(nested) == len(opts_raw):
        # 所有“选项”其实都是完整问题: 本体是包装层, 不重复出题
        for sub in nested:
            _ask_flatten(sub, out, depth + 1)
        return
    entry = {"id": str(item.get("id") or f"q{len(out) + 1}")[:64], "question": question}
    header = str(item.get("header") or "").strip()
    if header:
        entry["header"] = header[:80]
    options = []
    for opt in opts_raw:
        if isinstance(opt, dict) and str(opt.get("question") or "").strip():
            _ask_flatten(opt, out, depth + 1)
            continue
        label = str((opt or {}).get("label") if isinstance(opt, dict) else opt or "").strip()
        if not label:
            continue
        desc = str(opt.get("description") or "").strip() if isinstance(opt, dict) else ""
        options.append({"label": label, **({"description": desc} if desc else {})})
    if options:
        entry["options"] = options[:12]
        if item.get("multi_select") is True or item.get("multiSelect") is True:
            entry["multi_select"] = True
    out.append(entry)


def run_ask(questions=None, _notify=None):
    """Handle the `ask` tool; normalize model input and wait for the user's reply."""
    if _notify is None:
        return (
            "Error: ask is unavailable in this session (no live UI channel). "
            "Finalize with what you already have."
        )
    out: list = []
    if isinstance(questions, str):
        parsed = _ask_loads_lenient(questions)
        questions = parsed if parsed is not None else [{"question": questions.strip()}]
    if isinstance(questions, dict):
        questions = [questions]
    if isinstance(questions, list):
        for item in questions:
            _ask_flatten(item, out)
    if not out:
        return "Error: ask received no valid question; do not call it with empty questions."
    return ASK.ask(out, notify=_notify)


run_ask.__ask_tool__ = True

TOOL_HANDLERS = {
    "bash":       lambda **kw: run_bash(kw.get("command", "")),
    "grep":       lambda **kw: run_grep(kw.get("tool", ""), kw.get("args", "")),
    "read":  lambda **kw: run_read(kw.get("path", ""), offset=kw.get("offset"), limit=kw.get("limit")),
    "write": lambda **kw: run_write(kw.get("path", ""), kw.get("content", "")),
    "edit":  lambda **kw: run_edit(kw.get("path", ""), kw.get("old_text", ""), kw.get("new_text", "")),
    "load_skill": lambda **kw: skill_loader.get_content(kw.get("name", "")),
    "arxiv_search": lambda **kw: arxiv_search(kw.get("query", ""), kw.get("max_results", 5)),
    "read_arxiv":   lambda **kw: read_arxiv(kw.get("paper_id", "")),
    "compact":    lambda **kw: "Manual compression requested.",
    "task_create": lambda **kw: TM.create(kw["subject"], kw.get("description", "")),
    "task_update": lambda **kw: TM.update(kw["task_id"], kw.get("status"), kw.get("addBlockedBy"), kw.get("addBlocks")),
    "task_list":   lambda **kw: TM.list_all(),
    "task_get":    lambda **kw: TM.get(kw["task_id"]),
    "run_job":   lambda **kw: BG.run(kw["command"]),
    "check_job": lambda **kw: BG.check(kw.get("job_id")),
    "kill_job":  lambda **kw: BG.kill(kw.get("job_id")),
    "send_message":    lambda **kw: BUS.send("lead", kw["to"], kw["content"], kw.get("msg_type", "message")),
    "read_inbox":      lambda **kw: json.dumps(BUS.read_inbox("lead"), indent=2),
    "broadcast":       lambda **kw: BUS.broadcast("lead", kw["content"], TEAM.member_names()),
    "rag":             lambda **kw: rag(kw.get("query", "")),
    "ask":             run_ask,
}

TOOL_HANDLERS.update(SCIVERSE_TOOL_HANDLERS)
CHILD_TOOLS.extend(SCIVERSE_TOOLS)
TOOLS.extend(SCIVERSE_TOOLS)

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
