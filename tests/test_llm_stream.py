"""LLM 流式: think/content 分帧、客户端增量路径、节点→SSE 订阅全链转发。"""
import asyncio
from copy import deepcopy
from types import SimpleNamespace


import sigmaflow.clients.llm_openai as llm_openai_mod
import sigmaflow.pipeline.graph as graph_mod
from sigmaflow.server.admin_storage import AdminStorage


OPEN_BR = chr(60)  # <
CLOSE_BR = chr(62)  # >
OPEN_TAG = OPEN_BR + "think" + CLOSE_BR
CLOSE_TAG = OPEN_BR + "/think" + CLOSE_BR


def build_manager(tmp_path, monkeypatch):
    storage = AdminStorage(storage_dir=str(tmp_path / "admin"))
    monkeypatch.setattr(graph_mod, "get_admin_storage", lambda: storage)
    from sigmaflow.managers.pipeline_manager import PipelineManager

    return PipelineManager(run_mode="async", pipes_dir=str(tmp_path / "pipes"))


class _FakeStream:
    def __init__(self, chunks):
        self._chunks = chunks
        self._i = 0

    def __aiter__(self):
        self._i = 0
        return self

    async def __anext__(self):
        if self._i >= len(self._chunks):
            raise StopAsyncIteration
        c = self._chunks[self._i]
        self._i += 1
        return c


class _FakeCompletions:
    def __init__(self, chunks):
        self.chunks = chunks

    async def create(self, **kw):
        assert kw.get("stream") is True
        return _FakeStream(self.chunks)


class _FakeClient:
    def __init__(self, **kargs):
        self.chat = SimpleNamespace(
            completions=_FakeCompletions(kargs["_chunks"])
        )


def chunk(delta, usage=None):
    return SimpleNamespace(
        choices=[SimpleNamespace(delta=delta)],
        usage=usage,
    )


def _delta(reasoning=None, content=None):
    return SimpleNamespace(reasoning_content=reasoning, content=content)


FAKE_CHUNKS = [
    chunk(_delta(reasoning="reason-1")),
    chunk(_delta(content="pre")),
    chunk(_delta(content=OPEN_TAG + "mid-think" + CLOSE_TAG)),
    chunk(_delta(content="post")),
    chunk(
        _delta(),
        usage=SimpleNamespace(prompt_tokens=3, completion_tokens=5),
    ),
]

CONF = {
    "CONFIG": {"llm": "openai", "model": "fake-model"},
        "talk": {"prompt": "hi {x}", "inp": ["x"], "out": "reply", "return_json": False, "next": []},
}


def test_completion_streams_think_and_content(monkeypatch):
    monkeypatch.setattr(
        llm_openai_mod, "AsyncOpenAI", lambda **kw: _FakeClient(_chunks=FAKE_CHUNKS)
    )
    frames = []

    # @sync_compat: 循环外同步调用直接执行并返回结果。
    resp, usage = llm_openai_mod.completion(
        "hello",
        conf={"llm": "openai", "model": "m"},
        stream_cb=lambda k, d: frames.append((k, d)),
    )

    assert frames[0] == ("think", "reason-1")
    assert frames[1:4] == [
        ("content", "pre"),
        ("think", "mid-think"),
        ("content", "post"),
    ]
    assert resp == "prepost"  # think 不混进最终正文
    assert usage == {"prompt_tokens": 3, "completion_tokens": 5}


def test_node_forwards_stream_to_subscription(tmp_path, monkeypatch):
    monkeypatch.setattr(
        llm_openai_mod, "AsyncOpenAI", lambda **kw: _FakeClient(_chunks=FAKE_CHUNKS)
    )
    pm = build_manager(tmp_path, monkeypatch)
    pm.add_pipe("streamdemo", pipeconf=deepcopy(CONF))
    pipe = pm.pipes["streamdemo"]
    frames = []

    def on_stream(node, kind, delta):
        frames.append((node, kind, delta))

    async def go():
        pipe.add_node_callback(stream_cb=[on_stream])
        return await pipe.async_run({"x": "alice"})

    result = asyncio.run(go())

    kinds = [(k, d) for _, k, d in frames]
    assert ("think", "reason-1") in kinds
    # 全链帧序: think(reasoning) → content → think(标签段) → content, 单发一次。
    assert kinds == [
        ("think", "reason-1"),
        ("content", "pre"),
        ("think", "mid-think"),
        ("content", "post"),
    ]
    # 最终 out 是剥离 think 后的文本, 节点帧里 node 名是执行节点
    assert result["reply"] == "prepost"
    assert {n for n, _, _ in frames} == {"talk"}


def test_no_think_sends_disable_flags(monkeypatch):
    """conf 里 no_think 真值时, chat_param 必须带上三类关思考写法。"""
    captured = {}

    class _CapCompletions:
        async def create(self, **kw):
            captured.update(kw)
            return _FakeStream(FAKE_CHUNKS)

    class _CapClient:
        def __init__(self, **kargs):
            self.chat = SimpleNamespace(completions=_CapCompletions())

    monkeypatch.setattr(llm_openai_mod, "AsyncOpenAI", lambda **kw: _CapClient())
    # @sync_compat: 循环外同步调用直接执行并返回结果。
    llm_openai_mod.completion(
        "hi",
        conf={"llm": "openai", "model": "m", "no_think": True},
        stream_cb=lambda k, d: None,
    )
    # SDK 官方字段走顶级; 两家私有写法走 extra_body 进原始 body。
    assert captured["reasoning_effort"] == "none"
    assert captured["extra_body"] == {
        "thinking": {"type": "disabled"},
        "chat_template_kwargs": {"thinking": False},
    }


def test_llm_set_thinking_touches_bound_and_mirror_conf():
    from sigmaflow.clients.llm import LLM

    base = {"llm": "openai", "model": "m"}
    llm = LLM(base)
    assert llm.completion.keywords["conf"] is base  # partial 绑原 dict
    llm.set_thinking(False)
    assert base["no_think"] is True          # partial 绑定的 conf 被改
    assert llm.conf["no_think"] is True      # deepcopy 镜像同步
    llm.set_thinking(True)
    assert base["no_think"] is False
