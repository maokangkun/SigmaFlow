# Agent API 接入契约

版本：1.0。当前 `server.mjs` 实现这个契约的**模拟服务**。

## 设计边界

浏览器默认不调用后端。切换至“接口联调”后，用户仍需对每个计划点击“确认并执行”。此时发送的只有研究问题、配置和文件 ID。原始文件上传、模型推理、科学计算和实际结果数据不在当前协议实现中。

前端中的图表始终来自合成示例。生产集成需要单独实现真实结果接口与数据适配，不能把模拟状态当成科学输出。

## 服务端接口

### 1. 健康检查

```http
GET /api/health
```

```json
{
  "status": "ok",
  "demo": true,
  "service": "SigmaFlow Science backend",
  "protocol": "1.1",
  "transports": {"http": true, "sse": true, "websocket": "/api/ws"}
}
```

`demo` 应如实标记服务性质。`transports` 声明可用通道，其中 `websocket` 给出
WS 端点路径（见第 6 节）。这个返回值只证明接口可访问，不证明模型或计算环境可用。

### 1a. 服务器状态（Chat 页状态栏）

```http
GET /api/system
```

```json
{
  "os": "Ubuntu 22.04.3 LTS",
  "cpu":  {"model": "Intel(R) Xeon(R) Platinum 8358P CPU @ 2.60GHz", "cores": 128, "usage": 27.3},
  "memory": {"used_gb": 430.6, "total_gb": 1007.5, "percent": 42.7},
  "disk":  {"used_gb": 3105.3, "total_gb": 3519.8, "percent": 92.9, "path": "/"},
  "gpus":  [{"name": "NVIDIA A100-SXM4-80GB", "usage": 33.0, "mem_used_gb": 76.2, "mem_total_gb": 80.0}],
  "net":   {"up_bps": 123456.0, "down_bps": 987654.0}
}
```

CPU/网速为"与上一次请求之间的差值"（首次请求网速为 0），GPU 经 `nvidia-smi`
查询并缓存 5 秒，无 GPU 时 `gpus` 为空数组。`disk` 为数据目录所在文件系统，
`disks` 额外包含 `/data`（同一设备时去重）。前端约每 3 秒轮询一次。

### 2. 创建并启动一个已由用户确认的任务

```http
POST /api/runs
Content-Type: application/json
```

```json
{
  "prompt": "使用合成 PBMC 数据展示单细胞界面流程",
  "workflowId": "singlecell",
  "projectId": "pr-pbmc",
  "datasetIds": ["ds-pbmc", "ds-meta"],
  "config": {
    "organism": "Homo sapiens",
    "minGenes": 200,
    "maxMito": 20,
    "synthetic": true
  },
  "steps": [
    {"title": "数据与元信息检查", "description": "界面演示", "tool": "input.inspect"},
    {"title": "生成可追溯报告", "description": "界面演示", "tool": "report.export"}
  ]
}
```

示例成功响应：

```json
{"id":"a-unique-run-id","isDemo":true}
```

模拟服务限制：最多 6000 字符问题、1–10 步、128 KB 请求体、100 个内存任务。不接受文件内容。

**生产后端不能直接信任前端给出的步骤、工具名或用户确认状态。** 应重新检查权限、允许的工具、参数、数据访问和审批记录，不能将工具字符串作为任意 shell 命令执行。

### 3. 查询任务快照

```http
GET /api/runs/{id}
```

```json
{
  "id": "a-unique-run-id",
  "status": "running",
  "progress": 50,
  "isDemo": true,
  "steps": [
    {
      "index": 0,
      "title": "数据与元信息检查",
      "description": "界面演示",
      "tool": "input.inspect",
      "status": "complete",
      "progress": 100,
      "output": "模拟步骤完成；未执行真实分析"
    },
    {
      "index": 1,
      "title": "生成可追溯报告",
      "description": "界面演示",
      "tool": "report.export",
      "status": "waiting",
      "progress": 0,
      "output": ""
    }
  ]
}
```

前端重连前会查询快照。如果任务已完成或取消，直接同步最终状态；否则发送恢复请求后重新订阅。

### 4. SSE 事件流

```http
GET /api/runs/{id}/events
Accept: text/event-stream
```

服务器发送 `state` 命名事件；每次发送一个完整状态快照，而不是只发送部分字段：

```text
event: state
data: {"id":"a-unique-run-id","status":"running","progress":50,"isDemo":true,"steps":[...]}

```

任务状态：`running`、`paused`、`complete`、`cancelled`、`error`。

步骤状态：`waiting`、`running`、`complete`。

进度为 0–100 的数值。步骤个数与创建任务时一致，避免任务索引错位。前端会将非法进度限制在有效范围，并在格式错误或连接中断时进入错误状态。

`complete` 和 `cancelled` 是终止状态。模拟服务推送最终事件后关闭连接。运行中每 15 秒可发送 `: keepalive` 注释作为心跳。

### 5. 模型配置（服务端存储）

模型配置保存在服务端（默认 `~/.sigmaflow/science/models.json`，可用环境变量
`SIGMAFLOW_SCIENCE_DIR` 重定向），浏览器本地不再保存 API 密钥。
接口只返回掩码 `keyHint`，永不回传完整密钥；更新时 `apiKey` 留空表示保留原密钥。

```http
GET    /api/models            → {"models": [{id, name, baseUrl, keyHint, isDefault, contextWindow, createdAt, updatedAt}]}
POST   /api/models            → {"model": {...}, "models": [...]}   # 带 id 为更新，否则新建；`contextWindow` 可选（会话窗口 tokens，留空按模型名取默认）
DELETE /api/models/{id}       → {"models": [...]}
POST   /api/models/test       → 由服务端实测模型服务商连通性
GET    /api/context-info      → {"systemTokens": int, "toolsTokens": int}  # Agent 固定开销（系统提示词+工具定义）的 token 估算，供输入框旁的上下文用量圆环使用
```

`POST /api/models/test` 请求体 `{id?, baseUrl?, apiKey?}`（编辑时传表单值，`id` 存在则回退到已存配置），
返回 `{ok, latencyMs, status, modelCount, error}`——服务端向 `{baseUrl}/models` 发起真实请求，
`modelCount` 为服务商返回的可用模型数。WS 通道对应 action 为 `model.test`。

