"""mod 状态持久化与配置叠加求值(设计 §7 / §10)。

叠加顺序(后者覆盖前者):
1. mod 自带 ``[config].defaults``
2. ``profile.toml``  — 用户启用的 mod 列表(顺序即优先级)
3. ``patch.toml``    — id 定向: 覆盖配置 / 禁用贡献 / 关闭 mod
4. 项目级 ``patch.toml``(由调用方传入, store 本体不感知项目路径)

求值结果带溯源(哪一层定的这个值), 供设置页"为什么是这个值"视图。
所有写入走临时文件 + os.replace 原子替换(与现有 _atomic_save 同款语义)。
"""

from __future__ import annotations

import json
import os
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    import tomllib as _toml
except ModuleNotFoundError:  # pragma: no cover
    import tomli as _toml  # type: ignore[no-redef]


# --------------------------------------------------------------- 数据结构
@dataclass
class PatchEntry:
    mod: str
    enabled: Optional[bool] = None
    config: Dict[str, Any] = field(default_factory=dict)
    disable: Dict[str, List[str]] = field(default_factory=dict)  # contribution → ids
    keep_on_unload: bool = False

    @staticmethod
    def from_dict(data: dict) -> "PatchEntry":
        return PatchEntry(
            mod=str(data.get("mod") or ""),
            enabled=data.get("enabled"),
            config=dict(data.get("config") or {}),
            disable={
                str(k): [str(x) for x in (v or [])]
                for k, v in (data.get("disable") or {}).items()
            },
            keep_on_unload=bool(data.get("keep-on-unload")),
        )


@dataclass
class ResolvedConfig:
    value: Dict[str, Any] = field(default_factory=dict)
    provenance: Dict[str, str] = field(
        default_factory=dict
    )  # key → "defaults"|"user-patch"|"project-patch"


# ------------------------------------------------------------------ 解析
def parse_profile(text: str) -> List[str]:
    """profile.toml → 有序 mod id 列表。

    接受两种形态:
    ``mods = ["a", "b"]`` 或 ``[[mod]] id = "a"`` / ``[[mod]] id = "b"``。
    """
    if not text.strip():
        return []
    data = _toml.loads(text)
    mods = data.get("mods")
    if isinstance(mods, list):
        return [str(x) for x in mods]
    out = []
    for entry in data.get("mod") or []:
        if isinstance(entry, dict) and entry.get("id"):
            out.append(str(entry["id"]))
    return out


def parse_patch(text: str) -> List[PatchEntry]:
    if not text.strip():
        return []
    data = _toml.loads(text)
    return [PatchEntry.from_dict(e) for e in data.get("patch") or []]


def resolve_config(
    defaults: Dict[str, Any],
    *patch_layers: List[PatchEntry],
    mod_id: str = "",
) -> ResolvedConfig:
    """多层 patch 叠加到默认值上; 后层覆盖前层, 记录每键来源层。"""
    rc = ResolvedConfig(value=dict(defaults), provenance={})
    for key in defaults:
        rc.provenance[key] = "defaults"
    layer_names = ["user-patch", "project-patch"]
    for idx, layer in enumerate(patch_layers):
        name = layer_names[idx] if idx < len(layer_names) else f"layer-{idx}"
        for entry in layer or []:
            if entry.mod != mod_id:
                continue
            for key, val in entry.config.items():
                rc.value[key] = val
                rc.provenance[key] = name
    return rc


