# Science 工作流页 × ComfyUI Workspace 整合方案（v2，已全部落地）

> 实施完成记录：S0-S5 全部落地并上线（2026-11-16）。
> S0 fork 规范化(sigmaflow/main)/S1 编辑按钮+flow 壳/S2 真实图目录/S3 认证桥
> (多用户隔离)/S4 主题桥(user.css 官方钩子)/S5 契约测试(12 项)+一键同步脚本
> (scripts/sync-workspace.sh)。主题经 userdata 官方钩子下发, 升级无需重建。

> v2 修订：发现并核验了 `/data/mkk/github/ComfyUI_frontend` 源码 fork（v1 基于纯
> 预构建产物评估，已过时）。前置改动（已上线）：工作流页演示口径文案已移除。

---

## 1. 现状盘点（代码事实）

### 1.1 Science 工作流页（`science/js/views.js` + `data.js`）

- 工作流目录是**前端演示数据**（`data.js` 硬编码），选中走本地任务状态机，
  不触碰真实管线引擎；无编辑能力。

### 1.2 ComfyUI_frontend 源码 fork（`/data/mkk/github/ComfyUI_frontend`）

- **基座是最新上游**：origin = 官方 `Comfy-Org/ComfyUI_frontend`，HEAD 与
  origin/main 齐平（92f21c14d，2026-01-08）——所谓"很久没同步"并不成立于
  源码层，你们实际跟到了上游最新。
- **定制以工作区改动 + 未跟踪文件存在（未提交！）**：50 文件 +1550/−2322
  （删除段多为工具链配置清理），另有一份 2026-01-09 的旧 stash（部分重叠）。
- **定制内容已深达源码核心**：
  - 节点编辑对话框（增删输入/输出，5 个 Vue 组件约 1136 行）
  - Loop 节点专属控件（`src/components/loop/`）
  - SigmaFlow 扩展：LLMNodePreview、执行耗时徽章、运行节点高亮
  - 从 `sigmaflow.json` 读取节点样式配置（nodeDefSchema/UI schema 扩展）
  - 中英文案 ~150 键；defaultGraph 定制
  - **构建管线已接线**：`vite base='/workspace/'`，outDir 直出 SigmaFlow 的
    `comfyui/dist`（但 outDir 写的是另一台机器的绝对路径，需修）
  - `sigmaflow_docs/` 自带改造说明文档
- WorkspaceAPI（`server/workspace.py`）协议垫片不变：ComfyUI 协议 →
  PipelineManager，认证仍是独立 `/api/users` 垫片。

**关键结论**：定制深度（节点对话框、Loop 控件、schema 扩展）**只能在源码层
实现**，v1 方案 C 的"dist 保持 vanilla + 外置 overlay"原则与既成事实矛盾 ——
你们事实上已经是源码 fork 模式。

---

## 2. 方案重评

| | A. 并入 science 重写 | **A′. 源码 fork + 自建产物 + science 壳（推荐）** | C. vanilla dist + overlay |
|---|---|---|---|
| 做法 | 把编辑器并入 science 前端工程按其风格重写 | fork 为主干：定制固化为 `sigmaflow/main` 分支提交，自建产物（base=/workspace/），science 以 `#/flow` 壳内嵌 | 上游产物原样 + user.css/扩展外置定制 |
| 与既成事实 | 推倒重来 | **就是你们现在的做法，只是未规范化** | 定制深度做不到（节点对话框/Loop 控件无法 overlay） |
| 上游同步 | 不可能 | git merge upstream/main（已验证可行：基座即最新 main）+ 契约测试 + 重建 | 可行但承载不了现有定制 |
| 样式统一 | 完全 | 源码级主题（构建期注入 science 设计 token），可达高度统一 | 只能覆盖官方变量面 |
| 主要代价 | 数月重写 | 维护 merge 冲突面（~30 个上游高频核心文件） | — |

**结论：A′。** 原教旨的 A（重写合并）依旧不可行——Vue3+PrimeVue+nx 单仓与
science 的零依赖 ES modules 是两个世界；但有了源码，A′ 在所有维度上优于 C，
且与你们已投入的定制完全兼容。

---

