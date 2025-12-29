import importlib
from pathlib import Path
from typing import TYPE_CHECKING
from ..log import log
from .constant import NodeColorStyle, NodeShape, OutputData

if TYPE_CHECKING:
    from .node import Node


class Base:
    registered_nodes: list["Node"] = []
    mermaid_style = NodeColorStyle.default
    mermaid_shape = NodeShape.default
    mermaid_inline = "-->"
    mermaid_outline = "-.->"
    mermaid_toexit = "--o"
    mermaid_inline_passed = "==>"
    mermaid_outline_passed = "==>"
    mermaid_toexit_passed = "==o"

    def __init__(self, name, conf, graph=None):
        self.name = name
        self.conf = conf
        self.graph = graph
        self.run_cnt = 0
        self.max_cnt = self.conf.get("max_cnt", None)
        self.in_loop = None
        self.next = []
        self.loop_nodes = []
        self.finish_callbacks = []
        self.reset_out_flag = "reset_out" in self.conf
        if self.reset_out_flag:
            self.conf["out"] = self.conf["reset_out"]
            del self.conf["reset_out"]
        if "inp" in self.conf and type(self.conf["inp"]) is str:
            self.conf["inp"] = [self.conf["inp"]]
        self.set_mermaid()
        self.post_init()

    def __init_subclass__(cls, **kwargs):
        Base.registered_nodes.append(cls)
        super().__init_subclass__(**kwargs)

    def set_mermaid(self):
        self.mermaid_inps = []
        if "inp" in self.conf:
            for i in self.conf["inp"]:
                if (t := type(i)) is str:
                    self.mermaid_inps.append(i)
                elif t is dict:
                    self.mermaid_inps += list(i.values())

        outs = []
        if o := self.conf.get("out", None):
            if (t := type(o)) is str:
                outs = [o]
            elif t is list:
                outs = o[:]
            elif t is dict:
                outs = list(o.values())
        self.mermaid_outs = outs
        self.mermaid_data = self.mermaid_inps + self.mermaid_outs

    def _get_mermaid_defines(self):
        return [self.__class__.mermaid_shape.format(x=self.name)] + [
            OutputData.mermaid_shape.format(x=d) for d in self.mermaid_data
        ]

    def get_mermaid(self, info=None):
        inps = " & ".join(self.mermaid_inps) or None
        outs = " & ".join(self.mermaid_outs) or None

        defines = self._get_mermaid_defines()

        t = (
            info["detail"][self.name]["avg_time"]
            if info and self.name in info["detail"]
            else None
        )
        if t is not None:
            t = f"|{t:.2f}s|"

        inline = self.mermaid_inline_passed if self.run_cnt else self.mermaid_inline
        outline = self.mermaid_outline_passed if self.run_cnt else self.mermaid_outline
        inout_link = (inps, inline, self.name, outline, t, outs, None)

        links = [inout_link]
        for n in self.next:
            if n.name == "exit":
                t = (
                    f"|total: {info['total_time']:.2f}s|"
                    if info and self.name in info["exec_path"]
                    else None
                )
                links.append(
                    (
                        None,
                        None,
                        outs,
                        self.mermaid_toexit_passed if t else self.mermaid_toexit,
                        t,
                        "exit",
                        None,
                    )
                )

        subg = []

        return defines, links, subg

    def update(self, nodes):
        for name in self.conf.get("next", []):
            if name in nodes:
                self.next.append(nodes[name])

    def post_init(self):
        pass

    def reset(self):
        self.run_cnt = 0

    def export_as_comfyui(self):
        return {}

    def __str__(self):
        return f"<{self.__class__.__name__}: {self.name}, next: {[n.name for n in self.next]}>"

    def __repr__(self):
        return self.__str__()

    @classmethod
    def create(cls, name, conf, graph):
        for N in cls.registered_nodes:
            if N.match(conf | {"name": name}):
                return N(name, conf, graph)

    @staticmethod
    def match(conf):
        pass

    @staticmethod
    def import_nodes():
        for file in Path(__file__).parent.glob("node_*.py"):
            module_name = file.stem

            try:
                importlib.import_module(f".{module_name}", __package__)
            except Exception as e:
                log.error(f"Warning: Failed to import from {module_name}: {e}")
                exit()
