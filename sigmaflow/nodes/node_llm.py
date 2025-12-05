from ..imports import *
from ..log import log
from ..prompts import Prompt
from ..blocks import LLMBlock
from .constant import *
from .node import Node

class LLMNode(Node):
    mermaid_style = NodeColorStyle.LLMNode
    mermaid_shape = NodeShape.LLMNode

    @staticmethod
    def match(conf):
        return 'prompt' in conf

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
            pipe = LLMBlock(
                    self.name,
                    llm=backend,
                    lock=tree.mp_lock,
                    run_time=tree.mp_manager.list(),
                    inout_log=tree.mp_manager.list(),
                    **self.conf
                    )
        else:
            pipe = LLMBlock(self.name, llm=backend, **self.conf)
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
