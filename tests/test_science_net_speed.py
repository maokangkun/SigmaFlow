"""状态栏网速统计的行为契约。

网速只统计宿主机真实外部流量: veth 成对接口会把同一份容器流量在两端
各计一次, bond 从属口与主口重复, loopback 是本机回环——全部剔除。
"""

import sys
import time
import types

import pytest

from sigmaflow.server.science import _real_net_nics, _sys_state


class _Nic:
    def __init__(self, sent, recv):
        self.bytes_sent = sent
        self.bytes_recv = recv


@pytest.fixture()
def stub_psutil(monkeypatch):
    """psutil 只需提供 net_io_counters; 其余统计走不到或用不到真实值。"""
    stub = types.SimpleNamespace()
    stub.net_io_counters = lambda pernic=False: _NICS[0]
    stub.cpu_count = lambda: 1
    stub.cpu_percent = lambda interval=None: 0.0
    vm = types.SimpleNamespace(total=8 * 2**30, available=4 * 2**30, percent=50)
    stub.virtual_memory = lambda: vm
    du = types.SimpleNamespace(used=1, total=10, percent=10)
    stub.disk_usage = lambda path: du
    monkeypatch.setitem(sys.modules, "psutil", stub)
    # 隔离全局采样缓存
    monkeypatch.setitem(_sys_state, "net", None)
    return stub


_NICS = [
    {
        "lo": _Nic(10**9, 10**9),
        "veth748dfcd": _Nic(5 * 10**9, 4 * 10**9),
        "vethba83d53": _Nic(4 * 10**9, 5 * 10**9),
        "docker0": _Nic(0, 0),
        "br-abc123": _Nic(0, 0),
        "eth1": _Nic(10**6, 10**6),  # bond 从属口(带 master 链接的机器上会被剔除)
        "bond0": _Nic(2 * 10**6, 3 * 10**6),
        "ens17f0np0": _Nic(3 * 10**6, 8 * 10**6),
    }
]


def test_real_net_nics_filters_virtual():
    kept = _real_net_nics(_NICS[0])
    assert set(kept) == {"bond0", "ens17f0np0"}  # eth1 是否剔除取决于 /sys master 链接


def test_net_speed_excludes_virtual_and_doubles(stub_psutil):
    from sigmaflow.server.science import _system_stats

    first = _system_stats()
    assert first["net"] == {"up_bps": 0.0, "down_bps": 0.0}  # 首次无基准恒为 0

    time.sleep(0.05)
    # 5 秒真实间隔不可等, 直接推进快照时间制造 dt
    prev = _sys_state["net"]
    _sys_state["net"] = (prev[0] - 2.0, prev[1])  # 回拨 2 秒 → dt=2s
    # 第二次采样: 容器 veth 对各涨 3MB(同一份流量), 真实网卡各涨 0.2MB
    _NICS.append(
        {
            "lo": _Nic(10**9 + 10**6, 10**9 + 10**6),
            "veth748dfcd": _Nic(5 * 10**9 + 3 * 10**6, 4 * 10**9 + 3 * 10**6),
            "vethba83d53": _Nic(4 * 10**9 + 3 * 10**6, 5 * 10**9 + 3 * 10**6),
            "docker0": _Nic(0, 0),
            "br-abc123": _Nic(0, 0),
            "eth1": _Nic(10**6 + 2 * 10**5, 10**6 + 2 * 10**5),
            "bond0": _Nic(2 * 10**6 + 2 * 10**5, 3 * 10**6 + 2 * 10**5),
            "ens17f0np0": _Nic(3 * 10**6 + 2 * 10**5, 8 * 10**6 + 2 * 10**5),
        }
    )
    stub_psutil.net_io_counters = lambda pernic=False: _NICS[1]

    second = _system_stats()
    # 期望: 两个真实网卡各涨 0.2MB, 合计 0.4MB / dt(≈2s+少量开销);
    # 若把 veth 对加总会上探到 ~3MB/s, 回环再加一份
    expect = 4 * 10**5 / 2.0
    assert second["net"]["up_bps"] == pytest.approx(expect, rel=0.3)
    assert second["net"]["down_bps"] == pytest.approx(expect, rel=0.3)
    assert second["net"]["up_bps"] < 5 * 10**5  # 远低于虚拟接口加总的 ~3MB/s
