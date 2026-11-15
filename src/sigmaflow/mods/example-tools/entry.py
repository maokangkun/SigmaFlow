"""示例工具 mod: 注册 current_time 工具(演示 ctx.services.tools 桥)。

这是最小可用的 mod 模板 — 复制本目录, 改 id/工具/handler 即可。
handler 签名与现有工具一致: **kw 收参数, 返回给模型的字符串。
"""

from datetime import datetime
from zoneinfo import ZoneInfo, available_timezones


def _current_time(timezone: str = "local", **_ignored) -> str:
    tz_name = (timezone or "local").strip()
    if tz_name in ("", "local"):
        now = datetime.now().astimezone()
        label = now.tzname() or "local"
        return now.strftime(f"%Y-%m-%d %H:%M:%S ({label})")
    try:
        now = datetime.now(ZoneInfo(tz_name))
    except Exception:
        sample = sorted(
            t for t in available_timezones() if t.lower().startswith(tz_name.lower())
        )[:3]
        hint = f" Did you mean: {', '.join(sample)}?" if sample else ""
        return f"Error: unknown timezone {tz_name!r}.{hint} Examples: Asia/Shanghai, UTC, America/New_York."
    return now.strftime(f"%Y-%m-%d %H:%M:%S ({tz_name})")


def activate(ctx):
    ctx.services.tools.register(
        name="current_time",
        description=(
            "Get the current local time, or the time in a named IANA timezone "
            "(e.g. Asia/Shanghai, UTC, America/New_York). Use this instead of "
            "running a shell command when you only need to know what time it is."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "timezone": {
                    "type": "string",
                    "description": "Optional IANA timezone name; omit for local time",
                }
            },
            "required": [],
        },
        handler=_current_time,
        audience="both",
        owner=ctx.mod_id,
    )
