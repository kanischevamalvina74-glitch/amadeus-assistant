"""Собирает ядро в exe и раскладывает его для Tauri externalBin.

    python packaging/build_sidecar.py

Tauri ищет сайдкар с суффиксом целевой платформы, поэтому после PyInstaller
создаётся копия вида amadeus-core-<target-triple>.exe.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

# В Windows-раннерах GitHub консоль может быть в cp1252, и русский текст в
# логе сборки приводит к UnicodeEncodeError. Явно включаем UTF-8 для вывода.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BACKEND = Path(__file__).resolve().parent.parent
DIST = BACKEND / "dist"


def target_triple() -> str:
    override = os.getenv("AMADEUS_TARGET_TRIPLE")
    if override:
        return override
    rustc = shutil.which("rustc")
    if rustc:
        out = subprocess.check_output([rustc, "-vV"], text=True)
        for line in out.splitlines():
            if line.startswith("host:"):
                return line.split(":", 1)[1].strip()
    if sys.platform == "win32":
        return "x86_64-pc-windows-msvc"
    if sys.platform == "darwin":
        return "aarch64-apple-darwin"
    return "x86_64-unknown-linux-gnu"


def main() -> None:
    subprocess.run(
        [sys.executable, "-m", "PyInstaller", "packaging/amadeus-core.spec", "--noconfirm"],
        cwd=BACKEND,
        check=True,
    )
    suffix = ".exe" if sys.platform == "win32" else ""
    source = DIST / f"amadeus-core{suffix}"
    target = DIST / f"amadeus-core-{target_triple()}{suffix}"
    shutil.copy2(source, target)
    print(f"Сайдкар готов: {target}")


if __name__ == "__main__":
    main()
