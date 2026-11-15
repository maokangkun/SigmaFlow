"""ModHost — mod 的加载/卸载/热切换(设计 §4.2 / §8)。

加载模型:
- 每个 mod 的代码以唯一模块名 ``sfmod_<id>_<序号>`` 装入 sys.modules
  (importlib 规范要求 dataclass/typing 等能找到真实模块名), 卸载时摘除。
- ``activate(ctx)`` 里的一切注册都被记录: 钩子按 owner 清理、服务按属主
  摘除、卸载回调逆序执行。
- 热切换 = unload(旧) → load(新) → registry.bump_epoch(); 进行中的
  run 持有旧代对象引用自然跑完, 新 run 从注册表取新代快照。

错误隔离: 单个 mod 加载失败置 error 态并保留原因, 不影响其他 mod。
"""

from __future__ import annotations

import importlib.util
import itertools
import sys
import threading
from pathlib import Path
from typing import Callable, Dict, List, Optional

from .context import ModContext
from .hooks import HookBus
from .manifest import Manifest
from .permissions import CapabilityGate
from .registry import ModRecord, ModRegistry
from .services import ServiceRegistry
from .store import ModStore, PatchEntry, resolve_config


class ModHost:
    def __init__(
        self,
        *,
        registry: Optional[ModRegistry] = None,
        services: Optional[ServiceRegistry] = None,
        hooks: Optional[HookBus] = None,
        store: Optional[ModStore] = None,
        event_sink: Optional[Callable[[dict], None]] = None,
    ):
        self.registry = registry or ModRegistry()
        self.services = services or ServiceRegistry()
        self.hooks = hooks or HookBus()
        self.store = store
        self.event_sink = event_sink
        self._contexts: Dict[str, ModContext] = {}
        self._modules: Dict[str, str] = {}  # mod_id → sys.modules 名
        self._load_seq = itertools.count(1)
        self._lock = threading.RLock()

    # ------------------------------------------------------------ 加载
    def load(self, record: ModRecord) -> bool:
        """加载一个启用态 mod; 成功 True, 失败置 error 态返回 False。"""
        with self._lock:
            try:
                return self._load_locked(record)
            except Exception as exc:  # noqa: BLE001 — 加载隔离边界
                record.state = "error"
                record.state_reason = f"{type(exc).__name__}: {exc}"
                self._emit(
                    {
                        "kind": "mod.error",
                        "mod": record.mod_id,
                        "error": record.state_reason,
                    }
                )
                return False

    def _load_locked(self, record: ModRecord) -> bool:
        mod_id = record.mod_id
        if mod_id in self._contexts:
            self.unload(mod_id)
        entry = record.path / "entry.py"
        manifest = record.manifest

        cfg = self._resolve_mod_config(manifest)
        ctx = ModContext(
            mod_id=mod_id,
            epoch=self.registry.epoch,
            services=self.services,
            hooks=self.hooks,
            capabilities=CapabilityGate(mod_id, manifest.capabilities),
            config=cfg.value,
            config_provenance=cfg.provenance,
        )

        if entry.is_file():
            module = self._import_entry(mod_id, entry)
            activate = getattr(module, "activate", None)
            if not callable(activate):
                raise TypeError(f"{mod_id}: entry.py lacks activate(ctx)")
            activate(ctx)
            self._modules[mod_id] = module.__name__
        # 纯数据 mod(无 entry.py): contributions 直接来自 manifest
        self._contexts[mod_id] = ctx
        record.state = "enabled"
        record.state_reason = ""
        record.epoch_loaded = self.registry.epoch
        return True

    def _import_entry(self, mod_id: str, entry: Path):
        name = f"sfmod_{mod_id.replace('-', '_')}_{next(self._load_seq)}"
        spec = importlib.util.spec_from_file_location(name, entry)
        if spec is None or spec.loader is None:
            raise ImportError(f"cannot create import spec for {entry}")
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module  # dataclass/typing 解析需要真实模块名
        try:
            spec.loader.exec_module(module)
        except Exception:
            sys.modules.pop(name, None)
            raise
        return module

    # ------------------------------------------------------------ 卸载
    def unload(self, mod_id: str) -> List[str]:
        """卸载: 停钩子 → 跑卸载回调 → 服务按 dispose_owner 约定回收 → 摘模块。"""
        with self._lock:
            ctx = self._contexts.pop(mod_id, None)
            errors: List[str] = []
            if ctx is None:
                return errors
            errors.extend(ctx.run_unload_callbacks() or [])
            self.hooks.unsubscribe_owner(mod_id)
            # 服务约定: 任何实现 dispose_owner(mod_id) 的服务在此回收该 mod 的
            # 贡献(工具桥、环境注册表、提示词组装器…), mod 侧无需样板卸载代码
            for svc in self.services.instances():
                dispose = getattr(svc, "dispose_owner", None)
                if callable(dispose):
                    try:
                        dispose(mod_id)
                    except Exception as exc:  # noqa: BLE001 — 回收尽力而为
                        errors.append(f"dispose:{type(exc).__name__}: {exc}")
            for name, owner in list(self.services.names().items()):
                if owner == mod_id:
                    self.services.remove(name, owner="core")
            module_name = self._modules.pop(mod_id, None)
            if module_name:
                sys.modules.pop(module_name, None)
            self._emit({"kind": "mod.unloaded", "mod": mod_id})
            return errors

    # ---------------------------------------------------------- 批量装载
    def bootstrap(
        self,
        builtin_dirs: Optional[List[Path]] = None,
        *,
        target: str = "all",
    ) -> Dict[str, int]:
        """进程启动期的完整装配: 扫描目录 → 应用 profile/patch → 拓扑加载。

        返回统计 {loaded, blocked, errored}。目录优先级: 项目 > 用户 > 内置
        (同名前者遮蔽后者, 设计 §10)。``target`` 为本进程的运行面
        ("server"/"cli"/"all"), manifest.target 不含本面的 mod 跳过加载
        (记录保留, 状态标记 skipped)。
        """
        with self._lock:
            builtin_dirs = builtin_dirs or []
            for path in builtin_dirs:
                self._scan_dir(path, origin="builtin")
            if self.store is not None:
                self.store.ensure_layout()
                self._scan_dir(self.store.mods_dir, origin="local")
                self._apply_profile_patch()
            # 运行面过滤: 不属于本进程面的 mod 保持 installed/skipped, 不参与拓扑
            for rec in self.registry.all():
                if (
                    rec.manifest.target != "all"
                    and rec.manifest.target != target
                    and target != "all"
                ):
                    if rec.state in ("enabled", "installed"):
                        rec.state = "skipped"
                        rec.state_reason = f"target {rec.manifest.target!r} not loaded in {target!r} process"
            plan = self.registry.load_plan()
            stats = {"loaded": 0, "blocked": 0, "errored": 0, "skipped": 0}
            for rec in self.registry.all():
                if rec.state == "skipped":
                    stats["skipped"] += 1
            for mod_id, reason in plan.blocked.items():
                rec = self.registry.get(mod_id)
                if rec:
                    rec.state = "blocked"
                    rec.state_reason = reason
                stats["blocked"] += 1
            for mod_id in plan.order:
                rec = self.registry.get(mod_id)
                if rec is None:
                    continue
                if self.load(rec):
                    stats["loaded"] += 1
                else:
                    stats["errored"] += 1
            self.registry.bump_epoch()
            return stats

    def _scan_dir(self, path: Path, *, origin: str) -> None:
        if not path.is_dir():
            return
        for child in sorted(path.iterdir()):
            if not (child / "mod.toml").is_file():
                continue
            try:
                rec = ModRegistry.record_from_dir(child, origin=origin)
            except Exception as exc:  # noqa: BLE001 — 坏 mod 不拖垮扫描
                self._emit({"kind": "mod.error", "mod": child.name, "error": str(exc)})
                continue
            existing = self.registry.get(rec.mod_id)
            if existing is not None and origin == "builtin":
                continue  # 用户/项目目录优先于内置, 不覆盖
            self.registry.add(rec)

    def _apply_profile_patch(self) -> None:
        assert self.store is not None
        try:
            profile = set(self.store.read_profile())
        except Exception:  # noqa: BLE001
            profile = set()
        patches = self._patches_for_records()
        for rec in self.registry.all():
            patch = patches.get(rec.mod_id)
            if patch is not None and patch.enabled is not None:
                rec.state = "enabled" if patch.enabled else "disabled"
                if not patch.enabled:
                    rec.state_reason = "disabled by patch"
            elif profile:
                # profile 存在时: 列表内默认启用, 列表外默认禁用(首次安装除外)
                if rec.mod_id in profile:
                    rec.state = "enabled"
                elif rec.state == "installed":
                    rec.state = "disabled"
                    rec.state_reason = "not in profile"
            else:
                # 无 profile: 本地安装的默认启用(10 分钟上手原则)
                if rec.state == "installed":
                    rec.state = "enabled"

    def _patches_for_records(self) -> Dict[str, PatchEntry]:
        assert self.store is not None
        try:
            entries = self.store.read_patch()
        except Exception:  # noqa: BLE001
            entries = []
        return {e.mod: e for e in entries}

    def _resolve_mod_config(self, manifest: Manifest):
        layers: List[List[PatchEntry]] = []
        if self.store is not None:
            try:
                layers.append(self.store.read_patch())
            except Exception:  # noqa: BLE001
                pass
        return resolve_config(manifest.config_defaults, *layers, mod_id=manifest.id)

    # ------------------------------------------------------------ 内省
    @property
    def contexts(self) -> Dict[str, ModContext]:
        return dict(self._contexts)

    def describe(self) -> List[dict]:
        out = []
        for rec in self.registry.all():
            d = rec.to_dict()
            d["loaded"] = rec.mod_id in self._contexts
            out.append(d)
        return out

    def _emit(self, event: dict) -> None:
        if self.event_sink is not None:
            try:
                self.event_sink(event)
            except Exception:  # noqa: BLE001
                pass
