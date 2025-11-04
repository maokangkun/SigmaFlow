import re
import time
import json
from .log import log
from .clients import SearchEngine

class Pipe:
    def __init__(self, name, lock, run_time, inout_log, verbose, retry=1, second_round=False):
        self.name = name
        self.verbose = verbose
        self.retry = retry
        self.second_round = second_round
        self.log = lambda n, t: log.debug(f'[{name}] {n}: {t}') if self.verbose else None

        # multiprocess lock
        self.lock = lock
        self.run_time = run_time if run_time is not None else []
        self.inout_log = inout_log if inout_log is not None else []

    @property
    def time(self):
        if self.run_time:
            return sum(self.run_time) / len(self.run_time)
        return None

    def _json(self, inp):
        inp = inp.strip()

        # remove think content
        regex = r"(^<think>[^<]*(?:<(?!/?think>)[^<]*)*<\/think>)"
        inp = re.sub(regex, '', inp).strip()

        try:
            j = json.loads(inp)
            return j
        except: pass
        
        if (m := re.findall(r'```(?:json)?(.*?)```', inp, re.DOTALL)):
            try:
                j = json.loads(m[0])
                return j
            except: pass
        return None

    def __str__(self):
        return f"<{self.__class__.__name__}: {self.name}>"

    def __repr__(self):
        return self.__str__()

    def _call(self, *inp):
        pass

    def __call__(self, *inp):
        n = 0
        while n < self.retry:
            start_t = time.time()
            self.log('inp', inp)
            out, query, resp = self._call(*inp)

            t = time.time() - start_t
            inout = {
                'id': self.name,
                'timestamp': time.time(),
                'input': query,
                'output': resp,
            }
            self.log('cost time', t)
            if self.lock is not None:
                with self.lock:
                    self.run_time.append(t)
                    self.inout_log.append(inout)
            else:
                self.run_time.append(t)
                self.inout_log.append(inout)
            if out is None:
                n += 1
                self.log('retry', n)
            else:
                break
        return out

    async def _async_call(self, *inp):
        pass

    async def _async_second_call(self, history):
        pass

    async def async_call(self, *inp):
        n = 0
        while n < self.retry:
            start_t = time.time()
            self.log('inp', inp)
            out, query, resp = await self._async_call(*inp)

            t = time.time() - start_t
            inout = {
                'id': self.name,
                'timestamp': time.time(),
                'input': query,
                'output': resp,
            }
            self.log('cost time', t)
            if self.lock is not None:
                with self.lock:
                    self.run_time.append(t)
                    self.inout_log.append(inout)
            else:
                self.run_time.append(t)
                self.inout_log.append(inout)
            
            if out is None and self.second_round:
                start_t = time.time()
                out, query2, resp2 = await self._async_second_call([query, resp])

                t = time.time() - start_t
                inout = {
                    'id': self.name,
                    'timestamp': time.time(),
                    'input': query2,
                    'output': resp2,
                }
                self.log('cost time', t)
                if self.lock is not None:
                    with self.lock:
                        self.run_time.append(t)
                        self.inout_log.append(inout)
                else:
                    self.run_time.append(t)
                    self.inout_log.append(inout)
            
            if out is None:
                n += 1
                self.log('retry', n)
            else:
                break
        return out

