# SigmaFlow Science Mod 化技术设计与重构方案

> 版本 v1.0（供审阅）· 评审通过后按 §14 分阶段实施，任何阶段未达验收标准即停。
> 本文档基于对现有代码的实际盘点（见 §1），所有"现状"描述均可在代码中定位。

---

## 0. 摘要

把 SigmaFlow Science 从"单体 + 少量硬编码扩展点"重构为**内核 + Mod 的可组合系统**：

- **内核（kernel）** 只做三件事：Mod 注册表（安装/版本/依赖/世代）、钩子总线（优先级钩子，before/after/around）、服务注册表（models/runs/fs/projects/mcp/skills… 具名服务）。
- **一切功能皆 Mod 贡献（contribution）**：工具、提示词片段、技能、MCP 服务、HTTP/WS 路由、虚拟环境（EnvHub）、前端视图/卡片、流水线节点、LLM 客户端，以及 **agent loop 本身**（core-loop 是内置 mod，可被整体替换或逐阶段增删）。
- **热更新分三级**：数据型即时生效；代码型在"运行边界"做世代切换（新 run 用新代码，存量 run 跑完旧代码）；声明 `reload="restart"` 的 mod 走优雅重启。
- **配置叠加**借鉴 DSH/Cordis 的 bundle + patch 分层：`profile.toml`（启用哪些 mod）+ `patch.toml`（id 定向覆盖/禁用/改参），支持项目级再叠加。
- 前端分两档：science 工作台（原生 ES module）做到**真运行时加载 mod UI**；website/admin（React/Vite）先做构建期 mod 槽，运行时远程组件留到后期。

不做的事：不做进程内任意代码热替换的魔法（Python 的模块级状态使它不可靠）；第一期不做 mod 市场与签名体系；不引入 Cordis 本体作为依赖（借鉴其分层思想，实现走显式注册表路线，理由见 §3.2）。

---

## 1. 现状盘点（代码事实）

### 1.1 系统组成

| 部分 | 位置 | 规模 | 现状 |
|---|---|---|---|
| Agent 主体 | `agent/agent.py` | 1967 行 | `Agent.__call__` 单方法约 1380 行（L374–1751），内含 steer 注入①②、auto_compact、anthropic/openai 双分支流式调用+重试、工具分发、子代理递归、后台任务等待、nudge/goal 机制 |
| 工具系统 | `agent/tools.py` + `agent/conf.py` | 3046 + 798 行 | 已有 `TOOL_HANDLERS` dict（name→lambda）注册表雏形；schema 硬编码在 `conf.py` 的 `TOOLS`/`CHILD_TOOLS`；`SCIVERSE_TOOL_HANDLERS` 二次合并；MCP 工具动态注册（`TOOL_HANDLERS[mcp_tool.name] = make_handler(...)`） |
| Harness | `agent/harness.py` | 836 行 | memory、cron、GOAL、teammates，模块级单例 |
| Skills | `agent/tools.py` SkillLoader | — | frontmatter 解析、全局/项目两级目录、science 侧有 overrides 持久化 |
| Science 服务 | `server/science.py` | **7329 行** | ScienceAPI 单类约 3800 行路由（auth/system/fs/projects/chat/admin/env/pty…）；ScienceModelStore / ScienceRunManager / ScienceProjectStore |
| 虚拟环境 | `server/envbridge.py` + `pathenv.py`/`patenv.py` | — | **已是准插件模式**：`EnvHub` 基类（会话注册+长轮询桥），pathenv 按分子/宿主/诊断/群体/试验五组暴露 MCP 端点；docstring 明言"加环境=写数据描述" |
| 前端·science 工作台 | `server/science/` | ~14k 行 JS | 零依赖原生 ES module；自研 `build.mjs`：内容哈希拆分（`dist/a/<name>.<hash>.js`）+ `CS.ensureLazy` 懒加载 + standalone 单文件离线版 |
| 前端·website/admin | `server/website/`、`server/admin/` | — | React + Vite（radix/shadcn、tailwind），构建期打包 |
| 流水线 | `nodes/`(17 种)、`blocks/`、`clients/`(7 种 LLM 后端)、`pipeline/`、`managers/` | — | SigmaFlow 原核心：图编排、节点类每文件一个、客户端多后端 |
| 服务器装配 | `server/main.py` | — | PipelineServer 挂 5 组 router + SPA 静态；入口页 no-cache、哈希资产 immutable 的缓存策略已就绪 |

