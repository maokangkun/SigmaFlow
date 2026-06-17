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
from anthropic import Anthropic
from pathlib import Path
from functools import singledispatchmethod
from .tools import TOOL_HANDLERS, skill_loader, Compactor, BG, MCP
from .utils import KnightRiderStatus, extract_json
from .conf import *

SYSTEM += skill_loader.get_descriptions()
SUBAGENT_SYSTEM += skill_loader.get_descriptions()
# compactor = Compactor(TRANSCRIPT_DIR, client)
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
        ):
        self.method = method
        self.model = model
        self.system = system
        self.sub_system = sub_system
        self.tools = tools
        self.sub_tools = sub_tools
        self.retry = retry
        self.max_turn = max_turn
        self.debug = debug

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

    def print_info(self, subagent=False):
        print(f"{Prompt.Baseurl}{self.client.base_url}")
        k = self.client.api_key or '*****'
        print(f"{Prompt.APIkey}{k[:5]}{'*' *(len(k)-10)}{k[-5:]}")
        print(f"{Prompt.Model}[green]{self.model}[/]")
        print(f"{Prompt.System}{self.system if not subagent else SUBAGENT_SYSTEM}")
        tools = CHILD_TOOLS if subagent else self.tools
        print(f"{Prompt.MCP}{','.join(f'{k}: {v}' for k,v in MCP.meta.items()) if MCP.meta else None}")
        print(f"{Prompt.ToolList}{' | '.join(t['name'] if 'name' in t else t['function']['name'] for t in tools)} [{len(tools)}]")
        print(f"{Prompt.Config}API Method: {self.client.__class__.__name__}, Max Tokens: {MAX_TOKENS}, Compact {{threshhold: {THRESHOLD}, summary token: {COMPACT_TOKENS}, tool keep: {KEEP_RECENT}}}")
        if not subagent: print(Prompt.Tips)

    @singledispatchmethod
    def __call__(self,
        messages: list,
        tools=None, 
        subagent=False, 
        print_inp=False, 
        is_print=True, 
        show_processing=True, 
        max_turn=None,
    ):
        if self.method == "openai" and messages[0]["role"] != "system":
            messages.insert(0, {"role": "system", "content": self.system if not subagent else self.sub_system})
        elif self.method == "anthropic" and messages[0]["role"] == "system":
            messages.pop(0)

        info = {
            "messages": [{"role": "system", "content": self.system if not subagent else self.sub_system}]+copy.deepcopy(messages[1:]),
            "last_response": None,
            "cost_tokens": 0,
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
        usable_tools = T if tools is None else [t for t in T if t.get('name', t.get('function', {}).get('name')) in tools]

        cur_turn = len([m for m in messages if m['role'] == 'assistant'])
        max_turn = max_turn or self.max_turn
        begin_time = time.time()
        manual_compact = False
        while cur_turn < max_turn:
            # messages[:] = compactor.auto_compact(messages, force=manual_compact)
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
                            messages.append({"role": "assistant", "content": response.content})
                            info["messages"].append({"role": "assistant", "content": [i.dict() for i in response.content]})
                        case "openai":
                            tool_param = {"tools": usable_tools, "tool_choice": "auto"} if usable_tools else {}
                            response = self.client.chat.completions.create(
                                model=self.model,
                                messages=messages,
                                max_tokens=MAX_TOKENS,
                                **tool_param
                            )
                            info["cost_tokens"] += response.usage.total_tokens
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
                            if (r:= msg.reasoning if hasattr(msg, 'reasoning') else None):
                                if msg.tool_calls:
                                    m['reasoning'] = r
                                    info["messages"].append(m)
                                else:
                                    info["messages"].append(m | {'reasoning': r})

                    cost_time = time.time() - start_time
                    if knight_rider: knight_rider.stop()
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

                            print(f"{Prompt.Tokens}inp: {response.usage.input_tokens}, out: {response.usage.output_tokens}, time: {cost_time:.2f}s, {response.usage.output_tokens / cost_time:.2f} tokens/s, tools: {sum(not i[-1].startswith('Error:') for i in info['used_tools'])}/{len(info['used_tools'])}, skills: {sum(not i[-1].startswith('Error:') for i in info['used_skills'])}/{len(info['used_skills'])}")

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
                        else:
                            print(f"{Prompt.Assistant}{msg.content}")
                            info["last_response"] = msg.content
                            print(f"{Prompt.Tokens}inp: {response.usage.prompt_tokens}, out: {response.usage.completion_tokens}, time: {cost_time:.2f}s, {(response.usage.completion_tokens or 0) / cost_time:.2f} tokens/s, tools: {sum(not i[-1].startswith('Error:') for i in info['used_tools'])}/{len(info['used_tools'])}, skills: {sum(not i[-1].startswith('Error:') for i in info['used_skills'])}/{len(info['used_skills'])}")

                            if info["last_response"] is None and response.usage.completion_tokens == MAX_TOKENS:
                                console.print(f"{Prompt.Error}[red]Max tokens reached[/]")
                                info['error'] = 'Max tokens reached, output may be incomplete'

                            break
                    else:
                        if msg.content and msg.content.strip(): print(f"{Prompt.Assistant}{msg.content}")

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
                        print(f"{Prompt.Assistant}[orange3][italic]tool_use[/]\nname: {func}\ninput: [/]{inp}")
                    case _:
                        print(f"{Prompt.Assistant}{block}")

                if block.type in ["tool_use", "function"] and func:
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
                    else:
                        print(f"{Prompt.Tool}[magenta]{func.upper()}[/]\n{out_prt}")

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
        print(f"{Prompt.Ended}total tokens: {info['cost_tokens']}, time: {info['cost_time']:.2f}s, tools: {len(info['used_tools'])}, skills: {len(info['used_skills'])}")
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

