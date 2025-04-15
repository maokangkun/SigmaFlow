import asyncio
import argparse
from pathlib import Path
from .manager import PipelineManager
from .utils import *


def setup_args():
    parser = argparse.ArgumentParser()

    parser.add_argument('-p', '--pipeline', type=str, required=True, help='specify the pipeline to run')
    parser.add_argument('-i', '--input', type=str, help='specify input data')
    parser.add_argument('-o', '--output', type=str, help='specify output data')
    parser.add_argument('-m', '--mode', type=str, default='async', choices=['async', 'mp', 'seq'], help='specify the run mode')
    parser.add_argument('--split', type=int, help='split the data into parts to run')
    parser.add_argument('--png', action='store_true', help='export graph as png')
    parser.add_argument('--test', action='store_true', help='run test')

    args, _ = parser.parse_known_args()
    return args

def main():
    args = setup_args()
    pipefile = Path(args.pipeline)

    pm = PipelineManager(run_mode=args.mode)
    pipe = pm.add_pipe(pipefile.stem, pipefile=pipefile)

    if args.input:
        data = jload(args.input)
        r = pipe.run(data, split=args.split, save_perf=args.png)

        if args.output:
            if type(r) is tuple: jdump(r[0], args.output)
            elif type(r) is list: jdump([i for i,_ in r], args.output)
    elif args.png:
        pipe.to_png(f'{pipefile.stem}.png')

