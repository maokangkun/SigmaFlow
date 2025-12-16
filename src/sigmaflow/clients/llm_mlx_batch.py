import os, sys
sys.path.append('/Users/mkk/workspace/git_repos/mlx_parallm')
from mlx_parallm.utils import load, batch_generate
from . import *

model, tokenizer = load(os.getenv('MLX_MODEL'))
max_tokens = int(os.getenv('MLX_MAX_TOKENS', 256))
batch_size = int(os.getenv('MLX_BATCH_SIZE', 128))

batch_wait_time = 1
batch_queue = []
batch_event = asyncio.Event()

def llm_client(is_async=False):
    if is_async:
        return async_completion
    else:
        return completion

def completion(text):
    raise NotImplementedError

def batch_completion(batch_data):
    print(f"Processed batch, len: {len(batch_data)}")
    prompts = [text for text,_ in batch_data]
    result = batch_generate(model, tokenizer, prompts=prompts, verbose=True, format_prompts=True, max_tokens=max_tokens, temp=0.7)
    return result

async def llm_batch_processor():
    global batch_queue
    while True:
        await batch_event.wait()
        print("Batch processor triggered.")

        if batch_queue:
            batch = batch_queue[:batch_size]
            batch_queue = batch_queue[len(batch):]
            result = await asyncio.to_thread(batch_completion, batch)

            for (_, future), res in zip(batch, result):
                future.set_result(res)

        if not batch_queue:
            print("Batch queue is empty. Resetting event.")
            batch_event.clear()

async def async_completion(text):
    global batch_queue

    loop = asyncio.get_event_loop()
    future = loop.create_future()
    batch_queue.append((text, future))
    print("Task added to batch queue.")

    if len(batch_queue) >= batch_size:
        print("Batch size reached. Triggering batch processing.")
        batch_event.set()
    else:
        print(f"Task waiting for batch timeout or size threshold.")
        await asyncio.sleep(batch_wait_time)
        batch_event.set()

    return await future