from openai import OpenAI
from openai import AsyncOpenAI
from . import *

def llm_client(is_async=False):
    if is_async:
        return async_completion
    else:
        return completion

def completion(text):
    client = OpenAI(
        api_key=os.getenv("OPENAI_API_KEY"),
        base_url=os.getenv("OPENAI_API_URL"),
        max_retries=20,
        # timeout=6000.0,
    )

    chat_completion = client.chat.completions.create(
        messages=[
            {
                "role": "user",
                "content": text,
            }
        ],
        model=os.getenv("OPENAI_API_MODEL")
    )

    return chat_completion.choices[0].message.content

async def async_completion(text):
    client = AsyncOpenAI(
        api_key=os.getenv("OPENAI_API_KEY"),
        base_url=os.getenv("OPENAI_API_URL"),
        max_retries=20,
        # timeout=6000.0,
    )
    if (t := type(text)) is str:
        msg = [
            {
                "role": "user",
                "content": text,
            }
        ]
    elif t is list:
        msg = []
        for role, c in zip(['user', 'assistant']*len(text), text):
            msg.append({
                "role": role,
                "content": c,
            })

    async with llm_sem:
        chat_completion = await client.chat.completions.create(
            messages=msg,
            model=os.getenv("OPENAI_API_MODEL")
        )

    return chat_completion.choices[0].message.content
