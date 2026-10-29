"""Science 文件域: 项目文件树读写/文本/上传/exec/git 状态/每项目 PTY 会话.

payload 函数由 science.py 路由层调用; PTY 会话跨 websocket 复用。"""

import base64
import fcntl
import os
import shutil
import pty as _pty_mod
import select
import signal
import struct
import subprocess
import threading
import time

from typing import Dict

from fastapi import (
    HTTPException,
)

_FS_HIDDEN_NAMES = {".git", "__pycache__", "node_modules", ".DS_Store"}
_GIT_STATUS_TTL = 3.0
_GIT_STATUS_CACHE: Dict[str, tuple] = {}
_FS_TEXT_MAX = 512 * 1024

# 文件浏览器分类: markdown/json/代码高亮/图片/PDF 直显, 其余按二进制降级
_MD_EXTS = {"md", "markdown"}
_JSON_EXTS = {"json", "jsonc", "json5"}
_JSONL_EXTS = {"jsonl", "ndjson"}
_IMG_EXTS = {"png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"}
_IMG_MIME = {
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "gif": "image/gif",
    "webp": "image/webp",
    "svg": "image/svg+xml",
    "bmp": "image/bmp",
    "ico": "image/x-icon",
}
_PLAIN_EXTS = {"txt", "log", "csv", "tsv"}
_PDF_MAX = 24 * 1024 * 1024
_IMG_MAX = 8 * 1024 * 1024
_CODE_EXTS = {
    "py",
    "pyi",
    "js",
    "mjs",
    "cjs",
    "ts",
    "tsx",
    "jsx",
    "sh",
    "bash",
    "zsh",
    "yml",
    "yaml",
    "toml",
    "ini",
    "cfg",
    "conf",
    "css",
    "scss",
    "html",
    "htm",
    "xml",
    "sql",
    "c",
    "h",
    "cpp",
    "hpp",
    "cc",
    "go",
    "rs",
    "java",
    "rb",
    "lua",
    "r",
    "jl",
    "swift",
    "kt",
    "php",
    "pl",
    "ps1",
    "bat",
    "dockerfile",
    "makefile",
    "svgxml",
}


def _fs_file_kind(rel: str) -> tuple:
    """Map a path to (kind, lang/mime): markdown | json | jsonl | code | image | pdf | text | binary."""
    name = os.path.basename(rel).lower()
    ext = rel.rsplit(".", 1)[-1].lower() if "." in os.path.basename(rel) else ""
    if name in ("dockerfile", "makefile"):
        return ("code", name)
    if ext in _MD_EXTS:
        return ("markdown", "")
    if ext in _JSONL_EXTS:
        return ("jsonl", "jsonl")
    if ext in _JSON_EXTS:
        return ("json", "json")
    if ext in _IMG_EXTS:
        return ("image", _IMG_MIME.get(ext, "application/octet-stream"))
    if ext == "pdf":
        return ("pdf", "")
    if ext in _CODE_EXTS:
        return ("code", ext)
    if ext in _PLAIN_EXTS:
        return ("text", "txt")
    return ("text", "")


def _fs_resolve(project_dir: str, rel: str):
    """Resolve `rel` inside the project dir, refusing escapes (returns abs path)."""
    root = os.path.realpath(project_dir)
    target = os.path.realpath(os.path.join(root, rel)) if rel else root
    if target != root and not target.startswith(root + os.sep):
        return None, root
    return target, root


_FS_UPLOAD_MAX = 32 * 1024 * 1024
_FS_EXEC_TIMEOUT = 180.0
_FS_CWD_SENTINEL = "SIGMAFLOW_CWD"
_FS_EXEC_RE = None
_PTY_BUFFER_MAX = 200 * 1024
_PTY_SESSIONS_MAX = 8


