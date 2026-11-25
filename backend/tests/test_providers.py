from __future__ import annotations

import asyncio
import json

import httpx
import pytest

from core import streams
from core.config import Settings


def run(coro):
    return asyncio.run(coro)


def test_openai_compatible_stream() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["Authorization"] == "Bearer key-123"
        body = json.loads(request.content)
        assert body["model"] == "gpt-test"
        chunks = [
            'data: {"choices":[{"delta":{"content":"При"}}]}',
            'data: {"choices":[{"delta":{"content":"вет"}}]}',
            "data: [DONE]",
            "",
        ]
        return httpx.Response(200, text="\n\n".join(chunks), headers={"content-type": "text/event-stream"})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

    async def collect() -> str:
        return "".join(
            [
                chunk
                async for chunk in streams.openai_chat(
                    "https://api.test", "key-123", "gpt-test",
                    [{"role": "user", "content": "привет"}],
                    stream=True, client=client,
                )
            ]
        )

    assert run(collect()) == "Привет"
    run(client.aclose())


def test_openai_compatible_non_stream() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, json={"choices": [{"message": {"content": "Ответ"}}]}
        )

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

    async def collect() -> str:
        return "".join(
            [
                chunk
                async for chunk in streams.openai_chat(
                    "https://api.test", "", "model",
                    [{"role": "user", "content": "x"}],
                    stream=False, client=client,
                )
            ]
        )

    assert run(collect()) == "Ответ"
    run(client.aclose())


def test_openai_requires_model() -> None:
    async def collect() -> list[str]:
        return [
            chunk
            async for chunk in streams.openai_chat(
                "https://api.test", "k", "", [{"role": "user", "content": "x"}], stream=False
            )
        ]

    with pytest.raises(RuntimeError, match="модель"):
        run(collect())


def test_dispatcher_routes_openai(monkeypatch) -> None:
    async def fake(base_url, key, model, messages, **kwargs):
        yield f"{base_url}:{model}:{key}"

    monkeypatch.setattr(streams, "openai_chat", fake)

    async def collect() -> str:
        return "".join(
            [
                chunk
                async for chunk in streams.chat(
                    Settings.from_env(),
                    [{"role": "user", "content": "x"}],
                    stream=False,
                    provider={"provider_id": "custom", "base_url": "https://api.test", "model_id": "m1"},
                    api_key="k",
                )
            ]
        )

    assert run(collect()) == "https://api.test:m1:k"


def test_dispatcher_unknown_provider() -> None:
    async def collect() -> list[str]:
        return [
            chunk
            async for chunk in streams.chat(
                Settings.from_env(),
                [{"role": "user", "content": "x"}],
                stream=False,
                provider={"provider_id": "unknown", "base_url": "https://api.test"},
            )
        ]

    with pytest.raises(RuntimeError, match="не поддерживается"):
        run(collect())
