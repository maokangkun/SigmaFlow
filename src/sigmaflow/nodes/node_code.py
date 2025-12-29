from ..log import log
from .node import Node
from .constant import NodeColorStyle, NodeShape


class CodeNode(Node):
    mermaid_style = NodeColorStyle.CodeNode
    mermaid_shape = NodeShape.CodeNode

    @staticmethod
    def match(conf):
        return "code" in conf or "code_func" in conf

    def _eval_format(self, item):
        if type(item) is str:
            return item.encode("unicode_escape").decode("utf-8")
        else:
            return item

    async def current_task(self, data, queue, dynamic_tasks):
        inps = await self.get_inps(queue)
        code = self.conf["code"]
        if callable(code):
            out = code(*inps)
        elif type(code) is str:
            if "def" in code:
                func_name = code.split("def ")[1].split("(")[0].strip()
                local = {}
                exec(code, local)
                out = local[func_name](*inps)
            else:
                inps_dict = {
                    k: self._eval_format(v)
                    for k, v in zip(self.conf.get("inp", []), inps)
                }
                out = eval(code.format(**inps_dict))

        self.set_out(out, data, queue)
        log.debug(f"{self.conf['out']}: {out}")
        self.execute_finish_callback(out)

    def current_mp_task(self, inps, data, queue, config=None):
        code = self.conf["code"]
        if callable(code):
            out = code(*inps)
        elif type(code) is str:
            if "def" in code:
                func_name = code.split("def ")[1].split("(")[0].strip()
                local = {}
                exec(code, local)
                out = local[func_name](*inps)
            else:
                inps_dict = {
                    k: self._eval_format(v)
                    for k, v in zip(self.conf.get("inp", []), inps)
                }
                out = eval(code.format(**inps_dict))
        self.set_out(out, data, config=config)
        log.debug(f"{self.conf['out']}: {out}")
        self.execute_finish_callback(out)
        for n in self.next:
            queue.put((n.name, config))

    def current_seq_task(self, inps, data, queue):
        code = self.conf["code"]
        if callable(code):
            if "inp" not in self.conf:
                out = code()
            else:
                out = code(*inps)
        elif type(code) is str:
            if "def" in code:
                func_name = code.split("def ")[1].split("(")[0].strip()
                local = {}
                exec(code, local)
                if "inp" not in self.conf:
                    out = local[func_name]()
                else:
                    out = local[func_name](*inps)
            else:
                inps_dict = {
                    k: self._eval_format(v)
                    for k, v in zip(self.conf.get("inp", []), inps)
                }
                out = eval(code.format(**inps_dict))

        self.set_out(out, data)
        log.debug(f"{self.conf['out']}: {out}")
        self.execute_finish_callback(out)
        for n in self.next:
            queue.append(n)
