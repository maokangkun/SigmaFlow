from .base import Block
from ..utils import sync_compat


class RAGBlock(Block):
    def __init__(
        self,
        name,
        rag=None,
        verbose=True,
        return_key=None,
        lock=None,
        run_time=None,
        inout_log=None,
        **kargs,
    ):
        super().__init__(name, lock, run_time, inout_log, verbose)
        self.rag = rag
        self.return_key = return_key

    @sync_compat
    async def _call(self, *inp):
        resp = await self.rag(*inp)
        self.log("out", resp)
        out = resp  # 空响应也保持变量已定义, 否则 None 分支会 UnboundLocalError
        if resp is not None and len(resp):
            if self.return_key:
                o = eval(f"resp{self.return_key}")
                self.log("return_key", o)
                out = o
            else:
                out = resp
        # Block 基类的重试循环按 4 元组解包(out/query/resp/usage), 与 llm 一致。
        return out, inp, resp, None
