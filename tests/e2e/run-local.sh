#!/bin/bash
# 本地一键 e2e: mock LLM 网关 + 本地服务 + 全套件(无需真实模型/远程部署)。
#
# 用法: tests/e2e/run-local.sh [端口]
# 依赖: 仓库 .venv、任意可用的 chromium(SIGMAFLOW_E2E_CHROMIUM 指定,
#       或 ~/.cache/ms-playwright, 或 PATH 上的 chromium)。
# 示例: SIGMAFLOW_E2E_CHROMIUM=/path/to/chrome tests/e2e/run-local.sh
set -u
cd "$(dirname "$0")/../.."
PORT="${1:-4123}"
ROOT="$PWD"
export SIGMAFLOW_HOME="${SIGMAFLOW_HOME:-$ROOT/.local-e2e/home}"
export SIGMAFLOW_SCIENCE_DIR="${SIGMAFLOW_SCIENCE_DIR:-$SIGMAFLOW_HOME/science}"
unset ALL_PROXY all_proxy HTTP_PROXY http_proxy HTTPS_PROXY https_proxy
mkdir -p "$SIGMAFLOW_SCIENCE_DIR"

for f in .local-e2e/mock.pid .local-e2e/srv.pid; do
  [ -f "$f" ] && kill "$(cat "$f")" 2>/dev/null; rm -f "$f"
done
sleep 1

E2E_MOCK_PORT=$((PORT+1)) .venv/bin/python tests/e2e/mock_gateway.py > .local-e2e/mock.log 2>&1 &
echo $! > .local-e2e/mock.pid
.venv/bin/python -c "
from sigmaflow.cmd import main
import sys
sys.argv = ['sigmaflow', 'serve', '--port', '$PORT']
main()
" > .local-e2e/server.log 2>&1 &
echo $! > .local-e2e/srv.pid

# 首跑注入 mock 模型配置(provider 指向本地网关)
if [ ! -s "$SIGMAFLOW_SCIENCE_DIR/models.json" ]; then
cat > "$SIGMAFLOW_SCIENCE_DIR/models.json" <<JSON
{
  "providers": {"pv-mock": {"id": "pv-mock", "name": "mock", "baseUrl": "http://127.0.0.1:$((PORT+1))/v1", "apiKey": "mock-key", "keyHint": "mock"}},
  "models": {"md-mock": {"id": "md-mock", "providerId": "pv-mock", "model": "mock-e2e", "isDefault": true, "contextWindow": 32768}}
}
JSON
fi

for i in $(seq 1 60); do sleep 1; curl -sk "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break; done
echo "服务就绪 http://127.0.0.1:$PORT"

cd tests/e2e
SIGMAFLOW_E2E_BASE="http://127.0.0.1:$PORT" timeout 1800 node run.mjs
RC=$?
kill "$(cat "$ROOT/.local-e2e/mock.pid")" "$(cat "$ROOT/.local-e2e/srv.pid")" 2>/dev/null
exit $RC
