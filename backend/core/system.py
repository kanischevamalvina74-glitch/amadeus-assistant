"""Системные действия Амадеуса: громкость, питание, приложения, метрики, скриншоты.

Каждое действие изолировано в одном модуле, чтобы интерфейс и голосовой каскад
не зависели от платформы. Ветки Windows, macOS и Linux разведены явно; на
неподдерживаемой платформе возвращается понятная ошибка, а не падение ядра.
"""

from __future__ import annotations

import ctypes
import io
import os
import platform
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .proc import NO_WINDOW

IS_WINDOWS = os.name == "nt"
IS_MAC = sys.platform == "darwin"

# Разрешённые приложения. Открывать произвольный путь по голосу нельзя:
# это превращает ассистента в способ запустить что угодно без подтверждения.
APP_ALLOWLIST: dict[str, str] = {
    "notepad": "notepad.exe",
    "блокнот": "notepad.exe",
    "calculator": "calc.exe",
    "калькулятор": "calc.exe",
    "explorer": "explorer.exe",
    "проводник": "explorer.exe",
    "terminal": "wt.exe",
    "терминал": "wt.exe",
    "cmd": "cmd.exe",
    "powershell": "powershell.exe",
    "браузер": "https://",
    "browser": "https://",
}

POWER_ACTIONS = {"shutdown", "reboot", "sleep", "lock"}
POWER_DELAY_SECONDS = 15

APP_ALLOWLIST_MAC: dict[str, str] = {
    "notepad": "TextEdit",
    "блокнот": "TextEdit",
    "calculator": "Calculator",
    "калькулятор": "Calculator",
    "terminal": "Terminal",
    "терминал": "Terminal",
    "browser": "Safari",
    "браузер": "Safari",
}

APP_ALLOWLIST_LINUX: dict[str, str] = {
    "notepad": "gedit",
    "блокнот": "gedit",
    "calculator": "gnome-calculator",
    "калькулятор": "gnome-calculator",
    "terminal": "x-terminal-emulator",
    "терминал": "x-terminal-emulator",
    "browser": "xdg-open",
    "браузер": "xdg-open",
}


class SystemActionError(RuntimeError):
    """Понятная пользователю ошибка системного действия."""


def _run(command: list[str], *, timeout: float = 10.0) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
        **NO_WINDOW,
    )


# --- Громкость ---------------------------------------------------------------


def _windows_volume_get() -> int | None:
    try:
        value = ctypes.c_uint32()
        result = ctypes.windll.winmm.waveOutGetVolume(0, ctypes.byref(value))  # type: ignore[attr-defined]
        if result != 0:
            return None
        left = value.value & 0xFFFF
        right = (value.value >> 16) & 0xFFFF
        return round(((left + right) / 2) / 65535 * 100)
    except (AttributeError, OSError):
        return None


def _windows_volume_set(level: int) -> bool:
    try:
        scaled = int(max(0, min(100, level)) / 100 * 65535)
        result = ctypes.windll.winmm.waveOutSetVolume(0, scaled | (scaled << 16))  # type: ignore[attr-defined]
        return result == 0
    except (AttributeError, OSError):
        return False


def volume_get() -> int:
    """Текущая громкость в процентах. 0 — выключено, 100 — максимум."""
    if IS_WINDOWS:
        value = _windows_volume_get()
        if value is not None:
            return value
    elif IS_MAC:
        try:
            result = _run(["osascript", "-e", "output volume of (get volume settings)"])
            return int(result.stdout.strip())
        except (ValueError, OSError, subprocess.SubprocessError):
            pass
    else:
        for command in (
            ["pactl", "get-sink-volume", "@DEFAULT_SINK@"],
            ["amixer", "get", "Master"],
        ):
            if shutil.which(command[0]) is None:
                continue
            try:
                text = _run(command).stdout
                percent = text.split("%")[0].split()[-1] if "%" in text else ""
                return int(percent)
            except (ValueError, OSError, subprocess.SubprocessError):
                continue
    raise SystemActionError("Не удалось прочитать громкость на этой платформе")


