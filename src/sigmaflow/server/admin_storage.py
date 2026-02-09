"""
Data storage layer for admin system.
Currently uses JSON file-based persistent storage.
"""

from datetime import datetime
from typing import Optional, Dict, List, Any
import uuid
import json
import os
from pathlib import Path
from .constant import (
    StorageTrace, StorageSpan, StorageUser, StorageApiKey,
    SpanError
)

_shared_storage: Optional["AdminStorage"] = None


def get_admin_storage(storage_dir: Optional[str] = None) -> "AdminStorage":
    global _shared_storage
    if _shared_storage is None:
        _shared_storage = AdminStorage(storage_dir=storage_dir)
    return _shared_storage

class AdminStorage:
    """
    File-based persistent storage for admin traces, users, and API keys.
    Data is stored in JSON format and loaded on init.
    """
    
    def __init__(self, storage_dir: Optional[str] = None):
        # Set storage directory (default to ~/.sigmaflow/admin)
        if storage_dir is None:
            storage_dir = os.path.join(os.path.expanduser("~"), ".sigmaflow", "admin")
        
        self.storage_dir = Path(storage_dir)
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        
        self.traces: Dict[str, StorageTrace] = {}
        self.spans: Dict[str, StorageSpan] = {}
        self.users: Dict[str, StorageUser] = {}
        self.api_keys: Dict[str, StorageApiKey] = {}
        self.api_keys_by_prefix: Dict[str, StorageApiKey] = {}
        
        # Load existing data
        self._load_data()
    
    def _get_file_path(self, name: str) -> Path:
        """Get full path for a storage file"""
        return self.storage_dir / f"{name}.json"
    
    def _load_data(self):
        """Load all data from JSON files"""
        # Load traces
        traces_file = self._get_file_path("traces")
        if traces_file.exists():
            with open(traces_file, 'r') as f:
                data = json.load(f)
                for trace_data in data:
                    trace = StorageTrace(
                        trace_data['object'],
                        trace_data['id'],
                        trace_data['workflow_name'],
                        trace_data.get('group_id'),
                        trace_data.get('metadata'),
                        trace_data.get('created_at'),
                        trace_data.get('updated_at')
                    )
                    self.traces[trace.id] = trace
        
        # Load spans
        spans_file = self._get_file_path("spans")
        if spans_file.exists():
            with open(spans_file, 'r') as f:
                data = json.load(f)
                for span_data in data:
                    error = None
                    if span_data.get('error'):
                        error = SpanError(**span_data['error'])
                    span = StorageSpan(
                        span_data['object'],
                        span_data['id'],
                        span_data['trace_id'],
                        span_data.get('parent_id'),
                        span_data.get('started_at'),
                        span_data.get('ended_at'),
                        span_data.get('span_data'),
                        error,
                        span_data.get('created_at'),
                        span_data.get('updated_at')
                    )
                    self.spans[span.id] = span
        
        # Load users
        users_file = self._get_file_path("users")
        if users_file.exists():
            with open(users_file, 'r') as f:
                data = json.load(f)
                for user_data in data:
                    user = StorageUser(
                        user_data['id'],
                        user_data['email'],
                        user_data['password_hash'],
                        user_data['role'],
                        user_data.get('created_at')
                    )
                    self.users[user.id] = user
        
        # Load API keys
        api_keys_file = self._get_file_path("api_keys")
        if api_keys_file.exists():
            with open(api_keys_file, 'r') as f:
                data = json.load(f)
                for key_data in data:
                    api_key = StorageApiKey(
                        key_data['id'],
                        key_data['name'],
                        key_data['key_hash'],
                        key_data['prefix'],
                        key_data['suffix'],
                        key_data['created_by'],
                        key_data.get('expires_at'),
                        key_data.get('last_used_at'),
                        key_data.get('is_active', True),
                        key_data.get('created_at')
                    )
                    self.api_keys[api_key.id] = api_key
                    self.api_keys_by_prefix[api_key.prefix] = api_key
    
    def _save_traces(self):
        """Save traces to JSON file"""
        data = []
        for trace in self.traces.values():
            data.append({
                'object': trace.object,
                'id': trace.id,
                'workflow_name': trace.workflow_name,
                'group_id': trace.group_id,
                'metadata': trace.metadata,
                'created_at': trace.created_at,
                'updated_at': trace.updated_at
            })
        with open(self._get_file_path("traces"), 'w') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
    
    def _save_spans(self):
        """Save spans to JSON file"""
        data = []
        for span in self.spans.values():
            span_dict = {
                'object': span.object,
                'id': span.id,
                'trace_id': span.trace_id,
                'parent_id': span.parent_id,
                'started_at': span.started_at,
                'ended_at': span.ended_at,
                'span_data': span.span_data,
                'error': span.error.dict() if span.error else None,
                'created_at': span.created_at,
                'updated_at': span.updated_at
            }
            data.append(span_dict)
        with open(self._get_file_path("spans"), 'w') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
    
    def _save_users(self):
        """Save users to JSON file"""
        data = []
        for user in self.users.values():
            data.append({
                'id': user.id,
                'email': user.email,
                'password_hash': user.password_hash,
                'role': user.role,
                'created_at': user.created_at
            })
        with open(self._get_file_path("users"), 'w') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
    
    def _save_api_keys(self):
        """Save API keys to JSON file"""
        data = []
        for api_key in self.api_keys.values():
            data.append({
                'id': api_key.id,
                'name': api_key.name,
                'key_hash': api_key.key_hash,
                'prefix': api_key.prefix,
                'suffix': api_key.suffix,
                'created_by': api_key.created_by,
                'expires_at': api_key.expires_at,
                'last_used_at': api_key.last_used_at,
                'is_active': api_key.is_active,
                'created_at': api_key.created_at
            })
        with open(self._get_file_path("api_keys"), 'w') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
    
    # ========================================================================
    # Trace Operations
    # ========================================================================
    
    def save_trace(self, trace_id: str, workflow_name: str,
                   group_id: Optional[str] = None,
                   metadata: Optional[Dict[str, Any]] = None) -> StorageTrace:
        """Save or update a trace"""
        if trace_id in self.traces:
            trace = self.traces[trace_id]
            trace.workflow_name = workflow_name
            trace.group_id = group_id
            if metadata:
                trace.metadata.update(metadata)
            trace.updated_at = datetime.utcnow().isoformat() + 'Z'
        else:
            trace = StorageTrace(
                "trace", trace_id, workflow_name, group_id, metadata
            )
            self.traces[trace_id] = trace
        self._save_traces()
        return trace
    
    def get_trace(self, trace_id: str) -> Optional[StorageTrace]:
        """Get a trace by ID"""
        return self.traces.get(trace_id)
    
    def delete_trace(self, trace_id: str) -> bool:
        """Delete a trace and all its associated spans"""
        if trace_id not in self.traces:
            return False
        
        # Delete associated spans
        span_ids_to_delete = [s.id for s in self.spans.values() if s.trace_id == trace_id]
        for span_id in span_ids_to_delete:
            del self.spans[span_id]
        
        # Delete trace
        del self.traces[trace_id]
        
        # Save changes
        self._save_traces()
        self._save_spans()
        return True
    
    def find_traces(self, filters: Dict[str, Any],
                   skip: int = 0, limit: int = 10,
                   sort_field: str = "created_at",
                   sort_order: int = -1) -> tuple[List[StorageTrace], int]:
        """Find traces with filtering and pagination"""
        results = list(self.traces.values())
        
        # Apply filters
        if "trace_id" in filters:
            results = [t for t in results if t.id == filters["trace_id"]]
        
        if "group_id" in filters:
            results = [t for t in results if t.group_id == filters["group_id"]]
        
        if "workflow_name" in filters:
            workflow_pattern = filters["workflow_name"].lower()
            results = [t for t in results if workflow_pattern in t.workflow_name.lower()]
        
        if "metadata" in filters:
            for key, value in filters["metadata"].items():
                results = [t for t in results if t.metadata.get(key) == value]
        
        if "start_date" in filters:
            start = datetime.fromisoformat(filters["start_date"].replace('Z', '+00:00'))
            # Convert to naive UTC for comparison
            if start.tzinfo is not None:
                start = start.replace(tzinfo=None)
            results = [t for t in results if datetime.fromisoformat(t.created_at.replace('Z', '+00:00')).replace(tzinfo=None) >= start]
        
        if "end_date" in filters:
            end = datetime.fromisoformat(filters["end_date"].replace('Z', '+00:00'))
            # Convert to naive UTC for comparison
            if end.tzinfo is not None:
                end = end.replace(tzinfo=None)
            results = [t for t in results if datetime.fromisoformat(t.created_at.replace('Z', '+00:00')).replace(tzinfo=None) <= end]
        
        # Sort
        if sort_field == "created_at":
            results.sort(key=lambda t: t.created_at, reverse=(sort_order == -1))
        elif sort_field == "workflow_name":
            results.sort(key=lambda t: t.workflow_name, reverse=(sort_order == -1))
        
        total = len(results)
        return results[skip:skip + limit], total
    
    # ========================================================================
    # Span Operations
    # ========================================================================
    
    def save_span(self, span_id: str, trace_id: str,
                  parent_id: Optional[str] = None,
                  started_at: Optional[str] = None,
                  ended_at: Optional[str] = None,
                  span_data: Optional[Dict[str, Any]] = None,
                  error: Optional[SpanError] = None) -> StorageSpan:
        """Save or update a span"""
        if span_id in self.spans:
            span = self.spans[span_id]
            span.started_at = started_at or span.started_at
            span.ended_at = ended_at or span.ended_at
            if span_data:
                span.span_data.update(span_data)
            if error:
                span.error = error
            span.updated_at = datetime.utcnow().isoformat() + 'Z'
        else:
            span = StorageSpan(
                "trace.span", span_id, trace_id, parent_id,
                started_at, ended_at, span_data, error
            )
            self.spans[span_id] = span
        self._save_spans()
        return span
    
    def get_spans_by_trace(self, trace_id: str) -> List[StorageSpan]:
        """Get all spans for a trace"""
        return [s for s in self.spans.values() if s.trace_id == trace_id]
    
    # ========================================================================
    # User Operations
    # ========================================================================
    
    def save_user(self, user_id: str, email: str, password_hash: str,
                  role: str) -> StorageUser:
        """Save a user"""
        user = StorageUser(user_id, email, password_hash, role)
        self.users[user_id] = user
        self._save_users()
        return user
    
    def get_user_by_email(self, email: str) -> Optional[StorageUser]:
        """Get user by email"""
        for user in self.users.values():
            if user.email == email:
                return user
        return None
    
    def get_user_by_id(self, user_id: str) -> Optional[StorageUser]:
        """Get user by ID"""
        return self.users.get(user_id)
    
    def count_users(self) -> int:
        """Count total users"""
        return len(self.users)
    
    # ========================================================================
    # API Key Operations
    # ========================================================================
    
    def save_api_key(self, name: str, key_hash: str, prefix: str, suffix: str,
                    created_by: str, expires_at: Optional[str] = None) -> StorageApiKey:
        """Save an API key"""
        key_id = str(uuid.uuid4())
        api_key = StorageApiKey(
            key_id, name, key_hash, prefix, suffix, created_by, expires_at
        )
        self.api_keys[key_id] = api_key
        self.api_keys_by_prefix[prefix] = api_key
        self._save_api_keys()
        return api_key
    
    def get_api_key(self, key_id: str) -> Optional[StorageApiKey]:
        """Get API key by ID"""
        return self.api_keys.get(key_id)
    
    def find_api_key_by_key(self, api_key: str) -> Optional[StorageApiKey]:
        """Find API key by the actual key string"""
        # In production, this would be more efficient with proper hashing
        from .admin_auth import hash_api_key
        key_hash = hash_api_key(api_key)
        for stored_key in self.api_keys.values():
            if stored_key.key_hash == key_hash and stored_key.is_active:
                return stored_key
        return None
    
    def get_active_api_keys(self, created_by: Optional[str] = None) -> List[StorageApiKey]:
        """Get all active API keys, optionally filtered by creator"""
        keys = [k for k in self.api_keys.values() if k.is_active]
        if created_by:
            keys = [k for k in keys if k.created_by == created_by]
        return sorted(keys, key=lambda k: k.created_at, reverse=True)
    
    def deactivate_api_key(self, key_id: str) -> Optional[StorageApiKey]:
        """Deactivate an API key"""
        if key_id in self.api_keys:
            key = self.api_keys[key_id]
            key.is_active = False
            self._save_api_keys()
            return key
        return None
    
    def update_api_key_usage(self, key_id: str) -> Optional[StorageApiKey]:
        """Update last used timestamp for an API key"""
        if key_id in self.api_keys:
            key = self.api_keys[key_id]
            key.last_used_at = datetime.utcnow().isoformat() + 'Z'
            self._save_api_keys()
            return key
        return None
    
    # ========================================================================
    # Model Pricing Methods
    # ========================================================================
    
    def get_model_pricing_file_path(self) -> Path:
        """Get the path to the model pricing configuration file"""
        # Look for model_pricing.json in the server directory first
        server_dir = Path(__file__).parent
        config_path = server_dir / "model_pricing.json"
        
        # If not found in server dir, use storage dir
        if not config_path.exists():
            config_path = self.storage_dir / "model_pricing.json"
            # If still not found, create default config
            if not config_path.exists():
                self._create_default_pricing_config(config_path)
        
        return config_path
    
    def _create_default_pricing_config(self, config_path: Path):
        """Create default model pricing configuration"""
        default_config = {
            "models": {
                "gpt-4": {
                    "input_price_per_1k": 0.03,
                    "output_price_per_1k": 0.06,
                    "provider": "OpenAI",
                    "category": "openai"
                },
                "gpt-3.5-turbo": {
                    "input_price_per_1k": 0.0005,
                    "output_price_per_1k": 0.0015,
                    "provider": "OpenAI",
                    "category": "openai"
                },
                "claude-3-opus": {
                    "input_price_per_1k": 0.015,
                    "output_price_per_1k": 0.075,
                    "provider": "Anthropic",
                    "category": "claude"
                },
                "claude-3-sonnet": {
                    "input_price_per_1k": 0.003,
                    "output_price_per_1k": 0.015,
                    "provider": "Anthropic",
                    "category": "claude"
                }
            },
            "default_pricing": {
                "input_price_per_1k": 0.001,
                "output_price_per_1k": 0.002,
                "provider": "Unknown",
                "category": "other"
            }
        }
        
        with open(config_path, 'w') as f:
            json.dump(default_config, f, indent=2, ensure_ascii=False)
    
    def load_model_pricing(self) -> Dict[str, Any]:
        """Load model pricing configuration"""
        config_path = self.get_model_pricing_file_path()
        
        try:
            with open(config_path, 'r') as f:
                return json.load(f)
        except Exception as e:
            # Return minimal default if file cannot be read
            return {
                "models": {},
                "default_pricing": {
                    "input_price_per_1k": 0.001,
                    "output_price_per_1k": 0.002,
                    "provider": "Unknown",
                    "category": "other"
                }
            }
    
    def save_model_pricing(self, pricing_data: Dict[str, Any]) -> bool:
        """Save model pricing configuration"""
        config_path = self.get_model_pricing_file_path()
        
        try:
            # Ensure parent directory exists
            config_path.parent.mkdir(parents=True, exist_ok=True)
            
            with open(config_path, 'w') as f:
                json.dump(pricing_data, f, indent=2, ensure_ascii=False)
            return True
        except Exception as e:
            print(f"Error saving model pricing: {e}")
            return False
    
    def update_model_price(self, model_name: str, input_price: float, 
                          output_price: float, provider: str = None, 
                          category: str = None) -> bool:
        """Update price for a specific model"""
        pricing_data = self.load_model_pricing()
        
        if "models" not in pricing_data:
            pricing_data["models"] = {}
        
        # Update or create model entry
        if model_name not in pricing_data["models"]:
            pricing_data["models"][model_name] = {}
        
        pricing_data["models"][model_name]["input_price_per_1k"] = input_price
        pricing_data["models"][model_name]["output_price_per_1k"] = output_price
        
        if provider is not None:
            pricing_data["models"][model_name]["provider"] = provider
        if category is not None:
            pricing_data["models"][model_name]["category"] = category
        
        return self.save_model_pricing(pricing_data)
    
    def get_model_cost(self, model_name: str, input_tokens: int, 
                       output_tokens: int) -> float:
        """Calculate cost for a model based on token usage"""
        pricing_data = self.load_model_pricing()
        
        # Find pricing for this model (try exact match first)
        model_pricing = pricing_data.get("models", {}).get(model_name)
        
        # If no exact match, try to find by partial match
        if not model_pricing:
            model_lower = model_name.lower()
            for key, value in pricing_data.get("models", {}).items():
                if key.lower() in model_lower or model_lower in key.lower():
                    model_pricing = value
                    break
        
        # Fall back to default pricing
        if not model_pricing:
            model_pricing = pricing_data.get("default_pricing", {
                "input_price_per_1k": 0.001,
                "output_price_per_1k": 0.002
            })
        
        # Calculate cost
        input_cost = (input_tokens / 1000.0) * model_pricing.get("input_price_per_1k", 0.001)
        output_cost = (output_tokens / 1000.0) * model_pricing.get("output_price_per_1k", 0.002)
        
        return input_cost + output_cost
