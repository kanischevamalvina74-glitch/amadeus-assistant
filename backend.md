# Бэкенд: Амадеус

Статус: **вертикальный срез готов и протестирован** (25/25 тестов, включая отмену SSE-потока, разрешения, напоминания, вложения, плагины и голосовой каскад). Дальше — расширение по плану `architecture.md`.

## Граница продукта

Приложение локальное и бесплатное: нет аккаунтов, сервера, платежей, почты и OAuth. Поэтому разделы навыка про Stripe, Resend, роли owner/admin/member и OAuth-ревью здесь **намеренно не применяются**. Если в будущем появятся облачные адаптеры, они вернутся в этот чек-лист отдельной строкой.

## Что реализовано

- **Миграции:** `replica/backend/migrations/0001_init.sql` — копия `schema.sql` (26 таблиц, FTS5, триггеры). `scripts/migrate.py` применяет forward-only миграции, проверяет checksum, делает backup до изменений, `--check` для CI.
- **БД:** SQLite через `core/db.py`, `foreign_keys=ON`, WAL, `busy_timeout`; время ISO-8601 UTC; id — UUID v7. Каждый запрос открывает своё соединение и фильтрует по `user_id`.
- **Доступ:** нет RLS (нет облачного сервера), вместо него — обязательная фильтрация по `user_id` в каждом запросе; тест `test_user_isolation` проверяет, что второй пользователь не видит чужие диалоги и получает 404.
- **API:** HTTP-зеркало Tauri IPC (`setup.*`, `settings.*`, `credentials.*`, `providers.*`, `conversations.*`, `messages.*`) в `core/app.py`; SSE `/api/v1/chat/stream`; `/api/messages.cancel` отменяет активную генерацию.
- **Стриминг:** только официальный `POST /api/chat` локального Ollama; ключ и модель задаются пользователем в env. Никаких приватных эндпоинтов референса.
- **Валидация:** pydantic v2 с `extra="forbid"`, `strict=True` на каждом маршруте; ограничения длины и формата; 422 с деталями без URL.
- **Секреты:** `core/secrets.py` — OS keychain через `keyring` (Windows Credential Manager / macOS Keychain / libsecret). В БД только `secret_ref`; `credentials.test` не вставляет ключ в URL; логи проходят `RedactFilter` (Bearer/sk-...) и middleware пишет только метод, путь и статус без query.
- **SSRF:** базовый URL облачного провайдера допускается только из `AMADEUS_PROVIDER_ALLOWLIST`; localhost разрешён для Ollama.
- **Сид:** `scripts/seed.py` создаёт вымышленный профиль и диалог.
- **Тесты:** `pytest` — миграции и backup, полный сценарий, изоляция пользователей, валидация, секреты, SSE и отмена. `8 passed`.
- **Дополнительные блоки:** `permissions.*`, `actions.*`, `reminders.*`, `tasks.*`, `memory.*`, `settings.locale`, `plugins.*`; фоновый планировщик напоминаний; `POST /api/v1/chat/stream` принимает до 5 вложений по 5 МБ, хранит файлы отдельно от БД и передаёт извлечённый текст модели. Плагины загружаются только из `plugin.json` с whitelist разрешений — исполняемый код не запускается.
- **Голос:** `core/voice.py` — протоколы VAD/STT/TTS, энергетический VAD по умолчанию, адаптеры Silero/faster-whisper/системный TTS с ленивой загрузкой; `WS /ws/voice` принимает PCM16 20 мс и текстовые команды, отдаёт `speech_detected`, `transcript`, `token`, `audio`, `barge_in`, `canceled`, `error` и сохраняет диалог в SQLite. **Для WebSocket нужен `uvicorn[standard]`** — иначе upgrade отклоняется с 404. Браузерный клиент — `src/hooks/useVoiceSocket.ts` (getUserMedia → PCM16, воспроизведение WAV, barge-in) с fallback на `SpeechRecognition`. Модель Whisper `small` скачана и проверена круговым тестом (TTS → resample 16 кГц → STT). PyAV несовместим с Python 3.14, поэтому аудио передаётся в `faster-whisper` numpy-массивом, минуя декодер. Тяжёлый тест включается флагом `AMADEUS_STT_SMOKE=1`.
- **UI-интеграция:** `replica/app/src/lib/api.ts`; при запущенном ядре (`http://127.0.0.1:8787`, прокси Vite `/api`) история и ответы идут в SQLite; без ядра UI сохраняет демо-режим. Tauri-каркас в `src-tauri/` повторяет тот же контракт для будущего `invoke()`.

## Чек-лист безопасности

