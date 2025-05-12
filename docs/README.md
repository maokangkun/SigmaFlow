# Pipeline Document

A pipeline is composed of multiple pipe modules (including LLM module, RAG module, branch module, code calculation module, loop module, web search module, value module, etc.), each responsible for a specific task. These modules communicate via input (`inp`) and output (`out`) keys, with optional transitions (`next`) to define the flow. Below is an explanation of each component and its configuration options:

## Module General Structure
A module typically contains the following attributes:
- name: Specifies module name.
- `inp`: Specifies input keys that the module uses.
- `out`: Specifies output keys produced by the module.
- `next`: (Optional) Determines the next module(s) in the pipeline flow.
- other: Module-specific parameters.

## Pipeline Flow
The pipeline moves data and logic between modules via transitions (next). A module's next property can be:
- A single module: A direct transition.
- A branch: Specifies paths for different conditions (e.g., "confirmed" vs. "unable to determine").
- Loop logic: Iterates through data and processes it in subsequent modules.

## Module Types
### 1. LLM (Large Language Model) Module
Purpose: Generates a response using a prompt for an LLM.

Example:
```python
"prompt": {
    "prompt": "Extract the patient's height and weight based on the patient information. The height unit is m and the weight unit is kg. Return the result in json format {\"height\": xx, \"weight\": xx}.\nPatient Info: {Patient Info}\nAnswer:",
    "keys": ["{Patient Info}"]
},
"return_json": True,
"format": {"height": float, "weight": int},
'out': {'height': 'Height', 'weight': 'Weight'}
```
Key Parameters:
- `prompt`: Defines a textual prompt for an LLM, with placeholders for input variables.
- `prompt.prompt`: The text prompt with placeholders.
- `prompt.keys`: Defines the input variables for the placeholders.
- `return_json`: (Optional) Indicates whether the output is JSON or raw text.
- `format`: (Optional) Ensures output data matches a specified type or structure (e.g., int, float, list, dict). This is used when `return_json` is True.
- `out`: Ensures output renames to specific name.

### 2. RAG (Retrieval-Augmented Generation) Module
Purpose: Uses retrieved documents or information to enhance response generation.

Example:
```python
'rag_param': {
    'kb_id': "DRUG_KB_NAME",
    'top_k': 1, 
    'threshold': 0.9,
},
```
Key Parameters:
- `rag_param`: Configuration for retrieval.
- `rag_param.kb_id`: Knowledge database ID.
- `rag_param.top_k`: The top k search results for retrieved information.
- `rag_param.threshold`: The threshold score for filtering retrieved information.

### 3. Code Calculation Module
Purpose: Executes custom Python logic to process input data.

Example:
```python
'code': "def calc_age(birth_str): ...",
'code_entry': 'calc_age'
```
Key Parameters:
- `code`: Executes Python logic within the module.
- `code_entry`: Entry point for the function. If this item is not available, run the `code` directly to get the execution result.

### 4. Branching Module
Purpose: Directs flow based on conditions or user input.

Example:
```python
"use_llm": True,
"next": {
    "confirmed": "Internet Search",
    "unable to determine": ["Extract Symptoms", "Get Height and Weight"]
}
```
Key Parameters:
- `use_llm`: (Optional) Indicates whether to use a LLM for conditional judgment, default is `False`.
- `next`: Maps conditions to the next module(s).
- `code` & `code_entry`: same as code calculation module.

### 5. Loop Module
Purpose: Iterates through data to process each item individually.

Example:
```python
'pipe_in_loop': ['Search Disease List'],
```
Key Parameters:
- `pipe_in_loop`: Indicates subsequent modules for processing input.

### 6. Web Search Module
Purpose: Performs internet searches to gather external information.

Example:
```python
'web': {
    'search_engine': 'bing',
    'count': 5,
    'browser': 'requests'
}
```
Key Parameters:
- `search_engine`: The search engine to use.
- `count`: Number of results to retrieve.
- `browser`: HTTP library for search, `requests` or `selenium`.

### 7. Value Module
Purpose: Assigning predefined values to specific keys, either directly or by modifying existing values.

Example:
```python
"out": "symptoms",
"value": "high fever",
"mode": "append"
```
Key Parameters:
- `out`: Specifies the key for which the value is being set or modified..
- `value`: The value to assign.
- `mode`: (Optional) Determines how the value is applied: `assign` (default) or `append` (adds the specified value to a list).

### 8. Exit Module
Purpose: Marks the end of the pipeline.

Example:
```python
'next': ['exit']
```