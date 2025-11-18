import asyncio
import traceback
import pandas as pd
from copy import deepcopy
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from .constant import *

def post_progress(result):
    if type(result) is list:
        return [post_progress(r) for r in result]
    elif type(result) is dict:
        for k in result:
            if isinstance(result[k], pd.DataFrame):
                result[k] = result[k].to_dict(orient='records')
    return result

class PipelineAPI:
    def __init__(self, pipeline_manager):
        self.router = router = APIRouter(prefix='/api')
        prompt_manager = pipeline_manager.prompt_manager

        @router.get("/list/{item}")
        async def list_item(item: str):
            try:
                match item:
                    case 'prompt':
                        ret = {k: {'text': v.text, 'keys': v.keys} for k,v in prompt_manager.prompts.items()}
                    case 'pipeline':
                        ret = pipeline_manager.export_pipe_conf()
                    case _:
                        raise HTTPException(status_code=400, detail="Invalid item type")
                return ret
            except Exception as e:
                raise HTTPException(status_code=500, detail=traceback.format_exc())

        @router.post("/update/{item}")
        async def update_item(item: str, p_data: PromptData | PipeData):
            try:
                match item:
                    case 'prompt':
                        if p_data.text:
                            prompt_manager.prompts[p_data.name].text = p_data.text
                        if p_data.keys:
                            prompt_manager.prompts[p_data.name].keys = p_data.keys

                        ret = {
                            p_data.name: {
                                'text': prompt_manager.prompts[p_data.name].text,
                                'keys': prompt_manager.prompts[p_data.name].keys
                            }
                        }
                    case 'pipeline':
                        ret = {
                            'result': pipeline_manager.update_pipe(p_data.name, p_data.data)
                        }
                    case _:
                        raise HTTPException(status_code=400, detail="Invalid item type")

                return ret
            except Exception as e:
                raise HTTPException(status_code=500, detail=traceback.format_exc())

        @router.get("/mermaid/{pipe_name}")
        async def mermaid(pipe_name: str):
            try:
                pipe = pipeline_manager.pipes[pipe_name]
                ret = {
                    'mermaid': pipe.pipetree.tree2mermaid(),
                }
                return ret
            except Exception as e:
                raise HTTPException(status_code=500, detail=traceback.format_exc())

        @router.post("/run/{pipe_name}")
        async def run_pipe(pipe_name: str, p_data: PipelineData):
            try:
                pipe = deepcopy(pipeline_manager.pipes[pipe_name])
                if p_data.stream:
                    queue = asyncio.Queue()
                    msg_func = lambda out: asyncio.create_task(queue.put(out))
                    pipe.add_node_finish_callback(callbacks=[msg_func])

                    async def run_pipe():
                        result = await pipe.async_run(p_data.data)
                        await queue.put({'result': result})
                        await queue.put(None)

                    async def event_stream():
                        asyncio.create_task(run_pipe())
                        while True:
                            msg = await queue.get()
                            if msg is None: break
                            yield str(msg)+'\n'

                    return StreamingResponse(event_stream(), media_type="application/json")
                else:
                    result = await pipe.async_run(p_data.data)
                    result = post_progress(result)
                    return {'result': result}
            except Exception as e:
                raise HTTPException(status_code=500, detail=traceback.format_exc())
