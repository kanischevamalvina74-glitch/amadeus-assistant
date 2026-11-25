"""Валидация каждого входа на сервере (аналог zod для локального API)."""

from __future__ import annotations

import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

_KEY_RE = re.compile(r"^[a-z][a-z0-9_.-]{0,63}$")


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class SetupComplete(StrictModel):
    locale: Literal["ru", "en"]
    mode: Literal["local", "cloud", "live"]
    assistant_name: str = Field(default="Амадеус", min_length=1, max_length=64)
    user_name: str = Field(default="", max_length=64)


class SettingsPatch(StrictModel):
    patch: dict[str, Any] = Field(default_factory=dict, max_length=100)

    @field_validator("patch")
    @classmethod
    def check_keys(cls, value: dict[str, Any]) -> dict[str, Any]:
        for key in value:
            if not _KEY_RE.match(key):
                raise ValueError(f"Недопустимый ключ настройки: {key!r}")
        return value


class CredentialSet(StrictModel):
    provider_id: str = Field(min_length=1, max_length=64, pattern=r"^[a-z0-9_.-]+$")
    secret: str = Field(min_length=1, max_length=4096)
    label: str = Field(default="", max_length=120)


class CredentialTest(StrictModel):
    provider_id: str = Field(min_length=1, max_length=64, pattern=r"^[a-z0-9_.-]+$")


class ProviderUpsert(StrictModel):
    stage: Literal["stt", "llm", "tts", "live", "sidecar"]
    provider_id: str = Field(min_length=1, max_length=64, pattern=r"^[a-z0-9_.-]+$")
    base_url: str | None = Field(default=None, max_length=512)
    model_id: str | None = Field(default=None, max_length=128)
    options: dict[str, Any] = Field(default_factory=dict)
    is_active: bool = False

    @field_validator("base_url")
    @classmethod
    def check_url(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if not value.startswith(("http://", "https://")):
            raise ValueError("base_url должен быть http(s)-URL")
        return value.rstrip("/")


class ConversationCreate(StrictModel):
    title: str = Field(default="", max_length=200)


class ConversationRename(StrictModel):
    id: str = Field(pattern=r"^[0-9a-fA-F-]{8,64}$")
    title: str = Field(min_length=1, max_length=200)


class ById(StrictModel):
    id: str = Field(pattern=r"^[0-9a-fA-F-]{8,64}$")


class ApplyProviders(StrictModel):
    mode: Literal["local", "cloud", "live"] = "local"


class MessageSend(StrictModel):
    conversation_id: str = Field(pattern=r"^[0-9a-fA-F-]{8,64}$")
    text: str = Field(min_length=1, max_length=20_000)

    @field_validator("text")
    @classmethod
    def strip_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Текст сообщения пуст")
        return value


class MessageCancel(StrictModel):
    message_id: str = Field(pattern=r"^[0-9a-fA-F-]{8,64}$")


class PermissionPatch(StrictModel):
    scope: Literal[
        "observe_screen", "find_elements", "move_mouse", "click", "type",
        "system", "apps", "files", "terminal", "web",
    ]
    mode: Literal["ask", "approve", "full", "denied"]


class ActionPropose(StrictModel):
    tool: str = Field(min_length=1, max_length=64, pattern=r"^[a-z0-9_.-]+$")
    args: dict[str, Any] = Field(default_factory=dict)
    risk: Literal["low", "medium", "high", "critical"] = "low"
    scope: str | None = Field(default=None, max_length=64)


class ByIdWithReason(StrictModel):
    id: str = Field(pattern=r"^[0-9a-fA-F-]{8,64}$")
    reason: str = Field(default="", max_length=300)


class ReminderCreate(StrictModel):
    title: str = Field(min_length=1, max_length=200)
    due_at: str = Field(min_length=4, max_length=40)
    repeat: str | None = Field(default=None, max_length=80)

    @field_validator("due_at")
    @classmethod
    def check_due(cls, value: str) -> str:
        from datetime import datetime

        try:
            datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError as exc:
            raise ValueError("due_at должен быть ISO-8601") from exc
        return value


class ReminderUpdate(StrictModel):
    id: str = Field(pattern=r"^[0-9a-fA-F-]{8,64}$")
    patch: dict[str, Any] = Field(default_factory=dict, max_length=20)


class TaskUpsert(StrictModel):
    id: str | None = Field(default=None, pattern=r"^[0-9a-fA-F-]{8,64}$")
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=2000)
    status: Literal["todo", "doing", "done", "failed"] = "todo"
    priority: Literal["low", "normal", "high", "urgent"] = "normal"
    due_at: str | None = Field(default=None, max_length=40)


class PluginToggle(StrictModel):
    id: str = Field(pattern=r"^[0-9a-fA-F-]{8,64}$")
    enabled: bool


class PluginConfigSave(StrictModel):
    id: str = Field(pattern=r"^[0-9a-fA-F-]{8,64}$")
    values: dict[str, Any] = Field(default_factory=dict, max_length=50)


class PluginTest(StrictModel):
    id: str = Field(pattern=r"^[0-9a-fA-F-]{8,64}$")
    values: dict[str, Any] = Field(default_factory=dict, max_length=50)


