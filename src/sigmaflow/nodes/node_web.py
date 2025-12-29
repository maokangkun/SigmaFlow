from .node import Node
from ..blocks import SearchBlock, BrowserBlock
from .constant import NodeColorStyle, NodeShape


class WebNode(Node):
    mermaid_style = NodeColorStyle.WebNode
    mermaid_shape = NodeShape.WebNode

    @staticmethod
    def match(conf):
        return "web" in conf

    def post_init(self):
        graph = self.graph
        search_pipe = None
        if graph.is_async:
            if "search_engine" in self.conf["web"]:
                search_pipe = SearchBlock(self.name, **self.conf["web"])
            browser_pipe = BrowserBlock(self.name)
        else:
            if "search_engine" in self.conf["web"]:
                # search_pipe = SearchBlock(
                #     self.name,
                #     lock=graph.mp_lock,
                #     run_time=graph.mp_manager.list(),
                #     inout_log=graph.mp_manager.list(),
                #     **self.conf,
                # )
                search_pipe = ...
            browser_pipe = BrowserBlock(self.name)

        graph.pipe_manager[self.name] = {"search": search_pipe, "browser": browser_pipe}
        self.search_pipe = search_pipe
        self.browser_pipe = browser_pipe

    def current_mp_task(self, inps, data, queue, config=None):
        out = self.search_pipe(*inps)
        self.set_out(out, data, config=config)

        for n in self.next:
            queue.put((n.name, config))

    # async def current_task(self, data, queue, dynamic_tasks):
    #     inps = await self.get_inps(queue)
    #     out = await self.search_pipe(*inps)

    #     browser_tasks = []
    #     for url in self.loop_nodes:
    #         task = asyncio.create_task(n.run(new_data, new_queue, loop_tasks))
    #         browser_tasks.append(task)
    #     while not all(t.done() for t in browser_tasks):
    #         await asyncio.gather(*browser_tasks)

    #     self.set_out(out, data, queue)