### 1.2 已具备的"半 mod 化"资产（重构的抓手）

1. `TOOL_HANDLERS` 注册表 + MCP 动态注册 —— 工具层只差"形式化"。
2. `EnvHub` 数据描述式环境 —— patenv/pathenv 可直接平移为首批 env mod。
3. skills 全局/项目两级 + overrides JSON —— 内容型 mod 的现成原型。
4. `mcp_servers.json` 运行时可改 —— MCP 服务贡献的现成通道。
5. system prompt 实际是拼装产物（`_system_base` + 目录块 + 模型块 + memory 注入 + skills 列表块）—— 只差把"既成事实"声明为分层贡献。
6. science 前端内容哈希 + 懒加载 + 入口 no-cache —— **前端 mod 热更新几乎免费**。
7. `Agent` 每次对话现场实例化（science.py L6269/L6869）—— 世代切换式热更新的天然条件。

### 1.3 主要痛点

- `Agent.__call__` 与 `science.py` 两个巨型单体，改任何行为都要动主干，无法局部替换或禁用。
- 扩展点全部硬编码：新环境要改 science.py 三处；新工具要同时改 conf.py（schema）与 tools.py（handler）。
- 行为开关散落（环境变量、overrides JSON、settings 接口各管一摊），没有统一的"最终生效配置"视图。
- 前端（尤其 website/admin）每次改动必须重新构建发版。

---

## 2. 设计目标与原则

**目标**（按优先级）：

1. 添加/修改/替换/禁用任意功能单元，不需要改 SigmaFlow 主干代码。
2. agent loop 本身可替换（core-loop 是内置 mod）。
3. 热更新到"运行边界"粒度，服务不中断。
4. 单个 mod 故障不拖垮系统（错误隔离 + 一键禁用回退）。
5. mod 开发体验：一个目录 + 一个 manifest + 一个入口，10 分钟能写出能跑的 mod。

**原则**：

- **绞杀者模式（strangler fig）**：内核先以适配层包住现有实现，行为零变化，再逐块迁移；每阶段有金轨测试（golden test）守护。
- **禁用一切 mod ≠ 系统残废**：core mod（loop、基础工具、基础路由）不可禁用基础贡献，禁用全部第三方 mod 后系统等价于今天的单体。
- **显式优于魔法**：不搞运行时 DI fork、不搞 import *；注册表、钩子、能力都是声明出来、可枚举、可审计的。
- **回退即卸载**：任何 mod 的问题用"禁用"解决，不需要回滚代码。

---

## 3. 参考对象：DSH（deepseek harness）插件机制拆解

### 3.1 DSH 做了什么

- 基于 **Cordis**（Koishi 生态的插件框架）：Context 依赖注入、服务互相 fork、插件可动态加载/卸载。
- **Profile = 分层叠加**：`package.json` 的 `dsh.profile.bundles`（如 `@deepseek-ai/dsh-base` + `dsh-headless`）逐层组合，之后 `cordis.patch.yml`（id 定向的覆盖/禁用/插入，支持 `!!js` 表达式）作为用户补丁层，`patchReload: startup` 控制重载时机。
- mod 以 npm 包分发，node 工具链承载版本与依赖。

### 3.2 借鉴什么、优化什么

| DSH/Cordis 机制 | 取舍 | 理由 |
|---|---|---|
| Context 运行时 DI、服务 fork | **不采用**，改显式注册表 + 类型化 Context 门面 | Cordis 的 fork 语义对调试器和类型检查不友好；SigmaFlow 规模下显式注册可枚举、可 diff、可审计 |
| bundle 分层 + `cordis.patch.yml` id 定向补丁 | **采用并扩展**：`profile.toml` + `patch.toml`，增加**项目级第三层** | 分层叠加被证明是低心智负担的定制方式；项目级叠加契合 science 的多项目数据隔离 |
| `patchReload: startup` | **升级为三级热更新**（§8） | 数据型 mod 即时、代码型 run 边界、声明式重启，覆盖绝大多数场景且不引入进程内热替换的不可靠性 |
| npm 承载 mod 分发 | **不采用**：mod = 磁盘目录（本地/git/zip），manifest 用 TOML | SigmaFlow 是 Python 体系，不应强迫 node 工具链参与后端 mod；目录式安装对内网/离线部署最友好 |
| 插件即 npm 包、全代码信任 | **细化能力声明**（§9） | 本地信任模型一致，但 UI/agent 双面暴露的系统需要能力可枚举 |

