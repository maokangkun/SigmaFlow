"""管线引擎: seq 模式无 inp 节点、运行期回调中毒后的 /run 恢复。"""

import asyncio
import threading
from copy import deepcopy
from functools import partial

import pytest

import sigmaflow.pipeline.graph as graph_mod
from sigmaflow.managers.pipeline_manager import PipelineManager
from sigmaflow.pipeline.pipeline import Pipeline
from sigmaflow.server.admin_storage import AdminStorage
from sigmaflow.server.api import load_runnable_pipe


def build_manager(tmp_path, monkeypatch, run_mode):
    # Graph 在初始化时会建 AdminStorage: 钉到 tmp, 不写 ~/.sigmaflow。
    storage = AdminStorage(storage_dir=str(tmp_path / "admin"))
    monkeypatch.setattr(graph_mod, "get_admin_storage", lambda: storage)
    return PipelineManager(run_mode=run_mode, pipes_dir=str(tmp_path / "pipes"))


SEQ_CONF = {
    # CONFIG: ConfigNode 的 post_init 要求 llm 键存在。
    "CONFIG": {"llm": "openai", "model": "test-model"},
    # 无 inp 的纯产出节点: 修 get_inps_seq 之前这里 KeyError: 'inp'
    "seed": {"value": "seed", "out": "seed_out", "next": ["stamp"]},
    "stamp": {"code": "def g():\n    return 42", "out": "n42", "next": []},
}


def test_seq_mode_runs_nodes_without_inp(tmp_path, monkeypatch):
    pm = build_manager(tmp_path, monkeypatch, run_mode="seq")
    pm.add_pipe("seqdemo", pipeconf=deepcopy(SEQ_CONF))
    pipe = pm.pipes["seqdemo"]
    result, _info = pipe.run({"anything": 1})  # dict 输入返回 (结果, 性能信息)
    assert result["seed_out"] == "seed"
    assert result["n42"] == 42


def test_deepcopy_poisoned_pipe_recovers(tmp_path, monkeypatch):
    """WS 任务把携带线程/队列对象的回调留在单例上 → 下一次 /run deepcopy 500。

    用 TaskWorker 同款形态(partial 绑定持有 asyncio.Queue/锁 的实例)复现:
    load_runnable_pipe 清掉回调后重拷成功 —— 返回的是隔离副本而非单例本体。
    """

    class FakeWorker:
        def __init__(self):
            self.q = asyncio.Queue()
            self.lk = threading.Lock()

        def send(self, *a, **k):
            pass

    pm = build_manager(tmp_path, monkeypatch, run_mode="async")
    conf = {
        "CONFIG": {"llm": "openai", "model": "test-model"},
        "noinputs": {"code": "def g():\n    return 1", "out": "o1", "next": []},
    }
    pm.add_pipe("demo", pipeconf=deepcopy(conf))
    raw = pm.pipes["demo"]
    worker = FakeWorker()
    raw.add_node_callback(finish_cb=[partial(worker.send, x=1)])

    # 中毒态: deepcopy 直接挂(线程/队列对象不可拷)
    with pytest.raises(Exception):
        deepcopy(raw)

    pipe = load_runnable_pipe(pm, "demo")
    # 清回调后重拷: 返回隔离副本(不是单例本体), 单例残留回调已清
    assert isinstance(pipe, Pipeline)
    assert pipe is not raw
    assert all(not n.finish_callbacks for n in raw.pipegraph.node_manager.values())
    # 清空后 deepcopy 恢复可用(重启才恢复的病灶消失)
    deepcopy(pipe)


def test_clean_pipe_prefers_deepcopy(tmp_path, monkeypatch):
    pm = build_manager(tmp_path, monkeypatch, run_mode="async")
    conf = {
        "CONFIG": {"llm": "openai", "model": "test-model"},
        "noinputs": {"code": "def g():\n    return 1", "out": "o1", "next": []},
    }
    pm.add_pipe("demo", pipeconf=conf)
    pipe = load_runnable_pipe(pm, "demo")
    # 未中毒: 正常走 deepcopy 分支(副本, 不是单例本体)
    assert pipe is not pm.pipes["demo"]


def test_structurally_poisoned_pipe_rebuilds_from_source(tmp_path, monkeypatch):
    """回调清空也救不回的中毒(节点上挂了锁) → 从源文件强制重建新单例。

    重建必须绕过 manager 的 hash 缓存: 文件没变时缓存会原样吐回毒单例。
    """
    pm = build_manager(tmp_path, monkeypatch, run_mode="async")
    pipes_dir = tmp_path / "pipes"
    pipes_dir.mkdir(exist_ok=True)
    src = pipes_dir / "demo_pipeline.py"
    src.write_text(
        "pipeline = {\n"
        '    "CONFIG": {"llm": "openai", "model": "test-model"},\n'
        '    "seed": {"value": "v", "out": "o1", "next": []},\n'
        "}\n",
        encoding="utf-8",
    )
    pm.add_pipe("demo", pipefile=src)
    raw = pm.pipes["demo"]
    # 非回调类毒化: remove_node_callbacks 够不着的属性
    raw.pipegraph.node_manager["seed"]._poison = threading.Lock()
    with pytest.raises(Exception):
        deepcopy(raw)

    pipe = load_runnable_pipe(pm, "demo")
    # 重建路径: 新实例替换毒单例, 与源文件同名注册
    assert pipe is not raw
    assert pm.pipes["demo"] is pipe
    assert not hasattr(pipe.pipegraph.node_manager["seed"], "_poison")
    # 新单例干净: 后续请求恢复正常 deepcopy 路径
    assert load_runnable_pipe(pm, "demo") is not pipe
