import base64

import pytest
import requests

from sigmaflow.agent.sciverse_api import SciverseAPI, SciverseAPIError


class FakeResponse:
    def __init__(
        self,
        *,
        json_data=None,
        content=b"",
        content_type="application/json",
        status_code=200,
        text="",
    ):
        self._json_data = json_data
        self.content = content
        self.headers = {"Content-Type": content_type}
        self.status_code = status_code
        self.text = text

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(response=self)

    def json(self):
        return self._json_data


class FakeSession:
    def __init__(self, responses):
        self.responses = iter(responses)
        self.calls = []

    def request(self, method, url, **kwargs):
        self.calls.append((method, url, kwargs))
        response = next(self.responses)
        if isinstance(response, Exception):
            raise response
        return response

    def close(self):
        pass


def test_json_endpoints_use_expected_methods_paths_and_auth():
    session = FakeSession(
        [
            FakeResponse(json_data={"fields": []}),
            FakeResponse(json_data={"results": []}),
            FakeResponse(json_data={"hits": []}),
            FakeResponse(json_data={"items": []}),
            FakeResponse(json_data={"text": "content"}),
        ]
    )
    client = SciverseAPI(api_key="sv-test", session=session)

    assert client.list_catalog(include_sample_values=True) == {"fields": []}
    assert client.search_papers(
        query="transformer",
        year_from=2020,
        year_to=2024,
        sort_by_year="desc",
        page_size=20,
    ) == {"results": []}
    assert client.semantic_search("attention", source_types=None) == {"hits": []}
    assert client.list_paper_relations("paper:1", "CITATIONS") == {"items": []}
    assert client.read_content("doc-1", offset=10, limit=100) == {"text": "content"}

    assert [(method, url) for method, url, _ in session.calls] == [
        ("GET", "https://api.sciverse.space/meta-catalog"),
        ("POST", "https://api.sciverse.space/meta-search"),
        ("POST", "https://api.sciverse.space/agentic-search"),
        ("POST", "https://api.sciverse.space/meta-paper-relations"),
        ("GET", "https://api.sciverse.space/content"),
    ]
    assert all(
        call[2]["headers"]["Authorization"] == "Bearer sv-test"
        for call in session.calls
    )
    assert session.calls[0][2]["params"] == {"include_sample_values": "true"}
    assert session.calls[1][2]["json"] == {
        "query": "transformer",
        "page_size": 20,
        "filters": [
            {
                "field": "publication_published_year",
                "operator": "FILTER_OP_GTE",
                "value": 2020,
            },
            {
                "field": "publication_published_year",
                "operator": "FILTER_OP_LTE",
                "value": 2024,
            },
        ],
        "sort": [
            {
                "field": "publication_published_year",
                "order": "SORT_ORDER_DESC",
            }
        ],
    }
    assert session.calls[2][2]["json"] == {
        "query": "attention",
        "top_k": 10,
        "mode": "balanced",
    }


def test_get_resource_returns_base64_and_mime_type():
    session = FakeSession(
        [FakeResponse(content=b"image-data", content_type="image/png; charset=binary")]
    )
    client = SciverseAPI(api_key="sv-test", session=session)

    result = client.get_resource("dt=123/p_456/f3.png")

    assert result == {
        "file_name": "dt=123/p_456/f3.png",
        "mime_type": "image/png",
        "size": 10,
        "bytes_base64": base64.b64encode(b"image-data").decode("ascii"),
    }
    assert session.calls[0][2]["params"] == {"file_name": "dt=123/p_456/f3.png"}


@pytest.mark.parametrize("file_name", ["../secret", "/absolute.png", "a\\b.png"])
def test_get_resource_rejects_unsafe_paths(file_name):
    client = SciverseAPI(api_key="sv-test", session=FakeSession([]))

    with pytest.raises(SciverseAPIError):
        client.get_resource(file_name)


def test_missing_api_key_has_clear_error(monkeypatch):
    monkeypatch.setattr("sigmaflow.agent.sciverse_api.Sciverse_API_KEY", None)
    client = SciverseAPI(session=FakeSession([]))

    with pytest.raises(SciverseAPIError, match="SCIVERSE_API_KEY"):
        client.list_catalog()


def test_retries_connection_closed_by_remote(monkeypatch):
    session = FakeSession(
        [
            requests.ConnectionError("remote closed connection"),
            FakeResponse(json_data={"fields": []}),
        ]
    )
    client = SciverseAPI(api_key="sv-test", session=session)
    monkeypatch.setattr("sigmaflow.agent.sciverse_api.time.sleep", lambda _: None)

    assert client.list_catalog() == {"fields": []}
    assert len(session.calls) == 2


def test_advanced_search_filters_are_merged_and_defaulted():
    session = FakeSession([FakeResponse(json_data={"results": []})])
    client = SciverseAPI(api_key="sv-test", session=session)

    client.search_papers(
        title_contains="protein",
        authors=["Hinton"],
        filters_advanced=[{"field": "doi", "value": "10.1/example"}],
        sort_advanced=[{"field": "citation_count"}],
    )

    assert session.calls[0][2]["json"] == {
        "filters": [
            {
                "field": "title",
                "operator": "FILTER_OP_CONTAINS",
                "value": "protein",
            },
            {
                "field": "author",
                "operator": "FILTER_OP_IN",
                "value": ["Hinton"],
            },
            {
                "field": "doi",
                "operator": "FILTER_OP_EQ",
                "value": "10.1/example",
            },
        ],
        "sort": [{"field": "citation_count", "order": "SORT_ORDER_DESC"}],
    }


def test_tools_are_registered_with_sciverse_prefix():
    from sigmaflow.agent.sciverse_api import SCIVERSE_TOOLS
    from sigmaflow.agent.tools import CHILD_TOOLS, TOOL_HANDLERS, TOOLS

    names = {tool["name"] for tool in SCIVERSE_TOOLS}

    assert names == {
        "sciverse_list_catalog",
        "sciverse_search_papers",
        "sciverse_semantic_search",
        "sciverse_list_paper_relations",
        "sciverse_read_content",
        "sciverse_get_resource",
    }
    assert names <= {tool["name"] for tool in CHILD_TOOLS}
    assert names <= {tool["name"] for tool in TOOLS}
    assert names <= TOOL_HANDLERS.keys()
