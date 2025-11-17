import re
import os
import copy
import time
import queue
import asyncio
import importlib
import traceback
import collections
from enum import Enum
from pathlib import Path
from functools import reduce
import multiprocessing as mp
from .log import log
from .prompt import Prompt
from .pipe import *

class DataState(Enum):
    VOID = 0

class Color:
    Black = 'black'
    White = 'white'
    Gray = '#ECE4E2'
    Pink = '#FE929F'
    RED = '#D64747'
    LightPink = '#FAB6BF'
    Khaki = '#CC8A4D'
    DarkBlue = '#445760'
    LightGreen = '#EAFFD0'
    Green = '#9BCFB8'
    LightYellow = '#FFFFAD'
    Black2 = '#3D3E3F'

class NodeColorStyle:
    default = f'color:{Color.Black}'
    LLMNode = f'fill:{Color.Gray},color:{Color.Black}'
    RAGNode = f'fill:{Color.Pink},color:{Color.Black}'
    LoopNode = f'fill:none,stroke:{Color.Khaki},stroke-dasharray:5 5,stroke-width:2px'
    BranchNode = f'fill:{Color.DarkBlue},color:{Color.White}'
    CodeNode = f'fill:{Color.LightYellow},color:{Color.Black}'
    WebNode = f'fill:{Color.LightPink},color:{Color.Black}'
    ValueNode = f'fill:{Color.LightGreen},color:{Color.Black}'
    ExitNode = f'fill:{Color.Black2},color:{Color.White}'
    FileNode = f'fill:{Color.Khaki},color:{Color.Black}'
    Data = f'fill:{Color.Green},color:{Color.Black}'
    InputData = f'fill:{Color.RED},color:{Color.Black}'

class NodeShape:
    default = lambda x: f'{x}["{x}"]' # 矩形
    LLMNode = lambda x: f'{x}["{x}"]'
    RAGNode = lambda x: f'{x}("{x}")' # 圆角矩形
    LoopNode = lambda x: f'{x}(("{x}"))' # 圆形
    BranchNode = lambda x: f'{x}{{"{x}"}}'
    CodeNode = lambda x: f'{x}[/"{x}"/]'
    WebNode = lambda x: f'{x}("{x}")'
    ValueNode = lambda n, x: f'{n}{{{{"{x}"}}}}'
    ExitNode = lambda x: f'{x}[["{x}"]]'
    FileNode = lambda x: f'{x}["{x}"]'
    Data = lambda x: f'{x}(["{x}"])'
    InputData = lambda x: f'{x}(["{x}"])'

class Data:
    mermaid_style = NodeColorStyle.Data
    mermaid_shape = NodeShape.Data

class InputData:
    mermaid_style = NodeColorStyle.InputData
    mermaid_shape = NodeShape.InputData

