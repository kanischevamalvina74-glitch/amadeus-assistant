from __future__ import annotations

import httpx

from core import db
from core.app import settings


def test_permissions_and_action_gate(client: httpx.Client) -> None:
    scopes = client.get("/api/permissions.get").json()
    assert len(scopes) >= 5
    assert all(item["mode"] == "ask" for item in scopes)

    proposed = client.post(
        "/api/actions.propose",
        json={"tool": "open_url", "args": {"url": "https://example.test"}, "risk": "low"},
    ).json()
    assert proposed["status"] == "proposed"

    client.post(
        "/api/permissions.patch", json={"scope": "web", "mode": "full"}
    )
    auto = client.post(
        "/api/actions.propose",
        json={"tool": "open_url", "args": {"url": "https://example.test"}, "risk": "low"},
    ).json()
    assert auto["status"] == "approved"

    critical = client.post(
        "/api/actions.propose",
        json={"tool": "open_url", "args": {"url": "https://example.test"}, "risk": "critical"},
    ).json()
    assert critical["status"] == "proposed"  # опасные действия всегда требуют подтверждения

    client.post("/api/permissions.patch", json={"scope": "web", "mode": "denied"})
    denied = client.post(
        "/api/actions.propose", json={"tool": "open_url", "args": {"url": "https://example.test"}}
    )
    assert denied.status_code == 403
    client.post("/api/permissions.patch", json={"scope": "web", "mode": "ask"})


def test_action_approve_and_log(client: httpx.Client) -> None:
    action = client.post(
        "/api/actions.propose",
        json={"tool": "open_url", "args": {"url": "https://example.test"}, "risk": "medium"},
    ).json()
    approved = client.post("/api/actions.approve", json={"id": action["id"]})
    assert approved.status_code == 200
    assert approved.json()["ok"] is True

    actions = {item["id"]: item for item in client.get("/api/actions.list").json()}
    assert actions[action["id"]]["status"] == "done"
    with db.connect(settings) as conn:
        logs = conn.execute(
            "select summary from action_logs where action_id = ?", (action["id"],)
        ).fetchall()
    assert len(logs) == 1
    assert "Открыта ссылка" in logs[0]["summary"]


def test_reminders_and_tasks_crud(client: httpx.Client) -> None:
    reminder = client.post(
        "/api/reminders.create",
        json={"title": "Позвонить в команду", "due_at": "2030-01-01T10:00:00Z"},
    ).json()
    assert client.get("/api/reminders.list").status_code == 200
    assert client.post(
        "/api/reminders.update", json={"id": reminder["id"], "patch": {"status": "done"}}
    ).status_code == 200
    assert client.post("/api/reminders.delete", json={"id": reminder["id"]}).status_code == 200
    assert client.post("/api/reminders.delete", json={"id": reminder["id"]}).status_code == 404

    task = client.post("/api/tasks.upsert", json={"title": "Проверить сборку"}).json()
    assert any(item["id"] == task["id"] for item in client.get("/api/tasks.list").json())
    assert client.post("/api/tasks.delete", json={"id": task["id"]}).status_code == 200


def test_memory_add_search_and_forget(client: httpx.Client) -> None:
    word = "персиковый"
    entry = client.post(
        "/api/memory.add",
        json={"patch": {"kind": "fact", "text": f"Пользователь любит {word} йогурт"}},
    ).json()
    assert client.get("/api/memory.search", params={"q": word}).json()
    assert client.post("/api/memory.forget", json={"id": entry["id"]}).status_code == 200
    assert client.post("/api/memory.forget", json={"id": entry["id"]}).status_code == 404
