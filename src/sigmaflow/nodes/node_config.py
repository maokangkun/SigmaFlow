from .node import Node
from ..clients.llm import LLM


class ConfigNode(Node):
    @staticmethod
    def match(conf):
        return conf["name"] == "CONFIG"

    def post_init(self):
        if type(self.conf["llm"]) is str:
            self.conf["llm"] = LLM(self.conf)
        # 显式 None 的键不落配置: client 端 conf.get(k, env) 会被 None 压住
        # env fallback(比如 model 缺省走 OPENAI_API_MODEL), 这里提前摘掉。
        for k in [k for k, v in self.conf.items() if v is None]:
            del self.conf[k]
        self.graph.config = self.conf
