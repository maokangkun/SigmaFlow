#!/usr/bin/env python3
"""E2E 冒烟: 本机起一次性服务跑 tests/e2e, 不依赖常驻服务/LAN 地址/已配模型。

- 空模型库时需模型的套件自跳过(helpers.probe.models=false), 纯前端套件
  (patho3d 等)照跑 —— 这正是日常门禁覆盖不到的部分;
- node/npm 依赖缺失时整体 SKIP(exit 0), 与套件"环境缺失不挂红"哲学一致;
- 服务绑定 127.0.0.1 随机端口, 无端口冲突; 退出时随进程回收。
"""

import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))


def _free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def main() -> int:
    if shutil.which("node") is None:
        print("SKIP: 本机无 node, E2E 冒烟跳过")
        return 0

    port = _free_port()
    tmp = tempfile.mkdtemp(prefix="sf-e2e-smoke-")
    os.environ["SIGMAFLOW_SCIENCE_DIR"] = tmp
    # 服务端日志降到 WARNING: DEBUG/INFO 噪音会淹没 run.mjs 的套件输出
    os.environ.setdefault("LOGGING_LEVEL", "WARNING")
    os.environ.setdefault("SIGMAFLOW_LOG_LEVEL", "WARNING")
    sys.path.insert(0, os.path.join(ROOT, "src"))

    import uvicorn

    from sigmaflow.cmd import build_server

    app = build_server()
    server = uvicorn.Server(
        uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning")
    )
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()

    base = f"http://127.0.0.1:{port}"
    for _ in range(100):
        if server.should_exit:
            break
        try:
            with urllib.request.urlopen(base + "/api/health", timeout=2) as resp:
                if resp.status == 200:
                    break
        except Exception:
            time.sleep(0.2)
    else:
        print("E2E 冒烟: 本地服务启动失败")
        server.should_exit = True
        return 1

    env = dict(os.environ, SIGMAFLOW_E2E_BASE=base)
    try:
        return subprocess.call(["node", "run.mjs"], cwd=HERE, env=env)
    finally:
        server.should_exit = True
        thread.join(timeout=10)


if __name__ == "__main__":
    sys.exit(main())
