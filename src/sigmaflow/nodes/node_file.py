from pathlib import Path
from ..log import log
from .node import Node
from .constant import NodeColorStyle, NodeShape


class FileNode(Node):
    mermaid_style = NodeColorStyle.FileNode
    mermaid_shape = NodeShape.FileNode

    @staticmethod
    def match(conf):
        return "file" in conf or "file_dir" in conf

    def current_seq_task(self, inps, data, queue):
        info = self.conf.get("file_dir", None) or self.conf.get("file", None)
        if "file" in self.conf:
            if (t := type(self.conf["file"])) is str:
                files = [Path(self.conf["file"])]
            elif t is list:
                files = [Path(f) for f in self.conf["file"]]
        elif "file_dir" in self.conf:
            files = [f for f in Path(self.conf["file_dir"]).iterdir() if f.is_file()]

        md = []
        for file in files:
            if file.suffix == ".pdf":
                import pymupdf4llm

                md_text = pymupdf4llm.to_markdown(file)
                md.append(md_text)
            else:
                with open(file, "r") as f:
                    md.append(f.read())

        if "file" in self.conf and t is str:
            md = md[0]

        self.set_out(md, data)
        log.debug(f"[{self.name}] read: {info} -> {self.conf['out']}")
