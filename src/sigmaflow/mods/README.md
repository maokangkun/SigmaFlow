# SigmaFlow Mod 开发指南

Mod 是 SigmaFlow 的功能单元：工具、提示词、技能、虚拟环境、前端视图、
流水线节点、agent loop 行为——都以 mod 形态挂载，可随时启停/重载/替换。
本目录是随产品分发的内置 mod；用户 mod 放 `~/.sigmaflow/mods/`（同名时
用户目录优先）。

## 一个最小的 mod（约 1 分钟）

```
my-mod/
├── mod.toml      # 清单(必需)
└── entry.py      # activate(ctx) 入口(有代码贡献时)
```

```toml
# mod.toml
[mod]
id = "my-tool"          # kebab-case, 全局唯一
name = "我的工具"
version = "0.1.0"
reload = "run-boundary" # instant | run-boundary | restart

[api]
tools = 1               # 声明依赖的契约版本

[config.defaults]
greeting = "hello"
```

```python
# entry.py
def activate(ctx):
    ctx.services.tools.register(
        name="my_greet",
        description="Say a configurable greeting.",
        input_schema={"type": "object", "properties": {}},
        handler=lambda **kw: ctx.config.get("greeting", "hello"),
        audience="both",           # main | subagent | both
        owner=ctx.mod_id,
    )
```

放入 `~/.sigmaflow/mods/my-tool/`，服务端 `POST /api/mods/install`
（body `{"source": "<目录路径>"}`）或重启后自动装载。设置页 → Mod 管理
可启停/重载；`current_time`（example-tools）即此模板的完整示例。

## 可用的注册面（ctx.services.*）

| 服务 | 用途 | 示例 |
|---|---|---|
| `tools.register(...)` | 注册 agent 工具（schema+handler） | example-tools |
| `loop.on/around(event, fn)` | agent 事件钩子 / 包裹器 | example-loop-hooks |
| `loop.override_stage(stage, fn)` | 替换单个 loop 阶段 | tests/test_loop_hooks |
| `loop.replace_driver(fn)` | 整体替换 agent loop（experimental） | 同上 |
| `envs.register(EnvSpec(...))` | 虚拟环境（浏览器宿主 + MCP 工具面） | pathogen-env |
| `nodes.register_module(path)` | 贡献流水线节点类型 | tests/test_mods_nodes |
| `prompts.add_section(...)` | system prompt 分段贡献（需 prompt 能力） | — |

## agent 事件清单（loop.on / loop.around）

- observe：`agent.turn.begin` / `agent.turn.end` / `agent.loop.end`
- around：`agent.stage.<turn_begin|llm_call|settle|exec_tools|turn_end>`
  包裹整阶段（`fn(next_stage, agent, lc)`，调 `next_stage(agent, lc)` 继续）
- around：`agent.tool.exec` —— `fn(next_fn, func=..., inp=...)`，
  `next_fn()` 执行真实调用；可改参/改返回值/短路；异常自动回退真实调用

## UI mod（science 工作台，免构建运行时装入）

manifest 声明 `[capabilities] ui = true`，放 `ui/entry.js`（原生 ES
module），启动时由 SFM SDK 动态 import。可用 `window.SFM`：
`registerView / registerCard / registerSetting / call / on`。示例：
example-ui。

## 热更新级别（reload 字段）

- `instant`：配置/提示词/UI 类改动即时生效
- `run-boundary`（默认）：代码类改动经"重载"后，**新会话**用新代码，
  进行中的会话持旧代码跑完（世代切换）
- `restart`：路由/环境类，启停需重启服务（面板会提示）

## 能力声明（capabilities）

默认全关。`fs-read/fs-write`（路径列表）、`exec`、`network`（域列表）、
`mcp`、`ui`、`prompt`——超出声明的作用域会被 CapabilityGate 拒绝并记审计。

## 配置叠加

`mod.toml [config.defaults]` → `~/.sigmaflow/patch.toml`（id 定向覆盖）
→ 项目级 patch（规划中）。设置页 Mod 管理可改配置并看每键来源层。