---

## 4. 总体架构

### 4.1 分层

```
┌─────────────────────────────────────────────────────────────┐
│  前端层   science 工作台(SFM SDK·运行时mod) / website·admin(构建期mod槽) │
├─────────────────────────────────────────────────────────────┤
│  服务层   FastAPI 路由 / WS / MCP 端点 / 静态伺服               │
│      ↑ 路由贡献、事件广播                                      │
├─────────────────────────────────────────────────────────────┤
│  Agent层  LoopPipeline(阶段化) · ToolRegistry · PromptComposer │
│           · SkillSet · EnvHub · SubagentFactory               │
│      ↑ agent.loop 替换点 + 全量钩子                            │
├─────────────────────────────────────────────────────────────┤
│  流水线层 NodeRegistry · BlockRegistry · ClientRegistry        │
├─────────────────────────────────────────────────────────────┤
│  内核     ModRegistry(安装/版本/依赖/世代) · HookBus ·          │
│           ServiceRegistry · CapabilityGate · ModStore         │
└─────────────────────────────────────────────────────────────┘
        Mod 目录: <repo>/mods → ~/.sigmaflow/mods → <project>/.sf/mods
        配置叠加: mod 默认 → profile.toml → patch.toml → 项目 patch
```

### 4.2 内核三件套

```python
# src/sigmaflow/kernel/ 新增包
manifest.py    # mod.toml 解析、schema 校验、API 版本契约检查
registry.py    # ModRegistry: 已安装/已启用/依赖拓扑/世代(epoch)管理
host.py        # ModHost: 加载(importlib 隔离命名空间)、卸载、世代切换、错误隔离
hooks.py       # HookBus: 优先级钩子，before/after/around 语义，异常降级为事件
services.py    # ServiceRegistry: 具名服务的注册与解析
context.py     # ModContext: mod 视角的受控 API（能力门面）
permissions.py # CapabilityGate: capabilities 声明与运行时检查
store.py       # mod 状态持久化（modstate.json）+ 配置叠加求值
```

**世代（epoch）机制**：mod 集合每次变更 `epoch += 1`。`Agent` 实例化时捕获当前 epoch，绑定该 epoch 的 ToolRegistry / PromptComposer / LoopPipeline **不可变快照**；存量 run 持旧快照跑完，新 run 取新快照。由于现状是每对话现场构造 `Agent`（science.py L6269/L6869），这个切换天然落在运行边界上，零改造即可生效。

### 4.3 ModContext（mod 视角的唯一入口）

```python
class ModContext:
    mod_id: str
    epoch: int
    services: Services          # 只暴露该 mod capabilities 允许的服务
    hooks: HookRegistration     # 注册钩子
    config: ConfigView          # 该 mod 叠加后的最终配置（只读）+ 变更通知
    log: logging.Logger         # 带 [mod:<id>] 前缀
    on_unload: callable         # 注册卸载回调（关后台任务、释放会话）
```

mod 的 `entry.py` 暴露 `def activate(ctx: ModContext) -> None`（可选 `deactivate(ctx)`）。内核在加载时调用，mod 在其中完成一切注册。

---

## 5. Mod 规范

### 5.1 目录布局与 manifest

```
my-mod/
├── mod.toml            # 清单（必需）
├── entry.py            # 后端入口（有代码贡献时必需）
├── tools/              # 工具实现（可选，按贡献自组织）
├── prompts/            # 提示词片段（可选）
├── skills/             # 随 mod 分发的技能（可选）
├── ui/                 # 前端贡献（可选）
│   ├── entry.js        # UI 入口 ES module
│   └── *.css / assets/
├── env/                # env mod: tools.py + prompt.md + meta（可选）
└── README.md
```

```toml
# mod.toml
[mod]
id = "pathogen-env"           # 全局唯一, kebab-case
name = "虚拟病原体环境"
version = "1.4.0"
authors = ["..."]
description = "分子→宿主内→群体→试验台的虚拟病原体仿真环境"
license = "MIT"
reload = "run-boundary"       # instant | run-boundary | restart (§8)

[api]                          # 声明依赖的内核 API 契约版本
tools = 1
loop = 1
ui = 1

[requires]
sigmaflow = ">=1.0"
mods = { "sciverse" = ">=2.0" }   # 可选的 mod 间依赖

[capabilities]                 # 能力声明（§9），默认全 false
fs-read  = ["<project>", "/tmp"]
fs-write = ["<project>"]
exec     = true
network  = ["api.anysearch.com"]
mcp      = true
ui       = true
prompt   = true                # 允许贡献 system prompt 片段

[contributions]                # 声明式贡献清单（内核据此校验与展示）
tools   = ["tools/*.py"]
prompts = ["prompts/*.md"]
skills  = ["skills/*"]
env     = "env"
routes  = "entry.py:register_routes"
ui      = "ui/entry.js"

[config]                       # 默认配置（可被 patch.toml 覆盖）
[config.defaults]
trial-replicas = 10
```

