from . import *
spec = importlib.util.find_spec('vllm')

if spec:
    from vllm import LLM, SamplingParams

    model_path = os.getenv('VLLM_MODEL')
    max_model_len = int(os.getenv('VLLM_MAX_MODEL_LEN', 256))
    max_tokens = int(os.getenv('VLLM_MAX_TOKENS', 256))
    batch_size = int(os.getenv('VLLM_BATCH_SIZE', 128))
    pp = int(os.getenv('VLLM_PP', 1))
    tp = int(os.getenv('VLLM_TP', 1))

    llm = LLM(model=model_path,
            gpu_memory_utilization=.95,
            max_model_len=max_model_len,
            pipeline_parallel_size=pp,
            tensor_parallel_size=tp)
    sampling_params = SamplingParams(temperature=0.7,
                                    max_tokens=max_tokens,
                                    min_p=0.15,
                                    top_p=0.85)

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
    prompts = [text for text,_ in batch_data]
    outputs = llm.generate(prompts, sampling_params)
    result = [o.outputs[0].text for o in outputs]
    return result

async def llm_batch_processor():
    global batch_queue
    while True:
        await batch_event.wait()

        if batch_queue:
            batch = batch_queue[:batch_size]
            batch_queue = batch_queue[len(batch):]
            result = await asyncio.to_thread(batch_completion, batch)

            for (_, future), res in zip(batch, result):
                future.set_result(res)

        if not batch_queue:
            batch_event.clear()

async def async_completion(text):
    global batch_queue

    loop = asyncio.get_event_loop()
    future = loop.create_future()
    batch_queue.append((text, future))

    if len(batch_queue) >= batch_size:
        batch_event.set()
    else:
        await asyncio.sleep(batch_wait_time)
        batch_event.set()

    return await future