class _PtySession:
    """One bash running on a PTY, with a bounded replay buffer and fan-out."""

    def __init__(self, key: str, cwd: str, cols: int = 90, rows: int = 28):
        self.key = key
        self.cwd = cwd
        self.created = time.time()
        self.lock = threading.Lock()
        self.buffer = bytearray()
        self.seq = 0
        self.subs: list = []
        self.alive = True
        self.cols, self.rows = cols, rows
        self.master, slave = _pty_mod.openpty()
        try:
            fcntl.ioctl(slave, 0x5414, struct.pack("HHHH", rows, cols, 0, 0))
        except Exception:
            pass  # struct.error/OSError 都视为回退默认窗口尺寸
        env = dict(os.environ)
        env.update(
            {
                "TERM": "xterm-256color",
                "COLORTERM": "truecolor",
                "PS1": r"\u@\h \w $ ",
                "PAGER": "cat",
            }
        )
        self.proc = subprocess.Popen(
            ["/bin/bash", "--login", "-i"],
            stdin=slave,
            stdout=slave,
            stderr=slave,
            cwd=cwd,
            env=env,
            start_new_session=True,
            close_fds=True,
        )
        os.close(slave)
        self.thread = threading.Thread(target=self._pump, daemon=True)
        self.thread.start()

    def _dispatch(self, kind: str, payload: bytes | None = None):
        """Deliver a frame to every attached websocket queue (thread safe)."""
        with self.lock:
            subs = [(sub["queue"], sub["loop"], sub["seq"]) for sub in self.subs]
        for queue, loop, sub_seq in subs:
            try:
                loop.call_soon_threadsafe(queue.put_nowait, (kind, payload))
            except RuntimeError:
                pass

    def _pump(self):
        try:
            while True:
                try:
                    ready, _, _ = select.select([self.master], [], [], 0.5)
                except (OSError, ValueError):
                    break
                if not ready:
                    if self.proc.poll() is not None:
                        break
                    continue
                try:
                    data = os.read(self.master, 65536)
                except OSError:
                    break
                if not data:
                    break
                with self.lock:
                    self.buffer.extend(data)
                    overflow = len(self.buffer) - _PTY_BUFFER_MAX
                    if overflow > 0:
                        del self.buffer[:overflow]
                    self.seq += 1
                    current = self.seq
                    for sub in self.subs:
                        if current > sub["seq"]:
                            sub["seq"] = current
                            try:
                                sub["loop"].call_soon_threadsafe(
                                    sub["queue"].put_nowait, ("out", data)
                                )
                            except RuntimeError:
                                pass
            self.proc.wait(timeout=2)
        except Exception:
            pass
        finally:
            self.alive = False
            self._dispatch("closed")
            with self.lock:
                subs = self.subs
                self.subs = []
            for sub in subs:
                try:
                    sub["loop"].call_soon_threadsafe(
                        sub["queue"].put_nowait, ("closed", None)
                    )
                except RuntimeError:
                    pass

    def subscribe(self, loop, queue):
        """Register a websocket; returns (snapshot bytes, seq start)."""
        with self.lock:
            sub = {"loop": loop, "queue": queue, "seq": self.seq}
            self.subs.append(sub)
            return bytes(self.buffer), self.seq

    def unsubscribe(self, queue):
        with self.lock:
            self.subs = [s for s in self.subs if s["queue"] is not queue]

    def write(self, data: bytes):
        try:
            os.write(self.master, data)
        except OSError:
            pass

    def resize(self, cols: int, rows: int):
        if cols < 2 or rows < 1 or cols > 500 or rows > 300:
            return
        self.cols, self.rows = cols, rows
        try:
            fcntl.ioctl(self.master, 0x5414, struct.pack("HHHH", rows, cols, 0, 0))
            os.killpg(self.proc.pid, signal.SIGWINCH)
        except OSError:
            pass

    def kill(self):
        self.alive = False
        try:
            os.killpg(self.proc.pid, signal.SIGKILL)
        except OSError:
            pass
        for fd in (self.master,):
            try:
                os.close(fd)
            except OSError:
                pass


def _pty_key_of(project_id: str) -> str:
    return f"pty:{(project_id or '').strip()[:64]}"


def _fs_exec_payload(project, cmd: str, cwd: str) -> dict:
    """Run one shell command under the project dir; bash session cwd is kept by
    the client passing the previously reported directory back each time."""
    base = str((project or {}).get("dir") or "").strip()
    if not base or not os.path.isdir(base):
        raise HTTPException(
            status_code=404, detail="项目目录不存在，请编辑项目并填写本地路径"
        )
    start, root = _fs_resolve(base, cwd or "")
    if start is None or not os.path.isdir(start):
        raise HTTPException(status_code=400, detail="工作目录不可用，已重置到项目根")
    script = (
        cmd
        + "\n__sf_code=$?\n"
        + 'printf "\001'
        + _FS_CWD_SENTINEL
        + ':%s\001\n" "$PWD"\n'
        + "exit $__sf_code"
    )

    def _text(value) -> str:
        if value is None:
            return ""
        if isinstance(value, bytes):
            return value.decode("utf-8", "replace")
        return value

    try:
        proc = subprocess.run(
            ["bash", "-c", script],
            cwd=start,
            capture_output=True,
            text=True,
            timeout=_FS_EXEC_TIMEOUT,
        )
        out, err, code = _text(proc.stdout), _text(proc.stderr), proc.returncode
    except subprocess.TimeoutExpired as exc:
        out, err, code = (
            _text(exc.stdout),
            _text(exc.stderr) + "\n[命令执行超时，已终止]",
            124,
        )
    newcwd = start
    marker = f"\x01{_FS_CWD_SENTINEL}:"
    sbegin = out.find(marker)
    if sbegin >= 0:
        send = out.find("\x01", sbegin + len(marker))
        if send > sbegin:
            candidate = out[sbegin + len(marker) : send]
            resolved = None
            if candidate:
                resolved, _ = _fs_resolve(
                    base,
                    os.path.relpath(candidate, root)
                    if os.path.isabs(candidate)
                    else candidate,
                )
            if resolved and os.path.isdir(resolved):
                newcwd = resolved
            out = out[:sbegin] + out[send + 1 :]
    return {
        "stdout": out,
        "stderr": err,
        "code": code,
        "cwd": os.path.relpath(newcwd, root).replace(os.sep, "/")
        if newcwd != root
        else "",
        "root": root.replace(os.sep, "/"),
    }


