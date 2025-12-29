import asyncio
from ..log import log
from .node import Node
from ..blocks import LLMBlock
from .constant import NodeColorStyle, NodeShape


class BranchNode(Node):
    mermaid_style = NodeColorStyle.BranchNode
    mermaid_shape = NodeShape.BranchNode

    @staticmethod
    def match(conf):
        return "use_llm" in conf or type(conf.get("next", None)) is dict

    def post_init(self):
        self.passed_cond = set()
        if "use_llm" not in self.conf:
            self.conf["use_llm"] = False
        if self.conf["use_llm"]:
            graph = self.graph
            self.conf["prompt"] = graph.prompt_manager.prompts["branch_node_prompt"]
            self.conf["return_json"] = True
            self.conf["format"] = {"item_id": str}

            if "llm" not in self.conf:
                self.conf["llm"] = graph.config.get("llm")

            if graph.run_mode == "mp":
                pipe = LLMBlock(
                    self.name,
                    lock=graph.mp_lock,
                    run_time=graph.mp_manager.list(),
                    inout_log=graph.mp_manager.list(),
                    **self.conf,
                )
            else:
                pipe = LLMBlock(self.name, **self.conf)
            graph.pipe_manager[self.name] = pipe
            self.pipe = pipe

    def update(self, nodes):
        self.next = {}
        for cond, item in self.conf["next"].items():
            if (t := type(item)) is str:
                if item in nodes:
                    self.next[cond] = [nodes[item]]
            elif t is list:
                self.next[cond] = []
                for name in item:
                    if name in nodes:
                        self.next[cond].append(nodes[name])

    def get_mermaid(self, info=None):
        inps = " & ".join(self.mermaid_inps)

        defines = self._get_mermaid_defines()

        t = (
            info["detail"][self.name]["avg_time"]
            if info and self.name in info["detail"]
            else None
        )
        if t is not None:
            t = f"|{t:.2f}s|"
        inline = self.mermaid_inline_passed if self.run_cnt else self.mermaid_inline
        inout_link = (None, None, inps, inline, t, self.name, None)

        links = [inout_link]
        for cond, arr in self.next.items():
            nexts = [n.name for n in arr]
            if "exit" in nexts:
                t = (
                    f"|{cond}, total: {info['total_time']:.2f}s|"
                    if info
                    else f"|{cond}|"
                )
                links.append(
                    (
                        None,
                        None,
                        self.name,
                        self.mermaid_toexit_passed if t else self.mermaid_toexit,
                        t,
                        "exit",
                        None,
                    )
                )
                nexts.remove("exit")

            if nexts:
                outline = (
                    self.mermaid_outline_passed
                    if cond in self.passed_cond
                    else self.mermaid_outline
                )
                links.append(
                    (
                        None,
                        None,
                        self.name,
                        outline,
                        f"|{cond}|",
                        " & ".join(nexts),
                        None,
                    )
                )

        subg = []

        return defines, links, subg

    async def add_task(self, data, queue, dynamic_tasks):
        inps = await self.get_inps(queue)
        if self.conf["use_llm"]:
            items = list(self.conf["next"].keys())
            items_text = "\n".join([f"[#{i + 1}] {t}" for i, t in enumerate(items)])

            retry = 0
            while retry < 5:
                if len(inps) == 1:
                    cond = await self.pipe(inps[0], items_text)
                else:
                    inps_t = "\n".join(
                        f"{k}: {v}" for k, v in zip(self.conf["inp"], inps)
                    )
                    cond = await self.pipe(inps_t, items_text)

                if cond and type(cond) is dict:
                    item_id = cond.get("item_id", "")
                    if (
                        len(item_id) > 1
                        and item_id[0] == "#"
                        and item_id[1:].isdigit()
                        and (i := int(item_id[1:]) - 1) < len(items)
                    ):
                        cond = items[i]
                        break
                    elif (
                        len(item_id)
                        and item_id.isdigit()
                        and (i := int(item_id) - 1) < len(items)
                    ):
                        cond = items[i]
                        break
                retry += 1
        elif "code" in self.conf:
            if "code_entry" in self.conf:
                local = {}
                exec(self.conf["code"], local)
                cond = local[self.conf["code_entry"]](*inps)
            else:
                inps_dict = {k: v for k, v in zip(self.conf["inp"], inps)}
                cond = eval(self.conf["code"].format(**inps_dict))
        else:
            cond = inps[0]

        if type(cond) is dict:
            cond = str(cond)
        self.passed_cond.add(cond)
        if nodes := self.next.get(cond, None):
            for node in nodes:
                task = asyncio.create_task(
                    node.run(data, queue, dynamic_tasks), name=node.name
                )
                dynamic_tasks.append(task)

            if self.run_cnt > 1:

                def q_del(q, k):
                    if k in q:
                        while not q[k].empty():
                            q[k].get_nowait()
                    if "_sub" in q:
                        for sub_q in q["_sub"]:
                            q_del(sub_q, k)

                sub_nodes = set()
                tmp = nodes[:]
                while tmp:
                    n = tmp.pop()
                    sub_nodes.add(n)
                    for nxt in n.next:
                        if nxt not in sub_nodes and type(nxt) is not BranchNode:
                            tmp.append(nxt)

                outs = set()
                for n in sub_nodes:
                    outs.update(n.mermaid_outs)
                outs -= set(self.conf["inp"])
                for o in outs:
                    q_del(queue, o)
                log.debug(f"[{self.name}] reset variables: {outs}")
        log.debug(f"[{self.name}] condition: {cond}, goto nodes: {nodes}")

    def current_mp_task(self, inps, data, queue, config=None):
        if self.conf["use_llm"]:
            items = list(self.conf["next"].keys())
            items_text = "\n".join([f"[#{i + 1}] {t}" for i, t in enumerate(items)])

            retry = 0
            while retry < 5:
                if len(inps) == 1:
                    cond = self.pipe(inps[0], items_text)
                else:
                    inps_t = "\n".join(
                        f"{k}: {v}" for k, v in zip(self.conf["inp"], inps)
                    )
                    cond = self.pipe(inps_t, items_text)

                if cond and type(cond) is dict:
                    item_id = cond.get("item_id", "")
                    if (
                        len(item_id) > 1
                        and item_id[0] == "#"
                        and item_id[1:].isdigit()
                        and (i := int(item_id[1:]) - 1) < len(items)
                    ):
                        cond = items[i]
                        break
                    elif (
                        len(item_id)
                        and item_id.isdigit()
                        and (i := int(item_id) - 1) < len(items)
                    ):
                        cond = items[i]
                        break
                retry += 1
        elif "code" in self.conf:
            if "code_entry" in self.conf:
                local = {}
                exec(self.conf["code"], local)
                cond = local[self.conf["code_entry"]](*inps)
            else:
                inps_dict = {k: v for k, v in zip(self.conf["inp"], inps)}
                cond = eval(self.conf["code"].format(**inps_dict))
        else:
            cond = inps[0]

        if type(cond) is dict:
            cond = str(cond)
        self.passed_cond.add(cond)
        if nodes := self.next.get(cond, None):
            for node in nodes:
                queue.put((node.name, config))
        log.debug(f"[{self.name}] condition: {cond}, goto nodes: {nodes}")

    def current_seq_task(self, inps, data, queue):
        if self.conf["use_llm"]:
            items = list(self.conf["next"].keys())
            items_text = "\n".join([f"[#{i + 1}] {t}" for i, t in enumerate(items)])

            retry = 0
            while retry < 5:
                if len(inps) == 1:
                    cond = self.pipe(inps[0], items_text)
                else:
                    inps_t = "\n".join(
                        f"{k}: {v}" for k, v in zip(self.conf["inp"], inps)
                    )
                    cond = self.pipe(inps_t, items_text)

                if cond and type(cond) is dict:
                    item_id = cond.get("item_id", "")
                    if (
                        len(item_id) > 1
                        and item_id[0] == "#"
                        and item_id[1:].isdigit()
                        and (i := int(item_id[1:]) - 1) < len(items)
                    ):
                        cond = items[i]
                        break
                    elif (
                        len(item_id)
                        and item_id.isdigit()
                        and (i := int(item_id) - 1) < len(items)
                    ):
                        cond = items[i]
                        break
                retry += 1
        elif "code" in self.conf:
            if "code_entry" in self.conf:
                local = {}
                exec(self.conf["code"], local)
                cond = local[self.conf["code_entry"]](*inps)
            else:
                inps_dict = {k: v for k, v in zip(self.conf["inp"], inps)}
                cond = eval(self.conf["code"].format(**inps_dict))
        else:
            cond = inps[0]

        if type(cond) is dict:
            cond = str(cond)
        self.passed_cond.add(cond)
        if nodes := self.next.get(cond, None):
            queue += nodes
        log.debug(f"[{self.name}] condition: {cond}, goto nodes: {nodes}")

    def export_as_comfyui(self):
        inps = {
            "text": ["TEXT"],
            "use_llm": ["BOOLEAN", {"default": self.conf.get("use_llm", False)}],
        }
        opt_inps = {}
        outs = list(self.conf["next"].keys())
        d = {
            "input": {"required": inps, "optional": opt_inps},
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
            arr = [
                f"{cond} -> {[n.name for n in nodes]}"
                for cond, nodes in self.next.items()
            ]
        else:
            arr = self.next
        return f"<{self.__class__.__name__}: {self.name}, next: {arr}>"
