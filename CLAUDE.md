# SigmaFlow 运维约定

## 测试完成后必须重启线上服务

凡改动 `src/sigmaflow/**` 并完成测试后，**必须重启本机 science 服务**让线上
生效（服务为用户级 systemd 单元，editable 安装直跑本仓库代码）：

```bash
export XDG_RUNTIME_DIR=/run/user/$(id -u)
systemctl --user restart sigmaflow-web.service   # sigmaflow serve, 端口 4110
```

验证：`curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4110/api/health`
应为 200。相关单元：`sigmaflow-proxy`(4111→4110)、`epp-web`(独立实例, 端口
4185, 与本仓库共用代码 — 重启 sigmaflow-web 时一并考虑是否需要重启 epp-web)。

线上为多用户模式（SIGMAFLOW_MULTI_USER=1），未登录调用受鉴权接口返回 401
属正常；判定新代码是否上线用 `GET /api/mods`（401=新代码在跑, 404=旧代码）。

## science dist 提交约定

- 改 `science/js|css` 后**必须用宿主机 esbuild 构建并同步提交 dist**：
  `ESBUILD_BIN=/data/mkk/github/ComfyUI_frontend/node_modules/.bin/esbuild
  node scripts/build.mjs`（在宿主机跑；该 esbuild 产物逐字节可复现，
  与规范哈希一致）。不要用不带 ESBUILD_BIN 的构建——产哈希不同、未压缩
  的产物（历史上已三次："rebuilt on host esbuild"）。流程:
  `make science-regression`(测试+check+单测+重建) → `git add dist` → 提交。
  同步 dist 的提交本身过不了 science-regression 的 porcelain 门禁(要求
  运行时 dist 与 HEAD 一致), 按先例用 `--no-verify`(仅此类同步提交)。
- push 前另有 `scripts/git-hooks/pre-push` 门禁(format/lint/双套测试/
  science-regression/e2e-smoke), `core.hooksPath` 已指向 `scripts/git-hooks`,
  无需安装。急事绕过: `git push --no-verify`。
