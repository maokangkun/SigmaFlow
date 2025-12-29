import hashlib
import asyncio
import pytest
from sigmaflow import utils


def test_get_version_returns_string():
    assert isinstance(utils.get_version(), str)


def test_check_cmd_exist():
    # returns a bool and non-existing command should be False
    assert isinstance(utils.check_cmd_exist("some-nonexistent-cmd-12345"), bool)
    assert isinstance(utils.check_cmd_exist("python"), bool)


def test_importpath(tmp_path):
    mod_file = tmp_path / "tmp_mod.py"
    mod_file.write_text("VAL = 123\n")
    mod = utils.importpath(mod_file)
    assert hasattr(mod, "VAL") and mod.VAL == 123


def test_get_ordered_task_simple():
    tasks = {
        "A": {"inputs": {}},
        "B": {"inputs": {"in": ["A-1"]}},
        "C": {"inputs": {"in": ["B-1"]}},
    }
    order = utils.get_ordered_task(tasks)
    assert order == ["A", "B", "C"]


def test_jload_jdump(tmp_path):
    f = tmp_path / "t.json"
    obj = {"a": 1}
    utils.jdump(obj, f)
    loaded = utils.jload(f)
    assert loaded == obj


def test_jdump_str(tmp_path):
    f = tmp_path / "t2.txt"
    utils.jdump("hello", f)
    assert f.read_text() == "hello"


def test_jdump_bad(tmp_path):
    f = tmp_path / "t3.txt"
    with pytest.raises(ValueError):
        utils.jdump(123, f)


def test_calc_hash_file(tmp_path):
    f = tmp_path / "data.bin"
    f.write_bytes(b"hello")
    h = utils.calc_hash(str(f))
    expected = hashlib.sha256(b"hello").hexdigest()[-16:]
    assert h == expected


def test_calc_hash_none_returns_length():
    h = utils.calc_hash(None)
    assert isinstance(h, str) and len(h) == 16


def test_get_latest_version_apex_and_non200(monkeypatch):
    assert utils.get_latest_version(("Apex", "apex")) == ("apex", None)

    class Dummy:
        status_code = 500

        def json(self):
            return {}

    monkeypatch.setattr(utils.requests, "get", lambda url: Dummy())
    name, ver = utils.get_latest_version(("x", "nonexistent-package"))
    assert name == "nonexistent-package" and ver is None


def test_mmdc_no_cmd(monkeypatch, tmp_path):
    monkeypatch.setattr(utils, "check_cmd_exist", lambda x: False)
    # should not raise
    utils.mmdc("some mermaid", str(tmp_path / "out.png"))


def test_async_compat_sync_and_async():
    def f(a, b):
        return a + b

    wrapped = utils.async_compat(f)
    # sync call
    assert wrapped(1, 2) == 3

    async def runner():
        res = await wrapped(2, 3)
        assert res == 5

    asyncio.run(runner())


def test_sync_compat_sync_and_async():
    async def f(a, b):
        return a + b

    wrapped = utils.sync_compat(f)
    # sync context: should return value
    assert wrapped(1, 2) == 3

    async def runner():
        coro = wrapped(3, 4)
        assert asyncio.iscoroutine(coro)
        res = await coro
        assert res == 7

    asyncio.run(runner())


def test_remove_think_content_and_extract_json():
    txt = '<think>secret</think> {"a":1}'
    # remove_think_content should strip the think block
    out = utils.remove_think_content(txt)
    assert out.strip().startswith("{")

    assert utils.extract_json('{"a":1}') == {"a": 1}
    assert utils.extract_json("{'a':1}") == {"a": 1}
    assert utils.extract_json('```json\n{"b":2}\n```') == {"b": 2}
    assert utils.extract_json("no json here") is None
