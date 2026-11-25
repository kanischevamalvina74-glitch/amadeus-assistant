"""Локальное ядро Амадеуса: HTTP-зеркало Tauri IPC + sidecar-стриминг.

Все маршруты работают с единственным пользователем машины и фильтруют
записи по user_id. Секреты не попадают в БД, логи и ответы.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import logging
import os
import re
import time
import webbrowser
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncIterator
from urllib.parse import urlparse

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import ValidationError

from . import db, secrets as secrets_module, streams, voice
from . import search as search_module
from . import system as system_module
from . import updater as updater_module
from . import workspace as workspace_module
from .config import BACKEND_DIR, LOCAL_USER_ID, Settings
from .validation import (
    ActionPropose,
    ApplyProviders,
    ById,
    ByIdWithReason,
    ConversationCreate,
    ConversationRename,
    CredentialSet,
    CredentialTest,
    MessageCancel,
    AttachmentInput,
    FileMove,
    FilePath,
    FileWrite,
    LocaleOnly,
    LockSet,
    LockVerify,
    MemoryForget,
    MemorySummary,
    MessageSend,
    ModelSelect,
    PermissionPatch,
    PluginConfigSave,
    PluginRun,
    PluginTest,
    PluginToggle,
    ProviderUpsert,
    ReminderCreate,
    ReminderUpdate,
    RunCommand,
    ScreenshotRequest,
    SettingsImport,
    SettingsPatch,
    SystemOpen,
    SystemPower,
    SystemVolume,
    TaskUpsert,
    SetupComplete,
    StreamBody,
    StreamQuery,
    UpdateCheck,
    UpdateInstall,
    VoiceSelect,
    WebSearchQuery,
    WorkspacePatch,
    WorkspaceSet,
)

settings = Settings.from_env()
secret_store = secrets_module.make_store(settings)

class RedactFilter(logging.Filter):
    """Гарантия: токены и ключи не попадают в логи."""

    def filter(self, record: logging.LogRecord) -> bool:
        message = re.sub(
            r"(?i)(Bearer\s+)\S+|(sk-[A-Za-z0-9_-]{6,})\S*",
            lambda m: (m.group(1) or "") + "[REDACTED]",
            record.getMessage(),
        )
        record.msg = message
        record.args = ()
        return True


logger = logging.getLogger("amadeus")
logger.setLevel(getattr(logging, settings.log_level, logging.INFO))
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    handler.addFilter(RedactFilter())
    logger.addHandler(handler)

ACTIVE_STREAMS: dict[str, asyncio.Task[Any]] = {}
TEST_CALLS: dict[str, list[float]] = {}
CURRENT_VERSION = "0.1.0"
UPDATES_DIR = settings.db_path.parent / "updates"
PIN_SECRET_ID = "lock-pin"


def _active_llm(conn, user_id: str) -> tuple[dict[str, Any], str]:
    """Активный LLM-провайдер и его ключ. По умолчанию — встроенная Ollama."""
    row = conn.execute(
        """select provider_id, base_url, model_id from provider_configs
           where user_id = ? and stage = 'llm' and is_active = 1
           order by updated_at desc limit 1""",
        (user_id,),
    ).fetchone()
    if row is None:
        return (
            {"provider_id": "ollama", "base_url": "", "model_id": settings.ollama_model},
            "",
        )
    provider = dict(row)
    credential = conn.execute(
        "select secret_ref from api_credentials where user_id = ? and provider_id = ?",
        (user_id, provider["provider_id"]),
    ).fetchone()
    key = secret_store.get(credential["secret_ref"]) if credential else ""
    return provider, key or ""


def _preset(conn, user_id: str) -> str | None:
    value = _setting(conn, user_id, "ai.preset", "default")
    return "coding" if value == "coding" else None


def _workspace_root(conn, user_id: str) -> Path | None:
    raw = _setting(conn, user_id, "workspace.root", None)
    if not raw:
        return None
    try:
        return workspace_module.resolve_root(str(raw))
    except workspace_module.WorkspaceError:
        return None


def _require_workspace(conn, user_id: str) -> workspace_module.Workspace:
    root = _workspace_root(conn, user_id)
    if root is None:
        raise HTTPException(409, "Сначала выберите папку проекта")
    return workspace_module.Workspace(root)


def _require_write(conn, user_id: str) -> workspace_module.Workspace:
    workspace = _require_workspace(conn, user_id)
    if not _setting(conn, user_id, "workspace.allow_write", False):
        raise HTTPException(403, "Изменения в проекте выключены. Включите их в настройках проекта.")
    return workspace


def _pin_verifier(pin: str, salt: bytes) -> str:
    digest = hashlib.scrypt(pin.encode("utf-8"), salt=salt, n=2**14, r=8, p=1, dklen=32)
    return f"{salt.hex()}${digest.hex()}"


def _pin_matches(pin: str, verifier: str) -> bool:
    try:
        salt_hex, digest_hex = verifier.split("$", 1)
        expected = bytes.fromhex(digest_hex)
    except ValueError:
        return False
    actual = hashlib.scrypt(
        pin.encode("utf-8"), salt=bytes.fromhex(salt_hex), n=2**14, r=8, p=1, dklen=32
    )
    return hmac.compare_digest(actual, expected)


async def _reminder_scheduler() -> None:
    """Каждую минуту ищет просроченные напоминания и пишет событие в аудит."""
    while True:
        await asyncio.sleep(60)
        try:
            with db.connect(settings) as conn:
                rows = conn.execute(
                    """select id, user_id, title from reminders
                       where status = 'pending' and due_at <= ?""",
                    (db.now_iso(),),
                ).fetchall()
                for row in rows:
                    conn.execute(
                        "update reminders set status = 'done', updated_at = ? where id = ?",
                        (db.now_iso(), row["id"]),
                    )
                    conn.execute(
                        """insert into audit_events (id, user_id, kind, payload_json, created_at)
                           values (?, ?, 'reminder_due', ?, ?)""",
                        (db.new_id(), row["user_id"],
                         json.dumps({"title": row["title"][:200]}, ensure_ascii=False), db.now_iso()),
                    )
        except Exception as exc:  # фоновый цикл не должен ронять ядро
            logger.warning("Ошибка планировщика напоминаний: %s", _safe_error(exc))


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    applied = db.migrate(settings)
    if applied:
        logger.info("Применены миграции: %s", ", ".join(applied))
    scheduler = asyncio.create_task(_reminder_scheduler())
    try:
        yield
    finally:
        scheduler.cancel()


app = FastAPI(title="Amadeus core", version="0.1.0", lifespan=lifespan)


@app.middleware("http")
async def security_headers_and_log(request: Request, call_next):
    # В логи не попадают query string и тела запросов — там могут быть личные данные.
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Cache-Control"] = "no-store"
    logger.info("%s %s -> %s", request.method, request.url.path, response.status_code)
    return response


@app.exception_handler(ValidationError)
async def validation_handler(_: Request, exc: ValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={"code": "validation_error", "message": "Некорректный ввод", "details": exc.errors(include_url=False)},
    )


def current_user(x_amadeus_user_id: str | None = Header(default=None)) -> str:
    """В проде заголовок игнорируется; в dev-режиме позволяет проверить изоляцию."""
    if settings.allow_user_override and x_amadeus_user_id:
        if not re.fullmatch(r"[0-9a-fA-F-]{8,64}", x_amadeus_user_id):
            raise HTTPException(400, "Некорректный user id")
        return x_amadeus_user_id
    return LOCAL_USER_ID


def _setting(conn, user_id: str, key: str, default: Any = None) -> Any:
    row = conn.execute(
        "select value_json from settings where user_id = ? and key = ?", (user_id, key)
    ).fetchone()
    return json.loads(row["value_json"]) if row else default


def _set_setting(conn, user_id: str, key: str, value: Any) -> None:
    conn.execute(
        """insert into settings (user_id, key, value_json, updated_at) values (?, ?, ?, ?)
           on conflict (user_id, key) do update set value_json = excluded.value_json,
           updated_at = excluded.updated_at""",
        (user_id, key, json.dumps(value, ensure_ascii=False), db.now_iso()),
    )


def _conversation(conn, user_id: str, conversation_id: str):
    row = conn.execute(
        "select * from conversations where id = ? and user_id = ?",
        (conversation_id, user_id),
    ).fetchone()
    if row is None:
        raise HTTPException(404, "Диалог не найден")
    return row


def _history(conn, conversation_id: str) -> list[dict[str, str]]:
    rows = conn.execute(
        """select role, text from (
             select role, text, created_at from messages
             where conversation_id = ? and status = 'done' and text <> ''
             order by created_at desc limit 16
           ) order by created_at asc""",
        (conversation_id,),
    ).fetchall()
    return [{"role": row["role"], "content": row["text"]} for row in rows]


def _safe_error(error: Exception) -> str:
    text = str(error).splitlines()[0] if str(error) else error.__class__.__name__
    return text[:300]


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "version": "0.1.0",
        "db": str(settings.db_path),
        "mode": "local",
        "ollama": {"url": settings.ollama_base_url, "model": settings.ollama_model},
        "secrets": "keychain" if settings.secret_store == "keyring" else "memory",
    }


# --- Setup и настройки -------------------------------------------------------

@app.get("/api/setup.status")
def setup_status(user_id: str = Depends(current_user)) -> dict[str, Any]:
    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        row = conn.execute("select locale from user_profile where id = ?", (user_id,)).fetchone()
        return {
            "needsSetup": _setting(conn, user_id, "setup.completed", False) is not True,
            "locale": row["locale"] if row else "ru",
            "mode": _setting(conn, user_id, "ai.mode", "local"),
        }


@app.post("/api/setup.complete")
def setup_complete(body: SetupComplete, user_id: str = Depends(current_user)) -> dict[str, bool]:
    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        conn.execute(
            "update user_profile set locale = ?, assistant_name = ?, user_name = ? where id = ?",
            (body.locale, body.assistant_name, body.user_name, user_id),
        )
        _set_setting(conn, user_id, "setup.completed", True)
        _set_setting(conn, user_id, "ai.mode", body.mode)
        _set_setting(conn, user_id, "app.locale", body.locale)
    return {"ok": True}


@app.get("/api/settings.get")
def settings_get(keys: str | None = None, user_id: str = Depends(current_user)) -> dict[str, Any]:
    wanted = [k.strip() for k in keys.split(",") if k.strip()] if keys else None
    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        rows = conn.execute("select key, value_json from settings where user_id = ?", (user_id,))
        result = {row["key"]: json.loads(row["value_json"]) for row in rows}
    if wanted is not None:
        result = {k: result[k] for k in wanted if k in result}
    return result


@app.post("/api/settings.patch")
def settings_patch(body: SettingsPatch, user_id: str = Depends(current_user)) -> dict[str, Any]:
    restart_keys = {"ai.mode", "app.locale", "voice.input_device", "voice.output_device"}
    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        for key, value in body.patch.items():
            _set_setting(conn, user_id, key, value)
    return {"ok": True, "requiresRestart": bool(restart_keys.intersection(body.patch))}


@app.post("/api/settings.locale")
def settings_locale(body: LocaleOnly, user_id: str = Depends(current_user)) -> dict[str, bool]:
    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        conn.execute("update user_profile set locale = ? where id = ?", (body.locale, user_id))
        _set_setting(conn, user_id, "app.locale", body.locale)
    return {"ok": True}


# --- Ключи и провайдеры ------------------------------------------------------

@app.post("/api/credentials.set")
def credentials_set(body: CredentialSet, user_id: str = Depends(current_user)) -> dict[str, str]:
    secret_ref = secret_store.set(body.provider_id, body.secret)
    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        conn.execute(
            """insert into api_credentials
                 (id, user_id, provider_id, label, secret_ref, status, created_at, updated_at)
               values (?, ?, ?, ?, ?, 'unknown', ?, ?)
               on conflict (user_id, provider_id) do update set
                 secret_ref = excluded.secret_ref,
                 label = excluded.label,
                 status = 'unknown',
                 updated_at = excluded.updated_at""",
            (
                db.new_id(), user_id, body.provider_id, body.label, secret_ref,
                db.now_iso(), db.now_iso(),
            ),
        )
    return {"secretRef": secret_ref}


def _throttled(key: str) -> bool:
    now = time.monotonic()
    hits = [t for t in TEST_CALLS.get(key, []) if now - t < 60]
    TEST_CALLS[key] = [*hits, now]
    return len(hits) >= 10


@app.post("/api/credentials.test")
async def credentials_test(body: CredentialTest, user_id: str = Depends(current_user)) -> dict[str, Any]:
    if _throttled(f"{user_id}:{body.provider_id}"):
        raise HTTPException(429, "Слишком много проверок ключа")
    if body.provider_id in {"ollama", "local"}:
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                response = await client.get(f"{settings.ollama_base_url}/api/tags")
                response.raise_for_status()
                count = len(response.json().get("models", []))
            return {"ok": True, "code": "ok", "message": f"Ollama доступна, моделей: {count}"}
        except httpx.HTTPError as exc:
            return {"ok": False, "code": "unreachable", "message": _safe_error(exc)}

    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        credential = conn.execute(
            "select secret_ref from api_credentials where user_id = ? and provider_id = ?",
            (user_id, body.provider_id),
        ).fetchone()
        provider = conn.execute(
            """select base_url from provider_configs
               where user_id = ? and provider_id = ? and is_active = 1 limit 1""",
            (user_id, body.provider_id),
        ).fetchone()
    if credential is None:
        return {"ok": False, "code": "no_credential", "message": "Ключ не сохранён"}
    secret = secret_store.get(credential["secret_ref"])
    if not secret:
        return {"ok": False, "code": "no_secret", "message": "Секрет недоступен в keychain"}
    if provider is None or not provider["base_url"]:
        return {"ok": False, "code": "no_base_url", "message": "Не настроен base_url провайдера"}
    host = urlparse(provider["base_url"]).hostname or ""
    if not settings.is_allowed_provider_host(host):
        return {
            "ok": False,
            "code": "host_not_allowed",
            "message": "Хост не в AMADEUS_PROVIDER_ALLOWLIST",
        }
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            response = await client.get(
                f"{provider['base_url']}/v1/models",
                headers={"Authorization": f"Bearer {secret}"},
            )
        codes = {401: "invalid_key", 403: "forbidden", 429: "rate_limited"}
        return {
            "ok": response.is_success,
            "code": codes.get(response.status_code, "ok" if response.is_success else "http_error"),
            "message": "Ключ принят" if response.is_success else f"HTTP {response.status_code}",
        }
    except httpx.HTTPError as exc:
        return {"ok": False, "code": "unreachable", "message": _safe_error(exc)}


@app.get("/api/providers.list")
def providers_list(stage: str | None = None, user_id: str = Depends(current_user)) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = [
        {"id": "ollama", "stage": "llm", "provider_id": "ollama", "model_id": settings.ollama_model,
         "base_url": settings.ollama_base_url, "is_active": True, "builtin": True}
    ]
    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        rows = conn.execute(
            "select * from provider_configs where user_id = ? order by stage", (user_id,)
        )
        items += [
            {
                "id": row["id"], "stage": row["stage"], "provider_id": row["provider_id"],
                "base_url": row["base_url"], "model_id": row["model_id"],
                "options": json.loads(row["options_json"]), "is_active": bool(row["is_active"]),
                "builtin": False,
            }
            for row in rows
        ]
    return [item for item in items if stage is None or item["stage"] == stage]


@app.post("/api/providers.upsert")
def providers_upsert(body: ProviderUpsert, user_id: str = Depends(current_user)) -> dict[str, Any]:
    if body.base_url:
        host = urlparse(body.base_url).hostname or ""
        if not settings.is_allowed_provider_host(host):
            raise HTTPException(400, "Хост не в AMADEUS_PROVIDER_ALLOWLIST")
    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        if body.is_active:
            conn.execute(
                "update provider_configs set is_active = 0 where user_id = ? and stage = ?",
                (user_id, body.stage),
            )
        existing = conn.execute(
            "select id from provider_configs where user_id = ? and stage = ? and provider_id = ?",
            (user_id, body.stage, body.provider_id),
        ).fetchone()
        provider_id = existing["id"] if existing else db.new_id()
        conn.execute(
            """insert into provider_configs
                 (id, user_id, stage, provider_id, base_url, model_id, options_json, is_active, created_at, updated_at)
               values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               on conflict (id) do update set base_url = excluded.base_url, model_id = excluded.model_id,
                 options_json = excluded.options_json, is_active = excluded.is_active,
                 updated_at = excluded.updated_at""",
            (provider_id, user_id, body.stage, body.provider_id, body.base_url, body.model_id,
             json.dumps(body.options, ensure_ascii=False), int(body.is_active), db.now_iso(), db.now_iso()),
        )
    return {"id": provider_id, "ok": True}


@app.post("/api/providers.apply")
def providers_apply(body: ApplyProviders, user_id: str = Depends(current_user)) -> dict[str, bool]:
    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        _set_setting(conn, user_id, "ai.mode", body.mode)
    return {"ok": True, "reconnected": True}


# --- Диалоги и сообщения -----------------------------------------------------

@app.get("/api/conversations.list")
def conversations_list(archived: bool = False, user_id: str = Depends(current_user)) -> list[dict[str, Any]]:
    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        rows = conn.execute(
            """select id, title, model_id, created_at, updated_at, archived_at from conversations
               where user_id = ? and (archived_at is not null) = ? order by updated_at desc""",
            (user_id, int(archived)),
        ).fetchall()
        return [dict(row) for row in rows]


@app.post("/api/conversations.create")
def conversations_create(body: ConversationCreate, user_id: str = Depends(current_user)) -> dict[str, Any]:
    conversation_id = db.new_id()
    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        conn.execute(
            """insert into conversations (id, user_id, title, model_id, created_at, updated_at)
               values (?, ?, ?, ?, ?, ?)""",
            (conversation_id, user_id, body.title, settings.ollama_model, db.now_iso(), db.now_iso()),
        )
    return {"id": conversation_id, "title": body.title}


@app.post("/api/conversations.rename")
def conversations_rename(body: ConversationRename, user_id: str = Depends(current_user)) -> dict[str, bool]:
    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        _conversation(conn, user_id, body.id)
        conn.execute("update conversations set title = ? where id = ? and user_id = ?",
                     (body.title, body.id, user_id))
    return {"ok": True}


@app.post("/api/conversations.delete")
def conversations_delete(body: ById, user_id: str = Depends(current_user)) -> dict[str, bool]:
    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        _conversation(conn, user_id, body.id)
        conn.execute("delete from conversations where id = ? and user_id = ?", (body.id, user_id))
    return {"ok": True}


@app.get("/api/messages.list")
def messages_list(conversation_id: str, user_id: str = Depends(current_user)) -> list[dict[str, Any]]:
    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        _conversation(conn, user_id, conversation_id)
        rows = conn.execute(
            """select id, role, text, status, model_id, error, created_at from messages
               where conversation_id = ? order by created_at asc""",
            (conversation_id,),
        ).fetchall()
        return [dict(row) for row in rows]


def _insert_message(conn, conversation_id: str, role: str, text: str, status: str = "done") -> str:
    message_id = db.new_id()
    conn.execute(
        """insert into messages (id, conversation_id, role, text, status, model_id, created_at)
           values (?, ?, ?, ?, ?, ?, ?)""",
        (message_id, conversation_id, role, text, status, settings.ollama_model, db.now_iso()),
    )
    conn.execute("update conversations set updated_at = ? where id = ?", (db.now_iso(), conversation_id))
    return message_id


@app.post("/api/messages.send")
async def messages_send(body: MessageSend, user_id: str = Depends(current_user)) -> dict[str, Any]:
    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        _conversation(conn, user_id, body.conversation_id)
        _insert_message(conn, body.conversation_id, "user", body.text)
        history = _history(conn, body.conversation_id)

    answer = ""
    try:
        async for chunk in streams.ollama_chat(settings, history, stream=False):
            answer += chunk
    except (httpx.HTTPError, RuntimeError) as exc:
        raise HTTPException(502, f"Модель недоступна: {_safe_error(exc)}") from exc
    if not answer.strip():
        raise HTTPException(502, "Модель вернула пустой ответ")

    with db.connect(settings) as conn:
        message_id = _insert_message(conn, body.conversation_id, "assistant", answer.strip())
    return {"messageId": message_id, "text": answer.strip()}


@app.post("/api/messages.cancel")
def messages_cancel(body: MessageCancel, user_id: str = Depends(current_user)) -> dict[str, bool]:
    task = ACTIVE_STREAMS.get(body.message_id)
    if task is not None:
        task.cancel()
    return {"ok": task is not None}


ATTACH_DIR = settings.db_path.parent / "attachments"


def _save_attachments(conn, message_id: str, items: list[AttachmentInput]) -> list[tuple[str, str]]:
    """Файлы лежат отдельно от БД; возвращает извлечённый текст для модели."""
    import base64

    extracted_items: list[tuple[str, str]] = []
    ATTACH_DIR.mkdir(parents=True, exist_ok=True)
    for item in items:
        try:
            raw = base64.b64decode(item.content_base64, validate=True)
        except Exception as exc:
            raise HTTPException(422, "Некорректный base64 во вложении") from exc
        if len(raw) != item.size:
            raise HTTPException(422, "Размер вложения не совпадает")
        attachment_id = db.new_id()
        path = ATTACH_DIR / attachment_id
        path.write_bytes(raw)
        extracted_ref = None
        if item.mime.startswith("text/") or item.mime in {"application/json", "application/xml"}:
            try:
                extracted = raw.decode("utf-8")[:50_000]
            except UnicodeDecodeError:
                extracted = ""
            if extracted:
                text_path = path.with_suffix(".txt")
                text_path.write_text(extracted, encoding="utf-8")
                extracted_ref = str(text_path)
                extracted_items.append((item.name, extracted[:20_000]))
        conn.execute(
            """insert into attachments
                 (id, message_id, kind, file_name, mime, size, storage_ref, extracted_text_ref, status, created_at)
               values (?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?)""",
            (attachment_id, message_id, "file", item.name[:255], item.mime[:128], item.size,
             str(path), extracted_ref, db.now_iso()),
        )
    return extracted_items


def _prepare_stream(
    conversation_id: str, text: str, user_id: str, attachments: list[AttachmentInput]
) -> tuple[str, list[dict[str, str]], dict[str, Any], str, str | None]:
    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        _conversation(conn, user_id, conversation_id)
        user_message_id = _insert_message(conn, conversation_id, "user", text)
        extracted = _save_attachments(conn, user_message_id, attachments) if attachments else []
        assistant_id = _insert_message(conn, conversation_id, "assistant", "", "streaming")
        history = _history(conn, conversation_id)
        if extracted:
            body = "\n\n".join(f"--- {name} ---\n{value}" for name, value in extracted)
            history.append({"role": "system", "content": f"Содержимое вложений:\n{body}"})
        provider, api_key = _active_llm(conn, user_id)
        preset = _preset(conn, user_id)
    return assistant_id, history, provider, api_key, preset


def _stream_response(
    assistant_id: str,
    history: list[dict[str, str]],
    provider: dict[str, Any],
    api_key: str,
    preset: str | None,
) -> StreamingResponse:
    def sse(event: str, payload: dict[str, Any]) -> str:
        return "event: " + event + "\ndata: " + json.dumps(payload, ensure_ascii=False) + "\n\n"

    async def generate() -> AsyncIterator[str]:
        task = asyncio.current_task()
        if task is not None:
            ACTIVE_STREAMS[assistant_id] = task
        buffer = ""
        status = "streaming"
        error_text: str | None = None
        try:
            async for chunk in streams.chat(
                settings,
                history,
                stream=True,
                provider=provider,
                api_key=api_key,
                preset=preset,
            ):
                buffer += chunk
                yield sse("delta", {"messageId": assistant_id, "delta": chunk})
            status = "done"
            yield sse("done", {"messageId": assistant_id, "text": buffer.strip()})
        except asyncio.CancelledError:
            # Отменённый генератор не должен ничего yield-ить: клиент уже ушёл.
            status = "canceled"
            raise
        except Exception as exc:
            status = "error"
            error_text = _safe_error(exc)
            yield sse("error", {"messageId": assistant_id, "message": error_text})
        finally:
            ACTIVE_STREAMS.pop(assistant_id, None)
            # Финализируем запись в любом исходе, включая отмену и обрыв соединения.
            with db.connect(settings) as conn:
                conn.execute(
                    "update messages set text = ?, status = ?, error = ? where id = ?",
                    (buffer.strip(), status, error_text, assistant_id),
                )

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/api/v1/chat/stream")
async def chat_stream(conversation_id: str, text: str, user_id: str = Depends(current_user)) -> StreamingResponse:
    query = StreamQuery(conversation_id=conversation_id, text=text)
    assistant_id, history, provider, api_key, preset = _prepare_stream(
        query.conversation_id, query.text, user_id, []
    )
    return _stream_response(assistant_id, history, provider, api_key, preset)


@app.post("/api/v1/chat/stream")
async def chat_stream_with_files(body: StreamBody, user_id: str = Depends(current_user)) -> StreamingResponse:
    assistant_id, history, provider, api_key, preset = _prepare_stream(
        body.conversation_id, body.text, user_id, body.attachments
    )
    return _stream_response(assistant_id, history, provider, api_key, preset)


# --- Голосовая сессия (F02, F03, F21) ---------------------------------------

@app.websocket("/ws/voice")
async def voice_session(websocket: WebSocket, user_id: str = Depends(current_user)) -> None:
    """Живая сессия: бинарные аудиокадры PCM16 → события VAD/STT/TTS, barge-in."""
    await websocket.accept()
    with db.connect(settings) as conn:  # профиль создаётся лениво
        db.ensure_user(conn, user_id)

    async def emit(event: voice.VoiceEvent) -> None:
        await websocket.send_text(event.as_json())

    conversation_id = websocket.query_params.get("conversation_id")

    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        provider, api_key = _active_llm(conn, user_id)
        preset = _preset(conn, user_id)
        voice_id = _setting(conn, user_id, "voice.tts_voice", None)

    async def reply(text: str) -> str:
        answer = ""
        async for chunk in streams.chat(
            settings,
            [{"role": "user", "content": text}],
            stream=False,
            provider=provider,
            api_key=api_key,
            preset=preset,
        ):
            answer += chunk
        if not answer.strip():
            raise RuntimeError("модель вернула пустой ответ")
        if conversation_id:
            with db.connect(settings) as conn:
                owned = conn.execute(
                    "select id from conversations where id = ? and user_id = ?",
                    (conversation_id, user_id),
                ).fetchone()
                if owned:
                    _insert_message(conn, conversation_id, "user", text)
                    _insert_message(conn, conversation_id, "assistant", answer.strip())
        return answer.strip()

    pipeline = voice.build_pipeline(settings, reply, emit, voice_id=str(voice_id) if voice_id else None)
    buffer = bytearray()
    silence_frames = 0
    active_task: asyncio.Task | None = None

    try:
        while True:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                break
            if message.get("bytes"):
                frame = message["bytes"]
                await pipeline.on_frame(frame)
                buffer.extend(frame)
                if pipeline.vad.is_speech(frame):
                    silence_frames = 0
                else:
                    silence_frames += 1
                if silence_frames >= 25 and buffer and (active_task is None or active_task.done()):
                    pcm = bytes(buffer)
                    buffer.clear()
                    silence_frames = 0
                    active_task = asyncio.create_task(pipeline.process_utterance(pcm))
            elif message.get("text"):
                try:
                    command = json.loads(message["text"])
                except json.JSONDecodeError:
                    continue
                if command.get("type") == "cancel" and active_task:
                    active_task.cancel()
                    active_task = None
                    await emit(voice.VoiceEvent("canceled"))
                elif command.get("type") == "text" and (active_task is None or active_task.done()):
                    active_task = asyncio.create_task(
                        pipeline.process_text(str(command.get("text", "")))
                    )
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        await emit(voice.VoiceEvent("error", {"message": _safe_error(exc)}))
    finally:
        if active_task and not active_task.done():
            active_task.cancel()


@app.websocket("/ws/wake")
async def wake_session(websocket: WebSocket) -> None:
    """Локальный wake-word: энергетический VAD → Whisper → поиск «Амадеус».

    Браузер держит микрофон включённым и шлёт PCM16 20 мс. Распознавание
    запускается только после паузы, поэтому процессор не занят постоянно.
    """
    await websocket.accept()
    vad_mode = os.getenv("AMADEUS_VAD", "energy")
    vad = voice.SileroVAD() if vad_mode == "silero" else voice.EnergyVAD()
    stt = voice.shared_stt()
    buffer = bytearray()
    silence = 0
    last_check = 0.0
    task: asyncio.Task | None = None

    async def detect(pcm: bytes) -> None:
        nonlocal last_check
        try:
            text = await stt.transcribe(pcm)
        except Exception as exc:
            await websocket.send_text(
                voice.VoiceEvent("error", {"message": _safe_error(exc)}).as_json()
            )
            return
        last_check = time.monotonic()
        if voice.has_wake_word(text):
            await websocket.send_text(
                voice.VoiceEvent("wake", {"text": text[:200]}).as_json()
            )
        else:
            await websocket.send_text(voice.VoiceEvent("heard", {"text": text[:120]}).as_json())

    try:
        while True:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                break
            frame = message.get("bytes")
            if not frame:
                continue
            if vad.is_speech(frame):
                silence = 0
                if len(buffer) < voice.SAMPLE_RATE * 2 * 8:
                    buffer.extend(frame)
            else:
                silence += 1
                if buffer:
                    buffer.extend(frame)
            ready = len(buffer) >= voice.SAMPLE_RATE * 2 // 4 and (
                (silence >= 15 and len(buffer) >= voice.SAMPLE_RATE * 2 // 2)
                or len(buffer) >= voice.SAMPLE_RATE * 2 * 6
            )
            if ready and (task is None or task.done()):
                if time.monotonic() - last_check < 0.7:
                    buffer.clear()
                    silence = 0
                    continue
                pcm = bytes(buffer)
                buffer.clear()
                silence = 0
                task = asyncio.create_task(detect(pcm))
    except WebSocketDisconnect:
        pass
    finally:
        if task and not task.done():
            task.cancel()


# --- Плагины v1 (S16, S17, F13) ---------------------------------------------

SHIPPED_PLUGINS = BACKEND_DIR / "plugins"
USER_PLUGINS = settings.db_path.parent / "plugins"
ALLOWED_PLUGIN_PERMISSIONS = {"memory.read", "memory.write", "notify"}


def _plugin_id(name: str) -> str:
    import uuid

    return str(uuid.uuid5(uuid.NAMESPACE_DNS, f"amadeus-plugin:{name}"))


def _load_manifests() -> list[dict[str, Any]]:
    """Только манифесты. Исполняемый код плагинов появится с изолированным процессом."""
    result: list[dict[str, Any]] = []
    for root in (SHIPPED_PLUGINS, USER_PLUGINS):
        if not root.exists():
            continue
        for file in sorted(root.glob("*/plugin.json")):
            name = file.parent.name
            try:
                manifest = json.loads(file.read_text(encoding="utf-8"))
                for key in ("name", "version", "description", "entrypoint"):
                    if not isinstance(manifest.get(key), str) or not manifest[key]:
                        raise ValueError(f"в манифесте нет поля {key}")
                permissions = manifest.get("permissions", [])
                if not isinstance(permissions, list) or not set(permissions) <= ALLOWED_PLUGIN_PERMISSIONS:
                    raise ValueError("запрошено неизвестное разрешение плагина")
                if manifest["name"] != name:
                    raise ValueError("имя папки не совпадает с name в манифесте")
                result.append({"manifest": manifest, "broken_reason": None})
            except Exception as exc:
                result.append({"manifest": {"name": name}, "broken_reason": _safe_error(exc)})
    return result


def _plugin_row(conn, plugin_id: str, user_id: str):
    row = conn.execute("select * from plugins where id = ?", (plugin_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "Плагин не найден")
    return row


@app.get("/api/plugins.list")
def plugins_list(user_id: str = Depends(current_user)) -> list[dict[str, Any]]:
    items = _load_manifests()
    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        output: list[dict[str, Any]] = []
        for item in items:
            manifest = item["manifest"]
            plugin_id = _plugin_id(manifest["name"])
            conn.execute(
                """insert into plugins
                     (id, name, version, description, entrypoint, manifest_json, permissions_json,
                      enabled, broken_reason, installed_at)
                   values (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
                   on conflict (id) do update set version = excluded.version,
                     description = excluded.description, manifest_json = excluded.manifest_json,
                     permissions_json = excluded.permissions_json, broken_reason = excluded.broken_reason""",
                (plugin_id, manifest["name"], manifest.get("version", "0"),
                 manifest.get("description", ""), manifest.get("entrypoint", ""),
                 json.dumps(manifest, ensure_ascii=False),
                 json.dumps(manifest.get("permissions", [])), item["broken_reason"], db.now_iso()),
            )
            row = conn.execute("select enabled, broken_reason from plugins where id = ?", (plugin_id,)).fetchone()
            output.append({
                "id": plugin_id,
                "name": manifest["name"],
                "version": manifest.get("version", "0"),
                "description": manifest.get("description", ""),
                "permissions": manifest.get("permissions", []),
                "config_schema": manifest.get("config_schema", []),
                "actions": [action["name"] for action in manifest.get("actions", [])],
                "enabled": bool(row["enabled"]),
                "broken_reason": row["broken_reason"],
            })
        return output


@app.post("/api/plugins.toggle")
def plugins_toggle(body: PluginToggle, user_id: str = Depends(current_user)) -> dict[str, Any]:
    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        row = _plugin_row(conn, body.id, user_id)
        if row["broken_reason"]:
            raise HTTPException(409, f"Плагин сломан: {row['broken_reason']}")
        conn.execute("update plugins set enabled = ? where id = ?", (int(body.enabled), body.id))
    return {"ok": True, "enabled": body.enabled}


def _manifest_for(conn, plugin_id: str) -> dict[str, Any]:
    row = _plugin_row(conn, plugin_id, LOCAL_USER_ID)
    return json.loads(row["manifest_json"])


def _plugin_values(conn, plugin_id: str, user_id: str, schema: list[dict[str, Any]]) -> dict[str, Any]:
    row = conn.execute(
        "select config_json from plugin_configs where plugin_id = ? and user_id = ?",
        (plugin_id, user_id),
    ).fetchone()
    values = json.loads(row["config_json"]) if row else {}
    for field in schema:
        key = field.get("key")
        if key and key not in values:
            values[key] = field.get("default")
    return values


@app.get("/api/plugins.config")
def plugins_config(id: str, user_id: str = Depends(current_user)) -> dict[str, Any]:
    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        manifest = _manifest_for(conn, id)
        return {"schema": manifest.get("config_schema", []),
                "values": _plugin_values(conn, id, user_id, manifest.get("config_schema", []))}


@app.post("/api/plugins.saveConfig")
def plugins_save_config(body: PluginConfigSave, user_id: str = Depends(current_user)) -> dict[str, bool]:
    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        _plugin_row(conn, body.id, user_id)
        conn.execute(
            """insert into plugin_configs (id, plugin_id, user_id, config_json, updated_at)
               values (?, ?, ?, ?, ?)
               on conflict (plugin_id, user_id) do update set config_json = excluded.config_json,
                 updated_at = excluded.updated_at""",
            (db.new_id(), body.id, user_id, json.dumps(body.values, ensure_ascii=False), db.now_iso()),
        )
    return {"ok": True}


def _run_plugin_action(conn, plugin_id: str, user_id: str, action_name: str, params: dict[str, Any]) -> dict[str, Any]:
    manifest = _manifest_for(conn, plugin_id)
    row = _plugin_row(conn, plugin_id, user_id)
    if row["broken_reason"]:
        raise HTTPException(409, "Плагин сломан")
    if not row["enabled"]:
        raise HTTPException(409, "Плагин выключен")
    action = next((item for item in manifest.get("actions", []) if item.get("name") == action_name), None)
    run_id = db.new_id()
    if action is None:
        conn.execute(
            """insert into plugin_runs (id, plugin_id, action, status, error, started_at, finished_at)
               values (?, ?, ?, 'failed', ?, ?, ?)""",
            (run_id, plugin_id, action_name, "unknown action", db.now_iso(), db.now_iso()),
        )
        raise HTTPException(404, f"У плагина нет действия {action_name}")
    values = _plugin_values(conn, plugin_id, user_id, manifest.get("config_schema", []))
    prefix = str(values.get("prefix", ""))
    result = str(action.get("result", ""))
    message = f"{prefix}: {result}" if prefix else result
    conn.execute(
        """insert into plugin_runs (id, plugin_id, action, status, result_json, started_at, finished_at)
           values (?, ?, ?, 'done', ?, ?, ?)""",
        (run_id, plugin_id, action_name, json.dumps({"message": message}, ensure_ascii=False),
         db.now_iso(), db.now_iso()),
    )
    return {"ok": True, "message": message}


@app.post("/api/plugins.test")
def plugins_test(body: PluginTest, user_id: str = Depends(current_user)) -> dict[str, Any]:
    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        if body.values:
            conn.execute(
                """insert into plugin_configs (id, plugin_id, user_id, config_json, updated_at)
                   values (?, ?, ?, ?, ?)
                   on conflict (plugin_id, user_id) do update set config_json = excluded.config_json,
                     updated_at = excluded.updated_at""",
                (db.new_id(), body.id, user_id, json.dumps(body.values, ensure_ascii=False), db.now_iso()),
            )
        return _run_plugin_action(conn, body.id, user_id, "test", body.values)


@app.post("/api/plugins.run")
def plugins_run(body: PluginRun, user_id: str = Depends(current_user)) -> dict[str, Any]:
    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        return _run_plugin_action(conn, body.id, user_id, body.action, body.params)


# --- Разрешения и действия (S14, F07, F17) ----------------------------------

PERMISSION_SCOPES = (
    "observe_screen", "find_elements", "move_mouse", "click", "type",
    "system", "apps", "files", "terminal", "web",
)
TOOL_SCOPES = {
    "open_url": "web",
    "web.search": "web",
    "web.fetch": "web",
    "app.open": "apps",
    "system.volume": "system",
    "system.power": "system",
    "screenshot": "observe_screen",
    "fs.create": "files",
    "fs.move": "files",
    "fs.open": "files",
    "terminal.run": "terminal",
}
HIGH_RISK_TOOLS = {"system.power", "terminal.run", "fs.move"}


def _ensure_permissions(conn, user_id: str) -> None:
    for scope in PERMISSION_SCOPES:
        conn.execute(
            """insert or ignore into permissions (id, user_id, scope, mode, updated_at)
               values (?, ?, ?, 'ask', ?)""",
            (db.new_id(), user_id, scope, db.now_iso()),
        )


def _permission_mode(conn, user_id: str, scope: str) -> str:
    row = conn.execute(
        "select mode from permissions where user_id = ? and scope = ?", (user_id, scope)
    ).fetchone()
    return row["mode"] if row else "ask"


@app.get("/api/permissions.get")
def permissions_get(user_id: str = Depends(current_user)) -> list[dict[str, Any]]:
    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        _ensure_permissions(conn, user_id)
        rows = conn.execute(
            "select id, scope, mode, updated_at from permissions where user_id = ? order by scope",
            (user_id,),
        ).fetchall()
        return [dict(row) for row in rows]


@app.post("/api/permissions.patch")
def permissions_patch(body: PermissionPatch, user_id: str = Depends(current_user)) -> dict[str, bool]:
    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        _ensure_permissions(conn, user_id)
        conn.execute(
            "update permissions set mode = ?, updated_at = ? where user_id = ? and scope = ?",
            (body.mode, db.now_iso(), user_id, body.scope),
        )
    return {"ok": True}


@app.post("/api/actions.propose")
def actions_propose(body: ActionPropose, user_id: str = Depends(current_user)) -> dict[str, Any]:
    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        scope = body.scope or TOOL_SCOPES.get(body.tool, "type")
        risk = body.risk
        if body.tool in HIGH_RISK_TOOLS and risk in {"low", "medium"}:
            risk = "high"
        mode = _permission_mode(conn, user_id, scope)
        if mode == "denied":
            raise HTTPException(403, f"Разрешение {scope} запрещено")
        if mode == "full" and risk not in {"high", "critical"}:
            status = "approved"
        else:
            status = "proposed"
        action_id = db.new_id()
        conn.execute(
            """insert into actions
                 (id, user_id, tool_name, args_json, risk_level, permission_scope,
                  status, created_at, started_at, finished_at)
               values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (action_id, user_id, body.tool, json.dumps(body.args, ensure_ascii=False),
             risk, scope, status, db.now_iso(),
             db.now_iso() if status == "approved" else None,
             db.now_iso() if status == "approved" else None),
        )
        return {"id": action_id, "status": status, "mode": mode}


