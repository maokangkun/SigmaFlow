from .node import Node
from ..prompts import Prompt
from ..blocks import LLMBlock
from .constant import NodeColorStyle, NodeShape, OutputData


class LLMNode(Node):
    mermaid_style = NodeColorStyle.LLMNode
    mermaid_shape = NodeShape.LLMNode

    @staticmethod
    def match(conf):
        return "prompt" in conf

    def post_init(self):
        graph = self.graph
        if type(self.conf["prompt"]) is not Prompt:
            k = ["{" + i + "}" for i in self.conf["inp"]]
            if k[0] in self.conf["prompt"]:
                p = {
                    "prompt": self.conf["prompt"],
                    "keys": k,
                }
            else:
                p = self.conf["prompt"]
            self.conf["prompt"] = graph.prompt_manager.get(p)

        if "llm" not in self.conf:
            self.conf["llm"] = graph.config.get("llm")
        if "model" not in self.conf:
            self.conf["model"] = graph.config.get("model")

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

    def _get_mermaid_defines(self):
        llm = (
            self.conf["llm"].__name__
            if callable(self.conf["llm"])
            else self.conf["llm"]
        )
        model = self.conf["model"]
        return [
            self.__class__.mermaid_shape.format(x=self.name, llm=llm, model=model)
        ] + [OutputData.mermaid_shape.format(x=d) for d in self.mermaid_data]

    def export_as_comfyui(self):
        inps = {i: ["TEXT"] for i in self.pipe.prompt.keys}
        opt_inps = {"模型": ["MODEL"]}
        prompt = {
            "prompt": [
                "STRING",
                {
                    "default": self.pipe.prompt.text,
                    "multiline": True,
                    "dynamicPrompts": True,
                },
            ]
        }
        outs = self.mermaid_outs
        d = {
            "input": {"required": inps | prompt, "optional": opt_inps},
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
