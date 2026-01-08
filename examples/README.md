# Examples

A collection of example pipelines demonstrating how to use SigmaFlow for different tasks (medical diagnosis, epidemic response planning, meteorological infectious disease modeling, and demos).

- **demo/** — interactive demo pipeline and example usage.
- **Med-FoT/** — clinical diagnostic workflow for abdominal diseases (FoT research example).
- **adverse_drug_reactions/** — pipeline for extracting and evaluating adverse drug reactions using LLMs and RAG.
- **epidemic_response_plan/** — epidemic response planning pipeline using RAG and LLMs.
- **meteorological_infectious_disease/** — combine meteorological and surveillance data to model infectious disease indicators.

Quick start:

```bash
# run an example pipeline
cd examples/<example_folder>
sigmaflow -p <pipeline.py> -i <input.json>
```

See each example folder for detailed README, inputs, and images.