pipeline = {
    "CONFIG": {
        "llm": "vllm",
        "model": "Qwen3-8B",
    },
    # Value node
    "抽取鉴别诊断疾病": {
        "inp": ["诊断结果"],
        "item": "诊断结果->diff_diag",
        "out": "鉴别诊断疾病",
    },
    # Loop node
    "检索每个疾病": {
        "inp": ["鉴别诊断疾病"],
        "pipe_in_loop": ["互联网浏览最新医学文献", "内容总结"],
    },
    # Web node
    "互联网浏览最新医学文献": {
        "web": {
            "search_engine": "bing",
            # "urls": ["https://pubmed.ncbi.nlm.nih.gov/"],
            "count": 5,
            "browser": "requests",  # 'selenium'
        },
        "inp": ["鉴别诊断疾病"],
        "out": "网页内容",
        "next": ["内容总结"],
    },
    # LLM node
    "内容总结": {
        "prompt": (
            "请根据以下网页内容，结合医学知识，简要总结该疾病的关键诊断要点和最新研究进展，"
            "以便辅助临床诊断和决策。\n疾病名称：{鉴别诊断疾病}\n网页内容：{网页内容}\n总结："
        ),
        "inp": ["网页内容"],
        "out": "文献",
    },
}
