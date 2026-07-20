"""Tools for calling the Sciverse REST API directly."""

import base64
import platform
import time
import uuid
from pathlib import PurePosixPath
from typing import Any, Dict, List, Optional

import requests

from .conf import Sciverse_API_KEY


SCIVERSE_BASE_URL = "https://api.sciverse.space"
SCIVERSE_TIMEOUT = 60
SCIVERSE_MAX_ATTEMPTS = 3
_RETRYABLE_STATUS_CODES = {502, 503}
_PASSTHROUGH_SEARCH_ARGUMENTS = (
    "query",
    "page",
    "page_size",
    "fields",
    "freshness_boost",
    "collection",
)
_FRESHNESS_BOOST_VALUES = {"NONE", "MILD", "STRONG"}


class SciverseAPIError(RuntimeError):
    """Raised when a Sciverse API request cannot be completed."""


class SciverseAPI:
    """Small synchronous client for the Sciverse Agent Tools REST API."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: str = SCIVERSE_BASE_URL,
        session: Optional[requests.Session] = None,
        timeout: int = SCIVERSE_TIMEOUT,
        max_attempts: int = SCIVERSE_MAX_ATTEMPTS,
    ):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.session = session or requests.Session()
        self.timeout = timeout
        self.max_attempts = max_attempts

    def _headers(self) -> Dict[str, str]:
        api_key = self.api_key or Sciverse_API_KEY
        if not api_key:
            raise SciverseAPIError(
                "SCIVERSE_API_KEY is not configured. Set it before using Sciverse tools."
            )
        return {
            "Accept": "*/*",
            "Authorization": f"Bearer {api_key}",
            "X-Request-Id": str(uuid.uuid4()),
            "X-Sciverse-Source": f"{platform.system().lower()}-sigmaflow",
        }

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: Optional[Dict[str, Any]] = None,
        json_body: Optional[Dict[str, Any]] = None,
    ) -> requests.Response:
        for attempt in range(1, self.max_attempts + 1):
            try:
                response = self.session.request(
                    method,
                    f"{self.base_url}{path}",
                    headers=self._headers(),
                    params=_without_none(params),
                    json=_without_none(json_body),
                    timeout=self.timeout,
                )
                response.raise_for_status()
                return response
            except (requests.ConnectionError, requests.Timeout) as exc:
                if attempt == self.max_attempts:
                    raise SciverseAPIError(f"Sciverse request failed: {exc}") from exc
            except requests.RequestException as exc:
                response = getattr(exc, "response", None)
                status_code = response.status_code if response is not None else None
                if (
                    status_code not in _RETRYABLE_STATUS_CODES
                    or attempt == self.max_attempts
                ):
                    if response is None:
                        raise SciverseAPIError(
                            f"Sciverse request failed: {exc}"
                        ) from exc
                    body = response.text[:2000]
                    raise SciverseAPIError(
                        f"Sciverse API returned HTTP {response.status_code}: {body}"
                    ) from exc

            time.sleep(0.5 * (2 ** (attempt - 1)))

        raise SciverseAPIError("Sciverse request failed after all retry attempts.")

    def _request_json(
        self,
        method: str,
        path: str,
        *,
        params: Optional[Dict[str, Any]] = None,
        json_body: Optional[Dict[str, Any]] = None,
    ) -> Any:
        try:
            response = self._request(method, path, params=params, json_body=json_body)
            return response.json()
        except ValueError as exc:
            raise SciverseAPIError(
                "Sciverse returned an invalid JSON response."
            ) from exc

    def list_catalog(
        self,
        collection: Optional[str] = None,
        include_sample_values: bool = False,
        include_field_stats: bool = False,
    ) -> Any:
        return self._request_json(
            "GET",
            "/meta-catalog",
            params={
                "collection": collection,
                "include_sample_values": str(include_sample_values).lower(),
                "include_field_stats": ("true" if include_field_stats else None),
            },
        )

    def search_papers(self, **arguments: Any) -> Any:
        return self._request_json(
            "POST", "/meta-search", json_body=_to_backend_payload(arguments)
        )

    def semantic_search(
        self,
        query: str,
        top_k: int = 10,
        mode: str = "balanced",
        source_types: Optional[List[str]] = None,
    ) -> Any:
        return self._request_json(
            "POST",
            "/agentic-search",
            json_body={
                "query": query,
                "top_k": top_k,
                "mode": mode,
                "source_types": source_types,
            },
        )

    def list_paper_relations(
        self,
        unique_id: str,
        relation: str,
        page: int = 1,
        page_size: int = 25,
    ) -> Any:
        return self._request_json(
            "POST",
            "/meta-paper-relations",
            json_body={
                "unique_id": unique_id,
                "relation": relation,
                "page": page,
                "page_size": page_size,
            },
        )

    def read_content(self, doc_id: str, offset: int = 0, limit: int = 4096) -> Any:
        return self._request_json(
            "GET",
            "/content",
            params={"doc_id": doc_id, "offset": offset, "limit": limit},
        )

    def get_resource(self, file_name: str) -> Dict[str, Any]:
        path = PurePosixPath(file_name)
        if file_name.startswith("/") or "\\" in file_name or ".." in path.parts:
            raise SciverseAPIError(
                "file_name must be a relative path without '..' or backslashes."
            )

        response = self._request("GET", "/resource", params={"file_name": file_name})

        mime_type = response.headers.get("Content-Type", "application/octet-stream")
        mime_type = mime_type.split(";", 1)[0].strip()
        return {
            "file_name": file_name,
            "mime_type": mime_type,
            "size": len(response.content),
            "bytes_base64": base64.b64encode(response.content).decode("ascii"),
        }

    def close(self) -> None:
        self.session.close()


def _without_none(values: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if values is None:
        return None
    return {key: value for key, value in values.items() if value is not None}


def _to_backend_payload(arguments: Dict[str, Any]) -> Dict[str, Any]:
    """Convert agent-friendly search arguments to the API's canonical schema."""
    payload = {
        key: arguments[key]
        for key in _PASSTHROUGH_SEARCH_ARGUMENTS
        if arguments.get(key) is not None
    }
    filters = []
    sort = []

    freshness_boost = payload.get("freshness_boost")
    if freshness_boost is not None and freshness_boost not in _FRESHNESS_BOOST_VALUES:
        raise SciverseAPIError("freshness_boost must be one of NONE, MILD, or STRONG.")

    def add_filter(field: str, operator: str, value: Any) -> None:
        filters.append({"field": field, "operator": operator, "value": value})

    convenience_filters = (
        ("title_contains", "title", "FILTER_OP_CONTAINS"),
        ("abstract_contains", "abstract", "FILTER_OP_CONTAINS"),
        ("authors", "author", "FILTER_OP_IN"),
        ("year_from", "publication_published_year", "FILTER_OP_GTE"),
        ("year_to", "publication_published_year", "FILTER_OP_LTE"),
        ("journals", "publication_venue_name_unified", "FILTER_OP_IN"),
        ("subjects", "subjects", "FILTER_OP_IN"),
    )
    for argument_name, field, operator in convenience_filters:
        value = arguments.get(argument_name)
        if value is not None and value != []:
            add_filter(field, operator, value)

    for item in arguments.get("filters_advanced") or []:
        entry = dict(item)
        entry.setdefault("operator", "FILTER_OP_EQ")
        filters.append(entry)

    sort_by_year = arguments.get("sort_by_year")
    if sort_by_year and sort_by_year != "none":
        sort.append(
            {
                "field": "publication_published_year",
                "order": (
                    "SORT_ORDER_DESC" if sort_by_year == "desc" else "SORT_ORDER_ASC"
                ),
            }
        )

    for item in arguments.get("sort_advanced") or []:
        if item and item.get("field"):
            sort.append(
                {
                    "field": item["field"],
                    "order": item.get("order", "SORT_ORDER_DESC"),
                }
            )

    if filters:
        payload["filters"] = filters
    if sort:
        payload["sort"] = sort
    return payload


