from enum import Enum
from dataclasses import dataclass
from pydantic import BaseModel, Field
from typing import Optional, Any, Union, Literal, Annotated, Dict
from datetime import datetime


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
    EXEC_ERROR = "execution_error"
    TRANS_TO_PIPELINE = "trans_to_pipeline"


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

class InterruptData(BaseModel):
    prompt_id: str

PData = Annotated[
    Union[PromptData, PipeData, PipelineData], Field(discriminator="type")
]


# ============================================================================
# Admin Tracing System Models
# ============================================================================

class SpanError(BaseModel):
    """Error information for a span"""
    message: str
    data: Optional[Dict[str, Any]] = None


class TracePayload(BaseModel):
    """Incoming trace event payload"""
    object: str = Field(default="trace")
    id: str
    workflow_name: str
    group_id: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


class SpanPayload(BaseModel):
    """Incoming span event payload"""
    object: str = Field(default="trace.span")
    id: str
    trace_id: str
    parent_id: Optional[str] = None
    started_at: Optional[str] = None
    ended_at: Optional[str] = None
    span_data: Dict[str, Any]
    error: Optional[SpanError] = None


class Trace(BaseModel):
    """Trace response model"""
    object: str = "trace"
    id: str
    workflow_name: str = Field(alias="workflowName")
    group_id: Optional[str] = Field(None, alias="groupId")
    metadata: Optional[Dict[str, Any]] = None
    created_at: Optional[str] = Field(None, alias="createdAt")
    updated_at: Optional[str] = Field(None, alias="updatedAt")
    spans: Optional[list] = None
    flow: Optional[list] = None
    handoffs_count: Optional[int] = Field(None, alias="handsoffsCount")
    tools_count: Optional[int] = Field(None, alias="toolsCount")
    execution_time: Optional[Any] = Field(None, alias="executionTime")

    class Config:
        from_attributes = True
        validate_by_name = True


class Span(BaseModel):
    """Span response model"""
    object: str = "trace.span"
    id: str
    trace_id: str
    parent_id: Optional[str] = None
    started_at: Optional[str] = None
    ended_at: Optional[str] = None
    span_data: Dict[str, Any]
    error: Optional[SpanError] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

    class Config:
        from_attributes = True


class EventRequest(BaseModel):
    """Request payload for event submission"""
    data: list[TracePayload | SpanPayload]


class SearchFilters(BaseModel):
    """Filters for trace search"""
    trace_id: Optional[str] = None
    group_id: Optional[str] = None
    workflow_name: Optional[str] = None
    metadata: Optional[Dict[str, str]] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    page: int = Field(default=1, ge=1)
    limit: int = Field(default=10, ge=1, le=100)
    sort: str = Field(default="-createdAt")


class Pagination(BaseModel):
    """Pagination metadata"""
    page: int
    limit: int
    total: int
    total_pages: int
    has_next: bool
    has_prev: bool


class TracesResponse(BaseModel):
    """Response for traces list"""
    data: list[Trace]
    pagination: Pagination
    query: Optional[Dict[str, Any]] = None


class TraceResponse(BaseModel):
    """Response for single trace"""
    data: Trace


class User(BaseModel):
    """User model"""
    id: Optional[str] = None
    email: str
    role: str  # ADMIN or READ_ONLY
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class SetupStatusResponse(BaseModel):
    """Response for setup status"""
    completed: bool


class SetupRequest(BaseModel):
    """Request for initial setup"""
    email: str
    password: str
    role: str = "ADMIN"


class SetupResponse(BaseModel):
    """Response for setup completion"""
    message: str
    token: str


class LoginRequest(BaseModel):
    """Request for login"""
    email: str
    password: str


class LoginResponse(BaseModel):
    """Response for login"""
    token: str


class CreateUserRequest(BaseModel):
    """Request to create new user"""
    email: str
    password: str
    role: str


class ApiKey(BaseModel):
    """API Key model"""
    id: Optional[str] = None
    name: str
    prefix: str
    suffix: str
    masked_key: Optional[str] = None
    created_by: Optional[Dict[str, str]] = None
    expires_at: Optional[str] = None
    last_used_at: Optional[str] = None
    is_active: bool = True
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class CreateApiKeyRequest(BaseModel):
    """Request to create API key"""
    name: str
    expires_in: str = Field(alias="expiresIn")  # 'never', '1_month', '3_months', '6_months', '12_months'

    class Config:
        validate_by_name = True


class CreateApiKeyResponse(BaseModel):
    """Response for API key creation"""
    id: str
    name: str
    key: str
    prefix: str
    suffix: str
    expires_at: Optional[str] = None
    created_at: str


