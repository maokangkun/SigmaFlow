import logging
import re
import json
import time
import uuid
import copy
import base64
import random
import traceback
import threading
from typing import Any, Dict
import concurrent.futures
from rich import print
from openai import OpenAI
from rich.console import Console
from rich.markdown import Markdown
from rich.syntax import Syntax
from anthropic import Anthropic
from pathlib import Path
from functools import singledispatchmethod
from .tools import (
    TOOL_HANDLERS,
    skill_loader,
    Compactor,
    BG,
    MCP,
    get_session_workdir,
    set_session_workdir,
)
from .utils import KnightRiderStatus, extract_json
from .conf import *

# 超时命中标记: 与合法的 None/空串返回区分开
_TIMEOUT_HIT = object()


def _call_with_timeout(fn, seconds, label):
    """Run fn under a cooperative wall-clock limit (dsh tool-call-timeout-policy style).

    超时后工作线程仍在后台跑(协作式, 无法硬杀), 但调用方立即拿到 _TIMEOUT_HIT,
    由调用方转成模型可读的结构化错误, 避免单个工具挂死整轮对话。
    """
    if not seconds or seconds <= 0:
        return fn()
    box = {}

    def _run():
        try:
            box["out"] = fn()
        except BaseException as e:  # noqa: BLE001
            box["err"] = e

    t = threading.Thread(target=_run, daemon=True)
    t.start()
    t.join(seconds)
    if "out" in box:
        return box["out"]
    if "err" in box:
        raise box["err"]
    return _TIMEOUT_HIT


SYSTEM += skill_loader.get_descriptions()
SUBAGENT_SYSTEM += skill_loader.get_descriptions()
console = Console()


def _usage_cache_read(usage) -> int:
    """Cache-read tokens from a usage object across provider shapes.

    OpenAI 官方口径放 prompt_tokens_details.cached_tokens; 部分网关平铺
    cached_tokens / prompt_cache_hit_tokens, anthropic 为 cache_read_input_tokens。
    """
    for owner in (getattr(usage, "prompt_tokens_details", None), usage):
        if owner is None:
            continue
        for field in (
            "cached_tokens",
            "prompt_cache_hit_tokens",
            "cache_read_input_tokens",
        ):
            value = getattr(owner, field, None)
            if value:
                return int(value)
    return 0


def _shared_openai_client(base_url: str, api_key: str) -> OpenAI:
    """Reuse one OpenAI client (and its HTTP pool) per (base_url, api_key).

    每次请求新建 client 会每次重新建 TCP 连接, 网关侧按连接做负载均衡,
    换实例 = 原前缀缓存丢失(实测: 同 client 连发稳定命中 8704, 每次新建则必丢)。
    共享连接池并把 keepalive 拉长到 5 分钟, 跨请求钉住同一网关实例。
    """
    key = (base_url, api_key)
    client = _SHARED_OPENAI_CLIENTS.get(key)
    if client is None:
        import httpx

        http_sdk = httpx.Client(
            timeout=90.0,
            limits=httpx.Limits(max_keepalive_connections=16, keepalive_expiry=300.0),
        )
        client = OpenAI(
            base_url=base_url,
            api_key=api_key,
            http_client=http_sdk,
            timeout=90.0,
            max_retries=0,  # 不用 SDK 内置重试; 统一由 agent 循环重试三次
        )
        _SHARED_OPENAI_CLIENTS[key] = client
    return client


_SHARED_OPENAI_CLIENTS: Dict[tuple, OpenAI] = {}


