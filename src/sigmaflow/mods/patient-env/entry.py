"""虚拟患者环境 mod 入口: 把 EnvSpec 注册进 envs 服务。

实现(工具 schema/提示词/页面标题)仍在 sigmaflow.server.patenv — mod 只做
接线; 卸载时宿主按 dispose_owner 约定自动从注册表摘除(env mod 的停用
语义是 restart 级, 见 mod.toml reload)。
"""

from sigmaflow.server.patenv import (
    HUB,
    PATIENT_PROJECT_ID,
    PATIENT_PROJECT_NAME,
    patient_agent_prompt,
)


def activate(ctx):
    from sigmaflow.server.mods import EnvSpec

    ctx.services.envs.register(
        EnvSpec(
            hub=HUB,
            prefix="patenv",
            page_title="虚拟患者",
            project_id=PATIENT_PROJECT_ID,
            project_name=PATIENT_PROJECT_NAME,
            project_description="AI 智能体在虚拟患者环境里做病例挑战的会话集合",
            project_tags=["虚拟患者", "病例挑战"],
            project_icon="patient",
            prompt_fn=patient_agent_prompt,
            owner=ctx.mod_id,
        )
    )
