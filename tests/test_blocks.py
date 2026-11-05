"""Block 重试语义: 异常重试计数、退避调度形状、耗尽后归因抛错。"""

import asyncio
import pytest

from sigmaflow.blocks import base
from sigmaflow.blocks.base import Block


class FlakyBlock(Block):
    def __init__(self, failures, raise_mode=False):
        super().__init__("t", None, [], [], verbose=False, retry=5)
        self.failures = failures
        self.raise_mode = raise_mode
        self.calls = 0

    async def _call(self, *inp):
        self.calls += 1
        if self.calls <= self.failures:
            if self.raise_mode:
                raise RuntimeError("boom")
            return None, None, None, None
        return "ok", "q", "r", None


def test_block_retries_alloc_exhaustion(monkeypatch):
    monkeypatch.setattr(base, "RETRY_BACKOFF_BASE", 0.0)
    b = FlakyBlock(failures=2)
    out = b("x")  # sync_compat: 循环外调用直接同步执行并返回结果
    assert out == "ok"
    assert b.calls == 3  # 两次失败后第三次成功


def test_block_raises_after_exhaustion(monkeypatch):
    monkeypatch.setattr(base, "RETRY_BACKOFF_BASE", 0.0)
    b = FlakyBlock(failures=99, raise_mode=True)
    with pytest.raises(RuntimeError, match="after 5 attempts: boom"):
        b("x")
    assert b.calls == 5


def test_backoff_grows_exponentially(monkeypatch):
    sleeps = []

    async def fake_sleep(d):
        sleeps.append(d)

    monkeypatch.setattr(base.asyncio, "sleep", fake_sleep)
    b = Block("t", None, [], [], verbose=False)
    for n in (1, 2, 3):
        asyncio.run(b._backoff(n))
    # 抖动加成最多 25%: 下限取洁净的指数底, 上限封 1.25 倍。
    assert sleeps[0] >= base.RETRY_BACKOFF_BASE
    assert sleeps[1] >= base.RETRY_BACKOFF_BASE * 2
    assert sleeps[2] >= base.RETRY_BACKOFF_BASE * 4
    for s in sleeps:
        assert s <= base.RETRY_BACKOFF_BASE * max(1, 2 ** (len(sleeps) - 1)) * 1.26


def test_backoff_capped(monkeypatch):
    sleeps = []

    async def fake_sleep(d):
        sleeps.append(d)

    monkeypatch.setattr(base.asyncio, "sleep", fake_sleep)
    b = Block("t", None, [], [], verbose=False)
    asyncio.run(b._backoff(99))
    assert sleeps[0] <= base.RETRY_BACKOFF_CAP * 1.26
