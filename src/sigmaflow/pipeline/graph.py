import os
import copy
import importlib
import collections
from pathlib import Path
import multiprocessing as mp
from functools import reduce
from typing import Optional, Any
from ..log import log
from ..nodes import Node
from ..nodes.constant import InputData, OutputData


class Graph:
    def __init__(
        self,
        pipeline_manager,
        prompt_manager,
        name=None,
        pipeconf: Optional[dict] = None,
        pipefile=None,
        run_mode="async",
    ):
        self.name = name
        self.pipeconf = pipeconf
        self.pipefile = pipefile
        self.config = {}
        self.run_mode = run_mode
        self.is_async = run_mode == "async"
        self.perf: list[tuple] = []
        if pipeconf is None and pipefile is not None:
            self.load(pipefile)

        self.start_nodes: list[Node] = []
        self.required_inputs: list[str] = []
        self.pipeline_manager = pipeline_manager
        self.prompt_manager = prompt_manager
        self.pipe_manager: dict[str, Any] = {}  # this need to remove
        self.node_manager: dict[str, Node] = {}
        self.node_type: dict[Node, set] = collections.defaultdict(set)
        if run_mode == "mp":
            self.mp_manager = mp.Manager()
            self.mp_lock = self.mp_manager.Lock()

        self._init()
        self._check()

    def load(self, pipefile):
        if type(pipefile) is str:
            pipefile = Path(pipefile)
        m = importlib.import_module(pipefile.stem)
        self.pipeconf = m.pipeline
        if self.name is None:
            self.name = pipefile.stem.removesuffix(
                os.getenv("PIPELINE_SUFFIX", "_pipeline")
            )

    def _check(self):
        node_names = set(self.node_manager.keys())
        data = set()
        for n in self.node_manager.values():
            data.update(n.mermaid_data)
        if conflict_names := node_names & data:
            log.error(
                f"conflict between the pipe name and the data name, which will cause errors when drawing mermaid flowchart: {conflict_names}"
            )
            exit()

    def _find_start_nodes(self):
        conf = self.pipeconf
        deps = set(["CONFIG", "exit"])
        for p in conf:
            if nt := conf[p].get("next", None):
                if type(nt) is dict:
                    arr = []
                    for v in nt.values():
                        if type(v) is str:
                            arr.append(v)
                        elif type(v) is list:
                            arr += v
                    deps.update(arr)
                elif type(nt) is list:
                    deps.update(nt)
            deps.update(conf[p].get("pipe_in_loop", []))

        self.start_nodes = [self.node_manager[i] for i in list(set(conf.keys()) - deps)]

    def _init(self):
        if "CONFIG" not in self.pipeconf:
            self.pipeconf["CONFIG"] = {}
        if "exit" not in self.pipeconf:
            self.pipeconf["exit"] = {}
        for name, conf in self.pipeconf.items():
            if node := Node.create(name, conf, self):
                self.node_manager[name] = node
            else:
                log.error(f"Unable to identify node type: [{name}] {conf}")
                exit()

        all_outs = set()
        for n in self.node_manager.values():
            n.update(self.node_manager)
            self.node_type[n.__class__].add(n.name)
            self.node_type[OutputData].update(n.mermaid_data)
            all_outs.update(n.mermaid_outs)

        self.required_inputs = self.node_type[OutputData] - all_outs
        self.node_type[InputData] = self.required_inputs

        self._find_start_nodes()
        if not self.start_nodes:
            log.error("Can't find start entry in pipes.")
            exit()
        log.debug(
            f"'{self.name}' tree initialization successful, start nodes: {self.start_nodes}, required input: {self.required_inputs}"
        )

    def export_conf(self):
        conf = copy.deepcopy(self.pipeconf)
        for pipe_conf in conf.values():
            if "format" in pipe_conf:
                for k, v in pipe_conf["format"].items():
                    pipe_conf["format"][k] = str(v)
        return conf

    def reset(self):
        self.perf = []
        for node in self.node_manager.values():
            node.reset()

    def graph2mermaid(self, info=None):
        conf = self.config.get("mermaid", {})
        mermaid_config = (
            "---\n"
            "config:\n"
            f"  layout: {conf.get('layout', 'elk')}\n"
            f"  look: {conf.get('look', 'classic')}\n"
            "  elk:\n"
            f"    mergeEdges: {str(conf.get('elk', {}).get('mergeEdges', 'false')).lower()}\n"
            f"    nodePlacementStrategy: {conf.get('elk', {}).get('nodePlacementStrategy', 'BRANDES_KOEPF')}\n"
            "---\n"
        )
        mermaid = mermaid_config + "graph TD"
        indent = " " * 4
        defines = set()
        links = set()
        subgraphs = set()
        passed_nodes = set()
        nodes = self.start_nodes[:]
        while nodes:
            n = nodes.pop(0)
            passed_nodes.add(n)
            defs, lks, subg = n.get_mermaid(info)
            defines.update(defs)
            links.update(lks)
            subgraphs.update(subg)
            for i in n.loop_nodes + (
                n.next
                if type(n.next) is list
                else reduce(lambda a, b: a + b, n.next.values())
            ):
                if i not in passed_nodes:
                    nodes.append(i)

        links_d = {}
        for link in links:
            item = (link[0], link[2], link[5])
            if item in links_d:
                if link[4]:
                    links_d[item] = link
            else:
                links_d[item] = link
        links_str = []
        links_style = []

        for inps, inline, self.name, outline, t, outs, link_style in links_d.values():
            if t is None:
                t = ""
            if inps:
                link = f"{inps} {inline} {self.name} {outline}{t} {outs}"
            else:
                link = f"{self.name} {outline}{t} {outs}"
            if link_style is not None:
                links_style.insert(0, link_style)
                links_str.insert(0, link)
            else:
                links_str.append(link)

        mermaid += f"\n{indent}%% ========================"
        mermaid += f"\n{indent}%% Nodes definition section"
        mermaid += f"\n{indent}%% ========================\n"
        for i in defines:
            mermaid += f"{indent}{i}\n"

        mermaid += f"\n{indent}%% ========================"
        mermaid += f"\n{indent}%% Links definition section"
        mermaid += f"\n{indent}%% ========================\n"
        for i in links_str:
            mermaid += f"{indent}{i}\n"

        mermaid += f"\n{indent}%% ================"
        mermaid += f"\n{indent}%% Subgraph section"
        mermaid += f"\n{indent}%% ================\n"
        subg = []
        for i in subgraphs:
            sub_items = "\n".join([indent * 2 + j for j in i[1:] if j is not None])
            subg.append(f"{indent}subgraph {i[0]}\n{sub_items}\n{indent}end\n")
        mermaid += "\n".join(subg)

        mermaid += f"\n{indent}%% ========================"
        mermaid += f"\n{indent}%% Style definition section"
        mermaid += f"\n{indent}%% ========================\n"
        for c, items in self.node_type.items():
            name = c.__name__.upper()
            mermaid += f"{indent}classDef {name} {c.mermaid_style}\n"
            if items:
                mermaid += f"{indent}class {','.join(items)} {name}\n"
        for i, style in enumerate(links_style):
            mermaid += f"{indent}linkStyle {i} {style}\n"

        return mermaid

    def perf2mermaid(self):
        mermaid = "gantt\ntitle Task Timeline\ndateFormat  x\naxisFormat  %M:%S.%L\n"
        base_time = self.perf[0][2]
        data = collections.defaultdict(list)
        # loop_end = {}
        for name, e, start_time, end_time in self.perf:
            if "pid" in name:
                arr = name.split(": ")
                n = f"{arr[0]}_{int(arr[1]):0>2d}"
            else:
                n = name
            s = (start_time - base_time) * 1000
            Δ = (end_time - start_time) * 1000
            data[n].append((e, s, Δ))
            # if e in pipe:
            #     if pipe[e]['mode'] == 'loop':
            #         loop_end[f'{e}_end'] = (n, e, s)
            #     else:
            #         data[n].append((e, s, Δ))
            # elif e in loop_end:
            #     n, e, s_ = loop_end[e]
            #     Δ_ = s + Δ - s_
            #     data[n].append((e, s_, Δ_))

        for k in sorted(data.keys()):
            mermaid += f"section {k}\n"
            for e, s, Δ in data[k]:
                # if pipe[e]['mode'] == 'loop':
                #     mermaid += f'{e}: done, {s:.0f}, {Δ:.0f}ms\n'
                # else:
                mermaid += f"{e}: {s:.0f}, {Δ:.0f}ms\n"

        return mermaid

    def check_inp(self, inp):
        if missing := self.required_inputs - set(inp.keys()):
            error_msg = f"missing input data: {list(missing)}"
            log.error(f"[{self.name}]:\n{error_msg}")
            return {"error_msg": error_msg}

    def __str__(self):
        loop_num = sum(
            [n.__class__.__name__ == "LoopNode" for n in self.node_manager.values()]
        )
        branch_num = sum(
            [n.__class__.__name__ == "BranchNode" for n in self.node_manager.values()]
        )
        return f"<Graph '{self.name}': nodes: {len(self.node_manager)}, loop: {loop_num}, branch: {branch_num}>"

    def __repr__(self):
        return self.__str__()
