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

### 6. Agent 工具配置（服务端存储）

设置页可对 Agent 内置工具做启用开关、改名与描述覆盖，落盘到
`<science_dir>/tools.json`（默认 `~/.sigmaflow/science/tools.json`）。请求时动态组合出实际生效的工具
清单：禁用的工具不再发给模型，也不计入上下文固定开销；改名的工具会在执行层注册别名，
模型用新名称调用时仍路由到原实现。参数结构只读。

```http
GET  /api/tools   → {"tools": [{id, name, description, enabled, schema, modified}]}
POST /api/tools   → {"tools": [...]}   # 保存全量列表；{"reset": true} 恢复默认
```

`id` 为工具原始名称（配置键），`name` 为发给模型的显示名，`schema` 为参数结构的紧凑 JSON 字符串（可编辑）。POST 请求体示例：

```json
{"tools": [{"id": "bash", "name": "run_terminal", "description": "Run a shell command.", "enabled": true, "schema": "{\"type\":\"object\",\"properties\":{\"command\":{\"type\":\"string\"}}}"}]}
```

规则：`id` 必须存在于当前工具集；显示名非空、去重、≤ 64 字符；描述 ≤ 2000 字符；
参数 schema 需为合法 JSON 对象且 ≤ 8000 字符（留空用默认）；
`enabled: false` 表示禁用；与默认一致的项不落盘。保存后服务端自动清空 `/api/context-info`
缓存，下次查询返回重新测量的工具 token 开销。写操作要求同源（跨域返回 403）。

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
