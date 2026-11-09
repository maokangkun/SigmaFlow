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


def test_live_browser_engine():
    """browser-use 引擎: 起真 Chrome → 点击 → CDP Cookie 导出进罐子。

    无 chromium 二进制的环境跳过(引擎按需发现, 见 _find_chrome)。
    """
    if not tools._find_chrome():
        pytest.skip("no chromium binary")
    import threading
    from http.server import BaseHTTPRequestHandler, HTTPServer

    class _H(BaseHTTPRequestHandler):
        def do_GET(self):
            body = (
                b'<button style="width:100%;height:100%" onclick='
                b'"this.textContent=String(++n);document.cookie=\'wv=ok\'">0'
                b'</button><script>var n=0</script>'
            )
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *a):
            pass

    srv = HTTPServer(("127.0.0.1", 0), _H)
    port = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    lv = tools._WvLive("wvengtest", f"http://127.0.0.1:{port}/")
    try:
        lv.start()
        assert not lv.dead
        assert lv.frames, "screencast frame never arrived"
        assert "Mozilla" in lv.ua
        lv.feed({"t": "mouse", "st": "pressed", "x": 640, "y": 400})
        lv.feed({"t": "mouse", "st": "released", "x": 640, "y": 400})
        import time as _t

        _t.sleep(1.2)
        res = lv.call(
            "Runtime.evaluate",
            {"expression": "document.querySelector('button').textContent", "returnByValue": True},
        )
        assert (res.get("result") or {}).get("value") == "1", "click not dispatched"
        pairs = lv.cookies()
        assert ("wv", "ok", "127.0.0.1") in pairs
        # 导出进 requests 罐(webview_fetch 复用路径): 需先登记进会话表
        with tools._WV_LIVE_LOCK:
            tools._WV_LIVE["wvengtest"] = lv
        assert tools._webview_live_export_cookies("wvengtest") is True
        jar = tools._WEBVIEW_SESSIONS["wvengtest"]["session"].cookies.get_dict()
        assert jar.get("wv") == "ok"
        assert "Mozilla" in tools._WEBVIEW_SESSIONS["wvengtest"]["session"].headers["User-Agent"]
    finally:
        lv.close()
        srv.shutdown()