class Node:
    mermaid_style = NodeColorStyle.default
    mermaid_shape = NodeShape.default
    mermaid_inline = '-->'
    mermaid_outline = '-.->'
    mermaid_toexit = '--o'
    mermaid_inline_passed = '==>'
    mermaid_outline_passed = '==>'
    mermaid_toexit_passed = '==o'

    def __init__(self, name, conf, tree=None):
        self.name = name
        self.conf = conf
        self.tree = tree
        self.run_cnt = 0
        self.max_cnt = self.conf.get('max_cnt', None)
        self.in_loop = None
        self.next = []
        self.loop_nodes = []
        self.finish_callbacks = []
        self.reset_out_flag = 'reset_out' in self.conf
        if self.reset_out_flag:
            self.conf['out'] = self.conf['reset_out']
            del self.conf['reset_out']
        if 'inp' in self.conf and type(self.conf['inp']) is str:
            self.conf['inp'] = [self.conf['inp']]
        self.set_mermaid()
        self.post_init()

    def add_finish_callback(self, callback):
        if type(callback) is list:
            self.finish_callbacks += callback
        else:
            self.finish_callbacks.append(callback)
        self.finish_callbacks = list(set(self.finish_callbacks))

    def execute_finish_callback(self, out):
        data = {
            'node': self.name,
            'out': out,
        }
        for callback in self.finish_callbacks: callback(data)

    def set_mermaid(self):
        self.mermaid_inps = []
        if 'inp' in self.conf:
            for i in self.conf['inp']:
                if (t := type(i)) is str:
                    self.mermaid_inps.append(i)
                elif t is dict:
                    self.mermaid_inps += list(i.values())

        outs = []
        if (o := self.conf.get('out', None)):
            if (t := type(o)) is str:
                outs = [o]
            elif t is list:
                outs = o[:]
            elif t is dict:
                outs = list(o.values())
        self.mermaid_outs = outs
        self.mermaid_data = self.mermaid_inps + self.mermaid_outs

    def _get_mermaid_defines(self):
        return [self.__class__.mermaid_shape(self.name)] + [Data.mermaid_shape(d) for d in self.mermaid_data]

    def get_mermaid(self, info=None):
        inps = ' & '.join(self.mermaid_inps) or None
        outs = ' & '.join(self.mermaid_outs) or None

        defines = self._get_mermaid_defines()

        t = info["detail"][self.name]["avg_time"] if info and self.name in info['detail'] else None
        if t is not None: t = f'|{t:.2f}s|'

        inline = self.mermaid_inline_passed if self.run_cnt else self.mermaid_inline
        outline = self.mermaid_outline_passed if self.run_cnt else self.mermaid_outline
        inout_link = (inps, inline, self.name, outline, t, outs, None)

        links = [inout_link]
        for n in self.next:
            if n.name == 'exit':
                t = f'|total: {info["total_time"]:.2f}s|' if info and self.name in info['exec_path'] else None
                links.append((None, None, outs, self.mermaid_toexit_passed if t else self.mermaid_toexit, t, 'exit', None))

        subg = []

        return defines, links, subg

    def update(self, nodes):
        for name in self.conf.get('next', []):
            if name in nodes: self.next.append(nodes[name])

    def post_init(self):
        pass

    def reset(self):
        self.run_cnt = 0

    def get_inps_mp(self, data, config=None):
        def get_data(i):
            if i not in data: return DataState.VOID
            if type(data[i]) is list:
                if config and i in config['loop_index']:
                    loop_i = config['loop_index'][i]
                    return data[i][loop_i]
                elif DataState.VOID in data[i]:
                    return DataState.VOID
            return data[i]

        inps = []
        for i in self.conf['inp']:
            if type(i) is str:
                if (d := get_data(i)) is DataState.VOID: return []
                else: inps.append(d)
            elif type(i) is dict:
                t = {}
                for k, v in i.items():
                    if (d := get_data(v)) is DataState.VOID: return []
                    else: t[k] = d
                inps.append(t)
        return inps

    def current_mp_task(self, inps, data, queue, config=None):
        if self.__class__.__name__ in ['LLMNode', 'RAGNode']:
            out = self.pipe(*inps)
            self.set_out(out, data, config=config)
            self.execute_finish_callback(out)

        for n in self.next: queue.put((n.name, config))

    def mp_run(self, mp_name, data, queue, perf, config=None):
        if (inps := self.get_inps_mp(data, config)):
            start_time = time.time()
            self.run_cnt += 1
            cnt = self.run_cnt
            log.banner(f"Enter mp task: {self.name}, cnt: {cnt}, {mp_name}")
            self.current_mp_task(inps, data, queue, config)
            log.banner(f"Leave mp task: {self.name}, cnt: {cnt}, {mp_name}")
            perf.put((mp_name, self.name, start_time, time.time()))
        else:
            queue.put((self.name, config))

    async def get_inps(self, queue):
        inps = []
        for i in self.conf['inp']:
            if type(i) is str:
                d = await queue[i].get()
                inps.append(d)
                queue[i].put_nowait(d)
            elif type(i) is dict:
                t = {}
                for k, v in i.items():
                    d = await queue[v].get()
                    t[k] = d
                    queue[v].put_nowait(d)
                inps.append(t)
        return inps

    def set_out(self, out, data, queue=None, config=None):
        def set_data(k, v, config, queue):
            if config:
                with self.tree.mp_lock:
                    i = config['loop_index'][k]
                    pre = data[k]
                    pre[i] = v
                    data[k] = pre
            else:
                data[k] = v

            if queue:
                arr = [queue]
                while arr:
                    q = arr.pop(0)
                    q[k].put_nowait(v)
                    if '_sub' in q: arr += q['_sub']

        o = self.conf['out']
        if (t := type(o)) is str:
            set_data(o, out, config, queue)
        elif t is list:
            for k in o:
                set_data(k, out[k], config, queue)
        elif t is dict:
            if out is not None and type(out) is dict:
                for k in o:
                    set_data(o[k], out.get(k, None), config, queue)
            else:
                for k in o: set_data(o[k], None, config, queue)

    def reset_out(self, queue):
        def q_del(q, k):
            if k in q:
                while not q[k].empty(): q[k].get_nowait()
            if '_sub' in q:
                for sub_q in q['_sub']: q_del(sub_q, k)

        o = self.conf['out']
        if (t := type(o)) is str:
            q_del(queue, o)
        elif t is list:
            for k in o: q_del(queue, k)
        elif t is dict:
            for k in o: q_del(queue, o[k])

    async def add_task(self, data, queue, dynamic_tasks):
        for n in self.next:
            task = asyncio.create_task(n.run(data, queue, dynamic_tasks), name=n.name)
            dynamic_tasks.append(task)

    async def current_task(self, data, queue, dynamic_tasks):
        if self.__class__.__name__ in ['LLMNode', 'RAGNode']:
            inps = await self.get_inps(queue)
            out = await self.pipe.async_call(*inps)
            self.set_out(out, data, queue)
            self.execute_finish_callback(out)

    async def async_run(self, data, queue, dynamic_tasks):
        start_time = time.time()
        self.run_cnt += 1
        if self.max_cnt is not None and self.run_cnt > self.max_cnt:
            log.banner(f"Async task: {self.name} hit max_cnt ({self.max_cnt}) limit, exit!")
        else:
            cnt = self.run_cnt
            log.banner(f"Enter async task: {self.name}, cnt: {cnt}")
            if self.reset_out_flag: self.reset_out(queue)
            await self.add_task(data, queue, dynamic_tasks)
            await self.current_task(data, queue, dynamic_tasks)
            log.banner(f"Leave async task: {self.name}, cnt: {cnt}")
            self.tree.perf.append(('coroutine', self.name, start_time, time.time()))

    async def replay(self, data):
        self.run_cnt += 1
        cnt = self.run_cnt
        log.banner(f"Enter async task: {self.name}, cnt: {cnt}")
        queue = collections.defaultdict(asyncio.Queue)
        for k, v in data.items(): queue[k].put_nowait(v)
        await self.current_task(data, queue, [])
        log.banner(f"Leave async task: {self.name}, cnt: {cnt}")

    def get_inps_normal(self, data):
        if 'inp' not in self.conf: return data
        inps = []
        for i in self.conf['inp']:
            if type(i) is str:
                if i not in data: return []
                else: inps.append(data[i])
            elif type(i) is dict:
                t = {}
                for k, v in i.items():
                    if v not in data: return []
                    else: t[k] = data[v]
                inps.append(t)
        return inps

    def current_normal_task(self, inps, data, queue):
        if self.__class__.__name__ in ['LLMNode', 'RAGNode']:
            out = self.pipe(*inps)
            self.set_out(out, data)
            self.execute_finish_callback(out)

        for n in self.next: queue.append(n)

    def normal_run(self, data, queue):
        if (inps := self.get_inps_normal(data)):
            start_time = time.time()
            self.run_cnt += 1
            log.banner(f"Enter normal task: {self.name}, cnt: {self.run_cnt}")
            self.current_normal_task(inps, data, queue)
            log.banner(f"Leave normal task: {self.name}, cnt: {self.run_cnt}")
            self.tree.perf.append(('normal', self.name, start_time, time.time()))
        else:
            queue.append(self)

    @property
    def run(self):
        match self.tree.run_mode:
            case 'async':
                return self.async_run
            case 'mp':
                return self.mp_run
            case _:
                return self.normal_run

    def export_as_comfyui(self):
        return {}

    def __str__(self):
        return f"<{self.__class__.__name__}: {self.name}, next: {[n.name for n in self.next]}>"

    def __repr__(self):
        return self.__str__()

