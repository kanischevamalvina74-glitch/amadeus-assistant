from __future__ import annotations

from core import db
from core.config import Settings


def test_fresh_database_and_idempotency(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("AMADEUS_DB_PATH", str(tmp_path / "fresh.db"))
    settings = Settings.from_env()

    assert db.migrate(settings) == [
        "0001_init",
        "0002_credentials_unique",
        "0003_fix_timestamps",
        "0004_permission_scopes",
    ]
    assert db.migrate(settings) == []

    with db.connect(settings) as conn:
        names = {row[0] for row in conn.execute("select name from sqlite_master where type = 'table'")}
    for table in ("user_profile", "conversations", "messages", "actions", "plugins", "schema_migrations"):
        assert table in names
    assert "messages_fts" in names


def test_migration_creates_backup_before_change(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("AMADEUS_DB_PATH", str(tmp_path / "backup.db"))
    settings = Settings.from_env()
    db.migrate(settings)

    migrations = tmp_path / "migrations"
    migrations.mkdir()
    (migrations / "0001_init.sql").write_text(
        (db.MIGRATIONS_DIR / "0001_init.sql").read_text(encoding="utf-8"), encoding="utf-8"
    )
    (migrations / "0002_extra.sql").write_text(
        "create table extra_probe (id text primary key) strict;", encoding="utf-8"
    )
    monkeypatch.setattr(db, "MIGRATIONS_DIR", migrations)
    assert db.migrate(settings) == ["0002_extra"]
    assert (tmp_path / "backup.db.bak").exists()
