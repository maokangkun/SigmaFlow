"""SigmaFlow Agent 命令行入口。

与 web 端能力对齐的升级点:
  - steering: 模型运行期间直接输入文本回车即插话(排进 steer 队列, 由
    agent 在当前回合/工具批结束后注入 —— 与 web 的 chat.steer 同语义);
    预算耗尽后才排到的插话以 steerDropped 提示, 不静默吞
  - on_tool 系统事件呈现: compact/steerDropped/ask 等打一行提示
  - /usage 与退出摘要: 每轮 info 聚合的累计 token/轮数/耗时
  - 连接参数: --model/--base-url/--api-key(缺省回落环境变量)
"""

import json
import os
import select
import time
import sys
import threading
from pathlib import Path

from rich import print

from .agent import Agent
from .conf import Prompt, SLASH_CMD
from .input import session
from .logo import Logo


def _list_model_store() -> list:
    """列出 web 端已配置的模型(id/model/baseUrl host), 供 /model 展示。"""
    base = os.environ.get("SIGMAFLOW_SCIENCE_DIR") or os.path.join(
        os.path.expanduser("~"), ".sigmaflow", "science"
    )
    try:
        data = json.loads((Path(base) / "models.json").read_text(encoding="utf-8"))
    except Exception:
        return []
    providers = data.get("providers") or {}
    out = []
    for mid, entry in (data.get("models") or {}).items():
        if not isinstance(entry, dict):
            continue
        provider = providers.get(entry.get("providerId") or "") or {}
        url = str(provider.get("baseUrl") or "")
        host = url.split("//")[-1].split("/")[0] if url else "?"
        out.append({"id": mid, "model": entry.get("model") or "?", "host": host})
    return out


def _resolve_model_store(model_id: str) -> dict | None:
    """按 web 端模型配置的 id(md-xxx)读取网关参数。

    读 ~/.sigmaflow/science/models.json(SIGMAFLOW_SCIENCE_DIR 可覆盖),
    命中则返回 {model, baseUrl, apiKey, method}; CLI 即可零环境变量直连
    已配置的网关。找不到返回 None(调用方回退普通参数)。
    """
    base = os.environ.get("SIGMAFLOW_SCIENCE_DIR") or os.path.join(
        os.path.expanduser("~"), ".sigmaflow", "science"
    )
    path = Path(base) / "models.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    entry = (data.get("models") or {}).get(model_id)
    if not isinstance(entry, dict):
        return None
    provider = (data.get("providers") or {}).get(entry.get("providerId") or "") or {}
    base_url = str(provider.get("baseUrl") or "")
    return {
        "model": entry.get("model"),
        "baseUrl": base_url or None,
        "apiKey": provider.get("apiKey"),
        # anthropic 兼容端点自动切方言
        "method": "anthropic" if "anthropic" in base_url.lower() else "openai",
    }


def _print_sysnote(text: str) -> None:
    print(f"{Prompt.System}[dim]{text}[/dim]")


