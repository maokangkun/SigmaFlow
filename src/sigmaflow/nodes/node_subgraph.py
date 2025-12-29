from .node import Node
from .constant import NodeColorStyle


class SubGraphNode(Node):
    mermaid_style = NodeColorStyle.SubGraphNode

    @staticmethod
    def match(conf):
        return "subgraph" in conf

    def post_init(self):
        pm = self.graph.pipeline_manager
        self.sub_pipeline = pm.pipes[self.conf["subgraph"]]

    def get_mermaid(self, info=None):
        links = []

        def process_line(line):
            line = line[4:]
            for inp in self.sub_pipeline.pipegraph.required_inputs:
                if line.startswith(a := f"{inp} {self.mermaid_inline} "):
                    line = line.replace(a, "")
                    out = line.split(" ")[0]
                    links.append(
                        (
                            None,
                            None,
                            inp,
                            self.mermaid_inline,
                            None,
                            out,
                            None,
                        )
                    )
                elif line.startswith(inp):
                    return None
            return line

        defines = []
        sub_mermaid = self.sub_pipeline.pipegraph.graph2mermaid()
        lines = sub_mermaid.split("graph TD\n")[1].splitlines()
        subg = [(self.name, *map(process_line, lines))]

        return defines, links, subg
