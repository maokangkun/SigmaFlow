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

    def __call__(self, item: str | list[str], stream_cb=None):
        # stream_cb 按调用传入: CONFIG 级 LLM 实例被全部节点共享, 若只写实例
        # 槽位, 并发 LLM 节点会互相覆盖转发器, 增量帧串到别人的订阅上(节点
        # 名错标)。self.stream_cb 保留为无参调用的兼容默认。
        cb = stream_cb if stream_cb is not None else self.stream_cb
        return self.completion(item, stream_cb=cb)

    def set_thinking(self, enabled):
        # 请求级开关(api /run 的 no_think): completion partial 绑的是构造时的
        # 原 conf dict, 镜像 deepcopy 不生效, 两份都要同步。
        self.conf["no_think"] = not enabled
        bound = getattr(self.completion, "keywords", None) or {}
        conf = bound.get("conf")
        if isinstance(conf, dict):
            conf["no_think"] = not enabled

    def __str__(self):
        return f"<{self.__class__.__name__}: {self.conf['llm']}, model: {self.conf['model']}>"

    def __repr__(self):
        return self.__str__()