@app.get("/api/actions.list")
def actions_list(user_id: str = Depends(current_user)) -> list[dict[str, Any]]:
    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        rows = conn.execute(
            """select id, tool_name, args_json, risk_level, permission_scope, status, error, created_at
               from actions where user_id = ? order by created_at desc limit 100""",
            (user_id,),
        ).fetchall()
        return [dict(row) for row in rows]


def _finish_action(conn, action_id: str, user_id: str, status: str, summary: str, error: str | None = None) -> None:
    conn.execute(
        """update actions set status = ?, result_json = ?, error = ?, finished_at = ?
           where id = ? and user_id = ?""",
        (status, json.dumps({"summary": summary}, ensure_ascii=False), error, db.now_iso(),
         action_id, user_id),
    )
    conn.execute(
        """insert into action_logs (id, action_id, user_id, summary, created_at)
           values (?, ?, ?, ?, ?)""",
        (db.new_id(), action_id, user_id, summary[:300], db.now_iso()),
    )


async def _execute_action(
    conn, action_id: str, user_id: str, tool: str, args: dict[str, Any]
) -> dict[str, Any]:
    """Локальные действия с подтверждением: приложения, питание, файлы, поиск."""
    try:
        if tool == "open_url":
            url = str(args.get("url", ""))
            if not url.startswith(("http://", "https://")):
                raise system_module.SystemActionError("Разрешены только http(s)-ссылки")
            webbrowser.open(url)
            summary = f"Открыта ссылка: {url[:120]}"
        elif tool == "notify":
            summary = f"Уведомление записано: {str(args.get('text', ''))[:100]}"
        elif tool == "app.open":
            result = system_module.open_app(str(args.get("name", "")))
            summary = str(result["message"])
        elif tool == "system.volume":
            if "level" in args:
                level = system_module.volume_set(int(args["level"]))
            elif "delta" in args:
                level = system_module.volume_step(int(args["delta"]))
            else:
                level = system_module.volume_mute()
            summary = f"Громкость: {level}%"
        elif tool == "system.power":
            result = system_module.power(
                str(args.get("action", "")), str(args.get("confirm", ""))
            )
            summary = str(result["message"])
        elif tool == "web.search":
            provider = str(_setting(conn, user_id, "web.provider", "off"))
            credential = conn.execute(
                "select secret_ref from api_credentials where user_id = ? and provider_id = 'brave-search'",
                (user_id,),
            ).fetchone()
            api_key = secret_store.get(credential["secret_ref"]) if credential else ""
            payload = await search_module.search(
                str(args.get("query", "")),
                provider=provider,
                api_key=api_key or "",
                base_url=str(_setting(conn, user_id, "web.searx_url", "")),
            )
            summary = "Найдено: " + "; ".join(
                item["title"][:80] for item in payload["results"][:3]
            )
        elif tool == "web.fetch":
            page = await search_module.fetch_page(str(args.get("url", "")))
            summary = f"Прочитана страница: {page['title'][:100] or page['url']}"
        elif tool == "screenshot":
            region = args.get("region")
            png = system_module.screenshot(tuple(region) if region else None)
            target_dir = settings.db_path.parent / "screenshots"
            target_dir.mkdir(parents=True, exist_ok=True)
            target = target_dir / f"shot-{int(time.time() * 1000)}.png"
            target.write_bytes(png)
            summary = f"Снимок экрана сохранён: {target.name}"
        elif tool.startswith("fs."):
            workspace = _require_write(conn, user_id)
            if tool == "fs.create":
                workspace_module.create_file(
                    workspace, str(args.get("path", "")), str(args.get("text", ""))
                )
                summary = f"Создан файл: {args.get('path')}"
            elif tool == "fs.move":
                moved = workspace_module.move_path(
                    workspace, str(args.get("source", "")), str(args.get("target", ""))
                )
                summary = f"Перемещено: {moved['from']} → {moved['to']}"
            else:
                workspace_module.open_path(workspace, str(args.get("path", "")))
                summary = f"Открыт файл: {args.get('path')}"
        elif tool == "terminal.run":
            workspace = _require_write(conn, user_id)
            run = workspace_module.run_command(
                workspace, str(args.get("command", "")), float(args.get("timeout", 30))
            )
            summary = f"Команда завершена с кодом {run['exit_code']}: {run['command'][:80]}"
        else:
            raise system_module.SystemActionError(f"Действие {tool} не поддерживается")
    except (
        system_module.SystemActionError,
        workspace_module.WorkspaceError,
        search_module.SearchError,
        OSError,
        ValueError,
    ) as exc:
        message = _safe_error(exc)
        _finish_action(conn, action_id, user_id, "failed", message, message)
        return {"ok": False, "message": message}
    _finish_action(conn, action_id, user_id, "done", summary)
    return {"ok": True, "message": summary}