def volume_set(level: int) -> int:
    level = max(0, min(100, int(level)))
    if IS_WINDOWS:
        if _windows_volume_set(level):
            return level
    elif IS_MAC:
        if _run(["osascript", "-e", f"set volume output volume {level}"]).returncode == 0:
            return level
    else:
        if shutil.which("pactl"):
            if _run(["pactl", "set-sink-volume", "@DEFAULT_SINK@", f"{level}%"]).returncode == 0:
                return level
        elif shutil.which("amixer"):
            if _run(["amixer", "set", "Master", f"{level}%"]).returncode == 0:
                return level
    raise SystemActionError("Не удалось изменить громкость на этой платформе")


def volume_step(delta: int) -> int:
    return volume_set(volume_get() + int(delta))


def volume_mute() -> int:
    if IS_WINDOWS:
        try:
            # Запоминаем уровень в памяти процесса, чтобы вернуть его после mute.
            global _muted_level
            current = volume_get()
            if current > 0 and _muted_level is None:
                _muted_level = current
            if current > 0:
                volume_set(0)
                return 0
            volume_set(_muted_level or 40)
            _muted_level = None
            return volume_get()
        except SystemActionError:
            raise
    elif IS_MAC:
        script = "set volume output muted true"
        if _run(["osascript", "-e", script]).returncode != 0:
            raise SystemActionError("Не удалось выключить звук")
        return 0
    else:
        if shutil.which("pactl"):
            _run(["pactl", "set-sink-mute", "@DEFAULT_SINK@", "toggle"])
            return volume_get()
        if shutil.which("amixer"):
            _run(["amixer", "set", "Master", "toggle"])
            return volume_get()
    raise SystemActionError("Не удалось выключить звук на этой платформе")


_muted_level: int | None = None


# --- Питание -----------------------------------------------------------------


def power_command(action: str) -> list[str]:
    if action not in POWER_ACTIONS:
        raise SystemActionError(f"Неизвестное действие питания: {action}")
    if IS_WINDOWS:
        if action == "shutdown":
            return ["shutdown", "/s", "/t", str(POWER_DELAY_SECONDS)]
        if action == "reboot":
            return ["shutdown", "/r", "/t", str(POWER_DELAY_SECONDS)]
        if action == "sleep":
            return ["rundll32.exe", "powrprof.dll,SetSuspendState", "0,1,0"]
        return ["rundll32.exe", "user32.dll,LockWorkStation"]
    if IS_MAC:
        return {
            "shutdown": ["osascript", "-e", 'tell app "System Events" to shut down'],
            "reboot": ["osascript", "-e", 'tell app "System Events" to restart'],
            "sleep": ["pmset", "sleepnow"],
            "lock": ["osascript", "-e", 'tell app "System Events" to keystroke "q" using {control down, command down}'],
        }[action]
    if action == "shutdown":
        return ["systemctl", "poweroff"]
    if action == "reboot":
        return ["systemctl", "reboot"]
    if action == "sleep":
        return ["systemctl", "suspend"]
    return ["loginctl", "lock-session"]


def power(action: str, confirm: str) -> dict[str, Any]:
    """Выполняет действие питания только при точном подтверждении действия.

    confirm должен совпадать с action — это защита от случайного голосового
    срабатывания. На Windows команда ставится с задержкой 15 секунд, её можно
    отменить через `shutdown /a`.
    """
    if action not in POWER_ACTIONS:
        raise SystemActionError("Неизвестное действие питания")
    if confirm.strip().lower() != action:
        raise SystemActionError("Подтверждение не совпадает с действием")
    command = power_command(action)
    if action == "lock":
        subprocess.Popen(command)  # noqa: S603 — команда собрана из белого списка
        return {"ok": True, "action": action, "message": "Экран заблокирован"}
    if action == "sleep":
        subprocess.Popen(command)  # noqa: S603
        return {"ok": True, "action": action, "message": "Переход в сон"}
    result = _run(command, timeout=15)
    if result.returncode != 0:
        raise SystemActionError(result.stderr.strip()[:200] or "Команда питания не выполнена")
    return {
        "ok": True,
        "action": action,
        "message": f"Запланировано: {action}. Отмена — «отмени выключение».",
        "cancel_hint": "shutdown /a" if IS_WINDOWS else None,
    }


