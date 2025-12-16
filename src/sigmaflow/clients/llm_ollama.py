from ollama import Client, AsyncClient
from . import *

ollama_model = os.getenv('OLLAMA_MODEL')
ollama_num_ctx = int(os.getenv('OLLAMA_NUM_CTX', 2048))

def llm_client(is_async=False):
    if is_async:
        return async_completion
    else:
        return completion

def completion(text):
    client = Client(timeout=6000)
    resp = client.chat(model=ollama_model, messages=[
        {
            'role': 'user',
            'content': text,
        },
    ], options={
        "num_ctx": ollama_num_ctx
    })

    return resp.message.content

async def async_completion(text):
    client = AsyncClient(timeout=6000)

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
        resp = await client.chat(
            model=ollama_model,
            messages=msg,
            options={
                "num_ctx": ollama_num_ctx
            }
        )

    return resp.message.content