SCIVERSE_CLIENT = SciverseAPI()


def _run(method: str, **arguments: Any) -> Any:
    try:
        return getattr(SCIVERSE_CLIENT, method)(**arguments)
    except SciverseAPIError as exc:
        return f"Error: {exc}"


def sciverse_list_catalog(**arguments: Any) -> Any:
    return _run("list_catalog", **arguments)


def sciverse_search_papers(**arguments: Any) -> Any:
    return _run("search_papers", **arguments)


def sciverse_semantic_search(**arguments: Any) -> Any:
    return _run("semantic_search", **arguments)


def sciverse_list_paper_relations(**arguments: Any) -> Any:
    return _run("list_paper_relations", **arguments)


def sciverse_read_content(**arguments: Any) -> Any:
    return _run("read_content", **arguments)


def sciverse_get_resource(**arguments: Any) -> Any:
    return _run("get_resource", **arguments)


_COLLECTION = {"type": "string", "enum": ["papers", "authors", "sources"]}
_STRING_ARRAY = {"type": "array", "items": {"type": "string"}}
_FILTER_OPERATORS = [
    "FILTER_OP_EQ",
    "FILTER_OP_NE",
    "FILTER_OP_GT",
    "FILTER_OP_GTE",
    "FILTER_OP_LT",
    "FILTER_OP_LTE",
    "FILTER_OP_IN",
    "FILTER_OP_NIN",
    "FILTER_OP_CONTAINS",
    "FILTER_OP_MATCH",
    "FILTER_OP_MATCH_PHRASE",
]

