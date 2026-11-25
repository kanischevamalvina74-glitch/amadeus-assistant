from __future__ import annotations

import asyncio
from typing import AsyncIterator

import httpx

from core import app as app_module
from core import db, streams
from core.app import settings


async def fake_chat(settings, messages, *, stream, timeout=None, client=None, **kwargs) -> AsyncIterator[str]:
    assert stream is True
    assert messages[-1]["content"] == "Расскажи коротко"
    for chunk in ("Коротко", ". ", "Отвечаю."):
        yield chunk


def test_non_streaming_chat_reads_body() -> None:
    """Регрессия: без aread() httpx отдаёт 502 «without having called read()»."""
    import asyncio

    from core.config import Settings

    settings = Settings.from_env()

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"message": {"content": "готово"}, "done": True})

    async def scenario() -> None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            chunks = [
                chunk
                async for chunk in streams.ollama_chat(
                    settings, [{"role": "user", "content": "тест"}], stream=False, client=http
                )
            ]
        assert chunks == ["готово"]

    asyncio.run(scenario())


def test_sse_stream_persists_answer(client: httpx.Client, conversation: str, monkeypatch) -> None:
    monkeypatch.setattr(streams, "ollama_chat", fake_chat)
    with client.stream(
        "GET",
        "/api/v1/chat/stream",
        params={"conversation_id": conversation, "text": "Расскажи коротко"},
    ) as response:
        assert response.status_code == 200
        body = response.read().decode("utf-8")

    assert "event: delta" in body
    assert '"delta": "Коротко"' in body
    assert "event: done" in body

    rows = client.get(f"/api/messages.list?conversation_id={conversation}").json()
    assistant = rows[-1]
    assert assistant["role"] == "assistant"
    assert assistant["status"] == "done"
    assert assistant["text"] == "Коротко. Отвечаю."


def test_cancel_stream_marks_message_canceled(conversation: str, monkeypatch) -> None:
    """Настоящая отмена активного SSE-потока: статус должен стать canceled."""
    started = asyncio.Event()
    release = asyncio.Event()

    async def slow_chat(settings, messages, *, stream, timeout=None, client=None, **kwargs) -> AsyncIterator[str]:
        started.set()
        await release.wait()
        yield "этот чанк не должен попасть в ответ"

    monkeypatch.setattr(streams, "ollama_chat", slow_chat)

    async def scenario() -> None:
        transport = httpx.ASGITransport(app=app_module.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as async_client:
            stream_task = asyncio.create_task(
                async_client.get(
                    "/api/v1/chat/stream",
                    params={"conversation_id": conversation, "text": "Проверка отмены"},
                )
            )
            await asyncio.wait_for(started.wait(), timeout=3)

            with db.connect(settings) as conn:
                row = conn.execute(
                    """select id from messages
                       where conversation_id = ? and status = 'streaming'""",
                    (conversation,),
                ).fetchone()
            assert row is not None

            response = await async_client.post(
                "/api/messages.cancel", json={"message_id": row["id"]}
            )
            assert response.json()["ok"] is True

            release.set()
            try:
                await stream_task
            except (asyncio.CancelledError, Exception):
                pass

            with db.connect(settings) as conn:
                status = conn.execute(
                    "select status from messages where id = ?", (row["id"],)
                ).fetchone()[0]
            assert status == "canceled"

    asyncio.run(scenario())


def test_cancel_unknown_message(client: httpx.Client) -> None:
    response = client.post(
        "/api/messages.cancel",
        json={"message_id": "01900000-0000-7000-8000-000000000000"},
    )
    assert response.json() == {"ok": False}
