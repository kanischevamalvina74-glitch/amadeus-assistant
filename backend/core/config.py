"""Конфигурация локального ядра. Никаких секретов в исходниках и в БД."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent

# README предлагает скопировать .env.example в .env — значения должны реально читаться.
# Явно заданные переменные окружения имеют приоритет над файлом.
load_dotenv(BACKEND_DIR / ".env", override=False)

MIGRATIONS_DIR = BACKEND_DIR / "migrations"
DATA_DIR = BACKEND_DIR / "data"
DEFAULT_DB_PATH = DATA_DIR / "amadeus.db"

# Стабильный id единственного пользователя этой машины. Запросы всегда
# фильтруются по user_id; заголовок переопределения доступен только в dev.
LOCAL_USER_ID = "01900000-0000-7000-8000-000000000001"


def _as_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    db_path: Path
    db_key: str | None
    allow_plaintext_db: bool
    allow_user_override: bool
    ollama_base_url: str
    ollama_model: str
    secret_store: str
    provider_allowlist: tuple[str, ...]
    log_level: str

    @classmethod
    def from_env(cls) -> "Settings":
        db_path = Path(os.getenv("AMADEUS_DB_PATH", str(DEFAULT_DB_PATH))).expanduser()
        db_key = os.getenv("AMADEUS_DB_KEY") or None
        allow_plaintext = _as_bool("AMADEUS_ALLOW_PLAINTEXT_DB")
        if db_key is None and not allow_plaintext:
            raise RuntimeError(
                "AMADEUS_DB_KEY не задан. Для разработки разрешите незашифрованную БД "
                "через AMADEUS_ALLOW_PLAINTEXT_DB=1; для релиза нужен SQLCipher."
            )
        allowlist = tuple(
            host.strip().lower()
            for host in os.getenv("AMADEUS_PROVIDER_ALLOWLIST", "").split(",")
            if host.strip()
        )
        return cls(
            db_path=db_path,
            db_key=db_key,
            allow_plaintext_db=allow_plaintext,
            allow_user_override=(
                _as_bool("AMADEUS_ALLOW_USER_OVERRIDE")
                and os.getenv("AMADEUS_ENV", "dev") != "production"
            ),
            ollama_base_url=os.getenv("AMADEUS_OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/"),
            ollama_model=os.getenv(
                "AMADEUS_OLLAMA_MODEL",
                "hf.co/nvidia/NVIDIA-Nemotron-3.5-Bolt-E4B-4GB:Q4_K_M",
            ),
            secret_store=os.getenv("AMADEUS_SECRET_STORE", "keyring"),
            provider_allowlist=allowlist,
            log_level=os.getenv("AMADEUS_LOG_LEVEL", "INFO").upper(),
        )

    def is_allowed_provider_host(self, host: str) -> bool:
        host = host.lower().rstrip(".")
        if host in {"127.0.0.1", "localhost", "::1"}:
            return True
        return any(host == allowed or host.endswith("." + allowed) for allowed in self.provider_allowlist)
