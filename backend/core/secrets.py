"""Секреты живут в OS keychain; в БД только ссылка secret_ref."""

from __future__ import annotations

from typing import Protocol

import keyring

from .config import Settings

SERVICE = "amadeus"


class SecretStore(Protocol):
    def set(self, provider_id: str, secret: str) -> str: ...

    def get(self, secret_ref: str) -> str | None: ...


class KeyringStore:
    """Windows Credential Manager / macOS Keychain / libsecret через keyring."""

    def set(self, provider_id: str, secret: str) -> str:
        keyring.set_password(SERVICE, provider_id, secret)
        return f"keyring://{SERVICE}/{provider_id}"

    def get(self, secret_ref: str) -> str | None:
        prefix = f"keyring://{SERVICE}/"
        if not secret_ref.startswith(prefix):
            return None
        return keyring.get_password(SERVICE, secret_ref[len(prefix) :])


class MemoryStore:
    """Только для тестов: секрет не попадает ни в БД, ни в логи."""

    def __init__(self) -> None:
        self._items: dict[str, str] = {}

    def set(self, provider_id: str, secret: str) -> str:
        self._items[provider_id] = secret
        return f"memory://{provider_id}"

    def get(self, secret_ref: str) -> str | None:
        if not secret_ref.startswith("memory://"):
            return None
        return self._items.get(secret_ref[len("memory://") :])


def make_store(settings: Settings) -> SecretStore:
    if settings.secret_store == "memory":
        return MemoryStore()
    if settings.secret_store == "keyring":
        return KeyringStore()
    raise RuntimeError(f"Неизвестный AMADEUS_SECRET_STORE: {settings.secret_store}")
