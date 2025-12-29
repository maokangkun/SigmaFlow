from ..log import log
from .node import Node
from .constant import NodeColorStyle, NodeShape, OutputData, DataState


class ValueNode(Node):
    mermaid_style = NodeColorStyle.ValueNode
    mermaid_shape = NodeShape.ValueNode

    @staticmethod
    def match(conf):
        return "value" in conf or "item" in conf

    def _get_mermaid_defines(self):
        data_defs = [OutputData.mermaid_shape.format(x=d) for d in self.mermaid_data]
        n = 25
        if "value" in self.conf:
            t = str(self.conf["value"])
        elif "item" in self.conf:
            t = self.conf["item"]
        if len(t) > n:
            t = t[:n] + "..."
        m = {"append": "+", "assign": "="}[self.conf.get("mode", "assign")]
        d = f"{m} {t}"
        return [self.__class__.mermaid_shape.format(n=self.name, x=d)] + data_defs

    def get_inps_mp(self, data, config=None):
        def get_data(i):
            if i not in data:
                return DataState.VOID
            if type(data[i]) is list:
                if config and i in config["loop_index"]:
                    loop_i = config["loop_index"][i]
                    return data[i][loop_i]
                elif DataState.VOID in data[i]:
                    return DataState.VOID
            return data[i]

        mode = self.conf.get("mode", "assign")
        if mode == "append":
            if (d := get_data(self.conf["out"])) is DataState.VOID:
                return []
            else:
                return [d]
        else:
            return [1]

    def current_mp_task(self, inps, data, queue, config=None):
        mode = self.conf.get("mode", "assign")
        if mode == "append":
            out = inps[0]
            out.append(self.conf["value"])
        else:
            out = self.conf["value"]
        self.set_out(out, data, config=config)
        log.debug(f"{mode = }, {self.conf['out']}: {out}")
        self.execute_finish_callback(out)
        for n in self.next:
            queue.put((n.name, config))

    async def current_task(self, data, queue, dynamic_tasks):
        mode = self.conf.get("mode", "assign")
        if "value" in self.conf:
            v = self.conf["value"]
        elif "item" in self.conf:
            if "inp" in self.conf:
                await self.get_inps(queue)
            if "->" in self.conf["item"]:
                k1, k2 = self.conf["item"].split("->")
                v = data[data[k1][k2]]
            else:
                v = data[self.conf["item"]]

        if mode == "append":
            i = self.conf["out"]
            out = await queue[i].get()
            out.append(v)
        else:
            out = v
        self.set_out(out, data, queue)
        log.debug(f"{mode = }, {self.conf['out']}: {out}")
        self.execute_finish_callback(out)

    def current_seq_task(self, inps, data, queue):
        mode = self.conf.get("mode", "assign")
        if "value" in self.conf:
            v = self.conf["value"]
        elif "item" in self.conf:
            if "->" in self.conf["item"]:
                k1, k2 = self.conf["item"].split("->")
                v = data[data[k1][k2]]
            else:
                v = data[self.conf["item"]]

        if mode == "append":
            i = self.conf["out"]
            out = data[i]
            out.append(v)
        else:
            out = v
        self.set_out(out, data)
        log.debug(f"{mode = }, {self.conf['out']}: {out}")
        self.execute_finish_callback(out)
