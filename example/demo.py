from dotenv import load_dotenv
load_dotenv()
import sys
import time
import asyncio
from pathlib import Path

sys.path.append(".")
sys.path.append("..")
from sigmaflow import PipelineManager

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

def llm_client(inp):
    time.sleep(1)
    return llm(inp)

async def llm_client_async(inp):
    await asyncio.sleep(1)
    return llm(inp)

def rag_client(inp):
    time.sleep(1)
    return rag(inp)

async def rag_client_async(inp):
    await asyncio.sleep(1)
    return rag(inp)

test_task = {
    'demo_pipeline': [
        {
            '患者信息': '患者女性，1980年3月4日出生，身高176cm，体重69kg。因自幼夜盲、视力差、易摔跤来首都医科大学附属北京同仁医院北京同仁眼科中心就诊。既往病史：患者为足月顺产，无吸氧史，出生体重正常，1岁时学会说话和行走。自幼身材矮小，12岁时身高仅为130 cm（12岁女童身高参考值140~155 cm），但智力发育正常。患者16岁时仍未来月经，到当地医院检查发现卵巢和子宫发育异常，被诊断为“幼稚子宫”，进行了激素替代治疗后来月经并长高，药物持续使用半年，停药后月经停止，此后未规律使用药物。家族史：患者哥哥无异常，父母之间无血缘关系。',
        },
    ]
}

def mp_test():
    cur_dir = Path(__file__).parent
    pm = PipelineManager(llm_client, rag_client, run_mode='mp', pipes_dir=cur_dir)

    for pipe_name, data_arr in test_task.items():
        for data in data_arr:
            r, info = pm.pipes[pipe_name].run(data, save_perf=True)
            if 'error_msg' in r: print(r['error_msg'].strip().split('\n')[-1])

async def async_test():
    cur_dir = Path(__file__).parent
    pm = PipelineManager(llm_client_async, rag_client_async, pipes_dir=cur_dir)

    for pipe_name, data_arr in test_task.items():
        for data in data_arr:
            r, info = await pm.pipes[pipe_name].run(data, save_perf=True)
            if 'error_msg' in r: print(r['error_msg'].strip().split('\n')[-1])

# mp_test()
asyncio.run(async_test())