请求体示例：

```json
{"id": "md-…", "name": "openrouter/free", "baseUrl": "https://openrouter.ai/api/v1", "apiKey": "sk-…", "isDefault": true}
```

规则：`name` 必填（≤ 200 字符）；`baseUrl` 是模型服务商的接口地址（如 `https://openrouter.ai/api/v1`），可与
`apiKey` 一起留空；首个创建的模型自动成为默认；同一时刻只有一个默认模型；删除默认模型后由剩余模型接任。
写操作要求同源（跨域返回 403）。

注意区分：`baseUrl` 指向模型服务商，供后端后续接入真实推理使用；浏览器连接 Science 后端的“服务地址”
（如 `/api` 或 `/sigmaflow/api`）是工作空间的独立设置项，保存在浏览器本地，与模型记录无关。

### 3a. 运行记录与会话调试

- **运行记录**：每次模型回复在会话存档里落一条 `runs` 记录（保留最近 20 条，
  重启仍在）——`turns/toolCalls/events/eventCounts/steers/tokens/elapsedMs/
  status/delivered` 等；`GET /conversations/{id}/runs` 查询，会话 Trace 页
  底部有「运行记录」表。
- **结构化日志**：关键事件以单行 `[sf] event k=v` 形式进入 web.log（logger
  名 `sigmaflow`）——`chat.send` / `chat.done`（含 turns/tokens/耗时/终态）/
  `chat.steer` / `chat.steer.dropped` / `chat.send.rejected` /
  `archive.snapshot.*`（DEBUG 级）。环境变量 `SIGMAFLOW_LOG_LEVEL=DEBUG`
  可见落库细节。

### 4a. 会话引导（steering，WS action `chat.steer`）

会话回复仍在生成时，用户的新消息**不再并发发起第二个 `chat.send`**（两条
回复交叉），而是排进该会话的 steer 队列（pi 语义：当前 assistant 回合/
工具批结束、下一次模型调用前注入上下文）。WS 请求形如
`{"action": "chat.steer", "requestId": N, "runId": "...", "text": "..."}`；

- 服务端把插话追加进 journal（事件 `chat.steer`，`data.text`），所有订阅端
  （含发送者）以同一条 user 消息渲染（前端带「引导」角标）；
- 引导消息即落库（与 `chat.send` 的 user 行同路径），刷新/断线重连后仍在；
- 该会话无在途回复时回 `error`（前端仅在错误文案匹配"没有正在进行的回复"时回退
  为普通发送；WS 断开类错误不回退，文本退回输入框不吞输入）；
- 引导文本上限 6000 字符（与 composer 一致）；journal 事件带唯一 `id`（steerId），
  存档行携带 `steering`+`steerId`（前端按 id 去重，刷新后徽章与去重依据都在）；
- 轮次预算耗尽后才排到的引导不再驱动模型，以 `steerDropped` 工具事件显式提示
  "未送达"，不静默吞掉；
- `chat.send` 对已有在途回复的同一会话直接拒绝（双标签页/刷新恢复窗口的并发
  兜底），提示走引导；
- agent 侧注入点：① 多轮工具循环的回合边界（循环顶）；② 模型给出终文但
  队列仍有插话时强制再一次响应（`src/sigmaflow/agent/agent.py` 的
  `steer_poll` / `_inject_steer`）。

### 5a. 网页展示台（webview 工具代理）

模型可调用两个工具把**可交互网页**呈现在消息流里：

- `webview(url, title, note, height)` — 两类场景：
  1. **反爬/人机验证**：模型抓取被验证页拦截时，把该页交给用户在会话内
     操作。页面经 `/api/wv/{sid}?u=<目标URL>` 反向代理进 iframe：
     `X-Frame-Options`/CSP 等框架头被剥离，站内同源链接改写为继续走代理，
     页面 JS 的相对 fetch/XHR 由注入的补丁重定向回代理入口；用户操作期间
     目标站下发的 Cookie 全部落进服务端会话罐（`sid`，TTL 2 小时，LRU 16）。
     之后模型调用 `webview_fetch(url, sid)` 用同一罐子复查，验证通过即可
     拿到真实内容。
  2. **前端预览**：`url` 传本地 HTML 路径（项目相对或绝对）时走
     `/api/wv/file/<路径>`（绝对路径以 `~abs~` 哨兵前缀传递），相对
     css/js/图片按路径自然解析。
- `webview_fetch(url, sid, max_chars)` — 经指定会话罐抓取 URL，返回状态
  行 + 截断正文（500–40000 字符）。
- `webview(url, ..., live=true)` — **browser-use 式服务端真浏览器**：在服务器上
  起一个 headless Chromium（复用 playwright 缓存二进制，裸 CDP 直控，无新增
  依赖），页面以 screencast JPEG 帧流推给卡片（WS `/api/wv/live/{sid}`），
  用户在卡片里的点击/拖拽/滚动/键入/粘贴全部转发进真浏览器 —— Cookie 天然
  落在服务端，`webview_fetch` 抓取前自动把 CDP Cookie + 浏览器 UA 导入
  requests 罐。Cloudflare 等强质询首选此模式。会话 LRU 3 个、闲置 30 分钟
  回收；Chrome 路径可用 `SIGMAFLOW_WV_CHROME` 指定。

安全边界：本地文件路由沿用 present 的黑名单护栏（/etc、~/.ssh 等拒绝），
未知二进制类型不支持预览；会话罐仅存 Cookie 与 UA，不落盘。

### 6. Agent 工具配置（服务端存储）

设置页可对 Agent 内置工具做启用开关、改名、描述与参数结构覆盖，落盘到
`<science_dir>/tools.json`（默认 `~/.sigmaflow/science/tools.json`）。请求时动态组合出实际生效的工具
清单：禁用的工具不再发给模型，也不计入上下文固定开销；改名的工具会在执行层注册别名，
模型用新名称调用时仍路由到原实现。

