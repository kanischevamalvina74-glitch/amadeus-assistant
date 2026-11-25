from __future__ import annotations

import asyncio

import httpx
import pytest

from core import search


def run(coro):
    return asyncio.run(coro)


def test_brave_search_parses_official_response() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["X-Subscription-Token"] == "key-123"
        return httpx.Response(
            200,
            json={
                "web": {
                    "results": [
                        {"title": "Погода", "url": "https://example.test/w", "description": "<b>Тепло</b>"}
                    ]
                }
            },
        )

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    results = run(search.brave_search("погода", "key-123", client=client))
    run(client.aclose())
    assert results[0]["title"] == "Погода"
    assert results[0]["description"] == "Тепло"


def test_search_requires_configured_provider() -> None:
    with pytest.raises(search.SearchError):
        run(search.search("погода", provider="off"))


def test_search_maps_401_to_readable_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401)

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    with pytest.raises(search.SearchError, match="401"):
        run(search.brave_search("погода", "key-123", client=client))
    run(client.aclose())


def test_searx_search() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/search")
        return httpx.Response(
            200,
            json={"results": [{"title": "Итог", "url": "https://example.test", "content": "текст"}]},
        )

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    results = run(search.searx_search("тест", "https://searx.test", client=client))
    run(client.aclose())
    assert results[0]["provider"] == "searxng"


def test_fetch_strips_html_and_scripts(monkeypatch) -> None:
    monkeypatch.setattr(search.socket, "gethostbyname", lambda host: "93.184.216.34")

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"content-type": "text/html; charset=utf-8"},
            text="<html><head><title>Заголовок</title><style>x{}</style></head>"
            "<body><script>alert(1)</script><p>Первый абзац</p><p>Второй</p></body></html>",
        )

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    page = run(search.fetch_page("https://example.test/page", client=client))
    run(client.aclose())
    assert page["title"] == "Заголовок"
    assert "Первый абзац" in page["text"]
    assert "alert" not in page["text"]


def test_fetch_blocks_private_addresses() -> None:
    with pytest.raises(search.SearchError):
        run(search.fetch_page("http://127.0.0.1/admin"))
    with pytest.raises(search.SearchError):
        run(search.fetch_page("file:///etc/passwd"))