def _run_turn_with_steering(agent, history: list, first_turn: bool = True) -> tuple:
    """跑一轮 agent; 运行期主线程非阻塞读行收 steering 插话。

    返回 (info, thread): 线程句柄交给调用方做并发回合保护(上一回合尚未
    收尾时禁止并发起下一轮, 两个 agent 线程同写 history 会互相踩踏)。
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
    _print_sysnote(
        "生成中——直接输入插话(steering)后回车; 本回合结束即送达模型"
        if first_turn
        else "生成中(可插话)"
    )
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
            print(f"{Prompt.Tool}[steer] 已排队({len(queue)} 条): {text[:60]}")
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
    return result.get("info") or {}, thread


def cli(
    query,
    method="anthropic",
    available_tools=None,
    debug=False,
    support_tool=False,
    model=None,
    base_url=None,
    api_key=None,
    model_id=None,
):
    def on_tool_event(ev) -> None:
        """系统类工具事件的一行提示(工具执行本体由 agent 循环自行打印)。"""
        if not isinstance(ev, dict):
            return
        kind = ev.get("kind")
        if kind == "compact":
            _print_sysnote(
                f"会话已压缩: 保留 {ev.get('kept')} 条 / 摘要 {len(str(ev.get('text') or ''))} 字"
            )
        elif kind == "steerDropped":
            _print_sysnote(
                f"{ev.get('count')} 条引导消息未送达模型(轮次预算已用尽): "
                + " / ".join(str(t)[:40] for t in ev.get("texts") or [])
            )
        elif kind == "ask":
            _print_sysnote(
                "agent 发起了提问(ask); CLI 模式暂不支持交互回答, 请在 web 端处理"
            )

    # --model-id: 直连 web 端已配置的网关(md-xxx), 零环境变量可用
    if model_id:
        hit = _resolve_model_store(model_id)
        if hit is None:
            _print_sysnote(
                f"未找到模型配置 {model_id}(检查 ~/.sigmaflow/science/models.json), 回退默认连接"
            )
        else:
            method = hit["method"]
            model = hit["model"] or model
            base_url = hit["baseUrl"] or base_url
            api_key = hit["apiKey"] or api_key
            _print_sysnote(f"使用已配置模型: {model} @ {str(base_url)[:48]}")

    def on_retry_event(r) -> None:
        """模型请求重试提示: 网关不稳时不再干等数分钟毫无反馈。"""
        if isinstance(r, dict) and r.get("attempt"):
            _print_sysnote(
                f"请求失败({r.get('attempt')}/{r.get('total')}): "
                f"{str(r.get('error') or '')[:80]} · {r.get('wait') or '?'}s 后重试"
            )

    def make_agent(m="anthropic", mdl=None, url=None, key=None):
        return Agent(
            m,
            available_tools=available_tools,
            debug=debug,
            support_tool=support_tool,
            model=mdl,
            base_url=url,
            api_key=key,
            on_tool=on_tool_event,
            on_retry=on_retry_event,
        )

    agent = make_agent(method, model, base_url, api_key)

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
    turn_thread: threading.Thread | None = None
    turns = 0
    if query:
        logo.disable_click_listener()
        history.append({"role": "user", "content": query})
        print(f"{Prompt.User}{query}")

    while True:
        if history and history[-1]["role"] == "user":
            # 并发回合保护: Ctrl+C 放弃收尾/极端卡死的旧线程仍活着时,
            # 并发起新一轮会让两个 agent 同写 history 互相踩踏
            if turn_thread is not None and turn_thread.is_alive():
                _print_sysnote("上一回合仍在收尾(后台工具/重试等待), 等它结束再继续…")
                turn_thread.join()
            turns += 1
            try:
                info, turn_thread = _run_turn_with_steering(
                    agent, history, first_turn=(turns == 1)
                )
                absorb(info)
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
            ).rstrip()
            # 多行续行: 行尾反斜杠进入续行提示, 拼接保留换行
            while query.endswith("\\"):
                query = query[:-1]
                more = session.prompt("…> ").rstrip()
                query += "\n" + more
            query = query.strip()
        except (EOFError, KeyboardInterrupt):
            break

        if query:
            logo.disable_click_listener()

        match q := query.lower():
            case _ if q in SLASH_CMD.exit:
                break
            case SLASH_CMD.help:
                _print_sysnote(
                    "命令: /help 列表 · /usage 累计 token · /history 历史 · "
                    "/model [id] 查看/切换 · /compact 压缩 · /save 导出 · "
                    "/reset 清空 · /exit 退出(空行亦可)\n"
                    "行尾反斜杠续行(多行输入) · 生成期间直接输入文本并回车 = steering 插话"
                )
            case SLASH_CMD.usage:
                print(
                    f"{Prompt.Tokens}轮数 {usage['turns']} · "
                    f"输入 {usage['prompt']} tok · 输出 {usage['completion']} tok · "
                    f"累计生成 {usage['seconds']:.0f}s"
                )
            case _ if q.startswith(SLASH_CMD.model):
                arg = query[len(SLASH_CMD.model) :].strip()
                if not arg:
                    cur = f"当前: {agent.model} @ {agent.client.base_url}"
                    entries = _list_model_store()
                    listing = (
                        "\n".join(
                            f"  {e['id']}  {e['model']}  @ {e['host']}" for e in entries
                        )
                        if entries
                        else "  (web 端未配置模型)"
                    )
                    _print_sysnote(f"{cur}\n可切换(/model <id>):\n{listing}")
                else:
                    hit = _resolve_model_store(arg)
                    if hit is None:
                        _print_sysnote(f"未找到模型配置 {arg}; /model 查看可用列表")
                    else:
                        agent = make_agent(
                            hit["method"], hit["model"], hit["baseUrl"], hit["apiKey"]
                        )
                        _print_sysnote(
                            f"已切换: {hit['model']} @ {str(hit['baseUrl'])[:48]}"
                        )
            case _ if q.startswith(SLASH_CMD.save):
                arg = query[len(SLASH_CMD.save) :].strip()
                out_dir = Path(arg or Path.home() / "sigmaflow-cli-sessions")
                if out_dir.is_dir() or arg:
                    out = out_dir
                else:
                    out = out_dir / f"session-{time.strftime('%Y%m%d-%H%M%S')}.json"
                try:
                    out.parent.mkdir(parents=True, exist_ok=True)
                    out.write_text(
                        json.dumps(
                            {
                                "savedAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
                                "usage": usage,
                                "history": history,
                            },
                            ensure_ascii=False,
                            indent=2,
                        ),
                        encoding="utf-8",
                    )
                    _print_sysnote(f"会话已导出: {out}")
                except Exception as err:
                    _print_sysnote(f"导出失败: {err}")
            case SLASH_CMD.history:
                print(f"{Prompt.History}")
                if not history:
                    _print_sysnote("(空会话)")
                for idx, m in enumerate(history):
                    role = m.get("role", "?")
                    body = str(m.get("content") or "")
                    tools = [t.get("name", "?") for t in m.get("tool_calls") or []]
                    tag = f"[{idx}] {role}" + (
                        f" ({', '.join(tools)})" if tools else ""
                    )
                    text = body if len(body) <= 200 else body[:200] + "…"
                    print(f"  {tag}: {text}")
            case SLASH_CMD.compact:
                history = agent.compactor.auto_compact(history, force=True)
            case SLASH_CMD.team:
                _print_sysnote("/team 暂未在 CLI 实现(web 端可用)")
            case SLASH_CMD.inbox:
                _print_sysnote("/inbox 暂未在 CLI 实现(web 端可用)")
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
    try:
        from .tools import BG

        running = [t for t in (BG.tasks or {}).values() if t.get("status") == "running"]
        if running:
            _print_sysnote(
                f"{len(running)} 个后台任务仍在运行(如 sleep/组装); 进程退出后失去跟踪, "
                "命令本身会继续在系统里跑完"
            )
    except Exception:
        pass