class LLMPipe(Pipe):
    def __init__(self, name, prompt=None, return_json=True, format=None, llm=None, verbose=True, retry=5, inp=None, out=None, lock=None, run_time=None, inout_log=None, second_round=False, remove_think=False, **kargs):
        if return_json: second_round = True
        super().__init__(name, lock, run_time, inout_log, verbose, retry, second_round)
        self.prompt = prompt
        self.llm = llm
        self.return_json = return_json
        self.format = format
        self.remove_think = remove_think

    def _call(self, *inp):
        text = self.prompt(*inp)
        self.log('prompt', text)
        resp = self.llm(text)
        self.log('resp', resp)
        if self.return_json:
            out = self._json(resp)
            self.log('json', out)

            if out and type(out) is dict and self.format is not None:
                if type(self.format) is dict and all(map(lambda x: x[0] in out and (type(out[x[0]]) is x[1] if type(x[1]) is type else out[x[0]] in x[1]), self.format.items())):
                    self.log(f'check {self.format}', '✓')
                elif type(self.format) is set and all(i in out for i in self.format):
                    self.log(f'check {self.format}', '✓')
                else:
                    self.log(f'check {self.format}', '✗')
                    out = None
        else:
            if self.remove_think:
                regex = r"(^<think>[^<]*(?:<(?!/?think>)[^<]*)*<\/think>)"
                out = re.sub(regex, '', resp).strip()
                self.log('remove think', out)
            else:
                out = resp
        return out, text, resp

    async def _async_call(self, *inp):
        text = self.prompt(*inp)
        self.log('prompt', text)
        resp = await self.llm(text)
        self.log('resp', resp)
        if self.return_json:
            out = self._json(resp)
            self.log('json', out)

            if out and type(out) is dict and self.format is not None:
                if type(self.format) is dict and all(map(lambda x: x[0] in out and (type(out[x[0]]) is x[1] if type(x[1]) is type else out[x[0]] in x[1]), self.format.items())):
                    self.log(f'check {self.format}', '✓')
                elif type(self.format) is set and all(i in out for i in self.format):
                    self.log(f'check {self.format}', '✓')
                else:
                    self.log(f'check {self.format}', '✗')
                    out = None
        else:
            if self.remove_think:
                regex = r"(^<think>[^<]*(?:<(?!/?think>)[^<]*)*<\/think>)"
                out = re.sub(regex, '', resp).strip()
                self.log('remove think', out)
            else:
                out = resp
        return out, text, resp
    
    async def _async_second_call(self, history):
        if self.return_json:
            history.append('Make sure return answer in JSON format.')

            self.log('history', history)
            resp = await self.llm(history)
            self.log('resp', resp)

            out = self._json(resp)
            self.log('json', out)

            if out and type(out) is dict and self.format is not None:
                if type(self.format) is dict and all(map(lambda x: x[0] in out and type(out[x[0]]) is x[1], self.format.items())):
                    self.log(f'check {self.format}', '✓')
                elif type(self.format) is set and all(i in out for i in self.format):
                    self.log(f'check {self.format}', '✓')
                else:
                    self.log(f'check {self.format}', '✗')
                    out = None
            return out, history, resp

    def __str__(self):
        return f"<{self.__class__.__name__}: {self.name}, prompt: {self.prompt.name}, json: {self.return_json}>"

class RAGPipe(Pipe):
    def __init__(self, name, rag=None, verbose=True, return_key=None, lock=None, run_time=None, inout_log=None, **kargs):
        super().__init__(name, lock, run_time, inout_log, verbose)
        self.rag = rag
        self.return_key = return_key

    def _call(self, *inp):
        resp = self.rag(*inp)
        self.log('out', resp)
        if resp is not None and len(resp):
            if self.return_key:
                o = eval(f'resp{self.return_key}')
                self.log('return_key', o)
                out = o
            else:
                out = resp
        return out, inp, resp

    async def _async_call(self, *inp):
        resp = await self.rag(*inp)
        self.log('out', resp)
        if resp is not None and len(resp):
            if self.return_key:
                o = eval(f'resp{self.return_key}')
                self.log('return_key', o)
                out = o
            else:
                out = resp
        return out, inp, resp

class SearchPipe(Pipe):
    def __init__(self, name, search_engine='bing', count=5, verbose=True, lock=None, run_time=None, inout_log=None, **kargs):
        super().__init__(name, lock, run_time, inout_log, verbose)
        self.count = count
        if type(search_engine) is str:
            self.engine, self.async_engine = SearchEngine.get(search_engine)
        else:
            self.engine = self.async_engine = search_engine

    def _call(self, inp):
        resp = self.engine(inp, count=self.count)
        self.log('out', resp)
        return resp, inp, resp

    async def _async_call(self, inp):
        resp = await self.async_engine(inp, count=self.count)
        self.log('out', resp)
        return resp, inp, resp

class BrowserPipe(Pipe):
    def __init__(self, name, client=None, verbose=True, lock=None, run_time=None, inout_log=None, **kargs):
        super().__init__(name, lock, run_time, inout_log, verbose)
        self.client = client

    def _call(self, inp):
        resp = self.rag(inp)
        self.log('out', resp)
        return resp, inp, resp

    async def _async_call(self, inp):
        resp = await self.rag(inp)
        self.log('out', resp)
        return resp, inp, resp
