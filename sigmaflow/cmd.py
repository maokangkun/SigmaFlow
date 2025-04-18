import os
import argparse
from pathlib import Path
from dotenv import load_dotenv
load_dotenv()

from .utils import *

def setup_args():
    parser = argparse.ArgumentParser()

    parser.add_argument('-p', '--pipeline', type=str, required=True, help='specify the pipeline to run')
    parser.add_argument('-i', '--input', type=str, help='specify input data')
    parser.add_argument('-o', '--output', type=str, help='specify output data')
    parser.add_argument('-m', '--mode', type=str, default='async', choices=['async', 'mp', 'seq'], help='specify the run mode')
    parser.add_argument('--llm', type=str, choices=['lmdeploy', 'vllm', 'mlx', 'ollama', 'openai', 'torch'], help='specify the llm backend')
    parser.add_argument('--rag', type=str, choices=['json', 'http'], help='specify the rag backend')
    parser.add_argument('--split', type=int, help='split the data into parts to run')
    parser.add_argument('--png', action='store_true', help='export graph as png')
    parser.add_argument('--log', action='store_true', help='save logs')
    parser.add_argument('--test', action='store_true', help='run test')

    args, _ = parser.parse_known_args()

    if args.log: os.environ['SAVE_LOG'] = '1'
    return args

def main():
    args = setup_args()
    pipefile = Path(args.pipeline)

    from .manager import PipelineManager
    pm = PipelineManager(run_mode=args.mode, llm_type=args.llm, rag_type=args.rag)
    pipe = pm.add_pipe(pipefile.stem, pipefile=pipefile)

    if args.input:
        data = jload(args.input)
        r = pipe.run(data, split=args.split, save_perf=args.png)

        if args.output:
            if type(r) is tuple: jdump(r[0], args.output)
            elif type(r) is list: jdump([i for i,_ in r], args.output)
    elif args.png:
        pipe.to_png(f'{pipefile.stem}.png')

