from sigmaflow.agent import tools


def test_run_edit_returns_unified_diff(monkeypatch, tmp_path):
    monkeypatch.setattr(tools, "WORKDIR", tmp_path)
    source = tmp_path / "example.py"
    source.write_text("value = 1\nprint(value)\n")

    result = tools.run_edit("example.py", "value = 1", "value = 2")

    assert source.read_text() == "value = 2\nprint(value)\n"
    assert result == (
        "--- old: example.py\n"
        "+++ new: example.py\n"
        "@@ -1,2 +1,2 @@\n"
        "-value = 1\n"
        "+value = 2\n"
        " print(value)"
    )
