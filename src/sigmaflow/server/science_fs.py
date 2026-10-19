"""Science 文件域: 项目文件树读写/文本/上传/exec/git 状态/每项目 PTY 会话.

payload 函数由 science.py 路由层调用; PTY 会话跨 websocket 复用。"""

import base64
import fcntl
import os
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
    """Read one file for the read-only preview modal."""
    base = str((project or {}).get("dir") or "").strip()
    if not base or not os.path.isdir(base):
        raise HTTPException(status_code=404, detail="项目目录不存在")
    target, root = _fs_resolve(base, rel)
    if target is None:
        raise HTTPException(status_code=403, detail="越界路径")
    if not os.path.isfile(target):
        raise HTTPException(status_code=404, detail="文件不存在")
    size = os.path.getsize(target)
    with open(target, "rb") as fh:
        head = fh.read(min(size, _FS_TEXT_MAX + 64 * 1024))
    if b"\x00" in head[:8192]:
        return {"path": rel, "size": size, "binary": True, "content": ""}
    truncated = size > _FS_TEXT_MAX
    text = head[:_FS_TEXT_MAX].decode("utf-8", "replace")
    return {
        "path": rel,
        "size": size,
        "binary": False,
        "content": text,
        "truncated": truncated,
    }
