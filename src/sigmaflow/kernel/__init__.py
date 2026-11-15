"""SigmaFlow kernel — mod 化内核(设计文档 §4)。

三件套: ModRegistry / HookBus / ServiceRegistry, 加上 ModHost(装配)、
ToolRegistry / PromptComposer(agent 侧扩展面)与清单/门控/存储。
本包零第三方依赖: agent 侧(CLI/无服务器)与 server 侧都可安全导入。

典型装配(server):
    from sigmaflow.kernel import ModHost, ModStore, ServiceRegistry, HookBus
    host = ModHost(store=ModStore(Path.home() / ".sigmaflow"))
    host.bootstrap(builtin_dirs=[REPO / "mods"])

P0 阶段 host 未接线时, agent 侧仅消费 ToolRegistry/PromptComposer 的
遗留适配器, 行为与单体完全一致。
"""

from .hooks import HookBus, HookError, Subscription
from .manifest import (
    API_VERSIONS,
    CapabilitySet,
    Manifest,
    ManifestError,
    parse_manifest,
)
from .permissions import CapabilityDenied, CapabilityGate
from .prompts import PromptComposer, PromptSection, PromptSectionConflict
from .registry import LoadPlan, ModRecord, ModRegistry
from .services import ServiceRegistry, ServiceOverrideError, ServiceView
from .store import (
    ModStore,
    PatchEntry,
    ResolvedConfig,
    parse_patch,
    parse_profile,
    resolve_config,
    UserModState,
)
from .context import ModContext
from .host import ModHost
from .tools import (
    MAIN,
    SUBAGENT,
    ToolConflictError,
    ToolRegistry,
    ToolSnapshot,
    ToolSpec,
)

__all__ = [
    "API_VERSIONS",
    "CapabilityDenied",
    "CapabilityGate",
    "CapabilitySet",
    "HookBus",
    "HookError",
    "LoadPlan",
    "MAIN",
    "Manifest",
    "ManifestError",
    "ModContext",
    "ModHost",
    "ModRecord",
    "ModRegistry",
    "ModStore",
    "PatchEntry",
    "PromptComposer",
    "PromptSection",
    "PromptSectionConflict",
    "ResolvedConfig",
    "ServiceOverrideError",
    "ServiceRegistry",
    "ServiceView",
    "SUBAGENT",
    "Subscription",
    "ToolConflictError",
    "ToolRegistry",
    "ToolSnapshot",
    "ToolSpec",
    "UserModState",
    "parse_manifest",
    "parse_patch",
    "parse_profile",
    "resolve_config",
]