```http
GET  /api/tools   → {"tools": [{id, name, description, enabled, schema, modified, origin}]}  # origin: "builtin"(基础)/"sciverse"/"arxiv" 或 MCP 服务器名
POST /api/tools   → {"tools": [...]}   # 保存全量列表；{"reset": true} 恢复默认
```

`id` 为工具原始名称（配置键），`name` 为发给模型的显示名，`schema` 为参数结构的紧凑 JSON 字符串（可编辑）。POST 请求体示例：

```json
{"tools": [{"id": "bash", "name": "run_terminal", "description": "Run a shell command.", "enabled": true, "schema": "{\"type\":\"object\",\"properties\":{\"command\":{\"type\":\"string\"}}}"}]}
```

规则：`id` 必须存在于当前工具集；显示名非空、去重、≤ 64 字符；描述 ≤ 2000 字符；
参数 schema 需为合法 JSON 对象（可提交带缩进的格式化文本, 服务端按解析后紧凑形式 ≤ 8000 字符校验; 留空用默认）；
`enabled: false` 表示禁用；与默认一致的项不落盘。保存后服务端自动清空 `/api/context-info`
缓存，下次查询返回重新测量的工具 token 开销。写操作要求同源（跨域返回 403）。

### 6a. Agent 技能配置（服务端存储）

设置页可对 Agent 技能做启用开关、改名与描述覆盖，落盘到
`<science_dir>/skills.json`。技能正文来自 `<science_dir>/skills/<id>/SKILL.md`
（内置技能在服务启动时从包资源种子化，自带 MinerU 文档提取技能）。技能清单作为系统提示的一部分发给模型，
禁用的技能不进入清单，也不占用上下文；改动随下一次会话生效。

```http
GET  /api/skills   → {"skills": [{id, name, description, enabled, builtin, modified}]}
POST /api/skills   → {"skills": [...]}   # 保存全量列表；{"reset": true} 恢复默认
```

`id` 为技能原始名称（来自 SKILL.md frontmatter）。写操作要求同源（跨域返回 403）。

### 6b. MCP 服务配置（服务端存储）

设置页可增删改 MCP 服务器（名称/地址/启用开关），落盘到
`<science_dir>/mcp.json`。内置服务器随应用分发（`server/science/mcp_servers.json`），
首次运行种子化，后续启动自动回填新内置服务器（用户主动移除的除外）；目前自带
`medical-apis`（医学数据查询）与 `anysearch`（认证头使用 `${ANYSEARCH_API_KEY}` 模板：
第三方 API Key 未配置该密钥时服务器等同禁用，配置后自动加入活动集并按真实密钥发送 Bearer 头）。
保存后服务端重连各启用的服务器拉取工具清单，
工具并入 Agent 工具列表（也会出现在 `/api/tools` 中）并占用上下文；禁用或移除的服务器不参与会话。

```http
GET  /api/mcp   → {"servers": [{id, name, url, enabled, builtin, locked, modified}]}  # locked: 密钥未配置，服务端强制关闭
POST /api/mcp   → {"servers": [...]}   # 保存全量列表；{"reset": true} 恢复内置；内置服务器的认证头以内置资产为准
```

规则：名称非空、去重、≤ 64 字符；地址需以 http(s):// 开头、≤ 500 字符；`enabled: false` 表示禁用。
保存会真实连接各启用的服务器（tools/list），可能需要数秒。写操作要求同源（跨域返回 403）。

### 6c. 系统提示词配置（服务端存储）

设置页可提供自定义系统提示词替换 Agent 内置默认，落盘到
`<science_dir>/system_prompt.json`。启用时 `prompt` 作为主 Agent 的系统提示词，
技能清单自动附加在末尾（工具调用说明由 Agent 运行时追加）；子代理提示词保持内置。
留空或关闭 `enabled` 表示使用内置默认。

```http
GET  /api/system-prompt   → {"prompt": str, "enabled": bool, "builtin": str, "builtinTokens": int}
POST /api/system-prompt   → {"prompt": str, "enabled": bool}   # 保存; 启用时 prompt 不能为空
```

`prompt` ≤ 32000 字符；`enabled: true` 时上下文用量圆环将按自定义提示词重新测量。
写操作要求同源（跨域返回 403）。

### 6d. 第三方 API Key 配置（服务端存储）

设置页可配置第三方服务的访问密钥（目前：Sciverse 工具、anysearch MCP），落盘到
`<science_dir>/tokens.json`。密钥只存服务端，接口只回传掩码（如 `sk-a****6789`）；
从环境变量（`Sciverse_API_KEY` / `ANYSEARCH_API_KEY`）继承的密钥在页面上标注来源。
保存后自动同步依赖方的启用状态：Sciverse 工具（有密钥→启用，无密钥→关闭）与
anysearch MCP 服务器（凭密钥加入/退出活动集）。

```http
GET  /api/tokens → {"tokens": [{id: "sciverse", label, configured, saved, fromEnv, keyHint}]}  # 密钥不回传，只报掩码(如 sk-a****6789)
POST /api/tokens → {"tokens": [...]}   # 保存 {"tokens": {"sciverse": str}}；空串 = 删除
```

写操作要求同源（跨域返回 403）。

### 7. 暂停、继续、取消

```http
POST /api/runs/{id}/control
Content-Type: application/json
```

```json
{"action":"pause"}
```

支持 `pause`、`resume`、`cancel`。成功返回最新状态快照。

已完成或取消的任务不允许恢复，模拟服务返回 `409`。在实际计算环境中，暂停与取消是否可用取决于执行引擎，应如实返回并展示状态，不能仅改变前端标签。

## 传输优先级：WebSocket 与 HTTP 双通道

主服务（`sigmaflow serve`，`server/science.py`）同时实现两种传输，运行同一个任务协议：

1. **WebSocket（优先）**：`/api/ws`，单条长连接承载全部操作与状态推送；
2. **HTTP + SSE（兼容回退）**：下述 2–5 节的原始协议，WS 不可用时自动降级。

前端在接口联调模式下先尝试建立 WS 连接（3.5 秒超时）；失败后 30 秒内不再重试，
期间所有请求走 HTTP，事件流走 SSE。两种通道推送的状态快照格式完全一致。

### 8. WebSocket 通道

