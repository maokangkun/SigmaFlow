import asyncio
import random
import time
from datetime import datetime
from ..log import log
from ..utils import sync_compat

# 重试退避: 指数级(1s, 2s, 4s...)封顶 30s, 叠加 0~25% 抖动让并发节点别齐步。
# 模块级常量便于测试把间隔压到 0。
RETRY_BACKOFF_BASE = 1.0
RETRY_BACKOFF_CAP = 30.0


class Block:
    def __init__(
        self, name, lock, run_time, inout_log, verbose, retry=1, second_round=False
    ):
        self.name = name
        self.verbose = verbose
        self.retry = retry
        self.second_round = second_round
        self.log = (
            lambda n, t: log.debug(f"[{name}] {n}: {t}") if self.verbose else None
        )
        self.trace_log = []

        # multiprocess lock
        self.lock = lock
        self.run_time = run_time if run_time is not None else []
        self.inout_log = inout_log if inout_log is not None else []

    @property
    def time(self):
        if self.run_time:
            return sum(self.run_time) / len(self.run_time)
        return None

    def __str__(self):
        return f"<{self.__class__.__name__}: {self.name}>"

    def __repr__(self):
        return self.__str__()

    async def _call(self, *inp):
        pass

    def set_stream(self, cb):
        # LLM 块把 node 级流式转发挂到底层客户端; 非 LLM 块没有 llm, 忽略。
        llm = getattr(self, "llm", None)
        if llm is not None and hasattr(llm, "stream_cb"):
            llm.stream_cb = cb

    @staticmethod
    def _backoff_delay(n):
        delay = RETRY_BACKOFF_BASE * (2 ** (n - 1))
        delay = min(delay, RETRY_BACKOFF_CAP)
        if delay <= 0:
            return 0.0
        return delay * (1 + random.uniform(0, 0.25))

    async def _backoff(self, n):
        delay = self._backoff_delay(n)
        if delay <= 0:
            return
        self.log("backoff", f"{delay:.2f}s")
        await asyncio.sleep(delay)

    @sync_compat
    async def __call__(self, *inp):
        n = 0
        one_trace = []
        last_err = None
        out = None  # 所有尝试都抛错时循环内不会赋值, 先落 None 让收尾的归因分支可达
        while n < self.retry:
            start_t = time.time()
            self.log(
                "inp", [str(i)[:20] + " ..." if len(str(i)) > 20 else i for i in inp]
            )
            try:
                out, query, resp, usage = await self._call(*inp)
            except Exception as e:
                # 单次调用抛错(网关瞬时失败/推理截断)也计入重试, 而不是把整个
                # 节点直接判死;耗尽后按最后一次异常归档由上层记录。
                self.log("attempt error", str(e))
                last_err = e
                n += 1
                self.log("retry", n)
                await self._backoff(n)
                continue
            one_trace.append(
                {
                    "inps": inp,
                    "prompt": query,
                    "resp": resp,
                    "out": out,
                    "usage": usage,
                    "started_at": datetime.utcfromtimestamp(start_t).isoformat() + "Z",
                    "ended_at": datetime.utcnow().isoformat() + "Z",
                }
            )

            t = time.time() - start_t
            inout = {
                "id": self.name,
                "timestamp": time.time(),
                "input": query,
                "output": resp,
                "usage": usage,
            }
            self.log("cost time", t)
            if self.lock is not None:
                with self.lock:
                    self.run_time.append(t)
                    self.inout_log.append(inout)
            else:
                self.run_time.append(t)
                self.inout_log.append(inout)

            if out is None and self.second_round:
                start_t = time.time()
                out, query2, resp2, usage2 = await self._second_call([query, resp])
                one_trace.append(
                    {
                        "inps": inp,
                        "prompt": query2,
                        "resp": resp2,
                        "out": out,
                        "usage": usage2,
                        "started_at": datetime.utcfromtimestamp(start_t).isoformat()
                        + "Z",
                        "ended_at": datetime.utcnow().isoformat() + "Z",
                    }
                )

                t = time.time() - start_t
                inout = {
                    "id": self.name,
                    "timestamp": time.time(),
                    "input": query2,
                    "output": resp2,
                    "usage": usage2,
                }
                self.log("cost time", t)
                if self.lock is not None:
                    with self.lock:
                        self.run_time.append(t)
                        self.inout_log.append(inout)
                else:
                    self.run_time.append(t)
                    self.inout_log.append(inout)

            if out is None:
                n += 1
                self.log("retry", n)
                await self._backoff(n)
            else:
                break
        self.trace_log.append(one_trace)
        if out is None and last_err is not None:
            # 从未成功过: 把真实失败原因抛给任务级 error_msg, 附加重试次数上下文。
            raise RuntimeError(f"after {self.retry} attempts: {last_err}") from last_err
        return out