### 5.2 贡献类型总表

| 贡献 | 注册 API | 可替换性 | 热更新级别 |
|---|---|---|---|
| 工具 | `ctx.services.tools.register(spec)` | 显式 `overrides-tools` 声明方可同名替换，UI 显示替换链 | instant（启用态）/ run-boundary（代码） |
| 提示词片段 | `ctx.services.prompts.add_section(sec)` | 同 id 覆盖（weight 定序） | instant |
| 技能 | 目录贡献，合入现有 SkillLoader 扫描路径 | 项目>用户>mod 默认 | instant |
| MCP 服务 | `ctx.services.mcp.add_server(cfg)` | 配置合并 | instant |
| HTTP/WS 路由 | `ctx.register_routes(router)`，前缀 `/api/m/<id>/` | 不遮蔽核心路由；改核心行为走钩子 | restart（FastAPI 路由表不动态增删） |
| 虚拟环境 | `ctx.services.envs.register(hub)` | 同 id 覆盖 | run-boundary |
| agent loop | `agent.loop` **独占扩展点**：整体替换；或逐阶段钩子 | 需声明 `replaces = ["core-loop"]` | run-boundary |
| 流水线节点/块/客户端 | `nodes/blocks/clients.register()` | 同名需 override 声明 | restart |
| 前端视图/卡片/工具面板/设置节 | `SFM.registerView/Card/ToolUI/Setting` | 同 id 后者覆盖 + 还原链 | instant（重载 entry.js） |

### 5.3 冲突与顺序

- 钩子顺序 = `(weight, 安装顺序, id)`，weight 默认 100（<100 越靠近核心）。
- 同名贡献：默认报错并拒绝启用；manifest 显式声明覆盖后允许，管理界面展示"谁覆盖了谁"，可一键回退到下层。
- 依赖缺失/版本不符：mod 停在 `blocked` 态并给出原因，不阻塞其他 mod。

---

## 6. 各层 mod 化设计

### 6.1 Agent 层：loop 阶段化 + loop-as-mod（核心）

把 `Agent.__call__` 的 1380 行拆为**显式阶段管线**，每阶段是一个实现 `Stage` 协议的对象。拆分严格对应现有代码段落，行为零变化：

```python
class Stage(Protocol):
    id: str
    async def run(self, lc: LoopContext) -> StageResult: ...
```

| # | 阶段 | 对应现有代码 | 开放钩子 |
|---|---|---|---|
| 1 | prepare | system 装配、消息规范化、`_process_query` | `agent.messages.assemble` |
| 2 | steer_in | steering 注入点① `_inject_steer` | `agent.turn.begin` |
| 3 | compact | `auto_compact` + 摘要卡事件 + system 补插 | `agent.compact.before/after` |
| 4 | llm_call | anthropic/openai 流式 + 重试 + on_delta/on_usage | `agent.llm.call`（around：可换模型/参数/整段替换） |
| 5 | parse | 原生 tool_call + XML/intern 兼容解析 | `agent.toolcall.parse` |
| 6 | exec_tools | `TOOL_HANDLERS` 分发、超时、结果截断、`load_skill` 拦截、read/write 高亮事件 | `agent.tool.exec`（around：拦截/改参/改结果/跳过） |
| 7 | bg_wait | `BG.is_finished` 后台任务等待 | `agent.bg.wait` |
| 8 | steer_check | 注入点②（终文不许吞掉排队插话） | `agent.turn.settle` |
| 9 | turn_end | 静默 nudge、GOAL 评估、计数 | `agent.turn.end` |
| 10 | finalize | max_turn-1 收尾提示 | `agent.finalize` |

**LoopContext** 携带 `messages / info / agent_config / epoch / hooks / services`，是各阶段与钩子的唯一共享状态（替代现在散落的闭包变量）。

**loop-as-mod 的两级替换粒度**：

