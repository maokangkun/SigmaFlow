import copy
from functools import partial


class LLM:
    def __init__(
        self,
        conf,
    ):
        self.conf = copy.deepcopy(conf)
        if conf["llm"] == 'openai':
            from .llm_openai import completion
            self.completion = partial(completion, conf=conf)
        self.__name__ = self.conf['llm']

    def __call__(self, item: str | list[str]):
        return self.completion(item)

    def __str__(self):
        return f"<{self.__class__.__name__}: {self.conf['llm']}, model: {self.conf['model']}>"

    def __repr__(self):
        return self.__str__()
