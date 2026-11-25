"""Демонстрационные данные. Только вымышленные имена и тексты."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.config import LOCAL_USER_ID, Settings  # noqa: E402
from core import db  # noqa: E402

FIXTURE_USER = "01900000-0000-7000-8000-000000000002"


def main() -> int:
    settings = Settings.from_env()
    db.migrate(settings)
    with db.connect(settings) as conn:
        db.ensure_user(conn, LOCAL_USER_ID)
        db.ensure_user(conn, FIXTURE_USER)
        conn.execute("update user_profile set display_name = ?, locale = ? where id = ?",
                     ("Тестовый профиль", "ru", FIXTURE_USER))
        for key, value in {
            "setup.completed": True,
            "ai.mode": "local",
            "app.locale": "ru",
            "appearance.theme": "dark",
        }.items():
            conn.execute(
                """insert or replace into settings (user_id, key, value_json, updated_at)
                   values (?, ?, ?, ?)""",
                (FIXTURE_USER, key, __import__("json").dumps(value), db.now_iso()),
            )
        conversation_id = db.new_id()
        conn.execute(
            """insert into conversations (id, user_id, title, model_id, created_at, updated_at)
               values (?, ?, ?, ?, ?, ?)""",
            (conversation_id, FIXTURE_USER, "Демо-диалог", settings.ollama_model,
             db.now_iso(), db.now_iso()),
        )
        for role, text in (
            ("user", "Привет! Что ты умеешь делать?"),
            ("assistant", "Я локальный ассистент. Отвечаю на вопросы и работаю с вашим проектом."),
        ):
            conn.execute(
                """insert into messages (id, conversation_id, role, text, status, created_at)
                   values (?, ?, ?, ?, 'done', ?)""",
                (db.new_id(), conversation_id, role, text, db.now_iso()),
            )
    print("Готово: демо-профиль и диалог созданы")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