1. **阶段级（推荐，稳定 API）**：mod 通过钩子增删改阶段行为，例如"每次工具执行前记审计日志"、"压缩前把大表落盘"。
2. **整体替换（`agent.loop` 独占扩展点，标 experimental）**：mod 提供自己的 `LoopPipeline`（如 plan-execute 循环、多 agent 辩论循环、Tree-of-Thought），声明 `replaces = ["core-loop"]`。内核保证同一时刻只有一个 loop mod 生效，管理界面可一键切回 core-loop。

兼容性：`Agent.__call__` 对外签名与返回的 `info` 结构**完全不变**——CLI、science.py、子代理递归调用方零改动；内部委托给 `LoopPipeline`。

### 6.2 工具系统：`TOOL_HANDLERS` → ToolRegistry

```python
@ctx.tools.register(
    name="bash",
    title="Bash",
    capabilities=["exec", "fs"],       # 该工具运行时需要的能力（供审计与门控）
    schema={...},                       # anthropic 风格 input_schema（openai 转换沿用现有 _trans_*）
    timeout_default=600, timeout_max=3600,
)
def bash(command: str, timeout: int | None = None) -> str: ...
```

- `ToolRegistry` 按 epoch 产出不可变视图；`conf.py` 的 `TOOLS`/`CHILD_TOOLS` 常量迁为 core mod 的贡献（迁移期由适配层原地生成，保证 `science.py` 现有引用不断）。
- 工具元数据（描述、超时、能力）与 handler 同处一地，消灭"schema 在 conf.py、实现在 tools.py"的两地分居。
- 主/子代理工具集：注册时可标 `audience = main|subagent|both`，替代 `TOOLS` 与 `CHILD_TOOLS` 两个列表的硬划分。
- MCP 动态工具（现有 `mcp_servers.json` + `MCPClient` 机制）整体保留，作为 ToolRegistry 的一个 provider。

### 6.3 提示词系统：PromptComposer

现状的拼装事实（`_system_base` + 目录块 + 模型块 + memory 注入 + skills 列表块）形式化为：

```python
ctx.prompts.add_section(PromptSection(
    id="skills-listing", weight=400,
    builder=lambda pc: skills_listing_block(...),   # 现有函数直接搬入
    when=lambda pc: pc.audience == "main",
))
```

- 顺序 = weight；`{home}/{workdir}/{model}/{memory}` 占位符机制与设置页"提示词模板预览"（现有 `_system_prompt_template`）原样保留，改为从 Composer 渲染。
- mod 的 `prompt` capability 为 false 时其片段被拒载。

### 6.4 Server 层

- mod 路由统一挂 `/api/m/<mod-id>/`，鉴权/CSRF（现有 `_check_origin`、auth 依赖）自动套用。
- **替换核心行为不靠路由遮蔽**（避免 FastAPI 路由顺序陷阱），一律走钩子/服务；核心路由组本身未来也标记为 core mod 贡献（P3 后期）。
- WS 推送复用现有 `_push_loop`：新增 `mod.installed/updated/removed/enabled/disabled` 事件类型，前端收到后刷新 mod 面板 / 重载 UI mod。
- EnvHub 注册（现有 `_register_env_routes` 的 hub/prefix/prompt_fn/ensure_project 参数集）升级为 `ctx.services.envs.register(EnvSpec(...))`——patenv/pathenv 平移为首批 env mod，science.py 中对应的三处硬编码装配删除。

### 6.5 Skills

- mod 可携带 `skills/` 目录，注册时合入 SkillLoader 扫描路径（优先序：项目 > 用户 > mod，同名覆盖规则与现有项目覆盖全局一致）。
- 现有 science 侧 overrides JSON 与 `/api/skills` 管理界面不动，新增 `source: "mod:<id>"` 标记。

### 6.6 流水线层（nodes/blocks/clients）

- `NodeRegistry` / `BlockRegistry` / `ClientRegistry`：入口从"每文件一个类 + `__init__.py` 硬 import"改为注册制；现有 17 种节点、7 种 LLM 客户端全部迁为 core mod 贡献。
- mod 贡献新节点类型（如 `node_crispr`）、新 LLM 后端（如 `llm_sglang`）只需注册类 + schema，前端图编辑器通过 `/api/list/nodes` 自动看到（该接口已有）。

### 6.7 前端层

**science 工作台 —— 真运行时 mod**（基础设施已就绪：内容哈希资产 + `CS.ensureLazy` + 入口 no-cache）：

