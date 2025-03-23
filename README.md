<div align="center">
  <img src="./assets/banner.png" alt="banner" />

  <a href="https://sigmaflow.gitbook.io/sigmaflow-docs"><img src="https://img.shields.io/static/v1?message=Docs&logo=gitbook&logoColor=ffffff&label=%20&labelColor=5c5c5c&color=3F89A1"></a>
  <a href="#"><img src="https://img.shields.io/badge/Open_Source-❤️-FDA599?"/></a>
  <img src="https://komarev.com/ghpvc/?username=maokangkun&label=Views&color=0e75b6&style=flat" alt="访问量统计" />
  [![license](https://img.shields.io/github/license/maokangkun/SigmaFlow.svg)](https://github.com/maokangkun/SigmaFlow/tree/main/LICENSE)
  [![issue resolution](https://img.shields.io/github/issues-closed-raw/maokangkun/SigmaFlow)](https://github.com/maokangkun/SigmaFlow/issues)
  [![open issues](https://img.shields.io/github/issues-raw/maokangkun/SigmaFlow)](https://github.com/maokangkun/SigmaFlow/issues)

  <p align="center">
    👋 join us on <a href="https://linluhe.github.io/group_qrcode.html" target="_blank">WeChat</a>
  </p>
</div>

# SigmaFlow
SigmaFlow is a Python package designed to optimize the performance of task-flow related to LLMs or MLLMs.
![comfyUI demo](./assets/comfyUI.png)

## Introduction
SigmaFlow is a Python package designed to optimize the performance of task-flow related to Large Language Models (LLMs) or Multimodal Large Language Models (MLLMs). It ensures efficient parallel execution of task-flow while maintaining dependency constraints, significantly enhancing the overall performance.

SigmaFlow 是一个 Python 包，旨在优化与大模型 (LLMs or MLLMs) 相关任务流的性能。在满足依赖关系的前提下，确保任务流的高效并行执行，从而显著提高整体性能。

## Features
- Dependency Management: Handles task dependencies efficiently, ensuring correct execution order.

  依赖管理：高效处理任务依赖关系，确保正确的执行顺序。
- Parallel Execution: Maximizes parallelism to improve performance.

  并行执行：最大化并行性以提高性能。
- Loop Handling: Supports tasks with loop structures.

  循环处理：支持带有循环结构的任务。
- Easy Integration: Simple and intuitive API for easy integration with existing projects.

  易于集成：简单直观的 API，便于与现有项目集成。

## Installation
You can install SigmaFlow via pip:

你可以通过 pip 安装 SigmaFlow：
```bash
pip install SigmaFlow
```

## Usage
Here is a basic example to get you started:

下面是一个基本示例，帮助你快速入门：

```python
from SigmaFlow import SigmaFlow, Prompt

# set custom prompt
example_prompt = Prompt("""
...
{inp1}
xxx
""", keys=['{inp1}'])

# set api
def llm_api(inp):
    ...
    return out

def rag_api(inp):
    ...
    return out

# set input data
data = {
    'inp': 'test input text ...',
}

# set pipeline
demo_pipe = {
    'process_input': {
        'prompt': example_prompt,
        'format': {'out1': list, 'out2': str}, # check return json format
        'inp': ['inp'],
        'out': ['out1', 'out2'],
        'next': ['rag1', 'loop_A'], # specify the next pipeline
    },
    'rag1': {
        'rag_backend': rag_api2, # specific api can be set for the current pipe via 'rag_backend' or 'llm_backend'.
        'inp': ['out2'],
        'out': 'out8',
    },
    'loop_A': { # here is iterating over a list 'out1'
        'inp': 'out1',
        'pipe_in_loop': ['rag2', 'llm_process', 'rag3', 'rag4', 'llm_process2', 'llm_process3'],
        'next': ['exit'], # 'exit' is specific pipe mean to end
    },
    'rag2': {
        'inp': ['out1'],
        'out': 'out3',
    },
    'llm_process2': {
        'prompt': llm_process2_prompt,
        'format': {'xxx': str, "xxx": str},
        'inp': ['inp', 'out4', 'out8'],
        'out': 'final_out1',
    },
    ...
}

# running pipeline
pipeline = SigmaFlow(demo_pipe, llm_api, rag_api)
result, info = pipeline.run(data, core_num=4, save_pref=True)
```

Logs are stored in the `logs` folder. If `save_pref` is `true`, you can see the relevant performance report.

日志存储在logs文件夹下，如果save_pref为true，你可以看到相关的性能报告。

<div align="center">
  <img src="./assets/pipe.png" alt="pipe" />

  <!-- ![perf](./assets/perf.png) -->
</div>

## Documentation
For detailed documentation, please visit our official documentation page.

有关详细文档，请访问我们的官方文档页面。

## Contributing
We welcome contributions from the community. Please read our contributing guide to get started.

我们欢迎来自社区的贡献。请阅读我们的贡献指南开始。

## License
SigmaFlow is licensed under the Apache License Version 2.0. See the [LICENSE](./LICENSE) file for more details.

SigmaFlow 采用 Apache License Version 2.0 许可证。有关详细信息，请参阅[许可证](./LICENSE)文件。

## Acknowledgements
Special thanks to all contributors and the open-source community for their support.

特别感谢所有贡献者和开源社区的支持。

## Contact
For any questions or issues, please open an issue on our [GitHub repository](https://github.com/maokangkun/SigmaFlow).

如有任何问题或意见，请在我们的[GitHub 仓库](https://github.com/maokangkun/SigmaFlow)提交 issue。

<div align="center">
  
[![Star History Chart](https://api.star-history.com/svg?repos=maokangkun/SigmaFlow&type=Date)](https://star-history.com/#maokangkun/SigmaFlow&Date)

</div>