def power_cancel() -> dict[str, Any]:
    if IS_WINDOWS:
        result = _run(["shutdown", "/a"], timeout=10)
        if result.returncode != 0:
            raise SystemActionError("Нечего отменять")
        return {"ok": True, "message": "Выключение отменено"}
    raise SystemActionError("Отмена доступна только на Windows")


# --- Приложения --------------------------------------------------------------


def app_allowlist() -> dict[str, str]:
    if IS_WINDOWS:
        return APP_ALLOWLIST
    if IS_MAC:
        return APP_ALLOWLIST_MAC
    return APP_ALLOWLIST_LINUX


def resolve_app(name: str) -> str:
    key = name.strip().lower()
    table = app_allowlist()
    if key in table:
        return table[key]
    # Разрешаем только имена без разделителей пути: ./evil.exe не пройдёт.
    if key and all(ch.isalnum() or ch in " ._-" for ch in key) and key in {
        item.lower() for item in table.values()
    }:
        return name
    raise SystemActionError(
        "Приложение не в списке разрешённых. Добавьте его в настройках или откройте вручную."
    )


def open_app(name: str) -> dict[str, Any]:
    target = resolve_app(name)
    if target.startswith("http"):
        import webbrowser

        webbrowser.open(target)
        return {"ok": True, "message": "Открыт браузер"}
    if IS_WINDOWS:
        subprocess.Popen(["cmd", "/c", "start", "", target], **NO_WINDOW)  # noqa: S603
    elif IS_MAC:
        subprocess.Popen(["open", "-a", target])  # noqa: S603
    else:
        subprocess.Popen([target])  # noqa: S603
    return {"ok": True, "message": f"Открыто: {name}"}


# --- Метрики -----------------------------------------------------------------

_last_net: tuple[float, int, int] | None = None


def metrics() -> dict[str, Any]:
    """CPU, память, диск, сеть и, если доступно, GPU/температура."""
    try:
        import psutil
    except ImportError as exc:  # pragma: no cover — зависимость объявлена
        raise SystemActionError("psutil не установлен") from exc

    global _last_net
    cpu = psutil.cpu_percent(interval=None)
    memory = psutil.virtual_memory()
    disk = psutil.disk_usage(str(Path.home().anchor or "/"))
    counters = psutil.net_io_counters()
    now = time.monotonic()
    down = up = 0.0
    if _last_net is not None:
        elapsed = max(now - _last_net[0], 0.001)
        down = max(counters.bytes_recv - _last_net[1], 0) / elapsed
        up = max(counters.bytes_sent - _last_net[2], 0) / elapsed
    _last_net = (now, counters.bytes_recv, counters.bytes_sent)

    temperature = None
    try:
        sensors = getattr(psutil, "sensors_temperatures", lambda: {})()
        for entries in sensors.values():
            if entries:
                temperature = round(entries[0].current, 1)
                break
    except (OSError, AttributeError):
        temperature = None

    gpu = _gpu_usage()
    return {
        "cpu": round(cpu, 1),
        "memory": {
            "percent": round(memory.percent, 1),
            "used_gb": round(memory.used / 1024**3, 1),
            "total_gb": round(memory.total / 1024**3, 1),
        },
        "disk": {"percent": round(disk.percent, 1), "free_gb": round(disk.free / 1024**3, 1)},
        "network": {"down_bps": round(down), "up_bps": round(up)},
        "temperature_c": temperature,
        "gpu_percent": gpu,
        "platform": platform.system(),
        "sampled_at": int(time.time()),
    }


def _gpu_usage() -> float | None:
    if shutil.which("nvidia-smi") is None:
        return None
    try:
        result = _run(
            ["nvidia-smi", "--query-gpu=utilization.gpu", "--format=csv,noheader,nounits"],
            timeout=4,
        )
        if result.returncode != 0:
            return None
        first = result.stdout.strip().splitlines()[0]
        return float(first)
    except (OSError, ValueError, IndexError, subprocess.SubprocessError):
        return None


