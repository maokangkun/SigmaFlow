### Demo pipeline

**Overview:** This demo showcases a complete SigmaFlow pipeline that demonstrates how to load input data and process it through a chain of nodes to perform inference and produce outputs. Key tasks include parsing the input JSON, executing node-by-node data processing and model inference (which may include LLMs or external models), aggregating and post-processing results, and exporting outputs (JSON/visualizations). The general flow is: 1) load configuration and data; 2) execute nodes and sub-pipelines; 3) aggregate and post-process; 4) export results and save logs/visualizations. This example covers all supported node types and can be used as a reference for building custom pipelines.

Running example:
```bash
cd examples/demo
sigmaflow -p demo_pipeline.py -i demo_input.json
```

or using python:
```bash
cd examples/demo
python demo.py
```

### Pipeline flow diagram

![demo](demo_pipeline.png)