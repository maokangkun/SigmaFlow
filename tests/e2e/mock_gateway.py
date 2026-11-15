"""本地 mock OpenAI 网关 v3: 按对话状态路由, 支撑 e2e 全场景。

- 首问含 "bash" → 发 tool_call(bash sleep 14)
- 已有工具结果(role=tool / 内容含 exited) → 终答"我运行了 sleep 14…"
- 消息含 "6+6"(引导) → "【引导收到】6+6 等于 12。"
- 其他(数数类) → 120 行慢速长流(~30s)
"""

import asyncio
import json

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse

app = FastAPI()


def _chunk(delta, finish=None, usage=None):
    c = {
        "id": "chatcmpl-mock",
        "object": "chat.completion.chunk",
        "created": 0,
        "model": "mock-e2e",
        "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
    }
    if usage:
        c["usage"] = usage
    return c


def _route(messages):
    # 只看 user/tool 轮次 — system 提示词包含全部工具描述("bash"等字样),
    # 不能参与路由判定
    convo = [
        m for m in messages if isinstance(m, dict) and m.get("role") in ("user", "tool")
    ]
    joined = "\n".join(
        str(m.get("content") or "")
        + json.dumps(m.get("tool_calls") or [], ensure_ascii=False)
        for m in convo
    )
    if "6+6" in joined:
        return "steer"  # 引导优先: 工具完成后带着引导的下一轮要回引导内容
    if any(m.get("role") == "tool" for m in convo):
        return "final"
    # 只看最后一条用户消息的意图(历史里可能有别的词)
    last_user = next(
        (
            str(m.get("content") or "")
            for m in reversed(convo)
            if m.get("role") == "user"
        ),
        "",
    )
    if "bash" in last_user or "sleep" in last_user:
        return "tool"
    return "count"


@app.post("/v1/chat/completions")
async def completions(request: Request):
    body = await request.json()
    stream = bool(body.get("stream"))
    route = _route(body.get("messages") or [])

    async def sse(events, delay=0.25):
        for ev in events:
            yield "data: " + json.dumps(ev, ensure_ascii=False) + "\n\n"
            await asyncio.sleep(delay)
        yield "data: [DONE]\n\n"

    def events_for(route):
        if route == "tool":
            return [
                _chunk({"role": "assistant", "content": None}),
                _chunk(
                    {
                        "tool_calls": [
                            {
                                "index": 0,
                                "id": "call_mock_1",
                                "type": "function",
                                "function": {
                                    "name": "bash",
                                    "arguments": json.dumps(
                                        {"command": "sleep 14 && echo done"}
                                    ),
                                },
                            }
                        ]
                    },
                    finish="tool_calls",
                ),
            ], 0.05
        if route == "final":
            text = "我运行了 sleep 14 命令，已正常结束，输出 done。"
            return [_chunk({"content": t}) for t in _split(text, 6)] + [
                _chunk(
                    {},
                    finish="stop",
                    usage={
                        "prompt_tokens": 10,
                        "completion_tokens": 12,
                        "total_tokens": 22,
                    },
                )
            ], 0.25
        if route == "steer":
            text = "【引导收到】6+6 等于 12。我运行了 sleep 14 命令并已正常结束。"
            return [_chunk({"content": t}) for t in _split(text, 6)] + [
                _chunk(
                    {},
                    finish="stop",
                    usage={
                        "prompt_tokens": 10,
                        "completion_tokens": 8,
                        "total_tokens": 18,
                    },
                )
            ], 0.25
        evs = [_chunk({"content": f"{i}\n"}) for i in range(1, 121)]
        evs.append(
            _chunk(
                {},
                finish="stop",
                usage={
                    "prompt_tokens": 10,
                    "completion_tokens": 120,
                    "total_tokens": 130,
                },
            )
        )
        return evs, 0.25

    def _split(text, n):
        return [text[i : i + n] for i in range(0, len(text), n)]

    if stream:
        evs, delay = events_for(route)
        return StreamingResponse(sse(evs, delay), media_type="text/event-stream")

    # 非流式
    if route == "tool":
        return {
            "id": "chatcmpl-mock",
            "object": "chat.completion",
            "created": 0,
            "model": "mock-e2e",
            "choices": [
                {
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": None,
                        "tool_calls": [
                            {
                                "id": "call_mock_1",
                                "type": "function",
                                "function": {
                                    "name": "bash",
                                    "arguments": json.dumps(
                                        {"command": "sleep 14 && echo done"}
                                    ),
                                },
                            }
                        ],
                    },
                    "finish_reason": "tool_calls",
                }
            ],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
        }
    evs, _ = events_for(route if route != "tool" else "count")
    text = "".join(e["choices"][0]["delta"].get("content") or "" for e in evs)
    return {
        "id": "chatcmpl-mock",
        "object": "chat.completion",
        "created": 0,
        "model": "mock-e2e",
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": text},
                "finish_reason": "stop",
            }
        ],
        "usage": {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30},
    }


if __name__ == "__main__":
    import os as _os

    uvicorn.run(
        app,
        host="127.0.0.1",
        port=int(_os.environ.get("E2E_MOCK_PORT", "4124")),
        log_level="warning",
    )
