prompt = """Task: Please select the closest item from the items based on the input content and only answer the item id in JSON format, e.g.
```json
{"item_id": "#i"}
```

Input: {input}
Items:
{items}

Let's think step by step.
Answer:
"""
keys = ["{input}", "{items}"]
