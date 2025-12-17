pipeline = {
    "联网搜索疾病": {
        "web": {
            "search_engine": "bing",
            # 'urls': ['xxx', 'xxx'],
            "count": 5,
            "browser": "requests",
        },
        "inp": ["疾病"],
        "out": "搜索结果",
        "next": ["治疗推荐"],
    },
}
