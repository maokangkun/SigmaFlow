import asyncio
import traceback
import pandas as pd
from typing import Any
from asyncio import Queue
from copy import deepcopy
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from .constant import PData
from ..log import log


def load_runnable_pipe(pipeline_manager, name):
    # 单例 pipe 被运行期注入过线程/队列闭包回调(如 TaskWorker 的推送 partial)
    # 后 deepcopy 会挂: 回退 live pipe 并清掉全部残留回调 —— async_run 自带
    # reset, 每个请求自带 fresh queue, 单例跑法在这里是安全的。
    pipe = pipeline_manager.pipes[name]
    try:
        return deepcopy(pipe)
    except Exception:
        log.warning(
            f"deepcopy of pipe '{name}' failed after runtime callbacks were "
            "injected; falling back to the live pipe (callbacks cleared)"
        )
        pipe.remove_node_callbacks()
        return pipe


def set_pipe_thinking(pipe, enabled):
    # 走遍节点的 llm(多为 CONFIG 共享实例, 按身份去重), 一个不漏地同步开关。
    seen = set()
    for n in pipe.pipegraph.node_manager.values():
        llm = getattr(getattr(n, "pipe", None), "llm", None)
        if llm is None or id(llm) in seen:
            continue
        seen.add(id(llm))
        if hasattr(llm, "set_thinking"):
            llm.set_thinking(enabled)


def post_progress(result):
    if type(result) is list:
        return [post_progress(r) for r in result]
    elif type(result) is dict:
        for k in result:
            if isinstance(result[k], pd.DataFrame):
                result[k] = result[k].to_dict(orient="records")
    return result


class PipelineAPI:
    def __init__(self, pipeline_manager):
        self.router = router = APIRouter(prefix="/api")
        prompt_manager = pipeline_manager.prompt_manager

        @router.get("/list/{item}")
        async def list_item(item: str):
            try:
                match item:
                    case "prompt":
                        ret = {
                            k: {"text": v.text, "keys": v.keys}
                            for k, v in prompt_manager.prompts.items()
                        }
                    case "pipeline":
                        ret = pipeline_manager.export_pipe_conf()
                    case _:
                        raise HTTPException(status_code=400, detail="Invalid item type")
                return ret
            except Exception:
                raise HTTPException(status_code=500, detail=traceback.format_exc())

        @router.post("/update")
        async def update_item(p_data: PData):
            try:
                match p_data.type:
                    case "prompt":
                        if p_data.text:
                            prompt_manager.prompts[p_data.name].text = p_data.text
                        if p_data.keys:
                            prompt_manager.prompts[p_data.name].keys = p_data.keys

                        ret = {
                            p_data.name: {
                                "text": prompt_manager.prompts[p_data.name].text,
                                "keys": prompt_manager.prompts[p_data.name].keys,
                            }
                        }
                    case "pipe":
                        ret = {
                            "result": pipeline_manager.update_pipe(
                                p_data.name, p_data.data
                            )
                        }
                    case _:
                        raise HTTPException(status_code=400, detail="Invalid item type")

                return ret
            except Exception:
                raise HTTPException(status_code=500, detail=traceback.format_exc())

        @router.get("/mermaid/{pipe_name}")
        async def mermaid(pipe_name: str):
            try:
                pipe = pipeline_manager.pipes[pipe_name]
                ret = {
                    "mermaid": pipe.pipetree.tree2mermaid(),
                }
                return ret
            except Exception:
                raise HTTPException(status_code=500, detail=traceback.format_exc())

        @router.post("/run/{pipe_name}")
        async def run_pipe(pipe_name: str, p_data: PData):
            assert p_data.type == "pipeline"
            try:
                pipe = load_runnable_pipe(pipeline_manager, pipe_name)
                if getattr(p_data, "no_think", None):
                    set_pipe_thinking(pipe, enabled=False)
                if p_data.stream:
                    queue: Queue[Any] = Queue()
                    msg_func = lambda out: asyncio.create_task(queue.put(out))  # noqa: E731
                    # LLM 增量帧: {"node", "stream": {"type": think|content, "delta"}}。
                    # finish 帧(节点完成)保持原结构 "out"/"execution_time"。
                    stream_func = lambda node, kind, delta: queue.put_nowait(  # noqa: E731
                        {"node": node, "stream": {"type": kind, "delta": delta}}
                    )
                    pipe.add_node_callback(
                        finish_cb=[msg_func], stream_cb=[stream_func]
                    )

                    async def run_pipe():
                        result = await pipe.async_run(p_data.data)
                        await queue.put({"result": result})
                        await queue.put(None)

                    async def event_stream():
                        asyncio.create_task(run_pipe())
                        while True:
                            msg = await queue.get()
                            if msg is None:
                                break
                            yield str(msg) + "\n"

                    return StreamingResponse(
                        event_stream(), media_type="application/json"
                    )
                else:
                    result = await pipe.async_run(p_data.data)
                    result = post_progress(result)
                    return {"result": result}
            except Exception:
                raise HTTPException(status_code=500, detail=traceback.format_exc())
