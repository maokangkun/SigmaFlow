import os
import sys
import json
import shutil
import hashlib
import requests
import platform
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

def get_latest_version(lib):
    from packaging import version
    package_name = lib[1]
    if package_name == "apex": return package_name, None
    if package_name == "swift": package_name = "ms-swift"
    url = f"https://pypi.org/pypi/{package_name}/json"
    response = requests.get(url)
    if response.status_code != 200: return package_name, None

    data = response.json()
    versions = data["releases"].keys()
    latest_version = max(versions, key=version.parse)
    return lib[1], latest_version

def test_env():
    from rich import print
    from rich.table import Table
    from rich.console import Console
    from rich.progress import Progress
    from concurrent.futures import ThreadPoolExecutor, as_completed

    console = Console()
    table = Table(title="LLM Environment Check Results")
    table.add_column("Library", style="cyan", justify="left")
    table.add_column("Status", style="green", justify="left")
    table.add_column("Details", style="white", justify="left")
    table.add_row('OS', "Installed", f"Platform: {platform.system()}, Release: {platform.release()}")
    table.add_row('Python', "Installed", "Version: " + sys.version.split()[0])

    if shutil.which("nvidia-smi"):
        driver_version = os.popen("nvidia-smi --version | grep DRIVER | awk '{print $4}'").read().strip()
        cuda_version = os.popen("nvidia-smi --version | grep CUDA | awk '{print $4}'").read().strip()
        table.add_row('Driver', "Installed", f"Version: {driver_version}")
        table.add_row('CUDA', "Installed", f"Version: {cuda_version}")

    try:
        import torch
        table.add_row('cuDNN', "Installed", f"Version: {torch.backends.cudnn.version()}")
        table.add_row('NCCL', "Installed", f"Version: {'.'.join(map(str,torch.cuda.nccl.version()))}")
    except ImportError:
        table.add_row('cuDNN', "[red]Not Installed[/red]")
        table.add_row('NCCL', "[red]Not Installed[/red]")

    if shutil.which("nvcc"):
        nvcc_version = os.popen("nvcc --version | grep release").read().split('release')[-1].strip()
        table.add_row('Toolkit', "Installed", f"Version: {nvcc_version}")
    table.add_section()

    libraries = [
        ("Apex", "apex"),
        ("PyTorch", "torch"),
        ("Transformer Engine", "transformer_engine"),
        ("FlashAttention", "flash_attn"),
        ("Transformers", "transformers"),
        ("DeepSpeed", "deepspeed"),
        ("Datasets", "datasets"),
        ("Tokenizers", "tokenizers"),
        ("vLLM", "vllm"),
        ("bitsandbytes", "bitsandbytes"),
        ("PEFT", "peft"),
        ("TRL", "trl"),
        ("wandb", "wandb"),
        ("lmdeploy", "lmdeploy"),
        ("Megatron-Core", "megatron.core"),
        ("ms-swift", "swift"),
        ("Triton", "triton"),
        ("ModelScope", "modelscope")
    ]

    versions_dict = {}
    with Progress() as progress:
        task = progress.add_task("[cyan]Checking latest versions...", total=len(libraries))

        with ThreadPoolExecutor(max_workers=8) as executor:
            future_to_lib = {executor.submit(get_latest_version, lib): lib for lib in libraries}
            for future in as_completed(future_to_lib):
                package_name, version = future.result()
                versions_dict[package_name] = version
                progress.update(task, advance=1)

    rows = []
    with Progress() as progress:
        task = progress.add_task("[cyan]Checking libraries...", total=len(libraries))
        for name, module in libraries:
            try:
                lib = __import__(module)
                status = "Installed"

                if module == "megatron.core":
                    ver = lib.core.__version__
                elif module == "apex":
                    ver = "unknown"
                else:
                    ver = lib.__version__

                if module == "apex":
                    details = "Apex is available"
                elif module == "torch":
                    details = f"Version: {ver}, CUDA: {lib.cuda.is_available()}"
                else:
                    details = f"Version: {ver}"
                
                v = versions_dict[module]
                if v and v != ver and not ver.startswith(v) and v > ver:
                    details += f"[red]  (Latest: {v})[/red]"
            except ImportError:
                status = "[red]Not Installed[/red]"
                details = "N/A"
            rows.append((name, status, details))
            progress.update(task, advance=1)

    rows.sort(key=lambda x: x[0])
    for row in rows: table.add_row(*row)
    table.add_section()

    try:
        import pynvml
        pynvml.nvmlInit()
        device_count = pynvml.nvmlDeviceGetCount()
        for i in range(device_count):
            handle = pynvml.nvmlDeviceGetHandleByIndex(i)
            name = pynvml.nvmlDeviceGetName(handle)
            meminfo = pynvml.nvmlDeviceGetMemoryInfo(handle)
            memstr = f'{int(meminfo.used/1024/1024/1024):d}G / {int(meminfo.total/1024/1024/1024):d}G, {meminfo.used/meminfo.total:3.0%}'
            temp = pynvml.nvmlDeviceGetTemperature(handle, 0)
            utlization = pynvml.nvmlDeviceGetUtilizationRates(handle)
            table.add_row('GPU' if not i else '', f'{i}', f"{name}, \\[mem] {memstr}, \\[utl] {utlization.gpu:3d}%, {temp:3d}°C")
        pynvml.nvmlShutdown()
    except ImportError:
        pass

    console.print(table)