连接地址由设置的接口地址派生：`{endpoint}/ws`（如 `/api` → `/api/ws`）。
每帧一个 JSON 文本消息。客户端消息为 `action`，可选携带 `requestId`；
服务端应答原样回传 `requestId`。推送与应答在同一连接上交错到达，
客户端必须按 `requestId` 匹配应答，不能假设消息顺序。

客户端 → 服务端：

```json
{"action": "ping"}
{"action": "run.create",  "requestId": "1", "prompt": "...", "steps": [{"title": "...", "tool": "..."}]}
{"action": "run.get",     "requestId": "2", "id": "run-id"}
{"action": "run.subscribe",   "requestId": "3", "id": "run-id"}
{"action": "run.unsubscribe", "id": "run-id"}
{"action": "run.control", "requestId": "4", "id": "run-id", "control": "pause"}
{"action": "model.list",   "requestId": "5"}
{"action": "model.save",   "requestId": "6", "id": "md-…?", "name": "…", "baseUrl": "…", "apiKey": "…?", "isDefault": true}
{"action": "model.delete", "requestId": "7", "id": "md-…"}
```

服务端 → 客户端：

```json
{"event": "pong"}
{"event": "run.created",    "requestId": "1", "data": {"id": "run-id", "isDemo": true}}
{"event": "run.snapshot",   "requestId": "2", "data": {"...完整状态快照..."}}
{"event": "run.subscribed", "requestId": "3", "data": {"id": "run-id"}}
{"event": "run.control",    "requestId": "4", "data": {"...完整状态快照..."}}
{"event": "model.list",    "requestId": "5", "data": {"models": ["…"]}}
{"event": "model.saved",   "requestId": "6", "data": {"model": {"…"}, "models": ["…"]}}
{"event": "model.deleted",  "requestId": "7", "data": {"models": ["…"]}}
{"event": "state", "data": {"...完整状态快照..."}}
{"event": "error", "requestId": "…", "data": {"error": "错误说明"}}
```

规则：

- `run.create` 成功后，**该连接自动订阅新任务**，无需再发送 `run.subscribe`；
  页面刷新后重连可显式发送 `run.subscribe`（幂等）重新订阅。
- `state` 推送的 `data` 与 SSE `state` 事件的负载完全一致。
- 校验失败（如 400/404/409）通过 `error` 事件应答并回传对应 `requestId`；
  无法解析的帧返回不带 `requestId` 的 `error`。
- 任务进入终态（`complete` / `cancelled` / `error`）后仍会推送最后一次快照，之后不再推送。
- 模型配置操作同第 5 节，`data` 负载与 HTTP 接口一致。前端对模型操作优先走 WS，避免跨域 fetch 被 CORS 预检拦截（服务端在 WS 握手阶段校验 Origin，非同源连接以 1008 关闭，与 HTTP 写接口的同源策略一致）。

### 8a. 交互终端（PTY）

WebSocket `/api/ws` 还承载终端 actions（与聊天共用连接，前端通过二进制帧 / JSON 事件区分）：

| action | data | 说明 |
|---|---|---|
| `pty.open` | `{projectId, cols, rows}` | 附着到项目级 PTY 会话（无则新建 bash），立即以 WS 二进制帧回放输出缓冲，随后应答 `pty.opened` |
| `pty.input` | `{projectId, data}` | 写入终端输入（任意键序，含方向键/Ctrl 组合） |
| `pty.resize` | `{projectId, cols, rows}` | 调整窗口大小并向前台进程发送 SIGWINCH |
| `pty.kill` | `{projectId}` | 结束终端进程并销毁会话 |

推送事件：二进制帧均为终端输出（原始字节，含 ANSI）；`{event: "pty.closed"}` 表示 bash 已退出，回车重新附着会自动新建。

- 每个项目一个会话：面板关闭不杀进程；重开自动续接并回放最近 200 KB 输出。
- 服务端最多同时保留 8 个项目会话，超限按创建时间回收最旧的。
- 终端以 `TERM=xterm-256color`、`COLORTERM=truecolor` 启动，支持全屏交互程序（vim / top）、补全与命令历史。

### 8b. 单用户 / 多用户模式

服务启动时通过环境变量选择模式，两种模式共用同一套 API：

- **单用户（默认）**：无登录流程，行为与历史版本一致；`GET /api/auth/me` 返回 `{mode:"single", user:{name:"<运行服务的系统用户名>"}}`，前端右下角显示该用户名。全部数据仍在共享目录（`SIGMAFLOW_SCIENCE_DIR` 或 `~/.sigmaflow/science`）。
- **多用户（`SIGMAFLOW_MULTI_USER=1`）**：注册 / 登录后按账号隔离会话与配置数据。

鉴权相关端点（登录态走 HttpOnly cookie `sigmaflow_session`，有效期 7 天，HMAC 签名）：

| 端点 | 说明 |
|---|---|
| `GET /api/auth/me` | 当前登录状态；多用户未登录时 `user` 为 `null` |
| `POST /api/auth/register` | `{username, password}` 注册并自动登录；用户名 3-32 位字母数字与 `-_`，密码 ≥6 位 |
| `POST /api/auth/login` | `{username, password}` 登录 |
| `POST /api/auth/logout` | 清除会话 cookie |
| `GET /api/auth/wechat/config` | `{enabled}`：是否可微信扫码登录 |
| `GET /api/auth/wechat/start` | `{url}`：微信二维码页地址（弹窗打开） |
| `POST /api/auth/wechat/exchange` | `{code,state}`：一次性 code 换会话，按 unionid 自动注册（`wx_xxxxxxxx` 无密码账号），返回 `{mode,user}` |

微信扫码登录为可选功能：在数据根目录放 `wechat.json`（`{"app_id":"\u2026","app_secret":"\u2026","redirect_base":"\u53ef\u9009"}`）即启用，`"enabled":false` 临时关闭；`app_secret` 不出服务器，state 只存内存（5 分钟一次性）。

多用户模式的隔离范围：

