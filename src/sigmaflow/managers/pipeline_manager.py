import re
import os
import sys
import copy
import json
from pathlib import Path
from ..log import log
from ..utils import calc_hash
from ..pipeline import Pipeline
from .prompt_manager import PromptManager


class PipelineManager:
    def __init__(
        self,
        llm_client=None,
        rag_client=None,
        llm_type=None,
        rag_type=None,
        run_mode="async",
        pipes_dir=None,
        prompt_manager=None,
    ):
        self.prompt_manager = prompt_manager or PromptManager()
        log.banner("Setup PipelineManager", separate=False)
        self.pipes_dir = Path(pipes_dir or ".")
        self.llm_client = llm_client
        self.rag_client = rag_client
        self.llm_type = llm_type
        self.rag_type = rag_type
        self.llm_batch_processor = None
        self.run_mode = run_mode
        self.pipeline_suffix = os.getenv("PIPELINE_SUFFIX", "_pipeline")
        self.pipes = {}
        self.load_llm_rag_client()
        self.load_pipes()

    def load_pipes(self):
        self.pipes = {}
        log.debug(f"Start load pipelines from: {self.pipes_dir}")
        sys.path.append(str(self.pipes_dir))
        pipe_files = list(self.pipes_dir.glob(f"*{self.pipeline_suffix}.py"))
        # 对pipe_files进行排序，确保被依赖的pipeline先加载
        pipe_files.sort(
            key=lambda pf: "subgraph" in open(pf, "r", encoding="utf-8").read()
        )

        log.debug(
            f"Find {len(pipe_files)} pipeline files: {[p.stem.removesuffix(self.pipeline_suffix) for p in pipe_files]}"
        )

        for pf in pipe_files:
            self._load_pipe(pf.stem.removesuffix(self.pipeline_suffix), pipefile=pf)
        sys.path.pop()

        log.debug("All pipelines loaded")

    def load_llm_rag_client(self):
        log.debug(f"Pipeline run mode: {self.run_mode}")
        if self.llm_client is None and self.llm_type is not None:
            log.debug(f"Initializing LLM backend: {self.llm_type}")
            llm_batch_processor = None
            match self.llm_type:
                case "torch":
                    from ..clients.llm_torch import llm_client
                case "lmdeploy":
                    from ..clients.llm_lmdeploy import llm_client, llm_batch_processor
                case "vllm":
                    from ..clients.llm_vllm import llm_client, llm_batch_processor
                case "ollama":
                    from ..clients.llm_ollama import llm_client
                case "openai":
                    from ..clients.llm_openai import llm_client
                case "mlx":
                    from ..clients.llm_mlx import llm_client
                case _:
                    pass
            self.llm_client = llm_client(is_async=self.run_mode == "async")
            self.llm_batch_processor = llm_batch_processor

        if self.rag_client is None and self.rag_type is not None:
            log.debug(f"Initializing RAG backend: {self.rag_type}")
            match self.rag_type:
                case "json":
                    from ..clients.rag_json import rag_client
                case "http":
                    from ..clients.rag_http import rag_client
                case _:
                    pass
            self.rag_client = rag_client(is_async=self.run_mode == "async")

    def add_pipe(self, name, pipeconf=None, pipefile=None, run_mode=None):
        name = name.removesuffix(self.pipeline_suffix)

        if pipefile:
            if type(pipefile) is str:
                pipefile = Path(pipefile)
            sys.path.append(str(pipefile.parent))

        p = self._load_pipe(
            name, pipeconf=pipeconf, pipefile=pipefile, run_mode=run_mode
        )

        if pipefile:
            sys.path.pop()

        return p

    def _load_pipe(self, name, pipeconf=None, pipefile=None, run_mode=None):
        if (
            pipefile
            and name in self.pipes
            and calc_hash(pipefile) == self.pipes[name].hash
        ):
            p = self.pipes[name]
        else:
            p = Pipeline(
                self.llm_client,
                self.rag_client,
                self,
                self.prompt_manager,
                pipeconf=pipeconf,
                pipefile=pipefile,
                run_mode=run_mode or self.run_mode,
                llm_batch_processor=self.llm_batch_processor,
            )
            self.pipes[name] = p
        return p

    def export_pipe_conf(self):
        conf = {k: copy.deepcopy(p.pipetree.pipeconf) for k, p in self.pipes.items()}
        for c in conf.values():
            for pipe_conf in c.values():
                if "format" in pipe_conf:
                    for k, v in pipe_conf["format"].items():
                        pipe_conf["format"][k] = str(v)

                if "prompt" in pipe_conf:
                    pipe_conf["prompt"] = pipe_conf["prompt"].name

                if "backend_construct" in pipe_conf:
                    pipe_conf["backend_construct"] = str(pipe_conf["backend_construct"])

        return conf

    def update_pipe(self, pipe_name, pipe_data):
        if pipe_name.endswith("_pipe"):
            pipe_file = self.pipes_dir / f"{pipe_name}.py"

            try:
                content = json.dumps(pipe_data, indent=4, ensure_ascii=False)
                content = re.sub(r'"<class \'(.*)\'>"', r"\1", content)

                conf = pipe_data
                for pipe_conf in conf.values():
                    if "format" in pipe_conf:
                        for k, v in pipe_conf["format"].items():
                            pipe_conf["format"][k] = eval(
                                v.replace("<class '", "").replace("'>", "")
                            )

                pipe = copy.deepcopy(conf)
                for k in pipe:
                    if "prompt" in pipe[k]:
                        pipe[k]["prompt"] = self.prompt_manager.prompts[
                            pipe[k]["prompt"]
                        ]

                self.pipes[pipe_name] = {
                    "file": pipe_file,
                    "conf": conf,
                    "func": Pipeline(pipe, self.llm_client, self.rag_client),
                }

                with open(pipe_file, "w") as f:
                    content = "pipe = " + content + "\n"
                    f.write(content)

                log.debug(f'Save pipeline "{pipe_name}":\n{content}')
                return f"Successfully saved {pipe_name}"
            except Exception as e:
                return f"Error: {e}"
        else:
            return "Error: name must end with `_pipe`."

    def export_nodes(self):
        nodes = {}
        for pipeline in self.pipes.values():
            pt = pipeline.pipetree
            for node in pt.node_manager.values():
                nodes |= node.export_as_comfyui()
        return nodes

    def __str__(self):
        return f"<{self.__class__.__name__} mode: {self.run_mode}, pipes: {list(self.pipes)}, dir: {self.pipes_dir.absolute()}>"

    def __repr__(self):
        return self.__str__()
