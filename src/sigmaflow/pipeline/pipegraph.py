import copy
import queue
import asyncio
import traceback
import collections
import multiprocessing as mp
from ..log import log
from .graph import Graph


class PipeGraph(Graph):
    async def async_run(self, inp_data):
        self.reset()
        if err := self.check_inp(inp_data):
            return err
        data = copy.deepcopy(inp_data)
        dynamic_tasks = []
        queue = collections.defaultdict(asyncio.Queue)
        for k, v in data.items():
            queue[k].put_nowait(v)
        try:
            await asyncio.gather(
                *[
                    asyncio.create_task(n.run(data, queue, dynamic_tasks))
                    for n in self.start_nodes
                ]
            )
            while not all(t.done() for t in dynamic_tasks):
                await asyncio.gather(*dynamic_tasks)
        except Exception:
            error_msg = traceback.format_exc()
            data["error_msg"] = error_msg
            log.error(f"[{self.name}]:\n{error_msg}")
        return data

    def mp_task(self, pid, data, task_queue, perf_queue):
        name = f"pid: {pid}"
        lock = self.mp_lock
        log.debug(f"{name}, start")

        try:
            while True:
                try:
                    node_name, config = task_queue.get_nowait()
                    if node_name == "exit":
                        # if task_queue.qsize() == 0:
                        task_queue.put(("exit", None))
                        log.debug(f"{name}, exit")
                        break
                except queue.Empty:
                    continue

                self.node_manager[node_name].run(
                    name, data, task_queue, perf_queue, config
                )
        except Exception:
            error_msg = traceback.format_exc()
            with lock:
                data["error_msg"] = error_msg
            log.error(f"[{name}]:\n{error_msg}")
            task_queue.put(("exit", {}))
            log.debug(f"{name}, exit")

    def mp_run(self, inp_data, core_num=4):
        self.reset()
        if err := self.check_inp(inp_data):
            return err
        task_queue = self.mp_manager.Queue()
        perf_queue = self.mp_manager.Queue()
        data = self.mp_manager.dict()
        for n in self.start_nodes:
            task_queue.put((n.name, None))
        for k, v in inp_data.items():
            data[k] = v

        processes = []
        for i in range(core_num):
            p = mp.Process(target=self.mp_task, args=(i, data, task_queue, perf_queue))
            processes.append(p)
            p.start()
        for p in processes:
            p.join()
        while not perf_queue.empty():
            self.perf.append(perf_queue.get())

        data = dict(data)
        self.node_manager["exit"].reformat(data)
        return data

    def seq_run(self, inp_data):
        self.reset()
        if err := self.check_inp(inp_data):
            return err
        data = copy.deepcopy(inp_data)

        try:
            queue = self.start_nodes[:]
            while queue:
                node = queue.pop(0)
                node.run(data, queue)
        except Exception:
            error_msg = traceback.format_exc()
            data["error_msg"] = error_msg
            log.error(f"[{self.name}]:\n{error_msg}")
        return data

    # async def server_run(self, inp_data):
    #     self.reset()
    #     self.check_inp(inp_data)
    #     data = copy.deepcopy(inp_data)

    #     queue = self.start_nodes[:]
    #     while queue:
    #         node = queue.pop(0)
    #         pre_data = copy.deepcopy(data)
    #         node.run(data, queue)

    #         arr = []
    #         for k in data:
    #             if k not in pre_data or data[k] != pre_data[k]:
    #                 arr.append(k)
    #         if arr:
    #             yield {node.name: {k: data[k] for k in arr}}

    #         await asyncio.sleep(0)
