from sigmaflow.utils import async_compat

@async_compat
def llm(inp):
    return "冠状动脉粥样硬化性心脏病"

pipeline = {
    "CONFIG": {
        "llm": llm,  # ["lmdeploy", "vllm", "mlx", "ollama", "openai", "torch"] for global LLM nodes
        "model": "qwen3-235b",
        "base_url": "https://10.140.158.153:1020/qwen3-235B/all/v1/",
        "api_key": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoieWFucWl1anVhbi1zcHRlYWNoIiwiZXhwIjoxNzk4NzYxNjAwfQ.wY6fYum2IOniV-ge8vu__lTZ_y6oJPDjnpIsUrRs7bE",
    },
    "收集病史": {
        "prompt": "你是谁",
        "return_json": False,
        "remove_think": True,
        # "out": "回答",
    }
}