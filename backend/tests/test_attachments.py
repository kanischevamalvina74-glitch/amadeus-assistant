from __future__ import annotations

import base64
from typing import AsyncIterator

from fastapi.testclient import TestClient

from core import db, streams
from core.app import ATTACH_DIR, settings


async def fake_chat(settings, messages, *, stream, timeout=None, client=None, **kwargs) -> AsyncIterator[str]:
    assert any("содержимое файла" in message["content"] for message in messages)
    yield "Файл принят"


def test_locale_endpoint(client: TestClient) -> None:
    assert client.post("/api/settings.locale", json={"locale": "en"}).status_code == 200
    with db.connect(settings) as conn:
        locale = conn.execute(
            "select locale from user_profile where id = ?", ("01900000-0000-7000-8000-000000000001",)
        ).fetchone()[0]
    assert locale == "en"
    client.post("/api/settings.locale", json={"locale": "ru"})


def test_stream_with_text_attachment(client: TestClient, conversation: str, monkeypatch) -> None:
    monkeypatch.setattr(streams, "ollama_chat", fake_chat)
    content = "Заметка: содержимое файла для проверки"
    payload = {
        "conversation_id": conversation,
        "text": "Посмотри вложение",
        "attachments": [
            {
                "name": "note.txt",
                "mime": "text/plain",
                "size": len(content.encode("utf-8")),
                "content_base64": base64.b64encode(content.encode("utf-8")).decode("ascii"),
            }
        ],
    }
    response = client.post("/api/v1/chat/stream", json=payload)
    assert response.status_code == 200
    assert "Файл принят" in response.text

    with db.connect(settings) as conn:
        rows = conn.execute(
            """select a.file_name, a.extracted_text_ref, a.status
               from attachments a join messages m on m.id = a.message_id
               where m.conversation_id = ?""",
            (conversation,),
        ).fetchall()
    assert len(rows) == 1
    assert rows[0]["file_name"] == "note.txt"
    assert rows[0]["status"] == "ready"
    assert rows[0]["extracted_text_ref"] and ATTACH_DIR.exists()


def test_attachment_rejects_wrong_size(client: TestClient, conversation: str) -> None:
    payload = {
        "conversation_id": conversation,
        "text": "Проверка размера",
        "attachments": [
            {"name": "x.txt", "mime": "text/plain", "size": 999, "content_base64": base64.b64encode(b"x").decode()}
        ],
    }
    assert client.post("/api/v1/chat/stream", json=payload).status_code == 422
