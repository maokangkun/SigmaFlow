from .base import Block
from ..utils import extract_json, sync_compat, remove_think_content


class LLMBlock(Block):
    def __init__(
        self,
        name,
        prompt=None,
        return_json=True,
        format=None,
        llm=None,
        verbose=True,
        retry=5,
        inp=None,
        out=None,
        lock=None,
        run_time=None,
        inout_log=None,
        second_round=False,
        remove_think=False,
        **kargs,
    ):
        if return_json:
            second_round = True
        super().__init__(name, lock, run_time, inout_log, verbose, retry, second_round)
        self.prompt = prompt
        self.llm = llm
        self.return_json = return_json
        self.format = format
        self.remove_think = remove_think

    def check_format_valid(self, out):
        if out and type(out) is dict and self.format is not None:
            if type(self.format) is dict and all(
                map(
                    lambda x: x[0] in out
                    and (
                        type(out[x[0]]) is x[1]
                        if type(x[1]) is type
                        else out[x[0]] in x[1]
                    ),
                    self.format.items(),
                )
            ):
                self.log(f"check {self.format}", "✓")
            elif type(self.format) is set and all(i in out for i in self.format):
                self.log(f"check {self.format}", "✓")
            else:
                self.log(f"check {self.format}", "✗")
                return False
        return True

    @sync_compat
    async def _call(self, *inp):
        text = self.prompt(*inp)
        self.log("prompt", text)
        resp = await self.llm(text)
        self.log("resp", resp)
        if self.return_json:
            out = extract_json(resp)
            self.log("json", out)
            if not self.check_format_valid(out):
                out = None
        else:
            if self.remove_think:
                out = remove_think_content(resp)
                self.log("remove think", [f"{out[:20]} ..."])
            else:
                out = resp
        return out, text, resp

    @sync_compat
    async def _second_call(self, history):
        if self.return_json:
            history.append("Make sure return answer in JSON format.")

            self.log("history", history)
            resp = await self.llm(history)
            self.log("resp", resp)

            out = extract_json(resp)
            self.log("json", out)
            if not self.check_format_valid(out):
                out = None
            return out, history, resp

    def __str__(self):
        return f"<{self.__class__.__name__}: {self.name}, prompt: {self.prompt.name}, json: {self.return_json}>"
