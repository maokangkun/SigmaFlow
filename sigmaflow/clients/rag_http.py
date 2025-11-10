from . import *
import json
import httpx
import requests
from fastapi import HTTPException

import warnings
from urllib3.exceptions import InsecureRequestWarning
warnings.simplefilter("ignore", InsecureRequestWarning)

def rag_client(is_async=False):
    if is_async:
        return async_rag
    else:
        return rag

def rag(text, url=None, index=None):
    j = {
        'type': index,
        'query': json.dumps([str(text)])
    }

    response = requests.post(url, json=j, verify=False)

    if response.status_code != 200:
        raise Exception(f"Failed to generate completion: {response.text}")
    
    pids = [i['condiate_result'] for i in response.json()[0]['condidate']]
    return pids

async def async_rag(text):
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

        return await _req(input_data, url)

async def _req(input_data: dict, url: str, retry: int = 5):
    try:
        async with httpx.AsyncClient(verify=False) as client:
            async with client.stream(
                "POST",
                url,
                json=input_data,
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
                return content
    except Exception as e:
        if retry == 0: raise e
        return await _req(input_data, url, retry-1,)
