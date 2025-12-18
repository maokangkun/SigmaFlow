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
        if resp is not None and len(resp):
            if self.return_key:
                o = eval(f"resp{self.return_key}")
                self.log("return_key", o)
                out = o
            else:
                out = resp
        return out, inp, resp