@app.post("/api/actions.approve")
async def actions_approve(body: ByIdWithReason, user_id: str = Depends(current_user)) -> dict[str, Any]:
    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        row = conn.execute(
            "select * from actions where id = ? and user_id = ?", (body.id, user_id)
        ).fetchone()
        if row is None:
            raise HTTPException(404, "Действие не найдено")
        if row["status"] not in {"proposed", "approved"}:
            raise HTTPException(409, "Действие уже завершено")
        args = json.loads(row["args_json"])
        return await _execute_action(conn, body.id, user_id, row["tool_name"], args)


@app.post("/api/actions.deny")
def actions_deny(body: ByIdWithReason, user_id: str = Depends(current_user)) -> dict[str, bool]:
    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        row = conn.execute("select id from actions where id = ? and user_id = ?", (body.id, user_id)).fetchone()
        if row is None:
            raise HTTPException(404, "Действие не найдено")
        _finish_action(conn, body.id, user_id, "denied", f"Отклонено: {body.reason[:100]}")
    return {"ok": True}


# --- Напоминания, задачи, память (S06, S18, F10, F15) ------------------------

@app.get("/api/reminders.list")
def reminders_list(user_id: str = Depends(current_user)) -> list[dict[str, Any]]:
    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        rows = conn.execute(
            """select id, title, due_at, repeat_rule, status from reminders
               where user_id = ? order by due_at asc limit 200""",
            (user_id,),
        ).fetchall()
        return [dict(row) for row in rows]


