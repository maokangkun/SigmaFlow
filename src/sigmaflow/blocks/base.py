import time
from ..log import log
from ..utils import sync_compat


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

    @sync_compat
    async def __call__(self, *inp):
        n = 0
        while n < self.retry:
            start_t = time.time()
            self.log(
                "inp", [str(i)[:20] + " ..." if len(str(i)) > 20 else i for i in inp]
            )
            out, query, resp = await self._call(*inp)

            t = time.time() - start_t
            inout = {
                "id": self.name,
                "timestamp": time.time(),
                "input": query,
                "output": resp,
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
                out, query2, resp2 = await self._second_call([query, resp])

                t = time.time() - start_t
                inout = {
                    "id": self.name,
                    "timestamp": time.time(),
                    "input": query2,
                    "output": resp2,
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
            else:
                break
        return out
