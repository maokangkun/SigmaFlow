from . import *
import torch
from transformers import pipeline

model_path = os.getenv('MODEL_PATH')
max_new_tokens = int(os.getenv('MAX_TOKENS', 256))

pipe = pipeline(
    "text-generation", 
    model=model_path, 
    torch_dtype=torch.bfloat16, 
    device_map="auto"
)

def llm_client(is_async=False):
    if is_async:
        return async_completion
    else:
        return completion

def completion(text):
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

    resp = pipe(
        msg,
        do_sample=True,
        max_new_tokens=max_new_tokens,
        pad_token_id=pipe.tokenizer.eos_token_id
    )

    return resp[0]["generated_text"][-1]['content']

async def async_completion(text):
    async with llm_sem:
        resp = completion(text)

    return resp
