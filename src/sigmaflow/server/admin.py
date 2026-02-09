import uuid
import asyncio
import traceback
from typing import Optional, Dict, List
from datetime import datetime, timedelta
from pydantic import ValidationError
from fastapi import APIRouter, HTTPException, Header

from .constant import (
    EventRequest, SearchFilters, TracesResponse, TraceResponse, Pagination,
    Trace, Span, User, SetupStatusResponse, SetupRequest, SetupResponse,
    LoginRequest, LoginResponse, CreateUserRequest, CreateApiKeyRequest,
    CreateApiKeyResponse, ApiKey, AnalyticsQuery, AnalyticsOverview,
    TimeSeriesData, ModelBreakdown, SpanError, ModelPricing,
    UpdateModelPricingRequest, ModelPricingResponse
)
from .admin_auth import (
    hash_password, compare_password, generate_jwt, verify_jwt, 
    generate_api_key, hash_api_key
)
from .admin_storage import get_admin_storage
from ..log import log

class AdminAPI:
    def __init__(self, pipeline_manager=None, storage_dir=None):
        """Initialize AdminAPI with optional pipeline manager and storage directory"""
        self.router = router = APIRouter(prefix="/admin/api")
        self.storage = get_admin_storage(storage_dir=storage_dir)
        self.pipeline_manager = pipeline_manager

        # ====================================================================
        # AUTH Endpoints
        # ====================================================================

        @router.get("/auth/setup-status", response_model=SetupStatusResponse)
        async def get_setup_status():
            """Check if initial setup is completed"""
            try:
                completed = self.storage.count_users() > 0
                return SetupStatusResponse(completed=completed)
            except Exception as e:
                raise HTTPException(status_code=500, detail=str(e))

        @router.post("/auth/setup", response_model=SetupResponse)
        async def setup(request: SetupRequest):
            """Initial setup - create first admin user"""
            try:
                if self.storage.count_users() > 0:
                    raise HTTPException(status_code=403, detail="Setup already completed")
                
                # Hash password and create user
                password_hash = hash_password(request.password)
                user_id = str(uuid.uuid4())
                self.storage.save_user(user_id, request.email, password_hash, request.role)
                
                # Generate JWT token
                token = generate_jwt({"id": user_id, "role": request.role})
                return SetupResponse(message="Setup completed successfully", token=token)
            except ValidationError as e:
                raise HTTPException(status_code=400, detail=str(e))
            except Exception as e:
                raise HTTPException(status_code=500, detail=str(e))

        @router.post("/auth/login", response_model=LoginResponse)
        async def login(request: LoginRequest):
            """User login"""
            try:
                user = self.storage.get_user_by_email(request.email)
                if not user or not compare_password(request.password, user.password_hash):
                    raise HTTPException(status_code=401, detail="Invalid credentials")
                
                token = generate_jwt({"id": user.id, "role": user.role})
                return LoginResponse(token=token)
            except HTTPException:
                raise
            except Exception as e:
                raise HTTPException(status_code=500, detail=str(e))

        @router.post("/create-user", response_model=User)
        async def create_user(request: CreateUserRequest, authorization: Optional[str] = Header(None)):
            """Create new user (admin only)"""
            try:
                # Verify JWT token
                if not authorization or not authorization.startswith("Bearer "):
                    raise HTTPException(status_code=401, detail="No token provided")
                
                jwt_payload = verify_jwt(authorization[7:])
                if jwt_payload.role != "ADMIN":
                    raise HTTPException(status_code=403, detail="Unauthorized")
                
                # Check if user already exists
                existing = self.storage.get_user_by_email(request.email)
                if existing:
                    raise HTTPException(status_code=409, detail="User already exists")
                
                # Create new user
                password_hash = hash_password(request.password)
                user_id = str(uuid.uuid4())
                user = self.storage.save_user(user_id, request.email, password_hash, request.role)
                
                return User(id=user.id, email=user.email, role=user.role, created_at=user.created_at)
            except HTTPException:
                raise
            except Exception as e:
                raise HTTPException(status_code=500, detail=str(e))

        # ====================================================================
        # TRACES Endpoints
        # ====================================================================
        log.debug("Setup Sigmaflow Tracing API: /traces/event")
        @router.post("/traces/event")
        async def submit_events(request: EventRequest, authorization: Optional[str] = Header(None)):
            """Submit trace and span events"""
            try:
                # Verify API key
                if not authorization or not authorization.startswith("Bearer "):
                    raise HTTPException(status_code=401, detail="No API key provided")
                
                api_key = authorization[7:]
                if not api_key.startswith("ak_"):
                    raise HTTPException(status_code=401, detail="Invalid API key format")
                
                # Find valid API key
                stored_key = self.storage.find_api_key_by_key(api_key)
                if not stored_key:
                    raise HTTPException(status_code=401, detail="Invalid API key")
                
                # Check expiration
                if stored_key.expires_at:
                    expires_at = datetime.fromisoformat(stored_key.expires_at)
                    if expires_at < datetime.utcnow():
                        raise HTTPException(status_code=401, detail="API key expired")
                
                # Update last used
                self.storage.update_api_key_usage(stored_key.id)
                
                # Process events
                trace_count = 0
                span_count = 0
                
                for event in request.data:
                    if event.object == "trace":
                        self.storage.save_trace(
                            event.id, event.workflow_name, event.group_id, event.metadata
                        )
                        trace_count += 1
                    elif event.object == "trace.span":
                        self.storage.save_span(
                            event.id, event.trace_id, event.parent_id,
                            event.started_at, event.ended_at, event.span_data, event.error
                        )
                        span_count += 1
                
                return {
                    "success": True,
                    "traces": trace_count,
                    "spans": span_count
                }
            except HTTPException:
                raise
            except ValidationError as e:
                raise HTTPException(status_code=400, detail=str(e))
            except Exception as e:
                raise HTTPException(status_code=500, detail=str(e))

        @router.get("/traces", response_model=TracesResponse)
        async def list_traces(
            trace_id: Optional[str] = None,
            group_id: Optional[str] = None,
            workflow_name: Optional[str] = None,
            start_date: Optional[str] = None,
            end_date: Optional[str] = None,
            page: int = 1,
            limit: int = 10,
            sort: str = "-createdAt",
            authorization: Optional[str] = Header(None)
        ):
            """List traces with filtering and pagination"""
            try:
                # Verify JWT token
                if not authorization or not authorization.startswith("Bearer "):
                    raise HTTPException(status_code=401, detail="No token provided")
                
                verify_jwt(authorization[7:])
                
                # Build filters
                filters = {}
                if trace_id:
                    filters["trace_id"] = trace_id
                if group_id:
                    filters["group_id"] = group_id
                if workflow_name:
                    filters["workflow_name"] = workflow_name
                if start_date:
                    filters["start_date"] = start_date
                if end_date:
                    filters["end_date"] = end_date
                
                # Parse sort
                sort_field = sort.lstrip("-")
                sort_order = -1 if sort.startswith("-") else 1
                
                # Convert camelCase to snake_case for storage layer
                if sort_field == "createdAt":
                    sort_field = "created_at"
                elif sort_field == "workflowName":
                    sort_field = "workflow_name"
                
                # Get traces
                skip = (page - 1) * limit
                traces_list, total = self.storage.find_traces(
                    filters, skip=skip, limit=limit,
                    sort_field=sort_field, sort_order=sort_order
                )
                
                # Convert to response models and enrich with spans
                traces_data = []
                for trace in traces_list:
                    trace_dict = {
                        "object": trace.object,
                        "id": trace.id,
                        "workflow_name": trace.workflow_name,
                        "group_id": trace.group_id,
                        "metadata": trace.metadata,
                        "created_at": trace.created_at,
                        "updated_at": trace.updated_at,
                        "handoffs_count": 0,
                        "tools_count": 0,
                        "execution_time": 0
                    }
                    
                    # Get spans for this trace
                    spans = self.storage.get_spans_by_trace(trace.id)
                    if spans:
                        trace_dict["spans"] = [
                            {
                                "object": s.object,
                                "id": s.id,
                                "trace_id": s.trace_id,
                                "parent_id": s.parent_id,
                                "started_at": s.started_at,
                                "ended_at": s.ended_at,
                                "span_data": s.span_data,
                                "error": s.error.dict() if s.error else None,
                            }
                            for s in spans
                        ]
                        
                        # Calculate metrics
                        agent_spans = [s for s in spans if s.span_data.get("type") not in ["generation", "handoff", "function"]]
                        trace_dict["flow"] = [s.span_data.get("name", "Unknown") for s in agent_spans]
                        
                        handoff_spans = [s for s in spans if s.span_data.get("type") == "handoff"]
                        trace_dict["handoffs_count"] = len(handoff_spans)
                        
                        tool_spans = [s for s in spans if s.span_data.get("type") == "tool"]
                        trace_dict["tools_count"] = len(tool_spans)
                        
                        # Calculate execution time in seconds
                        if spans:
                            started = min((s.started_at for s in spans if s.started_at), default=None)
                            ended = max((s.ended_at for s in spans if s.ended_at), default=None)
                            if started and ended:
                                start_dt = datetime.fromisoformat(started)
                                end_dt = datetime.fromisoformat(ended)
                                trace_dict["execution_time"] = (end_dt - start_dt).total_seconds()
                    
                    traces_data.append(Trace(**trace_dict))
                
                # Pagination
                total_pages = (total + limit - 1) // limit
                pagination = Pagination(
                    page=page,
                    limit=limit,
                    total=total,
                    total_pages=total_pages,
                    has_next=page < total_pages,
                    has_prev=page > 1
                )
                
                return TracesResponse(
                    data=traces_data,
                    pagination=pagination,
                    query=filters if filters else None
                )
            except HTTPException:
                raise
            except Exception as e:
                raise HTTPException(status_code=500, detail=str(e))

        @router.delete("/traces/{trace_id}")
        async def delete_trace(trace_id: str, authorization: Optional[str] = Header(None)):
            """Delete a trace and its associated spans"""
            try:
                # Verify JWT token
                if not authorization or not authorization.startswith("Bearer "):
                    raise HTTPException(status_code=401, detail="No token provided")
                
                verify_jwt(authorization[7:])
                
                success = self.storage.delete_trace(trace_id)
                if not success:
                    raise HTTPException(status_code=404, detail="Trace not found")
                
                return {"message": "Trace deleted successfully"}
            except HTTPException:
                raise
            except Exception as e:
                raise HTTPException(status_code=500, detail=str(e))
        
        @router.get("/traces/{trace_id}", response_model=TraceResponse)
        async def get_trace(trace_id: str, authorization: Optional[str] = Header(None)):
            """Get single trace by ID"""
            try:
                # Verify JWT token
                if not authorization or not authorization.startswith("Bearer "):
                    raise HTTPException(status_code=401, detail="No token provided")
                
                verify_jwt(authorization[7:])
                
                trace = self.storage.get_trace(trace_id)
                if not trace:
                    raise HTTPException(status_code=404, detail="Trace not found")
                
                # Build response with spans
                trace_dict = {
                    "object": trace.object,
                    "id": trace.id,
                    "workflow_name": trace.workflow_name,
                    "group_id": trace.group_id,
                    "metadata": trace.metadata,
                    "created_at": trace.created_at,
                    "updated_at": trace.updated_at,
                    "handoffs_count": 0,
                    "tools_count": 0,
                    "execution_time": 0
                }
                
                spans = self.storage.get_spans_by_trace(trace_id)
                if spans:
                    trace_dict["spans"] = [
                        {
                            "object": s.object,
                            "id": s.id,
                            "trace_id": s.trace_id,
                            "parent_id": s.parent_id,
                            "started_at": s.started_at,
                            "ended_at": s.ended_at,
                            "span_data": s.span_data,
                            "error": s.error.dict() if s.error else None,
                        }
                        for s in spans
                    ]
                
                return TraceResponse(data=Trace(**trace_dict))
            except HTTPException:
                raise
            except Exception as e:
                raise HTTPException(status_code=500, detail=str(e))

        # ====================================================================
        # API KEYS Endpoints
        # ====================================================================

        @router.post("/api-keys", response_model=CreateApiKeyResponse)
        async def create_api_key(
            request: CreateApiKeyRequest,
            authorization: Optional[str] = Header(None)
        ):
            """Create a new API key"""
            try:
                # Verify JWT token and check admin role
                if not authorization or not authorization.startswith("Bearer "):
                    raise HTTPException(status_code=401, detail="No token provided")
                
                jwt_payload = verify_jwt(authorization[7:])
                if jwt_payload.role != "ADMIN":
                    raise HTTPException(status_code=403, detail="Unauthorized")
                
                # Generate API key
                key, prefix, suffix = generate_api_key()
                key_hash = hash_api_key(key)
                
                # Calculate expiry date
                from .admin_auth import parse_expiry
                if request.expires_in == "never":
                    expires_at = None
                else:
                    expire_delta = parse_expiry(request.expires_in)
                    expires_at = (datetime.utcnow() + expire_delta).isoformat()
                
                # Save API key
                stored_key = self.storage.save_api_key(
                    request.name, key_hash, prefix, suffix,
                    jwt_payload.id, expires_at
                )
                
                return CreateApiKeyResponse(
                    id=stored_key.id,
                    name=stored_key.name,
                    key=key,
                    prefix=stored_key.prefix,
                    suffix=stored_key.suffix,
                    expires_at=stored_key.expires_at,
                    created_at=stored_key.created_at
                )
            except HTTPException:
                raise
            except Exception as e:
                raise HTTPException(status_code=500, detail=str(e))

        @router.get("/api-keys")
        async def list_api_keys(authorization: Optional[str] = Header(None)):
            """List all active API keys"""
            try:
                # Verify JWT token
                if not authorization or not authorization.startswith("Bearer "):
                    raise HTTPException(status_code=401, detail="No token provided")
                
                jwt_payload = verify_jwt(authorization[7:])
                if jwt_payload.role != "ADMIN":
                    raise HTTPException(status_code=403, detail="Unauthorized")
                
                # Get API keys
                api_keys = self.storage.get_active_api_keys()
                
                masked_keys = []
                for key in api_keys:
                    masked_keys.append({
                        "id": key.id,
                        "name": key.name,
                        "maskedKey": f"{key.prefix}...{key.suffix}",
                        "prefix": key.prefix,
                        "suffix": key.suffix,
                        "createdBy": {"email": self.storage.get_user_by_id(key.created_by).email},
                        "expiresAt": key.expires_at,
                        "lastUsedAt": key.last_used_at,
                        "createdAt": key.created_at,
                        "updatedAt": key.created_at,
                    })
                
                return {"data": masked_keys}
            except HTTPException:
                raise
            except Exception as e:
                raise HTTPException(status_code=500, detail=str(e))

        @router.get("/api-keys/{key_id}")
        async def get_api_key(key_id: str, authorization: Optional[str] = Header(None)):
            """Get single API key"""
            try:
                # Verify JWT token
                if not authorization or not authorization.startswith("Bearer "):
                    raise HTTPException(status_code=401, detail="No token provided")
                
                jwt_payload = verify_jwt(authorization[7:])
                if jwt_payload.role != "ADMIN":
                    raise HTTPException(status_code=403, detail="Unauthorized")
                
                key = self.storage.get_api_key(key_id)
                if not key:
                    raise HTTPException(status_code=404, detail="API key not found")
                
                return {
                    "id": key.id,
                    "name": key.name,
                    "prefix": key.prefix,
                    "suffix": key.suffix,
                    "masked_key": f"{key.prefix}...{key.suffix}",
                    "created_by": {"email": self.storage.get_user_by_id(key.created_by).email},
                    "expires_at": key.expires_at,
                    "last_used_at": key.last_used_at,
                    "is_active": key.is_active,
                    "created_at": key.created_at,
                    "updated_at": key.created_at
                }
            except HTTPException:
                raise
            except Exception as e:
                raise HTTPException(status_code=500, detail=str(e))

        # ====================================================================
        # MODEL PRICING Endpoints
        # ====================================================================

        @router.get("/model-prices", response_model=ModelPricingResponse)
        async def get_model_prices(authorization: Optional[str] = Header(None)):
            """Get all model pricing configurations"""
            try:
                # Verify JWT token
                if not authorization or not authorization.startswith("Bearer "):
                    raise HTTPException(status_code=401, detail="No token provided")
                
                verify_jwt(authorization[7:])
                
                # Load pricing data
                pricing_data = self.storage.load_model_pricing()
                
                # Convert to response format
                models = []
                for model_name, pricing in pricing_data.get("models", {}).items():
                    models.append(ModelPricing(
                        model_name=model_name,
                        input_price_per_1k=pricing.get("input_price_per_1k", 0.001),
                        output_price_per_1k=pricing.get("output_price_per_1k", 0.002),
                        provider=pricing.get("provider", "Unknown"),
                        category=pricing.get("category", "other")
                    ))
                
                # Get default pricing
                default = pricing_data.get("default_pricing", {
                    "input_price_per_1k": 0.001,
                    "output_price_per_1k": 0.002,
                    "provider": "Unknown",
                    "category": "other"
                })
                
                default_pricing = ModelPricing(
                    model_name="default",
                    input_price_per_1k=default.get("input_price_per_1k", 0.001),
                    output_price_per_1k=default.get("output_price_per_1k", 0.002),
                    provider=default.get("provider", "Unknown"),
                    category=default.get("category", "other")
                )
                
                return ModelPricingResponse(
                    models=models,
                    default_pricing=default_pricing
                )
            except HTTPException:
                raise
            except Exception as e:
                raise HTTPException(status_code=500, detail=str(e))

        @router.put("/model-prices/{model_name}")
        async def update_model_price(
            model_name: str,
            request: UpdateModelPricingRequest,
            authorization: Optional[str] = Header(None)
        ):
            """Update or create pricing for a specific model"""
            try:
                # Verify JWT token and check admin role
                if not authorization or not authorization.startswith("Bearer "):
                    raise HTTPException(status_code=401, detail="No token provided")
                
                jwt_payload = verify_jwt(authorization[7:])
                if jwt_payload.role != "ADMIN":
                    raise HTTPException(status_code=403, detail="Admin access required")
                
                # Update model pricing
                success = self.storage.update_model_price(
                    model_name=model_name,
                    input_price=request.input_price_per_1k,
                    output_price=request.output_price_per_1k,
                    provider=request.provider,
                    category=request.category
                )
                
                if not success:
                    raise HTTPException(status_code=500, detail="Failed to update model pricing")
                
                return {
                    "success": True,
                    "message": f"Updated pricing for {model_name}"
                }
            except HTTPException:
                raise
            except Exception as e:
                raise HTTPException(status_code=500, detail=str(e))

        @router.post("/model-prices")
        async def create_model_price(
            request: UpdateModelPricingRequest,
            authorization: Optional[str] = Header(None)
        ):
            """Create pricing for a new model"""
            try:
                # Verify JWT token and check admin role
                if not authorization or not authorization.startswith("Bearer "):
                    raise HTTPException(status_code=401, detail="No token provided")
                
                jwt_payload = verify_jwt(authorization[7:])
                if jwt_payload.role != "ADMIN":
                    raise HTTPException(status_code=403, detail="Admin access required")
                
                # Create model pricing
                success = self.storage.update_model_price(
                    model_name=request.model_name,
                    input_price=request.input_price_per_1k,
                    output_price=request.output_price_per_1k,
                    provider=request.provider or "Unknown",
                    category=request.category or "other"
                )
                
                if not success:
                    raise HTTPException(status_code=500, detail="Failed to create model pricing")
                
                return {
                    "success": True,
                    "message": f"Created pricing for {request.model_name}"
                }
            except HTTPException:
                raise
            except Exception as e:
                raise HTTPException(status_code=500, detail=str(e))

        @router.delete("/model-prices/{model_name}")
        async def delete_model_price(
            model_name: str,
            authorization: Optional[str] = Header(None)
        ):
            """Delete pricing for a specific model"""
            try:
                # Verify JWT token and check admin role
                if not authorization or not authorization.startswith("Bearer "):
                    raise HTTPException(status_code=401, detail="No token provided")
                
                jwt_payload = verify_jwt(authorization[7:])
                if jwt_payload.role != "ADMIN":
                    raise HTTPException(status_code=403, detail="Admin access required")
                
                # Load pricing data
                pricing_data = self.storage.load_model_pricing()
                
                # Remove model if exists
                if model_name in pricing_data.get("models", {}):
                    del pricing_data["models"][model_name]
                    success = self.storage.save_model_pricing(pricing_data)
                    
                    if not success:
                        raise HTTPException(status_code=500, detail="Failed to delete model pricing")
                    
                    return {
                        "success": True,
                        "message": f"Deleted pricing for {model_name}"
                    }
                else:
                    raise HTTPException(status_code=404, detail="Model not found")
            except HTTPException:
                raise
            except Exception as e:
                raise HTTPException(status_code=500, detail=str(e))

        @router.delete("/api-keys/{key_id}")
        async def delete_api_key(key_id: str, authorization: Optional[str] = Header(None)):
            """Delete an API key"""
            try:
                # Verify JWT token
                if not authorization or not authorization.startswith("Bearer "):
                    raise HTTPException(status_code=401, detail="No token provided")
                
                jwt_payload = verify_jwt(authorization[7:])
                if jwt_payload.role != "ADMIN":
                    raise HTTPException(status_code=403, detail="Unauthorized")
                
                key = self.storage.deactivate_api_key(key_id)
                if not key:
                    raise HTTPException(status_code=404, detail="API key not found")
                
                return {"success": True, "message": "API key deleted"}
            except HTTPException:
                raise
            except Exception as e:
                raise HTTPException(status_code=500, detail=str(e))

        # ====================================================================
        # ANALYTICS Endpoints
        # ====================================================================

        @router.get("/analytics/overview", response_model=AnalyticsOverview)
        async def get_analytics_overview(
            start_date: str,
            end_date: str,
            authorization: Optional[str] = Header(None)
        ):
            """Get analytics overview for date range"""
            try:
                # Verify JWT token
                if not authorization or not authorization.startswith("Bearer "):
                    raise HTTPException(status_code=401, detail="No token provided")
                
                verify_jwt(authorization[7:])
                
                # Parse dates and convert to naive UTC (remove timezone info)
                start_dt = datetime.fromisoformat(start_date.replace('Z', '+00:00'))
                end_dt = datetime.fromisoformat(end_date.replace('Z', '+00:00'))
                # Convert to naive UTC for comparison with stored times
                if start_dt.tzinfo is not None:
                    start_dt = start_dt.replace(tzinfo=None)
                if end_dt.tzinfo is not None:
                    end_dt = end_dt.replace(tzinfo=None)
                
                # Find relevant spans
                all_spans = list(self.storage.spans.values())
                period_spans = [
                    s for s in all_spans
                    if s.created_at and start_dt <= datetime.fromisoformat(s.created_at.replace('Z', '+00:00')).replace(tzinfo=None) <= end_dt
                    and s.span_data.get("type") == "generation"
                ]
                
                # Calculate metrics
                total_input_tokens = sum(
                    s.span_data.get("usage", {}).get("input_tokens", 0)
                    for s in period_spans
                )
                total_output_tokens = sum(
                    s.span_data.get("usage", {}).get("output_tokens", 0)
                    for s in period_spans
                )
                
                # Cost calculation using actual model pricing
                total_cost = 0.0
                for span in period_spans:
                    model = span.span_data.get("model", "unknown")
                    usage = span.span_data.get("usage", {})
                    input_tokens = usage.get("input_tokens", 0)
                    output_tokens = usage.get("output_tokens", 0)
                    total_cost += self.storage.get_model_cost(model, input_tokens, output_tokens)
                
                # Count traces
                traces = [
                    t for t in self.storage.traces.values()
                    if t.created_at and start_dt <= datetime.fromisoformat(t.created_at.replace('Z', '+00:00')).replace(tzinfo=None) <= end_dt
                ]
                
                return AnalyticsOverview(
                    total_input_tokens=total_input_tokens,
                    total_output_tokens=total_output_tokens,
                    total_tokens=total_input_tokens + total_output_tokens,
                    total_requests=len(period_spans),
                    total_traces=len(traces),
                    total_cost=total_cost,
                    previous_period={
                        "total_cost": 0,
                        "cost_change": 0
                    }
                )
            except HTTPException:
                raise
            except Exception as e:
                raise HTTPException(status_code=500, detail=str(e))

        @router.get("/analytics/time-series")
        async def get_analytics_timeseries(
            start_date: str,
            end_date: str,
            granularity: str = "day",
            authorization: Optional[str] = Header(None)
        ):
            """Get time series analytics data"""
            try:
                # Verify JWT token
                if not authorization or not authorization.startswith("Bearer "):
                    raise HTTPException(status_code=401, detail="No token provided")
                
                verify_jwt(authorization[7:])
                
                # Parse dates and convert to naive UTC
                start_dt = datetime.fromisoformat(start_date.replace('Z', '+00:00'))
                end_dt = datetime.fromisoformat(end_date.replace('Z', '+00:00'))
                if start_dt.tzinfo is not None:
                    start_dt = start_dt.replace(tzinfo=None)
                if end_dt.tzinfo is not None:
                    end_dt = end_dt.replace(tzinfo=None)
                
                # Get all generation spans in range
                all_spans = list(self.storage.spans.values())
                period_spans = [
                    s for s in all_spans
                    if s.created_at and start_dt <= datetime.fromisoformat(s.created_at.replace('Z', '+00:00')).replace(tzinfo=None) <= end_dt
                    and s.span_data.get("type") == "generation"
                ]
                
                # Determine time bucket size
                if granularity == "hour":
                    delta = timedelta(hours=1)
                elif granularity == "week":
                    delta = timedelta(weeks=1)
                elif granularity == "month":
                    delta = timedelta(days=30)
                else:  # day
                    delta = timedelta(days=1)
                
                # Normalize start time based on granularity for bucket alignment
                if granularity == "day":
                    # Align to midnight (00:00:00)
                    bucket_start = start_dt.replace(hour=0, minute=0, second=0, microsecond=0)
                elif granularity == "hour":
                    # Align to the start of the hour
                    bucket_start = start_dt.replace(minute=0, second=0, microsecond=0)
                elif granularity == "week":
                    # Align to Monday (weekday 0)
                    bucket_start = start_dt.replace(hour=0, minute=0, second=0, microsecond=0)
                    bucket_start -= timedelta(days=bucket_start.weekday())
                else:  # month
                    # Align to the 1st of the month
                    bucket_start = start_dt.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
                
                # Create time buckets aligned to boundaries
                buckets: Dict[str, Dict] = {}
                current = bucket_start
                while current <= end_dt:
                    bucket_key = current.isoformat()
                    buckets[bucket_key] = {
                        "date": bucket_key,
                        "inputTokens": 0,
                        "outputTokens": 0,
                        "requests": 0,
                        "traces": 0,
                        "cost": 0,
                        "openai": 0,
                        "claude": 0,
                        "gemini": 0,
                        "qwen": 0,
                        "deepseek": 0,
                        "other": 0
                    }
                    current += delta
                
                # Aggregate spans into buckets
                for span in period_spans:
                    span_dt = datetime.fromisoformat(span.created_at.replace('Z', '+00:00')).replace(tzinfo=None)
                    # Find the bucket this span belongs to
                    for bucket_key in sorted(buckets.keys()):
                        bucket_dt = datetime.fromisoformat(bucket_key)
                        if bucket_dt <= span_dt < bucket_dt + delta:
                            usage = span.span_data.get("usage", {})
                            model = span.span_data.get("model", "unknown")
                            input_tokens = usage.get("input_tokens", 0)
                            output_tokens = usage.get("output_tokens", 0)
                            
                            buckets[bucket_key]["inputTokens"] += input_tokens
                            buckets[bucket_key]["outputTokens"] += output_tokens
                            buckets[bucket_key]["requests"] += 1
                            # Use actual model pricing for cost calculation
                            buckets[bucket_key]["cost"] += self.storage.get_model_cost(model, input_tokens, output_tokens)
                            
                            # Group by model category
                            model_lower = model.lower()
                            if "gpt" in model_lower or "openai" in model_lower:
                                buckets[bucket_key]["openai"] += input_tokens + output_tokens
                            elif "claude" in model_lower:
                                buckets[bucket_key]["claude"] += input_tokens + output_tokens
                            elif "gemini" in model_lower or "google" in model_lower:
                                buckets[bucket_key]["gemini"] += input_tokens + output_tokens
                            elif "qwen" in model_lower:
                                buckets[bucket_key]["qwen"] += input_tokens + output_tokens
                            elif "deepseek" in model_lower:
                                buckets[bucket_key]["deepseek"] += input_tokens + output_tokens
                            else:
                                buckets[bucket_key]["other"] += input_tokens + output_tokens
                            break
                
                # Count traces per day
                for trace in self.storage.traces.values():
                    if trace.created_at and start_dt <= datetime.fromisoformat(trace.created_at.replace('Z', '+00:00')).replace(tzinfo=None) <= end_dt:
                        trace_dt = datetime.fromisoformat(trace.created_at.replace('Z', '+00:00')).replace(tzinfo=None)
                        for bucket_key in sorted(buckets.keys()):
                            bucket_dt = datetime.fromisoformat(bucket_key)
                            if bucket_dt <= trace_dt < bucket_dt + delta:
                                buckets[bucket_key]["traces"] = buckets[bucket_key].get("traces", 0) + 1
                                break
                
                return {"data": list(buckets.values())}
            except HTTPException:
                raise
            except Exception as e:
                raise HTTPException(status_code=500, detail=str(e))

        @router.get("/analytics/models")
        async def get_analytics_models(
            start_date: str, 
            end_date: str,
            authorization: Optional[str] = Header(None)
        ):
            """Get model breakdown"""
            try:
                # Verify JWT token
                if not authorization or not authorization.startswith("Bearer "):
                    raise HTTPException(status_code=401, detail="No token provided")
                
                verify_jwt(authorization[7:])
                
                # Parse dates and convert to naive UTC
                start_dt = datetime.fromisoformat(start_date.replace('Z', '+00:00'))
                end_dt = datetime.fromisoformat(end_date.replace('Z', '+00:00'))
                if start_dt.tzinfo is not None:
                    start_dt = start_dt.replace(tzinfo=None)
                if end_dt.tzinfo is not None:
                    end_dt = end_dt.replace(tzinfo=None)
                
                # Get all generation spans in range
                all_spans = list(self.storage.spans.values())
                period_spans = [
                    s for s in all_spans
                    if s.created_at and start_dt <= datetime.fromisoformat(s.created_at.replace('Z', '+00:00')).replace(tzinfo=None) <= end_dt
                    and s.span_data.get("type") == "generation"
                ]
                
                # Aggregate by original model name (no grouping)
                model_stats: Dict[str, Dict] = {}
                total_stats = {
                    "requests": 0,
                    "inputTokens": 0,
                    "outputTokens": 0,
                    "totalTokens": 0,
                    "cost": 0
                }
                
                for span in period_spans:
                    model = span.span_data.get("model", "unknown")
                    # Use original model name, no grouping
                    usage = span.span_data.get("usage", {})
                    input_tokens = usage.get("input_tokens", 0)
                    output_tokens = usage.get("output_tokens", 0)
                    total_tokens = input_tokens + output_tokens
                    # Calculate cost using actual model pricing
                    cost = self.storage.get_model_cost(model, input_tokens, output_tokens)
                    
                    # Initialize model entry if not exists
                    if model not in model_stats:
                        model_stats[model] = {
                            "model": model,
                            "requests": 0,
                            "inputTokens": 0,
                            "outputTokens": 0,
                            "totalTokens": 0,
                            "cost": 0
                        }
                    
                    # Update model stats
                    model_stats[model]["requests"] += 1
                    model_stats[model]["inputTokens"] += input_tokens
                    model_stats[model]["outputTokens"] += output_tokens
                    model_stats[model]["totalTokens"] += total_tokens
                    model_stats[model]["cost"] += cost
                    
                    # Update totals
                    total_stats["requests"] += 1
                    total_stats["inputTokens"] += input_tokens
                    total_stats["outputTokens"] += output_tokens
                    total_stats["totalTokens"] += total_tokens
                    total_stats["cost"] += cost
                
                return {
                    "data": list(model_stats.values()),
                    "total": {
                        "model": "Total",
                        **total_stats
                    },
                }
            except HTTPException:
                raise
            except Exception as e:
                raise HTTPException(status_code=500, detail=str(e))