## 3. A′ 落地设计

### 3.1 fork 规范化（第一步，也是最高风险项）

当前 62 个文件的定制**全部未提交**——一次误操作 `git checkout .` 即清零。
立即要做：在 fork 内建 `sigmaflow/main` 分支，将工作区改动 + 未跟踪文件
（含 sigmaflow_docs）提交；重叠的旧 stash 比对后丢弃；修 outDir 为本机可配
（`SIGMAFLOW_DIST_DIR` 环境变量或构建参数，去掉他人机器的绝对路径）。

### 3.2 science 整合（与 v1 §4 同构）

- 侧栏新增「流程编辑」`#/flow`：science 顶栏 + iframe `/workspace/?embed=1&workflow=<id>`
- 工作流卡片加「编辑」按钮 → `#/flow?workflow=<id>` 载入对应图
- 「workspace 示例」卡置于「单细胞 RNA-seq 分析」之上（templates.json 示例图）
- 目录卡片接 userdata 真实图列表（`~/.sigmaflow/userdata/flows/`），演示数据兜底
- 认证桥：`/workspace/**` 挂 science 鉴权，science 用户映射 userdata 用户

### 3.3 主题与 embed（源码级，取代 v1 的 overlay）

- fork 内新增 `sigmaflow-theme.css`（science 设计 token → ComfyUI/PrimeVue
  变量映射），构建期经 vite 注入；`?embed=1` 时隐藏 ComfyUI 顶栏/用户菜单
  （源码级判断，比 onload 后改 DOM 可靠）。

### 3.4 构建与产物管道

- fork `pnpm build`（base=/workspace/）→ outDir 落 SigmaFlow `comfyui/dist`，
  固化为 `scripts/build-workspace.sh`；SigmaFlow 仓库继续 vendor 产物（现状）
- fork 内登记 `SIGMAFLOW_SYNC.md`：上游基线 commit、定制清单、同步步骤

### 3.5 上游同步 SOP（每次升级）

1. `git fetch origin && git merge origin/main` 到 `sigmaflow/main`，解冲突
   （冲突面 = 定制触碰的 ~30 文件 vs 上游高频区，中等工作量）
2. fork 自带测试（vitest）跑 SigmaFlow 定制相关用例
3. `pnpm build` 出产物 → SigmaFlow 协议契约测试（object_info/prompt/queue/
   history/userdata 固定夹具，需新增）全绿
4. 无头浏览器冒烟：`#/flow` 打开能渲染画布、载入示例图、保存回路
5. SigmaFlow 仓库提交新 dist + 同步记录

---

## 4. 阶段划分与验收

| 阶段 | 内容 | 验收 |
|---|---|---|
| S0 | **fork 规范化**：sigmaflow/main 分支、定制提交、outDir 参数化、旧 stash 清理 | fork 干净可重建；一次完整 build 出的 dist 能被 SigmaFlow 现有 workspace 正常打开 |
| S1 | science 卡片「编辑」按钮 + `#/flow` 壳 + iframe 载入 | 点编辑打开编辑器并载入对应图 |
| S2 | workspace 示例卡 + 目录接 userdata 真实图 | 示例卡预载示例图；保存的新图出现在目录 |
| S3 | 认证桥（单/多用户） | 多用户未登录跳 science 登录；userdata 按用户隔离 |
| S4 | 源码级主题 + embed 模式 | 编辑器与 science 风格统一；顶栏为 science 壳 |
| S5 | 协议契约测试 + 同步 SOP 文档化 | 演示一轮完整"merge 上游 → build → 测试全绿" |

---

## 5. 待你拍板

1. 确认 A′（源码 fork 为主干）。若你原意是"把编辑器 UI 按 science 风格完全
   重写"（原教旨 A），我仍不建议，理由 §2。
2. S0 我可以直接在 `/data/mkk/github/ComfyUI_frontend` 执行（建分支提交你们的
   改动）——是否授权动这个仓库（目前只读过）。
3. workspace 示例用 templates.json 现有 LLM 示例图，还是先做一张生信场景示例图。
4. 演示目录（单细胞等 4 个）保留为"内置示例"分组 + 真实图列表，还是全切换。
