import copy
import threading
from ..log import log

class TaskQueue:
    def __init__(self, loop=None, max_history_size=10000):
        self.loop = loop
        self.max_history_size = max_history_size
        self.mutex = threading.RLock()
        self.not_empty = threading.Condition(self.mutex)
        self.task_counter = 0
        self.queue = []
        self.currently_running = {}
        self.history = {}
        self.flags = {}

    def put(self, item):
        with self.mutex:
            heapq.heappush(self.queue, item)
            self.queue_updated_broadcast()
            self.not_empty.notify()

    def get(self, timeout=None):
        with self.not_empty:
            while len(self.queue) == 0:
                self.not_empty.wait(timeout=timeout)
                if timeout is not None and len(self.queue) == 0:
                    return None
            item = heapq.heappop(self.queue)
            task_id = self.task_counter
            self.currently_running[task_id] = copy.deepcopy(item)
            self.task_counter += 1
            self.queue_updated_broadcast()
            return task_id, item

    def task_done(self, task_id, history_result, status):
        with self.mutex:
            prompt = self.currently_running.pop(task_id)
            if len(self.history) > self.max_history_size:
                self.history.pop(next(iter(self.history)))

            self.history[prompt[1]] = {
                "prompt": prompt,
                'status': status,
            } | history_result
            self.queue_updated_broadcast()

    def queue_updated_broadcast(self):
        event = "status"
        data = {"status": self.get_queue_info()}
        self.loop.call_soon_threadsafe(ws_msges.put_nowait, (event, data, None))

    def get_queue_info(self):
        prompt_info = {
            'exec_info': {
                'queue_remaining': self.get_tasks_remaining()
            }
        }
        return prompt_info

    def get_current_queue(self):
        with self.mutex:
            out = []
            for x in self.currently_running.values():
                out += [x]
            return (out, copy.deepcopy(self.queue))

    def get_tasks_remaining(self):
        with self.mutex:
            return len(self.queue) + len(self.currently_running)

    def wipe_queue(self):
        with self.mutex:
            self.queue = []
            self.server.queue_updated()

    def delete_queue_item(self, function):
        with self.mutex:
            for x in range(len(self.queue)):
                if function(self.queue[x]):
                    if len(self.queue) == 1:
                        self.wipe_queue()
                    else:
                        self.queue.pop(x)
                        heapq.heapify(self.queue)
                    self.server.queue_updated()
                    return True
        return False

    def get_history(self, prompt_id=None, max_items=None, offset=-1):
        with self.mutex:
            if prompt_id is None:
                out = {}
                i = 0
                if offset < 0 and max_items is not None:
                    offset = len(self.history) - max_items
                for k in self.history:
                    if i >= offset:
                        out[k] = self.history[k]
                        if max_items is not None and len(out) >= max_items:
                            break
                    i += 1
                return out
            elif prompt_id in self.history:
                return {prompt_id: copy.deepcopy(self.history[prompt_id])}
            else:
                return {}

    def wipe_history(self):
        with self.mutex:
            self.history = {}

    def delete_history_item(self, id_to_delete):
        with self.mutex:
            self.history.pop(id_to_delete, None)

    def set_flag(self, name, data):
        with self.mutex:
            self.flags[name] = data
            self.not_empty.notify()

    def get_flags(self, reset=True):
        with self.mutex:
            if reset:
                ret = self.flags
                self.flags = {}
                return ret
            else:
                return self.flags.copy()

class TaskWorker(threading.Thread):
    def __init__(self, queue=None, loop=None):
        name = self.__class__.__name__
        threading.Thread.__init__(self, name=name, daemon=True)
        self.queue = queue
        self.loop = loop
        log.debug(f'{name} thread start')

    def run(self):
        name = threading.current_thread().name

        while True:
            queue_item = self.queue.get(timeout=1000)
            if queue_item is not None:
                task_id, (_, prompt_id, task_data, extra_data) = queue_item
                log.debug(f'{name}:\ntask_id: {task_id}\nprompt_id: {prompt_id}\ntask_data: {task_data}\nextra_data: {extra_data}')

                out = self.run_task(prompt_id, task_data, extra_data)
                his = {
                    "outputs": {
                        out['node']: out['output'],
                    },
                    "meta": {},
                }

                self.queue.task_done(
                    task_id,
                    his,
                    status={
                        "status_str": 'success',
                        "completed": True,
                        "messages": None,
                    }
                )

                self.send_msg("executing", {"node": None, "prompt_id": prompt_id}, extra_data['client_id'])

    def run_task(self, prompt_id, task_data, extra_data):
        ws_id = extra_data.get('client_id', None)
        self.send_msg("execution_start", {"prompt_id": prompt_id}, ws_id)
        self.send_msg("execution_cached", {"nodes":[], "prompt_id": prompt_id}, ws_id)

        out = None
        if PipelineServer.api:
            pipe = PipelineServer.api.pipeline_manager.add_pipe('comfyUI', is_seq=True)
            out = pipe.run(prompt_id, ws_id, task_data, self.send_msg)

        return out

    def send_msg(self, event, data, ws_id=None):
        data |= {"timestamp": int(time.time() * 1000)}
        self.loop.call_soon_threadsafe(ws_msges.put_nowait, (event, data, ws_id))

