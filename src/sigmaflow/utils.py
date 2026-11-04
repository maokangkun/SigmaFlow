import re
import os
import ast
import sys
import json
import uuid
import shutil
import hashlib
import asyncio
import requests
import platform
import datetime
import importlib
import subprocess
import collections
from functools import wraps
from pathlib import Path, PosixPath


def get_version():
    try:
        return importlib.metadata.version("sigmaflow")
    except importlib.metadata.PackageNotFoundError:
        return "unknown"


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
    with open(inp, "r", encoding="utf-8") as f:
        return json.load(f)


def jdump(obj, out):
    with open(out, "w", encoding="utf-8") as f:
        if isinstance(obj, (dict, list)):
            json.dump(obj, f, indent=4, ensure_ascii=False)
        elif isinstance(obj, str):
            f.write(obj)
        else:
            raise ValueError(f"Unexpected type: {type(obj)}")


def calc_hash(obj=None, file=None):
    if obj:
        hash_sha256 = hashlib.sha256()
        hash_sha256.update(json.dumps(obj, sort_keys=True).encode("utf-8"))
    elif file:
        hash_sha256 = hashlib.sha256()
        with open(file, "rb") as f:
            for chunk in iter(lambda: f.read(4096), b""):
                hash_sha256.update(chunk)
    else:
        hash_sha256 = hashlib.sha256(os.urandom(32))
    return hash_sha256.hexdigest()[-16:]


def get_latest_version(lib):
    from packaging import version

    package_name = lib[1]
    if package_name == "apex":
        return package_name, None
    if package_name == "swift":
        package_name = "ms-swift"
    url = f"https://pypi.org/pypi/{package_name}/json"
    response = requests.get(url)
    if response.status_code != 200:
        return package_name, None

    data = response.json()
    versions = data["releases"].keys()
    latest_version = max(versions, key=version.parse)
    return lib[1], latest_version