@app.post("/api/reminders.create")
def reminders_create(body: ReminderCreate, user_id: str = Depends(current_user)) -> dict[str, str]:
    reminder_id = db.new_id()
    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        conn.execute(
            """insert into reminders (id, user_id, title, due_at, repeat_rule, status, created_at, updated_at)
               values (?, ?, ?, ?, ?, 'pending', ?, ?)""",
            (reminder_id, user_id, body.title, body.due_at, body.repeat, db.now_iso(), db.now_iso()),
        )
    return {"id": reminder_id}


@app.post("/api/reminders.update")
def reminders_update(body: ReminderUpdate, user_id: str = Depends(current_user)) -> dict[str, bool]:
    allowed = {"title": str, "due_at": str, "repeat_rule": str, "status": str}
    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        row = conn.execute("select id from reminders where id = ? and user_id = ?", (body.id, user_id)).fetchone()
        if row is None:
            raise HTTPException(404, "Напоминание не найдено")
        for key, value in body.patch.items():
            if key not in allowed or not isinstance(value, allowed[key]):
                raise HTTPException(422, f"Недопустимое поле: {key}")
            if key == "status" and value not in {"pending", "done", "dismissed"}:
                raise HTTPException(422, "Неизвестный статус")
            conn.execute(f"update reminders set {key} = ?, updated_at = ? where id = ? and user_id = ?",
                         (value[:200] if isinstance(value, str) else value, db.now_iso(), body.id, user_id))
    return {"ok": True}


