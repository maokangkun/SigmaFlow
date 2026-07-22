import importlib
from io import StringIO

from rich.console import Console


agent_module = importlib.import_module("sigmaflow.agent.agent")


def test_print_syntax_preserves_tail_line_numbers(monkeypatch):
    output = StringIO()
    monkeypatch.setattr(
        agent_module,
        "console",
        Console(file=output, width=100, color_system=None),
    )
    code = "\n".join(
        f"BEGIN {line} {'x' * 40} END {line}"
        for line in range(1, 301)
    )

    agent_module._print_syntax(code, "text")

    rendered_lines = output.getvalue().splitlines()
    omitted_line = next(
        index
        for index, line in enumerate(rendered_lines)
        if line.strip() == "... content omitted ..."
    )
    assert rendered_lines[omitted_line - 1].strip() == ""
    assert rendered_lines[omitted_line + 1].strip() == ""
    assert any("300 BEGIN 300" in line for line in rendered_lines)
    displayed_code = [line for line in rendered_lines if "BEGIN" in line or "END" in line]
    assert all("BEGIN" in line and "END" in line for line in displayed_code)