# --- Скриншот и выделение области -------------------------------------------


def screenshot(region: tuple[int, int, int, int] | None = None) -> bytes:
    """PNG всего экрана или прямоугольника (x, y, width, height)."""
    try:
        import mss
        import mss.tools
    except ImportError as exc:  # pragma: no cover
        raise SystemActionError("mss не установлен") from exc

    with mss.mss() as grabber:
        monitor = grabber.monitors[1]
        if region is not None:
            left, top, width, height = region
            if width < 2 or height < 2:
                raise SystemActionError("Область выделения слишком мала")
            monitor = {"left": int(left), "top": int(top), "width": int(width), "height": int(height)}
        shot = grabber.grab(monitor)
        output = io.BytesIO()
        mss.tools.to_png(shot.rgb, shot.size, output=output)
        return output.getvalue()


# --- Буфер обмена ------------------------------------------------------------


def clipboard_get() -> str:
    if IS_WINDOWS:
        try:
            result = _run(["powershell", "-NoProfile", "-Command", "Get-Clipboard -Raw"], timeout=8)
            return result.stdout.rstrip("\r\n")
        except (OSError, subprocess.SubprocessError):
            pass
    elif IS_MAC:
        try:
            return _run(["pbpaste"], timeout=5).stdout
        except (OSError, subprocess.SubprocessError):
            pass
    else:
        if shutil.which("xclip"):
            try:
                return _run(["xclip", "-selection", "clipboard", "-o"], timeout=5).stdout
            except (OSError, subprocess.SubprocessError):
                pass
    raise SystemActionError("Буфер обмена недоступен на этой платформе")


# --- Автозапуск --------------------------------------------------------------


AUTOSTART_NAME = "Amadeus.lnk"


def autostart_set(enabled: bool, target: str) -> dict[str, Any]:
    if IS_WINDOWS:
        startup = Path(os.getenv("APPDATA", "")) / "Microsoft" / "Windows" / "Start Menu" / "Programs" / "Startup"
        link = startup / AUTOSTART_NAME
        if not enabled:
            link.unlink(missing_ok=True)
            return {"ok": True, "enabled": False}
        startup.mkdir(parents=True, exist_ok=True)
        script = (
            "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('"
            + str(link).replace("'", "''")
            + "');$s.TargetPath='"
            + target.replace("'", "''")
            + "';$s.Save()"
        )
        result = _run(["powershell", "-NoProfile", "-Command", script], timeout=15)
        if result.returncode != 0:
            raise SystemActionError(result.stderr.strip()[:200] or "Не удалось включить автозапуск")
        return {"ok": True, "enabled": True}
    if IS_MAC:
        agents = Path.home() / "Library" / "LaunchAgents"
        plist = agents / "com.amadeus.assistant.plist"
        if not enabled:
            plist.unlink(missing_ok=True)
            return {"ok": True, "enabled": False}
        agents.mkdir(parents=True, exist_ok=True)
        plist.write_text(
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" '
            '"http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
            '<plist version="1.0"><dict><key>Label</key><string>com.amadeus.assistant</string>'
            f"<key>ProgramArguments</key><array><string>{target}</string></array>"
            "<key>RunAtLoad</key><true/></dict></plist>\n",
            encoding="utf-8",
        )
        return {"ok": True, "enabled": True}
    autostart = Path.home() / ".config" / "autostart"
    desktop = autostart / "amadeus.desktop"
    if not enabled:
        desktop.unlink(missing_ok=True)
        return {"ok": True, "enabled": False}
    autostart.mkdir(parents=True, exist_ok=True)
    desktop.write_text(
        "[Desktop Entry]\nType=Application\nName=Amadeus\n"
        f"Exec={target}\nX-GNOME-Autostart-enabled=true\n",
        encoding="utf-8",
    )
    return {"ok": True, "enabled": True}


@dataclass
class SystemInfo:
    platform: str = field(default_factory=platform.system)
    apps: list[str] = field(default_factory=lambda: sorted(app_allowlist()))