class AnalyticsQuery(BaseModel):
    """Query parameters for analytics"""
    start_date: str
    end_date: str
    granularity: Optional[str] = "day"  # 'hour' or 'day'


class PreviousPeriod(BaseModel):
    """Previous period analytics data"""
    total_cost: float = Field(alias="totalCost")
    cost_change: float = Field(alias="costChange")

    class Config:
        validate_by_name = True


class AnalyticsOverview(BaseModel):
    """Analytics overview response"""
    total_input_tokens: int = Field(alias="totalInputTokens")
    total_output_tokens: int = Field(alias="totalOutputTokens")
    total_tokens: int = Field(alias="totalTokens")
    total_requests: int = Field(alias="totalRequests")
    total_traces: int = Field(alias="totalTraces")
    total_cost: float = Field(alias="totalCost")
    previous_period: PreviousPeriod = Field(alias="previousPeriod")

    class Config:
        validate_by_name = True


class TimeSeriesData(BaseModel):
    """Time series data point"""
    date: str
    input_tokens: int
    output_tokens: int
    requests: int
    traces: int
    cost: float
    gpt4: float
    gpt35: float
    claude: float
    gemini: float
    other: float


class ModelBreakdown(BaseModel):
    """Model usage breakdown"""
    model: str
    requests: int
    input_tokens: int
    output_tokens: int
    total_tokens: int
    cost: float


# ============================================================================
# Storage Models (In-Memory or SQLAlchemy ORM)
# ============================================================================

class StorageTrace:
    """Storage representation of Trace"""
    def __init__(self, object_type: str, id: str, workflow_name: str,
                 group_id: Optional[str] = None,
                 metadata: Optional[Dict[str, Any]] = None,
                 created_at: Optional[str] = None,
                 updated_at: Optional[str] = None):
        self.object = object_type
        self.id = id
        self.workflow_name = workflow_name
        self.group_id = group_id
        self.metadata = metadata or {}
        self.created_at = created_at or (datetime.utcnow().isoformat() + 'Z')
        self.updated_at = updated_at or (datetime.utcnow().isoformat() + 'Z')


class StorageSpan:
    """Storage representation of Span"""
    def __init__(self, object_type: str, id: str, trace_id: str,
                 parent_id: Optional[str] = None,
                 started_at: Optional[str] = None,
                 ended_at: Optional[str] = None,
                 span_data: Optional[Dict[str, Any]] = None,
                 error: Optional[SpanError] = None,
                 created_at: Optional[str] = None,
                 updated_at: Optional[str] = None):
        self.object = object_type
        self.id = id
        self.trace_id = trace_id
        self.parent_id = parent_id
        self.started_at = started_at
        self.ended_at = ended_at
        self.span_data = span_data or {}
        self.error = error
        self.created_at = created_at or (datetime.utcnow().isoformat() + 'Z')
        self.updated_at = updated_at or (datetime.utcnow().isoformat() + 'Z')


class StorageUser:
    """Storage representation of User"""
    def __init__(self, id: str, email: str, password_hash: str, role: str,
                 created_at: Optional[str] = None):
        self.id = id
        self.email = email
        self.password_hash = password_hash
        self.role = role
        self.created_at = created_at or (datetime.utcnow().isoformat() + 'Z')


class StorageApiKey:
    """Storage representation of API Key"""
    def __init__(self, id: str, name: str, key_hash: str, prefix: str,
                 suffix: str, created_by: str, expires_at: Optional[str] = None,
                 last_used_at: Optional[str] = None, is_active: bool = True,
                 created_at: Optional[str] = None):
        self.id = id
        self.name = name
        self.key_hash = key_hash
        self.prefix = prefix
        self.suffix = suffix
        self.created_by = created_by
        self.expires_at = expires_at
        self.last_used_at = last_used_at
        self.is_active = is_active
        self.created_at = created_at or (datetime.utcnow().isoformat() + 'Z')


# ============================================================================
# Model Pricing Models
# ============================================================================

class ModelPricing(BaseModel):
    """Model pricing configuration"""
    model_name: str
    input_price_per_1k: float
    output_price_per_1k: float
    provider: str
    category: str


class UpdateModelPricingRequest(BaseModel):
    """Request to update model pricing"""
    model_name: str
    input_price_per_1k: float
    output_price_per_1k: float
    provider: Optional[str] = None
    category: Optional[str] = None


class ModelPricingResponse(BaseModel):
    """Response with model pricing data"""
    models: list[ModelPricing]
    default_pricing: ModelPricing

