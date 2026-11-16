#!/bin/bash
# Workspace 前端上游同步一键脚本(在宿主机跑, 见 docs/workspace-integration-plan.md §3.5)
# 用法: scripts/sync-workspace.sh [fork目录]   # 默认 /data/mkk/github/ComfyUI_frontend
set -euo pipefail

FORK="${1:-/data/mkk/github/ComfyUI_frontend}"
SF="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$SF/src/sigmaflow/server/comfyui/dist"

echo "== 1/5 上游合并 =="
cd "$FORK"
git fetch origin
git checkout sigmaflow/main
BEFORE=$(git rev-parse --short HEAD)
git merge origin/main
echo "合并完成: $BEFORE -> $(git rev-parse --short HEAD) (冲突时解决后重跑本脚本)"

echo "== 2/5 依赖安装 =="
export PATH="$HOME/pnpm-tool/node_modules/.bin:$PATH"
command -v pnpm >/dev/null || { mkdir -p ~/pnpm-tool && cd ~/pnpm-tool && npm install pnpm@10.22.0 --prefix . --no-audit --no-fund && cd "$FORK"; }
pnpm install --frozen-lockfile

echo "== 3/5 构建 =="
pnpm build   # outDir 默认 dist-sigmaflow(fork 内暂存)

echo "== 4/5 换装产物(旧产物备份) =="
cd "$DIST/.."
rm -rf dist.vendor-backup && [ -d dist ] && mv dist dist.vendor-backup
cp -r "$FORK/dist-sigmaflow" dist

echo "== 5/5 SigmaFlow 契约测试 =="
cd "$SF"
env -u ALL_PROXY -u all_proxy -u HTTP_PROXY -u http_proxy -u HTTPS_PROXY -u https_proxy \
  .venv/bin/python -m pytest tests/test_workspace_protocol.py -q

echo ""
echo "同步通过。后续: 1) 跑全量回归+无头冒烟  2) SigmaFlow 提交新 dist"
echo "3) 在 fork 的 SIGMAFLOW_SYNC.md 登记新基线(上游 commit + 产物提交)"
