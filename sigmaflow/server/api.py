import traceback
from fastapi import APIRouter, HTTPException
from .constant import *

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
        async def run_pipe(pipe_name: str, data: dict | list[dict]):
            try:
                pipe = pipeline_manager.pipes[pipe_name]
                ret = {
                    'result': await pipe.async_run(data)
                }
                return ret
            except Exception as e:
                raise HTTPException(status_code=500, detail=traceback.format_exc())

