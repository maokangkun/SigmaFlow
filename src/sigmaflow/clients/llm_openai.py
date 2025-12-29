import os
from openai import AsyncOpenAI
from ..utils import sync_compat


def llm_client(is_async=False):
    return completion


@sync_compat
async def completion(text):
    msg = []
    if (t := type(text)) is str:
        msg.append(
            {
                "role": "user",
                "content": text,
            }
        )
    elif t is list:
        for role, c in zip(["user", "assistant"] * len(text), text):
            msg.append(
                {
                    "role": role,
                    "content": c,
                }
            )

    client_param = {
        "api_key": os.getenv("OPENAI_API_KEY"),
        "base_url": os.getenv("OPENAI_API_URL"),
        "max_retries": 20,
        # 'timeout': 6000.0,
    }
    chat_param = {
        "messages": msg,
        "model": os.getenv("OPENAI_API_MODEL"),
        "max_completion_tokens": int(n)
        if (n := os.getenv("OPENAI_API_MAX_COMP_TOKENS"))
        else None,
        "temperature": float(os.getenv("OPENAI_API_TEMPERATURE", 1)),
    }

    client = AsyncOpenAI(**client_param)
    chat_completion = await client.chat.completions.create(**chat_param)
    return chat_completion.choices[0].message.content
