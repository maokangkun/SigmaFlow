import os
import argparse
from pathlib import Path
from dotenv import load_dotenv
from .utils import json, jload, jdump, get_version, check_env

load_dotenv(".env")


def setup_args():
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", help="commands")

    # Pipeline
    pipe_parser = subparsers.add_parser("pipe", help="Pipeline mode")
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
    pipe_parser.add_argument(
        "--split", type=int, help="split the data into parts to run"
    )
    pipe_parser.add_argument("--png", action="store_true", help="export graph as png")
    pipe_parser.add_argument("--log", action="store_true", help="save logs")
    pipe_parser.add_argument("--test", action="store_true", help="run test")

    # server
    serve_parser = subparsers.add_parser("serve", help="Server mode (website & API)")
    serve_parser.add_argument("--port", type=int, help="specify the server port")
    serve_parser.add_argument(
        "--reload",
        action="store_true",
        default=False,
        help="enable auto-reload when serving (uvicorn reload)",
    )

    # agent
    agent_parser = subparsers.add_parser("agent", help="Agent mode")
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
    agent_parser.add_argument(
        "--support-tool",
        action="store_true",
        default=False,
        help="enable support for tool usage in the agent",
    )
    agent_parser.add_argument(
        "--debug",
        action="store_true",
        default=False,
        help="debug mode",
    )
    agent_parser.add_argument(
        "--model",
        type=str,
        default=None,
        help="model name (falls back to $MODEL)",
    )
    agent_parser.add_argument(
        "--base-url",
        type=str,
        default=None,
        help="API base URL (falls back to $ANTHROPIC_BASE_URL / $OPENAI_BASE_URL)",
    )
    agent_parser.add_argument(
        "--model-id",
        type=str,
        default=None,
        help="use a model configured in the web UI by id (e.g. md-xxxx, reads ~/.sigmaflow/science/models.json)",
    )
    agent_parser.add_argument(
        "--api-key",
        type=str,
        default=None,
        help="API key (falls back to $API_KEY)",
    )

    # env
    subparsers.add_parser("env", help="Environment mode")

    # other
    parser.add_argument("--version", action="version", version=get_version())

    # args, _ = parser.parse_known_args()
    args = parser.parse_args()

    if args.command == "pipe":
        if not args.pipeline and not args.pipeline_dir:
            parser.error(
                "the following arguments are required: -p/--pipeline or -d/--pipeline_dir"
            )

        if args.log:
            os.environ["SAVE_LOG"] = "1"

        if args.model:
            os.environ["MODEL_PATH"] = args.model

    return args


def build_pm(args):
    """Construct a PipelineManager instance using parsed args."""
    from .managers import PipelineManager, PromptManager

    if hasattr(args, "prompt") and args.prompt:
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

    try:
        data = json.loads(os.getenv("SIGMAFLOW_CMD_ARGS", "{}"))
    except Exception:
        data = {}

    if args is None:

        class Dummy:
            pass

        args = Dummy()

    for key in ["mode", "llm", "rag", "pipeline_dir", "prompt"]:
        if not hasattr(args, key):
            setattr(args, key, data.get(key))
    # serve 是常驻 API 服务: /api/run 走 async 引擎, 管线缺省必须建成 async 模式,
    # 否则 node.run property 解析到 seq_run, async 任务三参会直接炸。
    args.mode = args.mode or "async"

    server = PipelineServer(pipeline_manager=build_pm(args))
    return server.app


def main():
    args = setup_args()
    match args.command:
        case "env":
            check_env()
        case "pipe":
            pm = build_pm(args)
            pipefile = Path(args.pipeline)
            if not pipefile.exists():
                # -p 传的是管线名: 按 pipes_dir + 管线后缀解析成真实文件。
                # 此前名字被直接当路径传给 calc_hash, 后缀非 _pipeline 的工程
                # (如 _agent)会得到 ENOENT。
                pipefile = pm.pipes_dir / f"{args.pipeline}{pm.pipeline_suffix}.py"
                if not pipefile.exists():
                    available = sorted(
                        x.stem.removesuffix(pm.pipeline_suffix)
                        for x in pm.pipes_dir.glob(f"*{pm.pipeline_suffix}.py")
                    )
                    raise SystemExit(
                        f"pipeline '{args.pipeline}' not found in {pm.pipes_dir} "
                        f"(suffix '{pm.pipeline_suffix}'); available: {available}"
                    )
            pipe = pm.add_pipe(pipefile.stem, pipefile=pipefile)

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
        case "serve":
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
        case "agent":
            from .agent import cli

            tools = [t.strip() for t in args.tool.split(",")] if args.tool else None
            cli(
                args.query,
                args.method,
                available_tools=tools,
                debug=args.debug,
                support_tool=args.support_tool,
                model=args.model,
                base_url=args.base_url,
                api_key=args.api_key,
                model_id=args.model_id,
            )
        case _:
            pass
