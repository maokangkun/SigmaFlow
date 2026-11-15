"""能力门控(设计 §9): mod 声明的 capabilities 在运行时逐点校验。

门控点由各服务实现自行调用(工具执行前查 exec/fs、网络调用前查 network)。
``CapabilityDenied`` 上抛后按调用方的错误策略处理: agent 工具层转为
工具错误文本, server 层转为 403。
"""

from __future__ import annotations

from typing import Optional

from .manifest import CapabilitySet


class CapabilityDenied(PermissionError):
    def __init__(self, mod_id: str, cap: str, detail: Optional[str] = None):
        self.mod_id = mod_id
        self.capability = cap
        self.detail = detail
        msg = f"mod {mod_id!r} lacks capability {cap!r}"
        if detail:
            msg += f" (for {detail!r})"
        super().__init__(msg)


class CapabilityGate:
    """一个 mod 的能力视图; 服务实现持有并逐点调用。"""

    def __init__(self, mod_id: str, caps: CapabilitySet):
        self.mod_id = mod_id
        self.caps = caps

    def check(self, cap: str, detail: Optional[str] = None) -> None:
        """不通过即抛 ``CapabilityDenied``; 通过返回 None。"""
        if not self.caps.grants(cap, detail):
            raise CapabilityDenied(self.mod_id, cap, detail)

    def allows(self, cap: str, detail: Optional[str] = None) -> bool:
        return self.caps.grants(cap, detail)


# 服务名 → 所需能力的映射表: ModContext.services 视图按此过滤。
SERVICE_CAPABILITY = {
    "tools": "registry",
    "prompts": "prompt",
    "skills": "registry",
    "mcp": "mcp",
    "envs": "registry",
    "nodes": "registry",
    "clients": "registry",
    "blocks": "registry",
    "runs": None,  # None = 无需能力(只读/通用服务)
    "models": None,
    "projects": None,
    "fs": None,  # fs 服务内部再按 fs-read/fs-write 逐路径门控
    "events": None,
    "modself": None,  # mod 自身状态(日志/配置/卸载回调)
}
