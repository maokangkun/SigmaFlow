from .node import Node
from .constant import NodeColorStyle


class MCPNode(Node):
    mermaid_style = NodeColorStyle.MCPNode

    @staticmethod
    def match(conf):
        return "mcp" in conf

    def post_init(self):
        pass

    def get_mermaid(self, info=None):
        links = []
        inp = " & ".join(self.conf["inp"])
        links.append(
            (
                inp,
                self.mermaid_inline,
                self.name,
                self.mermaid_outline,
                None,
                self.conf["out"],
                None,
            )
        )

        defines = []
        subg = [(self.name, "direction TB", *self.conf["mcp"])]

        return defines, links, subg