def check_env():
    from rich.table import Table
    from rich.console import Console
    from rich.progress import Progress
    from importlib.metadata import version as get_pkg_version
    from concurrent.futures import ThreadPoolExecutor, as_completed

    cache_dir = Path.home() / ".config/sigmaflow"
    cache_dir.mkdir(parents=True, exist_ok=True)

    console = Console()
    table = Table(title="LLM Environment Check Results")
    table.add_column("Library", style="cyan", justify="left")
    table.add_column("Status", style="green", justify="left")
    table.add_column("Details", style="white", justify="left")
    table.add_row(
        "OS",
        "Installed",
        f"Platform: {platform.system()}, Release: {platform.release()}",
    )
    table.add_row("Python", "Installed", "Version: " + sys.version.split()[0])

    if shutil.which("nvidia-smi"):
        driver_version = (
            os.popen("nvidia-smi --version | grep DRIVER | awk '{print $4}'")
            .read()
            .strip()
        )
        cuda_version = (
            os.popen("nvidia-smi --version | grep CUDA | awk '{print $4}'")
            .read()
            .strip()
        )
        table.add_row("Driver", "Installed", f"Version: {driver_version}")
        table.add_row("CUDA", "Installed", f"Version: {cuda_version}")

    try:
        import torch

        try:
            nccl_version = ".".join(map(str, torch.cuda.nccl.version()))
        except Exception:
            nccl_version = None

        table.add_row(
            "cuDNN", "Installed", f"Version: {torch.backends.cudnn.version()}"
        )
        table.add_row(
            "NCCL",
            "Installed",
            f"Version: {nccl_version}",
        )
    except ImportError:
        table.add_row("cuDNN", "[red]Not Installed[/red]")
        table.add_row("NCCL", "[red]Not Installed[/red]")

    if shutil.which("nvcc"):
        nvcc_version = (
            os.popen("nvcc --version | grep release")
            .read()
            .split("release")[-1]
            .strip()
        )
        table.add_row("Toolkit", "Installed", f"Version: {nvcc_version}")
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
        ("ModelScope", "modelscope"),
        ("xFormers", "xformers"),
        ("FlashAttention3", "flash_attn_3"),
        ("FlashInfer", "flashinfer"),
        ("NumPy", "numpy"),
        ("XTuner", "xtuner"),
    ]
    libraries = sorted(libraries)

    versions_file = cache_dir / "versions.json"
    if not versions_file.exists() or datetime.datetime.fromtimestamp(
        versions_file.stat().st_mtime
    ).strftime("%Y%m%d") < datetime.datetime.now().strftime("%Y%m%d"):
        versions_dict = {}
        with Progress() as progress:
            task = progress.add_task(
                "[cyan]Checking latest versions...", total=len(libraries)
            )

            with ThreadPoolExecutor(max_workers=8) as executor:
                future_to_lib = {
                    executor.submit(get_latest_version, lib): lib for lib in libraries
                }
                for future in as_completed(future_to_lib):
                    package_name, version = future.result()
                    versions_dict[package_name] = version
                    progress.update(task, advance=1)
        jdump(versions_dict, versions_file)
    else:
        versions_dict = jload(versions_file)

    rows = []
    with Progress() as progress:
        task = progress.add_task("[cyan]Checking libraries...", total=len(libraries))
        for name, module in libraries:
            ver = None
            details = ""

            try:
                ver = get_pkg_version(module)
            except ImportError:
                try:
                    ver = get_pkg_version(name)
                except ImportError:
                    ver = None

            if ver:
                details = f"Version: {ver}"

            try:
                lib = __import__(module)
                status = "Installed"

                if not ver:
                    ver = lib.__version__

                if module == "torch":
                    details += f", CUDA: {lib.cuda.is_available()}"

                v = versions_dict.get(module, None)
                if v and v != ver and not ver.startswith(v) and v > ver:
                    details += f"[red]  (Latest: {v})[/red]"
            except ImportError:
                status = "[red]Not Installed[/red]"
            rows.append((name, status, details))
            progress.update(task, advance=1)

    rows.sort(key=lambda x: x[0])
    for row in rows:
        table.add_row(*row)
    table.add_section()

    try:
        import pynvml

        try:
            pynvml.nvmlInit()
            device_count = pynvml.nvmlDeviceGetCount()
            for i in range(device_count):
                handle = pynvml.nvmlDeviceGetHandleByIndex(i)
                name = pynvml.nvmlDeviceGetName(handle)
                meminfo = pynvml.nvmlDeviceGetMemoryInfo(handle)
                memstr = f"{int(meminfo.used / 1024 / 1024 / 1024):d}G / {int(meminfo.total / 1024 / 1024 / 1024):d}G, {meminfo.used / meminfo.total:3.0%}"
                temp = pynvml.nvmlDeviceGetTemperature(handle, 0)
                utlization = pynvml.nvmlDeviceGetUtilizationRates(handle)
                table.add_row(
                    "GPU" if not i else "",
                    f"{i}",
                    f"{name}, \\[mem] {memstr}, \\[utl] {utlization.gpu:3d}%, {temp:3d}°C",
                )
            pynvml.nvmlShutdown()
        except pynvml.NVMLError:
            pass
    except ImportError:
        pass

    console.print(table)


def mmdc(mermaid, img):
    from .log import log

    if check_cmd_exist("mmdc"):
        tmp_file = f"/tmp/{uuid.uuid4()}"
        with open(tmp_file, "w") as f:
            f.write(mermaid)
        log.debug(f"Save mermaid in: {tmp_file}")
        try:
            subprocess.run(
                ["mmdc", "-i", tmp_file, "-o", img, "-s", "3"],
                capture_output=True,  # 同时捕获stdout和stderr
                text=True,
                check=True,
            )
        except subprocess.CalledProcessError as e:
            log.error(f"mmdc命令执行失败，错误信息：{e.stderr}")
        else:
            log.debug(f"Save {img}")
    else:
        log.warning("Please install mmdc to generate mermaid images.")


