"""测试进程的全局隔离: 阻断 litellm 冷导入。

litellm 是重模块, 测试进程首次 import 可达分钟级(生产进程启动期已由
_litellm_warm 预热, 无此成本)。science/agent 侧模型信息查询统一走
litellm 后, 任何触发 _litellm_db() 的契约测试都会撞上冷导入; 这里注入
最小假模块并提供一个可命中的条目, 使查询走快路径且不落包内价格表文件。

注意必须是 ModuleType 实例: import 语句对 sys.modules 里的非 module
条目(SimpleNamespace 等)会退化走真实导入路径, 假注入随即失效。
"""

import sys
import types

import pytest


@pytest.fixture(autouse=True)
def _fake_litellm(monkeypatch):
    mod = types.ModuleType("litellm")
    mod.model_cost = {
        "gpt-x": {"max_input_tokens": 258000, "input_cost_per_token": 1e-6}
    }
    monkeypatch.setitem(sys.modules, "litellm", mod)
