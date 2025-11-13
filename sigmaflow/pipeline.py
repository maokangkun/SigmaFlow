import os
import tqdm
import time
import json
import uuid
import asyncio
import datetime
import collections
import pandas as pd
from tqdm.asyncio import tqdm_asyncio
from .log import log, log_dir
from .pipetree import PipeTree
from .utils import *

class Pipeline:
    def __init__(self, llm_backend, rag_backend, prompt_manager, pipeconf=None, pipefile=None, run_mode='async', llm_batch_processor=None):
        self.llm_backend = llm_backend
        self.llm_batch_processor = llm_batch_processor
        self.rag_backend = rag_backend
        self.run_mode = run_mode
        self.pipefile = pipefile
        self.name = f'pipeline-{datetime.datetime.now().strftime("%m/%d/%Y_%H:%M:%S")}'
        self.hash = ''
        if pipeconf or pipefile:
            self.pipetree = PipeTree(llm_backend, rag_backend, prompt_manager, pipeconf=pipeconf, pipefile=pipefile, run_mode=run_mode)
            self.name = self.pipetree.name
            if pipefile: self.hash = calc_sha256(pipefile)

    def gen_info(self, data, start_t, save_perf=False):
        pipe_manager = self.pipetree.pipe_manager

        info = {
            'perf': self.pipetree.perf,
            'exec_path': [n[1] for n in self.pipetree.perf],
            'detail': {},
            'total_time': time.time()-start_t,
            'mermaid': {},
        }

        for k in sorted(pipe_manager, key=lambda k: pipe_manager[k].time or -1):
            info['detail'][k] = {
                # 'run_time': list(pipe_manager[k].run_time),
                'avg_time': pipe_manager[k].time,
            }

        if save_perf and 'error_msg' not in data:
            info['mermaid']['pipe'] = self.pipetree.tree2mermaid(info)
            info['mermaid']['perf'] = self.pipetree.perf2mermaid()
            fname = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
            if check_cmd_exist('mmdc'):
                pipe_img = str(log_dir / f'{fname}_pipe.png')
                tmp_file = f'/tmp/{uuid.uuid4()}'
                with open(tmp_file, 'w') as f: f.write(info["mermaid"]["pipe"])
                log.debug(f'Save pipeline mermaid in: {tmp_file}')
                os.popen(f'mmdc -i {tmp_file} -o {pipe_img} -s 3 >/dev/null 2>&1')
                log.debug(f'save {pipe_img}')
                perf_img = str(log_dir / f"{fname}_perf.png")
                os.popen(f'echo "{info["mermaid"]["perf"]}" | mmdc -i - -o {perf_img} -s 3 >/dev/null 2>&1')
                log.debug(f'save {perf_img}')
                # md_pipe = f"![pipe_img]({pipe_img.split('/')[1]})"
                # md_perf = f"![perf_img]({perf_img.split('/')[1]})"
            else:
                log.warning('Please install mmdc to generate mermaid images.')
            md_pipe = f"```mermaid\n{info['mermaid']['pipe']}```"
            md_perf = f"```mermaid\n{info['mermaid']['perf']}```"

            r_str = f'```json\n{json.dumps(data, indent=4, ensure_ascii=False)}\n```'
            md_content = f'## result\n{r_str}\n## Pipeline\n{md_pipe}\n## Perfermence\n{md_perf}'
            md_file = f'logs/{fname}_report.md'
            with open(md_file, 'w') as f: f.write(md_content)

        log.debug(f'pipe detail:\n{json.dumps(info, indent=4, ensure_ascii=False)}')
        info['logs'] = []
        for k in pipe_manager:
            info['logs'] += pipe_manager[k].inout_log
        
        return info

    def _run(self, data, save_perf=False, core_num=4):
        start_t = time.time()
        match self.run_mode:
            case 'async':
                log.debug(f"Run '{self.name}' pipeline in coroutine")
                async def f():
                    if self.llm_batch_processor:
                        asyncio.create_task(self.llm_batch_processor())
                    return await self.pipetree.async_run(data)
                result = asyncio.run(f())
            case 'mp':
                log.debug(f"Run '{self.name}' pipeline in multiprocess")
                result = self.pipetree.mp_run(data, core_num)
            case _:
                log.debug(f"Run '{self.name}' pipeline in sequential")
                result = self.pipetree.normal_run(data)
        for k in result:
            if isinstance(result[k], pd.DataFrame):
                result[k] = result[k].to_dict(orient='records')
        log.debug(f'final out:\n{json.dumps(result, indent=4, ensure_ascii=False)}')
        info = self.gen_info(result, start_t, save_perf)
        return result, info

    def run(self, data, save_perf=False, core_num=4, split=None):
        if (t := type(data)) is dict:
            return self._run(data, save_perf, core_num)
        elif t is list:
            if self.run_mode == 'async':
                async def f():
                    if self.llm_batch_processor:
                        asyncio.create_task(self.llm_batch_processor())

                    results = []
                    if split is None:
                        tasks = []
                        for d in data:
                            task = asyncio.create_task(self.pipetree.async_run(d))
                            tasks.append(task)
                        results = await tqdm_asyncio.gather(*tasks)
                    else:
                        parts = len(data) // split + 1
                        for i in tqdm.trange(parts):
                            tasks = []
                            for d in data[i*split:(i+1)*split]:
                                task = asyncio.create_task(self.pipetree.async_run(d))
                                tasks.append(task)
                            results += await asyncio.gather(*tasks)
                    return results

                results = asyncio.run(f())
                return [(r, None) for r in results]
            else:
                all_result = [self._run(d, save_perf, core_num) for d in tqdm.tqdm(data)]
            return all_result

    async def async_run(self, data, save_perf=False, split=None):
        if self.llm_batch_processor:
            asyncio.create_task(self.llm_batch_processor())

        if (t := type(data)) is dict:
            return await self.pipetree.async_run(data)
        elif t is list:
            results = []
            if split is None:
                tasks = []
                for d in data:
                    task = asyncio.create_task(self.pipetree.async_run(d))
                    tasks.append(task)
                results = await tqdm_asyncio.gather(*tasks)
            else:
                parts = len(data) // split + 1
                for i in tqdm.trange(parts):
                    tasks = []
                    for d in data[i*split:(i+1)*split]:
                        task = asyncio.create_task(self.pipetree.async_run(d))
                        tasks.append(task)
                    results += await asyncio.gather(*tasks)
            return results

    async def replay(self, node_name, data_arr):
        node = self.pipetree.node_manager[node_name]
        pipe = self.pipetree.pipe_manager.get(node_name, None)

        tasks = []
        for data in data_arr:
            task = asyncio.create_task(node.replay(data))
            tasks.append(task)
        await asyncio.gather(*tasks)

        ret = []
        for data in data_arr:
            d = {}
            for o in node.mermaid_outs:
                d[o] = data[o]
            ret.append(d)
        return ret, len(pipe.run_time) if pipe else node.run_cnt

    def to_png(self, pipe_img):
        if check_cmd_exist('mmdc'):
            pipe_mermaid = self.pipetree.tree2mermaid()
            tmp_file = f'/tmp/{uuid.uuid4()}'
            with open(tmp_file, 'w') as f: f.write(pipe_mermaid)
            log.debug(f'Save pipeline mermaid in: {tmp_file}')
            os.popen(f'mmdc -i {tmp_file} -o {pipe_img} -s 3 >/dev/null 2>&1')
            log.debug(f'save {pipe_img}')
        else:
            log.warning('Please install mmdc to generate mermaid images.')

    def add_node_finish_callback(self, callbacks, nodes=None):
        if nodes is None: nodes = self.pipetree.node_manager.values()
        elif type(nodes) is list and type(nodes[0]) is str:
            nodes = [self.pipetree.node_manager[n] for n in nodes]

        for n in nodes: n.add_finish_callback(callbacks)

    def __str__(self):
        return f"<{self.__class__.__name__}: {self.name}, mode: {self.run_mode}, file: {self.pipefile}, hash: {self.hash[-8:]}>"

    def __repr__(self):
        return self.__str__()