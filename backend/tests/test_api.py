from __future__ import annotations

import json

import httpx

from core import db
from core.app import settings


def test_timestamps_are_valid_iso(client: httpx.Client, conversation: str) -> None:
    """Регрессия: старый now_iso() давал '16:24:337490Z' и INVALID Date в UI."""
    from datetime import datetime

    client.post("/api/messages.send", json={"conversation_id": conversation, "text": "время"})
    rows = client.get(f"/api/messages.list?conversation_id={conversation}").json()
    for row in rows:
        datetime.fromisoformat(row["created_at"].replace("Z", "+00:00"))


def test_credentials_upsert_no_duplicates(client: httpx.Client) -> None:
    for secret in ("first-secret", "second-secret"):
        response = client.post(
            "/api/credentials.set", json={"provider_id": "duplicate-probe", "secret": secret}
        )
        assert response.status_code == 200

    with db.connect(settings) as conn:
        rows = conn.execute(
            "select secret_ref from api_credentials where provider_id = ?",
            ("duplicate-probe",),
        ).fetchall()
    assert len(rows) == 1


def test_setup_settings_and_history(client: httpx.Client) -> None:
    status = client.get("/api/setup.status").json()
    assert status["locale"] in {"ru", "en"}

    assert client.post(
        "/api/setup.complete",
        json={"locale": "ru", "mode": "local", "assistant_name": "Амадеус"},
    ).json() == {"ok": True}
    assert client.get("/api/setup.status").json()["needsSetup"] is False

    patched = client.post("/api/settings.patch", json={"patch": {"appearance.theme": "light"}}).json()
    assert patched["ok"] is True
    assert client.get("/api/settings.get?keys=appearance.theme").json() == {"appearance.theme": "light"}

    conversation_id = client.post("/api/conversations.create", json={"title": "Первый"}).json()["id"]
    sent = client.post(
        "/api/messages.send", json={"conversation_id": conversation_id, "text": "Привет"}
    )
    assert sent.status_code in {200, 502}  # 502, если локальный Ollama не запущен
    rows = client.get(f"/api/messages.list?conversation_id={conversation_id}").json()
    assert rows and rows[0]["role"] == "user"
    assert rows[0]["text"] == "Привет"


def test_user_isolation(client: httpx.Client) -> None:
    other = {"X-Amadeus-User-ID": "01900000-0000-7000-8000-000000000099"}
    mine = client.post("/api/conversations.create", json={"title": "Личный"}).json()["id"]

    assert client.get("/api/conversations.list").json()
    assert client.get("/api/conversations.list", headers=other).json() == []
    assert client.get(f"/api/messages.list?conversation_id={mine}", headers=other).status_code == 404
    assert client.post(
        "/api/conversations.delete", json={"id": mine}, headers=other
    ).status_code == 404


def test_validation(client: httpx.Client, conversation: str) -> None:
    assert client.post("/api/setup.complete", json={"locale": "fr", "mode": "local"}).status_code == 422
    assert client.post("/api/conversations.create", json={"title": "x", "extra": 1}).status_code == 422
    assert client.post(
        "/api/messages.send", json={"conversation_id": conversation, "text": "   "}
    ).status_code == 422
    assert client.post(
        "/api/messages.send", json={"conversation_id": conversation, "text": "x" * 20_001}
    ).status_code == 422
    assert client.post("/api/conversations.delete", json={"id": "not-an-id"}).status_code == 422


def test_secret_never_stored_or_logged(client: httpx.Client, caplog) -> None:
    secret = "sk-testonly-9f3ac1"
    result = client.post(
        "/api/credentials.set",
        json={"provider_id": "example", "secret": secret, "label": "тестовый"},
    ).json()
    assert result["secretRef"] == "memory://example"

    with caplog.at_level("INFO"):
        check = client.post("/api/credentials.test", json={"provider_id": "example"}).json()
    assert check["code"] == "no_base_url"
    assert secret not in caplog.text
    assert secret not in json.dumps(result)