def async_compat(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        try:
            # 检查是否在异步上下文中
            asyncio.get_running_loop()

            # 如果在异步上下文中，返回协程
            async def async_wrapper():
                return func(*args, **kwargs)

            return async_wrapper()
        except RuntimeError:
            # 如果在同步上下文中，直接执行
            return func(*args, **kwargs)

    return wrapper


def sync_compat(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        try:
            asyncio.get_running_loop()
            return func(*args, **kwargs)
        except RuntimeError:
            return asyncio.run(func(*args, **kwargs))

    return wrapper


def remove_think_content(text):
    # 推理网关截断/失败时 content 为 None: 回空串, 交回上层重试语义。
    if text is None:
        return ""
    regex = r"(^<think>[^<]*(?:<(?!/?think>)[^<]*)*<\/think>)"
    text = re.sub(regex, "", text).strip()
    return text


def extract_json(text, remove_think=True):
    # None 响应安全落地: 让 return_json 节点往外 yield None 以触发重试。
    if text is None:
        text = ""
    text = text.strip()

    if remove_think:
        text = remove_think_content(text)

    try:
        j = ast.literal_eval(text)
        return j
    except Exception:
        pass

    try:
        j = json.loads(text)
        return j
    except Exception:
        pass

    if m := re.findall(r"```(?:json)?(.*?)```", text, re.DOTALL):
        try:
            j = json.loads(m[0])
            return j
        except Exception:
            pass
    return None


class ThinkStreamSplitter:
    """think 标签感知的流式 content 分帧器: 把 think 段与正文切开。"""

    def __init__(self):
        self.mode = "content"  # 当前段状态: content | think
        self.tag = self._tag("think") if False else None
        self._open = chr(60) + "think" + chr(62)
        self._close = chr(60) + "/think" + chr(62)
        self.tail = ""

    def feed(self, delta):
        buf = self.tail + delta
        self.tail = ""
        out = []
        while buf:
            tag = self._open if self.mode == "content" else self._close
            i = buf.find(tag)
            if i == -1:
                # 尾部可能是劈开的半个标签: 留住等下一个 delta。
                k = 0
                for m in range(min(len(buf), len(tag) - 1), 0, -1):
                    if buf.endswith(tag[:m]):
                        k = m
                        break
                if len(buf) - k:
                    out.append((self.mode, buf[: len(buf) - k]))
                self.tail = buf[len(buf) - k :] if k else ""
                buf = ""
            else:
                if i:
                    out.append((self.mode, buf[:i]))
                self.mode = "think" if tag == self._open else "content"
                buf = buf[i + len(tag) :]
        return out

    def flush(self):
        rest, self.tail = self.tail, ""
        return [(self.mode, rest)] if rest else []


# 系统敏感目录黑名单: present 等只读展示类工具据此放行"项目外但无害"的路径
# (如 /tmp 产物), 同时挡住 /etc /proc 等敏感位置; 前缀精确匹配(含目录自身)。
_PROTECTED_SYSTEM_DIRS = (
    "/etc",
    "/boot",
    "/efi",
    "/proc",
    "/sys",
    "/dev",
    "/root",
    "/run",
    "/usr",
    "/bin",
    "/sbin",
    "/lib",
    "/lib32",
    "/lib64",
    "/libx32",
    "/opt",
    "/srv",
    "/var",
    "/lost+found",
)
# 家目录内的凭据/隐私点(目录或文件): ssh/gpg/云厂商与容器凭据、.netrc 等
_PROTECTED_HOME_DOTS = (
    ".ssh",
    ".gnupg",
    ".aws",
    ".kube",
    ".docker",
    ".azure",
    ".config/gcloud",
    ".netrc",
    ".ssh/authorized_keys",
)


def is_protected_path(path) -> bool:
    """True 当解析后的真实路径落在系统敏感目录或家目录凭据点内(黑名单语义)。

    路径解析失败按受保护处理(拒绝放行优先于误放行)。
    """
    try:
        real = Path(os.path.realpath(os.path.expanduser(str(path)))).as_posix()
    except (OSError, ValueError):
        return True
    home = Path.home().as_posix().rstrip("/") or "/"
    for d in _PROTECTED_SYSTEM_DIRS:
        if real == d or real.startswith(d + "/"):
            return True
    for d in _PROTECTED_HOME_DOTS:
        full = home + "/" + d
        if real == full or real.startswith(full + "/"):
            return True
    return False
