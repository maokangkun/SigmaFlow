from .block_llm import LLMBlock
from .block_rag import RAGBlock
from .block_search import SearchBlock
from .block_browser import BrowserBlock

__all__ = ["LLMBlock", "RAGBlock", "SearchBlock", "BrowserBlock"]

# import importlib
# from pathlib import Path
# from ..log import log

# for file in Path(__file__).parent.glob("block_*.py"):
#     module_name = file.stem

#     try:
#         module = importlib.import_module(f".{module_name}", __package__)
#         for name in dir(module):
#             obj = getattr(module, name)
#             if isinstance(obj, type) and name.endswith("Block") and name != "Block":
#                 globals()[name] = obj
#     except Exception as e:
#         log.error(f"Warning: Failed to import from {module_name}: {e}")
#         exit()

# del file, module_name, module, name, obj
