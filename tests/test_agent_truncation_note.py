import re

from sigmaflow.agent.agent import _retry_after_seconds
from sigmaflow.server.science import _truncation_note

# 真实网关 429 文本(2026-11-03 science 会话 run-76ab74aa 抓到的原文形状)
REAL_429 = (
    "Error code: 429 - {'error': {'code': 'cluster_rpm_rate_limit_exceeded', "
    "'details': {'limit_scope': 'cluster', 'limit_type': 'rpm', "
    "'retry_after': 46}, 'message': 'Cluster RPM rate limit exceeded.', "
    "'type': 'rate_limit_error'}}"
)


def test_truncation_note_reports_upstream_failure_not_budget():
    """限流打断必须如实报因, 不能再说"轮次预算已用完"误导用户查预算。"""
    info = {"error": REAL_429, "used_tools": [["ls", "ok"]] * 29}
    note = _truncation_note(info, [])
    assert "上游模型接口连续失败" in note
    assert "cluster_rpm_rate_limit_exceeded" in note
    assert "轮次预算已用完" not in note
    assert "继续" in note


def test_truncation_note_budget_exhaustion_unchanged():
    """真·轮次耗尽(agent 写入"轮次上限"语义)保持原预算文案。"""
    info = {"error": "已达单次回复的轮次上限(416轮): 长任务在预算内未完成"}
    note = _truncation_note(info, [])
    assert "轮次预算已用完" in note
    assert "上游模型接口连续失败" not in note


def test_truncation_note_files_appended():
    info = {"error": "", "used_tools": [["run", "ok"]]}
    note = _truncation_note(info, ["/tmp/a.csv", "/tmp/b.png"])
    assert "本轮产出文件" in note
    assert "- /tmp/a.csv" in note


def test_retry_after_extraction():
    """真实 429 文本里的 retry_after 要能取到, 且封顶防卡死。"""
    assert _retry_after_seconds(REAL_429) == 46
    assert _retry_after_seconds("'retry_after': 99999") == 120
    assert _retry_after_seconds("Error code: 500 - boom") == 0
    assert _retry_after_seconds("") == 0
    # 无 retry_after 的报错不影响退避(0 时调用方用自己的指数退避)
    assert _retry_after_seconds("Error code: 429 - too many requests") == 0


def test_retry_after_regex_shape():
    """护栏: 网关字段形状变化时这里先红, 而不是线上静默失配。"""
    mo = re.search(r"retry_after['\"]?\s*[:=]\s*(\d+)", REAL_429)
    assert mo is not None and mo.group(1) == "46"