- 除 `/api/health` 与 `/api/auth/*` 外，所有 `/api` 请求与 WS 握手都必须携带有效会话，否则 401 / WS 关闭。
- 项目、会话、模型与服务商配置、工具 / 技能 / MCP 开关、系统提示词、token 统计按用户隔离，存于 `<数据根>/users/<用户名>/`。
- 运行任务按归属隔离：他人查询返回 404（不泄露存在性），列表只含本人任务。
- 登录凭据存于数据根的 `users.json`（PBKDF2-SHA256），签名密钥自动生成于 `session_secret`。

## 前端状态机

```text
新任务 → awaiting（等待用户确认）
       → running
       ↔ paused
       → complete
       → cancelled

接口异常 → error → 用户重试 → 查询服务端快照 → 重新订阅
```

用户在页面内切换导航不影响本地演示计时器。页面刷新后，本地运行任务变为暂停；接口任务的真实状态在服务端，前端显示需要重连，不声称已暂停服务端作业。

## 连接配置

在“设置 → Agent 接口”选择接口联调，地址填 `/api`。

- 同源路径：推荐，例如 `/api`。
- 本机 HTTP：允许 `http://127.0.0.1:PORT/api` 或 `http://localhost:PORT/api`。
- 非本机地址：必须使用 HTTPS。
- 不接受 URL 中的账号、密码、查询参数或片段。
- `fetch` 与 `EventSource` 使用凭据模式，适用于同源或经过配置的 Cookie 会话。
- 原生 EventSource 不支持任意 Authorization 请求头。生产系统可使用 HttpOnly 会话 Cookie 或调整适配层，不应将长期密钥放进 URL。
- 跨域需要严格配置 CORS，包括允许的具体 Origin 和凭据；不应使用宽泛的通配策略。

附带模拟服务只允许同源写请求，不开放跨域 CORS，也不实现用户身份认证。

## 生产实现需要补充

1. 服务端认证、项目授权、CSRF 防护、配额、审计与任务归属检查。
2. 原始文件上传 / 对象存储、数据校验、可追溯的数据集 ID。
3. 真实模型与计算任务；容器/作业隔离、资源限制、可取消性和超时。
4. 服务端审批记录、工具白名单、输入输出审查。
5. 真实的结果与工件接口，校验后再适配到图表与报告组件。
6. 重试幂等键、持久化状态、队列、事件回放和断线恢复。
7. 针对不同机构和研究场景的数据保护、留存与合规措施。

当前模拟服务器将任务状态放在内存中；服务器重启后任务消失，空闲过期记录会被清理。它不是可直接公开部署的生产科研 Agent 后端。

---

# 虚拟患者环境桥（病例挑战 Agent）

虚拟患者的生理引擎只存在于浏览器页面（`js/patient.js`）。为了让大模型能真的"操作这台监护仪"而不是复述教科书，服务端提供一层环境桥：**页面当环境宿主，服务端只转发工具调用**。

```
大模型 ⇄ MCP(tools/call) ⇄ /api/patenv/mcp ⇄ 队列 ⇄ 页面(长轮询) ⇄ 实时引擎
                                    ⇅
                        /api/patenv/chat (SSE, 流式对话)
```

因为每次工具调用都在页面上执行同一套函数（`administer()` / `applyShock()` / `ventToggle()` …），智能体读到的数值与用户看到的波形、事件记录、病例 HUD 是同一份状态。

## 1. 页面侧（Cookie 会话 + 同源写保护）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/patenv/session` | 注册环境会话（同一用户只保留最新一个页面实例），返回 `sessionId / projectId / conversationId / messages / tools` |
| GET | `/api/patenv/poll?sessionId=&wait=20` | 长轮询领取工具调用，最多等 25s；返回 `{call:{id,tool,args}}` 或 `{call:null}` |
| POST | `/api/patenv/result` | 回传执行结果 `{sessionId,id,ok,text}` |
| POST | `/api/patenv/chat` | 跑一轮智能体（SSE）：`delta` / `think` / `tool` / `done` / `error`；首轮自动在项目「虚拟患者」建档，`done.conversationId` 回传会话 id |
| POST | `/api/patenv/answer` | 回传 `ask` 工具的作答（面板上的选项卡） |

## 2. 智能体侧（MCP，仅本机）

`POST /api/patenv/mcp` — JSON-RPC 2.0，支持 `initialize` / `tools/list` / `tools/call` / `ping`。**只接受 127.0.0.1/::1**（MCP 客户端与服务同进程）；配置里写端口占位符 `{port}`，读取时替换为服务实际监听端口：

```json
{ "servers": { "patenv": { "url": "http://127.0.0.1:{port}/api/patenv/mcp" } } }
```

工具集（14 个，全部 `patient_` 前缀）：

| 工具 | 作用 |
| --- | --- |
| `patient_observe` | 生命体征 / 血气电解质 / 心律 / 病理 / 血药 / 病例目标 / 近况事件 |
| `patient_list_cases` | 病例清单（id、难度、限时、目标） |
| `patient_case_start` | 复位并载入病例，开始计时 |
| `patient_case_status` | 关卡时钟、每个目标的维持进度、操作数、结算结果 |
| `patient_administer` | 给药（化学 id 或中文名 + 剂量 + 途径） |
| `patient_shock` | 除颤（120/200/300/360J；窦性心律会拒答并说明风险） |
| `patient_ventilate` | 机械通气开关与 RR/Vt/PEEP/FiO₂ |
| `patient_oxygen` | 吸氧浓度 21–100% |
| `patient_cpr` | 胸外按压开关 |
| `patient_fluid` | 补液（正值）或放血（负值），按 500ml 步进 |
| `patient_lab` | 采血化验（含相位动态参考范围与趋势） |
| `patient_advance` | 快进 N 秒（≤120，引擎按 0.25s 步长实算，页面全程渲染） |
| `patient_log` | 事件记录尾部 |
| `patient_reset` | 复位到健康基线 |

## 3. 智能体提示词与归档

- 提示词：`science/prompts/patient_agent.md`，由 `/api/patenv/chat` 追加在 bound system 末尾（比通用提示词更靠近对话）。
- 会话归档：项目 **「虚拟患者」**（固定 id `pr-patient-env`，服务启动时补种）。首轮对话才建会话，标题取首句用户消息，`tools` 轨迹随消息保存，可在侧栏打开回放。
- 页面入口：虚拟患者页顶部「🤖 AI」按钮（`js/patenv.js`）；面板展示消息、工具卡、`ask` 卡片与实时体征条，每次执行都会在事件记录里留下 `🤖` 行。

