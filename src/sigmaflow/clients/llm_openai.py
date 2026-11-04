import os
import httpx
from openai import AsyncOpenAI
from ..utils import ThinkStreamSplitter, sync_compat


@sync_compat
async def completion(item: str | list[str], conf={}, stream_cb=None):
    msg = []
    if (t := type(item)) is str:
        msg.append(
            {
                "role": "user",
                "content": item,
            }
        )
    elif t is list:
        for role, c in zip(["user", "assistant"] * len(item), item):
            msg.append(
                {
                    "role": role,
                    "content": c,
                }
            )

    client_param = {
        "api_key": conf.get("api_key", os.getenv("OPENAI_API_KEY")),
        "base_url": conf.get("base_url", os.getenv("OPENAI_API_URL")),
        "max_retries": 20,
        # 'timeout': 6000.0,
        "http_client": httpx.AsyncClient(verify=conf.get("SSL", False)),
    }
    if client_param["base_url"] is None:
        del client_param["base_url"]

    chat_param = {
        "messages": msg,
        "model": conf.get("model", os.getenv("OPENAI_API_MODEL")),
        "max_completion_tokens": int(n)
        if (
            n := conf.get(
                "max_completion_tokens", os.getenv("OPENAI_API_MAX_COMP_TOKENS")
            )
        )
        else None,
        "temperature": float(
            conf.get("temperature", os.getenv("OPENAI_API_TEMPERATURE", 1))
        ),
    }

    client = AsyncOpenAI(**client_param)
    if stream_cb is None:
        chat_completion = await client.chat.completions.create(**chat_param)
    else:
        # 流式通道: 每个增量立即回调(node 层转发给 /run 的 SSE 订阅)。
        # reasoning_content → type=think; content 里的 think 标签段也切为 think 帧,
        # 正文的最终 resp 仍保持剥离 think 后的语义(与 remove_think_content 一致)。
        parts = []
        splitter = ThinkStreamSplitter()
        usage = None
        stream = await client.chat.completions.create(
            **{**chat_param, "stream": True}
        )
        async for chunk in stream:
            usage = getattr(chunk, "usage", None) or usage
            choices = getattr(chunk, "choices", None)
            if not choices:
                continue
            delta = choices[0].delta
            rc = getattr(delta, "reasoning_content", None)
            if rc:
                stream_cb("think", rc)
            content = getattr(delta, "content", None)
            if content:
                for kind, piece in splitter.feed(content):
                    stream_cb(kind, piece)
                    if kind == "content":
                        parts.append(piece)
        for kind, piece in splitter.flush():
            stream_cb(kind, piece)
            if kind == "content":
                parts.append(piece)
        resp = "".join(parts)
        if not resp:
            # 与非流式同语义: 纯思考无正文 → 抛错交回 Block 重试循环。
            raise RuntimeError(
                "model returned no content (empty message, likely reasoning truncated "
                "by max_completion_tokens; raise OPENAI_API_MAX_COMP_TOKENS)"
            )
        usage_dict = None
        if usage is not None:
            usage_dict = {
                "prompt_tokens": getattr(usage, "prompt_tokens", 0),
                "completion_tokens": getattr(usage, "completion_tokens", 0),
            }
        return resp, usage_dict
    msg = chat_completion.choices[0].message
    resp = msg.content
    if resp is None:
        # 纯思考无正文(多半被 max_completion_tokens 截断)→ 抛错交回 Block 重试循环,
        # 重试耗尽后 error_msg 会带明说原因, 别静默把 None 当结果传下去。
        raise RuntimeError(
            "model returned no content (empty message, likely reasoning truncated "
            "by max_completion_tokens; raise OPENAI_API_MAX_COMP_TOKENS)"
        )
    usage = {
        "prompt_tokens": chat_completion.usage.prompt_tokens,
        "completion_tokens": chat_completion.usage.completion_tokens,
    }
    return resp, usage
