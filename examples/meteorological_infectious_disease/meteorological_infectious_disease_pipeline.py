import importlib
import numpy as np
import pandas as pd
from sigmaflow.log import log
from sigmaflow.utils import async_compat


@async_compat
def data_preprocess(arr):
    with pd.option_context("future.no_silent_downcasting", True):
        df = pd.DataFrame(arr).replace("", np.nan).infer_objects(copy=False)
        log.debug(f"缺失值检查：\n{df.isnull().sum()}")

        df["降水量"] = df["降水量"].fillna(0)
        for col in df.columns:
            if df[col].isnull().any():
                df[col] = df[col].interpolate()
                df[col] = df[col].ffill()
                df[col] = df[col].bfill()

        log.debug(f"缺失值处理后检查：\n{df.isnull().sum()}")
        return df


@async_compat
def model_predict(model, df, factor):
    module = importlib.import_module(f"models.{model}")
    result = module.performance(df, factor)
    return {"model": model} | result


pipeline = {
    "CONFIG": {
        "llm": "ollama",
        "model": "Qwen3-8B",
    },
    # ==========================================================================
    "数据预处理": {
        "inp": ["meteorological_infectious_disease"],
        "code": data_preprocess,
        "out": "气象传染病数据",
    },
    "智能确定因素": {
        "prompt": "现在要训练一个模型预测流感就诊百分比指标，模型的输入只能从下面的候选因素中选取。\n候选因素：{factor}\n因素选取要求：根据期刊文献（PubMed等）和官方指南（WHO等）选出与该传染病相关的气象因素，从而能够提升模型预测性能。\n\n请根据要求仅从候选因素里选取出多个相关因素并给出理由和出处。结果按照JSON格式输出。示例：{'factor': ['xxx', 'xxx'],'reason': 'xxx','ref': ['xxx', 'xxx']}\n\n回答：",
        "format": {"factor": list, "reason": str, "ref": list},
        "inp": ["factor"],
        "out": {"factor": "因素"},
        "next": ["遍历模型列表"],
    },
    "遍历模型列表": {
        "inp": ["models"],
        "pipe_in_loop": ["模型建模&预测"],
        "next": ["模型选择"],
    },
    "模型建模&预测": {
        "inp": ["models", "气象传染病数据", "因素"],
        "code": model_predict,
        "out": "模型预测结果",
    },
    "模型选择": {
        "prompt": "模型结果：{模型预测结果}\n模型选取规则：{rule}\n\n请根据模型选取规则综合选出一个最好的模型。结果按照JSON格式输出。示例：{'model': 'xxx','reason': 'xxx'}\n\n回答：",
        "format": {"model": str, "reason": str},
        "inp": ["模型预测结果", "rule"],
        "out": "模型选择结果",
        "next": ["exit"],
    },
    "exit": {
        "model_select": "模型选择结果",
    },
}
