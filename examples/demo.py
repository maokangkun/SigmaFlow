import json
from pathlib import Path
from dotenv import load_dotenv
from sigmaflow import PipelineManager
load_dotenv()

test_task = {"demo_pipeline": json.load(open("demo_data.json"))}


def test(run_mode):
    cur_dir = Path(__file__).parent
    pm = PipelineManager(run_mode=run_mode, pipes_dir=cur_dir)

    for pipe_name, data in test_task.items():
        _ = pm.pipes[pipe_name].run(data, save_perf=False)


test("async")
