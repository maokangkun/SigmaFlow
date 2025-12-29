from functools import partial
from .node import Node
from ..blocks import RAGBlock
from .constant import NodeColorStyle, NodeShape


class RAGNode(Node):
    mermaid_style = NodeColorStyle.RAGNode
    mermaid_shape = NodeShape.RAGNode

    @staticmethod
    def match(conf):
        return "rag_param" in conf

    def post_init(self):
        graph = self.graph

        if "rag" not in self.conf:
            self.conf["rag"] = graph.config.get("rag")

        if param := self.conf.get("rag_param", None):
            self.conf["rag"] = partial(self.conf["rag"], **dict(param))

        if graph.run_mode == "mp":
            pipe = RAGBlock(
                self.name,
                lock=graph.mp_lock,
                run_time=graph.mp_manager.list(),
                inout_log=graph.mp_manager.list(),
                **self.conf,
            )
        else:
            pipe = RAGBlock(self.name, **self.conf)

        graph.pipe_manager[self.name] = pipe
        self.pipe = pipe

    def export_as_comfyui(self):
        param = self.conf.get("rag_param", {})
        inps = {
            "text": ["TEXT"],
            "kb": [
                "STRING",
                {
                    "default": param.get("kb_id", None),
                    "multiline": False,
                    "dynamicPrompts": True,
                },
            ],
            "top_k": ["INT", {"default": param.get("top_k", 1), "min": 1}],
            "threshold": [
                "FLOAT",
                {
                    "default": param.get("threshold", 0.5),
                    "min": 0.01,
                    "max": 1.0,
                    "step": 0.1,
                },
            ],
        }
        opt_inps = {}
        outs = self.mermaid_outs
        d = {
            "input": {"required": inps, "optional": opt_inps},
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

    def current_seq_task(self, inps, data, queue):
        out = self.pipe(*inps)
        self.set_out(out, data)
        self.execute_finish_callback(out)
        for n in self.next:
            queue.append(n)

    def current_mp_task(self, inps, data, queue, config=None):
        out = self.pipe(*inps)
        self.set_out(out, data, config=config)
        self.execute_finish_callback(out)
        for n in self.next:
            queue.put((n.name, config))

    async def current_task(self, data, queue, dynamic_tasks):
        inps = await self.get_inps(queue)
        out = await self.pipe(*inps)
        self.set_out(out, data, queue)
        self.execute_finish_callback(out)
