from pathlib import Path
from dotenv import load_dotenv
from sigmaflow.utils import jload
from sigmaflow.manager import PipelineManager

load_dotenv()


def test(run_mode):
    cur_dir = Path(__file__).parent
    pm = PipelineManager(run_mode=run_mode, pipes_dir=cur_dir)

    test_task = {"demo_pipeline": jload("demo_input.json")}
    for pipe_name, data in test_task.items():
        _ = pm.pipes[pipe_name].run(data, save_perf=False)


test("async")
