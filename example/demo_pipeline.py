pipeline = {
    "诊断": {
        "prompt": {
            "prompt": "请你根据患者信息诊断出所患疾病，只需回答出疾病名称，不知道就回答无法确定。\n患者信息：{患者信息}\n回答：",
            "keys": ['{患者信息}']
        },
        "return_json": False,
        "inp": ["患者信息"],
        "out": "疾病",
        "next": ["是否确诊"]
    },
    "是否确诊": {
        "inp": ["疾病"],
        "use_llm": True,
        "next": {
            "确诊": "联网搜索疾病",
            "无法确定": ["提取症状", "获取出生日期", "获取身高体重"],
        }
    },
    "获取出生日期": {
        'prompt': {
            "prompt": "请你根据患者信息提取出患者的出生日期，返回格式yyyy-mm-dd。\n患者信息：{患者信息}\n回答：",
            "keys": ['{患者信息}']
        },
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
        'inp': ['症状'],
        'out': '疾病列表'
    },
    '推断最有可能疾病': {
        'prompt': {
            "prompt": "请你根据患者信息和每个症状对应的疾病，诊断出患者的疾病，只返回疾病名，不知道则返回无法确定。\n患者信息：{患者信息}\n疾病列表：{疾病列表}\n回答：",
            "keys": ['{患者信息}', '{疾病列表}']
        },
        "return_json": False,
        'inp': ['患者信息', '疾病列表'],
        'reset_out': '疾病',
        'next': ['是否确诊'],
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
            "prompt": "请你根据患者信息和诊断给出具体的治疗建议。\n患者信息：{患者信息}\n年龄：{年龄}\nBMI：{BMI}\n诊断：{疾病}\n回答：",
            "keys": ['{患者信息}', '{疾病}', '{年龄}', '{BMI}']
        },
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
