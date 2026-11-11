"""SigmaFlow Agent 命令行入口。

与 web 端能力对齐的升级点:
  - steering: 模型运行期间直接输入文本回车即插话(排进 steer 队列, 由
    agent 在当前回合/工具批结束后注入 —— 与 web 的 chat.steer 同语义);
    预算耗尽后才排到的插话以 steerDropped 提示, 不静默吞
  - on_tool 系统事件呈现: compact/steerDropped/ask 等打一行提示
  - /usage 与退出摘要: 每轮 info 聚合的累计 token/轮数/耗时
  - 连接参数: --model/--base-url/--api-key(缺省回落环境变量)
"""

import select
import sys
import threading

from rich import print

from .agent import Agent
from .conf import Prompt, SLASH_CMD
from .input import session
from .logo import Logo


def _print_sysnote(text: str) -> None:
    print(f"{Prompt.System}[dim]{text}[/dim]")


def _run_turn_with_steering(agent, history: list) -> dict:
    """跑一轮 agent; 运行期主线程非阻塞读行收 steering 插话。

    agent 跑在守护线程, 主线程 select(0.4s) 轮询 stdin —— 无第二个常驻
    reader 与 prompt_toolkit 抢输入流, 回合结束即停。终端处于规范模式,
    插话按普通行输入(回车提交)。
    """
    queue: list = []

    def drain() -> list:
        items = list(queue)
        queue.clear()
        return items

    agent.steer_poll = drain
    result: dict = {"exit": False}

    def runner() -> None:
        try:
            result["info"] = agent(history)
        except BaseException as err:  # KeyboardInterrupt/网关错误等冒泡收口
            result["err"] = err

    thread = threading.Thread(target=runner, daemon=True)
    thread.start()
    _print_sysnote("生成中——直接输入插话(steering)后回车; 本回合结束即送达模型")
    try:
        while thread.is_alive():
            ready, _, _ = select.select([sys.stdin], [], [], 0.4)
            if not ready:
                continue
            line = sys.stdin.readline()
            text = line.strip()
            if not text:
                continue
            if text.lower() in SLASH_CMD.exit:
                # 生成中的 /exit: 不当插话排队, 标记待退(等回合自然收尾)
                result["exit"] = True
                _print_sysnote("将在本回合结束后退出")
                continue
            queue.append(text)
            print(
                f"{Prompt.Tool}[steer] 已排队({len(queue)} 条): {text[:60]}"
            )
    except KeyboardInterrupt:
        _print_sysnote("收到中断信号; 等待当前回合收尾(再次 Ctrl+C 可强退)")
        thread.join(timeout=600)
    thread.join(timeout=30)
    if queue:
        # 循环已退出仍滞留队列: 与 steerDropped 同因(预算耗尽/重试耗尽),
        # 显式提示而不是静默吞
        _print_sysnote(
            f"{len(queue)} 条插话未送达模型(本回合已结束): "
            + " / ".join(t[:40] for t in queue)
        )
    if "err" in result:
        raise result["err"]
    if result.get("exit"):
        raise SystemExit(0)
    return result.get("info") or {}


def cli(
    query,
    method="anthropic",
    available_tools=None,
    debug=False,
    support_tool=False,
    model=None,
    base_url=None,
    api_key=None,
):
    def on_tool_event(ev) -> None:
        """系统类工具事件的一行提示(工具执行本体由 agent 循环自行打印)。"""
        if not isinstance(ev, dict):
            return
        kind = ev.get("kind")
        if kind == "compact":
            _print_sysnote(f"会话已压缩: 保留 {ev.get('kept')} 条 / 摘要 {len(str(ev.get('text') or ''))} 字")
        elif kind == "steerDropped":
            _print_sysnote(
                f"{ev.get('count')} 条引导消息未送达模型(轮次预算已用尽): "
                + " / ".join(str(t)[:40] for t in ev.get("texts") or [])
            )
        elif kind == "ask":
            _print_sysnote("agent 发起了提问(ask); CLI 模式暂不支持交互回答, 请在 web 端处理")

    agent = Agent(
        method,
        available_tools=available_tools,
        debug=debug,
        support_tool=support_tool,
        model=model,
        base_url=base_url,
        api_key=api_key,
        on_tool=on_tool_event,
    )

    logo = Logo.print()
    info_lines = agent.print_info()
    logo.sync_after_output(info_lines)

    # 会话级累计(/usage 与退出摘要的数据源)
    usage = {"turns": 0, "completion": 0, "prompt": 0, "seconds": 0.0}

    def absorb(info: dict) -> None:
        usage["turns"] += 1
        usage["completion"] += info.get("completion_tokens") or 0
        usage["prompt"] += info.get("prompt_tokens") or 0
        usage["seconds"] += info.get("cost_time") or 0.0

    history: list = []
    if query:
        logo.disable_click_listener()
        history.append({"role": "user", "content": query})
        print(f"{Prompt.User}{query}")

    while True:
        if history and history[-1]["role"] == "user":
            try:
                absorb(_run_turn_with_steering(agent, history))
            except SystemExit:
                break
            except KeyboardInterrupt:
                _print_sysnote("当前回复被中断; 已生成部分保留在历史里, 可继续对话")
            except Exception as err:
                print(f"{Prompt.System}[red]本轮回复失败: {err}[/red]")

        try:
            query = session.prompt(
                Prompt.UserHTML,
                **logo.prompt_options,
                vi_mode=False,
            ).strip()
        except (EOFError, KeyboardInterrupt):
            break

        if query:
            logo.disable_click_listener()

        match q := query.lower():
            case _ if q in SLASH_CMD.exit:
                break
            case SLASH_CMD.help:
                _print_sysnote(
                    "命令: /help 列表 · /usage 累计 token · /history 原始历史 · "
                    "/compact 压缩 · /reset 清空 · /exit 退出(空行亦可)\n"
                    "生成期间直接输入文本并回车 = steering 插话"
                )
            case SLASH_CMD.usage:
                print(
                    f"{Prompt.Tokens}轮数 {usage['turns']} · "
                    f"输入 {usage['prompt']} tok · 输出 {usage['completion']} tok · "
                    f"累计生成 {usage['seconds']:.0f}s"
                )
            case SLASH_CMD.history:
                print(f"{Prompt.History}")
                if history:
                    print(history)
            case SLASH_CMD.compact:
                history = agent.compactor.auto_compact(history, force=True)
            case SLASH_CMD.team:
                ...
            case SLASH_CMD.inbox:
                ...
            case _ if q in SLASH_CMD.reset:
                print(f"{Prompt.Session}")
                history = []
            case _:
                m = {"role": "user", "content": query}
                if m != history[-1] if history else True:
                    history.append(m)

    if usage["turns"]:
        print(
            f"{Prompt.Tokens}会话结束: {usage['turns']} 轮 · "
            f"输入 {usage['prompt']} tok · 输出 {usage['completion']} tok · "
            f"累计生成 {usage['seconds']:.0f}s"
        )
