"""
Medical diagnosis example pipeline for SigmaFlow.
"""

import time
from sigmaflow.utils import async_compat, jload

T = 0.2


@async_compat
def offline_llm(inp):
    """A simple mocked LLM function that inspects the prompt and returns canned responses.
    用于示例的伪LLM，按输入关键字返回预设内容，便于示例不依赖真实服务。
    """
    time.sleep(T)

    task = inp.split("\n")[0][3:]
    match task:
        case "收集病史":
            assert jload("demo_input.json")[0]["患者信息"] in inp
            return "<think>...</think>突发胸痛2小时，伴气短、出汗。既往高血压10年。"
        case "提取症状":
            assert "<think>" not in inp
            assert "突发胸痛2小时，伴气短、出汗。既往高血压10年。" in inp
            return '{"symptoms": ["胸痛", "气短", "乏力"]}'
        case "获取出生日期":
            return "1980-03-04"
        case "获取身高体重":
            return '{"height": 1.76, "weight": 69}'
        case "聚合分析":
            assert (
                "心肌梗死" in inp and "肺栓塞" in inp and "甲状腺功能减退" in inp
            )  # check rag
            assert "45" in inp and "22.3" in inp  # check age & BMI
            return '[{"symptom": "胸痛", "candidates": ["心肌梗死", "胃食管反流", "胸膜炎"], "evidence": ["压迫性胸痛", "静止时加重"]}, {"symptom": "其他", "candidates": ["非特异性"], "evidence": ["无明显证据"]}]'
        case "k: Please select the closest item from the items based on the input content and only answer the item id in JSON format, e.g.":
            if "需要进一步检查" in inp:
                return "{'item_id': '#1'}"
        case "生成检查清单":
            assert '"心肌梗死", "胃食管反流", "胸膜炎"' in inp
            return '{"checks": ["心电图", "血肌钙蛋白", "胸部X光", "心脏超声"]}'
        case "进行诊断":
            assert "ST段抬高" in inp and "左室功能减低" in inp
            return "冠状动脉粥样硬化性心脏病"
        case _:
            print(task)

    return inp


@async_compat
def another_llm(inp):
    time.sleep(T)
    assert "冠状动脉粥样硬化性心脏病" in inp
    return "建议：尽快就诊心内科，尽快行血管造影评估并依据结果决定再通策略。"


@async_compat
def offline_rag(inp):
    """Mocked RAG index lookup for symptoms — returns potential diseases/evidence.
    这里返回与症状对应的证据片段，用于示例的检索增强生成（RAG）。
    """
    time.sleep(T)
    index = {
        "胸痛": {
            "diseases": ["心肌梗死", "不稳定性心绞痛"],
            "snippets": ["心前区压榨性疼痛", "放射至左上肢"],
        },
        "气短": {
            "diseases": ["心力衰竭", "肺栓塞"],
            "snippets": ["运动时气短", "夜间阵发性呼吸困难"],
        },
        "乏力": {
            "diseases": ["贫血", "甲状腺功能减退"],
            "snippets": ["进行性乏力", "伴有心悸"],
        },
    }
    return index.get(inp, None)


@async_compat
def offline_api(data):
    time.sleep(T)
    c = data.get("check_item")
    assert (
        c in ["心电图", "血肌钙蛋白", "胸部X光", "心脏超声"]
        and data.get("pid") == "P123456"
    )
    results = {
        "心电图": "ST段抬高",
        "血肌钙蛋白": "升高",
        "胸部X光": "无明显异常",
        "心脏超声": "左室功能减低",
    }
    return {c: results.get(c, "未见明显异样")}


