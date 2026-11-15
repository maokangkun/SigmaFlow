"""一次性生成脚本: 把 Agent.__call__ 拆为阶段方法(逐字搬移 + tokenize 级 lc 化)。"""

import io
import tokenize as tk
from pathlib import Path

SRC = Path("src/sigmaflow/agent/agent.py")
lines = SRC.read_text().splitlines(keepends=True)

LC_NAMES = {
    "cur_turn",
    "max_turn",
    "ratio",
    "manual_compact",
    "nudge_armed",
    "silent_tools",
    "tried",
    "knight_rider",
    "cost_time",
    "response",
    "msg",
    "calls",
    "notifs",
    "usable_tools",
    "subagent",
    "is_print",
    "show_processing",
    "begin_time",
    "_nudge_at",
    "max_model_len",
    "print",
}

SKIP_TYPES = (tk.COMMENT, tk.NL, tk.NEWLINE, tk.INDENT, tk.DEDENT, tk.ENCODING)


def _sig_neighbors(toks, i):
    prev = nxt = None
    for j in range(i - 1, -1, -1):
        if toks[j].type not in SKIP_TYPES:
            prev = toks[j]
            break
    for j in range(i + 1, len(toks)):
        if toks[j].type not in SKIP_TYPES:
            nxt = toks[j]
            break
    return prev, nxt


def transform(code):
    toks = list(tk.generate_tokens(io.StringIO(code).readline))
    replacements = []
    for i, tok in enumerate(toks):
        if tok.type != tk.NAME or tok.string not in LC_NAMES:
            continue
        prev, nxt = _sig_neighbors(toks, i)
        if prev is not None and prev.type == tk.OP and prev.string == ".":
            continue  # 属性访问
        if (
            prev is not None
            and prev.type == tk.OP
            and prev.string in "(,"
            and nxt is not None
            and nxt.type == tk.OP
            and nxt.string == "="
        ):
            continue  # 关键字参数位
        replacements.append(tok)
    if not replacements:
        return code
    src_lines = code.splitlines(keepends=True)
    result = []
    last = (1, 0)
    for tok in replacements:
        sr, sc = tok.start
        er, ec = tok.end
        result.append(_slice(src_lines, last, (sr, sc)))
        result.append("lc." + tok.string)
        last = (er, ec)
    result.append(_slice(src_lines, last, (10**9, 0)))
    return "".join(result)


def _slice(src_lines, start, end):
    sr, sc = start
    er, ec = end
    n = len(src_lines)
    if sr > n:
        return ""
    if sr == er:
        return src_lines[sr - 1][sc:ec]
    parts = [src_lines[sr - 1][sc:]]
    for i in range(sr, min(er - 1, n)):
        parts.append(src_lines[i])
    if er - 1 < n:
        parts.append(src_lines[er - 1][:ec])
    return "".join(parts)


import ast as _ast


def _fstring_name_positions(code):
    """ast 收集 f-string 内部的 LC 名字位置(3.11 tokenize 进不去 f-string)。

    ast.parse 需要模块级文本: 先剥掉公共缩进, 位置再加回来。
    """
    indents = [len(l) - len(l.lstrip(" ")) for l in code.splitlines() if l.strip()]
    prefix = min(indents) if indents else 0
    dedented = "\n".join((l[prefix:] if l.strip() else l) for l in code.splitlines())
    try:
        tree = _ast.parse(dedented)
    except SyntaxError:
        return []

    positions = []

    def visit(node, inside_fstr):
        if isinstance(node, _ast.FormattedValue):
            inside_fstr = True
        if (
            inside_fstr
            and isinstance(node, _ast.Name)
            and node.id in LC_NAMES
            and isinstance(node.ctx, _ast.Load)
        ):
            positions.append(
                (
                    node.lineno,
                    node.col_offset + prefix,
                    node.end_col_offset + prefix,
                    node.id,
                )
            )
        for child in _ast.iter_child_nodes(node):
            visit(child, inside_fstr)

    visit(tree, False)
    return positions


def transform(code):
    """tokenize 替换 + f-string 内部替换, 一次自底向下应用。"""
    toks = list(tk.generate_tokens(io.StringIO(code).readline))
    repl = []
    for i, tok in enumerate(toks):
        if tok.type != tk.NAME or tok.string not in LC_NAMES:
            continue
        prev, nxt = _sig_neighbors(toks, i)
        if prev is not None and prev.type == tk.OP and prev.string == ".":
            continue
        if (
            prev is not None
            and prev.type == tk.OP
            and prev.string in "(,"
            and nxt is not None
            and nxt.type == tk.OP
            and nxt.string == "="
        ):
            continue
        repl.append((tok.start[0], tok.start[1], tok.end[1], tok.string))
    for ln, c0, c1, name in _fstring_name_positions(code):
        repl.append((ln, c0, c1, name))
    if not repl:
        return code
    lines = code.splitlines(keepends=True)
    # 同行多替换: 按列倒序; 行间按行倒序
    repl.sort(key=lambda r: (r[0], r[1]), reverse=True)
    for ln, c0, c1, name in repl:
        row = lines[ln - 1]
        lines[ln - 1] = row[:c0] + "lc." + name + row[c1:]
    return "".join(lines)


def chunk(a, b):
    return "".join(lines[a - 1 : b])


def replace_line(seg, offset, old_frag, new_stmt):
    idx = offset - 1
    assert old_frag in seg[idx], f"line {offset}: {seg[idx][:90]!r} lacks {old_frag!r}"
    indent = seg[idx][: len(seg[idx]) - len(seg[idx].lstrip())]
    seg[idx] = indent + new_stmt + "\n"


