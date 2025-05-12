import sys
import json
import shutil
import hashlib
import collections
from pathlib import Path, PosixPath

def check_cmd_exist(command):
    return shutil.which(command) is not None

def importpath(path):
    if type(path) is not PosixPath:
        strpath = str(path)
        if not strpath.startswith("/"):
            parent_path = Path(sys._getframe().f_globals.get("__file__", ".")).parent
            path = parent_path / path
        else:
            path = Path(path)

    try:
        sys.path.insert(0, str(path.parent))
        module = __import__(path.stem)
    finally:
        sys.path.pop(0)
    return module

def get_ordered_task(tasks):
    def get_dependencies(task_id, task_info):
        dependencies = []
        for key, value in task_info["inputs"].items():
            if isinstance(value, list):
                for item in value:
                    dep_task, _ = item.split("-")
                    dependencies.append(dep_task)
        return dependencies

    # Step 1: Build dependency graph and indegree count
    graph = collections.defaultdict(list)
    indegree = collections.defaultdict(int)

    for task_id, task_info in tasks.items():
        dependencies = get_dependencies(task_id, task_info)
        for dep in dependencies:
            graph[dep].append(task_id)
            indegree[task_id] += 1

    # Step 2: Topological sort using Kahn's algorithm
    execution_order = []
    queue = collections.deque([task_id for task_id in tasks if indegree[task_id] == 0])

    while queue:
        current = queue.popleft()
        execution_order.append(current)

        for neighbor in graph[current]:
            indegree[neighbor] -= 1
            if indegree[neighbor] == 0:
                queue.append(neighbor)

    return execution_order

def jload(inp):
    with open(inp, 'r', encoding='utf-8') as f:
        return json.load(f)

def jdump(obj, out):
    with open(out, 'w', encoding='utf-8') as f:
        if isinstance(obj, (dict, list)):
            json.dump(obj, f, indent=4, ensure_ascii=False)
        elif isinstance(obj, str):
            f.write(obj)
        else:
            raise ValueError(f"Unexpected type: {type(obj)}")

def calc_sha256(file_path):
    hash_sha256 = hashlib.sha256()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(4096), b""):
            hash_sha256.update(chunk)
    return hash_sha256.hexdigest()

def test_env():
    from rich import print
    from rich.table import Table
    from rich.console import Console
    from rich.progress import Progress

    console = Console()
    table = Table(title="LLM Environment Check Results")
    table.add_column("Library", style="cyan", justify="left")
    table.add_column("Status", style="magenta", justify="left")
    table.add_column("Details", style="white", justify="left")

    libraries = [
        ("PyTorch", "torch", lambda lib: f"Version: {lib.__version__}, CUDA: {lib.cuda.is_available()}"),
        ("Transformer Engine", "transformer_engine", lambda _: f"Version: {lib.__version__}"),
        ("FlashAttention", "flash_attn", lambda _: f"Version: {lib.__version__}"),
        ("Transformers", "transformers", lambda lib: f"Version: {lib.__version__}"),
        ("DeepSpeed", "deepspeed", lambda lib: f"Version: {lib.__version__}"),
        ("Apex", "apex", lambda _: "Apex is available"),
        ("Datasets", "datasets", lambda lib: f"Version: {lib.__version__}"),
        ("Tokenizers", "tokenizers", lambda lib: f"Version: {lib.__version__}"),
        ("vLLM", "vllm", lambda lib: f"Version: {lib.__version__}"),
        ("bitsandbytes", "bitsandbytes", lambda lib: f"Version: {lib.__version__}"),
        ("PEFT", "peft", lambda lib: f"Version: {lib.__version__}"),
        ("TRL", "trl", lambda lib: f"Version: {lib.__version__}"),
        ("wandb", "wandb", lambda lib: f"Version: {lib.__version__}"),
        ("lmdeploy", "lmdeploy", lambda lib: f"Version: {lib.__version__}"),
        ("Megatron-Core", "megatron.core", lambda lib: f"Version: {lib.core.__version__}")
    ]

    rows = []
    with Progress() as progress:
        task = progress.add_task("[cyan]Checking libraries...", total=len(libraries))
        for name, module, details_func in libraries:
            try:
                lib = __import__(module)
                status = "[green]Installed[/green]"
                details = details_func(lib)
            except ImportError:
                status = "[red]Not Installed[/red]"
                details = "N/A"
            rows.append((name, status, details))
            progress.update(task, advance=1)

    rows.sort(key=lambda x: x[0])
    for row in rows: table.add_row(*row)
    console.print(table)
