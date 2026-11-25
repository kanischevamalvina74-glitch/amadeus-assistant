"""Подключение, миграции и проверка владельца записей.

Правило доступа локального продукта: каждый запрос получает connection и
явный user_id; все SELECT/INSERT/UPDATE/DELETE фильтруются по user_id.
Это локальный аналог RLS — второго пользователя нельзя увидеть чужие данные.
"""

from __future__ import annotations

import hashlib
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

from .config import LOCAL_USER_ID, MIGRATIONS_DIR, Settings


def now_iso() -> str:
    """ISO-8601 UTC с миллисекундами: 2026-11-24T16:44:06.113Z.

    Ранее здесь был strftime('%f'), который в Python означает микросекунды
    и давал невалидное время вида '16:24:337490Z'.
    """
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def new_id() -> str:
    """UUID v7 (сортируется по времени); фолбэк для старых версий Python."""
    import uuid

    return str(uuid.uuid7()) if hasattr(uuid, "uuid7") else str(uuid.uuid4())


def _driver(settings: Settings):
    if settings.db_key:
        try:
            import sqlcipher3  # type: ignore[import-not-found]
        except ImportError as exc:  # pragma: no cover - зависит от окружения
            raise RuntimeError(
                "AMADEUS_DB_KEY задан, но sqlcipher3 не установлен. "
                "Установите SQLCipher-драйвер или уберите ключ."
            ) from exc
        return sqlcipher3
    return sqlite3


@contextmanager
def connect(settings: Settings) -> Iterator[sqlite3.Connection]:
    driver = _driver(settings)
    settings.db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = driver.connect(settings.db_path, timeout=5)
    try:
        conn.row_factory = sqlite3.Row
        conn.execute("pragma foreign_keys = on")
        conn.execute("pragma busy_timeout = 5000")
        if settings.db_key:
            conn.execute(f"pragma key = '{settings.db_key.replace(chr(39), chr(39) * 2)}'")
        conn.execute("pragma journal_mode = wal")
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _backup(settings: Settings) -> Path | None:
    """Резервная копия перед миграцией: откат без потери данных."""
    if not settings.db_path.exists():
        return None
    backup_path = settings.db_path.with_suffix(".db.bak")
    driver = _driver(settings)
    source = driver.connect(settings.db_path)
    target = driver.connect(backup_path)
    try:
        if settings.db_key:
            source.execute(f"pragma key = '{settings.db_key.replace(chr(39), chr(39) * 2)}'")
            target.execute(f"pragma key = '{settings.db_key.replace(chr(39), chr(39) * 2)}'")
        source.backup(target)
    finally:
        target.close()
        source.close()
    return backup_path


def migrate(settings: Settings) -> list[str]:
    """Применять только forward-only миграции; контролировать checksum."""
    settings.db_path.parent.mkdir(parents=True, exist_ok=True)
    applied: list[str] = []
    with connect(settings) as conn:
        conn.execute(
            """create table if not exists schema_migrations (
                 version text primary key,
                 checksum text not null,
                 applied_at text not null
               ) strict"""
        )
        known = {row["version"]: row["checksum"] for row in conn.execute("select version, checksum from schema_migrations")}
        files = sorted(MIGRATIONS_DIR.glob("*.sql"))
        if not files:
            raise RuntimeError(f"Миграции не найдены в {MIGRATIONS_DIR}")

        pending: list[tuple[str, str, str]] = []
        for file in files:
            sql = file.read_text(encoding="utf-8")
            version = file.stem
            checksum = hashlib.sha256(sql.encode("utf-8")).hexdigest()
            if version in known:
                if known[version] != checksum:
                    raise RuntimeError(
                        f"Миграция {version} изменилась после применения. "
                        "Создайте новую миграцию вместо правки старой."
                    )
                continue
            pending.append((version, checksum, sql))

        if not pending:
            return []

    _backup(settings)
    with connect(settings) as conn:
        for version, checksum, sql in pending:
            conn.executescript(sql)
            conn.execute(
                "insert into schema_migrations (version, checksum, applied_at) values (?, ?, ?)",
                (version, checksum, now_iso()),
            )
            applied.append(version)
    return applied


def ensure_user(conn: sqlite3.Connection, user_id: str = LOCAL_USER_ID) -> None:
    """Профиль создаётся лениво; владелец всегда один на машину."""
    conn.execute(
        """insert or ignore into user_profile (id, display_name, locale, assistant_name)
           values (?, '', 'ru', 'Амадеус')""",
        (user_id,),
    )