1. 服务端新增静态路由 `/science/m/<mod-id>/`（伺服 mod 的 `ui/` 目录，ETag 协商缓存）。
2. 引导端点 `GET /api/mods/ui/registry` 返回已启用 UI mod 清单（entry URL 带 `?v=<epoch>`，天然免缓存污染）。
3. `index.html` 启动时 fetch 清单 → 逐个 `import(entryUrl)`（原生 ES module 动态加载，无需构建器参与）。
4. **SFM SDK**（`window.SFM`，随 science 前端发布，版本即 UI API 契约）：

```js
SFM.registerView({ id, title, icon, order, mount(el), unmount() })   // 侧栏视图
SFM.registerCard(type, { render(el, payload) })                      // 消息卡渲染器
SFM.registerToolUI(toolName, { panel(el) })                          // 工具专属面板
SFM.registerSetting({ id, section, render(el) })                     // 设置页区块
SFM.registerEnvPanel(envId, { ... })                                 // 虚拟环境面板
SFM.call(path, opts)                                                 // 带鉴权/origin 处理的 API 调用
SFM.on('mod.updated', fn)                                            // 事件订阅
```

5. mod 更新：WS 广播 → SFM 卸载旧 entry（`unmount()`）→ 以新 epoch URL 重新 import → toast 提示。旧资产因内容哈希可安全共存至标签页关闭。
6. `views.js` 的静态视图表改造为"核心视图 + 注册表动态视图"合并渲染。

**website / admin（React/Vite）—— 构建期 mod 槽（第一期）**：

- 仓库内置 mod 的 `ui/` 若为 React 组件，构建时经约定的动态 `import()` 收编为分包（chunk per mod），运行时按 mod 启用态决定是否加载——"改 mod 只重编 mod 的 chunk"。
- 运行时远程加载 React 组件（native ESM + importmap + 全局 peer）延后至 P5 评估：技术上可行（Vite 产物是标准 ESM），但 props/上下文契约的稳定性要求高，且这两端当前迭代频率低，收益有限。

---

## 7. 配置叠加模型（借鉴 DSH，扩展项目层）

```
解析顺序（后者覆盖前者）:
1. mod 自带 [config] 默认值
2. ~/.sigmaflow/profile.toml     # 用户启用的 mod 列表与顺序
3. ~/.sigmaflow/patch.toml       # id 定向: 覆盖配置 / 禁用贡献 / 关闭 mod
4. <project>/.sf/patch.toml      # 项目级再叠加（仅影响该项目会话）
```

```toml
# patch.toml —— id 定向补丁（对应 cordis.patch.yml 的角色）
[[patch]]
mod = "pathogen-env"
enabled = true
[patch.config]
trial-replicas = 30

[[patch]]
mod = "core-loop"
[patch.disable]          # 定向关闭 core 的某个贡献（如 nudge）
hooks = ["silent-turn-nudge"]
```

- 求值结果缓存于 modstate.json，设置页提供**"为什么是这个值"**的层叠溯源视图。
- `patchReload` 不再需要全局开关：生效时机由每个贡献的热更新级别决定（§8）。

---

## 8. 热更新机制（三级）

| 级别 | 适用 | 机制 | 生效时机 |
|---|---|---|---|
| **L0 instant** | 工具启用态、提示词片段、skills、MCP 配置、UI mod、配置 patch | 注册表重建不可变视图 | 下一次请求/下一轮循环 |
| **L1 run-boundary** | Python 代码 mod（工具实现、loop、env、钩子） | importlib 隔离命名空间（`sfmod_<id>_<epoch>`）加载新代码 → epoch+1 → 新 Agent 绑定新快照；存量 run 持旧快照跑完；被卸载 mod 收到 `ctx.on_unload`（关后台任务/浏览器会话） | 新对话/新 run 边界，秒级 |
| **L2 restart** | mod 声明 `reload="restart"`（含路由贡献、节点/客户端贡献）；或内核版本变更 | 监督器 drain（等待存量 run 完成或超时强停）→ 重启进程 → 恢复 mod 状态 | 一次优雅重启 |

设计边界（诚实声明）：**不做**进行中的 run 内热替换——Python 模块级状态使它不可靠，收益场景（长 run 期间升级工具实现）由"存量跑旧码、新 run 用新码"覆盖。CLI 场景（`sigmaflow` 命令）每次进程启动自然取最新 epoch，无需额外机制。

