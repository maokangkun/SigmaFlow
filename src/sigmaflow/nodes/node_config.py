from .node import Node
from ..clients.llm import LLM


class ConfigNode(Node):
    @staticmethod
    def match(conf):
        return conf["name"] == "CONFIG"

    def post_init(self):
        if type(self.conf["llm"]) is str:
            self.conf["llm"] = LLM(self.conf)
        self.graph.config = self.conf
