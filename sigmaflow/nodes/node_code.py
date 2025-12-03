from ..imports import *
from ..log import log
from .constant import *
from .base import Node

class CodeNode(Node):
    mermaid_style = NodeColorStyle.CodeNode
    mermaid_shape = NodeShape.CodeNode

    def _eval_format(self, item):
        if type(item) is str:
            return item.encode('unicode_escape').decode('utf-8')
        else:
            return item

    async def current_task(self, data, queue, dynamic_tasks):
        inps = await self.get_inps(queue)
        if 'code_entry' in self.conf:
            local = {}
            exec(self.conf['code'], local) # PEP 667
            out = local[self.conf['code_entry']](*inps)
        elif 'code_func' in self.conf:
            out = self.conf['code_func'](*inps)
        else:
            inps_dict = {k:self._eval_format(v) for k,v in zip(self.conf['inp'], inps)}
            out = eval(self.conf['code'].format(**inps_dict))
        self.set_out(out, data, queue)
        log.debug(f'{self.conf["out"]}: {out}')
        self.execute_finish_callback(out)

    def current_mp_task(self, inps, data, queue, config=None):
        if 'code_entry' in self.conf:
            local = {}
            exec(self.conf['code'], local)
            out = local[self.conf['code_entry']](*inps)
        elif 'code_func' in self.conf:
            out = self.conf['code_func'](*inps)
        else:
            inps_dict = {k:self._eval_format(v) for k,v in zip(self.conf['inp'], inps)}
            out = eval(self.conf['code'].format(**inps_dict))
        self.set_out(out, data, config=config)
        log.debug(f'{self.conf["out"]}: {out}')
        self.execute_finish_callback(out)
        for n in self.next: queue.put((n.name, config))
    
    def current_normal_task(self, inps, data, queue):
        if 'code_entry' in self.conf:
            local = {}
            exec(self.conf['code'], local)
            if 'inp' not in self.conf:
                out = local[self.conf['code_entry']]()
            else:
                out = local[self.conf['code_entry']](*inps)
        elif 'code_func' in self.conf:
            if 'inp' not in self.conf:
                out = self.conf['code_func']()
            else:
                out = self.conf['code_func'](*inps)
        else:
            inps_dict = {k:self._eval_format(v) for k,v in zip(self.conf.get('inp', []), inps)}
            out = eval(self.conf['code'].format(**inps_dict))
        self.set_out(out, data)
        log.debug(f'{self.conf["out"]}: {out}')
        self.execute_finish_callback(out)
        for n in self.next: queue.append(n)