class LLMNode(Node):
    mermaid_style = NodeColorStyle.LLMNode
    mermaid_shape = NodeShape.LLMNode

    def post_init(self):
        tree = self.tree
        if type(self.conf['prompt']) is not Prompt:
            self.conf['prompt'] = tree.prompt_manager.get(self.conf['prompt'])
        
        if self.conf.get('backend', None):
            backend = self.conf['backend']
        elif (constructor := self.conf.get('backend_construct', None)):
            backend = constructor(tree.run_mode)
        else:
            backend = tree.llm_backend

        if tree.run_mode == 'mp':
            pipe = LLMPipe(
                    self.name,
                    llm=backend,
                    lock=tree.mp_lock,
                    run_time=tree.mp_manager.list(),
                    inout_log=tree.mp_manager.list(),
                    **self.conf
                    )
        else:
            pipe = LLMPipe(self.name, llm=backend, **self.conf)
        tree.pipe_manager[self.name] = pipe
        self.pipe = pipe

    def export_as_comfyui(self):
        inps = {i:["TEXT"] for i in self.pipe.prompt.keys}
        opt_inps = {"模型": ["MODEL"]}
        prompt = {
            "prompt": [
                "STRING",
                {"default": self.pipe.prompt.text, "multiline": True, "dynamicPrompts": True}
            ]
        }
        outs = self.mermaid_outs
        d = {
            "input": {
                "required": inps | prompt,
                "optional": opt_inps
            },
            "input_order": {"required": self.pipe.prompt.keys},
            "output": ["TEXT"] * len(outs),
            "output_is_list": [False] * len(outs),
            "output_name": outs,
            "name": self.name,
            "display_name": self.name,
            "description": f"{self.name} prompt",
            "python_module": "nodes",
            "category": "提示词",
            "output_node": False,
        }
        return {self.name: d}

class RAGNode(Node):
    mermaid_style = NodeColorStyle.RAGNode
    mermaid_shape = NodeShape.RAGNode

    def post_init(self):
        tree = self.tree
        if self.conf.get('backend', None):
            backend = self.conf['backend']
        elif (constructor := self.conf.get('backend_construct', None)):
            backend = constructor(tree.run_mode)
        else:
            backend = tree.rag_backend

        if (param := self.conf.get('rag_param', None)):
            rag_backend = lambda *x: backend(*x, **dict(param))
        else:
            rag_backend = backend

        if tree.run_mode == 'mp':
            pipe = RAGPipe(
                    self.name,
                    rag=rag_backend,
                    lock=tree.mp_lock,
                    run_time=tree.mp_manager.list(),
                    inout_log=tree.mp_manager.list(),
                    **self.conf
                    )
        else:
            pipe = RAGPipe(self.name, rag=rag_backend, **self.conf)

        tree.pipe_manager[self.name] = pipe
        self.pipe = pipe

    def export_as_comfyui(self):
        param = self.conf.get('rag_param', {})
        inps = {
            "text": ["TEXT"],
            "kb": ["STRING", {
                "default": param.get('kb_id', None),
                "multiline": False,
                "dynamicPrompts": True
            }],
            "top_k": ["INT", {
                "default": param.get('top_k', 1),
                "min": 1
            }],
            "threshold": ["FLOAT", {
                "default": param.get('threshold', 0.5),
                "min": 0.01,
                "max": 1.0,
                "step": 0.1
            }]
        }
        opt_inps = {}
        outs = self.mermaid_outs
        d = {
            "input": {
                "required": inps,
                "optional": opt_inps
            },
            "input_order": {"required": list(inps.keys())},
            "output": ["TEXT"] * len(outs),
            "output_is_list": [False] * len(outs),
            "output_name": outs,
            "name": self.name,
            "display_name": self.name,
            "description": f"{self.name} rag search",
            "python_module": "nodes",
            "category": "知识库",
            "output_node": False,
        }
        return {self.name: d}

class LoopNode(Node):
    mermaid_style = NodeColorStyle.LoopNode
    mermaid_shape = NodeShape.LoopNode

    def update(self, nodes):
        super().update(nodes)

        self.loop_nodes = []
        for name in self.conf['pipe_in_loop']:
            if name in nodes: self.loop_nodes.append(nodes[name])

        # inp = self.conf['inp'][0]
        # for n in self.loop_nodes:
        #     if inp in n.mermaid_inps:
        #         n.mermaid_inps[n.mermaid_inps.index(inp)] = self.name

    def get_mermaid(self, info=None):
        links = []
        inp = self.conf['inp'][0]
        links.append((None, None, inp, self.mermaid_inline, None, self.name, NodeColorStyle.LoopNode))

        defines = []
        subg = [(self.name, *self.conf['pipe_in_loop'])]

        return defines, links, subg

    def get_loop_outs(self):
        outs = []
        for n in self.loop_nodes:
            outs += n.mermaid_outs
        return outs

    async def current_task(self, data, queue, dynamic_tasks):
        inps = await self.get_inps(queue)
        inp = inps[0]
        n = len(inp)
        inp_name = self.conf['inp'][0]

        loop_tasks = []
        loop_data = []
        sub = []
        loop_outs = self.get_loop_outs()
        for item in inp:
            new_data = {}
            loop_data.append(new_data)

            new_queue = collections.defaultdict(asyncio.Queue)
            for k in queue:
                if k == inp_name:
                    new_queue[k].put_nowait(item)
                elif k not in loop_outs:
                    new_queue[k] = queue[k]
            sub.append(new_queue)

            for n in self.loop_nodes:
                task = asyncio.create_task(n.run(new_data, new_queue, loop_tasks))
                loop_tasks.append(task)

        queue['_sub'] = sub

        while not all(t.done() for t in loop_tasks):
            await asyncio.gather(*loop_tasks)

        del queue['_sub']
        for d in loop_data:
            for k, v in d.items():
                if k in data: data[k].append(v)
                else: data[k] = [v]
        for k in loop_data[0]: queue[k].put_nowait(data[k])

    def current_mp_task(self, inps, data, queue, config=None):
        N = len(inps[0])
        loop_outs = self.get_loop_outs()
        for k in loop_outs: data[k] = [DataState.VOID] * N
        for i in range(N):
            new_config = {} if config is None else copy.deepcopy(config)
            if 'loop_index' not in new_config: new_config['loop_index'] = {}
            new_config['loop_index'] |= {k:i for k in self.conf['inp']+loop_outs}
            for node in self.loop_nodes: queue.put((node.name, new_config))

        for node in self.next: queue.put((node.name, config))

    def current_normal_task(self, inps, data, queue):
        keys = list(data.keys())
        for item in inps[0]:
            tmp_d = copy.deepcopy(data)
            tmp_d[self.conf['inp'][0]] = item
            tmp_q = self.loop_nodes[:]
            while tmp_q:
                n = tmp_q.pop(0)
                n.run(tmp_d, tmp_q)

            for k in tmp_d:
                if k not in keys:
                    if k in data:
                        data[k].append(tmp_d[k])
                    else:
                        data[k] = [tmp_d[k]]

        for n in self.next: queue.append(n)

