from .base import Block


class BrowserBlock(Block):
    def __init__(
        self,
        name,
        client=None,
        verbose=True,
        lock=None,
        run_time=None,
        inout_log=None,
        **kargs,
    ):
        super().__init__(name, lock, run_time, inout_log, verbose)
        self.client = client

    def _call(self, inp):
        resp = self.rag(inp)
        self.log("out", resp)
        return resp, inp, resp

    async def __call__(self, inp):
        resp = await self.rag(inp)
        self.log("out", resp)
        return resp, inp, resp
