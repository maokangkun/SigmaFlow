import os
import argparse
from pathlib import Path
from dotenv import load_dotenv
from .utils import json, jload, jdump, get_version, check_env

load_dotenv(".env")


def setup_args():
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest='command', help='commands')

    # Pipeline
    pipe_parser = subparsers.add_parser('pipe', help='Pipeline mode')
    pipe_parser.add_argument(
        "-p", "--pipeline", type=str, help="specify the pipeline to run"
    )
    pipe_parser.add_argument(
        "-d", "--pipeline_dir", type=str, help="specify the pipeline dir to run"
    )
    pipe_parser.add_argument("--prompt", type=str, help="specify the prompt dir")
    pipe_parser.add_argument("-i", "--input", type=str, help="specify input data")
    pipe_parser.add_argument("-o", "--output", type=str, help="specify output data")
    pipe_parser.add_argument(
        "-m",
        "--mode",
        type=str,
        default="async",
        choices=["async", "mp", "seq"],
        help="specify the run mode",
    )
    pipe_parser.add_argument(
        "--llm",
        type=str,
        choices=["lmdeploy", "vllm", "mlx", "ollama", "openai", "torch"],
        default="openai",
        help="specify the llm backend",
    )
    pipe_parser.add_argument("--model", type=str, help="specify the model name or path")
    pipe_parser.add_argument(
        "--rag",
        type=str,
        choices=["json", "http"],
        default="http",
        help="specify the rag backend",
    )
    pipe_parser.add_argument("--split", type=int, help="split the data into parts to run")
    pipe_parser.add_argument("--png", action="store_true", help="export graph as png")
    pipe_parser.add_argument("--log", action="store_true", help="save logs")
    pipe_parser.add_argument("--test", action="store_true", help="run test")

    # server
    serve_parser = subparsers.add_parser('serve', help='Server mode (website & API)')
    serve_parser.add_argument("--port", type=int, help="specify the server port")
    serve_parser.add_argument(
        "--reload",
        action="store_true",
        default=False,
        help="enable auto-reload when serving (uvicorn reload)",
    )

    # agent
    agent_parser = subparsers.add_parser('agent', help='Agent mode')
    agent_parser.add_argument(
        "-q",
        "--query",
        type=str,
        help="Initial query to start the conversation",
    )
    agent_parser.add_argument(
        "-m",
        "--method",
        type=str,
        choices=["anthropic", "openai"],
        default="anthropic",
        help="api interface",
    )
    agent_parser.add_argument(
        "--tool",
        type=str,
        help="specify tools to use (e.g. bash, read, etc.)",
    )

    # env
    subparsers.add_parser('env', help='Environment mode')

    # other
    parser.add_argument("--version", action="version", version=get_version())

    # args, _ = parser.parse_known_args()
    args = parser.parse_args()

    if args.command == 'pipe':
        if not args.serve and not args.pipeline and not args.pipeline_dir:
            parser.error(
                "the following arguments are required: -p/--pipeline or -d/--pipeline_dir"
            )

        if args.log:
            os.environ["SAVE_LOG"] = "1"

        if args.model:
            os.environ["MODEL_PATH"] = args.model

        # persist args in env for reload subprocesses
        if args.serve and args.reload:
            os.environ["SIGMAFLOW_CMD_ARGS"] = json.dumps({
                k: v for k, v in vars(args).items() if k in ["mode", "llm", "rag", "pipeline_dir", "prompt"]
            })

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
    match args.command:
        case 'env':
            check_env()
        case 'pipe':
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
        case 'serve':
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
        case 'agent':
            from .agent import cli
            tools = [t.strip() for t in args.tool.split(",")] if args.tool else None
            cli(args.query, args.method, available_tools=tools)
        case _:
            pass

