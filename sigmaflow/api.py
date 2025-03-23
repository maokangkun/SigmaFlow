import os
from fastapi import APIRouter
from pydantic import BaseModel
from fastapi import HTTPException
from . import PromptManager, PipelineManager

class PromptData(BaseModel):
    name:   str | None = None
    text:   str | None = None
    keys:  list | None = None

class PipeData(BaseModel):
    name:   str | None = None
    data:  dict | None = None

class PipelineAPI:
    def __init__(self, prompt_dir, pipeline_dir, llm_client=None, rag_client=None, is_async=False):
        router = APIRouter(prefix='/api')
        prompt_manager = PromptManager(prompt_dir)
        pipeline_manager = PipelineManager(llm_client, rag_client, is_async, pipeline_dir, prompt_manager)

        @router.get("/prompt/list")
        async def prompt_list():
            try:
                ret = {k: {'text': v.text, 'keys': v.keys} for k,v in prompt_manager.prompts.items()}
                return ret

            except Exception as e:
                raise HTTPException(status_code=500, detail=str(e))

        @router.post("/prompt/update")
        async def prompt_update(p_data: PromptData):
            try:
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
                return ret

            except Exception as e:
                raise HTTPException(status_code=500, detail=str(e))


        @router.get("/pipeline/list")
        async def pipeline_list():
            try:
                ret = pipeline_manager.export_pipe_conf()
                return ret

            except Exception as e:
                raise HTTPException(status_code=500, detail=str(e))

        @router.post("/pipeline/mermaid")
        async def pipeline_mermaid(p_data: PipeData):
            try:
                pipeline = pipeline_manager.pipes[p_data.name]['func']
                mermaid = pipeline.pipe2mermaid(pipeline.pipe)
                ret = {
                    'mermaid': mermaid,
                }
                return ret

            except Exception as e:
                raise HTTPException(status_code=500, detail=str(e))

        @router.post("/pipeline/update")
        async def pipeline_update(p_data: PipeData):
            try:
                ret = {
                    'result': pipeline_manager.update_pipe(p_data.name, p_data.data)
                }
                return ret

            except Exception as e:
                raise HTTPException(status_code=500, detail=str(e))

        self.router = router
        self.prompt_manager = prompt_manager
        self.pipeline_manager = pipeline_manager