## 4. 失败语义

| 情况 | 表现 |
| --- | --- |
| 页面没打开 | 工具调用立即返回"患者页没有打开…"，提示智能体让用户开页 |
| 页面 120s 无响应 | 返回超时说明，`waiters` 清理，不残留在途调用 |
| 页面重开 | 新会话顶替旧会话，旧的在途调用以"已被新页面实例替换"结束 |
| 模型调用失败 | SSE `error` 事件，前端红块显示，不会静默断流 |

---

# 虚拟病原体环境（pathenv，P0 骨架已上线）

与虚拟患者同一套「页面即环境」架构：仿真引擎只存在于浏览器（`js/pathogen.js` +
`js/patho/*`），服务端 `envbridge.py` 是通用传输层，`pathenv.py` 只是环境描述
（工具清单、分层、提示词、侧栏项目「虚拟病原体」`pr-pathogen-env`）。

## 尺度与分层 MCP

一个环境暴露为**五个可单独开关的 MCP 端点**（设置 → Agent 接口 → MCP），
按需挂载以控制智能体的上下文预算：

| 端点 | 尺度 | 工具数 |
| --- | --- | --- |
| `/api/pathenv/mcp/molecular` | 分子/基因组：基因组图式、变异检出、耐药注释、抗原逃逸、演化预测、药物匹配、疫苗设计、系统发生、宿主溯源 | 9 |
| `/api/pathenv/mcp/host` | 宿主内：目录、场景 setup、接种、给药、免疫调节、观测、时间推进、日志、复位 | 9 |
| `/api/pathenv/mcp/diag` | 诊断读数：检测(PCR/抗原/培养/血清/药敏)、测序、病原识别 | 3 |
| `/api/pathenv/mcp/pop` | 群体动态：元种群、干预、疫苗接种、监测、溢出预警、观测 | 6 |
| `/api/pathenv/mcp/trial` | 试验台：协议定义、重复运行、A/B 对比、导出 | 4 |

`/api/pathenv/mcp`（不带分组）暴露全部 31 个工具；所有端点仅接受本机请求。
浏览器侧路由与患者环境完全一致：`/api/pathenv/session`、`/poll`、`/result`、
`/chat`(SSE)、`/answer`，首轮对话自动归档到项目「虚拟病原体」。

## 目录与保真度

`js/patho/catalog.js` 目前收录 **218 个人类病原体条目**（病毒 70 / 细菌 77 /
真菌 16 / 原虫 21 / 蠕虫 31 / 朊粒 3），配 **24 组原型动力学**（基因组类型、
突变供给、宿主内复制率、致热源强度）。条目字段含潜伏期、传播途径、R0 区间、
储存宿主、媒介、治疗类别、疫苗平台与 **tier 保真度标注**（A 精调 77 / B 原型
校准 65 / C 目录级 76）。任何条目都不携带独立微分方程——动力学继承原型，静态
字段做量级覆盖。

**边界声明（页面常驻）**：本环境是教学/训练沙盒。参数取教科书量级，输出用于
机理理解与相对比较，不能作为临床决策或流行病学预测依据，工具输出会携带 tier
与不确定区间。

## 当前状态

P0 完成：通用环境桥抽取（患者环境零回归）、`#/pathogen` 页面骨架（目录浏览/
搜索/分类过滤/详情卡/五尺度页签/事件记录）、五组 MCP 端点与提示词。
智能体接口契约（31 个工具 schema）已冻结。

P1 完成 —— **宿主内引擎 + 诊断读数层已接线**（`js/patho/host.js` / `diag.js`）：

- **动力学**：病毒走靶细胞模型（T/I/V + IFN/CD8/Ab；抗病毒药按 p/β 两靶点折减），
  其余病原走负荷模型（敏感/耐药双亚群 Logistic + 免疫清除 + 突变供给 + 低密度
  调理吞噬）。时间上界 365 天，步长 0.01d，同 (pathogen, seed) 恒同曲线。
- **药代**：单室解析叠加（口服双指数或静脉单指数、规则给药到指定疗程），
  PD 用 Hill Emax × EC50(≈MIC)；MIC = 类基准 × 株间敏感度哈希，耐药株 fold 由
  (病原体, 类) 哈希（自测钩子可固定 fold）。
- **免疫**：暴露积分（sero）+ 记忆地板 + 再感染加速；免疫抑制可调。
- **诊断（有噪观测）**：qPCR（Ct=log 线性 + 种子噪声、LoD=10^2、未检出≠不存在）、
  抗原（载量 S 曲线灵敏度）、培养（病毒→不适用；给药中阳性提示耐药富集）、
  MIC 面板（表型折点 + "高稀释孔散在生长"亚群告警 1%–50%）。
  智能体只能通过诊断层观察，看不到引擎内部状态。
- **已接线工具**（页面执行，实时同步曲线/事件记录）：`catalog / setup / inoculate /
  dose / host_immune / host_observe / advance / diagnose / log / reset` 共 10 个；
  分子/群体/试验台组工具返回明确的"接线中"说明而不是假装成功。
- **验收**：`node scripts/patho_selftest.mjs` 18 项数值不变量全绿（确定性、
  剂量阶梯单调、MSW 富集 [2.5×10⁻⁸ → 0.92]、耐药 fold 单调、本底漂移压制、
  记忆再感染 17.2d→3.4d、抗病毒压峰 0.61 log10、致热源分层）；
  智能体工具驱动活页面 E2E 通过（含组门禁、9 条 🤖 事件痕迹）。

传输层修复（两个环境共享）：宿主会话以**长轮询活跃度**为准（POLL_TTL 90s），
标签页关闭后不再让工具调用干等 120s —— 立即返回"页面没有打开"引导。

P2 完成 —— **分子/基因组层已接线**（`js/patho/genome.js` / `predict.js`）：

