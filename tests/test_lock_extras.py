"""pyproject / uv.lock 脱节防呆。

背景: mods 签名批在 pyproject 声明了 cryptography extra, uv.lock 却一直没
重锁 —— 新机器 `uv sync --frozen` 装不出签名依赖, modsign 测试静默走
cryptography 缺失分支。这类脱节靠 review 目测不可靠, 在测试套件里断死:
  ① [project.optional-dependencies] 里声明的每个包必须出现在 uv.lock;
  ② 机器上有 uv 时顺带跑 `uv lock --check`(网络不可达则跳过, 不误红)。
"""

import re
import shutil
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]


def _extras_packages() -> set:
    src = (REPO / "pyproject.toml").read_text(encoding="utf-8")
    m = re.search(r"\[project\.optional-dependencies\](.*?)(\n\[|\Z)", src, re.S)
    if not m:
        return set()
    names = set()
    for line in m.group(1).splitlines():
        line = line.split("#", 1)[0].strip()
        if "=" not in line:
            continue
        for raw in re.findall(r'"([^"]+)"', line.split("=", 1)[1]):
            # 剥环境标记/版本约束: 取首 token 的包名部分
            spec = raw.split(";", 1)[0].strip()
            name = re.split(r"[\s<>=!~\[]", spec, 1)[0].strip()
            if name:
                names.add(name.lower())
    return names


def _lock_names() -> set:
    text = (REPO / "uv.lock").read_text(encoding="utf-8")
    return set(re.findall(r"^name = \"([^\"]+)\"", text, re.M))


def test_every_declared_extra_is_locked():
    extras = _extras_packages()
    assert extras, "pyproject 应声明至少一个 extra(否则本测试失效)"
    locked = _lock_names()
    missing = sorted(extras - locked)
    assert not missing, (
        f"pyproject extras 声明了但 uv.lock 未收录: {missing} —— "
        "跑 `uv lock` 重锁后提交(参照 test_lock_extras.py 文档)"
    )


def test_uv_lock_check_when_available():
    uv = shutil.which("uv")
    if uv is None:
        pytest.skip("本机无 uv, 仅执行静态断言")
    proc = subprocess.run(
        [uv, "lock", "--check"], cwd=str(REPO), capture_output=True, text=True
    )
    if proc.returncode != 0:
        blob = (proc.stdout + proc.stderr).lower()
        if any(k in blob for k in ("network", "offline", "dns", "timed out")):
            pytest.skip(f"网络不可达, uv lock --check 无法解析: {blob[:120]}")
    assert proc.returncode == 0, (
        "uv lock --check 未过(pyproject 与锁文件脱节): "
        f"{(proc.stdout + proc.stderr)[-300:]}"
    )