import textwrap


def dedent4(code):
    return textwrap.dedent(code)


segs = {}
for name, (a, b) in {
    "setup": (385, 473),
    "turn_begin": (475, 557),
    "llm": (558, 1031),
    "settle": (1033, 1229),
    "exec": (1230, 1646),
    "turn_end": (1647, 1711),
    "teardown": (1712, 1749),
}.items():
    segs[name] = chunk(a, b).splitlines(keepends=True)

replace_line(segs["turn_begin"], 482 - 475 + 1, "break", "return LOOP_END")
replace_line(segs["llm"], 997 - 558 + 1, "break", "return LOOP_PROCEED")
replace_line(segs["llm"], 1031 - 558 + 1, "break", "return LOOP_END")
for ln in (1075, 1092, 1110, 1121, 1195, 1212, 1223):
    replace_line(segs["settle"], ln - 1033 + 1, "continue", "return LOOP_NEXT_TURN")
for ln in (1123, 1225):
    replace_line(segs["settle"], ln - 1033 + 1, "break", "return LOOP_END")

setup_src = transform("".join(segs["setup"]))
llm_src = transform(textwrap.indent(dedent4("".join(segs["llm"])), 8 * " "))
tb_src = transform(textwrap.indent(dedent4("".join(segs["turn_begin"])), 8 * " "))
settle_src = transform(textwrap.indent(dedent4("".join(segs["settle"])), 8 * " "))
exec_src = transform(textwrap.indent(dedent4("".join(segs["exec"])), 8 * " "))
te_src = transform(textwrap.indent(dedent4("".join(segs["turn_end"])), 8 * " "))
td_src = transform("".join(segs["teardown"]))

new_call = '''    @singledispatchmethod
    def __call__(
        self,
        messages: list,
        tools=None,
        subagent=False,
        print_inp=False,
        is_print=True,
        show_processing=True,
        max_turn=None,
        on_delta=None,
    ) -> dict:
        """单入口不变(str 重载仍在类体末尾)。

        P2 起 __call__ 只做装配: 构造 LoopContext 后交 run_agent_loop 驱动
        阶段管线(设计 §6.1); loop 可被 mod 整体替换(experimental)。
        """
        lc = self._loop_setup(
            messages, tools, subagent, print_inp, is_print, show_processing,
            max_turn, on_delta,
        )
        return run_agent_loop(self, lc)

'''

setup_method = (
    "    def _loop_setup(\n"
    "        self,\n"
    "        messages,\n"
    "        tools,\n"
    "        subagent,\n"
    "        print_inp,\n"
    "        is_print,\n"
    "        show_processing,\n"
    "        max_turn,\n"
    "        on_delta,\n"
    "    ):\n"
    '        """阶段 0(prologue): 原方法 385-472 行逐字搬移; 共享态一律落 lc。"""\n'
    "        lc = LoopContext(messages=messages, subagent=subagent,\n"
    "                          is_print=is_print, show_processing=show_processing,\n"
    "                          max_turn=max_turn if max_turn else self.max_turn)\n"
    + setup_src
    + "\n        lc.info = info\n"
    "        return lc\n\n"
)

stage_methods = (
    "    # ------------------------------------------------------------ loop 阶段\n"
    "    # 阶段方法: 逐字搬移自原 __call__, 共享态经 lc; 控制流返回 LOOP_* 常量。\n"
    "    # LOOP_PROCEED=继续, LOOP_NEXT_TURN=下一轮, LOOP_END=结束, LOOP_TOOLS=放行工具分发。\n\n"
    "    def _stage_turn_begin(self, lc):\n"
    '        """阶段 1: 停止探测 → steer① → 压缩 → system 补插 → 后台通知。"""\n'
    "        messages = lc.messages\n"
    "        info = lc.info\n" + tb_src + "\n"
    "    def _stage_llm_call(self, lc):\n"
    '        """阶段 2: 带重试的模型调用(anthropic 流式 / openai 双形态)。"""\n'
    "        messages = lc.messages\n"
    "        info = lc.info\n" + llm_src + "\n"
    "    def _stage_settle(self, lc):\n"
    '        """阶段 3: 终文判定(后台等待/steer②/goal/nudge)或放行工具分发。"""\n'
    "        messages = lc.messages\n"
    "        info = lc.info\n" + settle_src + "        return LOOP_TOOLS\n"
    "    def _stage_exec_tools(self, lc):\n"
    '        """阶段 4: 工具提取/分发/并行执行/结果后处理。"""\n'
    "        messages = lc.messages\n"
    "        info = lc.info\n" + exec_src + "\n"
    "    def _stage_turn_end(self, lc):\n"
    '        """阶段 5: usage 推送/静默 nudge 计分/轮次推进/收官提示。"""\n'
    "        messages = lc.messages\n"
    "        info = lc.info\n" + te_src + "\n"
    "    def _loop_teardown(self, lc):\n"
    '        """阶段 6(epilogue): 残留引导通告/预算耗尽标记/汇总返回。"""\n'
    "        messages = lc.messages\n"
    "        info = lc.info\n" + td_src + "\n"
)

replacement = new_call + "\n" + stage_methods + setup_method
out = lines[:371] + [replacement] + lines[1749:]
SRC.write_text("".join(out))
print("written; total lines:", len("".join(out).splitlines()))