- **确定性伪基因组**：序列由 (病原体, 基因) 哈希生成，不落库；基因座图式按原型
  （病毒按命名表、细菌/真菌/原虫/蠕虫各有代表性基因座，含表面基因与表位窗口）。
- **真值与读数分离**：引擎持真值（谱系变异 + 耐药决定簇的真实等位基因频率，
  细菌 = 耐药亚群占比、病毒 = 耐药等位基因动力学 `drAf`）；工具只能拿到测序
  读数 —— 深度检出铁律 `AF×深度 < 2.5` 直接把低频亚群藏起来，AF 估计噪声
  ∝ 1/√(深度×AF)，外加 1-3 个低频假阳（教学"显著性判断"）。
- **串行分离的分子钟**：每次测序按 0.55 SNP/天累积私有变异并冻结进样本，
  系统发生（SNP 距离矩阵 + UPGMA + Newick）与传播链推断（泊松似然 + 串行
  先验）建立在纯时钟位点上（耐药决定簇与测序错误都剔除出距离）。
- **注释与推断全套**：耐药注释（机制/位点/证据链 + S/I/R）、药物匹配
  （表型 + 抗性屏障 + 交叉耐药 + 组合推荐）、抗原逃逸（表位命中 → 滴度
  fold-drop）、演化预测（耐药/表位位点的前瞻频率, 带 tier 声明）、疫苗设计
  （保守/匹配/多价三策略 × 平台免疫原性 → 覆盖率 + 逃逸风险位点）、
  病原识别（mNGS 含背景污染、panel、培养）。
- **分子层边界**：朊粒（无核酸）与低载量建库失败都有明确引导而不是假装成功。

验收：`patho_selftest.mjs` 25 项全绿 —— 新增 7 项分子层不变量：深度可见性
（100× 漏检/2000× 检出同真值 AF）、传播链 F1（5 种子 25/25 边）、疫苗策略
覆盖率单调（conserved ⊆ cocktail）、病毒耐药真值扩张（nai 压力 3e-4→0.999）、
耐药注释证据链完整、朊粒/低载量边界。E2E：智能体经 MCP 在活页面跑通
K_pneumoniae 场景的 测序→变异→注释→匹配→系统发生→疫苗→逃逸→预测 全链
路（组门禁 ✓、14 条 🤖 页面痕迹、JS 错误 0）。

P3 完成 —— **群体层已接线**（`js/patho/pop.js`）：

- **元种群双毒株 SEIR**：地区 × 三年龄组（儿童/成人/老年，同龄优先接触矩阵，
  **按谱半径归一化**——接触矩阵只重组"谁传谁"，不放大"传多少"， 否则有效 R0
  整体偏热 ~2×、所有疫情十几天烧穿， 任何干预对比都失去意义），地区间流动性
  耦合；变异株 t=20d 注入（传播优势/免疫逃逸/重症倍率），并对康复者开放逃逸
  二次感染通道。
- **干预**：口罩/限聚/停课/封控/旅行限制（β 或流动性乘子）、检测-追踪-隔离
  （传染期缩短）、抗微生物治疗（传染期↓ 重症↓），力度 × 覆盖生效。
- **疫苗**：覆盖 × 保护力 → 人群阻断比例，60 天爬坡投放，对逃逸株按 (1−escape)
  打折 —— 输出直接给出是否达到 1−1/R0 阈值的判断。
- **监测（有噪观测）**：报告延迟 5-7 天 + 漏报 ~35% + 测序二项采样（带 CI）；
  样本不足时明确回答"测序样本不足"而不是硬报数字。
- **溢出预警**：对全目录 218 条按"宿主/媒介、受体兼容、基因屏障、BSL、监测"
  因子分解打分排序；界面对接参数驱动 what-if 对照(watchlist 与预期规模同步
  单调)。
- **宿主内↔群体耦合**：活动感染宿主的传染性指数决定种子病例的"有效规模"并在
  前 10 天加权 —— 自测中治疗指示病例使群体首波峰值压制 **81%**（33880→6527）。
- **单轴语义**：`pathogen_advance` 同时推进所有已初始化的层，页面按钮与工
  具同一条时间轴。

验收：自测 32/32（P3 新增 6 项：疫苗阈值 Rt 0.68 vs 1.39、封控峰值压制
100 vs 46758、监测噪声有界、溢出 what-if 单调、宿主耦合 81%、确定性）。
E2E：智能体经 MCP 在活页面完成流感 200 万人口 4 区演练 —— 疫苗+封控后
Rt=0.59（干预 0.74 × 真易感 57%/免疫 43%），变异株占比 7.0%，组门禁 ✓，
群体曲线画布已渲染，27 条 🤖 痕迹，JS 错误 0。

P4 完成 —— **试验台已接线**（`js/patho/trial.js`）：

- **协议**：多臂（≤8）× 时间表干预（接种/给药/群体干预/疫苗/采样/免疫背景），
  `replicates × days`，指标从 schema 枚举中取。页面试验台提供 JSON 编辑器与
  预填示例协议。
- **重复 = 新个体**：每条重复按种子抖动接种量（±20%）、事件时点（±0.4 天）
  与耐药倍数（加权抽取：4× 45% / 8× 30% / 16× 15% / 32× 10%，高倍数是少数）。
  引擎本身确定 —— 个体差异只从这里进场，否则同臂方差为 0，任何对比都是自欺。
- **指标 + bootstrap**：峰值载量/AUC/清除时间/耐药占比峰值/重症/成本，每臂给出
  均值与 95%CI；自动计算"控制评分"（清除为前提，再扣代价）。
- **A/B 对比**：1000 次重抽的 bootstrap 差值区间，明确回答"差值是否大于噪声"，
  同臂自比给出不显著的下限。
- **真值注册表**：每条重复登记种子与耐药倍数，默认隐藏，`reveal_truth=true`
  才随报告输出 —— 评估模式与训练模式的分界线。
- **导出**：CSV（每重复一行）与 JSON（协议+种子头部，可复算）。
- **状态保护**：试验在后台快照/恢复引擎单例 —— 页面正在看的宿主内场景与
  群体曲线原样保留，试验结束逐字节归还（自测用活动场景指纹验证）。

