from . import *
import json
import httpx
from fastapi import HTTPException

pulse_model = os.getenv('PULSE_MODEL')
pulse_token = os.getenv('PULSE_TOKEN')
pulse_url = os.getenv('PULSE_URL')
max_tokens = int(os.getenv('PULSE_MAX_TOKENS', 2048))
retry_count = int(os.getenv('PULSE_RETRY_COUNT', 5))
repetition_penalty = float(os.getenv('PULSE_REPETITION_PENALTY', 1))
temperature = float(os.getenv('PULSE_TEMPERATURE', 0.7))
top_p = float(os.getenv('PULSE_TOP_P', 0.1))
top_k = int(os.getenv('PULSE_TOP_K', 10))

def llm_client(is_async=False):
    if is_async:
        return async_completion
    else:
        return completion

def completion(text):
    payload = json.dumps({
        "action": "To user",
        "parent_messages": [
            {
                "action": "From user",
                "content": text
            }
        ],
        "gen_kwargs": {
            "model": pulse_model,
            "num_return_sequences": 1,
        }
    })
    headers = {
        'accept': 'application/json',
        'Authorization': f'Bearer {pulse_token}',
        'Content-Type': 'application/json'
    }

    response = requests.request("POST", pulse_url, headers=headers, data=payload, verify=False)
    if response.status_code != 200:
        raise Exception(f"Failed to generate completion: {response.text}")

    return response.json()['messages'][0]['content']['parts'][0]

async def async_completion(text):
    messages = [
        {
            'action': 'From user', # 'To user'
            'content': text,
        }
    ]

    async with llm_sem:
        input_data = {
            "action": "To user",
            "parent_messages": messages,
            "gen_kwargs": {
                "model": pulse_model,
                "num_return_sequences": 1,
                "temperature": temperature,
                "top_p": top_p,
                "top_k": top_k,
                "max_tokens": max_tokens,
                "repetition_penalty": repetition_penalty,
            }
        }

        return await _get_completion(
            input_data=input_data,
            retry=retry_count
        )

async def _get_completion(input_data: dict, retry: int = 5):
    try:
        async with httpx.AsyncClient(verify=False) as client:
            async with client.stream(
                "POST",
                pulse_url,
                json=input_data,
                headers={
                    "Authorization": f"Bearer {pulse_token}",
                },
                timeout=600,
            ) as stream:
                # error
                if stream.status_code != 200:
                    error_detail = ""
                    try:
                        error_detail = (await stream.aread()).decode("utf8")
                        error_detail = str(json.loads(error_detail))
                    except:
                        pass

                    raise HTTPException(status_code=500, detail=error_detail)

                content = (await stream.aread()).decode("utf8")
                content = json.loads(content)
                content = "".join(content['messages'][0]['content']['parts'])
                return content
    except Exception as e:
        # logger.error(json.dumps({
        #     "retry": retry,
        #     "input": input_data,
        #     "error": traceback.format_exc()
        # }, ensure_ascii=False, indent=4))
        # 重试次数到达极限
        if retry == 0: raise e

        return await _get_completion(
            input_data=input_data,
            retry=retry-1,
        )