Mod 代码加载细则：每个 mod 的代码以唯一模块名注册进 `sys.modules`，卸载时摘除并释放引用；mod 约定为无模块级可变状态（lint 规则 `SFM001` 强制，状态一律放 `ctx` 或服务）。Cron 任务、后台 job、浏览器会话等长生命周期对象登记 owner mod，卸载时按策略保留/清理（默认清理，patch 可改 `keep-on-unload`）。

---

## 9. 安全模型

- **能力声明**（§5.1 capabilities）：`fs-read/fs-write`（路径列表，支持 `<project>` 占位）、`exec`、`network`（域列表）、`mcp`、`ui`、`prompt`、`registry`（能否注册影响其他 mod 的贡献）。`CapabilityGate` 在服务调用与工具执行处运行时校验，越权抛 `PermissionDenied` 并记审计事件。
- **信任模型**：本地目录 / 本仓库安装 = 信任（与 Koishi/Minecraft 本地 mod 一致）；`git+https` / zip 安装时在管理界面展示能力清单并要求确认；`mod.toml` 预留 `sign` 字段，签名校验体系放 P5。
- **错误隔离**：HookBus 对每个钩子调用 try/except——普通钩子异常 → 记事件 + mod 面板红点，不中断主流程；around 替换器异常 → 回退被替换实现（`fail-open`，可在 patch 中对该 mod 改为 `fail-closed`）。单个 mod 加载失败 → 该 mod 置 `error` 态，其余不受影响。
- **UI 隔离**：UI mod 的 JS 在页面同源运行（与 science 自身代码同等信任），但设置页显著展示每个 UI mod 的来源与能力；后续可评估 iframe 沙箱 + postMessage 的强隔离档位。
- **审计**：`modstate.json` 记录 install/enable/config-change/reload 全历史（谁、何时、什么变更）。

---

## 10. 存储布局

```
~/.sigmaflow/                 # 用户级（$SIGMAFLOW_HOME 可覆盖）
├── mods/<mod-id>/            # 用户安装的 mod
├── profile.toml
├── patch.toml
└── modstate.json             # 状态 + epoch + 审计日志
<repo>/mods/                  # 随产品分发的内置 mod（patenv/pathenv/sciverse 首批迁入）
<project>/.sf/
├── mods/                     # 项目级 mod（随项目分发）
└── patch.toml                # 项目级补丁
```

同名解析：项目 > 用户 > 内置（同 DSH 分层思想）。现有 `.data/` 用户数据、skills overrides、mcp_servers.json 全部原地保留，mod 体系增量叠加不迁移存量。

---

## 11. 新增 API（REST/WS）

```
GET    /api/mods                       # 清单+状态+能力+贡献概览
POST   /api/mods/install               # {source: "<path>|<git url>|<zip>"} → 能力确认
POST   /api/mods/install/confirm       # 能力确认后的落地
POST   /api/mods/{id}/enable | disable | reload
POST   /api/mods/{id}/update           # git 拉取 / 路径刷新
DELETE /api/mods/{id}
GET    /api/mods/{id}/config           # 含层叠溯源（哪层定的这个值）
PUT    /api/mods/{id}/config           # 写入用户 patch 层
GET    /api/mods/{id}/events           # 该 mod 的运行事件/错误
GET    /api/mods/ui/registry           # 前端引导：启用中的 UI mod + entry URL(?v=epoch)
GET    /science/m/<mod-id>/*           # UI mod 静态资源（ETag）
WS     /api 事件: mod.installed/enabled/disabled/updated/removed/error
```

管理界面：science 设置页新增"Mod"面板（列表/开关/配置/溯源/事件流/一键回退覆盖链），admin 站点后续复用同一 API。

---

## 12. 迁移映射表（绞杀者顺序）

| 现状 | 目标 | 阶段 |
|---|---|---|
| `TOOL_HANDLERS` dict + conf.py schema | core mod 经 `ToolRegistry` 注册，适配层原地兼容旧引用 | P0–P1 |
| `_system_base` + 目录/模型/memory/skills 块 | `PromptComposer` sections（core mod） | P0 |
| patenv / pathenv 硬编码装配（science.py 三处） | 首批 env mod（`<repo>/mods/pathogen-env`、`patient-env`），science.py 相应代码删除 | P1 |
| sciverse 工具（SCIVERSE_TOOL_HANDLERS 合并） | tool mod | P1 |
| `Agent.__call__` 单体 | `LoopPipeline` 十阶段（core-loop mod），签名/info 不变 | P2 |
| steer/compact/tool 等内嵌行为 | 全量钩子开放 | P2 |
| science 前端静态视图表 + 侧栏 | SFM SDK + 注册表动态渲染 | P3 |
| nodes/blocks/clients 硬 import | 三注册表 + core mod 贡献 | P4 |
| website/admin 单体 | 构建期 mod 槽（chunk per mod） | P4 |
| 手工分发 | `.sfmod`(zip)/git 安装、（可选）签名 | P5 |

