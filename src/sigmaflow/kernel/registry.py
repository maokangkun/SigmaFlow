"""Mod 注册表: 已安装记录、启用状态、依赖拓扑与世代(epoch)。

世代机制(设计 §4.2): mod 集合每次变更 epoch+1; Agent 等消费者在构造时
捕获当前 epoch 并绑定该代的不可变快照, 存量 run 跑完旧代, 新 run 用新代。
"""

from __future__ import annotations

import itertools
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional

from .manifest import Manifest, manifest_from_dict

MOD_STATES = ("installed", "enabled", "disabled", "blocked", "error", "skipped")


@dataclass
class ModRecord:
    manifest: Manifest
    path: Path  # mod 目录(可能是安装副本或原位引用)
    origin: str = "local"  # local | builtin | git | zip
    state: str = "installed"
    state_reason: str = ""
    epoch_loaded: int = 0

    @property
    def mod_id(self) -> str:
        return self.manifest.id

    def to_dict(self) -> dict:
        d = self.manifest.to_dict()
        d.update(
            {
                "path": str(self.path),
                "origin": self.origin,
                "state": self.state,
                "stateReason": self.state_reason,
                "epochLoaded": self.epoch_loaded,
            }
        )
        return d


@dataclass
class LoadPlan:
    """一次加载批次的结果: 拓扑序 + 被阻塞者及原因。"""

    order: List[str] = field(default_factory=list)
    blocked: Dict[str, str] = field(default_factory=dict)


class ModRegistry:
    def __init__(self) -> None:
        self._records: Dict[str, ModRecord] = {}
        self._lock = threading.RLock()
        self._epoch_counter = itertools.count(1)
        self.epoch = next(self._epoch_counter)

    # ------------------------------------------------------------ 记录管理
    def add(self, record: ModRecord) -> None:
        with self._lock:
            self._records[record.mod_id] = record

    def remove(self, mod_id: str) -> Optional[ModRecord]:
        with self._lock:
            return self._records.pop(mod_id, None)

    def get(self, mod_id: str) -> Optional[ModRecord]:
        return self._records.get(mod_id)

    def all(self) -> List[ModRecord]:
        with self._lock:
            return list(self._records.values())

    def enabled(self) -> List[ModRecord]:
        return [r for r in self.all() if r.state == "enabled"]

    # ---------------------------------------------------------------- 世代
    def bump_epoch(self) -> int:
        """mod 集合发生变更(启停/装卸/配置)后调用; 返回新世代号。"""
        with self._lock:
            self.epoch = next(self._epoch_counter)
            return self.epoch

    # ---------------------------------------------------------------- 拓扑
    def load_plan(self) -> LoadPlan:
        """对启用态 mod 做依赖拓扑排序; 缺依赖者入 blocked。

        循环依赖按“参与环的全部阻塞”处理并说明原因(宁可拒绝加载,
        不做猜测性打破 — 与设计 §5.3 的确定性原则一致)。
        """
        plan = LoadPlan()
        records = {r.mod_id: r for r in self.enabled()}
        # sigmaflow 版本要求统一放过(安装期已校验, 运行期不做 importlib.metadata 探测)
        pending = dict(records)
        progressed = True
        while pending and progressed:
            progressed = False
            for mid in list(pending):
                man = pending[mid].manifest
                missing = [
                    dep for dep, spec in man.requires_mods.items() if dep not in records
                ]
                if missing:
                    plan.blocked[mid] = f"missing dependency: {', '.join(missing)}"
                    pending.pop(mid)
                    records.pop(mid, None)
                    progressed = True
                    continue
                if all(dep in plan.order for dep in man.requires_mods):
                    plan.order.append(mid)
                    pending.pop(mid)
                    progressed = True
        if pending:
            cycle = ", ".join(sorted(pending))
            for mid in pending:
                plan.blocked[mid] = f"dependency cycle involving: {cycle}"
        return plan

    # ---------------------------------------------------------------- 工厂
    @staticmethod
    def record_from_dir(path: Path, *, origin: str = "local") -> ModRecord:
        manifest_path = path / "mod.toml"
        if not manifest_path.is_file():
            raise FileNotFoundError(f"{path}: mod.toml not found")
        manifest = manifest_from_dict(
            _read_toml(manifest_path), source=str(manifest_path)
        )
        return ModRecord(manifest=manifest, path=path, origin=origin)


def _read_toml(path: Path) -> dict:
    try:
        import tomllib as toml_mod
    except ModuleNotFoundError:  # pragma: no cover
        import tomli as toml_mod  # type: ignore[no-redef]
    with open(path, "rb") as fh:
        return toml_mod.load(fh)
