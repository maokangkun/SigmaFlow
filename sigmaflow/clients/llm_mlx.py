import os
from mlx_lm import load, generate
from . import *

model, tokenizer = load(os.getenv('MLX_MODEL'))
max_tokens = int(os.getenv('MLX_MAX_TOKENS', 256))

def llm_client(is_async=False):
    if is_async:
        return async_completion
    else:
        return completion

def completion(text):
    messages = [{"role": "user", "content": text}]
    prompt = tokenizer.apply_chat_template(
        messages, tokenize=False, add_generation_prompt=True
    )
    text = generate(model, tokenizer, prompt=prompt, verbose=False, max_tokens=max_tokens)

    return text

async def async_completion(text):
    return completion(text)