SCIVERSE_TOOLS = [
    {
        "name": "sciverse_list_catalog",
        "description": (
            "List Sciverse fields, filter operators, and optional sample values. "
            "Call this before constructing advanced paper filters."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "collection": {**_COLLECTION, "default": "papers"},
                "include_sample_values": {"type": "boolean", "default": False},
                "include_field_stats": {"type": "boolean", "default": False},
            },
        },
    },
    {
        "name": "sciverse_search_papers",
        "description": (
            "Search Sciverse paper, author, or source metadata using keywords and "
            "structured filters."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "collection": {**_COLLECTION, "default": "papers"},
                "query": {"type": "string"},
                "title_contains": {"type": "string"},
                "abstract_contains": {"type": "string"},
                "authors": _STRING_ARRAY,
                "year_from": {"type": "integer"},
                "year_to": {"type": "integer"},
                "journals": _STRING_ARRAY,
                "subjects": _STRING_ARRAY,
                "fields": _STRING_ARRAY,
                "filters_advanced": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "field": {"type": "string"},
                            "operator": {
                                "type": "string",
                                "enum": _FILTER_OPERATORS,
                                "default": "FILTER_OP_EQ",
                            },
                            "value": {},
                        },
                        "required": ["field", "value"],
                    },
                },
                "sort_advanced": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "field": {"type": "string"},
                            "order": {
                                "type": "string",
                                "enum": ["SORT_ORDER_DESC", "SORT_ORDER_ASC"],
                            },
                        },
                        "required": ["field", "order"],
                    },
                },
                "sort_by_year": {
                    "type": "string",
                    "enum": ["desc", "asc", "none"],
                    "default": "desc",
                },
                "freshness_boost": {
                    "type": "string",
                    "enum": ["NONE", "MILD", "STRONG"],
                    "default": "NONE",
                },
                "page": {"type": "integer", "minimum": 1, "default": 1},
                "page_size": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 50,
                    "default": 10,
                },
            },
        },
    },
    {
        "name": "sciverse_semantic_search",
        "description": (
            "Search Sciverse paper passages with a natural-language query for "
            "citation-grade RAG."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "minLength": 1, "maxLength": 4096},
                "top_k": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 30,
                    "default": 10,
                },
                "mode": {
                    "type": "string",
                    "enum": ["fast", "balanced", "quality"],
                    "default": "balanced",
                },
                "source_types": {
                    "type": "array",
                    "items": {"type": "string", "enum": ["web", "pdf"]},
                },
            },
            "required": ["query"],
        },
    },
    {
        "name": "sciverse_list_paper_relations",
        "description": (
            "List a paper's citations, references, or related works using its "
            "Sciverse unique_id."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "unique_id": {"type": "string"},
                "relation": {
                    "type": "string",
                    "enum": ["CITATIONS", "REFERENCES", "RELATED_WORKS"],
                },
                "page": {"type": "integer", "minimum": 1, "default": 1},
                "page_size": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 200,
                    "default": 25,
                },
            },
            "required": ["unique_id", "relation"],
        },
    },
    {
        "name": "sciverse_read_content",
        "description": (
            "Read a byte-range of original paper text using a doc_id returned by "
            "a Sciverse search tool."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "doc_id": {"type": "string"},
                "offset": {"type": "integer", "minimum": 0, "default": 0},
                "limit": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 16384,
                    "default": 4096,
                },
            },
            "required": ["doc_id"],
        },
    },
    {
        "name": "sciverse_get_resource",
        "description": (
            "Fetch a figure or table referenced by Sciverse read_content. Returns "
            "the image as base64 with its MIME type."
        ),
        "input_schema": {
            "type": "object",
            "properties": {"file_name": {"type": "string"}},
            "required": ["file_name"],
        },
    },
]

SCIVERSE_TOOL_HANDLERS = {
    "sciverse_list_catalog": sciverse_list_catalog,
    "sciverse_search_papers": sciverse_search_papers,
    "sciverse_semantic_search": sciverse_semantic_search,
    "sciverse_list_paper_relations": sciverse_list_paper_relations,
    "sciverse_read_content": sciverse_read_content,
    "sciverse_get_resource": sciverse_get_resource,
}
