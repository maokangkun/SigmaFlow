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
  "service": "SigmaFlow Science local demo",
  "protocol": "1.0"
}
```

`demo` 应如实标记服务性质。这个返回值只证明接口可访问，不证明模型或计算环境可用。

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

### 5. 暂停、继续、取消

```http
POST /api/runs/{id}/control
Content-Type: application/json
```

```json
{"action":"pause"}
```

支持 `pause`、`resume`、`cancel`。成功返回最新状态快照。

已完成或取消的任务不允许恢复，模拟服务返回 `409`。在实际计算环境中，暂停与取消是否可用取决于执行引擎，应如实返回并展示状态，不能仅改变前端标签。

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