class Agent:
    def __init__(
        self,
        method="anthropic",
        model=MODEL,
        system=SYSTEM,
        sub_system=SUBAGENT_SYSTEM,
        tools=TOOLS,
        sub_tools=CHILD_TOOLS,
        base_url=None,
        api_key=None,
        available_tools=None,
        retry=3,
        max_turn=1e10,
        debug=False,
        support_tool=False,
        on_delta=None,
        on_tool=None,
        on_retry=None,
    ):
        self.on_retry = on_retry  # 重试回调: 每次可重试失败后调用 on_retry({"attempt", "total", "error"})
        self.on_delta = on_delta  # 流式回调: 每收到一段增量文本时调用 on_delta(text)
        self.on_tool = on_tool  # 工具事件回调: on_tool({"kind": "call"|"result", "name": ..., ...})
        self.method = method
        self.model = model
        self.system = system
        self.sub_system = sub_system
        self.tools = tools
        self.sub_tools = sub_tools
        self.retry = retry
        self.max_turn = max_turn
        self.debug = debug
        self.support_tool = support_tool

        if self.support_tool:
            self.system += "\n\nNote: The agent is allowed to use tools. If the agent needs to use a tool, it should respond with a tool call in the format of <tool_call><function=tool_name><parameter=param_name>param_value</parameter></function></tool_call>. The agent should not provide any other text in its response when using a tool."

        # 时间块每个用户轮次都要刷新, 基线单独存一份避免累积拼接
        self._system_base = self.system

        match method:
            case "anthropic":
                self.client = Anthropic(
                    base_url=base_url or ANTHROPIC_BASE_URL, api_key=api_key or API_KEY
                )
                self.tools = [
                    t
                    for t in tools
                    if not available_tools or t["name"] in available_tools
                ]
            case "openai":
                # 共享连接池: 同 base/key 复用同连接, 钉住网关实例保住前缀缓存
                self.client = _shared_openai_client(
                    base_url or OPENAI_BASE_URL, api_key or API_KEY
                )
                tools = self._trans_anthropic_tools_to_openai(self.tools)
                self.tools = [
                    i
                    for i in tools
                    if not available_tools or i["function"]["name"] in available_tools
                ]
                self.sub_tools = self._trans_anthropic_tools_to_openai(sub_tools)
            case _:
                raise ValueError(f"Unsupported method: {method}")

        max_model_len = MAX_MODEL_LEN.get(self.model.lower(), MAX_MODEL_LEN["default"])
        self.compactor = Compactor(
            TRANSCRIPT_DIR, self.client, max_model_len, model=self.model
        )

        self.config = {
            "api_method": self.client.__class__.__name__,
            "base_url": self.client.base_url,
            "api_key": self.client.api_key,
            "max_model_len": max_model_len,
            "tools": self.tools,
        }

    def _time_block(self) -> str:
        """Return the per-turn clock context appended after the system prompt."""
        try:
            weekdays = [
                "Monday",
                "Tuesday",
                "Wednesday",
                "Thursday",
                "Friday",
                "Saturday",
                "Sunday",
            ]
            now = time.localtime()
            return (
                "\n\n# Current time\n"
                # 分钟粒度: 秒级时间戳让每次请求的 system 前缀必变, 完全阻断网关的
                # prompt 前缀缓存(跨请求永不命中); 分钟级同样是可靠的“现在”语义
                f"- Now: {time.strftime('%Y-%m-%d %H:%M', now)} ({weekdays[now.tm_wday]})\n"
                f"- Timezone: {time.strftime('%Z', now)} (UTC{time.strftime('%z', now)})\n"
                "- Use this as the current time when interpreting relative dates or "
                "durations from the user. Ask when time zone provenance is unclear."
            )
        except Exception:
            return ""

    def print_info(self, subagent=False):
        k = self.client.api_key or "*****"
        tools = CHILD_TOOLS if subagent else self.tools
        lines = [
            f"{Prompt.Baseurl}{self.client.base_url}",
            f"{Prompt.APIkey}{k[:5]}{'*' * (len(k) - 10)}{k[-5:]}",
            f"{Prompt.Model}[green]{self.model}[/]",
            f"{Prompt.System}{self.system if not subagent else SUBAGENT_SYSTEM}",
            f"{Prompt.MCP}{','.join(f'{k}: {v}' for k, v in MCP.meta.items()) if MCP.meta else None}",
            f"{Prompt.ToolList}{' | '.join(t['name'] if 'name' in t else t['function']['name'] for t in tools)} [{len(tools)}]",
            f"{Prompt.Config}API Method: {self.client.__class__.__name__}, Max Tokens: {MAX_TOKENS}, Compact {{threshhold: {COMPACT_THRESHOLD}, summary token: {COMPACT_TOKENS}, tool keep: {KEEP_RECENT_TOOL}}}",
        ]
        if not subagent:
            lines.append(Prompt.Tips)

        for line in lines:
            print(line)

        return lines

    @singledispatchmethod
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
    ):
        if on_delta is not None:
            self.on_delta = on_delta
        # system 恒定字节级稳定, 最大化网关前缀缓存命中; 不再注入任何会变内容
        # (模型需要当前时间时可自行调用 bash 等工具获取)
        if not subagent:
            self.system = self._system_base
        if self.method == "openai" and messages[0]["role"] != "system":
            messages.insert(
                0,
                {
                    "role": "system",
                    "content": self.system if not subagent else self.sub_system,
                },
            )
        elif self.method == "anthropic" and messages[0]["role"] == "system":
            messages.pop(0)

        info = {
            "config": self.config,
            "messages": [
                {
                    "role": "system",
                    "content": self.system if not subagent else self.sub_system,
                }
            ]
            + copy.deepcopy(messages[1:]),
            "last_response": None,
            "cost_tokens": 0,
            "completion_tokens": 0,  # 辅助上屏 tok/s 统计: 与 cost_tokens 分开, 只计补全侧
            "prompt_tokens": 0,  # 输入侧 token, 多轮工具循环时逐轮累加
            "cache_read_tokens": 0,  # 缓存读取 token(成本远低于未命中输入), 逐轮累加
            "cost_time": 0,
            "used_tools": [],
            "used_skills": [],
            "error": None,
        }

        print = console.print if is_print else lambda *_a, **_k: None

        if print_inp:
            for msg in info["messages"]:
                match msg.get("role"):
                    case "user":
                        print(f"{Prompt.User}{msg['content']}")
                    case "assistant":
                        print(f"{Prompt.Assistant}{msg['content']}")
                    case "system":
                        print(f"{Prompt.System}{msg['content']}")
                    case "tool":
                        print(f"{Prompt.Tool}{msg['content']}")
                    case _:
                        print(f"{Prompt.Unknown}{msg}")

        for m in messages:
            if m["role"] == "user":
                m["content"] = self._process_query(m["content"])

        T = self.sub_tools if subagent else self.tools
        usable_tools = (
            []
            if not self.support_tool
            else (
                T
                if tools is None
                else [
                    t
                    for t in T
                    if t.get("name", t.get("function", {}).get("name")) in tools
                ]
            )
        )

        cur_turn = len([m for m in messages if m["role"] == "assistant"])
        max_turn = max_turn or self.max_turn
        begin_time = time.time()
        manual_compact = False
        ratio = 0
        max_model_len = MAX_MODEL_LEN.get(self.model.lower(), MAX_MODEL_LEN["default"])
        while cur_turn < max_turn:
            messages[:] = self.compactor.auto_compact(
                messages, force=manual_compact, context_ratio=ratio
            )
            # 压缩发生时同步通知前端: 前端丢弃被摘要的轮次并渲染摘要卡(pi CompactionEntry)
            cmeta = getattr(self.compactor, "last_meta", None)
            if cmeta and isinstance(cmeta, dict) and cmeta.get("applied"):
                info["compaction"] = {k: v for k, v in cmeta.items() if k != "text"}
                if self.on_tool is not None:
                    try:
                        self.on_tool(
                            {
                                "kind": "compact",
                                "removed": cmeta.get("removed"),
                                "dropOldIdx": cmeta.get("dropOldIdx", -1),
                                "kept": cmeta.get("kept"),
                                "tokensBefore": cmeta.get("tokens_before"),
                                "transcript": cmeta.get("transcript"),
                                "text": cmeta.get("text"),
                            }
                        )
                    except Exception:
                        pass
            # 压缩只收缩上下文(摘要卡追加尾部), 原本占头部的 system 消息可能被
            # 摘要吞掉: 每轮压缩后都补插一次, 与函数开头的装配保持一致
            if messages[0]["role"] != "system":
                messages.insert(
                    0,
                    {
                        "role": "system",
                        "content": self.system if not subagent else self.sub_system,
                    },
                )
            manual_compact = False

            notifs = BG.drain_notifications()
            if notifs and messages:
                for n in notifs:
                    print(
                        f"{Prompt.Bgtask}Task ID: {n['task_id']}, Status: {n['status']}, Result: {n['result']}"
                    )
                notif_text = "\n".join(
                    f"[bg:{n['task_id']}] {n['status']}: {n['result']}" for n in notifs
                )
                messages.append(
                    {
                        "role": "user",
                        "content": f"<background-results>\n{notif_text}\n</background-results>",
                    }
                )
                messages.append(
                    {"role": "assistant", "content": "Noted background results."}
                )

            knight_rider = (
                KnightRiderStatus("", width=11, color="#5c9cf5", fps=30)
                if is_print and show_processing and not self.debug
                else None
            )
            tried = 0
            while tried < self.retry:
                try:
                    if knight_rider:
                        knight_rider.start()
                    start_time = time.time()
                    match self.method:
                        case "anthropic":
                            response = self.client.messages.create(
                                model=self.model,
                                system=self.system,
                                messages=messages,
                                tools=usable_tools,
                                max_tokens=MAX_TOKENS,
                            )
                            response.content = sorted(
                                response.content,
                                key=lambda x: 0 if x.type == "thinking" else 1,
                            )
                            info["cost_tokens"] += (
                                response.usage.input_tokens
                                + response.usage.output_tokens
                            )
                            info["prompt_tokens"] += (
                                getattr(response.usage, "input_tokens", 0) or 0
                            )
                            info["completion_tokens"] += (
                                getattr(response.usage, "output_tokens", 0) or 0
                            )
                            info["last_prompt_tokens"] = (
                                getattr(response.usage, "input_tokens", 0) or 0
                            )
                            info["cache_read_tokens"] += _usage_cache_read(
                                response.usage
                            )
                            messages.append(
                                {"role": "assistant", "content": response.content}
                            )
                            info["messages"].append(
                                {
                                    "role": "assistant",
                                    "content": [i.dict() for i in response.content],
                                }
                            )
                        case "openai" if self.on_delta is not None:
                            # 流式路径: 逐块推送增量文本/思考, 同时累积完整响应供后续逻辑使用。
                            # 支持工具调用: 增量聚合 tool_calls 分片, 聚合结果走与非流式
                            # 分支相同的工具执行路径。
                            class _DeltaMsg:
                                # 动态聚合的流式响应壳: 字段在流过程中逐个赋值
                                content: Any = None
                                tool_calls: Any = None
                                usage: Any = None
                                choices: Any = None

                            class _DeltaUsage:
                                def __init__(self):
                                    self.total_tokens = 0
                                    self.prompt_tokens = 0
                                    self.completion_tokens = 0
                                    self.prompt_tokens_details: Any = None

                            class _ToolCall:
                                def __init__(self, id, name, arguments):
                                    self.id, self.type = id, "function"
                                    self.function = type(
                                        "F", (), {"name": name, "arguments": arguments}
                                    )()

                            response_text_parts: list[Any] = []
                            tool_calls_acc: list = []
                            usage = _DeltaUsage()
                            stream_kwargs = {
                                "stream": True,
                                "stream_options": {"include_usage": True},
                            }
                            if usable_tools:
                                stream_kwargs |= {
                                    "tools": usable_tools,
                                    "tool_choice": "auto",
                                }
                            try:
                                _stream = self.client.chat.completions.create(
                                    model=self.model,
                                    messages=messages,
                                    max_tokens=MAX_TOKENS,
                                    **stream_kwargs,
                                )
                            except Exception:
                                # 部分兼容网关不支持 stream_options, 去掉后重试
                                _fallback = dict(stream_kwargs)
                                _fallback.pop("stream_options", None)
                                _stream = self.client.chat.completions.create(
                                    model=self.model,
                                    messages=messages,
                                    max_tokens=MAX_TOKENS,
                                    **_fallback,
                                )
                            # 空流检测: 部分网关(deepseek/pjlab)对 stream_options 返回无 deltas 的流
                            # (HTTP 200 但 completion=1 token 直接收 eos) — 此时去掉 stream_options 重发一次。
                            _had_content = False
                            for chunk in _stream:
                                if getattr(chunk, "usage", None):
                                    usage.total_tokens = (
                                        getattr(chunk.usage, "total_tokens", 0) or 0
                                    )
                                    usage.prompt_tokens = (
                                        getattr(chunk.usage, "prompt_tokens", 0) or 0
                                    )
                                    usage.completion_tokens = (
                                        getattr(chunk.usage, "completion_tokens", 0)
                                        or 0
                                    )
                                    # 缓存字段引用透传: 手工壳只拷标准三字段会丢
                                    # prompt_tokens_details, 网关(http cache 命中)的上报无处可取
                                    _ptd = getattr(
                                        chunk.usage, "prompt_tokens_details", None
                                    )
                                    if _ptd is not None:
                                        usage.prompt_tokens_details = _ptd
                                choices = getattr(chunk, "choices", None)
                                if not choices:
                                    continue
                                delta = choices[0].delta
                                think = getattr(
                                    delta, "reasoning_content", None
                                ) or getattr(delta, "reasoning", None)
                                if think:
                                    _had_content = True
                                    info.setdefault("reasoning_parts", []).append(think)
                                    try:
                                        self.on_delta(None, think)
                                    except Exception:
                                        pass
                                piece = getattr(delta, "content", None)
                                if piece:
                                    _had_content = True
                                    response_text_parts.append(piece)
                                    try:
                                        self.on_delta(piece)
                                    except Exception:
                                        pass
                                for tc in getattr(delta, "tool_calls", None) or []:
                                    _had_content = True
                                    if tc.index is None:
                                        tc.index = len(tool_calls_acc)
                                    while len(tool_calls_acc) <= tc.index:
                                        tool_calls_acc.append(
                                            {
                                                "id": None,
                                                "type": "function",
                                                "function": {
                                                    "name": "",
                                                    "arguments": "",
                                                },
                                            }
                                        )
                                    if tc.id:
                                        tool_calls_acc[tc.index]["id"] = tc.id
                                    if getattr(tc.function, "name", None):
                                        tool_calls_acc[tc.index]["function"][
                                            "name"
                                        ] += tc.function.name
                                    if getattr(tc.function, "arguments", None):
                                        tool_calls_acc[tc.index]["function"][
                                            "arguments"
                                        ] += tc.function.arguments
                            if not _had_content and stream_kwargs.get("stream_options"):
                                # 空流(无 deltas 无 tool_calls)且带了 stream_options: 认定网关不支持,
                                # 去掉后重发一次; usage 由不含 stream_options 的路径无法获得, 保持 0。
                                try:
                                    _stream.close()
                                except Exception:
                                    pass
                                _fallback = dict(stream_kwargs)
                                _fallback.pop("stream_options", None)
                                _stream = self.client.chat.completions.create(
                                    model=self.model,
                                    messages=messages,
                                    max_tokens=MAX_TOKENS,
                                    **_fallback,
                                )
                                stream_kwargs = _fallback
                                _had_content = False
                                for chunk in _stream:
                                    if getattr(chunk, "usage", None):
                                        usage.total_tokens = (
                                            getattr(chunk.usage, "total_tokens", 0) or 0
                                        )
                                        usage.prompt_tokens = (
                                            getattr(chunk.usage, "prompt_tokens", 0)
                                            or 0
                                        )
                                        usage.completion_tokens = (
                                            getattr(chunk.usage, "completion_tokens", 0)
                                            or 0
                                        )
                                    choices = getattr(chunk, "choices", None)
                                    if not choices:
                                        continue
                                    delta = choices[0].delta
                                    think = getattr(
                                        delta, "reasoning_content", None
                                    ) or getattr(delta, "reasoning", None)
                                    if think:
                                        info.setdefault("reasoning_parts", []).append(
                                            think
                                        )
                                        try:
                                            self.on_delta(None, think)
                                        except Exception:
                                            pass
                                    piece = getattr(delta, "content", None)
                                    if piece:
                                        response_text_parts.append(piece)
                                        try:
                                            self.on_delta(piece)
                                        except Exception:
                                            pass
                                    for tc in getattr(delta, "tool_calls", None) or []:
                                        if tc.index is None:
                                            tc.index = len(tool_calls_acc)
                                        while len(tool_calls_acc) <= tc.index:
                                            tool_calls_acc.append(
                                                {
                                                    "id": None,
                                                    "type": "function",
                                                    "function": {
                                                        "name": "",
                                                        "arguments": "",
                                                    },
                                                }
                                            )
                                        if tc.id:
                                            tool_calls_acc[tc.index]["id"] = tc.id
                                        if getattr(tc.function, "name", None):
                                            tool_calls_acc[tc.index]["function"][
                                                "name"
                                            ] += tc.function.name
                                        if getattr(tc.function, "arguments", None):
                                            tool_calls_acc[tc.index]["function"][
                                                "arguments"
                                            ] += tc.function.arguments
                            info["cost_tokens"] += usage.total_tokens
                            info["prompt_tokens"] += usage.prompt_tokens or 0
                            info["completion_tokens"] += usage.completion_tokens or 0
                            info["cache_read_tokens"] += _usage_cache_read(usage)
                            # 每轮调用诊断: 观察网关在循环内对 cache 字段的逐轮返回
                            logging.getLogger("sigmaflow.agent").info(
                                "per-call usage: prompt=%s cached=%s",
                                usage.prompt_tokens,
                                usage.prompt_tokens_details.cached_tokens
                                if getattr(usage, "prompt_tokens_details", None)
                                else None,
                            )
                            # 最后一轮当次 prompt: 反映单次请求的真实窗口占用(累计值是多轮求和)
                            info["last_prompt_tokens"] = usage.prompt_tokens or 0
                            msg = _DeltaMsg()
                            msg.content = "".join(response_text_parts)
                            msg.tool_calls = [
                                _ToolCall(
                                    t["id"],
                                    t["function"]["name"],
                                    t["function"]["arguments"],
                                )
                                for t in tool_calls_acc
                            ] or None
                            # 空响应校验在写回 messages 之前: 空轮次不能进入历史,
                            # 否则重试时发回"空 assistant 消息"会触发上游 400。
                            if not msg.tool_calls and not (msg.content or "").strip():
                                raise ValueError(
                                    "Model returned an empty response (no content, no tool calls)"
                                )
                            if msg.tool_calls:
                                # 与非流式分支一致: 工具调用轮的 assistant 消息要写回 messages,
                                # 供下一轮连同 tool 结果一起发送
                                m = {"role": "assistant"}
                                if msg.content and msg.content.strip():
                                    m["content"] = msg.content
                                m["tool_calls"] = tool_calls_acc
                                messages.append(m)
                                info["messages"].append(m)
                            response = _DeltaMsg()
                            response.usage = usage
                            response.choices = [_DeltaMsg()]
                            response.choices[0].message = msg
                        case "openai":
                            tool_param = (
                                {"tools": usable_tools, "tool_choice": "auto"}
                                if usable_tools
                                else {}
                            )
                            response = self.client.chat.completions.create(
                                model=self.model,
                                messages=messages,
                                max_tokens=MAX_TOKENS,
                                **tool_param,
                            )
                            if isinstance(response, str) or not hasattr(
                                response, "usage"
                            ):
                                raise ValueError(
                                    f"Unexpected response from provider: {str(response)[:200]}"
                                )
                            info["cost_tokens"] += (
                                getattr(response.usage, "total_tokens", 0)
                                if response.usage
                                else 0
                            )
                            info["prompt_tokens"] += (
                                getattr(response.usage, "prompt_tokens", 0)
                                if response.usage
                                else 0
                            )
                            info["last_prompt_tokens"] = (
                                getattr(response.usage, "prompt_tokens", 0)
                                if response.usage
                                else 0
                            )
                            info["cache_read_tokens"] += (
                                _usage_cache_read(response.usage)
                                if response.usage
                                else 0
                            )
                            info["completion_tokens"] += (
                                getattr(response.usage, "completion_tokens", 0)
                                if response.usage
                                else 0
                            )
                            assert response.choices is not None, (
                                f"Response is None: {response}"
                            )
                            msg = response.choices[0].message
                            # 与流式分支一致: 空轮次不进入历史, 直接触发重试。
                            if (
                                not getattr(msg, "tool_calls", None)
                                and not (getattr(msg, "content", None) or "").strip()
                            ):
                                raise ValueError(
                                    "Model returned an empty response (no content, no tool calls)"
                                )
                            m = {"role": "assistant"}
                            if msg.content and msg.content.strip():
                                m["content"] = msg.content
                            if msg.tool_calls:
                                m["tool_calls"] = [t.dict() for t in msg.tool_calls]
                            messages.append(m)
                            if (
                                r := msg.reasoning_content
                                if hasattr(msg, "reasoning_content")
                                else None
                            ):
                                if msg.tool_calls:
                                    m["reasoning_content"] = r
                                    info["messages"].append(m)
                                else:
                                    info["messages"].append(
                                        m | {"reasoning_content": r}
                                    )
                            elif (
                                r := msg.reasoning
                                if hasattr(msg, "reasoning")
                                else None
                            ):
                                if msg.tool_calls:
                                    m["reasoning"] = r
                                    info["messages"].append(m)
                                else:
                                    info["messages"].append(m | {"reasoning": r})
                            else:
                                info["messages"].append(m)

                    cost_time = time.time() - start_time
                    if knight_rider:
                        knight_rider.stop()
                    info["error"] = None
                    break
                except Exception as e:
                    if knight_rider:
                        knight_rider.stop()
                    console.print(f"{Prompt.Error}[red]{e}[/]")
                    info["error"] = str(e)
                    if any([e in info["error"] for e in API_ERRORS]):
                        tried = self.retry
                    else:
                        tried += 1
                        if self.on_retry is not None and tried < self.retry:
                            # 只对还会重试的失败发通知; 可重试错误在 UI 上显示第 N 次失败与原因
                            try:
                                self.on_retry(
                                    {
                                        "attempt": tried,
                                        "total": self.retry,
                                        "error": str(e)[:200],
                                    }
                                )
                            except Exception:
                                pass
                        time.sleep(random.randint(2, 5))
                        if tried == self.retry:
                            console.print(f"{Prompt.Error}{traceback.format_exc()}")
            else:
                break

            match self.method:
                case "anthropic":
                    if response.stop_reason != "tool_use":
                        if (
                            "qwen" in self.model.lower()
                            and (t := response.content[-1].text.strip())
                            and "<tool_call>" in t
                            and "</tool_call>" in t
                        ):
                            response.content = self._parse_to_anthropic_toolcall(t)
                            response.stop_reason = "tool_use"
                        else:
                            for block in response.content:
                                if block.type == "text":
                                    md = Markdown(block.text)
                                    print(f"{Prompt.Assistant}")
                                    print(md)
                                    info["last_response"] = block.text
                                elif block.type == "thinking":
                                    print(
                                        f"{Prompt.Assistant}[dim][italic]thinking[/]\n{block.thinking}[/]"
                                    )
                                else:
                                    print(f"{Prompt.Assistant}{block}")

                            ratio = (
                                response.usage.input_tokens
                                + response.usage.output_tokens
                            ) / max_model_len
                            print(
                                f"{Prompt.Tokens}inp: {response.usage.input_tokens}, out: {response.usage.output_tokens}, time: {cost_time:.2f}s, {response.usage.output_tokens / cost_time:.2f} tokens/s, tools: {sum(not i[-1].startswith('Error:') for i in info['used_tools'])}/{len(info['used_tools'])}, skills: {sum(not i[-1].startswith('Error:') for i in info['used_skills'])}/{len(info['used_skills'])}, context: {Prompt.RedLine * round(ratio * 10)}{Prompt.BlueLine * (10 - round(ratio * 10))} {ratio:.1%}"
                            )

                            if not BG.is_finished or BG._notification_queue:
                                with KnightRiderStatus(
                                    "run background tasks",
                                    width=11,
                                    color="#fbd367",
                                    fps=30,
                                ):
                                    while not BG.is_finished:
                                        time.sleep(0.1)
                                continue

                            if response.stop_reason == "max_tokens" or (
                                info["last_response"] is None
                                and response.usage.output_tokens == MAX_TOKENS
                            ):
                                console.print(
                                    f"{Prompt.Error}[red]Max tokens reached[/]"
                                )
                                info["error"] = (
                                    "Max tokens reached, output may be incomplete"
                                )

                            break
                case "openai":
                    if (
                        r := msg.reasoning_content
                        if hasattr(msg, "reasoning_content")
                        else (msg.reasoning if hasattr(msg, "reasoning") else None)
                    ):
                        print(f"{Prompt.Assistant}[dim][italic]thinking[/]\n{r}[/]")

                    # content 可能为 None(deepseek 只回 reasoning/工具调用时给 content:null), 统一安全化
                    content_txt = msg.content or ""
                    if not msg.tool_calls:
                        if (
                            "qwen" in self.model.lower()
                            and content_txt
                            and "<tool_call>" in content_txt
                            and content_txt.endswith("</tool_call>")
                        ):
                            msg.tool_calls = self._parse_to_openai_toolcall(content_txt)
                        elif (
                            "intern" in self.model.lower()
                            and content_txt
                            and (
                                "```tool" in content_txt
                                or '"tool_calls": [' in content_txt
                            )
                        ):
                            msg.tool_calls = self._parse_intern_to_openai_toolcall(
                                content_txt
                            )
                        elif self.support_tool and (
                            (
                                "<tool_call>" in content_txt
                                and content_txt.endswith("</tool_call>")
                            )
                            or ("｜DSML｜invoke" in content_txt)
                        ):
                            msg.tool_calls = self._parse_to_openai_toolcall(content_txt)
                        else:
                            # 空响应(无内容也无工具调用)视为可重试失败: 提供商偶发提前断流时
                            # 原实现把空串当最终回复返回, 上层只报"模型没有返回内容"且不重试。
                            if not content_txt.strip():
                                raise ValueError(
                                    "Model returned an empty response (no content, no tool calls)"
                                )
                            print(f"{Prompt.Assistant}{content_txt}")
                            info["last_response"] = content_txt

                            _usage = (
                                response.usage
                                if hasattr(response.usage, "total_tokens")
                                else None
                            )
                            ratio = _usage.total_tokens / max_model_len if _usage else 0
                            print(
                                f"{Prompt.Tokens}inp: {_usage.prompt_tokens if _usage else '?'}, out: {_usage.completion_tokens if _usage else '?'}, time: {cost_time:.2f}s, {(_usage.completion_tokens or 0) / cost_time if _usage else 0:.2f} tokens/s, tools: {sum(not i[-1].startswith('Error:') for i in info['used_tools'])}/{len(info['used_tools'])}, skills: {sum(not i[-1].startswith('Error:') for i in info['used_skills'])}/{len(info['used_skills'])}, context: {Prompt.RedLine * round(ratio * 10)}{Prompt.BlueLine * (10 - round(ratio * 10))} {ratio:.1%}"
                            )

                            if (
                                info["last_response"] is None
                                and _usage
                                and _usage.completion_tokens == MAX_TOKENS
                            ):
                                console.print(
                                    f"{Prompt.Error}[red]Max tokens reached[/]"
                                )
                                info["error"] = (
                                    "Max tokens reached, output may be incomplete"
                                )

                            break
                    else:
                        if msg.content and msg.content.strip():
                            print(f"{Prompt.Assistant}{msg.content}")

            match self.method:
                case "anthropic":
                    ratio = (
                        response.usage.input_tokens + response.usage.output_tokens
                    ) / max_model_len
                    tool_count = len(
                        [b for b in response.content if b.type == "tool_use"]
                    )
                    print(
                        f"{Prompt.Tokens}inp: {response.usage.input_tokens}, out: {response.usage.output_tokens}, time: {cost_time:.2f}s, {response.usage.output_tokens / cost_time:.2f} tokens/s, tools: {tool_count}, context: {Prompt.RedLine * round(ratio * 10)}{Prompt.BlueLine * (10 - round(ratio * 10))} {ratio:.1%}"
                    )
                case "openai":
                    ratio = (
                        response.usage.total_tokens / max_model_len
                        if response.usage
                        else 0
                    )
                    print(
                        f"{Prompt.Tokens}inp: {response.usage.prompt_tokens}, out: {response.usage.completion_tokens}, time: {cost_time:.2f}s, {(response.usage.completion_tokens or 0) / cost_time:.2f} tokens/s, tool calls: {len(msg.tool_calls)}, context: {Prompt.RedLine * round(ratio * 10)}{Prompt.BlueLine * (10 - round(ratio * 10))} {ratio:.1%}"
                    )

            # Tools calling
            # 两段式: 第一段解析 tool_use 块并广播 call 事件; 第二段执行、打印并回填结果。
            # 同轮的多个普通工具互不依赖, 可并行执行; task(子 agent)与单工具保持串行。
            calls = []
            for block in (
                response.content if self.method == "anthropic" else msg.tool_calls
            ):
                match block.type:
                    case "text":
                        print(f"{Prompt.Assistant}{block.text}")
                    case "thinking":
                        print(
                            f"{Prompt.Assistant}[dim][italic]thinking[/]\n{block.thinking}[/]"
                        )
                    case "tool_use" | "function":
                        if block.type == "tool_use":
                            func = block.name
                            inp = block.input
                        else:
                            func = block.function.name
                            try:
                                inp = json.loads(block.function.arguments or "{}")
                            except json.JSONDecodeError:
                                inp = block.function.arguments
                                print(
                                    f"{Prompt.Error}Failed to parse function arguments as JSON, using raw string. Function: {func}, Arguments: {inp}"
                                )
                                calls.append(
                                    {
                                        "block": block,
                                        "func": func,
                                        "inp": None,
                                        "output": "Error: Failed to parse function arguments as JSON.",
                                        "task": False,
                                    }
                                )
                                continue
                        if (
                            func == "write"
                            and (t := inp.get("content", ""))
                            and len(t) > 1000
                        ):
                            inp_prt = inp.copy()
                            inp_prt["content"] = t[:400] + "..." + t[-400:]
                        elif func == "edit":
                            inp_prt = inp.copy()
                            if (t := inp.get("old_text", "")) and len(t) > 1000:
                                inp_prt["old_text"] = t[:400] + "..." + t[-400:]
                            if (t := inp.get("new_text", "")) and len(t) > 1000:
                                inp_prt["new_text"] = t[:400] + "..." + t[-400:]
                        else:
                            inp_prt = inp
                        print(
                            f"{Prompt.Assistant}[orange3][italic]tool_use[/]\nname: {func}\ninput: [/]{inp_prt}"
                        )
                        calls.append(
                            {
                                "block": block,
                                "func": func,
                                "inp": inp,
                                "output": None,
                                "task": func == "task",
                            }
                        )
                    case _:
                        print(f"{Prompt.Assistant}{block}")

            # call 事件按原始顺序广播, 前端按 name 与未完成状态配对结果
            for c in calls:
                if self.on_tool is not None:
                    try:
                        self.on_tool(
                            {
                                "kind": "call",
                                "name": c["func"],
                                "args": c["inp"]
                                if isinstance(c["inp"], dict)
                                else str(c["inp"]),
                            }
                        )
                    except Exception:
                        pass

            session_wd = get_session_workdir()

            def _tool_exec(c):
                # 失败不中断会话: 任何异常都转成错误文本, 作为该次调用的结果返回给模型
                func, inp = c["func"], c["inp"]
                try:
                    if c["task"]:
                        console.rule("Subagent Started", style="bold red")
                        self.print_info(subagent=True)
                        sub_messages = [{"role": "user", "content": inp["prompt"]}]
                        sub_info = {}
                        try:
                            sub_info = self(sub_messages, subagent=True) or {}
                            sub_out = (
                                sub_messages[-1]["content"][0].text
                                if sub_messages
                                else "(no summary)"
                            )
                        except Exception as sub_err:
                            sub_out = f"Error: subagent failed: {type(sub_err).__name__}: {str(sub_err)[:300]}"
                        # 子代理改过的文件并入父会话的产出清单(dsh deliverables 思路)
                        _dl = info.setdefault("deliverables", [])
                        for d in sub_info.get("deliverables") or []:
                            if not any(x.get("path") == d.get("path") for x in _dl):
                                _dl.append(d)
                        console.rule("Subagent End", style="bold red")
                        return sub_out
                    handler = TOOL_HANDLERS.get(func)
                    if handler is None:
                        return f"Error: unknown tool {func}"
                    # ask 类工具需要把问题卡片推给前端并阻塞等待回答,
                    # 通过 _notify 注入本会话的 on_tool 回调(允许被用户重命名, 认 __ask_tool__ 标记)
                    if getattr(handler, "__ask_tool__", False):
                        # ask 由用户回答节奏决定, 不设外层超时
                        inp.pop("_notify", None)
                        return str(handler(_notify=self.on_tool, **inp))
                    timeout = TOOL_TIMEOUTS.get(func, TOOL_TIMEOUT_DEFAULT)
                    # 会话工作目录是 thread-local: 超时包装可能把 handler 挪到新线程,
                    # 必须在执行前把当前会话的目录绑到那个线程, 否则相对路径会
                    # 回退到进程根目录, 破坏项目隔离
                    _wd = get_session_workdir()

                    def _run_handler():
                        set_session_workdir(_wd)
                        return handler(**inp)

                    out = _call_with_timeout(_run_handler, int(timeout), func)
                    if out is _TIMEOUT_HIT:
                        # 结构化超时错误: 让模型知道该换路, 而不是拿到裸异常
                        return (
                            f"Error: Tool {func} did not finish within {int(timeout)}s "
                            "(timeout). The call was abandoned and may still be running "
                            "in the background. Try a different approach or split the work; "
                            "do not repeat this exact call."
                        )
                    return str(out)
                except Exception as tool_err:
                    return "Error: " + (f"{type(tool_err).__name__}: {tool_err}")[:400]

            # 渐进式重复守卫(dsh repeat-tool-reminder 思路): 同一工具+完全相同参数
            # 第 2/3 次仍放行(合法场景: 改完代码重跑同一条测试), 但在结果后附提醒;
            # 第 4 次起判定为死循环, 不再执行, 直接回上次结果并强制要求作答。
            # 计数在 info['used_tools'] 上, 其生命周期=一个用户轮次, 天然随新消息清零。
            def _call_key(inp):
                try:
                    return json.dumps(inp, sort_keys=True, ensure_ascii=False)
                except Exception:
                    return repr(inp)

            def _count_repeats(c):
                k = _call_key(c["inp"])
                n = 0
                for u in info["used_tools"]:
                    try:
                        if u[0] == c["func"] and (
                            u[1] == c["inp"] or _call_key(u[1]) == k
                        ):
                            n += 1
                    except Exception:
                        continue
                return n

            for c in calls:
                if c["output"] is not None:
                    continue
                repeats = _count_repeats(c)
                if repeats >= 3:
                    k = _call_key(c["inp"])
                    prev = next(
                        (
                            u
                            for u in reversed(info["used_tools"])
                            if u[0] == c["func"]
                            and (u[1] == c["inp"] or _call_key(u[1]) == k)
                        ),
                        None,
                    )
                    if prev is not None:
                        c["output"] = (
                            str(prev[2])[:4000]
                            + "\n[System] This exact tool call was already executed "
                            f"{repeats} time(s) with the result above. This is a repeated-loop pattern. "
                            "Do NOT call it again; answer the user now based on the results you already have."
                        )
                        continue
                elif repeats >= 1:
                    c["repeat_note"] = repeats

            needs_wd = {"bash", "grep", "read", "write", "edit"}

            def _tool_exec_cwd(c):
                # 工具的工作目录存在 thread-local 上, 并行线程需要重新绑定
                if c["func"] in needs_wd:
                    try:
                        set_session_workdir(session_wd)
                    except Exception:
                        pass
                return _tool_exec(c)

            runnable = [c for c in calls if c["output"] is None]

            def _note(c, o):
                # 第 n 次重复执行的软提醒: 只附在成功结果后面, 不影响错误回传
                n = c.pop("repeat_note", None)
                if n and isinstance(o, str) and not o.startswith("Error:"):
                    o += (
                        "\n[System] Reminder: this exact call has now been executed "
                        f"{n + 1} time(s) with identical arguments. If nothing changed "
                        "since the previous run the result will be the same — review it "
                        "and continue, or change your approach."
                    )
                return o

            if len(runnable) > 1 and not any(c["task"] for c in runnable):
                with concurrent.futures.ThreadPoolExecutor(
                    max_workers=min(4, len(runnable))
                ) as pool:
                    outs = list(pool.map(_tool_exec_cwd, runnable))
                for c, o in zip(runnable, outs):
                    c["output"] = _note(c, o)
            else:
                for c in runnable:
                    c["output"] = _note(
                        c, _tool_exec(c) if c["task"] else _tool_exec_cwd(c)
                    )

            results = []
            for c in calls:
                func, inp, output = c["func"], c["inp"], c["output"]
                out_prt = output
                if len(output) > 1000:
                    out_prt = output[:400] + "\n......\n" + output[-400:]
                if func in MCP.tools:
                    print(f"{Prompt.MCP}[magenta]{func.upper()}[/]\n{out_prt}")
                elif func == "edit" and not output.startswith("Error:"):
                    print(f"{Prompt.Tool}[magenta]{func.upper()}[/]")
                    self._print_syntax(output, "diff")
                elif func in {"read", "write"} and not output.startswith("Error:"):
                    code = output if func == "read" else inp.get("content", "")
                    print(f"{Prompt.Tool}[magenta]{func.upper()}[/]")
                    offset = inp.get("offset")
                    start_line = (
                        offset
                        if offset and code.startswith(f"[{offset} lines skipped]")
                        else 1
                    )
                    self._print_syntax(
                        code,
                        Syntax.guess_lexer(inp.get("path", ""), code=code),
                        start_line=start_line,
                    )
                    if func == "write":
                        print(out_prt)
                else:
                    print(f"{Prompt.Tool}[magenta]{func.upper()}[/]\n{out_prt}")

                if self.on_tool is not None:
                    try:
                        self.on_tool(
                            {
                                "kind": "result",
                                "name": func,
                                "result": str(output)[:2000],
                            }
                        )
                    except Exception:
                        pass
                match self.method:
                    case "anthropic":
                        results.append(
                            {
                                "type": "tool_result",
                                "tool_use_id": c["block"].id,
                                "content": output,
                            }
                        )
                        # anthropic: 同样把 tool_result 补回 messages, 供下一轮发送。
                        messages.append(
                            {
                                "role": "user",
                                "content": [
                                    {
                                        "type": "tool_result",
                                        "tool_use_id": c["block"].id,
                                        "content": output,
                                    }
                                ],
                            }
                        )
                    case "openai":
                        results.append(
                            {
                                "role": "tool",
                                "tool_call_id": c["block"].id,
                                "content": str(output),
                            }
                        )
                        # 工具结果必须进入 messages, 否则下一轮模型看不到结果 (deepseek 等会反复空回)
                        messages.append(
                            {
                                "role": "tool",
                                "tool_call_id": c["block"].id,
                                "content": str(output),
                            }
                        )

                # 产出文件收集(dsh deliverables 思路): 只信 edit/write 的参数位置,
                # 不依赖模型正文提名, 前端在回合结束渲染「本轮修改文件」
                if func in ("write", "edit") and isinstance(inp, dict):
                    _p = str(inp.get("path") or "").strip()
                    if _p and not str(output).startswith("Error:"):
                        _dl = info.setdefault("deliverables", [])
                        if not any(d["path"] == _p for d in _dl):
                            _dl.append({"path": _p, "op": func})

                if func == "load_skill":
                    info["used_skills"].append((inp.get("name"), output))
                else:
                    info["used_tools"].append((func, inp, output))

            cur_turn += 1
            if cur_turn == max_turn - 1:
                console.print(
                    f"{Prompt.Warning}Max turn {max_turn} will be reached in the next turn, stopping to avoid infinite loop."
                )
                m = [
                    {
                        "role": "user",
                        "content": "[System] Max turn will be reached in the next turn, just finalize the response without calling tools. Stopping to avoid infinite loop.",
                    }
                ]
                print(f"{Prompt.User}{m[0]['content']}")
                messages.extend(m)
                info["messages"].extend(m)

        if not subagent and self.on_tool is not None and info.get("deliverables"):
            # 放在最末尾: 前端块按事件到达顺序排列, 产出文件行要落在最终文本之后
            try:
                self.on_tool({"kind": "deliverables", "files": info["deliverables"]})
            except Exception:
                pass

        info["cost_time"] = time.time() - begin_time
        print(
            f"{Prompt.Ended}total tokens: {info['cost_tokens']}, time: {info['cost_time']:.2f}s, tools: {len(info['used_tools'])}, skills: {len(info['used_skills'])}, rounds: {cur_turn}"
        )
        return info

    @__call__.register(str)
    def _(self, query: str, **kw):
        m = [{"role": "user", "content": query}]
        return self(m, **kw)

    def _process_query(self, query: str):
        if type(query) is str:
            pattern = r"@\S+.[png|jpg|jpeg|txt|pdf|docx|xlsx]\s"
            last_end = 0
            result: list[dict[str, Any]] = []
            for match in re.finditer(pattern, query):
                start, end = match.span()
                if t := query[last_end:start].strip():
                    result.append({"type": "text", "text": t})
                img = Path(query[start + 1 : end].strip())
                if img.exists():
                    match self.method:
                        case "anthropic":
                            result.append(
                                {
                                    "type": "image",
                                    "source": {
                                        "type": "base64",
                                        "media_type": "image/jpeg"
                                        if img.suffix in [".jpg", ".jpeg"]
                                        else "image/png",
                                        "data": base64.standard_b64encode(
                                            img.open("rb").read()
                                        ).decode("utf-8"),
                                    },
                                }
                            )
                        case "openai":
                            result.append(
                                {
                                    "type": "image_url",
                                    "image_url": {
                                        "url": "data:image/png;base64,"
                                        + base64.b64encode(
                                            img.open("rb").read()
                                        ).decode("utf-8")
                                    },
                                }
                            )
                last_end = end
            if t := query[last_end:].strip():
                result.append({"type": "text", "text": t})

            if [r for r in result if r["type"].startswith("image")]:
                return result

        return query

    def _trans_anthropic_tools_to_openai(self, tools):
        return [
            {
                "type": "function",
                "function": {
                    "name": t["name"],
                    "description": t.get("description", ""),
                    "parameters": t.get("input_schema", {}),
                },
            }
            for t in tools
        ]

    def _parse_to_openai_toolcall(self, xml_string):
        from openai.types.chat import ChatCompletionMessageToolCall
        from openai.types.chat.chat_completion_message_tool_call import Function

        tool_calls: list = []
        pattern = r"<tool_call>\s*<function=([\w\d_.-]+)>\s*(.*?)\s*</function>\s*</tool_call>"
        matches = re.findall(pattern, xml_string, re.DOTALL)
        # DeepSeek 系模型常把工具调用以 DSML 形式泄漏到正文:
        # <｜DSML｜invoke name="bash"><｜DSML｜parameter name="command" string="true">ls</｜DSML｜parameter></｜DSML｜invoke>
        if not matches:
            dsml_re = re.compile(
                r'<｜DSML｜invoke name="([\w\d_.-]+)"\s*>([\s\S]*?)</｜DSML｜invoke>'
            )
            for func_name, func_body in dsml_re.findall(xml_string):
                params = {}
                pre = re.compile(
                    r'<｜DSML｜parameter name="([\w_.-]+)"[^>]*>([\s\S]*?)</｜DSML｜parameter>'
                )
                for p_name, p_value in pre.findall(func_body):
                    if p_value.strip():
                        params[p_name] = p_value.strip()
                tool_calls.append(
                    ChatCompletionMessageToolCall(
                        id=f"call_{str(uuid.uuid4()).replace('-', '')[:8]}",
                        type="function",
                        function=Function(name=func_name, arguments=json.dumps(params)),
                    )
                )
            return tool_calls

        for func_name, func_body in matches:
            params = {}
            param_pattern = r"<parameter=([\w_.-]+)>\s*(.*?)\s*</parameter>"
            param_matches = re.findall(param_pattern, func_body, re.DOTALL)
            for param_name, param_value in param_matches:
                param_value = param_value.strip()
                if param_value:
                    params[param_name] = param_value

            tool_call = ChatCompletionMessageToolCall(
                id=f"call_{str(uuid.uuid4()).replace('-', '')[:8]}",
                type="function",
                function=Function(name=func_name, arguments=json.dumps(params)),
            )

            tool_calls.append(tool_call)
        return tool_calls

    def _parse_intern_to_openai_toolcall(self, text):
        from openai.types.chat import ChatCompletionMessageToolCall
        from openai.types.chat.chat_completion_message_tool_call import Function

        if data := extract_json(text):
            tool_calls = []
            for item in data.get("tool_calls", []):
                tool_call = ChatCompletionMessageToolCall(
                    id=item.get("id", f"call_{str(uuid.uuid4()).replace('-', '')[:8]}"),
                    type="function",
                    function=Function(
                        name=item.get("function", {}).get("name", ""),
                        arguments=json.dumps(
                            item.get("function", {}).get("arguments", {})
                        ),
                    ),
                )
                tool_calls.append(tool_call)
            return tool_calls

        return self._parse_to_openai_toolcall(text)

    def _parse_to_anthropic_toolcall(self, xml_string):
        from anthropic.types.tool_use_block import ToolUseBlock

        pattern = r"<tool_call>\s*<function=([\w\d_.-]+)>\s*(.*?)\s*</function>\s*</tool_call>"
        matches = re.findall(pattern, xml_string, re.DOTALL)

        tool_calls = []
        for func_name, func_body in matches:
            params = {}
            param_pattern = r"<parameter=([\w_.-]+)>\s*(.*?)\s*</parameter>"
            param_matches = re.findall(param_pattern, func_body, re.DOTALL)
            for param_name, param_value in param_matches:
                param_value = param_value.strip()
                if param_value:
                    params[param_name] = param_value

            tool_call = ToolUseBlock(
                id=f"call_{str(uuid.uuid4())[:24]}",
                input=params,
                name=func_name,
                type="tool_use",
            )
            tool_calls.append(tool_call)
        return tool_calls

    def _print_syntax(self, code: str, lexer: str, start_line: int = 1):
        if len(code) <= 1000:
            console.print(Syntax(code, lexer, line_numbers=True, start_line=start_line))
            return

        lines = code.splitlines(keepends=True)
        head_count = 0
        head_length = 0
        for line in lines:
            if head_count and head_length + len(line) > 400:
                break
            head_count += 1
            head_length += len(line)

        tail_start = len(lines)
        tail_length = 0
        while tail_start > head_count:
            line = lines[tail_start - 1]
            if tail_length and tail_length + len(line) > 400:
                break
            tail_start -= 1
            tail_length += len(line)

        if tail_start == head_count:
            console.print(Syntax(code, lexer, line_numbers=True, start_line=start_line))
            return

        head = "".join(lines[:head_count]).removesuffix("\n").removesuffix("\r")
        tail = "".join(lines[tail_start:]).removesuffix("\n").removesuffix("\r")
        console.print(Syntax(head, lexer, line_numbers=True, start_line=start_line))
        console.print(
            Syntax("\n     ... content omitted ...\n", lexer, line_numbers=False)
        )
        console.print(
            Syntax(tail, lexer, line_numbers=True, start_line=start_line + tail_start)
        )

    def llm(self, query: str) -> str:
        msg = [{"role": "user", "content": self._process_query(query)}]
        out = None
        match self.method:
            case "anthropic":
                response = self.client.messages.create(
                    model=self.model,
                    messages=msg,
                    max_tokens=MAX_TOKENS,
                )
                out = response.content[0].text
            case "openai":
                response = self.client.chat.completions.create(
                    model=self.model,
                    messages=msg,
                )
                out = response.choices[0].message.content
            case _:
                raise ValueError(f"Unsupported method: {self.method}")
        return out
