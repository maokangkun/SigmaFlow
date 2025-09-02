from . import *
spec = importlib.util.find_spec('lmdeploy')

if spec:
    from lmdeploy import pipeline, GenerationConfig, TurbomindEngineConfig, ChatTemplateConfig

    model_path = os.getenv('LMDEPLOY_MODEL')
    chat_temp_name = os.getenv('LMDEPLOY_CHAT_TEMP', None)
    session_len = int(os.getenv('LMDEPLOY_SESSION_LEN', 256))
    max_new_tokens = int(os.getenv('LMDEPLOY_MAX_NEW_TOKENS', 256))
    batch_size = int(os.getenv('LMDEPLOY_BATCH_SIZE', 128))
    pp = int(os.getenv('LMDEPLOY_PP', 1))
    tp = int(os.getenv('LMDEPLOY_TP', 1))
    dp = int(os.getenv('LMDEPLOY_DP', 1))

    backend_config = TurbomindEngineConfig(
                        session_len=session_len,
                        pp=pp,
                        tp=tp,
                        dp=dp)
    gen_config = GenerationConfig(
                        do_sample=True,
                        # top_p=0.95,
                        # temperature=0.7,
                        max_new_tokens=max_new_tokens)
    chat_temp = ChatTemplateConfig(model_name=chat_temp_name) if chat_temp_name else None
    llm = pipeline(model_path, backend_config=backend_config, chat_template_config=chat_temp)

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
    prompts = []
    for text, _ in batch_data:
        if (t := type(text)) is str:
            prompts.append(text)
        elif t is list:
            msg = []
            for role, c in zip(['user', 'assistant']*len(text), text):
                msg.append({
                    "role": role,
                    "content": c,
                })
            prompts.append(msg)

    outputs = llm(prompts, gen_config=gen_config)
    result = [o.text for o in outputs]
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