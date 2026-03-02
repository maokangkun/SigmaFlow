import os
import argparse
from pathlib import Path
from dotenv import load_dotenv
from .utils import json, jload, jdump, get_version, check_env

load_dotenv(".env")


def setup_args():
    parser = argparse.ArgumentParser()

    parser.add_argument(
        "-p", "--pipeline", type=str, help="specify the pipeline to run"
    )
    parser.add_argument(
        "-d", "--pipeline_dir", type=str, help="specify the pipeline dir to run"
    )
    parser.add_argument("--prompt", type=str, help="specify the prompt dir")
    parser.add_argument("-i", "--input", type=str, help="specify input data")
    parser.add_argument("-o", "--output", type=str, help="specify output data")
    parser.add_argument(
        "-m",
        "--mode",
        type=str,
        default="async",
        choices=["async", "mp", "seq"],
        help="specify the run mode",
    )
    parser.add_argument(
        "--llm",
        type=str,
        choices=["lmdeploy", "vllm", "mlx", "ollama", "openai", "torch"],
        default="openai",
        help="specify the llm backend",
    )
    parser.add_argument("--model", type=str, help="specify the model name or path")
    parser.add_argument(
        "--rag",
        type=str,
        choices=["json", "http"],
        default="http",
        help="specify the rag backend",
    )
    parser.add_argument("--split", type=int, help="split the data into parts to run")
    parser.add_argument("--png", action="store_true", help="export graph as png")
    parser.add_argument("--log", action="store_true", help="save logs")
    parser.add_argument("--test", action="store_true", help="run test")
    parser.add_argument(
        "--serve",
        action="store_true",
        default=False,
        help="serve the pipeline as website & API",
    )
    parser.add_argument("--port", type=int, help="specify the server port")

    parser.add_argument(
        "--env",
        action="store_true",
        default=False,
        help="run in environment mode, ignoring other required options",
    )
    parser.add_argument(
        "--reload",
        action="store_true",
        default=False,
        help="enable auto-reload when serving (uvicorn reload)",
    )
    parser.add_argument("--version", action="version", version=get_version())

    args, _ = parser.parse_known_args()

    if args.env:
        return args

    if not args.serve and not args.pipeline and not args.pipeline_dir:
        parser.error(
            "the following arguments are required: -p/--pipeline or -d/--pipeline_dir"
        )

    if args.log:
        os.environ["SAVE_LOG"] = "1"
    return args


def build_pm(args):
    """Construct a PipelineManager instance using parsed args."""
    from .managers import PipelineManager, PromptManager

    if args.prompt:
        prompt_manager = PromptManager(prompts_dir=args.prompt)
    else:
        prompt_manager = None

    return PipelineManager(
        run_mode=args.mode,
        llm_type=args.llm,
        rag_type=args.rag,
        pipes_dir=args.pipeline_dir,
        prompt_manager=prompt_manager,
    )


def build_server(args=None):
    """Factory used by uvicorn when serving with reload.
    Relies on SIGMAFLOW_CMD_ARGS env var to reconstruct CLI arguments.
    """
    from .server import PipelineServer

    if args is None:
        try:
            data = json.loads(os.getenv("SIGMAFLOW_CMD_ARGS", "{}"))
        except Exception:
            data = {}

        class Dummy: pass
        args = Dummy()
        for key in ["mode", "llm", "rag", "pipeline_dir", "prompt"]: setattr(args, key, data.get(key))

    server = PipelineServer(pipeline_manager=build_pm(args))
    return server.app


def main():
    args = setup_args()

    if args.env:
        check_env()
        return

    if args.model:
        os.environ["MODEL_PATH"] = args.model

    # persist args in env for reload subprocesses
    if args.serve and args.reload:
        os.environ["SIGMAFLOW_CMD_ARGS"] = json.dumps({
            k: v for k, v in vars(args).items() if k in ["mode", "llm", "rag", "pipeline_dir", "prompt"]
        })

    if args.pipeline:
        pipefile = Path(args.pipeline)
        pipe = build_pm(args).add_pipe(pipefile.stem, pipefile=pipefile)

        if args.input:
            data = jload(args.input)
            r = pipe.run(data, split=args.split, save_perf=args.png)
        elif args.png:
            pipe.to_png(f"{pipefile.stem}.png")
        else:
            # run without input data
            r = pipe.run({}, save_perf=False)
        
        if args.output:
            if type(r) is tuple:
                jdump(r[0], args.output)
            elif type(r) is list:
                jdump([i for i, _ in r], args.output)
    elif args.serve:
        import uvicorn

        port = args.port or int(os.getenv("PORT", 8000))
        reload_dirs = [str(Path(__file__).resolve().parents[1])]
        uvicorn.run(
            "sigmaflow.cmd:build_server" if args.reload else build_server(args),
            host="0.0.0.0",
            port=port,
            log_config=None,
            log_level=os.getenv("LOGGING_LEVEL", "INFO").lower(),
            reload=args.reload,
            reload_dirs=reload_dirs,
        )