@app.post("/api/reminders.delete")
def reminders_delete(body: ById, user_id: str = Depends(current_user)) -> dict[str, bool]:
    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        cursor = conn.execute("delete from reminders where id = ? and user_id = ?", (body.id, user_id))
        if cursor.rowcount == 0:
            raise HTTPException(404, "Напоминание не найдено")
    return {"ok": True}


@app.get("/api/tasks.list")
def tasks_list(user_id: str = Depends(current_user)) -> list[dict[str, Any]]:
    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        rows = conn.execute(
            """select id, title, description, status, priority, due_at from tasks
               where user_id = ? order by created_at desc limit 200""",
            (user_id,),
        ).fetchall()
        return [dict(row) for row in rows]


@app.post("/api/tasks.upsert")
def tasks_upsert(body: TaskUpsert, user_id: str = Depends(current_user)) -> dict[str, str]:
    task_id = body.id or db.new_id()
    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        conn.execute(
            """insert into tasks (id, user_id, title, description, status, priority, due_at, created_at, updated_at)
               values (?, ?, ?, ?, ?, ?, ?, ?, ?)
               on conflict (id) do update set title = excluded.title, description = excluded.description,
                 status = excluded.status, priority = excluded.priority, due_at = excluded.due_at,
                 updated_at = excluded.updated_at""",
            (task_id, user_id, body.title, body.description, body.status, body.priority,
             body.due_at, db.now_iso(), db.now_iso()),
        )
    return {"id": task_id}