---

## 13. 每阶段验收标准

- **P0 内核地基（无行为变化）**：kernel 包落地；ToolRegistry/PromptComposer 以适配层接管现有实现；**金轨测试**通过——对拍现状 `/api/tools` 输出、system prompt 渲染文本、一段固定对话回放（mock LLM）的事件序列与今主干完全一致；CLI 与 server 全部现有测试绿。
- **P1 mod 主机 + 内容型 mod**：mod.toml 解析/依赖/世代/能力门控可用；patenv、pathenv、sciverse 以 mod 形态运行且行为对拍一致；`/api/mods` 系列 + 设置页 Mod 面板可用；安装一个示例 tool mod（含新工具 schema 注入对话）全流程 ≤10 分钟。
- **P2 loop 阶段化 + loop-as-mod**：`Agent.__call__` 拆为十阶段管线，金轨回放对拍一致；钩子全量开放并各配一个示例 mod（工具审计、压缩前落盘、自定义 nudge）；一个示例替换型 loop mod（plan-execute）可切换运行；L1 热切换：改工具实现 → 新对话即生效、存量对话跑完旧码，验证脚本固化。
- **P3 前端运行时 mod**：SFM SDK 四类注册 API 可用；示例 UI mod（自定义侧栏视图 + 消息卡渲染器）免构建装入；WS 广播更新 → 前端热重载 entry；`views.js` 动态化后现有视图全量回归。
- **P4 流水线 + website 槽**：新节点类型/LLM 客户端经 mod 注册并被图编辑器发现；website 构建产出 chunk per mod 且按启用态加载。
- **P5 分发**：`.sfmod`/git 安装、卸载、更新全流程；签名校验（可选启用）。

---

## 14. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 1380 行 loop 拆分引入行为漂移 | 金轨回放对拍（P0 建立，P2 每次重构跑）；影子模式：新旧 loop 同输入双跑 diff（P2 期间提供开关） |
| Python mod 模块级状态导致热切换脏读 | SFM001 lint 禁止模块级可变状态；epoch 快照隔离；卸载摘除 sys.modules |
| 钩子过多导致调用链不可理解 | 钩子清单文档化 + 调试端点 `GET /api/mods/{id}/hooks` 列出"谁在哪个点挂了什么"；`SIGMAFLOW_TRACE_HOOKS=1` 输出执行轨迹 |
| mod 间覆盖冲突升级为"覆盖地狱" | 同名覆盖必须显式声明 + 管理界面展示覆盖链 + 一键回退；覆盖深度 >2 时告警 |
| 路由贡献要求重启被误解为"不热" | 文档与 UI 明示三级热更新矩阵；路由类贡献引导改用钩子实现 |
| UI mod 供应链风险 | 安装时能力确认 + 来源标记；同源信任模型文档化；后续 iframe 沙箱档位 |
| 现有用户数据/习惯破坏 | 存量数据零迁移；禁用全部 mod = 现状行为（core 不可禁用基础贡献） |

---

## 15. 需要你拍板的决策点

1. **清单格式**：TOML（推荐，注释友好）还是 JSON（现有 sigmaflow.json/models.json 风格一致）？
2. **Python mod 的代码信任模型**：第一期即允许任意 Python 代码（本地信任，推荐），还是先只开数据型 mod（工具 schema+MCP+提示词+skills+UI），代码型延后？
3. **loop 整体替换**的开放时机：P2 即开放（experimental 标记，推荐）还是先只开阶段级钩子、整体替换观察一个阶段后再开？
4. **website/admin 前端深度**：第一期构建期 mod 槽（推荐）还是直接上运行时远程组件？
5. **流水线层（nodes/blocks/clients）纳入本期**：P4 纳入（推荐，SigmaFlow 原核心理应 mod 化）还是另行立项？
6. **mod 命名**：目录 `mods/`、SDK 全局 `SFM`、清单 `mod.toml`——可改。
7. **P0 金轨对拍基准**：用现有 tests/e2e + 新增 mock-LLM 回放（推荐），需要你确认可投入的测试基建工作量。
