"""Запуск дочерних процессов без мигающих окон консоли.

Ядро на Windows собрано без консоли (PyInstaller, console=False). Тогда каждая
консольная утилита (nvidia-smi, powershell, cmd, piper) открывает своё окно cmd,
которое на долю секунды вспыхивает поверх всего. CREATE_NO_WINDOW это гасит.
"""

from __future__ import annotations

import os
import subprocess

NO_WINDOW: dict[str, int] = (
    {"creationflags": getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)} if os.name == "nt" else {}
)
