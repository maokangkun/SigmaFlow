import os
import json
from pathlib import Path
from httpx import ConnectError
from sigmaflow.clients.rag_http import _req
from sigmaflow.utils import extract_json


async def rag(inp):
    input_data = {"query": inp, "structured": True}
    try:
        out = await _req(input_data, os.getenv("RAG_URL"))
        out = out["result"]
        if type(out) is str:
            out = extract_json(out)
        if type(out) is dict:
            out = [out]
    except ConnectError:
        with open(f"local_rag/{inp}.json", "r") as f:
            out = json.load(f)
    return out


def get_epidemics():
    return [f.stem for f in Path("local_rag").glob("*.json")]


pipeline = {
    "CONFIG": {
        "llm": "openai",
        "model": "DeepSeek-V3",
        "rag": rag,
    },
    # ==========================================================================
    "是否使用外置拆解预案": {
        "inp": ["dismantling_plan"],
        "code": "bool({dismantling_plan})",
        "next": {
            True: "使用外置拆解预案",
            False: "查询候选疫情类型",
        },
    },
    "使用外置拆解预案": {
        "item": "dismantling_plan",
        "out": "候选预案",
        "next": ["抽取候选预案中启动条件"],
    },
    "查询候选疫情类型": {
        "code": get_epidemics,
        "out": "候选疫情类型",
        "next": ["疫情类型抽取"],
    },
    "疫情类型抽取": {
        "prompt": "请你根据疫情接报信息，从候选疫情类型中选择并判断是什么疫情，以JSON格式返回，如{'疫情类型': 'xxx'}。\n候选疫情类型：{候选疫情类型}\n疫情接报信息：{epidemic_reporting_information}\n回答：",
        "format": {"疫情类型": str},
        "inp": ["候选疫情类型", "epidemic_reporting_information"],
        "out": {"疫情类型": "疫情类型"},
        "next": ["知识库检索候选预案"],
    },
    "知识库检索候选预案": {
        "rag_param": None,
        "inp": ["疫情类型"],
        "out": "候选预案",
        "next": ["抽取候选预案中启动条件"],
    },
    "抽取候选预案中启动条件": {
        "inp": ["候选预案"],
        "code": "def foo(data):\n    return [d['启动条件'] for d in data]",
        "out": "候选预案-启动条件",
        "next": ["启动条件点抽取"],
    },
    "启动条件点抽取": {
        "prompt": "请你根据候选预案，从里面的启动条件中抽取出每个独立的小条件点列出来，不要重复和分类，示例：\n1.确诊病例\n2.疑似病例\n3.临床诊断病例。\n\候选预案-启动条件：{候选预案-启动条件}\n回答：",
        "return_json": False,
        "remove_think": True,
        "inp": ["候选预案-启动条件"],
        "out": "启动条件点",
        "next": ["案例结构化"],
    },
    "案例结构化": {
        "prompt": "启动条件点：{启动条件点}\n\n疫情接报信息：{epidemic_reporting_information}\n\n请你根据疫情接报信息按照启动条件点结构化输出，示例：\n1.确诊病例：是\n2.疑似病例：否\n\n回答：",
        "return_json": False,
        "remove_think": True,
        "inp": ["启动条件点", "epidemic_reporting_information"],
        "out": "结构化案例",
        "next": ["是否存在上一轮清单及反馈"],
    },
    "是否存在上一轮清单及反馈": {
        "inp": ["previous_task_feedback"],
        "code": "bool({previous_task_feedback})",
        "next": {
            True: "基于上一轮结果给出任务清单",
            False: "给出任务清单",
        },
    },
    "给出任务清单": {
        "prompt": "风险个案：{risk_cases}\n\n个案基本情况：{basic_case_information}\n\n疫情接报结构化信息：{结构化案例}\n\n候选预案：{候选预案}\n\n请根据上面提供的全部信息，从候选预案中挑选出接下来的预案清单，严格按照JSON格式输出：[{'动作': 'xxx','工作要求': 'xxx','派单对象': 'xxx','时限要求': 'xxx'}, ...]\n\n回答：",
        "inp": ["risk_cases", "basic_case_information", "结构化案例", "候选预案"],
        "out": "任务清单",
        "next": ["exit"],
    },
    "基于上一轮结果给出任务清单": {
        "prompt": "风险个案：{risk_cases}\n\n个案基本情况：{basic_case_information}\n\n疫情接报结构化信息：{结构化案例}\n\n候选预案：{候选预案}\n\n上一轮执行的任务清单及其反馈：{previous_task_feedback}\n\n请根据上面提供的全部信息和上一轮执行的任务清单及其反馈结果，从候选预案中挑选出接下来下一轮的预案清单，严格按照JSON格式输出：[{'动作': 'xxx','工作要求': 'xxx','派单对象': 'xxx','时限要求': 'xxx'}, ...]\n\n回答：",
        "inp": [
            "risk_cases",
            "basic_case_information",
            "结构化案例",
            "候选预案",
            "previous_task_feedback",
        ],
        "out": "任务清单",
        "next": ["exit"],
    },
    "exit": {"task_list": "任务清单"},
}
