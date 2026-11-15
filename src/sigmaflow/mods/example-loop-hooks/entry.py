"""示例 loop mod: 工具调用审计(agent.tool.exec around) + 轮次计数(observe)。

复制本目录即得一个 loop mod 模板。around 签名: fn(next_fn, **ctx) —
next_fn() 执行真实调用, 可改参/改返回值/直接短路; observe 钩子拿 lc
(LoopContext) 只读观察。
"""

import json
import time
from pathlib import Path

_STATE = {"turns": 0, "calls": 0}


def _audit_path(ctx):
    cfg = ctx.config.get("audit-path") or ""
    if cfg:
        return Path(cfg)
    return Path.home() / ".sigmaflow" / "logs" / "tool-audit.jsonl"


def activate(ctx):
    loop = ctx.services.loop

    def audit_tool(next_fn, *, func=None, inp=None):
        if not ctx.config.get("audit", True):
            return next_fn()
        started = time.time()
        out = next_fn()
        _STATE["calls"] += 1
        try:
            path = _audit_path(ctx)
            path.parent.mkdir(parents=True, exist_ok=True)
            with open(path, "a", encoding="utf-8") as fh:
                fh.write(
                    json.dumps(
                        {
                            "at": round(started, 3),
                            "ms": int((time.time() - started) * 1000),
                            "tool": func,
                            "ok": not str(out).startswith("Error:"),
                            "args_len": len(
                                json.dumps(inp, ensure_ascii=False, default=str)
                            ),
                        },
                        ensure_ascii=False,
                    )
                    + "\n"
                )
        except Exception:
            pass  # 审计失败不阻断工具
        return out

    loop.around("agent.tool.exec", audit_tool)

    def count_turn(lc):
        _STATE["turns"] += 1

    loop.on("agent.turn.begin", count_turn)
    ctx.track("state", _STATE)
