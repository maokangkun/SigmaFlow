"""_sigma_usage 聚合健壮性: 消息 at 字段的各历史形态不能炸统计。

回归: run-dc88aaa0 有一条 assistant 消息 at='1794539856015'(epoch 毫秒
字符串), 旧实现 day_key = at[:10] = '1794539856' 送进 date.fromisoformat
抛 ValueError(month must be in 1..12) → 设置页 Token 用量 HTTP 500。
"""

import pytest

import sigmaflow.server.science as science
from sigmaflow.server.science import _sigma_usage


@pytest.fixture(autouse=True)
def _quiet_pricing(monkeypatch):
    """屏蔽 LiteLLM 官方计价(未知模型名会打 Provider List 噪音)。"""
    monkeypatch.setattr(science, "_litellm_message_cost", lambda *a, **k: 0.0)


def _msg(at, tokens=100, prompt=1000):
    return {
        "role": "assistant",
        "content": "ok",
        "at": at,
        "tokens": tokens,
        "promptTokens": prompt,
        "model": "test-model",
    }


def _conv(cid, msgs):
    return {"id": cid, "title": cid, "content": msgs}


class TestAtFieldShapes:
    def test_epoch_ms_string_no_crash(self):
        # 崩溃现场: epoch 毫秒字符串
        out = _sigma_usage({"c1": _conv("c1", [_msg("1794539856015")])})
        assert out["totalTokens"] == 1100
        # 1794539856015 ms = 2026-11-13(本地时区), 应归入正确日期而非炸掉
        assert out["days"] and out["days"][0]["date"] == "2026-11-13"

    def test_epoch_ms_number(self):
        out = _sigma_usage({"c1": _conv("c1", [_msg(1794910764986)])})
        assert out["days"], "epoch 毫秒数字应归入有效日期"

    def test_epoch_seconds(self):
        out = _sigma_usage({"c1": _conv("c1", [_msg(1794910764)])})
        assert out["days"], "秒级时间戳应自动升为毫秒"

    def test_none_at_buckets_today(self):
        out = _sigma_usage({"c1": _conv("c1", [_msg(None)])})
        assert len(out["days"]) == 1  # 回退今天

    def test_iso_string_unchanged(self):
        out = _sigma_usage({"c1": _conv("c1", [_msg("2026-11-01 10:00:00")])})
        assert out["days"][0]["date"] == "2026-11-01"

    def test_garbage_at_ignored_in_streaks(self):
        # 混合脏数据: streak 防御跳过非法日期键, 不抛异常
        msgs = [
            _msg("2026-11-01 09:00:00"),
            _msg("garbage"),
            _msg("1794539856015"),
        ]
        out = _sigma_usage({"c1": _conv("c1", msgs)})
        assert out["totalSessions"] == 1
        assert out["longestStreakDays"] >= 1

    def test_session_ms_from_epoch_string(self):
        # 会话行的 startMs/endMs 也要能从 epoch 字符串推导
        out = _sigma_usage(
            {
                "c1": _conv(
                    "c1",
                    [
                        {"role": "user", "content": "q", "at": "1794539856015"},
                        _msg("1794539860000"),
                    ],
                )
            }
        )
        assert out["sessions"][0]["durationMs"] == 3985