def _fs_upload_payload(project, name: str, data_base64: str) -> dict:
    """Upload one file into the project directory (no overwrite)."""
    base = str((project or {}).get("dir") or "").strip()
    if not base or not os.path.isdir(base):
        raise HTTPException(
            status_code=404, detail="项目目录不存在，请编辑项目并填写本地路径"
        )
    clean = os.path.basename(str(name or "").replace("\\", "/").replace("\x00", ""))[
        :200
    ]
    if not clean or clean in (".", ".."):
        raise HTTPException(status_code=400, detail="文件名无效")
    try:
        raw = base64.b64decode(data_base64.split(",")[-1], validate=False)
    except Exception:
        raw = b""
    if not raw:
        raise HTTPException(status_code=400, detail="文件内容为空")
    if len(raw) > _FS_UPLOAD_MAX:
        raise HTTPException(status_code=400, detail="文件超过 32 MB 限制")
    target, root = _fs_resolve(base, clean)
    if target is None or os.path.isdir(target):
        raise HTTPException(status_code=400, detail="目标路径无效")
    if os.path.exists(target):
        raise HTTPException(status_code=400, detail="同名文件已存在，请改名后再上传")
    with open(target, "wb") as fh:
        fh.write(raw)
    try:
        subprocess.run(
            ["git", "-C", root, "add", "-A", "--", clean],
            capture_output=True,
            timeout=10,
        )
    except Exception:
        pass
    return {"name": clean, "size": len(raw), "path": clean.replace(os.sep, "/")}


def _git_status_map(root: str) -> Dict[str, str]:
    """Repo-relative path -> one-letter git status (M/A/D/R/U for untracked).

    Cached briefly per project so expanding a few directories does not re-run
    `git status` each time.
    """
    cached = _GIT_STATUS_CACHE.get(root)
    now = time.time()
    if cached and now - cached[0] < _GIT_STATUS_TTL:
        return cached[1]
    result: Dict[str, str] = {}
    try:
        proc = subprocess.run(
            [
                "git",
                "-C",
                root,
                "status",
                "--porcelain=v1",
                "-z",
                "--untracked-files=all",
            ],
            capture_output=True,
            text=True,
            timeout=8,
        )
        if proc.returncode == 0:
            items = proc.stdout.split("\0")
            i = 0
            while i < len(items):
                item = items[i]
                i += 1
                if len(item) < 4:
                    continue
                xy = item[:2]
                path = item[3:]
                if xy == "??":
                    status = "U"
                else:
                    status = xy[1].strip() or xy[0].strip() or "M"
                if status == "R" and i < len(items) - 1:
                    i += 1  # rename records carry the old path in the next field
                if path:
                    result[path] = status
    except Exception:
        return {}
    _GIT_STATUS_CACHE[root] = (now, result)
    return result


def _fs_tree_payload(project, rel: str) -> dict:
    """Directory listing + git status for the project file browser."""
    base = str((project or {}).get("dir") or "").strip()
    if not base or not os.path.isdir(base):
        raise HTTPException(
            status_code=404, detail="项目目录不存在，请编辑项目并填写本地路径"
        )
    target, root = _fs_resolve(base, rel)
    if target is None or not os.path.isdir(target):
        raise HTTPException(status_code=404, detail="目录不存在")
    entries = []
    try:
        names = os.listdir(target)
    except PermissionError:
        names = []
    for name in sorted(names, key=str.lower):
        if name in _FS_HIDDEN_NAMES or name.startswith("."):
            continue
        full = os.path.join(target, name)
        is_dir = os.path.isdir(full)
        if not is_dir and not os.path.isfile(full):
            continue  # sockets / broken symlinks 等
        entries.append(
            {
                "name": name,
                "type": "dir" if is_dir else "file",
                "path": os.path.relpath(full, root).replace(os.sep, "/"),
            }
        )
        if len(entries) >= 500:
            break
    return {
        "root": root.replace(os.sep, "/"),
        "path": rel,
        "entries": entries,
        "git": _git_status_map(root),
    }


