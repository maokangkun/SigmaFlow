from .node import Node


class ConfigNode(Node):
    @staticmethod
    def match(conf):
        return conf["name"] == "CONFIG"

    def post_init(self):
        # if type(self.conf["llm"]) is str:
        #     self.conf["llm"] = ...
        self.graph.config = self.conf
