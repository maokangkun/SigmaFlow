# Science 工作流页 × ComfyUI Workspace 整合方案（供审阅）

> v1.0 · 审阅通过后按 §7 分阶段实施 · 前置改动（已按指示完成）：移除工作流页演示口径文案。

---

## 1. 现状盘点（代码事实）

### 1.1 Science 工作流页（`science/js/views.js` + `data.js`）

- 工作流目录是**前端演示数据**（`data.js` 硬编码：单细胞 RNA-seq 等，含步骤/时长），
  选中后走本地任务状态机渲染步骤卡，不触碰真实管线引擎。
- 无任何"编辑"能力；卡片是纯选择器。

### 1.2 ComfyUI Workspace（`/workspace/` → `server/comfyui/dist`，49 MB）

- dist 是 **ComfyUI_frontend（新版 Vue/PrimeVue 前端）的预构建产物**，构建时
  `base=/workspace/` 已烧进资源绝对路径（index.html 全部指向 `/workspace/assets/...`）。
- 后端不是 ComfyUI 本体，而是 `server/workspace.py` 的 **WorkspaceAPI 协议垫片**
  （801 行）：把 ComfyUI 前端协议（`/api/object_info`、`/api/prompt`、`/api/queue`、
  `/api/history`、`/api/userdata`、`/ws`）映射到 SigmaFlow 自己的 PipelineManager
  （`add_pipe(comfyui_data=...)` → `nodes/` 的 17 种节点）。
- 版本烙印 `comfyui_version: 0.3.70`，距上游已久未同步。
- 认证是 ComfyUI 自己的 `/api/users` 多用户垫片（`~/.sigmaflow/userdata`），与
  science 会话体系**互不相通**。
- 官方主题钩子存在且未被使用：index.html 顶层加载 `user.css` 与
  `api/userdata/user.css`（后者正好落在 WorkspaceAPI 的 userdata 服务路径上）。

### 1.3 已有桥接资产

- `templates.json`：一张真实可运行的示例图（LLMNode 模板）— 可作为"workspace 示例"。
- `sigmaflow.json`：节点 schema 清单（`/api/list/nodes` 的数据源）。
- PipelineManager 原生接受 ComfyUI 图格式 —— **后端桥已完成**，缺的只是前端整合。

---

## 2. 需求拆解

1. 工作流页在「单细胞 RNA-seq 分析」之上增加 workspace 提供的示例入口。
2. 工作流卡片加「编辑」按钮 → 跳到该工作流的图编辑页。
3. 决定整合形态（深度移植 vs 独立页面），并给出上游 ComfyUI 长期同步策略。

---

## 3. 三种形态对比

| | A. 深度移植重绘 | B. 独立页+仅后端更新 | **C. 壳内嵌入（推荐）** |
|---|---|---|---|
| 做法 | 把 ComfyUI 前端源码并入 science 前端工程，按 science 设计系统重写界面 | 维持 `/workspace/` 独立页，science 卡片"编辑"外链跳转 | dist 原样保留，science 新增 `/science/#/flow` 视图壳内嵌编辑器，主题与认证走外置桥 |
| 样式统一 | 完全统一 | 完全割裂 | 高度统一（经官方 user.css 钩子注入 science 设计变量；顶栏/侧栏本来就是 science 的） |
| 上游同步 | **不可能**（49 MB Vue 前端的永久 fork，正是现状漂移的根源被复刻放大） | 可行但体验割裂、双导航双登录、编辑跳转丢上下文 | **可行且低成本**：dist 保持 vanilla 永不手改，同步 = 整包替换 + 契约测试 |
| 工作量 | 数月级，且每次上游更新都要重做 | 小，但不满足"整合"诉求 | 1–2 周量级（详见 §7） |
| 风险 | 前端协议黑盒 + 双向漂移 | 认证/会话两套长期双轨 | iframe 边界（同源无碍）；主题仅覆盖到 ComfyUI 暴露的变量面 |

**结论：C。** 核心理由一条：这套编辑器的全部价值在于"跟住上游"，任何需要改动
dist 的方案都会重演今天的失同步。C 把所有本地定制从 dist 里挪出来（§5），
dist 变成可整体替换的供应商产物。

---

## 4. 方案 C 的页面与数据设计

### 4.1 页面结构

```
science 侧栏新增「流程编辑」(#/flow)
└── 视图壳: science 顶栏 + <iframe src="/workspace/?embed=1&workflow=<id>">
工作流页卡片
├── 「运行」(现状演示流)
└── 「编辑」→ #/flow?workflow=<id>（载入对应 ComfyUI 图）
「workspace 示例」卡（置于"单细胞 RNA-seq 分析"之上）
└── templates.json 示例图 → 一键进入编辑器预载该图
```

