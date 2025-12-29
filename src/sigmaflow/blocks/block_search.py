from .base import Block


class SearchBlock(Block):
    def __init__(
        self,
        name,
        search_engine="bing",
        count=5,
        verbose=True,
        lock=None,
        run_time=None,
        inout_log=None,
        **kargs,
    ):
        super().__init__(name, lock, run_time, inout_log, verbose)
        self.count = count
        if type(search_engine) is str:
            self.engine = self.async_engine = ...  # SearchEngine.get(search_engine)
        else:
            self.engine = self.async_engine = search_engine

    def _call(self, inp):
        resp = self.engine(inp, count=self.count)
        self.log("out", resp)
        return resp, inp, resp

    async def __call__(self, inp):
        resp = await self.async_engine(inp, count=self.count)
        self.log("out", resp)
        return resp, inp, resp