class BranchNode(Node):
    mermaid_style = NodeColorStyle.BranchNode
    mermaid_shape = NodeShape.BranchNode

    def post_init(self):
        self.passed_cond = set()
        if 'use_llm' not in self.conf: self.conf['use_llm'] = False
        if self.conf['use_llm']:
            tree = self.tree
            self.conf['prompt'] = tree.prompt_manager.prompts['branch_node_prompt']
            self.conf['return_json'] = True
            self.conf['format'] = {'item_id': str}

            if self.conf.get('backend', None):
                backend = self.conf['backend']
            elif (constructor := self.conf.get('backend_construct', None)):
                backend = constructor(tree.run_mode)
            else:
                backend = tree.llm_backend

            if tree.run_mode == 'mp':
                pipe = LLMPipe(
                        self.name,
                        llm=backend,
                        lock=tree.mp_lock,
                        run_time=tree.mp_manager.list(),
                        inout_log=tree.mp_manager.list(),
                        **self.conf
                        )
            else:
                pipe = LLMPipe(self.name, llm=backend, **self.conf)
            tree.pipe_manager[self.name] = pipe
            self.pipe = pipe

    def update(self, nodes):
        self.next = {}
        for cond, item in self.conf['next'].items():
            if (t := type(item)) is str:
                if item in nodes: self.next[cond] = [nodes[item]]
            elif t is list:
                self.next[cond] = []
                for name in item:
                    if name in nodes: self.next[cond].append(nodes[name])

    def get_mermaid(self, info=None):
        inps = ' & '.join(self.mermaid_inps)

        defines = self._get_mermaid_defines()

        t = info["detail"][self.name]["avg_time"] if info and self.name in info['detail'] else None
        if t is not None: t = f'|{t:.2f}s|'
        inline = self.mermaid_inline_passed if self.run_cnt else self.mermaid_inline
        inout_link = (None, None, inps, inline, t, self.name, None)

        links = [inout_link]
        for cond, arr in self.next.items():
            nexts = [n.name for n in arr]
            if 'exit' in nexts:
                t = f'|{cond}, total: {info["total_time"]:.2f}s|' if info else f'|{cond}|'
                links.append((None, None, self.name, self.mermaid_toexit_passed if t else self.mermaid_toexit, t, 'exit', None))
                nexts.remove('exit')

            if nexts:
                outline = self.mermaid_outline_passed if cond in self.passed_cond else self.mermaid_outline
                links.append((None, None, self.name, outline, f'|{cond}|', " & ".join(nexts), None))

        subg = []

        return defines, links, subg

    async def add_task(self, data, queue, dynamic_tasks):
        inps = await self.get_inps(queue)
        if self.conf['use_llm']:
            items = list(self.conf['next'].keys())
            items_text = '\n'.join([f'[#{i+1}] {t}' for i, t in enumerate(items)])

            retry = 0
            while retry < 5:
                if len(inps) == 1:
                    cond = await self.pipe.async_call(inps[0], items_text)
                else:
                    inps_t = '\n'.join(f'{k}: {v}' for k,v in zip(self.conf['inp'], inps))
                    cond = await self.pipe.async_call(inps_t, items_text)

                if cond and type(cond) is dict:
                    item_id = cond.get('item_id', '')
                    if len(item_id) > 1 and item_id[0] == '#' and item_id[1:].isdigit() and (i := int(item_id[1:]) - 1) < len(items):
                        cond = items[i]
                        break
                    elif len(item_id) and item_id.isdigit() and (i := int(item_id) - 1) < len(items):
                        cond = items[i]
                        break
                retry += 1
        elif 'code' in self.conf:
            if 'code_entry' in self.conf:
                local = {}
                exec(self.conf['code'], local)
                cond = local[self.conf['code_entry']](*inps)
            else:
                inps_dict = {k:v for k,v in zip(self.conf['inp'], inps)}
                cond = eval(self.conf['code'].format(**inps_dict))
        else:
            cond = inps[0]

        if type(cond) is dict: cond = str(cond)
        self.passed_cond.add(cond)
        if (nodes := self.next.get(cond, None)):
            for node in nodes:
                task = asyncio.create_task(node.run(data, queue, dynamic_tasks), name=node.name)
                dynamic_tasks.append(task)
            
            if self.run_cnt > 1:
                def q_del(q, k):
                    if k in q:
                        while not q[k].empty(): q[k].get_nowait()
                    if '_sub' in q:
                        for sub_q in q['_sub']: q_del(sub_q, k)

                sub_nodes = set()
                tmp = nodes[:]
                while tmp:
                    n = tmp.pop()
                    sub_nodes.add(n)
                    for nxt in n.next:
                        if nxt not in sub_nodes and type(nxt) is not BranchNode:
                            tmp.append(nxt)
              
                outs = set()
                for n in sub_nodes: outs.update(n.mermaid_outs)
                outs -= set(self.conf['inp'])
                for o in outs: q_del(queue, o)
                log.debug(f'[{self.name}] reset variables: {outs}')
        log.debug(f'[{self.name}] condition: {cond}, goto nodes: {nodes}')

    def current_mp_task(self, inps, data, queue, config=None):
        if self.conf['use_llm']:
            items = list(self.conf['next'].keys())
            items_text = '\n'.join([f'[#{i+1}] {t}' for i, t in enumerate(items)])

            retry = 0
            while retry < 5:
                if len(inps) == 1:
                    cond = self.pipe(inps[0], items_text)
                else:
                    inps_t = '\n'.join(f'{k}: {v}' for k,v in zip(self.conf['inp'], inps))
                    cond = self.pipe(inps_t, items_text)

                if cond and type(cond) is dict:
                    item_id = cond.get('item_id', '')
                    if len(item_id) > 1 and item_id[0] == '#' and item_id[1:].isdigit() and (i := int(item_id[1:]) - 1) < len(items):
                        cond = items[i]
                        break
                    elif len(item_id) and item_id.isdigit() and (i := int(item_id) - 1) < len(items):
                        cond = items[i]
                        break
                retry += 1
        elif 'code' in self.conf:
            if 'code_entry' in self.conf:
                local = {}
                exec(self.conf['code'], local)
                cond = local[self.conf['code_entry']](*inps)
            else:
                inps_dict = {k:v for k,v in zip(self.conf['inp'], inps)}
                cond = eval(self.conf['code'].format(**inps_dict))
        else:
            cond = inps[0]

        if type(cond) is dict: cond = str(cond)
        self.passed_cond.add(cond)
        if (nodes := self.next.get(cond, None)):
            for node in nodes: queue.put((node.name, config))
        log.debug(f'[{self.name}] condition: {cond}, goto nodes: {nodes}')

    def current_normal_task(self, inps, data, queue):
        if self.conf['use_llm']:
            items = list(self.conf['next'].keys())
            items_text = '\n'.join([f'[#{i+1}] {t}' for i, t in enumerate(items)])

            retry = 0
            while retry < 5:
                if len(inps) == 1:
                    cond = self.pipe(inps[0], items_text)
                else:
                    inps_t = '\n'.join(f'{k}: {v}' for k,v in zip(self.conf['inp'], inps))
                    cond = self.pipe(inps_t, items_text)

                if cond and type(cond) is dict:
                    item_id = cond.get('item_id', '')
                    if len(item_id) > 1 and item_id[0] == '#' and item_id[1:].isdigit() and (i := int(item_id[1:]) - 1) < len(items):
                        cond = items[i]
                        break
                    elif len(item_id) and item_id.isdigit() and (i := int(item_id) - 1) < len(items):
                        cond = items[i]
                        break
                retry += 1
        elif 'code' in self.conf:
            if 'code_entry' in self.conf:
                local = {}
                exec(self.conf['code'], local)
                cond = local[self.conf['code_entry']](*inps)
            else:
                inps_dict = {k:v for k,v in zip(self.conf['inp'], inps)}
                cond = eval(self.conf['code'].format(**inps_dict))
        else:
            cond = inps[0]

        if type(cond) is dict: cond = str(cond)
        self.passed_cond.add(cond)
        if (nodes := self.next.get(cond, None)): queue += nodes
        log.debug(f'[{self.name}] condition: {cond}, goto nodes: {nodes}')

    def export_as_comfyui(self):
        inps = {
            "text": ["TEXT"],
            "use_llm": ["BOOLEAN", {"default": self.conf.get('use_llm', False)}],
        }
        opt_inps = {}
        outs = list(self.conf['next'].keys())
        d = {
            "input": {
                "required": inps,
                "optional": opt_inps
            },
            "input_order": {"required": list(inps.keys())},
            "output": ["TEXT"] * len(outs),
            "output_is_list": [False] * len(outs),
            "output_name": outs,
            "name": self.name,
            "display_name": self.name,
            "description": f"{self.name} 分支流程",
            "python_module": "nodes",
            "category": "控制流",
            "output_node": False,
        }
        return {self.name: d}

    def __str__(self):
        if type(self.next) is dict:
            arr = [f'{cond} -> {[n.name for n in nodes]}' for cond, nodes in self.next.items()]
        else:
            arr = self.next
        return f"<{self.__class__.__name__}: {self.name}, next: {arr}>"

