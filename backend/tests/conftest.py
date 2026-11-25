from __future__ import annotations

import os
import tempfile
from pathlib import Path

# Переменные должны быть заданы до импорта core.app (настройки читаются при импорте).
_TMP = Path(tempfile.mkdtemp(prefix="amadeus-tests-"))
os.environ["AMADEUS_ALLOW_PLAINTEXT_DB"] = "1"
os.environ["AMADEUS_SECRET_STORE"] = "memory"
os.environ["AMADEUS_ALLOW_USER_OVERRIDE"] = "1"
os.environ["AMADEUS_DB_PATH"] = str(_TMP / "test.db")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from core.app import app, settings  # noqa: E402
from core.db import migrate  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def _database() -> None:
    migrate(settings)


@pytest.fixture
def client() -> TestClient:
    with TestClient(app) as http:
        yield http


@pytest.fixture
def conversation(client: TestClient) -> str:
    response = client.post("/api/conversations.create", json={"title": "Тест"})
    assert response.status_code == 200
    return response.json()["id"]
