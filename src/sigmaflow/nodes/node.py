import time
import asyncio
import collections
from ..log import log
from .base import Base
from .constant import DataState


class Node(Base):
    def add_finish_callback(self, callback):
        if type(callback) is list:
            self.finish_callbacks += callback
        else:
            self.finish_callbacks.append(callback)
        self.finish_callbacks = list(set(self.finish_callbacks))

    def execute_finish_callback(self, out):
        data = {
            "node": self.name,
            "out": out,
        }
        for callback in self.finish_callbacks:
            callback(data)

    def get_inps_mp(self, data, config=None):
        def get_data(i):
            if i not in data:
                return DataState.VOID
            if type(data[i]) is list:
                if config and i in config["loop_index"]:
                    loop_i = config["loop_index"][i]
                    return data[i][loop_i]
                elif DataState.VOID in data[i]:
                    return DataState.VOID
            return data[i]

        if "inp" not in self.conf:
            return data
        inps = []
        for i in self.conf["inp"]:
            if type(i) is str:
                if (d := get_data(i)) is DataState.VOID:
                    return []
                else:
                    inps.append(d)
            elif type(i) is dict:
                t = {}
                for k, v in i.items():
                    if (d := get_data(v)) is DataState.VOID:
                        return []
                    else:
                        t[k] = d
                inps.append(t)
        return inps

    def current_mp_task(self, inps, data, queue, config=None):
        pass

    def mp_run(self, mp_name, data, queue, perf, config=None):
        if inps := self.get_inps_mp(data, config):
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
        for i in self.conf.get("inp", []):
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
                with self.graph.mp_lock:
                    i = config["loop_index"][k]
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
                    if "_sub" in q:
                        arr += q["_sub"]

        o = self.conf["out"]
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
                for k in o:
                    set_data(o[k], None, config, queue)

    def reset_out(self, queue):
        def q_del(q, k):
            if k in q:
                while not q[k].empty():
                    q[k].get_nowait()
            if "_sub" in q:
                for sub_q in q["_sub"]:
                    q_del(sub_q, k)

        o = self.conf["out"]
        if (t := type(o)) is str:
            q_del(queue, o)
        elif t is list:
            for k in o:
                q_del(queue, k)
        elif t is dict:
            for k in o:
                q_del(queue, o[k])

    async def add_task(self, data, queue, dynamic_tasks):
        for n in self.next:
            task = asyncio.create_task(n.run(data, queue, dynamic_tasks), name=n.name)
            dynamic_tasks.append(task)

    async def current_task(self, data, queue, dynamic_tasks):
        pass

    async def async_run(self, data, queue, dynamic_tasks):
        start_time = time.time()
        self.run_cnt += 1
        if self.max_cnt is not None and self.run_cnt > self.max_cnt:
            log.banner(
                f"Async task: {self.name} hit max_cnt ({self.max_cnt}) limit, exit!"
            )
        else:
            cnt = self.run_cnt
            log.banner(f"Enter async task: {self.name}, cnt: {cnt}")
            if self.reset_out_flag:
                self.reset_out(queue)
            await self.add_task(data, queue, dynamic_tasks)
            await self.current_task(data, queue, dynamic_tasks)
            log.banner(f"Leave async task: {self.name}, cnt: {cnt}")
            self.graph.perf.append(("coroutine", self.name, start_time, time.time()))

    async def replay(self, data):
        self.run_cnt += 1
        cnt = self.run_cnt
        log.banner(f"Enter async task: {self.name}, cnt: {cnt}")
        queue = collections.defaultdict(asyncio.Queue)
        for k, v in data.items():
            queue[k].put_nowait(v)
        await self.current_task(data, queue, [])
        log.banner(f"Leave async task: {self.name}, cnt: {cnt}")

    def get_inps_seq(self, data):
        if "inp" not in self.conf:
            return data
        inps = []
        for i in self.conf["inp"]:
            if type(i) is str:
                if i not in data:
                    return []
                else:
                    inps.append(data[i])
            elif type(i) is dict:
                t = {}
                for k, v in i.items():
                    if v not in data:
                        return []
                    else:
                        t[k] = data[v]
                inps.append(t)
        return inps

    def current_seq_task(self, inps, data, queue):
        pass

    def seq_run(self, data, queue):
        if inps := self.get_inps_seq(data):
            start_time = time.time()
            self.run_cnt += 1
            log.banner(f"Enter task: {self.name}, cnt: {self.run_cnt}")
            self.current_seq_task(inps, data, queue)
            log.banner(f"Leave task: {self.name}, cnt: {self.run_cnt}")
            self.graph.perf.append(("seq", self.name, start_time, time.time()))
        else:
            queue.append(self)

    @property
    def run(self):
        match self.graph.run_mode:
            case "async":
                return self.async_run
            case "mp":
                return self.mp_run
            case _:
                return self.seq_run
