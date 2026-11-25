from __future__ import annotations

from fastapi.testclient import TestClient


def test_plugin_list_toggle_config_test(client: TestClient) -> None:
    items = client.get("/api/plugins.list").json()
    assert any(item["name"] == "demo-note" for item in items)
    plugin = next(item for item in items if item["name"] == "demo-note")
    assert plugin["broken_reason"] is None
    assert "memory.read" in plugin["permissions"]

    plugin_id = plugin["id"]
    assert client.post(
        "/api/plugins.test", json={"id": plugin_id}
    ).status_code == 409  # сначала нужно включить

    assert client.post(
        "/api/plugins.toggle", json={"id": plugin_id, "enabled": True}
    ).json()["enabled"] is True

    config = client.get(f"/api/plugins.config?id={plugin_id}").json()
    assert config["values"]["prefix"] == "Заметка"
    assert client.post(
        "/api/plugins.saveConfig",
        json={"id": plugin_id, "values": {"prefix": "Тест", "notify": False}},
    ).status_code == 200

    tested = client.post("/api/plugins.test", json={"id": plugin_id}).json()
    assert tested["ok"] is True
    assert tested["message"].startswith("Тест: ")

    run = client.post(
        "/api/plugins.run", json={"id": plugin_id, "action": "note", "params": {}}
    ).json()
    assert run["message"] == "Тест: Заметка принята"

    client.post("/api/plugins.toggle", json={"id": plugin_id, "enabled": False})
