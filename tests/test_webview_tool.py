"""webview 工具: 事件形态 / Cookie 罐 / 本地预览路径护栏 / HTML 代理改写。

远程页由 server/science.py 的 /wv 路由反向代理(剥框架头 + 同源改写 +
共享 Cookie 罐); 这里覆盖工具层与会话罐, 以及改写器的关键行为。
"""

import pytest

from sigmaflow.agent import tools
from sigmaflow.server import science


@pytest.fixture
def workdir(tmp_path, monkeypatch):
    proj = tmp_path / "proj"
    proj.mkdir()
    monkeypatch.setattr(tools, "WORKDIR", proj)
    return proj


def _notify_box():
    box = {}
    return box, lambda ev: box.update(ev)


def test_remote_event_shape_and_jar():
    box, notify = _notify_box()
    out = tools.run_webview(
        url="http://example.com/page", title="t", note="n", _notify=notify
    )
    ev = box
    assert ev["kind"] == "webview"
    assert ev["mode"] == "remote"
    assert ev["url"] == "http://example.com/page"
    assert ev["sid"].startswith("wv")
    assert 240 <= ev["height"] <= 900
    # 会话罐里应有该 sid, 且带 UA
    jars, lock = tools.webview_session_state()
    with lock:
        st = jars.get(ev["sid"])
    assert st is not None
    assert "Mozilla" in st["session"].headers.get("User-Agent", "")
    assert "session" in out


def test_remote_invalid_url_rejected():
    box, notify = _notify_box()
    assert tools.run_webview(url="ftp://x", _notify=notify).startswith("Error")
    assert tools.run_webview(url="", _notify=notify).startswith("Error")
    assert not box


def test_local_preview_event(workdir):
    page = workdir / "demo.html"
    page.write_text("<h1>hi</h1>", encoding="utf-8")
    box, notify = _notify_box()
    out = tools.run_webview(url="demo.html", _notify=notify)
    assert box["mode"] == "local"
    assert box["path"].endswith("demo.html")
    assert box["sid"] == ""
    assert "Local page" in out


def test_local_protected_path_rejected(workdir, monkeypatch):
    # 敏感目录拒绝: 与 present 同一黑名单
    out = tools.run_webview(url="/etc/passwd")
    assert out.startswith("Error")


def test_local_missing_file_rejected(workdir):
    assert tools.run_webview(url="nope.html").startswith("Error")


def test_height_clamped():
    box, notify = _notify_box()
    tools.run_webview(url="http://example.com/", height=9999, _notify=notify)
    assert box["height"] == 900
    box2, notify2 = _notify_box()
    tools.run_webview(url="http://example.com/", height=10, _notify=notify2)
    assert box2["height"] == 240


def test_rewrite_html_same_origin_only():
    html = (
        '<a href="/next">n</a><img src="pic.png">'
        '<a href="https://other.com/x">o</a>'
        '<form action="/submit" method="post"></form>'
        '<script src="//cdn.example.net/j.js"></script>'
    )
    out = science._wv_rewrite_html(html, "https://site.com/a/b.html", "wvtest01")
    # 同源相对/绝对 → 代理查询形态
    assert 'href="?u=https%3A%2F%2Fsite.com%2Fnext"' in out
    assert 'src="?u=https%3A%2F%2Fsite.com%2Fa%2Fpic.png"' in out
    assert 'action="?u=https%3A%2F%2Fsite.com%2Fsubmit"' in out
    # 跨域与协议相对不动
    assert 'href="https://other.com/x"' in out
    assert 'src="//cdn.example.net/j.js"' in out
    # fetch/XHR 补丁注入
    assert "XMLHttpRequest.prototype.open" in out


def test_rewrite_html_skips_special_schemes():
    html = '<a href="#x">a</a><a href="javascript:0">j</a><a href="data:,">d</a>'
    out = science._wv_rewrite_html(html, "https://s.com/", "wvtest01")
    assert 'href="#x"' in out
    assert 'href="javascript:0"' in out
    assert 'href="data:,"' in out


def test_webview_fetch_invalid_url():
    assert tools.run_webview_fetch(url="notaurl").startswith("Error")


def test_webview_fetch_unknown_sid_is_anonymous():
    # 未知 sid 不报错: 退化为匿名会话(与无 sid 等价)
    out = tools.run_webview_fetch(url="http://127.0.0.1:1/x", sid="wvnope")
    assert out.startswith("Error: request failed")


def test_archive_row_keeps_webview_block():
    state = {
        "journal": [
            ("tool", {"kind": "call", "name": "webview", "args": {"url": "http://x/"}}),
            (
                "tool",
                {
                    "kind": "webview",
                    "mode": "remote",
                    "url": "http://x/",
                    "sid": "wvabc",
                    "title": "t",
                    "note": "n",
                    "height": 500,
                },
            ),
            ("delta", {"delta": "done"}),
        ]
    }
    row = science._archive_row_from_journal(state, "m")
    kinds = [b["t"] for b in row["blocks"]]
    assert kinds == ["tool", "webview", "text"]
    wv = row["blocks"][1]
    assert wv["sid"] == "wvabc" and wv["height"] == 500


def test_webview_ingest_cookies():
    # Cookie 交接: 注入罐子 + UA 同步; 未知 sid 返回 -1
    box, notify = _notify_box()
    tools.run_webview(url="http://example.com/", _notify=notify)
    sid = box["sid"]
    n = tools._webview_ingest_cookies(sid, "cf_clearance=abc; foo=bar", "Mozilla/5.0 X")
    assert n == 2
    jars, lock = tools.webview_session_state()
    with lock:
        st = jars[sid]
    d = st["session"].cookies.get_dict()
    assert d.get("cf_clearance") == "abc"
    assert st["session"].headers["User-Agent"] == "Mozilla/5.0 X"
    assert tools._webview_ingest_cookies("wvnope", "a=1") == -1