class CodeNode(Node):
    mermaid_style = NodeColorStyle.CodeNode
    mermaid_shape = NodeShape.CodeNode

    def _eval_format(self, item):
        if type(item) is str:
            return item.encode('unicode_escape').decode('utf-8')
        else:
            return item

    async def current_task(self, data, queue, dynamic_tasks):
        inps = await self.get_inps(queue)
        if 'code_entry' in self.conf:
            local = {}
            exec(self.conf['code'], local) # PEP 667
            out = local[self.conf['code_entry']](*inps)
        elif 'code_func' in self.conf:
            out = self.conf['code_func'](*inps)
        else:
            inps_dict = {k:self._eval_format(v) for k,v in zip(self.conf['inp'], inps)}
            out = eval(self.conf['code'].format(**inps_dict))
        self.set_out(out, data, queue)
        log.debug(f'{self.conf["out"]}: {out}')
        self.execute_finish_callback(out)

    def current_mp_task(self, inps, data, queue, config=None):
        if 'code_entry' in self.conf:
            local = {}
            exec(self.conf['code'], local)
            out = local[self.conf['code_entry']](*inps)
        elif 'code_func' in self.conf:
            out = self.conf['code_func'](*inps)
        else:
            inps_dict = {k:self._eval_format(v) for k,v in zip(self.conf['inp'], inps)}
            out = eval(self.conf['code'].format(**inps_dict))
        self.set_out(out, data, config=config)
        log.debug(f'{self.conf["out"]}: {out}')
        self.execute_finish_callback(out)
        for n in self.next: queue.put((n.name, config))
    
    def current_normal_task(self, inps, data, queue):
        if 'code_entry' in self.conf:
            local = {}
            exec(self.conf['code'], local)
            out = local[self.conf['code_entry']](*inps)
        elif 'code_func' in self.conf:
            out = self.conf['code_func'](*inps)
        else:
            inps_dict = {k:self._eval_format(v) for k,v in zip(self.conf['inp'], inps)}
            out = eval(self.conf['code'].format(**inps_dict))
        self.set_out(out, data)
        log.debug(f'{self.conf["out"]}: {out}')
        self.execute_finish_callback(out)

