from dotenv import load_dotenv

load_dotenv()
import sys
import json
from pathlib import Path

sys.path.append(".")
sys.path.append("..")
from sigmaflow import PipelineManager

test_task = {"demo_pipeline": json.load(open("demo_data.json"))}


def test(run_mode):
    cur_dir = Path(__file__).parent
    pm = PipelineManager(run_mode=run_mode, pipes_dir=cur_dir)

    for pipe_name, data in test_task.items():
        results = pm.pipes[pipe_name].run(data, save_perf=False)


test("async")
