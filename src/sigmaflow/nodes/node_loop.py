import copy
import uuid
import asyncio
import collections
from .node import Node
from .constant import NodeColorStyle, DataState


class LoopNode(Node):
    mermaid_style = NodeColorStyle.LoopNode

    @staticmethod
    def match(conf):
        return "pipe_in_loop" in conf

    def update(self, nodes):
        super().update(nodes)

        self.loop_nodes = []
        for name in self.conf["pipe_in_loop"]:
            if name in nodes:
                self.loop_nodes.append(nodes[name])

        temp_next = set()
        for n in self.loop_nodes:
            temp_next.update(n.conf.get("next", []))

        self.loop_start_nodes = []
        for name in set(self.conf["pipe_in_loop"]) - temp_next:
            if name in nodes:
                self.loop_start_nodes.append(nodes[name])

        # inp = self.conf['inp'][0]
        # for n in self.loop_nodes:
        #     if inp in n.mermaid_inps:
        #         n.mermaid_inps[n.mermaid_inps.index(inp)] = self.name

    def get_mermaid(self, info=None):
        links = []
        inp = self.conf["inp"][0]
        links.append(
            (
                None,
                None,
                inp,
                self.mermaid_inline,
                None,
                self.name,
                self.mermaid_style,
            )
        )

        defines = []
        loop_outs = self.get_loop_outs()
        subg = [(self.name, *self.conf["pipe_in_loop"], *loop_outs)]

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
        inp_name = self.conf["inp"][0]
        self.execute_start_callback({"loop_count": n})
        self.trace_node_id = uuid.uuid4().hex

        loop_tasks = []
        loop_data = []
        sub = []
        loop_outs = self.get_loop_outs()
        for item in inp:
            new_data = {}
            loop_data.append(new_data)

            new_queue = collections.defaultdict(asyncio.Queue)
            new_queue['#TRACE_PARENT_ID'].put_nowait(self.trace_node_id)
            for k in queue:
                if k == inp_name:
                    new_queue[k].put_nowait(item)
                elif k not in loop_outs:
                    new_queue[k] = queue[k]
            sub.append(new_queue)

            for n in self.loop_start_nodes:
                task = asyncio.create_task(n.run(new_data, new_queue, loop_tasks))
                loop_tasks.append(task)

        queue["_sub"] = sub

        while not all(t.done() for t in loop_tasks):
            await asyncio.gather(*loop_tasks)

        del queue["_sub"]
        for d in loop_data:
            for k, v in d.items():
                if k in data:
                    data[k].append(v)
                else:
                    data[k] = [v]
        out = {}
        for k in loop_data[0]:
            queue[k].put_nowait(data[k])
            out[k] = data[k]

        self.execute_finish_callback(inps, out, queue)

    def current_mp_task(self, inps, data, queue, config=None):
        N = len(inps[0])
        loop_outs = self.get_loop_outs()
        for k in loop_outs:
            data[k] = [DataState.VOID] * N
        for i in range(N):
            new_config = {} if config is None else copy.deepcopy(config)
            if "loop_index" not in new_config:
                new_config["loop_index"] = {}
            new_config["loop_index"] |= {k: i for k in self.conf["inp"] + loop_outs}
            for node in self.loop_start_nodes:
                queue.put((node.name, new_config))

        for node in self.next:
            queue.put((node.name, config))

    def current_seq_task(self, inps, data, queue):
        self.execute_start_callback()
        keys = list(data.keys())
        for item in inps[0]:
            tmp_d = copy.deepcopy(data)
            tmp_d[self.conf["inp"][0]] = item
            tmp_q = self.loop_start_nodes[:]
            while tmp_q:
                n = tmp_q.pop(0)
                n.run(tmp_d, tmp_q)

            for k in tmp_d:
                if k not in keys:
                    if k in data:
                        data[k].append(tmp_d[k])
                    else:
                        data[k] = [tmp_d[k]]

        for n in self.next:
            queue.append(n)
        self.execute_finish_callback(None)
