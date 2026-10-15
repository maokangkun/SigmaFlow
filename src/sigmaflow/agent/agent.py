import re
import json
import time
import uuid
import copy
import base64
import random
import traceback
from rich import print
from openai import OpenAI
from rich.console import Console
from rich.markdown import Markdown
from rich.syntax import Syntax
from anthropic import Anthropic
from pathlib import Path
from functools import singledispatchmethod
from .tools import TOOL_HANDLERS, skill_loader, Compactor, BG, MCP
from .utils import KnightRiderStatus, extract_json
from .conf import *

SYSTEM += skill_loader.get_descriptions()
SUBAGENT_SYSTEM += skill_loader.get_descriptions()
console = Console()

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
        ):
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
            self.system += '\n\nNote: The agent is allowed to use tools. If the agent needs to use a tool, it should respond with a tool call in the format of <tool_call><function=tool_name><parameter=param_name>param_value</parameter></function></tool_call>. The agent should not provide any other text in its response when using a tool.'

        match method:
            case "anthropic":
                self.client = Anthropic(base_url=base_url or ANTHROPIC_BASE_URL, api_key=api_key or API_KEY)
                self.tools = [t for t in tools if not available_tools or t['name'] in available_tools]
            case "openai":
                self.client = OpenAI(base_url=base_url or OPENAI_BASE_URL, api_key=api_key or API_KEY)
                tools = self._trans_anthropic_tools_to_openai(self.tools)
                self.tools = [i for i in tools if not available_tools or i['function']['name'] in available_tools]
                self.sub_tools = self._trans_anthropic_tools_to_openai(sub_tools)
            case _:
                raise ValueError(f"Unsupported method: {method}")

        max_model_len = MAX_MODEL_LEN.get(self.model.lower(), MAX_MODEL_LEN['default'])
        self.compactor = Compactor(TRANSCRIPT_DIR, self.client, max_model_len)

        self.config = {
            "api_method": self.client.__class__.__name__,
            "base_url": self.client.base_url,
            "api_key": self.client.api_key,
            "max_model_len": max_model_len,
            "tools": self.tools,
        }

    def print_info(self, subagent=False):
        k = self.client.api_key or '*****'
        tools = CHILD_TOOLS if subagent else self.tools
        lines = [
            f"{Prompt.Baseurl}{self.client.base_url}",
            f"{Prompt.APIkey}{k[:5]}{'*' *(len(k)-10)}{k[-5:]}",
            f"{Prompt.Model}[green]{self.model}[/]",
            f"{Prompt.System}{self.system if not subagent else SUBAGENT_SYSTEM}",
            f"{Prompt.MCP}{','.join(f'{k}: {v}' for k,v in MCP.meta.items()) if MCP.meta else None}",
            f"{Prompt.ToolList}{' | '.join(t['name'] if 'name' in t else t['function']['name'] for t in tools)} [{len(tools)}]",
            f"{Prompt.Config}API Method: {self.client.__class__.__name__}, Max Tokens: {MAX_TOKENS}, Compact {{threshhold: {COMPACT_THRESHOLD}, summary token: {COMPACT_TOKENS}, tool keep: {KEEP_RECENT_TOOL}}}",
        ]
        if not subagent:
            lines.append(Prompt.Tips)

        for line in lines:
            print(line)

        return lines

    @singledispatchmethod
    def __call__(self,
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
        if self.method == "openai" and messages[0]["role"] != "system":
            messages.insert(0, {"role": "system", "content": self.system if not subagent else self.sub_system})
        elif self.method == "anthropic" and messages[0]["role"] == "system":
            messages.pop(0)

        info = {
            "config": self.config,
            "messages": [{"role": "system", "content": self.system if not subagent else self.sub_system}]+copy.deepcopy(messages[1:]),
            "last_response": None,
            "cost_tokens": 0,
            "completion_tokens": 0,  # 辅助上屏 tok/s 统计: 与 cost_tokens 分开, 只计补全侧
            "prompt_tokens": 0,  # 输入侧 token, 多轮工具循环时逐轮累加
            "cost_time": 0,
            "used_tools": [],
            "used_skills": [],
            "error": None,
        }

        print = console.print if is_print else lambda *_a, **_k: None

        if print_inp:
            for msg in info["messages"]:
                match msg.get('role'):
                    case 'user':
                        print(f"{Prompt.User}{msg['content']}")
                    case 'assistant':
                        print(f"{Prompt.Assistant}{msg['content']}")
                    case 'system':
                        print(f"{Prompt.System}{msg['content']}")
                    case 'tool':
                        print(f"{Prompt.Tool}{msg['content']}")
                    case _:
                        print(f"{Prompt.Unknown}{msg}")

        for m in messages:
            if m['role'] == 'user':
                m['content'] = self._process_query(m['content'])

        T = self.sub_tools if subagent else self.tools
        usable_tools = [] if not self.support_tool else (T if tools is None else [t for t in T if t.get('name', t.get('function', {}).get('name')) in tools])

        cur_turn = len([m for m in messages if m['role'] == 'assistant'])
        max_turn = max_turn or self.max_turn
        begin_time = time.time()
        manual_compact = False
        ratio = 0
        max_model_len = MAX_MODEL_LEN.get(self.model.lower(), MAX_MODEL_LEN['default'])
        while cur_turn < max_turn:
            messages[:] = self.compactor.auto_compact(messages, force=manual_compact, context_ratio=ratio)
            if messages[0]["role"] == "user" and messages[0]["content"].startswith("[Conversation compressed"):
                info["messages"].extend(messages)
                if self.method == "openai":
                    messages.insert(0, {"role": "system", "content": self.system if not subagent else self.sub_system})
            manual_compact = False

            notifs = BG.drain_notifications()
            if notifs and messages:
                for n in notifs:
                    print(f"{Prompt.Bgtask}Task ID: {n['task_id']}, Status: {n['status']}, Result: {n['result']}")
                notif_text = "\n".join(
                    f"[bg:{n['task_id']}] {n['status']}: {n['result']}" for n in notifs
                )
                messages.append({"role": "user", "content": f"<background-results>\n{notif_text}\n</background-results>"})
                messages.append({"role": "assistant", "content": "Noted background results."})

            knight_rider = KnightRiderStatus("", width=11, color="#5c9cf5", fps=30) if is_print and show_processing and not self.debug else None
            tried = 0
            while tried < self.retry:
                try:
                    if knight_rider: knight_rider.start()
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
                            response.content = sorted(response.content, key=lambda x: 0 if x.type == "thinking" else 1)
                            info["cost_tokens"] += response.usage.input_tokens + response.usage.output_tokens
                            info["prompt_tokens"] += getattr(response.usage, "input_tokens", 0) or 0
                            info["completion_tokens"] += getattr(response.usage, "output_tokens", 0) or 0
                            messages.append({"role": "assistant", "content": response.content})
                            info["messages"].append({"role": "assistant", "content": [i.dict() for i in response.content]})
                        case "openai" if self.on_delta is not None:
                            import sys as _sys; print("DBG: STREAMING CASE", file=_sys.stderr)
                            # 流式路径: 逐块推送增量文本/思考, 同时累积完整响应供后续逻辑使用。
                            # 支持工具调用: 增量聚合 tool_calls 分片, 聚合结果走与非流式
                            # 分支相同的工具执行路径。
                            class _DeltaMsg:
                                pass

                            class _DeltaUsage:
                                def __init__(self):
                                    self.total_tokens = 0
                                    self.prompt_tokens = 0
                                    self.completion_tokens = 0

                            class _ToolCall:
                                def __init__(self, id, name, arguments):
                                    self.id, self.type = id, "function"
                                    self.function = type("F", (), {"name": name, "arguments": arguments})()

                            response_text_parts, reasoning_parts = [], []
                            tool_calls_acc: list = []
                            usage = _DeltaUsage()
                            stream_kwargs = {"stream": True, "stream_options": {"include_usage": True}}
                            if usable_tools:
                                stream_kwargs |= {"tools": usable_tools, "tool_choice": "auto"}
                            try:
                                _stream = self.client.chat.completions.create(
                                    model=self.model,
                                    messages=messages,
                                    max_tokens=MAX_TOKENS,
                                    **stream_kwargs
                                )
                            except Exception:
                                # 部分兼容网关不支持 stream_options, 去掉后重试
                                _fallback = dict(stream_kwargs)
                                _fallback.pop("stream_options", None)
                                _stream = self.client.chat.completions.create(
                                    model=self.model,
                                    messages=messages,
                                    max_tokens=MAX_TOKENS,
                                    **_fallback
                                )
                            for chunk in _stream:
                                if getattr(chunk, "usage", None):
                                    usage.total_tokens = getattr(chunk.usage, "total_tokens", 0) or 0
                                    usage.prompt_tokens = getattr(chunk.usage, "prompt_tokens", 0) or 0
                                    usage.completion_tokens = getattr(chunk.usage, "completion_tokens", 0) or 0
                                choices = getattr(chunk, "choices", None)
                                if not choices:
                                    continue
                                delta = choices[0].delta
                                think = getattr(delta, "reasoning_content", None) or getattr(delta, "reasoning", None)
                                if think:
                                    info.setdefault("reasoning_parts", []).append(think)
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
                                for tc in (getattr(delta, "tool_calls", None) or []):
                                    if tc.index is None:
                                        tc.index = len(tool_calls_acc)
                                    while len(tool_calls_acc) <= tc.index:
                                        tool_calls_acc.append({"id": None, "type": "function", "function": {"name": "", "arguments": ""}})
                                    if tc.id:
                                        tool_calls_acc[tc.index]["id"] = tc.id
                                    if getattr(tc.function, "name", None):
                                        tool_calls_acc[tc.index]["function"]["name"] += tc.function.name
                                    if getattr(tc.function, "arguments", None):
                                        tool_calls_acc[tc.index]["function"]["arguments"] += tc.function.arguments
                            info["cost_tokens"] += usage.total_tokens
                            info["prompt_tokens"] += usage.prompt_tokens or 0
                            info["completion_tokens"] += usage.completion_tokens or 0
                            msg = _DeltaMsg()
                            msg.content = "".join(response_text_parts)
                            msg.tool_calls = [_ToolCall(t["id"], t["function"]["name"], t["function"]["arguments"]) for t in tool_calls_acc] or None
                            if msg.tool_calls:
                                # 与非流式分支一致: 工具调用轮的 assistant 消息要写回 messages,
                                # 供下一轮连同 tool 结果一起发送
                                m = {"role": "assistant"}
                                if msg.content: m["content"] = msg.content
                                m["tool_calls"] = tool_calls_acc
                                messages.append(m)
                                info["messages"].append(m)
                            response = _DeltaMsg()
                            response.usage = usage
                            response.choices = [_DeltaMsg()]
                            response.choices[0].message = msg
                        case "openai":
                            tool_param = {"tools": usable_tools, "tool_choice": "auto"} if usable_tools else {}
                            response = self.client.chat.completions.create(
                                model=self.model,
                                messages=messages,
                                max_tokens=MAX_TOKENS,
                                **tool_param
                            )
                            if isinstance(response, str) or not hasattr(response, "usage"):
                                raise ValueError(f"Unexpected response from provider: {str(response)[:200]}")
                            info["cost_tokens"] += getattr(response.usage, "total_tokens", 0) if response.usage else 0
                            info["prompt_tokens"] += getattr(response.usage, "prompt_tokens", 0) if response.usage else 0
                            info["completion_tokens"] += getattr(response.usage, "completion_tokens", 0) if response.usage else 0
                            assert response.choices is not None, f"Response is None: {response}"
                            msg = response.choices[0].message
                            m = {"role": "assistant"}
                            if msg.content: m["content"] = msg.content
                            if msg.tool_calls: m["tool_calls"] = [t.dict() for t in msg.tool_calls]
                            messages.append(m)
                            if (r:= msg.reasoning_content if hasattr(msg, 'reasoning_content') else None):
                                if msg.tool_calls:
                                    m['reasoning_content'] = r
                                    info["messages"].append(m)
                                else:
                                    info["messages"].append(m | {'reasoning_content': r})
                            elif (r:= msg.reasoning if hasattr(msg, 'reasoning') else None):
                                if msg.tool_calls:
                                    m['reasoning'] = r
                                    info["messages"].append(m)
                                else:
                                    info["messages"].append(m | {'reasoning': r})
                            else:
                                info["messages"].append(m)

                    cost_time = time.time() - start_time
                    if knight_rider: knight_rider.stop()
                    info['error'] = None
                    break
                except Exception as e:
                    if knight_rider: knight_rider.stop()
                    console.print(f"{Prompt.Error}[red]{e}[/]")
                    info['error'] = str(e)
                    if any([e in info['error'] for e in API_ERRORS]):
                        tried = self.retry
                    else:
                        tried += 1
                        time.sleep(random.randint(2, 5))
                        if tried == self.retry:
                            console.print(f"{Prompt.Error}{traceback.format_exc()}")
            else:
                break

            match self.method:
                case "anthropic":
                    if response.stop_reason != "tool_use":
                        if 'qwen' in self.model.lower() and (t := response.content[-1].text.strip()) and '<tool_call>' in t and '</tool_call>' in t:
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
                                    print(f"{Prompt.Assistant}[dim][italic]thinking[/]\n{block.thinking}[/]")
                                else:
                                    print(f"{Prompt.Assistant}{block}")

                            ratio = (response.usage.input_tokens + response.usage.output_tokens) / max_model_len
                            print(f"{Prompt.Tokens}inp: {response.usage.input_tokens}, out: {response.usage.output_tokens}, time: {cost_time:.2f}s, {response.usage.output_tokens / cost_time:.2f} tokens/s, tools: {sum(not i[-1].startswith('Error:') for i in info['used_tools'])}/{len(info['used_tools'])}, skills: {sum(not i[-1].startswith('Error:') for i in info['used_skills'])}/{len(info['used_skills'])}, context: {Prompt.RedLine*round(ratio*10)}{Prompt.BlueLine*(10 - round(ratio*10))} {ratio:.1%}")

                            if not BG.is_finished or BG._notification_queue:
                                with KnightRiderStatus("run background tasks", width=11, color="#fbd367", fps=30):
                                    while not BG.is_finished:
                                        time.sleep(0.1)
                                continue

                            if response.stop_reason == 'max_tokens' or (info["last_response"] is None and response.usage.output_tokens == MAX_TOKENS):
                                console.print(f"{Prompt.Error}[red]Max tokens reached[/]")
                                info['error'] = 'Max tokens reached, output may be incomplete'

                            break
                case "openai":
                    if (r:= msg.reasoning_content if hasattr(msg, 'reasoning_content') else (msg.reasoning if hasattr(msg, 'reasoning') else None)):
                        print(f"{Prompt.Assistant}[dim][italic]thinking[/]\n{r}[/]")

                    if not msg.tool_calls:
                        if 'qwen' in self.model.lower() and msg.content and '<tool_call>' in msg.content and msg.content.endswith('</tool_call>'):
                            msg.tool_calls = self._parse_to_openai_toolcall(msg.content)
                        elif 'intern' in self.model.lower() and msg.content and ('```tool' in msg.content or '"tool_calls": [' in msg.content):
                            msg.tool_calls = self._parse_intern_to_openai_toolcall(msg.content)
                        elif self.support_tool and '<tool_call>' in msg.content and msg.content.endswith('</tool_call>'):
                            msg.tool_calls = self._parse_to_openai_toolcall(msg.content)
                        else:
                            print(f"{Prompt.Assistant}{msg.content}")
                            info["last_response"] = msg.content

                            _usage = response.usage if hasattr(response.usage, 'total_tokens') else None
                            ratio = _usage.total_tokens / max_model_len if _usage else 0
                            print(f"{Prompt.Tokens}inp: {_usage.prompt_tokens if _usage else '?'}, out: {_usage.completion_tokens if _usage else '?'}, time: {cost_time:.2f}s, {(_usage.completion_tokens or 0) / cost_time if _usage else 0:.2f} tokens/s, tools: {sum(not i[-1].startswith('Error:') for i in info['used_tools'])}/{len(info['used_tools'])}, skills: {sum(not i[-1].startswith('Error:') for i in info['used_skills'])}/{len(info['used_skills'])}, context: {Prompt.RedLine*round(ratio*10)}{Prompt.BlueLine*(10 - round(ratio*10))} {ratio:.1%}")

                            if info["last_response"] is None and _usage and _usage.completion_tokens == MAX_TOKENS:
                                console.print(f"{Prompt.Error}[red]Max tokens reached[/]")
                                info['error'] = 'Max tokens reached, output may be incomplete'

                            break
                    else:
                        if msg.content and msg.content.strip(): print(f"{Prompt.Assistant}{msg.content}")

            match self.method:
                case "anthropic":
                    ratio = (response.usage.input_tokens + response.usage.output_tokens) / max_model_len
                    tool_count = len([b for b in response.content if b.type == "tool_use"])
                    print(f"{Prompt.Tokens}inp: {response.usage.input_tokens}, out: {response.usage.output_tokens}, time: {cost_time:.2f}s, {response.usage.output_tokens / cost_time:.2f} tokens/s, tools: {tool_count}, context: {Prompt.RedLine*round(ratio*10)}{Prompt.BlueLine*(10 - round(ratio*10))} {ratio:.1%}")
                case "openai":
                    ratio = response.usage.total_tokens / max_model_len if response.usage else 0
                    print(f"{Prompt.Tokens}inp: {response.usage.prompt_tokens}, out: {response.usage.completion_tokens}, time: {cost_time:.2f}s, {(response.usage.completion_tokens or 0) / cost_time:.2f} tokens/s, tool calls: {len(msg.tool_calls)}, context: {Prompt.RedLine*round(ratio*10)}{Prompt.BlueLine*(10 - round(ratio*10))} {ratio:.1%}")

            # Tools calling
            results = []
            for block in response.content if self.method == 'anthropic' else msg.tool_calls:
                match block.type:
                    case "text":
                        print(f"{Prompt.Assistant}{block.text}")
                    case "thinking":
                        print(f"{Prompt.Assistant}[dim][italic]thinking[/]\n{block.thinking}[/]")
                    case "tool_use" | "function":
                        if block.type == 'tool_use':
                            func = block.name
                            inp = block.input
                        else:
                            func = block.function.name
                            try:
                                inp = json.loads(block.function.arguments or "{}")
                            except json.JSONDecodeError:
                                inp = block.function.arguments
                                print(f"{Prompt.Error}Failed to parse function arguments as JSON, using raw string. Function: {func}, Arguments: {inp}")
                                results.append({"role": "tool", "tool_call_id": block.id, "content": "Error: Failed to parse function arguments as JSON."})
                                continue
                        if func == 'write_file' and (t := inp.get('content', '')) and len(t) > 1000:
                            inp_prt = inp.copy()
                            inp_prt['content'] = t[:400] + '...' + t[-400:]
                        elif func == 'edit_file':
                            inp_prt = inp.copy()
                            if (t := inp.get('old_text', '')) and len(t) > 1000:
                                inp_prt['old_text'] = t[:400] + '...' + t[-400:]
                            if (t := inp.get('new_text', '')) and len(t) > 1000:
                                inp_prt['new_text'] = t[:400] + '...' + t[-400:]
                        else:
                            inp_prt = inp
                        print(f"{Prompt.Assistant}[orange3][italic]tool_use[/]\nname: {func}\ninput: [/]{inp_prt}")
                    case _:
                        print(f"{Prompt.Assistant}{block}")

                if block.type in ["tool_use", "function"] and func:
                    if self.on_tool is not None:
                        try:
                            self.on_tool({"kind": "call", "name": func, "args": inp if isinstance(inp, dict) else str(inp)})
                        except Exception:
                            pass
                    manual_compact = func == "compact"
                    if func == "task":
                        console.rule("Subagent Started", style="bold red")
                        self.print_info(subagent=True)
                        sub_messages = [{"role": "user", "content": inp['prompt']}]
                        agent(sub_messages, subagent=True)
                        output = sub_messages[-1]['content'][0].text if sub_messages else "(no summary)"
                        console.rule("Subagent End", style="bold red")
                    else:
                        handler = TOOL_HANDLERS.get(func)
                        output = out_prt = str(handler(**inp)) if handler else f"Error: unknown tool {func}"
                        if len(output) > 1000: out_prt = output[:400]+'\n......\n'+output[-400:]
                    if func in MCP.tools:
                        print(f"{Prompt.MCP}[magenta]{func.upper()}[/]\n{out_prt}")
                    elif func == "edit_file" and not output.startswith("Error:"):
                        print(f"{Prompt.Tool}[magenta]{func.upper()}[/]")
                        self._print_syntax(output, "diff")
                    elif func in {"read_file", "write_file"} and not output.startswith("Error:"):
                        code = output if func == "read_file" else inp.get("content", "")
                        print(f"{Prompt.Tool}[magenta]{func.upper()}[/]")
                        offset = inp.get("offset")
                        start_line = offset if offset and code.startswith(f"[{offset} lines skipped]") else 1
                        self._print_syntax(
                            code,
                            Syntax.guess_lexer(inp.get("path", ""), code=code),
                            start_line=start_line,
                        )
                        if func == "write_file": print(out_prt)
                    else:
                        print(f"{Prompt.Tool}[magenta]{func.upper()}[/]\n{out_prt}")

                    if self.on_tool is not None:
                        try:
                            self.on_tool({"kind": "result", "name": func, "result": str(output)[:2000]})
                        except Exception:
                            pass
                    match self.method:
                        case "anthropic":
                            results.append({"type": "tool_result", "tool_use_id": block.id, "content": output})
                        case "openai":
                            results.append({"role": "tool", "tool_call_id": block.id, "content": str(output)})

                    if func == 'load_skill':
                        info['used_skills'].append((inp.get('name'), output))
                    else:
                        info['used_tools'].append((func, inp, output))

            match self.method:
                case "anthropic":
                    messages.append((m := {"role": "user", "content": results}))
                    info["messages"].append(m)
                case "openai":
                    messages.extend(results)
                    info["messages"].extend(results)

            cur_turn += 1
            if cur_turn == max_turn -1:
                console.print(f"{Prompt.Warning}Max turn {max_turn} will be reached in the next turn, stopping to avoid infinite loop.")
                m = [
                    {
                        "role": "user", 
                        "content": "[System] Max turn will be reached in the next turn, just finalize the response without calling tools. Stopping to avoid infinite loop."
                    }
                ]
                print(f"{Prompt.User}{m[0]['content']}")
                messages.extend(m)
                info["messages"].extend(m)

        info["cost_time"] = time.time() - begin_time
        print(f"{Prompt.Ended}total tokens: {info['cost_tokens']}, time: {info['cost_time']:.2f}s, tools: {len(info['used_tools'])}, skills: {len(info['used_skills'])}, rounds: {cur_turn}")
        return info

    @__call__.register(str)
    def _(self, query: str, **kw):
        m = [{"role": "user", "content": query}]
        return self(m, **kw)

    def _process_query(self, query: str):
        if type(query) is str:
            pattern = r'@\S+.[png|jpg|jpeg|txt|pdf|docx|xlsx]\s'
            last_end = 0
            result = []
            for match in re.finditer(pattern, query):
                start, end = match.span()
                if t := query[last_end:start].strip():
                    result.append({"type": "text", "text": t})
                img = Path(query[start+1:end].strip())
                if img.exists():
                    match self.method:
                        case "anthropic":
                            result.append({
                                "type": "image",
                                "source": {
                                    "type": "base64",
                                    "media_type": "image/jpeg" if img.suffix in ['.jpg', '.jpeg'] else "image/png",
                                    "data": base64.standard_b64encode(img.open("rb").read()).decode("utf-8"),
                                }
                            })
                        case "openai":
                            result.append({
                                "type": "image_url", 
                                "image_url": {
                                    "url": "data:image/png;base64,"+base64.b64encode(img.open("rb").read()).decode("utf-8")
                                }
                            })
                last_end = end
            if t := query[last_end:].strip():
                result.append({"type": "text", "text": t})

            if [r for r in result if r['type'].startswith('image')]:
                return result

        return query

    def _trans_anthropic_tools_to_openai(self, tools):
        return [
                    {
                        "type": "function",
                        "function": {
                            "name": t["name"],
                            "description": t.get("description", ""),
                            "parameters": t.get("input_schema", {})
                        }
                    }
                    for t in tools
                ]

    def _parse_to_openai_toolcall(self, xml_string):
        from openai.types.chat import ChatCompletionMessageToolCall
        from openai.types.chat.chat_completion_message_tool_call import Function

        pattern = r'<tool_call>\s*<function=([\w\d_.-]+)>\s*(.*?)\s*</function>\s*</tool_call>'
        matches = re.findall(pattern, xml_string, re.DOTALL)

        tool_calls = []
        for func_name, func_body in matches:
            params = {}
            param_pattern = r'<parameter=([\w_.-]+)>\s*(.*?)\s*</parameter>'
            param_matches = re.findall(param_pattern, func_body, re.DOTALL)
            for param_name, param_value in param_matches:
                param_value = param_value.strip()
                if param_value:
                    params[param_name] = param_value

            tool_call = ChatCompletionMessageToolCall(
                id=f"call_{str(uuid.uuid4()).replace('-', '')[:8]}",
                type="function",
                function=Function(
                    name=func_name,
                    arguments=json.dumps(params)
                )
            )

            tool_calls.append(tool_call)
        return tool_calls

    def _parse_intern_to_openai_toolcall(self, text):
        from openai.types.chat import ChatCompletionMessageToolCall
        from openai.types.chat.chat_completion_message_tool_call import Function

        if (data := extract_json(text)):
            tool_calls = []
            for item in data.get("tool_calls", []):
                tool_call = ChatCompletionMessageToolCall(
                    id=item.get("id", f"call_{str(uuid.uuid4()).replace('-', '')[:8]}"),
                    type="function",
                    function=Function(
                        name=item.get("function", {}).get("name", ""),
                        arguments=json.dumps(item.get("function", {}).get("arguments", {}))
                    )
                )
                tool_calls.append(tool_call)
            return tool_calls

        return self._parse_to_openai_toolcall(text)

    def _parse_to_anthropic_toolcall(self, xml_string):
        from anthropic.types.tool_use_block import ToolUseBlock

        pattern = r'<tool_call>\s*<function=([\w\d_.-]+)>\s*(.*?)\s*</function>\s*</tool_call>'
        matches = re.findall(pattern, xml_string, re.DOTALL)

        tool_calls = []
        for func_name, func_body in matches:
            params = {}
            param_pattern = r'<parameter=([\w_.-]+)>\s*(.*?)\s*</parameter>'
            param_matches = re.findall(param_pattern, func_body, re.DOTALL)
            for param_name, param_value in param_matches:
                param_value = param_value.strip()
                if param_value:
                    params[param_name] = param_value

            tool_call = ToolUseBlock(
                id=f"call_{str(uuid.uuid4())[:24]}",
                input=params,
                name=func_name,
                type="tool_use"
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
        console.print(Syntax("\n     ... content omitted ...\n", lexer, line_numbers=False))
        console.print(Syntax(tail, lexer, line_numbers=True, start_line=start_line + tail_start))

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
