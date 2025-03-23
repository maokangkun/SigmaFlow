import os
import asyncio
import pkgutil
import importlib
from ..log import log

class _SearchEngine:
    def __init__(self):
        log.debug('Setup SearchEngine')
        self.engines = {}
        for loader, module_name, is_pkg in pkgutil.walk_packages(__path__, __name__ + '.'):
            if (name := module_name.split('.')[-1]).startswith('search_'):
                name = name.replace('search_', '')
                m = importlib.import_module(module_name)
                self.engines[name] = [m.search, m.async_search]
        log.debug(f'Load engines: {list(self.engines.keys())}')

    def get(self, engine_name):
        return self.engines[engine_name]

SearchEngine = _SearchEngine()
llm_sem = asyncio.Semaphore(int(os.getenv('LLM_CONCURRENCY', 16)))