import asyncio
from .node import Node
from .constant import NodeColorStyle, NodeShape


class ExitNode(Node):
    mermaid_style = NodeColorStyle.ExitNode
    mermaid_shape = NodeShape.ExitNode

    @staticmethod
    def match(conf):
        return conf["name"] == "exit"

    def get_mermaid(self, info=None):
        defines = [self.__class__.mermaid_shape.format(x=self.name)]
        return defines, [], []

    async def current_task(self, data, queue, dynamic_tasks):
        if self.conf:
            while not all(t.done() for t in dynamic_tasks if t.get_name() != "exit"):
                await asyncio.sleep(0.1)

            self.reformat(data)

    def reformat(self, data):
        if self.conf and "error_msg" not in data:
            ret = {}
            for k, v in self.conf.items():
                if type(v) is str:
                    d = data
                    for i in v.split("."):
                        if i in d:
                            d = d[i]
                        else:
                            break
                    else:
                        ret[k] = d
                elif type(v) is list and type(v[0]) is dict:
                    d = []
                    for i in range(len(data[list(v[0].values())[0]])):
                        t = {}
                        for m, n in v[0].items():
                            if n in data:
                                t[m] = data[n][i]
                        if t:
                            d.append(t)
                    if d:
                        ret[k] = d

            for k in list(data.keys()):
                del data[k]
            for k in ret:
                data[k] = ret[k]
