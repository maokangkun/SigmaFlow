"""Mod 签名(ed25519) — 密钥生成/签名/校验与信任库(设计 §9/P5)。

签名方案(刻意保持最小可审计):

- 签名对象 = ``mod.toml`` 文件的 sha256 — 清单即身份, 清单之外的文件
  由清单 contributions 约束; 换任何字节签名即失效。
- 签名文件 ``mod.sig``(与 mod.toml 同目录): JSON
  ``{"algorithm": "ed25519", "key": "<b64 公钥>", "signature": "<b64 签名>"}``。
- 信任库 ``~/.sigmaflow/trusted-mod-keys.txt``(可用 ``SIGMAFLOW_MOD_TRUST``
  覆盖): 每行一个 b64 公钥, ``#`` 注释。校验通过 = 签名有效 **且** 公钥在库。
- ``cryptography`` 缺失时: 校验返回 unavailable(远程安装须显式
  allow_unsigned 或改用本地目录)。

命令行::

    python -m sigmaflow.kernel.modsign keygen  [--out mykey]     # 生成密钥对
    python -m sigmaflow.kernel.modsign sign <mod-dir> --key mykey
    python -m sigmaflow.kernel.modsign trust <mykey.pub | mod-dir>
    python -m sigmaflow.kernel.modsign verify <mod-dir>
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

SIG_FILE = "mod.sig"
MANIFEST = "mod.toml"
_ALGO = "ed25519"


def _crypto():
    try:
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric.ed25519 import (
            Ed25519PrivateKey,
            Ed25519PublicKey,
        )

        return serialization, Ed25519PrivateKey, Ed25519PublicKey
    except ImportError:
        return None


@dataclass
class VerifyResult:
    ok: bool
    reason: str
    key_fp: str = ""  # 公钥指纹(sha256 前 16 hex), UI 展示用
    signed: bool = False  # 目录是否携带签名


def trust_file_path() -> Path:
    env = os.environ.get("SIGMAFLOW_MOD_TRUST")
    if env:
        return Path(env)
    home = os.environ.get("SIGMAFLOW_HOME") or str(Path.home() / ".sigmaflow")
    return Path(home) / "trusted-mod-keys.txt"


def fingerprint(pubkey_b64: str) -> str:
    raw = base64.b64decode(pubkey_b64)
    return hashlib.sha256(raw).hexdigest()[:16]


def manifest_digest(mod_dir: Path) -> bytes:
    return hashlib.sha256((mod_dir / MANIFEST).read_bytes()).digest()


# ------------------------------------------------------------------ keygen
def keygen(out_prefix: str = "modkey") -> tuple[Path, Path]:
    """生成 ed25519 密钥对: <prefix>.key(私) / <prefix>.pub(公, b64 单行)。"""
    trio = _crypto()
    if trio is None:
        raise RuntimeError("cryptography 未安装: pip install cryptography")
    serialization, Ed25519PrivateKey, _ = trio
    priv = Ed25519PrivateKey.generate()
    priv_pem = priv.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    pub_raw = priv.public_key().public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw
    )
    key_path = Path(f"{out_prefix}.key")
    pub_path = Path(f"{out_prefix}.pub")
    key_path.write_bytes(priv_pem)
    pub_path.write_text(base64.b64encode(pub_raw).decode() + "\n", encoding="utf-8")
    os.chmod(key_path, 0o600)
    return key_path, pub_path


# -------------------------------------------------------------------- sign
def sign_mod(mod_dir: Path, key_path: Path) -> Path:
    trio = _crypto()
    if trio is None:
        raise RuntimeError("cryptography 未安装: pip install cryptography")
    serialization, Ed25519PrivateKey, Ed25519PublicKey = trio
    priv = serialization.load_pem_private_key(key_path.read_bytes(), password=None)
    if not isinstance(priv, Ed25519PrivateKey):
        raise ValueError(f"{key_path} 不是 ed25519 私钥")
    pub_b64 = base64.b64encode(
        priv.public_key().public_bytes(
            serialization.Encoding.Raw, serialization.PublicFormat.Raw
        )
    ).decode()
    sig = priv.sign(manifest_digest(mod_dir))
    sig_path = mod_dir / SIG_FILE
    sig_path.write_text(
        json.dumps(
            {
                "algorithm": _ALGO,
                "key": pub_b64,
                "signature": base64.b64encode(sig).decode(),
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    return sig_path


# ------------------------------------------------------------------ verify
def load_trust(path: Path) -> list[str]:
    if not path.is_file():
        return []
    keys = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.split("#", 1)[0].strip()  # 剥行内注释(trust_key 写入 fp 注释)
        if line:
            keys.append(line)
    return keys


def trust_key(pubkey_b64: str, path: Optional[Path] = None) -> Path:
    p = path or trust_file_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "a", encoding="utf-8") as fh:
        fh.write(f"{pubkey_b64.strip()}  # fp {fingerprint(pubkey_b64)}\n")
    return p


def verify_mod(mod_dir: Path, trust_path: Optional[Path] = None) -> VerifyResult:
    """校验 mod 目录签名: 无签名 → signed=False; 有签名必须落在信任库。"""
    sig_path = mod_dir / SIG_FILE
    if not sig_path.is_file():
        return VerifyResult(False, "unsigned", signed=False)
    trio = _crypto()
    if trio is None:
        return VerifyResult(
            False, "verification unavailable (cryptography not installed)", signed=True
        )
    serialization, _, Ed25519PublicKey = trio
    try:
        data = json.loads(sig_path.read_text(encoding="utf-8"))
        if data.get("algorithm") != _ALGO:
            return VerifyResult(
                False, f"unsupported algorithm {data.get('algorithm')}", signed=True
            )
        pub_b64 = str(data.get("key") or "")
        sig = base64.b64decode(str(data.get("signature") or ""))
        pub = Ed25519PublicKey.from_public_bytes(base64.b64decode(pub_b64))
        fp = fingerprint(pub_b64)
    except Exception as exc:  # noqa: BLE001
        return VerifyResult(False, f"malformed signature: {exc}", signed=True)
    trusted = load_trust(trust_path or trust_file_path())
    # 先验签名再查库: 篡改报 mismatch, 密钥未入库报 untrusted, 原因各自精确
    try:
        pub.verify(sig, manifest_digest(mod_dir))
    except Exception:  # noqa: BLE001
        return VerifyResult(
            False, "signature mismatch (mod.toml modified?)", key_fp=fp, signed=True
        )
    if pub_b64 not in trusted:
        return VerifyResult(
            False, f"key {fp} not in trust store", key_fp=fp, signed=True
        )
    return VerifyResult(True, f"signed by trusted key {fp}", key_fp=fp, signed=True)


# --------------------------------------------------------------------- CLI
def main(argv: Optional[list] = None) -> int:
    parser = argparse.ArgumentParser(
        prog="modsign", description="SigmaFlow mod 签名工具"
    )
    sub = parser.add_subparsers(dest="cmd", required=True)
    p_gen = sub.add_parser("keygen", help="生成 ed25519 密钥对")
    p_gen.add_argument("--out", default="modkey", help="输出前缀(默认 modkey)")
    p_sign = sub.add_parser("sign", help="给 mod 目录签名(写 mod.sig)")
    p_sign.add_argument("mod_dir")
    p_sign.add_argument("--key", required=True, help="私钥路径")
    p_trust = sub.add_parser("trust", help="把公钥加入信任库")
    p_trust.add_argument("source", help="公钥文件或含 mod.sig 的 mod 目录")
    p_ver = sub.add_parser("verify", help="校验 mod 目录签名")
    p_ver.add_argument("mod_dir")
    args = parser.parse_args(argv)

    if args.cmd == "keygen":
        key_path, pub_path = keygen(args.out)
        print(
            f"私钥: {key_path}\n公钥: {pub_path} (fp {fingerprint(pub_path.read_text().strip())})"
        )
        print(f"信任入库: python -m sigmaflow.kernel.modsign trust {pub_path}")
    elif args.cmd == "sign":
        sig = sign_mod(Path(args.mod_dir).expanduser(), Path(args.key).expanduser())
        print(f"已签名: {sig}")
    elif args.cmd == "trust":
        src = Path(args.source).expanduser()
        if src.is_dir():
            data = json.loads((src / SIG_FILE).read_text(encoding="utf-8"))
            pub_b64 = str(data.get("key") or "")
        else:
            pub_b64 = src.read_text(encoding="utf-8").strip()
        path = trust_key(pub_b64)
        print(f"已加入信任库 {path} (fp {fingerprint(pub_b64)})")
    elif args.cmd == "verify":
        result = verify_mod(Path(args.mod_dir).expanduser())
        print(("PASS" if result.ok else "FAIL") + f": {result.reason}")
        return 0 if result.ok else 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