def _fs_file_payload(project, rel: str) -> dict:
    """Read one file for the read-only preview modal.

    分类预览: markdown/json/代码返回文本给前端渲染; 图片与 PDF 返回 base64
    直显(浏览器内建 PDF 查看器); 其余按 NUL 探测的原始二进制降级为提示。
    """
    base = str((project or {}).get("dir") or "").strip()
    if not base or not os.path.isdir(base):
        raise HTTPException(status_code=404, detail="项目目录不存在")
    target, root = _fs_resolve(base, rel)
    if target is None:
        raise HTTPException(status_code=403, detail="越界路径")
    if not os.path.isfile(target):
        raise HTTPException(status_code=404, detail="文件不存在")
    size = os.path.getsize(target)
    kind, lang = _fs_file_kind(rel)
    payload = {"path": rel, "size": size, "kind": kind, "lang": lang}
    if kind == "image":
        if size > _IMG_MAX:
            payload.update(
                {"binary": True, "content": "", "note": "图片超过 8MB，仅可下载查看。"}
            )
            return payload
        import base64 as _b64

        with open(target, "rb") as fh:
            payload["dataUrl"] = (
                f"data:{lang};base64,{_b64.b64encode(fh.read()).decode('ascii')}"
            )
        return payload
    if kind == "pdf":
        # 前端用 <iframe> 嵌入浏览器内建 PDF 查看器, agent 无需引入 pdf.js
        if size > _PDF_MAX:
            payload.update(
                {"binary": True, "content": "", "note": "PDF 超过 24MB，仅可下载查看。"}
            )
            return payload
        import base64 as _b64

        with open(target, "rb") as fh:
            payload["dataUrl"] = "data:application/pdf;base64," + _b64.b64encode(
                fh.read()
            ).decode("ascii")
        return payload
    with open(target, "rb") as fh:
        head = fh.read(min(size, _FS_TEXT_MAX + 64 * 1024))
    if b"\x00" in head[:8192]:
        payload.update({"binary": True, "content": ""})
        return payload
    truncated = size > _FS_TEXT_MAX
    text = head[:_FS_TEXT_MAX].decode("utf-8", "replace")
    payload.update({"binary": False, "content": text, "truncated": truncated})
    return payload


def _fs_op_payload(project, action: str, src: str, dst: str, name: str) -> dict:
    """文件浏览器的右键操作: delete/move/copy/rename/touch/mkdir。

    所有路径都经 _fs_resolve 限制在项目根内, 并拒绝触碰 .git 等受保护目录;
    move/copy 的目标已存在时直接报错(不静默覆盖)。
    """
    base = str((project or {}).get("dir") or "").strip()
    if not base or not os.path.isdir(base):
        raise HTTPException(
            status_code=404, detail="项目目录不存在，请编辑项目并填写本地路径"
        )
    protected = list(_FS_HIDDEN_NAMES)

    def _resolved(rel: str):
        target, root = _fs_resolve(base, rel)
        if target is None or target == root:
            raise HTTPException(status_code=400, detail="路径无效或越出项目目录")
        for seg in target[len(root) + 1 :].split(os.sep):
            if seg in protected:
                raise HTTPException(status_code=400, detail=f"受保护目录: {seg}")
        return target, root

    src_t, _ = _resolved(src)

    if action == "delete":
        if src_t == os.path.realpath(base):
            raise HTTPException(status_code=400, detail="不能删除项目根目录")
        try:
            if os.path.isdir(src_t) and not os.path.islink(src_t):
                shutil.rmtree(src_t)
            else:
                os.unlink(src_t)
        except FileNotFoundError:
            pass
        return {"ok": True}

    if action == "touch" or action == "mkdir":
        clean = os.path.basename(str(name or "").replace("\\", "/").replace("\x00", ""))[
            :200
        ]
        if not clean or clean in (".", "..") or "/" in clean or clean in protected:
            raise HTTPException(status_code=400, detail="名称无效")
        target = os.path.join(src_t, clean)
        if os.path.exists(target):
            raise HTTPException(status_code=400, detail="同名条目已存在")
        if action == "mkdir":
            os.makedirs(target, exist_ok=False)
        else:
            with open(target, "x", encoding="utf-8"):
                pass
        return {"ok": True}

    # move / copy / rename: 目标必须不存在(不静默覆盖)
    dst_t, _ = _resolved(dst)
    if os.path.exists(dst_t):
        raise HTTPException(status_code=400, detail="目标路径已存在")
    if action in ("move", "rename"):
        shutil.move(src_t, dst_t)
        return {"ok": True}
    if action == "copy":
        if os.path.isdir(src_t):
            shutil.copytree(src_t, dst_t)
        else:
            shutil.copy2(src_t, dst_t)
        return {"ok": True}
    raise HTTPException(status_code=400, detail=f"未知操作: {action}")
