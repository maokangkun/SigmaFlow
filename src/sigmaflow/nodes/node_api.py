from .node import Node
from .constant import NodeColorStyle, NodeShape


class APINode(Node):
    mermaid_style = NodeColorStyle.APINode
    mermaid_shape = NodeShape.APINode

    @staticmethod
    def match(conf):
        return "api" in conf

    def post_init(self):
        pass

    def get_mermaid(self, info=None):
        links = []

        defines = self._get_mermaid_defines()
        subg = []

        return defines, links, subg
