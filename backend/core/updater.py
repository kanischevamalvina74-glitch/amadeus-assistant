"""Автообновление приложения: проверка манифеста, скачивание, проверка SHA-256.

Манифест — обычный JSON на HTTPS (или на локальном стенде разработчика):

    {
      "version": "0.2.0",
      "notes": "Что нового",
      "channel": "stable",
      "downloads": {
        "windows": {"url": "https://.../Amadeus_0.2.0_x64-setup.exe",
                     "sha256": "…", "size": 123456},
        "macos":   {"url": "https://.../Amadeus_0.2.0_universal.dmg", "sha256": "…"},
        "linux":   {"url": "https://.../Amadeus_0.2.0_amd64.AppImage", "sha256": "…"}
      }
    }

Установщик запускается только после совпадения контрольной суммы. Подпись
артефакта проверяется на уровне установщика ОС — здесь мы гарантируем
целостность загрузки.
"""

from __future__ import annotations

import hashlib
import os
import platform
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx

MAX_INSTALLER_BYTES = 1_500_000_000
VERSION_RE = re.compile(r"^\d{1,4}(\.\d{1,4}){1,3}([-+][0-9A-Za-z.-]{1,20})?$")


class UpdateError(RuntimeError):
    """Понятная пользователю ошибка обновления."""


def parse_version(raw: str) -> tuple[int, ...]:
    match = re.match(r"^(\d+(?:\.\d+){0,3})", raw.strip())
    if not match:
        raise UpdateError("Некорректная версия в манифесте")
    parts = [int(item) for item in match.group(1).split(".")]
    while len(parts) < 3:
        parts.append(0)
    return tuple(parts)


def platform_key() -> str:
    system = platform.system().lower()
    if system == "windows":
        return "windows"
    if system == "darwin":
        return "macos"
    return "linux"


def _check_manifest_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme == "https":
        return
    if parsed.scheme == "http" and (parsed.hostname or "") in {"127.0.0.1", "localhost"}:
        return
    raise UpdateError("Манифест обновлений должен быть на HTTPS")


async def check_update(
    manifest_url: str,
    current_version: str,
    channel: str = "stable",
    client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    if not manifest_url:
        raise UpdateError("Не задан адрес манифеста обновлений")
    _check_manifest_url(manifest_url)
    if channel not in {"stable", "beta"}:
        raise UpdateError("Неизвестный канал обновлений")
    owns = client is None
    http = client or httpx.AsyncClient(timeout=httpx.Timeout(15.0, connect=5.0))
    try:
        response = await http.get(manifest_url)
        if response.status_code == 404:
            raise UpdateError("Манифест обновлений не найден")
        response.raise_for_status()
        manifest = response.json()
    except httpx.HTTPError as exc:
        raise UpdateError(f"Сервер обновлений недоступен: {exc.__class__.__name__}") from exc
    except ValueError as exc:
        raise UpdateError("Манифест обновлений повреждён") from exc
    finally:
        if owns:
            await http.aclose()

    version = str(manifest.get("version", ""))
    if not VERSION_RE.match(version):
        raise UpdateError("В манифесте нет корректной версии")
    manifest_channel = str(manifest.get("channel", "stable"))
    if channel == "stable" and manifest_channel != "stable":
        raise UpdateError("В стабильном канале предложен beta-выпуск")

    downloads = manifest.get("downloads") or {}
    asset = downloads.get(platform_key()) or {}
    available = parse_version(version) > parse_version(current_version)
    return {
        "available": available,
        "current_version": current_version,
        "version": version,
        "notes": str(manifest.get("notes", ""))[:4000],
        "channel": manifest_channel,
        "asset": {
            "url": str(asset.get("url", "")),
            "sha256": str(asset.get("sha256", "")).lower(),
            "size": int(asset.get("size", 0) or 0),
        }
        if asset
        else None,
        "platform": platform_key(),
    }


def _check_download_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme == "https":
        return
    if parsed.scheme == "http" and (parsed.hostname or "") in {"127.0.0.1", "localhost"}:
        return
    raise UpdateError("Установщик должен скачиваться по HTTPS")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


async def download_update(
    url: str,
    expected_sha256: str,
    target_dir: Path,
    client: httpx.AsyncClient | None = None,
) -> Path:
    _check_download_url(url)
    if len(expected_sha256) != 64:
        raise UpdateError("В манифесте нет корректной контрольной суммы")
    target_dir.mkdir(parents=True, exist_ok=True)
    name = Path(urlparse(url).path).name or "amadeus-update.bin"
    if not re.fullmatch(r"[0-9A-Za-z._-]{1,120}", name):
        name = "amadeus-update.bin"
    target = target_dir / name
    partial = target.with_suffix(target.suffix + ".part")
    owns = client is None
    http = client or httpx.AsyncClient(timeout=httpx.Timeout(300.0, connect=10.0))
    try:
        async with http.stream("GET", url) as response:
            response.raise_for_status()
            written = 0
            with partial.open("wb") as handle:
                async for block in response.aiter_bytes(1024 * 256):
                    written += len(block)
                    if written > MAX_INSTALLER_BYTES:
                        raise UpdateError("Установщик больше допустимого размера")
                    handle.write(block)
    except httpx.HTTPError as exc:
        partial.unlink(missing_ok=True)
        raise UpdateError(f"Не удалось скачать обновление: {exc.__class__.__name__}") from exc
    finally:
        if owns:
            await http.aclose()

    actual = _sha256(partial)
    if actual != expected_sha256:
        partial.unlink(missing_ok=True)
        raise UpdateError("Контрольная сумма не совпала — загрузка отклонена")
    os.replace(partial, target)
    return target


def install_update(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise UpdateError("Установщик не найден")
    suffix = path.suffix.lower()
    if os.name == "nt":
        if suffix not in {".exe", ".msi"}:
            raise UpdateError("Неизвестный формат установщика Windows")
        subprocess.Popen([str(path)])  # noqa: S603
    elif platform.system() == "Darwin":
        if suffix not in {".dmg", ".pkg"}:
            raise UpdateError("Неизвестный формат установщика macOS")
        subprocess.Popen(["open", str(path)])  # noqa: S603
    else:
        if suffix not in {".appimage", ".deb", ".rpm"}:
            raise UpdateError("Неизвестный формат установщика Linux")
        target = path
        if suffix == ".appimage":
            path.chmod(0o755)
            subprocess.Popen([str(target)])  # noqa: S603
        else:
            subprocess.Popen(["xdg-open", str(target)])  # noqa: S603
    return {"ok": True, "message": "Установщик запущен", "path": str(path)}


def cleanup(target_dir: Path, keep: Path | None = None) -> int:
    if not target_dir.exists():
        return 0
    removed = 0
    for item in target_dir.iterdir():
        if keep is not None and item == keep:
            continue
        if item.is_file():
            item.unlink(missing_ok=True)
            removed += 1
        elif item.is_dir():
            shutil.rmtree(item, ignore_errors=True)
            removed += 1
    return removed