@app.post("/api/tasks.delete")
def tasks_delete(body: ById, user_id: str = Depends(current_user)) -> dict[str, bool]:
    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        cursor = conn.execute("delete from tasks where id = ? and user_id = ?", (body.id, user_id))
        if cursor.rowcount == 0:
            raise HTTPException(404, "Задача не найдена")
    return {"ok": True}


@app.get("/api/memory.search")
def memory_search(q: str = "", user_id: str = Depends(current_user)) -> list[dict[str, Any]]:
    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        if q:
            rows = conn.execute(
                """select m.id, m.kind, m.text, m.created_at from memory_entries m
                   where m.user_id = ? and m.rowid in
                     (select rowid from memory_fts where memory_fts match ?)
                   order by m.created_at desc limit 50""",
                (user_id, q),
            ).fetchall()
        else:
            rows = conn.execute(
                """select id, kind, text, created_at from memory_entries
                   where user_id = ? order by created_at desc limit 50""",
                (user_id,),
            ).fetchall()
        return [dict(row) for row in rows]


@app.post("/api/memory.add")
def memory_add(body: SettingsPatch, user_id: str = Depends(current_user)) -> dict[str, str]:
    text = str(body.patch.get("text", ""))[:2000]
    kind = str(body.patch.get("kind", "fact"))
    if not text or kind not in {"fact", "summary", "preference"}:
        raise HTTPException(422, "Нужны текст и корректный kind")
    entry_id = db.new_id()
    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        conn.execute(
            """insert into memory_entries (id, user_id, kind, text, created_at)
               values (?, ?, ?, ?, ?)""",
            (entry_id, user_id, kind, text, db.now_iso()),
        )
    return {"id": entry_id}


@app.post("/api/memory.forget")
def memory_forget(body: MemoryForget, user_id: str = Depends(current_user)) -> dict[str, bool]:
    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        if body.id:
            cursor = conn.execute(
                "delete from memory_entries where id = ? and user_id = ?", (body.id, user_id)
            )
        else:
            cursor = conn.execute("delete from memory_entries where user_id = ?", (user_id,))
        if cursor.rowcount == 0:
            raise HTTPException(404, "Запись не найдена")
    return {"ok": True}


@app.post("/api/memory.summarize")
async def memory_summarize(body: MemorySummary, user_id: str = Depends(current_user)) -> dict[str, str]:
    """Саммари сессии локальной моделью; факты попадают в память с kind='summary'."""
    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        conversation = _conversation(conn, user_id, body.conversation_id)
        rows = conn.execute(
            """select role, text from messages
               where conversation_id = ? and status = 'done' and text <> ''
               order by created_at asc limit 60""",
            (body.conversation_id,),
        ).fetchall()
        if len(rows) < 2:
            raise HTTPException(409, "В диалоге слишком мало сообщений для саммари")
        provider, api_key = _active_llm(conn, user_id)

    transcript = "\n".join(f"{row['role']}: {row['text'][:1500]}" for row in rows)
    instruction = (
        "Сожми диалог в 3–5 коротких фактов о пользователе и задаче. "
        "Только факты, без воды и без обращения к пользователю.\n\n" + transcript
    )
    answer = ""
    async for chunk in streams.chat(
        settings,
        [{"role": "user", "content": instruction}],
        stream=False,
        provider=provider,
        api_key=api_key,
    ):
        answer += chunk
    answer = answer.strip()[:4000]
    if not answer:
        raise HTTPException(502, "Модель не вернула саммари")
    entry_id = db.new_id()
    with db.connect(settings) as conn:
        conn.execute(
            """insert into memory_entries (id, user_id, kind, text, created_at)
               values (?, ?, 'summary', ?, ?)""",
            (entry_id, user_id, f"{conversation['title'] or 'Диалог'}: {answer}", db.now_iso()),
        )
    return {"id": entry_id, "text": answer}


# --- Системные действия ------------------------------------------------------


def _system_error(exc: Exception) -> HTTPException:
    return HTTPException(503, _safe_error(exc))


@app.get("/api/system.metrics")
def system_metrics() -> dict[str, Any]:
    try:
        return system_module.metrics()
    except system_module.SystemActionError as exc:
        raise _system_error(exc) from exc


@app.get("/api/system.apps")
def system_apps() -> dict[str, Any]:
    return {
        "platform": system_module.platform.system(),
        "apps": sorted(system_module.app_allowlist()),
    }


@app.post("/api/system.volume")
def system_volume(body: SystemVolume) -> dict[str, Any]:
    try:
        if body.level is not None:
            level = system_module.volume_set(body.level)
        elif body.delta is not None:
            level = system_module.volume_step(body.delta)
        else:
            level = system_module.volume_mute()
    except system_module.SystemActionError as exc:
        raise _system_error(exc) from exc
    return {"ok": True, "level": level}


@app.post("/api/system.power")
def system_power(body: SystemPower) -> dict[str, Any]:
    try:
        return system_module.power(body.action, body.confirm)
    except system_module.SystemActionError as exc:
        raise _system_error(exc) from exc


@app.post("/api/system.powerCancel")
def system_power_cancel() -> dict[str, Any]:
    try:
        return system_module.power_cancel()
    except system_module.SystemActionError as exc:
        raise _system_error(exc) from exc


@app.post("/api/system.open")
def system_open(body: SystemOpen) -> dict[str, Any]:
    try:
        return system_module.open_app(body.target)
    except system_module.SystemActionError as exc:
        raise _system_error(exc) from exc


@app.get("/api/system.clipboard")
def system_clipboard() -> dict[str, str]:
    try:
        return {"text": system_module.clipboard_get()}
    except system_module.SystemActionError as exc:
        raise _system_error(exc) from exc


@app.post("/api/system.screenshot")
def system_screenshot(body: ScreenshotRequest) -> dict[str, Any]:
    try:
        region = tuple(body.region) if body.region else None
        data = system_module.screenshot(region)  # type: ignore[arg-type]
    except system_module.SystemActionError as exc:
        raise _system_error(exc) from exc
    return {
        "mime": "image/png",
        "size": len(data),
        "content_base64": base64.b64encode(data).decode("ascii"),
    }


# --- Проект: папка, редактор, терминал --------------------------------------


def _workspace_payload(conn, user_id: str) -> dict[str, Any]:
    root = _workspace_root(conn, user_id)
    return {
        "root": str(root) if root else None,
        "name": root.name if root else None,
        "allow_write": bool(_setting(conn, user_id, "workspace.allow_write", False)),
    }


