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
