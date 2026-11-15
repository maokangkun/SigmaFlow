"""P5 补全: 签名(keygen/sign/verify/trust) + git/zip 远程安装闭环。"""

import subprocess
import zipfile
from pathlib import Path

import pytest

import sigmaflow
from sigmaflow.kernel import modsign
from sigmaflow.server.mods import ModSubsystem

BUILTIN = Path(sigmaflow.__file__).parent / "mods"
_SUBSYSTEMS = []


@pytest.fixture(autouse=True)
def _teardown_subsystems():
    yield
    for sub in _SUBSYSTEMS:
        for mod_id in list(sub.host.contexts):
            sub.host.unload(mod_id)
    _SUBSYSTEMS.clear()


def _subsystem(tmp_path):
    sub = ModSubsystem.__new__(ModSubsystem)
    ModSubsystem.__init__(sub)
    _SUBSYSTEMS.append(sub)
    sub.bootstrap(home=tmp_path / "home", builtin_dirs=[BUILTIN])
    return sub


def _make_mod(tmp_path, name="signed-tool", body="pass"):
    d = tmp_path / name
    d.mkdir(parents=True, exist_ok=True)
    (d / "mod.toml").write_text(
        f'[mod]\nid = "{name}"\nname = "{name}"\nversion = "0.1.0"\n', encoding="utf-8"
    )
    (d / "entry.py").write_text(
        "def activate(ctx):\n    ctx.track('noop', None)\n", encoding="utf-8"
    )
    return d


class TestSigning:
    def test_keygen_sign_verify_roundtrip(self, tmp_path, monkeypatch):
        trust = tmp_path / "trust.txt"
        monkeypatch.setenv("SIGMAFLOW_MOD_TRUST", str(trust))
        key, pub = modsign.keygen(str(tmp_path / "k"))
        modsign.trust_key(pub.read_text(encoding="utf-8").strip(), trust)
        mod = _make_mod(tmp_path)
        modsign.sign_mod(mod, key)
        assert modsign.verify_mod(mod).ok is True

    def test_tampered_manifest_fails(self, tmp_path, monkeypatch):
        trust = tmp_path / "trust.txt"
        monkeypatch.setenv("SIGMAFLOW_MOD_TRUST", str(trust))
        key, pub = modsign.keygen(str(tmp_path / "k"))
        mod = _make_mod(tmp_path)
        modsign.sign_mod(mod, key)
        (mod / "mod.toml").write_text(
            '[mod]\nid = "signed-tool"\nversion = "9.9.9"\n', encoding="utf-8"
        )
        result = modsign.verify_mod(mod)
        assert not result.ok and "mismatch" in result.reason

    def test_untrusted_key_fails(self, tmp_path, monkeypatch):
        monkeypatch.setenv("SIGMAFLOW_MOD_TRUST", str(tmp_path / "empty.txt"))
        (tmp_path / "empty.txt").write_text("", encoding="utf-8")
        monkeypatch.setenv("SIGMAFLOW_MOD_TRUST", str(tmp_path / "empty.txt"))
        key, _ = modsign.keygen(str(tmp_path / "k"))
        mod = _make_mod(tmp_path)
        modsign.sign_mod(mod, key)
        result = modsign.verify_mod(mod)
        assert not result.ok and "trust store" in result.reason

    def test_unsigned_dir_reports_unsigned(self, tmp_path, monkeypatch):
        monkeypatch.setenv("SIGMAFLOW_MOD_TRUST", str(tmp_path / "t.txt"))
        mod = _make_mod(tmp_path)
        result = modsign.verify_mod(mod)
        assert result.signed is False and result.ok is False

    def test_cli_roundtrip(self, tmp_path, monkeypatch):
        monkeypatch.setenv("SIGMAFLOW_MOD_TRUST", str(tmp_path / "trust.txt"))
        monkeypatch.chdir(tmp_path)
        mod = _make_mod(tmp_path)
        assert modsign.main(["keygen", "--out", "k"]) == 0
        assert modsign.main(["sign", str(mod), "--key", "k.key"]) == 0
        assert modsign.main(["trust", "k.pub"]) == 0
        assert modsign.main(["verify", str(mod)]) == 0


class TestZipInstall:
    def _zip_of(self, tmp_path, mod):
        zpath = tmp_path / f"{mod.name}.zip"
        with zipfile.ZipFile(zpath, "w") as zf:
            for f in mod.rglob("*"):
                if f.is_file():
                    zf.write(f, f.relative_to(mod.parent))
        return zpath

    def test_unsigned_zip_requires_flag_then_installs(self, tmp_path, monkeypatch):
        monkeypatch.setenv("SIGMAFLOW_MOD_TRUST", str(tmp_path / "trust.txt"))
        sub = _subsystem(tmp_path)
        mod = _make_mod(tmp_path, "zip-tool")
        zpath = self._zip_of(tmp_path, mod)
        with pytest.raises(PermissionError):
            sub.install(str(zpath))
        rec = sub.install(str(zpath), allow_unsigned=True)
        assert rec["loaded"] is True
        assert sub.host.registry.get("zip-tool").origin == "zip"

    def test_signed_zip_verifies(self, tmp_path, monkeypatch):
        trust = tmp_path / "trust.txt"
        monkeypatch.setenv("SIGMAFLOW_MOD_TRUST", str(trust))
        key, pub = modsign.keygen(str(tmp_path / "k"))
        modsign.trust_key(pub.read_text().strip(), trust)
        sub = _subsystem(tmp_path)
        mod = _make_mod(tmp_path, "zip-signed")
        modsign.sign_mod(mod, key)
        zpath = self._zip_of(tmp_path, mod)
        rec = sub.install(str(zpath))  # 有签名, 无需 allow_unsigned
        assert rec["loaded"] is True

    def test_zip_slip_rejected(self, tmp_path, monkeypatch):
        monkeypatch.setenv("SIGMAFLOW_MOD_TRUST", str(tmp_path / "trust.txt"))
        sub = _subsystem(tmp_path)
        zpath = tmp_path / "evil.zip"
        with zipfile.ZipFile(zpath, "w") as zf:
            zf.writestr("../evil.txt", "boom")
        with pytest.raises(Exception):
            sub.install(str(zpath), allow_unsigned=True)


class TestGitInstall:
    def _git_repo(self, tmp_path, mod):
        repo = tmp_path / "repo"
        repo.mkdir()
        subprocess.run(["git", "init", "-q"], cwd=repo, check=True)
        subprocess.run(
            ["git", "-c", "user.email=t@t", "-c", "user.name=t", "add", "-A"],
            cwd=repo,
            check=True,
        )
        # 把 mod 内容放进仓库根
        for f in mod.rglob("*"):
            if f.is_file():
                dest = repo / f.relative_to(mod)
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(f.read_bytes())
        subprocess.run(
            ["git", "-c", "user.email=t@t", "-c", "user.name=t", "add", "-A"],
            cwd=repo,
            check=True,
        )
        subprocess.run(
            ["git", "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "m"],
            cwd=repo,
            check=True,
        )
        return repo

    def test_git_clone_install(self, tmp_path, monkeypatch):
        monkeypatch.setenv("SIGMAFLOW_MOD_TRUST", str(tmp_path / "trust.txt"))
        sub = _subsystem(tmp_path)
        mod = _make_mod(tmp_path, "git-tool")
        repo = self._git_repo(tmp_path, mod)
        url = f"git+file://{repo}"
        rec = sub.install(url, allow_unsigned=True)
        assert rec["loaded"] is True
        assert sub.host.registry.get("git-tool").origin == "git"
        sub.uninstall("git-tool")