class WebNode(Node):
    mermaid_style = NodeColorStyle.WebNode
    mermaid_shape = NodeShape.WebNode

    def post_init(self):
        tree = self.tree
        search_pipe = None
        if tree.is_async:
            if 'search_engine' in self.conf['web']:
                search_pipe = SearchPipe(self.name, **self.conf['web'])
            browser_pipe = BrowserPipe(self.name)
        else:
            if 'search_engine' in self.conf['web']:
                search_pipe = SearchPipe(
                        self.name,
                        lock=tree.mp_lock,
                        run_time=tree.mp_manager.list(),
                        inout_log=tree.mp_manager.list(),
                        **self.conf
                        )
            browser_pipe = BrowserPipe(self.name)

        tree.pipe_manager[self.name] = {'search': search_pipe, 'browser': browser_pipe}
        self.search_pipe = search_pipe
        self.browser_pipe = browser_pipe

    def current_mp_task(self, inps, data, queue, config=None):
        out = self.search_pipe(*inps)
        self.set_out(out, data, config=config)

        for n in self.next: queue.put((n.name, config))

    async def current_task(self, data, queue, dynamic_tasks):
        inps = await self.get_inps(queue)
        out = await self.search_pipe.async_call(*inps)

        browser_tasks = []
        for url in self.loop_nodes:
            task = asyncio.create_task(n.run(new_data, new_queue, loop_tasks))
            browser_tasks.append(task)
        while not all(t.done() for t in browser_tasks):
            await asyncio.gather(*browser_tasks)

        self.set_out(out, data, queue)

class BrowserNode(Node):
    ...

class ValueNode(Node):
    mermaid_style = NodeColorStyle.ValueNode
    mermaid_shape = NodeShape.ValueNode

    def _get_mermaid_defines(self):
        data_defs = [Data.mermaid_shape(d) for d in self.mermaid_data]
        n = 25
        if 'value' in self.conf:
            t = str(self.conf['value'])
        elif 'item' in self.conf:
            t = self.conf['item']
        if len(t) > n: t = t[:n] + '...'
        m = {'append': '\\+', 'assign': '='}[self.conf.get('mode', 'assign')]
        d = f'{self.name}\n{m} {t}'
        return [self.__class__.mermaid_shape(self.name, d)] + data_defs

    def get_inps_mp(self, data, config=None):
        def get_data(i):
            if i not in data: return DataState.VOID
            if type(data[i]) is list:
                if config and i in config['loop_index']:
                    loop_i = config['loop_index'][i]
                    return data[i][loop_i]
                elif DataState.VOID in data[i]:
                    return DataState.VOID
            return data[i]

        mode = self.conf.get('mode', 'assign')
        if mode == 'append':
            if (d := get_data(self.conf['out'])) is DataState.VOID: return []
            else: return [d]
        else:
            return [1]

    def current_mp_task(self, inps, data, queue, config=None):
        mode = self.conf.get('mode', 'assign')
        if mode == 'append':
            out = inps[0]
            out.append(self.conf['value'])
        else:
            out = self.conf['value']
        self.set_out(out, data, config=config)
        log.debug(f'{mode = }, {self.conf["out"]}: {out}')
        self.execute_finish_callback(out)
        for n in self.next: queue.put((n.name, config))

    async def current_task(self, data, queue, dynamic_tasks):
        mode = self.conf.get('mode', 'assign')
        if 'value' in self.conf:
            v = self.conf['value']
        elif 'item' in self.conf:
            if 'inp' in self.conf: await self.get_inps(queue)
            if '->' in self.conf['item']:
                k1, k2 = self.conf['item'].split('->')
                v = data[data[k1][k2]]
            else:
                v = data[self.conf['item']]

        if mode == 'append':
            i = self.conf['out']
            out = await queue[i].get()
            out.append(v)
        else:
            out = v
        self.set_out(out, data, queue)
        log.debug(f'{mode = }, {self.conf["out"]}: {out}')
        self.execute_finish_callback(out)

    def current_normal_task(self, inps, data, queue):
        mode = self.conf.get('mode', 'assign')
        if 'value' in self.conf:
            v = self.conf['value']
        elif 'item' in self.conf:
            if '->' in self.conf['item']:
                k1, k2 = self.conf['item'].split('->')
                v = data[data[k1][k2]]
            else:
                v = data[self.conf['item']]

        if mode == 'append':
            i = self.conf['out']
            out = data[i]
            out.append(v)
        else:
            out = v
        self.set_out(out, data)
        log.debug(f'{mode = }, {self.conf["out"]}: {out}')
        self.execute_finish_callback(out)

class DatabaseNode(Node):
    def aa(self):
        ...

class ExitNode(Node):
    mermaid_style = NodeColorStyle.ExitNode
    mermaid_shape = NodeShape.ExitNode

    def get_mermaid(self, info=None):
        defines = [self.__class__.mermaid_shape(self.name)]
        return defines, [], []

    async def current_task(self, data, queue, dynamic_tasks):
        if self.conf:
            while not all(t.done() for t in dynamic_tasks if t.get_name() != 'exit'):
                await asyncio.sleep(0.1)

            self.reformat(data)

    def reformat(self, data):
        if self.conf and 'error_msg' not in data:
            ret = {}
            for k, v in self.conf.items():
                if type(v) is str:
                    d = data
                    for i in v.split('.'):
                        if i in d: d = d[i]
                        else: break
                    else:
                        ret[k] = d
                elif type(v) is list and type(v[0]) is dict:
                    d = []
                    for i in range(len(data[list(v[0].values())[0]])):
                        t = {}
                        for m, n in v[0].items():
                            if n in data:
                                t[m] = data[n][i]
                        if t: d.append(t)
                    if d: ret[k] = d

            for k in list(data.keys()): del data[k]
            for k in ret: data[k] = ret[k]