pipeline = {
    # Config node: for global settings
    "CONFIG": {
        "llm": offline_llm,  # ["lmdeploy", "vllm", "mlx", "ollama", "openai", "torch"] for global LLM nodes
        "model": "Qwen3-8B",  # MODEL in .env has higher priority
        "rag": offline_rag,
        "mermaid": {
            "layout": "elk",  # dagre, elk
            "look": "classic",  # classic, handDrawn
            "elk": {
                "mergeEdges": False,
                "nodePlacementStrategy": "BRANDES_KOEPF",  # SIMPLE, NETWORK_SIMPLEX, LINEAR_SEGMENTS, BRANDES_KOEPF
            },
        },
    },
    # LLM node
    "收集病史": {
        "prompt": "任务：收集病史\n要求：请简要收集患者主诉、既往史、现病史和重要体征。\n患者信息：{患者信息}\n回答：",
        "return_json": False,
        "remove_think": True,
        "inp": ["患者信息"],
        "out": "病史",
        "next": ["提取症状"],
    },
    # LLM node
    "提取症状": {
        "prompt": "任务：提取症状\n要求：提取出所有症状并以JSON返回，例如{'symptoms': ['胸痛', '气短']}。\n病史：{病史}\n回答：",
        "format": {"symptoms": list},
        "inp": ["病史"],
        "out": {"symptoms": "症状"},
        "next": ["检索每个症状"],
    },
    # Loop node
    "检索每个症状": {
        "inp": ["症状"],
        "pipe_in_loop": ["检索证据", "处理证据"],
        "next": ["聚合分析"],
    },
    # RAG node
    "检索证据": {
        "rag_param": None,
        "inp": ["症状"],
        "out": "证据片段",
        "next": ["处理证据"],
    },
    # Code node
    "处理证据": {
        "inp": ["症状", "证据片段"],
        "code": lambda symptom, evidence: {"symptom": symptom} | evidence,
        "out": "处理后证据",
    },
    # LLM node
    "获取出生日期": {
        "prompt": "任务：获取出生日期\n请根据患者信息提取出患者的出生日期，返回格式yyyy-mm-dd。\n患者信息：{患者信息}\n回答：",
        "return_json": False,
        "inp": ["患者信息"],
        "out": "出生日期",
        "next": ["计算年龄"],
    },
    # Code node
    "计算年龄": {
        "inp": ["出生日期"],
        "code": (
            "def calc_age(birth_str):\n"
            "    from datetime import datetime\n"
            "    birth = datetime.strptime(birth_str, '%Y-%m-%d')\n"
            "    today = datetime.now()\n"
            "    age = today.year - birth.year - ((today.month, today.day) < (birth.month, birth.day))\n"
            "    return age"
        ),
        "out": "年龄",
    },
    # LLM node
    "获取身高体重": {
        "prompt": '任务：获取身高体重\n请你根据患者信息提取出患者的身高体重，身高单位是m，体重单位是kg，返回json格式{"height": xx, "weight": xx}。\n患者信息：{患者信息}\n回答：',
        "format": {"height": float, "weight": int},
        "inp": ["患者信息"],
        "out": {"height": "身高", "weight": "体重"},
        "next": ["计算BMI"],
    },
    # Code node
    "计算BMI": {
        "inp": ["身高", "体重"],
        "code": "round({体重}/{身高}**2, 1)",
        "out": "BMI",
    },
    # 聚合所有信息并根据证据做初步判断
    # LLM node
    "聚合分析": {
        "prompt": "任务：聚合分析\n对以下信息及其检索到的证据片段进行聚合，并给出每个症状可能的疾病候选和要点。\n病史：{病史}\n检索到的证据：{处理后证据}\n年龄: {年龄}\nBMI: {BMI}\n回答：",
        "format": [{"symptom": str, "candidates": list, "evidence": list}],
        "inp": ["病史", "处理后证据", "年龄", "BMI"],
        "out": "候选诊断与要点",
        "next": ["是否需要进一步检查"],
    },
    # Branch node
    "是否需要进一步检查": {
        "inp": ["候选诊断与要点"],
        "use_llm": True,
        "next": {
            "需要进一步检查": ["生成检查清单"],
            "不需要": ["进行诊断"],
        },
    },
    # LLM node
    "生成检查清单": {
        "prompt": "任务：生成检查清单\n请给出基于候选诊断的优先检查项目（JSON格式：{'checks': [..]}）。\n候选诊断：{候选诊断与要点}\n回答：",
        "format": {"checks": list},
        "inp": ["候选诊断与要点"],
        "out": {"checks": "建议检查"},
        "next": ["执行检查"],
    },
    # API node
    "心电图检查": {
        "api": {
            # "url": "http://example.mcp/api/run_checks",
            "func": offline_api,
            "data": {"check_item": "心电图", "pid": "患者ID"},
        },
    },
    # API node
    "血肌钙蛋白检查": {
        "api": {
            # "url": "http://example.mcp/api/run_checks",
            "func": offline_api,
            "data": {"check_item": "血肌钙蛋白", "pid": "患者ID"},
        },
    },
    # API node
    "胸部X光检查": {
        "api": {
            # "url": "http://example.mcp/api/run_checks",
            "func": offline_api,
            "data": {"check_item": "胸部X光", "pid": "患者ID"},
        },
    },
    # API node
    "心脏超声检查": {
        "api": {
            # "url": "http://example.mcp/api/run_checks",
            "func": offline_api,
            "data": {"check_item": "心脏超声", "pid": "患者ID"},
        },
    },
    # MCP node
    "执行检查": {
        "mcp": ["心电图检查", "血肌钙蛋白检查", "胸部X光检查", "心脏超声检查"],
        "inp": ["建议检查", "患者ID"],
        "out": "检查结果",
        "next": ["进行诊断"],
    },
    # LLM node
    "进行诊断": {
        "prompt": (
            "任务：进行诊断\n要求：请根据患者病史、候选诊断要点、检索证据片段和检查结果给出最可能的最终诊断（只返回疾病名称或'无法确定'）。\n"
            "病史：{病史}\n候选诊断：{候选诊断与要点}\n检索证据：{证据片段}\n检查结果：{检查结果}\n回答："
        ),
        "return_json": False,
        "inp": ["病史", "候选诊断与要点", "证据片段", "检查结果"],
        "out": "诊断结果",
        "next": ["诊断置信度大于95"],
    },
    # Branch node
    "诊断置信度大于95": {
        "inp": ["诊断结果"],
        "code": "{diagnosis}['confidence']>0.95",
        "next": {
            "True": ["给出治疗建议"],
            "False": ["加入历史诊断列表"],
        },
    },
    # Value node
    "加入历史诊断列表": {
        "item": "检查结果",
        "mode": "append",  # [assign, append]
        "out": "历史诊断",
        "next": ["网络搜索"],
    },
    # Subgraph node
    "网络搜索": {
        "inp": ["诊断结果"],
        "subgraph": "demo_sub",
        "out": "文献",
        "next": ["重新诊断"],
    },
    # File node
    "查看本地指南": {
        "file": "demo_guideline.pdf",
        # "file_dir": "./example/",
        "tool": "pymupdf4llm",  # "docling"
        "out": "指南",
    },
    # LLM node
    "重新诊断": {
        "prompt": (
            "请根据患者病史、候选诊断要点、检索证据片段和检查结果确认最终诊断（只返回疾病名称）。\n"
            "病史：{病史}\n候选诊断：{候选诊断与要点}\n检索证据：{证据片段}\n检查结果：{检查结果}\n回答："
        ),
        "return_json": False,
        "inp": [
            "病史",
            "候选诊断与要点",
            "证据片段",
            "检查结果",
            "指南",
            "文献",
            "历史诊断",
        ],
        "out": "诊断结果",
        "next": ["诊断置信度大于95"],
    },
    # LLM node
    "给出治疗建议": {
        "prompt": "根据最终诊断和检查结果给出可执行的治疗和随访建议。\n最终诊断：{诊断结果}\n检查结果：{检查结果}\n回答：",
        "llm": another_llm,
        "model": "DeepSeek-V3.2",
        "return_json": False,
        "inp": ["诊断结果", "指南"],
        "out": "治疗建议",
        "next": ["保存记录"],
    },
    # Database node
    "保存记录": {
        "inp": ["患者ID", "病史", "诊断结果", "治疗建议"],
        "sql": "INSERT INTO medical_records (patient_id, history, diagnosis, treatment) VALUES ({患者ID}, {病史}, {诊断结果}, {治疗建议})",
        "out": "执行结果",
        "next": ["exit"],
    },
    "exit": {"确诊": "诊断结果", "治疗": "治疗建议"},
}


if __name__ == "__main__":
    print("=== Demo Pipeline (mocked) ===")
    demo_input = jload("demo_input.json")
    print(
        f"输入: {demo_input}",
    )
    print(
        "LLM 收集病史 ->",
        (ans := offline_llm("任务：收集病史\n" + demo_input[0]["患者信息"])),
    )
    print(
        "LLM 提取症状 ->",
        (ans := offline_llm("任务：提取症状\n" + ans.split("</think>")[-1])),
    )
    print("RAG 检索证据(胸痛) ->", offline_rag("胸痛"))
    print(
        "LLM 聚合分析 ->",
        (
            ans := offline_llm(
                "任务：聚合分析\n" + "心肌梗死肺栓塞甲状腺功能减退 age:45 BMI:22.3"
            )
        ),
    )
    print("LLM 生成检查清单 ->", (ans := offline_llm("任务：生成检查清单\n" + ans)))
    print(
        "API 执行心电图检查 ->", offline_api({"check_item": "心电图", "pid": "P123456"})
    )
    print("LLM 进行诊断 ->", offline_llm("任务：进行诊断\n" + "ST段抬高左室功能减低"))
    print("LLM 治疗建议 ->", another_llm("冠状动脉粥样硬化性心脏病"))
