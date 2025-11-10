import os
import argparse
from pathlib import Path
from dotenv import load_dotenv
load_dotenv('.env')

from .utils import *

def get_version():
    import importlib.metadata
    try:
        return importlib.metadata.version("sigmaflow")
    except importlib.metadata.PackageNotFoundError:
        return "unknown"

def setup_args():
    parser = argparse.ArgumentParser()

    parser.add_argument('-p', '--pipeline', type=str, help='specify the pipeline to run')
    parser.add_argument('-d', '--pipeline_dir', type=str, help='specify the pipeline dir to run')
    parser.add_argument('-i', '--input', type=str, help='specify input data')
    parser.add_argument('-o', '--output', type=str, help='specify output data')
    parser.add_argument('-m', '--mode', type=str, default='async', choices=['async', 'mp', 'seq'], help='specify the run mode')
    parser.add_argument('--llm', type=str, choices=['lmdeploy', 'vllm', 'mlx', 'ollama', 'openai', 'torch'], default='openai', help='specify the llm backend')
    parser.add_argument('--model', type=str, help='specify the model path')
    parser.add_argument('--rag', type=str, choices=['json', 'http'], default='http', help='specify the rag backend')
    parser.add_argument('--split', type=int, help='split the data into parts to run')
    parser.add_argument('--png', action='store_true', help='export graph as png')
    parser.add_argument('--log', action='store_true', help='save logs')
    parser.add_argument('--test', action='store_true', help='run test')
    parser.add_argument('--serve', action='store_true', default=False, help='serve the pipeline as website & API')
    
    parser.add_argument('--env', action='store_true', default=False, help='run in environment mode, ignoring other required options')
    parser.add_argument('--version', action='version', version=get_version())

    args, _ = parser.parse_known_args()

    if args.env:
        return args

    if not args.serve and not args.pipeline and not args.pipeline_dir:
        parser.error("the following arguments are required: -p/--pipeline or -d/--pipeline_dir")

    if args.log: os.environ['SAVE_LOG'] = '1'
    return args

def main():
    args = setup_args()

    if args.env:
        test_env()
        return

    if args.model:
        os.environ['MODEL_PATH'] = args.model

    from .manager import PipelineManager
    pm = PipelineManager(run_mode=args.mode, llm_type=args.llm, rag_type=args.rag, pipes_dir=args.pipeline_dir)

    if args.pipeline:
        pipefile = Path(args.pipeline)
        pipe = pm.add_pipe(pipefile.stem, pipefile=pipefile)

    if args.input:
        data = jload(args.input)
        r = pipe.run(data, split=args.split, save_perf=args.png)

        if args.output:
            if type(r) is tuple: jdump(r[0], args.output)
            elif type(r) is list: jdump([i for i,_ in r], args.output)
    elif args.png:
        pipe.to_png(f'{pipefile.stem}.png')
    elif args.serve:
        import uvicorn
        from .server import PipelineServer

        port = int(os.getenv('PORT', 8000))
        server = PipelineServer(pipeline_manager=pm)
        uvicorn.run(server.app, host="0.0.0.0", port=port, log_config=None, log_level=os.getenv('LOGGING_LEVEL', 'INFO').lower())
