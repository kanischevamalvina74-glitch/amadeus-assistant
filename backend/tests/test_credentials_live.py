from __future__ import annotations

import uuid

import httpx
import pytest
from fastapi.testclient import TestClient

from core import app as app_module


def _headers() -> dict[str, str]:
    return {"X-Amadeus-User-Id": str(uuid.uuid4())}


def _setup_provider(client: TestClient, headers: dict[str, str]) -> None:
    created = client.post(
        "/api/credentials.set",
        json={"provider_id": "live-probe", "secret": "key-123"},
        headers=headers,
    )
    assert created.status_code == 200
    provider = client.post(
        "/api/providers.upsert",
        json={
            "stage": "llm",
            "provider_id": "live-probe",
            "base_url": "https://127.0.0.1:8443/v1",
            "is_active": True,
        },
        headers=headers,
    )
    assert provider.status_code == 200


@pytest.mark.parametrize(
    ("status", "expected_code", "expected_ok"),
    [(200, "ok", True), (401, "invalid_key", False), (403, "forbidden", False), (429, "rate_limited", False)],
)
def test_credentials_test_calls_real_http_and_maps_codes(
    client: TestClient, monkeypatch, status: int, expected_code: str, expected_ok: bool
) -> None:
    """Проверка ключа делает настоящий HTTP-запрос и разбирает 401/403/429."""
    headers = _headers()
    _setup_provider(client, headers)

    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.headers.get("Authorization", ""))
        return httpx.Response(status, json={"data": []})

    real_client = httpx.AsyncClient

    def fake_client(*args, **kwargs):
        return real_client(transport=httpx.MockTransport(handler))

    monkeypatch.setattr(app_module.httpx, "AsyncClient", fake_client)
    try:
        result = client.post("/api/credentials.test", json={"provider_id": "live-probe"}, headers=headers)
    finally:
        monkeypatch.setattr(app_module.httpx, "AsyncClient", real_client)

    assert result.status_code == 200
    body = result.json()
    assert body["ok"] is expected_ok
    assert body["code"] == expected_code
    assert seen == ["Bearer key-123"]