验收：自测 40/40（P4 新增 8 项：确定性、A/B 检验力、同臂自比噪声下限、真值
门禁、控制评分排序、导出形状、状态保护、真值可追溯）。E2E：智能体经 MCP 在
活页面定义 3 臂 × 8 重复试验（高剂量 1200mg q8h / 常规 500mg q12h / 对照），
清除时间 18.6d vs 31.0(删失) vs 31.0(删失)，A/B 显著，CSV 25 行，真值揭示，
组门禁 ✓，页面试验台协议预填并可独立运行，JS 错误 0。

P5 完成 —— **AI 面板 + 归档 + 提示词收口**（`js/pathenv.js`）：

- **AI 面板**：病原体页顶栏 `🤖 AI` 按钮 → 浮动对话面板（与患者面板同一套
  .pai 交互与 SSE 协议：delta/think/tool/done/error）。体征条实时显示
  当前场景（病原体/时间/载量/体温/耐药占比/群体时间/严重进程），智能体的
  每个工具调用都会落进事件记录（🤖 痕迹）并与曲线/试验台同步。
- **会话复用**：面板不复用会话而是**直接复用页面挂载时的环境桥会话** ——
  同一用户重复注册会顶掉旧会话, 双注册会让 MCP 轮询循环挂在死会话上。
- **归档契约**：`{id, title, projectId, content}` —— 字段名必须是 `content`,
  且 `projectId` 为空会把服务端已归好的项目**无条件冲掉**（upsert 语义）；
  病原体面板固定归档到 `pr-pathogen-env`。
- **提示词**：补试验台纪律（正式结论必须走 trial 台/两态 A/B 判读/reveal_truth
  只在评估用）与"观测 vs 有噪监测"的语义区分。

实测：一轮 "InfluenzaA 立即给药 vs 延迟 3 天给药" 的智能体回合 —— 56 次工具
调用（setup/inoculate/dose/advance/sequence/trial 全链）, 回复 2933 字符,
会话以用户首句为标题归档到「虚拟病原体」项目（2 行 + 56 条工具轨迹）,
面板体征条与页面场景同步（t=30d 已清除/Ab 0.74）, JS 错误 0。

至此虚拟病原体环境 P0–P5 全部落地。

P6 完成 —— **已知留白四项全部收口**：

1. **疫苗设计 → 宿主内落地**（`pathogen_host_vaccinate`, host 组）：覆盖率 ×
   逃逸折扣(每位点 12%, 封顶 75%) = 有效保护力; 疫苗地板 ~10 天召回应答起效、
   ~240 天衰减; 保护通道 = 挑战接种物中和 + 进入阻断(β) + 记忆地板。
   落地过程中抓出并修复 **两个引擎级缺陷**：① 靶细胞稳态方程量纲错配
   (未感染宿主每天净丢 10⁶ 靶细胞, 纯等待 300 天跑干 95% —— 疫苗衰减长程
   试验一测就现形); ② 中和抗体只消杀游离病毒、从不阻断新感染 —— 高效价
   宿主在富余靶细胞上无限闷烧。试验台新增 `{t, host_vaccine: true,
   coverage, escape_sites}` 事件, 疫苗臂 vs 对照臂峰值分离 3.5 log10。
2. **病原识别真实分岔**（`identify` 重写）：panel 有真实目标清单(呼吸道 17 /
   胃肠 15 / 血流 7 / CNS 9 联), 覆盖外诚实报"不在本 panel"; 培养只长细菌/真菌
   (病毒/原虫/蠕虫拒培养并给替代路径), 生长半定量挂钩采样时真值载量,
   低载量窗口(qPCR 阈上/培养阈下)培养报阴性 —— 治疗收尾期采样假阴是考试题。
3. **溢出监测灵敏度**（`spillover {surveillance}`）：weak/mid/strong 三档,
   预警中位延迟 41/21/13 天, tier C 罕见病原在弱监测下被系统性晚发现;
   watchlist 排序随档次变化 —— "监测能力是风险分母"的对照演练。
4. **群体血清学**（`pathogen_pop_serology`, pop 组）：每地区二项抽样 +
   Wilson 95% CI, 试剂灵敏度 90%/特异度 98%; 低流行区假阳性主导导致低估/
   高估方向教学, 样本不足诚实提示区间过宽。

另附：
- **3D 形态视图**（`js/patho/patho3d.js`，THREE 重制版）：程序化精细建模的
  形态观察器 —— 病毒(半透包膜+正二十面体衣壳+三聚体刺突+螺旋核衣壳) /
  细菌(荚膜杆体+类核+周生鞭毛行波+菌毛/芽孢) / 真菌(出芽芽痕/分枝菌丝) /
  原虫(噪声位移体+纤毛场实例化摆动) / 蠕虫(分节链正弦游行+头节小钩) /
  朊粒(双股交织淀粉样纤维束)。PBR 材质(clearcoat 湿润质感/transmission
  半透层), RoomEnvironment 环境光 + ACES 色调映射, OrbitControls 拖拽缩放
  自动自转; 标签永远注明"程序化示意形态, 非真实结构"。
- **患者页 ↔ 病原页联动**：患者页顶栏「🧭 病原沙盒」按钮, 把当前主导病原
  (19 个 PATH_LIB 键全量映射到目录 id)带入 `#/pathogen?entry=X` 深链预选,
  并在事件记录注明"沙盒是独立教学环境, 与原病人无连续性"。

验收：自测 53/53(P6 新增 8 项: 疫苗落地/时程/衰减、培养真实性、panel 漏检、
溢出灵敏度、血清学、试验台疫苗事件); pytest 92(工具面 31→33 断言同步);
ruff/mypy 绿。E2E: 深链预选(流感选中行+一次性日志)、MCP 疫苗/panel/培养
覆盖内外分岔、血清学 39/2000→1.9% [CI 1.4~2.7%]、溢出 strong 13d vs weak
41d、3D 渲染像素与拖拽旋转差分、患者页接种流感→一键入沙盒, JS 错误 0,
🤖 痕迹 18。

P0–P6 全部落地。环境面 33 工具(9/10/3/7/4) + 五组 MCP 端点 + AI 面板 + 归档
+ 患者页联动。
