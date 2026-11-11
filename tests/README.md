# SigmaFlow 测试指南

测试分四层，全部可通过 `make` 驱动：

| 层 | 命令 | 内容 |
|---|---|---|
| 包级单元/集成 | `make tests`（pytest） | agent 循环、管线引擎、压缩器、webview 工具、science 存储耐久、steering 注入与互斥等 |
| Science 回归 | `make science-regression` | 后端契约（HTTP+SSE+WS）+ 前端语法与纯函数检查（check.mjs）+ 几何助手单测（unittest.mjs）+ dist 一致性校验 |
| 浏览器 E2E | `make e2e` | 见下文 |
| 覆盖率 | `make coverage` | coverage run -m pytest，阈值 95% |

## 浏览器 E2E（tests/e2e/）

`make e2e` 跑常驻浏览器端到端套件（playwright-core 复用本机
`~/.cache/ms-playwright` 的 chromium，首次运行自动 `npm install`）：

- `patho3d.e2e.mjs` —— 3D 形态视图六大类渲染回归（不依赖模型）
- `session_switch.e2e.mjs` —— 流式中会话切换/不被拽回/零整页重建/
  六连击/点击丢失补发（需模型）
- `steering.e2e.mjs` —— 引导全链路：按钮/插话回显/单回复/并发拒绝/
  模型回应/徽章刷新持久化/互斥自动转（需模型）

服务不可达时整套 SKIP（exit 0），无模型时仅跳过需要真实生成的场景；
`SIGMAFLOW_E2E_BASE` 可覆盖目标地址。新增套件只需添加 `*.e2e.mjs`，
`run.mjs` 自动纳入。

## steering 相关测试速查

- `tests/test_agent_steer.py` —— agent 注入助手（排空/异常/空项/注入）
  与存档层（引导行不去重、steerId 白名单保留、排空语义）
- `tests/test_steer_ws.py` —— `_chat_pump` 的 steer 事件分支（形态/seq/
  断线重放去重/容错）与 `_find_active_state` 会话互斥查找（用户隔离/终态）

## 前端单元测试（science/scripts/unittest.mjs）

`make science-regression` 自动执行：vm 沙箱加载 `js/patho/patho3d.js`，
校验 `_geom` 导出的几何助手（斐波那契球面/螺旋管曲线）的数值不变量。

## 快照测试

依赖 inline snapshots 的用例可用 `make snapshots-fix` 更新已有快照、
`make snapshots-create` 创建新快照；更新后再跑一遍 `make tests` 确认。
