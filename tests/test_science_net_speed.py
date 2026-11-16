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


@pytest.fixture()
def bond_topology(monkeypatch):
    """封闭注入 bond 拓扑: eth1 是 bond0 的从属口(带 /sys master 链接)。

    原实现读宿主 sysfs 判断从属口, eth1 是否被剔除因部署环境而异 ——
    曾导致本测试在不同机器上时过时挂。此处伪造探测结果, 行为契约
    (从属口流量已计入主口, 剔除避免重复统计)与原意一致且可复现。
    """
    from sigmaflow.server import science

    real_exists = science.os.path.exists

    def exists(path):
        if path == "/sys/class/net/eth1/master":
            return True
        return real_exists(path)

    monkeypatch.setattr(science.os.path, "exists", exists)


@pytest.fixture()
def fake_clock(monkeypatch):
    """假时钟: _system_stats 只用 time.time(), 注入后 dt 完全可控可复现。

    原测试回拨快照 2 秒 + 真实 sleep, 速率分母含真实耗时抖动, 容差
    rel=0.3 在负载机器上偶发越界(时序 flake 的根因)。
    """
    from sigmaflow.server import science

    state = {"t": 100.0}
    monkeypatch.setattr(science, "time", types.SimpleNamespace(time=lambda: state["t"]))
    return state


def test_real_net_nics_filters_virtual(bond_topology):
    kept = _real_net_nics(_NICS[0])
    assert set(kept) == {"bond0", "ens17f0np0"}  # 从属口 eth1 与虚拟口全剔除


def test_real_net_nics_without_bond_still_filters_virtual():
    """无 bond 拓扑(eth1 无 master 链接)时: 虚拟口仍剔除, eth1 保留。"""
    kept = _real_net_nics(_NICS[0])
    assert "lo" not in kept and "docker0" not in kept
    assert kept.keys() >= {"bond0", "ens17f0np0"}


def test_net_speed_excludes_virtual_and_doubles(stub_psutil, bond_topology, fake_clock):
    from sigmaflow.server.science import _system_stats

    first = _system_stats()
    assert first["net"] == {"up_bps": 0.0, "down_bps": 0.0}  # 首次无基准恒为 0

    # 推进假时钟 2 秒(精确 dt, 不再依赖真实 sleep/耗时)
    fake_clock["t"] += 2.0
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
    # 期望: 两个真实网卡各涨 0.2MB, 合计 0.4MB / dt=2s(假时钟精确);
    # 若把 veth 对加总会上探到 ~3MB/s, 回环再加一份
    expect = 4 * 10**5 / 2.0
    assert second["net"]["up_bps"] == pytest.approx(expect, rel=1e-6)
    assert second["net"]["down_bps"] == pytest.approx(expect, rel=1e-6)
    assert second["net"]["up_bps"] < 5 * 10**5  # 远低于虚拟接口加总的 ~3MB/s