- [x] секреты только в keychain/env, `.env*` в `.gitignore`, ничего в клиентском бандле
- [x] вход валидируется на сервере на каждом маршруте
- [x] авторизация (фильтрация по `user_id`) проверяется на каждом чтении и записи, протестирована вторым пользователем
- [x] rate limit на проверку ключей (10/мин), локальный API не доступен извне — bind на `127.0.0.1`
- [x] вебхуков нет; входящих сетевых вызовов нет
- [x] загрузок файлов в этом срезе нет; лимиты размера текста заданы (20 000 символов)
- [x] данных пользователя нет в URL и логах
- [x] зависимости зафиксированы в `requirements.txt`; проверено 2026-11-24: `npm audit --audit-level=high` — 0 уязвимостей, `pip-audit -r requirements.txt` — No known vulnerabilities found; повторять в CI перед релизом
- [ ] политика конфиденциальности: enumerated processors — в локальном режиме их нет; добавить страницу перед запуском
- [ ] SQLCipher: установить `sqlcipher3` и обязать `AMADEUS_DB_KEY` в релизной сборке
- [ ] проверка keychain на Windows/macOS/Linux на реальных машинах
- [ ] подпись сборок и notarization (задача `replica-deploy`)

## Известные ограничения среза

- Миграции создают единственного пользователя машины; мультиаккаунт не планируется.
- `AMADEUS_ALLOW_USER_OVERRIDE=1` нужен только тестам; в проде заголовок `X-Amadeus-User-ID` игнорируется.
- Защищённая БД требует SQLCipher: без ключа ядро отказывается стартовать, если явно не включён dev-режим.
- Tauri-оболочка ещё не собрана (нет Rust в окружении); HTTP-слой спроектирован так, чтобы позже стать вызовами `invoke()` без изменения контракта.

## Запуск

```bash
cd replica/backend
python -m pip install -r requirements.txt
python -m scripts.migrate
python -m uvicorn core.app:app --host 127.0.0.1 --port 8787
python -m pytest -q
```

См. `.env.example` для переменных и `README.md` для деталей.


## Вторая партия (2026-11-25)

- **Системные действия:** `core/system.py` — громкость (winmm / osascript / pactl / amixer), питание с подтверждением, allowlist приложений, буфер обмена, снимок экрана с регионом, метрики `psutil` (CPU/RAM/диск/сеть/GPU/температура). `requirements.txt`: `psutil>=6.0`, `mss>=10.0`.
- **Проект:** `core/workspace.py` — изолированный корень, дерево с исключением шумных папок, чтение/запись/создание/перемещение, поиск по содержимому, выполнение команды с таймаутом и журналом `terminal_sessions`.
- **Поиск:** `core/search.py` — Brave Search API (`X-Subscription-Token`) и SearXNG JSON API, чтение страниц с защитой от SSRF (приватные адреса и file:// запрещены).
- **Обновления:** `core/updater.py` — HTTPS-манифест, сравнение semver, скачивание со сверкой SHA-256, запуск установщика; маршруты `updates.check/download/install/cleanup`.
- **Провайдеры:** `core/streams.py:chat()` — диспетчер Ollama / OpenAI-совместимый; неизвестный `provider_id` без `base_url` безопасно направляется во встроенную Ollama (совместимость со старыми записями).
- **Разрешения:** миграция `0004_permission_scopes.sql` расширяет scope до 10 (`system`, `apps`, `files`, `terminal`, `web`);опасные инструменты (`system.power`, `terminal.run`, `fs.move`) принудительно получают `risk=high` и требуют подтверждения.
- **Память и безопасность:** `memory.summarize` через активную модель; PIN хранится как scrypt-верификатор в keychain, 5 неудачных попыток ⇒ блокировка на минуту.
- **Миграции:** теперь `0001…0004`. Тесты: 64 passed, 1 skipped.


## Сборка ядра без системного Python (2026-11-25)

```bash
cd replica/backend
python -m pip install -r requirements.txt pyinstaller
python packaging/build_sidecar.py
```

Скрипт собирает `dist/amadeus-core.exe` и копию `dist/amadeus-core-<target-triple>.exe`, которую подхватывает Tauri как `externalBin`. Миграции и манифесты плагинов включаются в exe. Без `AMADEUS_DB_PATH` собранное ядро хранит базу в `~/.amadeus/amadeus.db`. Проверка собранного exe:

```bash
set AMADEUS_ALLOW_PLAINTEXT_DB=1
set AMADEUS_SECRET_STORE=memory
dist\amadeus-core.exe
# в другом терминале: curl http://127.0.0.1:8787/api/health
```

В dev-режиме `start_backend` по-прежнему запускает `python -m uvicorn core.app:app`.