class PluginRun(StrictModel):
    id: str = Field(pattern=r"^[0-9a-fA-F-]{8,64}$")
    action: str = Field(min_length=1, max_length=64, pattern=r"^[a-z0-9_.-]+$")
    params: dict[str, Any] = Field(default_factory=dict, max_length=50)


class LocaleOnly(StrictModel):
    locale: Literal["ru", "en"]


class AttachmentInput(StrictModel):
    name: str = Field(min_length=1, max_length=255)
    mime: str = Field(min_length=1, max_length=128)
    size: int = Field(ge=0, le=5_242_880)
    content_base64: str = Field(min_length=1, max_length=7_000_000)


class StreamBody(StrictModel):
    conversation_id: str = Field(pattern=r"^[0-9a-fA-F-]{8,64}$")
    text: str = Field(min_length=1, max_length=20_000)
    attachments: list[AttachmentInput] = Field(default_factory=list, max_length=5)

    @field_validator("text")
    @classmethod
    def check_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Текст сообщения пуст")
        return value


class MemoryForget(StrictModel):
    id: str | None = Field(default=None, pattern=r"^[0-9a-fA-F-]{8,64}$")


class StreamQuery(StrictModel):
    conversation_id: str = Field(pattern=r"^[0-9a-fA-F-]{8,64}$")
    text: str = Field(min_length=1, max_length=20_000)

    @model_validator(mode="after")
    def strip_text(self) -> "StreamQuery":
        object.__setattr__(self, "text", self.text.strip())
        if not self.text:
            raise ValueError("Текст сообщения пуст")
        return self


# --- Системные действия, проект, поиск, обновления ---------------------------


class SystemVolume(StrictModel):
    level: int | None = Field(default=None, ge=0, le=100)
    delta: int | None = Field(default=None, ge=-100, le=100)
    mute: bool | None = None

    @model_validator(mode="after")
    def exactly_one(self) -> "SystemVolume":
        chosen = [value for value in (self.level, self.delta, self.mute) if value is not None]
        if len(chosen) != 1:
            raise ValueError("Нужно ровно одно из полей: level, delta или mute")
        return self


class SystemPower(StrictModel):
    action: Literal["shutdown", "reboot", "sleep", "lock"]
    confirm: str = Field(min_length=1, max_length=20)


class SystemOpen(StrictModel):
    target: str = Field(min_length=1, max_length=256)


class ScreenshotRequest(StrictModel):
    region: list[int] | None = Field(default=None, max_length=4)

    @field_validator("region")
    @classmethod
    def check_region(cls, value: list[int] | None) -> list[int] | None:
        if value is None:
            return None
        if len(value) != 4:
            raise ValueError("Область должна содержать x, y, ширину и высоту")
        if any(item < 0 or item > 20_000 for item in value):
            raise ValueError("Координаты области вне допустимого диапазона")
        return value


class WorkspaceSet(StrictModel):
    path: str = Field(min_length=2, max_length=1024)
    allow_write: bool = False


class WorkspacePatch(StrictModel):
    allow_write: bool


class FilePath(StrictModel):
    path: str = Field(min_length=1, max_length=1024)


class FileWrite(StrictModel):
    path: str = Field(min_length=1, max_length=1024)
    text: str = Field(max_length=1_000_000)


class FileMove(StrictModel):
    source: str = Field(min_length=1, max_length=1024)
    target: str = Field(min_length=1, max_length=1024)


class RunCommand(StrictModel):
    command: str = Field(min_length=1, max_length=2_000)
    timeout: float = Field(default=30.0, ge=1.0, le=300.0)


class WebSearchQuery(StrictModel):
    query: str = Field(min_length=2, max_length=400)
    count: int = Field(default=5, ge=1, le=10)


class UpdateCheck(StrictModel):
    manifest_url: str = Field(default="", max_length=1024)
    channel: Literal["stable", "beta"] = "stable"


class UpdateInstall(StrictModel):
    url: str = Field(min_length=8, max_length=1024)
    sha256: str = Field(pattern=r"^[0-9a-fA-F]{64}$")


class MemorySummary(StrictModel):
    conversation_id: str = Field(pattern=r"^[0-9a-fA-F-]{8,64}$")


class SettingsImport(StrictModel):
    data: dict[str, Any] = Field(max_length=500)


class ModelSelect(StrictModel):
    provider_id: str = Field(min_length=1, max_length=64, pattern=r"^[a-z0-9_.-]+$")
    model_id: str = Field(min_length=1, max_length=128)
    base_url: str | None = Field(default=None, max_length=512)

    @field_validator("base_url")
    @classmethod
    def check_base(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if not value.startswith(("http://", "https://")):
            raise ValueError("base_url должен быть http(s)-URL")
        return value.rstrip("/")


class VoiceSelect(StrictModel):
    voice_id: str = Field(min_length=1, max_length=200)


class LockSet(StrictModel):
    pin: str = Field(min_length=4, max_length=12, pattern=r"^[0-9]+$")


class LockVerify(StrictModel):
    pin: str = Field(min_length=4, max_length=12, pattern=r"^[0-9]+$")
