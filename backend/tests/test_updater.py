from __future__ import annotations

import asyncio
import hashlib
from pathlib import Path

import httpx
import pytest

from core import updater


def run(coro):
    return asyncio.run(coro)


MANIFEST = {
    "version": "0.2.0",
    "notes": "Новая версия",
    "channel": "stable",
    "downloads": {
        "windows": {"url": "https://example.test/setup.exe", "sha256": "0" * 64, "size": 10},
        "linux": {"url": "https://example.test/setup.AppImage", "sha256": "0" * 64},
        "macos": {"url": "https://example.test/setup.dmg", "sha256": "0" * 64},
    },
}


def test_check_update_from_manifest() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=MANIFEST)

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    result = run(updater.check_update("https://example.test/latest.json", "0.1.0", client=client))
    run(client.aclose())
    assert result["available"] is True
    assert result["version"] == "0.2.0"
    assert result["asset"]["url"].endswith((".exe", ".dmg", ".AppImage"))


def test_same_version_is_not_offered() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=MANIFEST)

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    result = run(updater.check_update("https://example.test/latest.json", "0.2.0", client=client))
    run(client.aclose())
    assert result["available"] is False


def test_manifest_requires_https() -> None:
    with pytest.raises(updater.UpdateError):
        run(updater.check_update("http://example.test/latest.json", "0.1.0"))


def test_stable_channel_rejects_beta() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={**MANIFEST, "channel": "beta"})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    with pytest.raises(updater.UpdateError):
        run(updater.check_update("https://example.test/latest.json", "0.1.0", "stable", client=client))
    run(client.aclose())


def test_download_verifies_sha256(tmp_path: Path) -> None:
    payload = b"installer-bytes"

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=payload)

    digest = hashlib.sha256(payload).hexdigest()
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    path = run(
        updater.download_update("https://example.test/setup.exe", digest, tmp_path, client=client)
    )
    run(client.aclose())
    assert path.read_bytes() == payload


def test_download_rejects_wrong_hash(tmp_path: Path) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"bad")

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    with pytest.raises(updater.UpdateError):
        run(updater.download_update("https://example.test/setup.exe", "0" * 64, tmp_path, client=client))
    run(client.aclose())
    assert not list(tmp_path.iterdir())


def test_version_parse() -> None:
    assert updater.parse_version("1.2") == (1, 2, 0)
    assert updater.parse_version("0.1.0-beta") == (0, 1, 0)
