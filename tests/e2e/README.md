# E2E 测试套件

playwright-core + 本机 chromium 的常驻回归套件。

## 运行

- 连远程部署: `npm test`(默认 `SIGMAFLOW_E2E_BASE`, 见 helpers.mjs)
- 本地一键(免真实模型): `tests/e2e/run-local.sh` — 自动起 mock OpenAI
  网关(慢速长流 + bash 工具调用 + 引导应答路由)与本地服务, 注入 mock
  模型配置, 全部六套真跑(含需模型的 reload/session/steering/mutex)。

## 浏览器解析顺序(helpers.chromiumPath)

1. `~/.cache/ms-playwright`(playwright 官方安装)
2. `SIGMAFLOW_E2E_CHROMIUM` 环境变量指定的二进制
3. PATH 上的 chromium/chrome

无浏览器时套件按"环境缺失不挂红"哲学整体 SKIP。
