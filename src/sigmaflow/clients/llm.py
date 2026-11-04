import copy
from functools import partial


class LLM:
    def __init__(
        self,
        conf,
    ):
        self.conf = copy.deepcopy(conf)
        # 流式回调注入点: LLM 节点把 node 级转发器挂上来后, 每个增量会先走
        # node.execute_stream_callback 再落到事件的 SSE 订阅方(api /run)。
        self.stream_cb = None
        if conf["llm"] == "openai":
            from .llm_openai import completion

            self.completion = partial(completion, conf=conf)
        self.__name__ = self.conf["llm"]

    def __call__(self, item: str | list[str]):
        return self.completion(item, stream_cb=self.stream_cb)

    def __str__(self):
        return f"<{self.__class__.__name__}: {self.conf['llm']}, model: {self.conf['model']}>"

    def __repr__(self):
        return self.__str__()
