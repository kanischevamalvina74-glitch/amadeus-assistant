from __future__ import annotations

import pytest

from core import system


def test_volume_roundtrip(monkeypatch) -> None:
    if not system.IS_WINDOWS:
        pytest.skip("проверяется ветка Windows через подмену winmm")
    monkeypatch.setattr(system, "_windows_volume_get", lambda: 40)
    monkeypatch.setattr(system, "_windows_volume_set", lambda level: True)
    assert system.volume_set(55) == 55
    assert system.volume_step(5) == 45


def test_power_requires_exact_confirmation(monkeypatch) -> None:
    called: list[list[str]] = []
    monkeypatch.setattr(system, "_run", lambda command, timeout=10: called.append(command))  # type: ignore[arg-type]
    with pytest.raises(system.SystemActionError):
        system.power("shutdown", "reboot")
    with pytest.raises(system.SystemActionError):
        system.power("explode", "explode")
    assert called == []


def test_power_builds_known_commands() -> None:
    command = system.power_command("shutdown")
    assert command
    assert all(isinstance(part, str) for part in command)
    with pytest.raises(system.SystemActionError):
        system.power_command("rm -rf")


def test_app_allowlist_blocks_unknown_paths(monkeypatch) -> None:
    opened: list[list[str]] = []
    monkeypatch.setattr(system.subprocess, "Popen", lambda command, **_kwargs: opened.append(command))  # type: ignore[arg-type]
    result = system.open_app("блокнот")
    assert result["ok"] is True
    assert opened
    with pytest.raises(system.SystemActionError):
        system.resolve_app("../../windows/system32/cmd.exe")
    with pytest.raises(system.SystemActionError):
        system.resolve_app("evil.exe")


def test_metrics_shape() -> None:
    data = system.metrics()
    assert 0 <= data["cpu"] <= 100
    assert data["memory"]["total_gb"] > 0
    assert "network" in data
    assert data["platform"]
