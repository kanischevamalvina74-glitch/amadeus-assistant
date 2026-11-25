"""Точка входа для упакованного ядра (PyInstaller)."""

from __future__ import annotations

import os
import sys
from pathlib import Path

frozen = getattr(sys, "frozen", False)
script_dir = Path(__file__).resolve().parent
if frozen:
    # В собранном exe каталог скрипта — это каталог распакованного bundles;
    # удалять его из sys.path нельзя, там лежат все модули.
    root = Path(getattr(sys, "_MEIPASS", script_dir))
else:
    root = script_dir.parent
    # Имя core/secrets.py перекрывает stdlib secrets, если каталог скрипта в sys.path.
    sys.path[:] = [p for p in sys.path if not p or Path(p).resolve() != script_dir]
sys.path.insert(0, str(root))

import uvicorn

from core.app import app

if __name__ == "__main__":
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=int(os.getenv("AMADEUS_PORT", "8787")),
        log_level="warning",
    )