@app.get("/api/workspace.get")
def workspace_get(user_id: str = Depends(current_user)) -> dict[str, Any]:
    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        return _workspace_payload(conn, user_id)


@app.post("/api/workspace.set")
def workspace_set(body: WorkspaceSet, user_id: str = Depends(current_user)) -> dict[str, Any]:
    try:
        root = workspace_module.resolve_root(body.path)
    except workspace_module.WorkspaceError as exc:
        raise HTTPException(422, _safe_error(exc)) from exc
    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        _set_setting(conn, user_id, "workspace.root", str(root))
        _set_setting(conn, user_id, "workspace.allow_write", bool(body.allow_write))
        import uuid

        workspace_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"amadeus-ws:{user_id}"))
        conn.execute(
            """insert into workspaces (id, user_id, path, open_mode, created_at, updated_at)
               values (?, ?, ?, 'internal', ?, ?)
               on conflict (id) do update set path = excluded.path,
                 open_mode = excluded.open_mode, updated_at = excluded.updated_at""",
            (workspace_id, user_id, str(root), db.now_iso(), db.now_iso()),
        )
        return _workspace_payload(conn, user_id)


@app.post("/api/workspace.patch")
def workspace_patch(body: WorkspacePatch, user_id: str = Depends(current_user)) -> dict[str, Any]:
    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        _set_setting(conn, user_id, "workspace.allow_write", body.allow_write)
        return _workspace_payload(conn, user_id)


@app.get("/api/workspace.tree")
def workspace_tree(user_id: str = Depends(current_user)) -> dict[str, Any]:
    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        workspace = _require_workspace(conn, user_id)
        return {"root": str(workspace.root), "entries": workspace_module.tree(workspace)}


@app.get("/api/workspace.search")
def workspace_search(q: str = "", user_id: str = Depends(current_user)) -> list[dict[str, Any]]:
    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        workspace = _require_workspace(conn, user_id)
        return workspace_module.search_files(workspace, q)


@app.post("/api/workspace.read")
def workspace_read(body: FilePath, user_id: str = Depends(current_user)) -> dict[str, Any]:
    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        workspace = _require_workspace(conn, user_id)
        try:
            return workspace_module.read_file(workspace, body.path)
        except workspace_module.WorkspaceError as exc:
            raise HTTPException(422, _safe_error(exc)) from exc


@app.post("/api/workspace.write")
def workspace_write(body: FileWrite, user_id: str = Depends(current_user)) -> dict[str, Any]:
    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        workspace = _require_write(conn, user_id)
        try:
            return workspace_module.write_file(workspace, body.path, body.text)
        except workspace_module.WorkspaceError as exc:
            raise HTTPException(422, _safe_error(exc)) from exc


@app.post("/api/workspace.create")
def workspace_create(body: FileWrite, user_id: str = Depends(current_user)) -> dict[str, Any]:
    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        workspace = _require_write(conn, user_id)
        try:
            return workspace_module.create_file(workspace, body.path, body.text)
        except workspace_module.WorkspaceError as exc:
            raise HTTPException(422, _safe_error(exc)) from exc


@app.post("/api/workspace.move")
def workspace_move(body: FileMove, user_id: str = Depends(current_user)) -> dict[str, Any]:
    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        workspace = _require_write(conn, user_id)
        try:
            return workspace_module.move_path(workspace, body.source, body.target)
        except workspace_module.WorkspaceError as exc:
            raise HTTPException(422, _safe_error(exc)) from exc


@app.post("/api/workspace.open")
def workspace_open(body: FilePath, user_id: str = Depends(current_user)) -> dict[str, Any]:
    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        workspace = _require_workspace(conn, user_id)
        try:
            return workspace_module.open_path(workspace, body.path)
        except workspace_module.WorkspaceError as exc:
            raise HTTPException(422, _safe_error(exc)) from exc


@app.post("/api/workspace.run")
def workspace_run(body: RunCommand, user_id: str = Depends(current_user)) -> dict[str, Any]:
    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        workspace = _require_write(conn, user_id)
        try:
            result = workspace_module.run_command(workspace, body.command, body.timeout)
        except workspace_module.WorkspaceError as exc:
            raise HTTPException(422, _safe_error(exc)) from exc
        conn.execute(
            """insert into terminal_sessions (id, workspace_id, cwd, shell, started_at, ended_at, exit_code)
               values (?, null, ?, ?, ?, ?, ?)""",
            (db.new_id(), str(workspace.root), "shell", db.now_iso(), db.now_iso(),
             result["exit_code"]),
        )
        return result


# --- Веб-поиск ---------------------------------------------------------------


@app.get("/api/web.status")
def web_status(user_id: str = Depends(current_user)) -> dict[str, Any]:
    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        credential = conn.execute(
            "select id from api_credentials where user_id = ? and provider_id = 'brave-search'",
            (user_id,),
        ).fetchone()
        return {
            "provider": _setting(conn, user_id, "web.provider", "off"),
            "searx_url": _setting(conn, user_id, "web.searx_url", ""),
            "has_brave_key": credential is not None,
        }


@app.post("/api/web.search")
async def web_search(body: WebSearchQuery, user_id: str = Depends(current_user)) -> dict[str, Any]:
    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        provider = str(_setting(conn, user_id, "web.provider", "off"))
        credential = conn.execute(
            "select secret_ref from api_credentials where user_id = ? and provider_id = 'brave-search'",
            (user_id,),
        ).fetchone()
        api_key = secret_store.get(credential["secret_ref"]) if credential else ""
        searx_url = str(_setting(conn, user_id, "web.searx_url", ""))
    try:
        return await search_module.search(
            body.query,
            provider=provider,
            api_key=api_key or "",
            base_url=searx_url,
            count=body.count,
        )
    except search_module.SearchError as exc:
        raise HTTPException(502, _safe_error(exc)) from exc


@app.get("/api/web.fetch")
async def web_fetch(url: str) -> dict[str, Any]:
    try:
        return await search_module.fetch_page(url)
    except search_module.SearchError as exc:
        raise HTTPException(502, _safe_error(exc)) from exc


# --- Модели и провайдеры -----------------------------------------------------


@app.get("/api/models.list")
async def models_list(user_id: str = Depends(current_user)) -> dict[str, Any]:
    models: list[str] = []
    error: str | None = None
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.get(f"{settings.ollama_base_url}/api/tags")
            response.raise_for_status()
            models = [item.get("name", "") for item in response.json().get("models", []) if item.get("name")]
    except httpx.HTTPError as exc:
        error = _safe_error(exc)
    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        provider, _ = _active_llm(conn, user_id)
    return {"ollama": models, "error": error, "active": provider}


@app.post("/api/providers.activate")
def providers_activate(body: ModelSelect, user_id: str = Depends(current_user)) -> dict[str, Any]:
    if body.base_url:
        host = urlparse(body.base_url).hostname or ""
        if not settings.is_allowed_provider_host(host):
            raise HTTPException(400, "Хост не в AMADEUS_PROVIDER_ALLOWLIST")
    provider_id = "ollama" if body.provider_id in {"ollama", "local"} else body.provider_id
    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        conn.execute(
            "update provider_configs set is_active = 0 where user_id = ? and stage = 'llm'",
            (user_id,),
        )
        row = conn.execute(
            """select id from provider_configs
               where user_id = ? and stage = 'llm' and provider_id = ?""",
            (user_id, provider_id),
        ).fetchone()
        row_id = row["id"] if row else db.new_id()
        conn.execute(
            """insert into provider_configs
                 (id, user_id, stage, provider_id, base_url, model_id, options_json,
                  is_active, created_at, updated_at)
               values (?, ?, 'llm', ?, ?, ?, '{}', 1, ?, ?)
               on conflict (id) do update set model_id = excluded.model_id,
                 base_url = excluded.base_url, is_active = 1, updated_at = excluded.updated_at""",
            (row_id, user_id, provider_id, body.base_url, body.model_id, db.now_iso(), db.now_iso()),
        )
    return {"ok": True, "provider_id": provider_id, "model_id": body.model_id}


# --- Обновления --------------------------------------------------------------


def _update_state(conn, channel: str) -> dict[str, Any] | None:
    row = conn.execute("select * from update_state where channel = ?", (channel,)).fetchone()
    return dict(row) if row else None


def _update_urls(conn, user_id: str) -> tuple[str, str]:
    return (
        str(_setting(conn, user_id, "updates.manifest_url", "")),
        str(_setting(conn, user_id, "updates.channel", "stable")),
    )


@app.get("/api/updates.status")
def updates_status(user_id: str = Depends(current_user)) -> dict[str, Any]:
    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        manifest_url, channel = _update_urls(conn, user_id)
        return {
            "current_version": CURRENT_VERSION,
            "manifest_url": manifest_url,
            "channel": channel,
            "state": _update_state(conn, channel),
        }


@app.post("/api/updates.check")
async def updates_check(body: UpdateCheck, user_id: str = Depends(current_user)) -> dict[str, Any]:
    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        stored_url, stored_channel = _update_urls(conn, user_id)
    manifest_url = body.manifest_url or stored_url
    channel = body.channel or stored_channel
    if body.manifest_url:
        with db.connect(settings) as conn:
            _set_setting(conn, user_id, "updates.manifest_url", manifest_url)
            _set_setting(conn, user_id, "updates.channel", channel)
    try:
        result = await updater_module.check_update(manifest_url, CURRENT_VERSION, channel)
    except updater_module.UpdateError as exc:
        raise HTTPException(502, _safe_error(exc)) from exc
    with db.connect(settings) as conn:
        conn.execute(
            """insert into update_state
                 (id, channel, current_version, available_version, last_checked_at,
                  download_status, install_status, updated_at)
               values (?, ?, ?, ?, ?, 'idle', 'idle', ?)
               on conflict (channel) do update set current_version = excluded.current_version,
                 available_version = excluded.available_version,
                 last_checked_at = excluded.last_checked_at,
                 updated_at = excluded.updated_at""",
            (f"update-{channel}", channel, CURRENT_VERSION, result["version"],
             db.now_iso(), db.now_iso()),
        )
    return result


