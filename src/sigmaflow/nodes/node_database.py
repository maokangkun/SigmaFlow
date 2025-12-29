from .node import Node
from .constant import NodeColorStyle, NodeShape


class DatabaseNode(Node):
    mermaid_style = NodeColorStyle.DatabaseNode
    mermaid_shape = NodeShape.DatabaseNode

    @staticmethod
    def match(conf):
        return "sql" in conf
