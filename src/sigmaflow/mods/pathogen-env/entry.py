"""虚拟病原体环境 mod 入口: 注册 EnvSpec(带五组分层端点)。"""

from sigmaflow.server.pathenv import (
    GROUPS,
    HUB,
    PATHOGEN_PROJECT_ID,
    PATHOGEN_PROJECT_NAME,
    pathogen_agent_prompt,
)


def activate(ctx):
    from sigmaflow.server.mods import EnvSpec

    ctx.services.envs.register(
        EnvSpec(
            hub=HUB,
            prefix="pathenv",
            page_title="虚拟病原体",
            project_id=PATHOGEN_PROJECT_ID,
            project_name=PATHOGEN_PROJECT_NAME,
            project_description="AI 智能体在虚拟病原体环境里做仿真实验的会话集合",
            project_tags=["虚拟病原体", "仿真实验"],
            project_icon="virus",
            prompt_fn=pathogen_agent_prompt,
            groups=GROUPS,
            owner=ctx.mod_id,
        )
    )
