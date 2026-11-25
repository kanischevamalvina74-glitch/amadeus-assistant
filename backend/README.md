# Амадеус — локальное ядро

FastAPI-приложение, которое хранит диалоги в SQLite и стримит ответы через официальный API Ollama. HTTP-маршруты — зеркало будущих Tauri IPC-команд, поэтому позже оболочка вызовет те же операции через `invoke()`.

## Запуск

```bash
python -m pip install -r requirements.txt
cp .env.example .env   # и задать свои значения
python -m scripts.migrate
python -m uvicorn core.app:app --host 127.0.0.1 --port 8787
```

Для разработки без SQLCipher: `AMADEUS_ALLOW_PLAINTEXT_DB=1`. Для релиза — `AMADEUS_DB_KEY` и драйвер `sqlcipher3`.

## Маршруты

| группа | методы |
|---|---|
| старт | `GET /health`, `GET /setup.status`, `POST /setup.complete` |
| настройки | `GET /settings.get`, `POST /settings.patch`, `POST /providers.apply` |
| ключи | `POST /credentials.set`, `POST /credentials.test` |
| провайдеры | `GET /providers.list`, `POST /providers.upsert` |
| диалоги | `GET /conversations.list`, `POST /conversations.create`, `.rename`, `.delete` |
| сообщения | `GET /messages.list`, `POST /messages.send`, `POST /messages.cancel` |
| голос/стриминг | `GET /v1/chat/stream` (SSE) |

Все пути см. в `core/app.py`. Валидация — `core/validation.py`, доступ по `user_id` — в каждом обработчике.

## Тесты и сид

```bash
python -m pytest -q
python -m scripts.seed
```

## Связь с UI

Vite проксирует `/api` на `http://127.0.0.1:8787` (см. `replica/app/vite.config.ts`). Клиент — `replica/app/src/lib/api.ts`. Если ядро не запущено, UI работает в демо-режиме с прямым подключением к Ollama.

Полный чек-лист — `replica/backend.md`.