- `embed=1` 由外置注入脚本消费：隐藏 ComfyUI 自带顶栏/用户菜单，腾给 science 壳。
- 编辑器内"保存"经 userdata 垫片落 `~/.sigmaflow/userdata/flows/<id>.json`，
  science 工作流目录读同一目录 → **目录卡片 = 真实管线图列表**（演示数据仅兜底）。

### 4.2 认证桥

- `/workspace/**` 与其 API 挂到 science 同一鉴权依赖下：单用户放行；多用户要求
  science 会话，并把 science 用户映射为 ComfyUI userdata 用户（`/api/users` 垫片
  改为透传 science 身份，删除独立注册面）。
- 与 admin 页共享 science 认证的改造同构，风险已知。

### 4.3 主题桥（不改 dist 的统一风格）

- `api/userdata/user.css` 是官方加载路径：WorkspaceAPI 为登录用户返回一份
  **生成的** user.css（把 science 的 CSS 变量映射到 ComfyUI/PrimeVue 变量：
  背景层、卡片层、主色、圆角、字体族）。
- 映射表放 `server/comfyui/theme-bridge.css.tmpl` 之类的外置文件；dist 不动。

---

## 5. 上游同步策略（关键决策）

1. **dist 永不手改**（vanilla 原则）：本地差异全部落在三个外置点 ——
   ① `user.css`（主题桥）② WorkspaceAPI（协议垫片，本来就在我们代码里）
   ③ embed 注入脚本（`?embed=1` 时隐藏冗余 chrome，经 index.html 无法注入则用
   同源 iframe onload 后操作 DOM，或以 userdata 扩展机制装载）。
2. **同步流程固化为脚本 + 测试**：
   - `scripts/sync-comfyui.mjs`：拉取指定 tag 的 ComfyUI_frontend 官方构建
     （base=/workspace/），整包替换 dist，产出 diff 报告；
   - **协议契约测试**（新增 `tests/test_workspace_protocol.py`）：对
     `object_info / prompt / queue / history / userdata` 录制固定夹具，
     替换 dist 后跑全绿即视为兼容；前端冒烟（无头浏览器开 #/flow 能渲染画布）。
3. **版本钉住与升级节奏**：dist 内记 `VENDOR_VERSION`（当前 0.3.70）；升级按需
   手动触发（半年一次或需要新特性时），每次升级 = 同步脚本 + 契约测试 + 冒烟。
4. base 路径说明：官方构建默认按部署 base 烧路径。保持 `/workspace/` 固定挂载
   路径（science 壳用 iframe 引绝对路径），升级时**无需重新构建**，直接用官方
   release 产物；若未来官方不再提供匹配 base 的产物，退路是自建构建
   `--base=/workspace/`（一次性脚本，仍不改源码）。

---

## 6. 本期不做

- 不重写 ComfyUI 前端组件；不做 science 内二级路由接管编辑器内部状态。
- 不在本期把工作流"运行"从演示流切到真实管线执行（编辑→保存→运行打通留下一期，
  届时任务状态机与 `/api/run` 管线引擎对接）。

---

## 7. 阶段划分与验收

| 阶段 | 内容 | 验收 |
|---|---|---|
| S1 | 卡片「编辑」按钮 + `#/flow` 壳视图 + iframe 载入（无主题桥、无认证桥） | 点编辑能打开编辑器并载入对应图；工作流页无回归 |
| S2 | workspace 示例卡（templates.json 图）+ 目录卡片接 userdata 真实图列表 | 示例卡一键进编辑器预载示例图；新建图保存后出现在目录 |
| S3 | 认证桥（单/多用户） | 多用户未登录跳 science 登录；登录后编辑器可用且 userdata 按用户隔离 |
| S4 | 主题桥 user.css 生成 + embed 注入 | 截图对比：编辑器配色/圆角/字体与 science 一致；顶栏为 science 壳 |
| S5 | 同步脚本 + 协议契约测试 + VENDOR_VERSION 登记 | 演示一次"替换 dist → 测试全绿"；文档化升级 SOP |

---

## 8. 待你拍板

1. 形态选 C（壳内嵌入）是否同意？若你更倾向 B（独立页）也可，代价如 §3。
2. 「workspace 示例」用 templates.json 现有 LLM 示例图，还是需要我先做一张更
   贴近生信场景的示例图（如 JSON 数据 → LLM 节点 → 分支输出）？
3. 工作流目录卡片接真实图后，现有演示目录（单细胞 RNA-seq 等 4 个）保留为
   "内置示例"分组，还是全部切换为真实图列表 + 示例分组？
4. S3 认证桥改动 `/workspace/**` 鉴权，多用户线上启用前是否需要先在本地跑一轮
   双用户验证（默认会做）。
