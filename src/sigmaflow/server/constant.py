from enum import Enum
from dataclasses import dataclass
from pydantic import BaseModel, Field
from typing import Optional, Any, Union, Literal, Annotated


class Events(Enum):
    MSG = "msg"
    PREVIEW_IMAGE = "img"
    UNENCODED_PREVIEW_IMAGE = "unencoded_img"
    WS_CONNECTED = "ws_connected"
    TASK_START = "task_start"
    TASK_ITEM_START = "task_item_start"
    TASK_ITEM_PROCESS = "task_item_process"
    TASK_ITEM_DONE = "task_item_done"
    TASK_END = "task_end"
    ERROR = "error"


class Types(Enum):
    STATUS = "status"
    FEATURE_FLAG = "feature_flags"
    EXEC_START = "execution_start"
    EXEC_CACHE = "execution_cached"
    PROG_STATE = "progress_state"
    EXECUTING = "executing"
    PROGRESS = "progress"
    EXECUTED = "executed"
    EXEC_SUCCESS = "execution_success"


@dataclass
class Message:
    header: Events | Types
    data: Any
    sid: Optional[str] = None

    def dict(self):
        m = {
            "event" if self.header is Events else "type": self.header.value,
            "data": self.data,
        }
        if self.sid:
            m["sid"] = self.sid
        return m


class BinaryEventTypes:
    PREVIEW_IMAGE = 1
    UNENCODED_PREVIEW_IMAGE = 2


class TaskData(BaseModel):
    sid: str | None = None
    task: list


class PromptData(BaseModel):
    type: Literal["prompt"] = "prompt"
    name: str | None = None
    text: str | None = None
    keys: list | None = None


class PipeData(BaseModel):
    type: Literal["pipe"] = "pipe"
    name: str | None = None
    data: dict | None = None


class PipelineData(BaseModel):
    type: Literal["pipeline"] = "pipeline"
    stream: bool | None = False
    data: dict | list[dict]


class WorkspacePromptData(BaseModel):
    client_id: str | None = None
    extra_data: dict
    prompt: dict
    prompt_id: str | None = None


PData = Annotated[
    Union[PromptData, PipeData, PipelineData], Field(discriminator="type")
]