@app.post("/api/updates.download")
async def updates_download(body: UpdateInstall, user_id: str = Depends(current_user)) -> dict[str, Any]:
    try:
        path = await updater_module.download_update(body.url, body.sha256, UPDATES_DIR)
    except updater_module.UpdateError as exc:
        raise HTTPException(502, _safe_error(exc)) from exc
    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        conn.execute(
            "update update_state set download_status = 'ready', updated_at = ? where id = (select id from update_state limit 1)",
            (db.now_iso(),),
        )
    return {"ok": True, "file": path.name, "size": path.stat().st_size}


@app.post("/api/updates.install")
def updates_install(user_id: str = Depends(current_user)) -> dict[str, Any]:
    files = sorted(
        (item for item in UPDATES_DIR.glob("*") if item.is_file() and not item.name.endswith(".part")),
        key=lambda item: item.stat().st_mtime,
        reverse=True,
    ) if UPDATES_DIR.exists() else []
    if not files:
        raise HTTPException(409, "Нет скачанного обновления")
    try:
        result = updater_module.install_update(files[0])
    except updater_module.UpdateError as exc:
        raise HTTPException(502, _safe_error(exc)) from exc
    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        conn.execute(
            "update update_state set install_status = 'installing', updated_at = ? where id = (select id from update_state limit 1)",
            (db.now_iso(),),
        )
    return result


@app.post("/api/updates.cleanup")
def updates_cleanup(user_id: str = Depends(current_user)) -> dict[str, Any]:
    removed = 0
    if UPDATES_DIR.exists():
        for item in UPDATES_DIR.iterdir():
            if item.is_file():
                item.unlink()
                removed += 1
    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        conn.execute(
            "update update_state set download_status = 'idle', updated_at = ?",
            (db.now_iso(),),
        )
    return {"ok": True, "removed": removed}


# --- Настройки: экспорт, импорт, поиск --------------------------------------


SETTINGS_INDEX: list[dict[str, str]] = [
    {"key": "app.locale", "title": "Язык интерфейса", "category": "Общие"},
    {"key": "app.theme", "title": "Тема оформления", "category": "Общие"},
    {"key": "ui.accent", "title": "Акцент оформления", "category": "Общие"},
    {"key": "app.autostart", "title": "Автозапуск с системой", "category": "Общие"},
    {"key": "ai.mode", "title": "Режим провайдера", "category": "Модели"},
    {"key": "ai.preset", "title": "Профиль ответов", "category": "Модели"},
    {"key": "ai.model", "title": "Модель", "category": "Модели"},
    {"key": "voice.tts_voice", "title": "Голос синтеза речи", "category": "Голос"},
    {"key": "voice.input_device", "title": "Микрофон", "category": "Голос"},
    {"key": "voice.output_device", "title": "Динамик", "category": "Голос"},
    {"key": "voice.wake_word", "title": "Кодовое слово", "category": "Голос"},
    {"key": "web.provider", "title": "Провайдер веб-поиска", "category": "Поиск"},
    {"key": "web.searx_url", "title": "Адрес SearXNG", "category": "Поиск"},
    {"key": "workspace.root", "title": "Папка проекта", "category": "Проект"},
    {"key": "workspace.allow_write", "title": "Изменения в проекте", "category": "Проект"},
    {"key": "privacy.telemetry", "title": "Телеметрия", "category": "Приватность"},
    {"key": "updates.manifest_url", "title": "Сервер обновлений", "category": "Обновления"},
    {"key": "updates.channel", "title": "Канал обновлений", "category": "Обновления"},
]


@app.get("/api/settings.index")
def settings_index(q: str = "") -> list[dict[str, str]]:
    needle = q.strip().lower()
    if not needle:
        return SETTINGS_INDEX
    return [
        item for item in SETTINGS_INDEX
        if needle in item["title"].lower() or needle in item["key"].lower()
        or needle in item["category"].lower()
    ]


@app.get("/api/settings.export")
def settings_export(user_id: str = Depends(current_user)) -> dict[str, Any]:
    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        rows = conn.execute(
            "select key, value_json from settings where user_id = ? order by key", (user_id,)
        ).fetchall()
        profile = conn.execute(
            "select locale, display_name, assistant_name, user_name from user_profile where id = ?",
            (user_id,),
        ).fetchone()
    return {
        "format": "amadeus-settings",
        "version": 1,
        "exported_at": db.now_iso(),
        "profile": dict(profile) if profile else {},
        "settings": {row["key"]: json.loads(row["value_json"]) for row in rows},
    }


@app.post("/api/settings.import")
def settings_import(body: SettingsImport, user_id: str = Depends(current_user)) -> dict[str, Any]:
    if body.data.get("format") != "amadeus-settings":
        raise HTTPException(422, "Неизвестный формат файла настроек")
    imported = body.data.get("settings")
    if not isinstance(imported, dict):
        raise HTTPException(422, "В файле нет раздела settings")
    applied = 0
    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        for key, value in imported.items():
            if not re.fullmatch(r"[a-z][a-z0-9_.-]{0,63}", str(key)):
                continue
            if any(word in str(key).lower() for word in ("secret", "token", "password", "api_key")):
                continue
            _set_setting(conn, user_id, str(key), value)
            applied += 1
    return {"ok": True, "applied": applied}


# --- Голоса, блокировка PIN --------------------------------------------------


@app.get("/api/voice.voices")
def voice_voices() -> dict[str, Any]:
    return {
        "voices": voice.list_system_voices(),
        "piper": {
            "configured": bool(os.getenv("AMADEUS_PIPER_MODEL")),
            "binary": os.getenv("AMADEUS_PIPER_BIN", "piper"),
        },
    }


@app.post("/api/voice.select")
def voice_select(body: VoiceSelect, user_id: str = Depends(current_user)) -> dict[str, bool]:
    available = {item["id"] for item in voice.list_system_voices()}
    if available and body.voice_id not in available:
        raise HTTPException(422, "Такого голоса нет в системе")
    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        _set_setting(conn, user_id, "voice.tts_voice", body.voice_id)
    return {"ok": True}


@app.get("/api/lock.status")
def lock_status(user_id: str = Depends(current_user)) -> dict[str, Any]:
    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        row = conn.execute(
            "select failed_attempts, locked_until from lock_credentials where user_id = ? and kind = 'pin'",
            (user_id,),
        ).fetchone()
    return {
        "enabled": row is not None,
        "failed_attempts": row["failed_attempts"] if row else 0,
        "locked_until": row["locked_until"] if row else None,
    }


@app.post("/api/lock.set")
def lock_set(body: LockSet, user_id: str = Depends(current_user)) -> dict[str, bool]:
    verifier = _pin_verifier(body.pin, os.urandom(16))
    secret_ref = secret_store.set(f"{PIN_SECRET_ID}:{user_id}", verifier)
    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        conn.execute(
            """insert into lock_credentials
                 (id, user_id, kind, verifier_ref, failed_attempts, created_at, updated_at)
               values (?, ?, 'pin', ?, 0, ?, ?)
               on conflict (user_id, kind) do update set verifier_ref = excluded.verifier_ref,
                 failed_attempts = 0, locked_until = null, updated_at = excluded.updated_at""",
            (db.new_id(), user_id, secret_ref, db.now_iso(), db.now_iso()),
        )
    return {"ok": True}


@app.post("/api/lock.verify")
def lock_verify(body: LockVerify, user_id: str = Depends(current_user)) -> dict[str, Any]:
    from datetime import datetime, timezone

    with db.connect(settings) as conn:
        db.ensure_user(conn, user_id)
        row = conn.execute(
            """select verifier_ref, failed_attempts, locked_until from lock_credentials
               where user_id = ? and kind = 'pin'""",
            (user_id,),
        ).fetchone()
        if row is None:
            raise HTTPException(404, "PIN не настроен")
        if row["locked_until"]:
            locked_until = datetime.fromisoformat(row["locked_until"].replace("Z", "+00:00"))
            if locked_until > datetime.now(timezone.utc):
                raise HTTPException(429, "Слишком много попыток. Подождите минуту.")
        verifier = secret_store.get(row["verifier_ref"]) or ""
        if _pin_matches(body.pin, verifier):
            conn.execute(
                "update lock_credentials set failed_attempts = 0, locked_until = null, updated_at = ? where user_id = ? and kind = 'pin'",
                (db.now_iso(), user_id),
            )
            return {"ok": True}
        attempts = int(row["failed_attempts"]) + 1
        locked_until = None
        if attempts >= 5:
            from datetime import timedelta

            locked_until = (
                datetime.now(timezone.utc) + timedelta(seconds=60)
            ).isoformat().replace("+00:00", "Z")
            attempts = 0
        conn.execute(
            "update lock_credentials set failed_attempts = ?, locked_until = ?, updated_at = ? where user_id = ? and kind = 'pin'",
            (attempts, locked_until, db.now_iso(), user_id),
        )
    if locked_until:
        raise HTTPException(429, "Слишком много попыток. Подождите минуту.")
    raise HTTPException(401, "Неверный PIN")
