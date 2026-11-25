"""Применение миграций: python -m scripts.migrate [--check]."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.config import Settings  # noqa: E402
from core.db import migrate  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Миграции локальной БД Амадеуса")
    parser.add_argument("--check", action="store_true", help="не применять, только проверить')
    args = parser.parse_args()

    settings = Settings.from_env()
    if args.check:
        from core.db import connect

        with connect(settings) as conn:
            count = conn.execute("select count(*) from schema_migrations").fetchone()[0]
        print(f"Применено миграций: {count}")
        return 0

    applied = migrate(settings)
    print("Применено: " + (", ".join(applied) if applied else "нет новых миграций"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
