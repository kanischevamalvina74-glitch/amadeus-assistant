from __future__ import annotations

import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from core import db, streams
from core.app import settings


def user_headers() -> dict[str, str]:
    return {"X-Amadeus-User-Id": str(uuid.uuid4())}


def test_system_routes(client: TestClient) -> None:
    metrics = client.get("/api/system.metrics")
    assert metrics.status_code == 200
    assert "cpu" in metrics.json()

    apps = client.get("/api/system.apps").json()
    assert "блокнот" in apps["apps"]

    bad_region = client.post("/api/system.screenshot", json={"region": [1, 2]})
    assert bad_region.status_code == 422

    power = client.post("/api/system.power", json={"action": "shutdown", "confirm": "reboot"})
    assert power.status_code == 503

    assert client.get("/api/system.clipboard").status_code in {200, 503}


def test_workspace_routes(client: TestClient, tmp_path: Path) -> None:
    headers = user_headers()
    (tmp_path / "hello.txt").write_text("привет", encoding="utf-8")

    assert client.get("/api/workspace.get", headers=headers).json()["root"] is None

    created = client.post(
        "/api/workspace.set",
        json={"path": str(tmp_path), "allow_write": False},
        headers=headers,
    )
    assert created.status_code == 200
    assert created.json()["allow_write"] is False

    read = client.post("/api/workspace.read", json={"path": "hello.txt"}, headers=headers)
    assert read.status_code == 200
    assert read.json()["text"] == "привет"

    denied = client.post(
        "/api/workspace.write", json={"path": "hello.txt", "text": "нет"}, headers=headers
    )
    assert denied.status_code == 403

    client.post("/api/workspace.patch", json={"allow_write": True}, headers=headers)
    written = client.post(
        "/api/workspace.write", json={"path": "new.txt", "text": "текст"}, headers=headers
    )
    assert written.status_code == 200

    traversal = client.post("/api/workspace.read", json={"path": "../secret"}, headers=headers)
    assert traversal.status_code == 422

    tree = client.get("/api/workspace.tree", headers=headers).json()
    paths = {entry["path"] for entry in tree["entries"]}
    assert "hello.txt" in paths

    run = client.post("/api/workspace.run", json={"command": "echo привет"}, headers=headers)
    assert run.status_code == 200
    assert "привет" in run.json()["output"]


def test_settings_export_import(client: TestClient) -> None:
    headers = user_headers()
    client.post("/api/settings.patch", json={"patch": {"ai.preset": "coding"}}, headers=headers)
    exported = client.get("/api/settings.export", headers=headers).json()
    assert exported["format"] == "amadeus-settings"
    assert exported["settings"]["ai.preset"] == "coding"

    imported = client.post(
        "/api/settings.import",
        json={"data": {"format": "amadeus-settings", "settings": {"app.locale": "en"}}},
        headers=headers,
    )
    assert imported.status_code == 200
    assert imported.json()["applied"] == 1

    bad = client.post("/api/settings.import", json={"data": {"format": "unknown"}}, headers=headers)
    assert bad.status_code == 422


def test_settings_index_search(client: TestClient) -> None:
    all_items = client.get("/api/settings.index").json()
    assert len(all_items) >= 10
    found = client.get("/api/settings.index?q=голос").json()
    assert found
    assert all("голос" in item["title"].lower() or "голос" in item["category"].lower() for item in found)


def test_lock_pin(client: TestClient) -> None:
    headers = user_headers()
    assert client.get("/api/lock.status", headers=headers).json()["enabled"] is False
    assert client.post("/api/lock.set", json={"pin": "1234"}, headers=headers).status_code == 200
    assert client.get("/api/lock.status", headers=headers).json()["enabled"] is True
    wrong = client.post("/api/lock.verify", json={"pin": "0000"}, headers=headers)
    assert wrong.status_code == 401
    right = client.post("/api/lock.verify", json={"pin": "1234"}, headers=headers)
    assert right.status_code == 200


def test_voice_voices_and_selection(client: TestClient) -> None:
    headers = user_headers()
    payload = client.get("/api/voice.voices").json()
    assert "voices" in payload and "piper" in payload
    if payload["voices"]:
        chosen = client.post(
            "/api/voice.select", json={"voice_id": payload["voices"][0]["id"]}, headers=headers
        )
        assert chosen.status_code == 200
    bad = client.post("/api/voice.select", json={"voice_id": "нет-такого"}, headers=headers)
    assert bad.status_code in {200, 422}


def test_memory_summary_uses_local_model(client: TestClient, monkeypatch) -> None:
    headers = user_headers()
    conversation = client.post(
        "/api/conversations.create", json={"title": "Планы"}, headers=headers
    ).json()["id"]

    async def fake_chat(settings, messages, **kwargs):
        yield "Пользователь планирует поездку в Казань."

    monkeypatch.setattr(streams, "chat", fake_chat)

    with db.connect(settings) as conn:
        conn.execute(
            """insert into messages (id, conversation_id, role, text, status, created_at)
               values (?, ?, 'user', 'Хочу в Казань', 'done', ?)""",
            (db.new_id(), conversation, db.now_iso()),
        )
        conn.execute(
            """insert into messages (id, conversation_id, role, text, status, created_at)
               values (?, ?, 'assistant', 'Отличный выбор', 'done', ?)""",
            (db.new_id(), conversation, db.now_iso()),
        )

    result = client.post("/api/memory.summarize", json={"conversation_id": conversation}, headers=headers)
    assert result.status_code == 200
    assert "Казань" in result.json()["text"]

    memory = client.get("/api/memory.search?q=Казань", headers=headers).json()
    assert memory


def test_web_search_requires_provider(client: TestClient) -> None:
    headers = user_headers()
    status = client.get("/api/web.status", headers=headers).json()
    assert status["provider"] == "off"
    search = client.post("/api/web.search", json={"query": "погода"}, headers=headers)
    assert search.status_code == 502


def test_models_and_updates_status(client: TestClient) -> None:
    headers = user_headers()
    models = client.get("/api/models.list", headers=headers)
    assert models.status_code == 200
    assert "ollama" in models.json()
    updates = client.get("/api/updates.status", headers=headers).json()
    assert updates["current_version"] == "0.1.0"
    assert updates["channel"] == "stable"