# ------------------------------------------------------------------- 存储
class ModStore:
    """~/.sigmaflow(或 $SIGMAFLOW_HOME)下的持久化结构。"""

    def __init__(self, home: Path):
        self.home = Path(home)
        self.mods_dir = self.home / "mods"
        self.profile_path = self.home / "profile.toml"
        self.patch_path = self.home / "patch.toml"
        self.state_path = self.home / "modstate.json"
        self._lock = threading.RLock()

    # ------------------------------------------------------------- 布局
    def ensure_layout(self) -> None:
        self.mods_dir.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------ profile
    def read_profile(self) -> List[str]:
        with self._lock:
            if not self.profile_path.is_file():
                return []
            return parse_profile(self.profile_path.read_text(encoding="utf-8"))

    def write_profile(self, mod_ids: List[str]) -> None:
        lines = ["# SigmaFlow mod profile — 启用列表, 顺序即优先级\n"]
        lines.append("mods = [")
        for mid in mod_ids:
            lines.append(f'  "{mid}",')
        lines.append("]\n")
        self._atomic(self.profile_path, "\n".join(lines))

    # -------------------------------------------------------------- patch
    def read_patch(self) -> List[PatchEntry]:
        with self._lock:
            if not self.patch_path.is_file():
                return []
            return parse_patch(self.patch_path.read_text(encoding="utf-8"))

    def write_patch(self, entries: List[PatchEntry]) -> None:
        chunks = ["# SigmaFlow mod patch — id 定向覆盖层(对应设计 §7)\n"]
        for e in entries:
            chunks.append("[[patch]]")
            chunks.append(f'mod = "{e.mod}"')
            if e.enabled is not None:
                chunks.append(f"enabled = {'true' if e.enabled else 'false'}")
            if e.keep_on_unload:
                chunks.append("keep-on-unload = true")
            if e.config:
                chunks.append("[patch.config]")
                for key, val in e.config.items():
                    chunks.append(_toml_kv(key, val))
            if e.disable:
                chunks.append("[patch.disable]")
                for contrib, ids in e.disable.items():
                    safe = json.dumps(ids, ensure_ascii=False)
                    chunks.append(f"{contrib} = {safe}")
            chunks.append("")
        self._atomic(self.patch_path, "\n".join(chunks))

    # -------------------------------------------------------------- state
    def read_state(self) -> dict:
        with self._lock:
            if not self.state_path.is_file():
                return {"mods": {}, "audit": []}
            try:
                return json.loads(self.state_path.read_text(encoding="utf-8"))
            except Exception:  # noqa: BLE001 — 状态文件损坏不致命
                return {"mods": {}, "audit": []}

    def write_state(self, state: dict) -> None:
        with self._lock:
            self._atomic(
                self.state_path, json.dumps(state, ensure_ascii=False, indent=2)
            )

    def audit(self, event: str, **kv: Any) -> None:
        """追加审计记录(谁/何时/什么变更, 设计 §9)。"""
        with self._lock:
            state = self.read_state()
            state.setdefault("audit", []).append(
                {"event": event, "at": time.time(), **kv}
            )
            # 审计只留最近 2000 条, 防无界膨胀
            state["audit"] = state["audit"][-2000:]
            self.write_state(state)

    # --------------------------------------------------------------- 内部
    def _atomic(self, path: Path, text: str) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".tmp")
        with open(tmp, "w", encoding="utf-8") as fh:
            fh.write(text)
        os.replace(tmp, path)


def _toml_kv(key: str, val: Any) -> str:
    if isinstance(val, bool):
        return f"{key} = {'true' if val else 'false'}"
    if isinstance(val, (int, float)):
        return f"{key} = {val}"
    # 字符串/数组/嵌套结构: JSON 子集与 TOML 字面量兼容(字符串/数组尤其如此)
    return f"{key} = {json.dumps(val, ensure_ascii=False)}"


# ------------------------------------------------------------- 用户级状态
class UserModState:
    """每个用户的 mod 启停/配置覆盖(多用户隔离, 设计 §10 用户层)。

    落盘在用户数据目录(如 ``<science>/users/<name>/modstate.json``), 与
    全局 patch.toml 正交: 用户层只写"这个用户对哪些 mod 的启停/配置"。
    """

    def __init__(self, path: Path):
        self.path = Path(path)
        self._lock = threading.RLock()

    # ------------------------------------------------------------- 读写
    def _load(self) -> dict:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else {}
        except Exception:  # noqa: BLE001 — 损坏视为空
            return {}

    def _save(self, data: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(
            json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    # ------------------------------------------------------------- 启停
    def get_enabled(self, mod_id: str) -> Optional[bool]:
        """该用户对 mod 的启停覆盖; None = 未覆盖(走全局默认)。"""
        with self._lock:
            entry = self._load().get("mods", {}).get(mod_id) or {}
            return entry.get("enabled")

    def set_enabled(self, mod_id: str, enabled: bool) -> None:
        with self._lock:
            data = self._load()
            data.setdefault("mods", {}).setdefault(mod_id, {})["enabled"] = bool(
                enabled
            )
            self._save(data)

    # ------------------------------------------------------------- 配置
    def get_config(self, mod_id: str) -> Dict[str, Any]:
        with self._lock:
            entry = self._load().get("mods", {}).get(mod_id) or {}
            return dict(entry.get("config") or {})

    def update_config(self, mod_id: str, updates: Dict[str, Any]) -> None:
        with self._lock:
            data = self._load()
            entry = data.setdefault("mods", {}).setdefault(mod_id, {})
            cfg = dict(entry.get("config") or {})
            cfg.update(updates)
            entry["config"] = cfg
            self._save(data)
