# -*- mode: python ; coding: utf-8 -*-
"""Сборка ядра Амадеуса в отдельный exe без системного Python.

    python -m pip install pyinstaller
    cd replica/backend
    pyinstaller packaging/amadeus-core.spec --noconfirm

Результат: dist/amadeus-core.exe — подключить в Tauri через externalBin.
"""

from PyInstaller.utils.hooks import collect_all

datas = []
binaries = []
hiddenimports = []
for package in (
    "uvicorn", "starlette", "fastapi", "pydantic", "httpx", "sqlalchemy",
    "keyring", "silero_vad", "faster_whisper", "torch", "torchaudio",
    "numpy", "psutil", "mss", "piper", "pyttsx3",
):
    try:
        pkg_datas, pkg_binaries, pkg_hidden = collect_all(package)
        datas.extend(pkg_datas)
        binaries.extend(pkg_binaries)
        hiddenimports.extend(pkg_hidden)
    except Exception:
        hiddenimports.append(package)

hiddenimports.extend([
    "core.app", "core.db", "core.config", "core.secrets", "core.streams",
    "core.search", "core.system", "core.updater", "core.validation",
    "core.voice", "core.workspace", "uvicorn.protocols.websockets.auto",
])

# Миграции и встроенные плагины читаются с диска, а не импортируются.
datas.extend([
    ("../migrations", "migrations"),
    ("../plugins", "plugins"),
])

a = Analysis(
    ["../core/launcher.py"],
    pathex=[".."],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter", "matplotlib", "pytest"],
    noarchive=False,
)

pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="amadeus-core",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
