import os
import httpx
from openai import AsyncOpenAI
from ..utils import sync_compat


@sync_compat
async def completion(item: str | list[str], conf={}):
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
    if client_param["base_url"] is None: del client_param["base_url"]

    chat_param = {
        "messages": msg,
        "model": conf.get("model", os.getenv("OPENAI_API_MODEL")),
        "max_completion_tokens": int(n)
        if (n := conf.get("max_completion_tokens", os.getenv("OPENAI_API_MAX_COMP_TOKENS")))
        else None,
        "temperature": float(conf.get("temperature", os.getenv("OPENAI_API_TEMPERATURE", 1))),
    }

    client = AsyncOpenAI(**client_param)
    chat_completion = await client.chat.completions.create(**chat_param)
    resp = chat_completion.choices[0].message.content
    usage = {
        "prompt_tokens": chat_completion.usage.prompt_tokens,
        "completion_tokens": chat_completion.usage.completion_tokens,
    }
    return resp, usage