class FileNode(Node):
    mermaid_style = NodeColorStyle.FileNode
    mermaid_shape = NodeShape.FileNode

    def current_normal_task(self, inps, data, queue):
        info = self.conf.get('file_dir', None) or self.conf.get('file', None)
        if 'file' in self.conf:
            if (t := type(self.conf['file'])) is str:
                files = [Path(self.conf['file'])]
            elif t is list:
                files = [Path(f) for f in self.conf['file']]
        elif 'file_dir' in self.conf:
            files = [f for f in Path(self.conf['file_dir']).iterdir() if f.is_file()]

        import pymupdf4llm
        md = []
        for file in files:
            if file.suffix == '.pdf':
                md_text = pymupdf4llm.to_markdown(file)
                md.append(md_text)
            else:
                with open(file, 'r') as f:
                    md.append(f.read())

        if 'file' in self.conf and t is str: md = md[0]

        self.set_out(md, data)
        log.debug(f'[{self.name}] read: {info} -> {self.conf["out"]}')


class PipeTree:
    def __init__(self, llm_backend, rag_backend, prompt_manager, name=None, pipeconf:dict=None, pipefile=None, run_mode='async'):
        self.name = name
        self.pipeconf = pipeconf
        self.pipefile = pipefile
        self.llm_backend = llm_backend
        self.rag_backend = rag_backend
        self.run_mode = run_mode
        self.is_async = run_mode=='async'
        self.perf = []
        if pipeconf is None and pipefile is not None: self.load(pipefile)

        self.start_nodes = []
        self.required_inputs = []
        self.exit_node = None
        self.prompt_manager = prompt_manager
        self.pipe_manager = {}
        self.node_manager = {}
        self.node_type = collections.defaultdict(set)
        if run_mode == 'mp':
            self.mp_manager = mp.Manager()
            self.mp_lock = self.mp_manager.Lock()

        self._init()
        self._check()

    def load(self, pipefile):
        if type(pipefile) is str: pipefile = Path(pipefile)
        m = importlib.import_module(pipefile.stem)
        self.pipeconf = m.pipeline
        if self.name is None: self.name = pipefile.stem.removesuffix(os.getenv('PIPELINE_SUFFIX', '_pipeline'))

    def _check(self):
        node_names = set(self.node_manager.keys())
        data = set()
        for n in self.node_manager.values(): data.update(n.mermaid_data)
        if (conflict_names := node_names & data):
            log.error(f'conflict between the pipe name and the data name, which will cause errors when drawing mermaid flowchart: {conflict_names}')
            exit()

    def _find_start_nodes(self):
        conf = self.pipeconf
        deps = set(['exit'])
        for p in conf:
            if (nt := conf[p].get('next', None)):
                if type(nt) is dict:
                    arr = []
                    for v in nt.values():
                        if type(v) is str: arr.append(v)
                        elif type(v) is list: arr += v
                    deps.update(arr)
                elif type(nt) is list:
                    deps.update(nt)
            deps.update(conf[p].get('pipe_in_loop', []))

        self.start_nodes = [self.node_manager[i] for i in list(set(conf.keys()) - deps)]

    def _init(self):
        if 'exit' not in self.pipeconf: self.pipeconf['exit'] = {}
        for name, conf in self.pipeconf.items():
            if name == 'exit':
                self.exit_node = node = ExitNode(name, conf, self)
            elif 'rag_param' in conf:
                node = RAGNode(name, conf, self)
            elif 'pipe_in_loop' in conf:
                node = LoopNode(name, conf, self)
            elif 'use_llm' in conf or type(conf.get('next', None)) is dict:
                node = BranchNode(name, conf, self)
            elif 'code' in conf or 'code_func' in conf:
                node = CodeNode(name, conf, self)
            elif 'web' in conf:
                node = WebNode(name, conf, self)
            elif 'value' in conf or 'item' in conf:
                node = ValueNode(name, conf, self)
            elif 'prompt' in conf:
                node = LLMNode(name, conf, self)
            elif 'file' in conf or 'file_dir' in conf:
                node = FileNode(name, conf, self)
            else:
                log.error(f"Unable to identify node type: [{name}] {conf}")
                exit()
            self.node_manager[name] = node

        all_outs = set()
        for n in self.node_manager.values():
            n.update(self.node_manager)
            self.node_type[n.__class__].add(n.name)
            self.node_type[Data].update(n.mermaid_data)
            all_outs.update(n.mermaid_outs)

        self.required_inputs = self.node_type[Data] - all_outs
        self.node_type[InputData] = self.required_inputs

        self._find_start_nodes()
        if not self.start_nodes:
            log.error(f"Can't find start entry in pipes.")
            exit()
        log.debug(f"'{self.name}' tree initialization successful, start nodes: {self.start_nodes}, required input: {self.required_inputs}")

    def export_conf(self):
        conf = copy.deepcopy(self.pipeconf)
        for pipe_conf in conf.values():
            if 'format' in pipe_conf:
                for k, v in pipe_conf['format'].items():
                    pipe_conf['format'][k] = str(v)
        return conf

    def reset(self):
        self.perf = []
        for node in self.node_manager.values(): node.reset()

    def tree2mermaid(self, info=None):
        mermaid = 'graph TD'
        indent = ' '*4
        defines = set()
        links = set()
        subgraphs = set()
        passed_nodes = set()
        nodes = self.start_nodes[:]
        while nodes:
            n = nodes.pop(0)
            passed_nodes.add(n)
            defs, lks, subg = n.get_mermaid(info)
            defines.update(defs)
            links.update(lks)
            subgraphs.update(subg)
            for i in n.loop_nodes + (n.next if type(n.next) is list else reduce(lambda a,b:a+b, n.next.values())):
                if i not in passed_nodes: nodes.append(i)

        links_d = {}
        for link in links:
            item = (link[0], link[2], link[5])
            if item in links_d:
                if link[4]: links_d[item] = link
            else:
                links_d[item] = link
        links_str = []
        links_style = []

        for inps, inline, self.name, outline, t, outs, link_style in links_d.values():
            if t is None: t = ''
            if inps:
                link = f'{inps} {inline} {self.name} {outline}{t} {outs}'
            else:
                link = f'{self.name} {outline}{t} {outs}'
            if link_style is not None:
                links_style.insert(0, link_style)
                links_str.insert(0, link)
            else:
                links_str.append(link)

        mermaid += f'\n{indent}%% ========================'
        mermaid += f'\n{indent}%% Nodes definition section'
        mermaid += f'\n{indent}%% ========================\n'
        for i in defines: mermaid += f'{indent}{i}\n'

        mermaid += f'\n{indent}%% ========================'
        mermaid += f'\n{indent}%% Links definition section'
        mermaid += f'\n{indent}%% ========================\n'
        for i in links_str: mermaid += f'{indent}{i}\n'

        mermaid += f'\n{indent}%% ================'
        mermaid += f'\n{indent}%% Subgraph section'
        mermaid += f'\n{indent}%% ================\n'
        for i in subgraphs:
            sub_items = "\n".join([indent*2+j for j in i[1:]])
            mermaid += f'{indent}subgraph {i[0]}\n{sub_items}\n{indent}end\n'

        mermaid += f'\n{indent}%% ========================'
        mermaid += f'\n{indent}%% Style definition section'
        mermaid += f'\n{indent}%% ========================\n'
        for c, items in self.node_type.items():
            name = c.__name__.upper()
            mermaid += f'{indent}classDef {name} {c.mermaid_style}\n'
            if items: mermaid += f'{indent}class {",".join(items)} {name}\n'
        for i, style in enumerate(links_style):
            mermaid += f'{indent}linkStyle {i} {style}\n'

        return mermaid

    def perf2mermaid(self):
        mermaid = 'gantt\ntitle Task Timeline\ndateFormat  x\naxisFormat  %M:%S.%L\n'
        base_time = self.perf[0][2]
        data = collections.defaultdict(list)
        loop_end = {}
        for name, e, start_time, end_time in self.perf:
            if 'pid' in name:
                arr = name.split(': ')
                n = f'{arr[0]}_{int(arr[1]):0>2d}'
            else:
                n = name
            s = (start_time - base_time) * 1000
            Δ = (end_time - start_time) * 1000
            data[n].append((e, s, Δ))
            # if e in pipe:
            #     if pipe[e]['mode'] == 'loop':
            #         loop_end[f'{e}_end'] = (n, e, s)
            #     else:
            #         data[n].append((e, s, Δ))
            # elif e in loop_end:
            #     n, e, s_ = loop_end[e]
            #     Δ_ = s + Δ - s_
            #     data[n].append((e, s_, Δ_))
        
        for k in sorted(data.keys()):
            mermaid += f'section {k}\n'
            for e, s, Δ in data[k]:
                # if pipe[e]['mode'] == 'loop':
                #     mermaid += f'{e}: done, {s:.0f}, {Δ:.0f}ms\n'
                # else:
                mermaid += f'{e}: {s:.0f}, {Δ:.0f}ms\n'

        return mermaid

    def check_inp(self, inp):
        if (missing := self.required_inputs - set(inp.keys())):
            error_msg = f'missing input data: {list(missing)}'
            log.error(f'[{self.name}]:\n{error_msg}')
            return {'error_msg': error_msg}

    async def async_run(self, inp_data):
        self.reset()
        if (err := self.check_inp(inp_data)): return err
        data = copy.deepcopy(inp_data)
        dynamic_tasks = []
        queue = collections.defaultdict(asyncio.Queue)
        for k, v in data.items(): queue[k].put_nowait(v)
        try:
            await asyncio.gather(*[asyncio.create_task(n.run(data, queue, dynamic_tasks)) for n in self.start_nodes])
            while not all(t.done() for t in dynamic_tasks):
                await asyncio.gather(*dynamic_tasks)
        except Exception as e:
            error_msg = traceback.format_exc()
            data['error_msg'] = error_msg
            log.error(f'[{self.name}]:\n{error_msg}')
        return data

    def mp_task(self, pid, data, task_queue, perf_queue):
        name = f'pid: {pid}'
        lock = self.mp_lock
        log.debug(f'{name}, start')

        try:
            while True:
                try:
                    node_name, config = task_queue.get_nowait()
                    if node_name == 'exit':
                        # if task_queue.qsize() == 0:
                        task_queue.put(('exit', None))
                        log.debug(f'{name}, exit')
                        break
                except queue.Empty: continue

                self.node_manager[node_name].run(name, data, task_queue, perf_queue, config)
        except Exception as e:
            error_msg = traceback.format_exc()
            with lock: data['error_msg'] = error_msg
            log.error(f'[{name}]:\n{error_msg}')
            task_queue.put(('exit', {}))
            log.debug(f'{name}, exit')

    def mp_run(self, inp_data, core_num=4):
        self.reset()
        if (err := self.check_inp(inp_data)): return err
        task_queue = self.mp_manager.Queue()
        perf_queue = self.mp_manager.Queue()
        data       = self.mp_manager.dict()
        for n in self.start_nodes: task_queue.put((n.name, None))
        for k, v in inp_data.items(): data[k] = v

        processes = []
        for i in range(core_num):
            p = mp.Process(target=self.mp_task, args=(i, data, task_queue, perf_queue))
            processes.append(p)
            p.start()
        for p in processes: p.join()
        while not perf_queue.empty(): self.perf.append(perf_queue.get())

        data = dict(data)
        self.exit_node.reformat(data)
        return data

    def normal_run(self, inp_data):
        self.reset()
        if (err := self.check_inp(inp_data)): return err
        data = copy.deepcopy(inp_data)

        try:
            queue = self.start_nodes[:]
            while queue:
                node = queue.pop(0)
                node.run(data, queue)
        except Exception as e:
            error_msg = traceback.format_exc()
            data['error_msg'] = error_msg
            log.error(f'[{self.name}]:\n{error_msg}')
        return data

    async def server_run(self, inp_data):
        self.reset()
        self.check_inp(inp_data)
        data = copy.deepcopy(inp_data)

        queue = self.start_nodes[:]
        while queue:
            node = queue.pop(0)
            pre_data = copy.deepcopy(data)
            node.run(data, queue)

            arr = []
            for k in data:
                if k not in pre_data or data[k] != pre_data[k]:
                    arr.append(k)
            if arr:
                yield {node.name: {k: data[k] for k in arr}}

            await asyncio.sleep(0)

    def __str__(self):
        loop_num = sum([type(n) is LoopNode for n in self.node_manager.values()])
        branch_num = sum([type(n) is BranchNode for n in self.node_manager.values()])
        return f"<PipeTree '{self.name}': nodes: {len(self.node_manager)}, loop: {loop_num}, branch: {branch_num}, mode: {self.run_mode}>"

    def __repr__(self):
        return self.__str__()
