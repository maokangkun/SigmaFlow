import time
import asyncio

def llm(inp):
    if '请你根据患者信息诊断出所患疾病' in inp: return '无法确定'
    elif 'Task: Please select' in inp:
        if 'Input: 无法确定' in inp: return '{"item_id": "#2"}'
        else: return '{"item_id": "#1"}'
    elif '请你根据患者信息和诊断给出具体的治疗建议' in inp: return '无'
    elif '请你根据患者信息提取出所有症状' in inp: return '{"symptoms": ["夜盲", "视力差", "易摔跤", "自幼身材矮小", "卵巢和子宫发育异常", "幼稚子宫", "月经不规律"]}'
    elif '请你根据患者信息和每个症状对应的疾病' in inp: return '先天性子宫发育不全'
    elif '请你根据患者信息提取出患者的出生日期' in inp: return '1980-03-04'
    elif '请你根据患者信息提取出患者的身高体重' in inp: return '{"height": 1.76, "weight": 69}'
    return inp

def rag(inp):
    data = {"symptoms": [
                {"symptom": "夜盲", "possible_diseases": ["维生素A缺乏症", "视网膜色素变性", "先天性夜盲症"]},
                {"symptom": "视力差", "possible_diseases": ["近视", "远视", "散光", "白内障", "青光眼", "视网膜疾病"]},
                {"symptom": "易摔跤", "possible_diseases": ["平衡障碍", "内耳疾病", "神经系统疾病", "视力问题"]},
                {"symptom": "自幼身材矮小", "possible_diseases": ["生长激素缺乏症", "甲状腺功能减退症", "染色体异常", "营养不良"]},
                {"symptom": "卵巢和子宫发育异常", "possible_diseases": ["先天性卵巢发育不全", "先天性子宫发育异常", "内分泌紊乱"]},
                {"symptom": "幼稚子宫", "possible_diseases": ["先天性子宫发育不全", "内分泌紊乱", "染色体异常"]},
                {"symptom": "月经不规律", "possible_diseases": ["多囊卵巢综合征", "甲状腺功能异常", "内分泌紊乱", "压力或生活方式因素"]}
            ]}
    for sym in data['symptoms']:
        if inp == sym['symptom']: return sym
    return None

duration = 0.5

def llm_client(run_mode):
    match run_mode:
        case 'async':
            async def f1(inp):
                await asyncio.sleep(duration)
                return llm(inp)

            return f1
        case _:
            def f2(inp):
                time.sleep(duration)
                return llm(inp)

            return f2

def rag_client(run_mode):
    match run_mode:
        case 'async':
            async def f1(inp):
                await asyncio.sleep(duration)
                return rag(inp)

            return f1
        case _:
            def f2(inp):
                time.sleep(duration)
                return rag(inp)

            return f2

pipeline = {
    "诊断": {
        "prompt": {
            "prompt": "请你根据患者信息诊断出所患疾病，只需回答出疾病名称，不知道就回答无法确定。\n患者信息：{患者信息}\n回答：",
            "keys": ['{患者信息}']
        },
        "backend_construct": llm_client,
        "return_json": False,
        "inp": ["患者信息"],
        "out": "疾病",
        "next": ["是否确诊"]
    },
    "是否确诊": {
        "inp": ["疾病"],
        "use_llm": True,
        "backend_construct": llm_client,
        "next": {
            "确诊": "治疗推荐",
            "无法确定": ["提取症状", "获取出生日期", "获取身高体重", "查看指南"],
        }
    },
    "获取出生日期": {
        'prompt': {
            "prompt": "请你根据患者信息提取出患者的出生日期，返回格式yyyy-mm-dd。\n患者信息：{患者信息}\n回答：",
            "keys": ['{患者信息}']
        },
        "backend_construct": llm_client,
        "return_json": False,
        'inp': ['患者信息'],
        'out': '出生日期',
        'next': ['计算年龄'],
    },
    '计算年龄': {
        'inp': ['出生日期'],
        'code': "def calc_age(birth_str):\n    from datetime import datetime\n    birth = datetime.strptime(birth_str, '%Y-%m-%d')\n    today = datetime.now()\n    age = today.year - birth.year - ((today.month, today.day) < (birth.month, birth.day))\n    return age",
        'code_entry': 'calc_age',
        'out': '年龄',
    },
    "获取身高体重": {
        'prompt': {
            "prompt": '请你根据患者信息提取出患者的身高体重，身高单位是m，体重单位是kg，返回json格式{"height": xx, "weight": xx}。\n患者信息：{患者信息}\n回答：',
            "keys": ['{患者信息}']
        },
        "backend_construct": llm_client,
        'format': {'height': float, 'weight': int},
        'inp': ['患者信息'],
        'out': {'height': '身高', 'weight': '体重'},
        'next': ['计算BMI']
    },
    '计算BMI': {
        'inp': ['身高', '体重'],
        'code': "round({体重}/{身高}**2, 1)",
        'out': 'BMI',
    },
    '提取症状': {
        'prompt': {
            "prompt": "请你根据患者信息提取出所有症状，以JSON格式返回症状列表，如{'symptoms': [xxx,xxx]}。\n患者信息：{患者信息}\n回答：",
            "keys": ['{患者信息}']
        },
        "backend_construct": llm_client,
        'format': {'symptoms': list},
        'inp': ['患者信息'],
        'out': {'symptoms': '症状'},
        'next': ['每个症状'],
    },
    '每个症状': {
        'inp': ['症状'],
        'pipe_in_loop': ['搜索疾病列表'],
        'next': ['推断最有可能疾病'],
    },
    '搜索疾病列表': {
        'rag_param': None,
        "backend_construct": rag_client,
        'inp': ['症状'],
        'out': '疾病列表'
    },
    '推断最有可能疾病': {
        'prompt': {
            "prompt": "请你根据患者信息和每个症状对应的疾病，诊断出患者的疾病，只返回疾病名，不知道则返回无法确定。\n患者信息：{患者信息}\n疾病列表：{疾病列表}\n回答：",
            "keys": ['{患者信息}', '{疾病列表}']
        },
        "backend_construct": llm_client,
        "return_json": False,
        'inp': ['患者信息', '疾病列表'],
        'reset_out': '疾病',
        'next': ['是否确诊'],
    },
    "查看指南": {
        "file": "./example/demo_test.pdf",
        # "file_dir": "./example/",
        "out": "指南"
    },
    # '联网搜索疾病': {
    #     'web': {
    #         'search_engine': 'bing',
    #         # 'urls': ['xxx', 'xxx'],
    #         'count': 5,
    #         'browser': 'requests',
    #     },
    #     'inp': ['疾病'],
    #     'out': '搜索结果',
    #     'next': ['治疗推荐'],
    # },
    '治疗推荐': {
        'prompt': {
            "prompt": "请你根据患者信息和诊断给出具体的治疗建议。\n患者信息：{患者信息}\n年龄：{年龄}\nBMI：{BMI}\n诊断：{疾病}\n指南: {指南}\n回答：",
            "keys": ['{患者信息}', '{疾病}', '{年龄}', '{BMI}', '{指南}']
        },
        "backend_construct": llm_client,
        "return_json": False,
        'inp': ['患者信息', '疾病', '年龄', 'BMI'],
        'out': '治疗建议',
        'next': ['exit'],
    },
    'exit': {
        '确诊': '疾病',
        '治疗': '治疗建议'
    }
}
