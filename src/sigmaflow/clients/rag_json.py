import os
import json

json_file = os.getenv("RAG_JSON", "rag.json")
data = json.load(open(json_file, "r"))


def rag_client(is_async=False):
    if is_async:
        return async_rag
    else:
        return rag


def rag(text):
    return data.get(text, None)


async def async_rag(text):
    return rag(text)
