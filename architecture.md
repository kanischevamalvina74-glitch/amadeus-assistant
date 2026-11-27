# Архитектура: кроссплатформенный ИИ-ассистент (клон функциональности Rustamov JARVIS)

Локальное десктопное приложение для Windows, macOS и Linux. Сервера приложения нет: данные, модели и ключи живут на машине пользователя. Бесплатно, без аккаунтов и платежей. Интерфейс RU/EN, бренд — **Амадеус** (Amadeus), рабочее имя в коде — `assistant`.

## Стек

| слой | выбор | почему |
| --- | --- | --- |
| оболочка | **Tauri 2** (Rust + WebView) | один UI на три ОС, доступ к системным API, установщики и автообновление, бандл меньше Electron |
| UI | **React 19 + TypeScript + Vite + CSS-токены** | быстрый HUD и панели; токены и примитивы из `replica/design` перенесены в `replica/app/src/styles`; Tailwind-конфиг остаётся опцией |
| состояние | **TanStack Query + Zustand** | серверное состояние (IPC) отдельно от локального UI-состояния |
| терминал | **xterm.js + portable-pty (Rust)** | ConPTY на Windows, PTY на macOS/Linux, привычный эмулятор |
| системные команды | **Rust** (`sysinfo`, `enigo`, `xcap`, `arboard`, `global-hotkey`, `windows`/`objc2`/`zbus`) | телеметрия, окна, ввод, скриншоты, буфер, громкость, хоткеи — нативно и без Python-зависимостей |
| AI-движок | **Python 3.12 sidecar** (FastAPI + uvicorn + websockets) | faster-whisper + Silero VAD + Piper/Silero + Ollama; адаптеры Yandex SpeechKit и OpenAI Realtime — зрелая экосистема и работа без обязательного Gemini |
| связь UI ↔ ядро | **Tauri IPC (commands/events)** | типизированный контракт, минимум сетевых портов |
| связь ядро ↔ AI | **WebSocket + HTTP на localhost** | стриминг аудио и токенов, health-check, перезапуск sidecar |
| база | **SQLite + SQLCipher** (rusqlite/sqlx) | локально, одна машина, шифрование файла БД, ноль администрирования |
| миграции | **sqlx migrate** | версионирование схемы, проверка в CI |
| секреты | **OS keychain** (Windows Credential Manager, macOS Keychain, libsecret) | API-ключи не лежат в БД и логах; в базе только `secret_ref` |
| плагины | **Python-процессы + `plugin.json` + JSON-RPC** | авторы пишут на Python, хост изолирует процесс, разрешения проверяются на границе |
| файлы/вложения | локальная папка данных приложения + шифрование | без облака; лимиты и очистка |
| обновления | **tauri-plugin-updater + GitHub Releases** | подпись, delta-обновления, три ОС |
| лендинг/доки | **Astro на Cloudflare Pages** | статика, бесплатно, отдельно от приложения |
| CI | **GitHub Actions** (матрица windows/macos/ubuntu) | сборка, тесты, артефакты, нотаризация |
| аналитика | **нет по умолчанию**; Sentry opt-in для крашей | приватность; пользователь сам включает отправку |

**Почему не PySide6, как в референсе:** Qt быстрее повторить, но кроссплатформенная упаковка, HUD-анимации, WebView-панели и найм разработчиков дороже. Tauri даёт тот же нативный доступ и современный UI. Python остаётся там, где он силён, — в AI и плагинах. Если команда состоит только из Python-разработчиков, допустима замена оболочки на PySide6 без изменения схемы и API.

**Почему не Postgres/Supabase:** продукт локальный и бесплатный, без аккаунтов. Одна машина — одна БД. Синхронизация между устройствами не входит в scope; если появится, это отдельный слой (экспорт/импорт, а не общая облачная база).

## UI-каркас (реализовано)

`replica/app` — Vite + React 19 + TypeScript. Сейчас собраны:

- `Workspace` — HUD-сцена, чат, композер, история, телеметрия, переключение темы.
- `MiniOverlay` — свёрнутое окошко: аватар `CoreMark` (ядро с орбитами) или `ParticleSphere` (сфера из точек) по выбору в Мастерской → «Аватар», статус и последняя фраза; активация словом «Амадеус», состояние `idle → listening → thinking → speaking`, возврат окна по клику.
- `useWakeWord` — браузерная заглушка распознавания для UI-среза; в продукте заменяется локальным keyword spotter через Tauri IPC.
- Мок-данные и стриминг ответа — `src/data/mock.ts`, чтобы проверить сценарий без бэкенда.
- Мастерская — `src/components/Workshop.tsx`: конструктор команд (фраза, хоткей, цепочка действий), Telegram-бот и переключатель аватара.
- Команды — `src/lib/commands.ts`: хранение в `localStorage`, запуск из чата, голосом, по горячей клавише и из Telegram.
- Аватар — `src/components/CharacterAvatar.tsx`: оригинальный SVG-персонаж, состояния `idle/listening/thinking/speaking/error/muted`.
- Telegram — `src/lib/telegram.ts` и прокси Vite `/telegram`; приём команд работает, пока окно открыто. Для фонового приёма нужен Tauri-процесс.

Команды: `npm install`, `npm run dev`, `npm run build`, `npm run typecheck`.

Бэкенд-срез выполнен: `replica/backend/` (FastAPI + SQLite, 26 таблиц, миграции, keychain, HTTP-зеркало IPC, SSE-стриминг через официальный API Ollama, 19 тестов). При запущенном ядре UI пишет историю в SQLite и получает стриминг; без ядра работает демо-режим. Чек-лист — `replica/backend.md`.

Поверх ядра собраны: экран «Центр управления» (разрешения, напоминания, задачи, память, журнал), настройки S08/S15 и вложения файлов (F05) с извлечением текста в SSE-потоке. Добавлены маршруты `permissions.*`, `actions.*`, `reminders.*`, `tasks.*`, `memory.*`, `settings.locale`, `POST /api/v1/chat/stream`.

Tauri-оболочка в `replica/app/src-tauri/` собрана: `cargo check` и `cargo build` проходят (Windows, MSVC Build Tools + WebView2). Подключён мост `invoke('app_health')`; оживлены команды `notify_os` (уведомления ОС), `capture_screen_base64` (снимок экрана через xcap, уходит в ядро как вложение) и `window_hide`/`window_show`. Остальные ~60 команд пока заглушки. Подпись и установщик не настроены.

Голосовой каскад заложен в `core/voice.py` и `WS /ws/voice`: VAD → STT → LLM → TTS с событиями barge-in; адаптеры Silero/faster-whisper/системный TTS подключаются лениво, по умолчанию работает энергетический VAD. Браузерный клиент `src/hooks/useVoiceSocket.ts` потоково отправляет PCM16 16 кГц с микрофона и воспроизводит WAV; `SpeechRecognition` остаётся запасным путём, включая текстовую команду по клавише W. Для WebSocket обязателен `uvicorn[standard]`.

Локальный Whisper `small` скачан и работает: `faster-whisper` получает numpy-массив PCM 16 кГц (обход несовместимого с Python 3.14 PyAV); круговой тест TTS→STT распознаёт контрольную фразу. Piper и локальный keyword spotter ещё не подключены.

Следующий шаг: подключить Piper с русскими голосами, заменить браузерное распознавание локальным keyword spotter, оживить оставшиеся системные команды и подписать сборку.

## Схема

**Таблиц: 26.** Доступ: data-layer в Rust (один пользователь на машине), RLS нет. Веб-дашборд ходит только через ограниченный набор маршрутов с pairing-токеном и не получает прямого доступа к БД.

Полный SQL: `replica/schema.sql`.

Ключевые решения:

- `id` — UUID v7 в текстовом виде, генерируется приложением (сортируется по времени).
- Время — ISO-8601 UTC (`strftime('%Y-%m-%dT%H:%M:%fZ','now')`), `timestamptz` в SQLite нет.
- Секреты — только `secret_ref`; значение в keychain.
- Содержимое файлов не дублируется: `attachments.storage_ref` + извлечённый текст в зашифрованном файле, не в БД.
- Полнотекстовый поиск по сообщениям и памяти — FTS5 (виртуальные таблицы), синхронизируется триггерами.
- Удаление пользовательских данных — каскадное; `audit_events` хранит только метаданные, без текста запросов.
- Ограничения статусов — `check`-констрейнты; JSON-поля — `json_valid`.
- `strict`-таблицы (SQLite ≥ 3.37), `foreign_keys=ON`, WAL, `busy_timeout`.

Основные связи:

`user_profile 1-n conversations 1-n messages 1-n attachments`
`messages 1-n actions 1-n action_logs`
`user_profile 1-n providers / credentials / reminders / tasks / memory / workspaces / plugin_configs`
`workspaces 1-n project_files / terminal_sessions`
`plugins 1-n plugin_configs / plugin_runs`
`background_tasks 1-n content_reports`

## API

Три контура: **Tauri IPC** (UI ↔ Rust), **sidecar HTTP/WS** (Rust ↔ Python), **dashboard HTTP** (браузер ↔ Rust). Ниже — маршруты по потокам. Все команды, меняющие состояние, требуют активной сессии пользователя; деструктивные — подтверждения на UI.

### Tauri IPC (основной)

| метод | что делает | кто | вход | выход | поток |
| --- | --- | --- | --- | --- | --- |
| `setup.status` | нужен ли онбординг | UI | — | `{needsSetup, locale, mode}` | F01 |
| `setup.complete` | сохранить язык, режим, ключ, завершить | UI | `{locale, mode, credential?}` | `{ok}` | F01 |
| `settings.get` | все настройки | UI | `{keys?}` | `Record<string,json>` | S08–S21 |
| `settings.patch` | изменить настройки | UI | `{patch}` | `{ok, requiresRestart?}` | F16, F22 |
| `settings.search` | поиск по настройкам | UI | `{q}` | `SettingHit[]` | S08 |
| `credentials.set` | сохранить секрет в keychain | UI | `{providerId, secret}` | `{secretRef}` | F01, F16 |
| `credentials.test` | проверить ключ/квоту | UI | `{providerId}` | `{ok, code?, message?}` | F01, F16 |
| `providers.list` | провайдеры и модели | UI | `{stage?}` | `Provider[]` | S15 |
| `providers.upsert` | добавить/изменить провайдера | UI | `{config}` | `Provider` | F16 |
| `providers.apply` | применить и переподключить | UI | `{mode}` | `{ok, reconnected}` | F16 |
| `providers.models` | список моделей | UI | `{providerId}` | `Model[]` | S15 |
| `conversations.list` | список диалогов | UI | `{archived?}` | `Conversation[]` | S05 |
| `conversations.create` | новый диалог | UI | `{title?}` | `Conversation` | F04 |
| `conversations.rename` | переименовать | UI | `{id,title}` | `{ok}` | S05 |
| `conversations.delete` | удалить с подтверждением | UI | `{id}` | `{ok}` | F23 |
| `messages.list` | история сообщений | UI | `{conversationId, cursor?}` | `Message[]` | S04 |
| `messages.send` | отправить текст/вложение | UI | `{conversationId, text, attachmentIds}` | `{messageId}` | F04 |
| `messages.cancel` | прервать генерацию | UI | `{messageId}` | `{ok}` | F04 |
| `attachments.add` | добавить файл/скриншот | UI | `{messageId?, kind, path?}` | `Attachment` | F05, F06 |
| `attachments.remove` | удалить вложение | UI | `{id}` | `{ok}` | F05 |
| `capture.screen` | снимок экрана | UI | `{displayId?}` | `{attachmentId}` | F06 |
| `capture.region` | выделение области | UI | `{rect, displayId}` | `{attachmentId}` | F06 |
| `clipboard.read` | прочитать буфер | UI | — | `{text, kind}` | F06 |
| `telemetry.subscribe` | поток метрик | UI | `{intervalMs}` | event `telemetry` | S03 |
| `actions.propose` | создать действие | ядро | `{tool,args,risk}` | `Action` | F07 |
| `actions.approve` | подтвердить | UI | `{id, remember?}` | `Action` | F07 |
| `actions.deny` | отклонить | UI | `{id, reason?}` | `Action` | F07 |
| `actions.cancel` | отменить | UI | `{id}` | `Action` | F07 |
| `permissions.get` | режимы разрешений | UI | — | `Permission[]` | S14 |
| `permissions.patch` | изменить режим | UI | `{scope,mode}` | `{ok}` | F17 |
| `workspaces.list` | папки проектов | UI | — | `Workspace[]` | S22 |
| `workspaces.select` | выбрать папку | UI | `{path}` | `Workspace` | F08 |
| `workspaces.files` | дерево файлов | UI | `{id, path?}` | `FileNode[]` | S22 |
| `workspaces.readFile` | прочитать текст | UI | `{id, path}` | `{content, mtime}` | S23 |
| `workspaces.writeFile` | сохранить текст | UI | `{id, path, content, baseMtime}` | `{mtime}` | F08 |
| `terminal.create` | новая сессия | UI | `{workspaceId?}` | `TerminalSession` | F09 |
| `terminal.input` | ввод | UI | `{id, data}` | `{ok}` | F09 |
| `terminal.resize` | размер | UI | `{id, cols, rows}` | `{ok}` | F09 |
| `terminal.close` | закрыть | UI | `{id}` | `{ok}` | F09 |
| `memory.search` | поиск по памяти | UI | `{q}` | `MemoryEntry[]` | F15 |
| `memory.forget` | удалить запись/всё | UI | `{id?}` | `{ok}` | F15 |
| `reminders.list` | напоминания | UI | `{status?}` | `Reminder[]` | F10 |
| `reminders.create` | создать | UI | `{title,dueAt,repeat?}` | `Reminder` | F10 |
| `reminders.update` | изменить | UI | `{id,patch}` | `Reminder` | F10 |
| `reminders.delete` | удалить | UI | `{id}` | `{ok}` | F10 |
| `tasks.list` | задачи | UI | `{status?}` | `Task[]` | S06 |
| `tasks.upsert` | создать/изменить | UI | `{task}` | `Task` | S06 |
| `tasks.delete` | удалить | UI | `{id}` | `{ok}` | S06 |
| `research.start` | фоновая задача | UI | `{prompt}` | `BackgroundTask` | F11 |
| `research.cancel` | отменить | UI | `{id}` | `{ok}` | F11 |
| `research.report` | отчёт | UI | `{id}` | `ContentReport` | S07 |
| `plugins.list` | плагины | UI | — | `Plugin[]` | S16 |
| `plugins.toggle` | включить/выключить | UI | `{id, enabled}` | `Plugin` | F13 |
| `plugins.config` | настройки плагина | UI | `{id}` | `ConfigSchema, values` | S17 |
| `plugins.saveConfig` | сохранить | UI | `{id, values}` | `{ok}` | F13 |
| `plugins.test` | тест | UI | `{id, values?}` | `{ok, message}` | F13 |
| `plugins.run` | вызвать инструмент | ядро | `{id, action, params}` | `{result}` | F13 |
| `plugins.install` | установить из архива | UI | `{path}` | `Plugin` | F13 |
| `updates.status` | состояние обновлений | UI | — | `UpdateState` | F19 |
| `updates.check` | проверить | UI | — | `UpdateState` | F19 |
| `updates.download` | скачать | UI | — | event `updateProgress` | F19 |
| `updates.install` | установить | UI | `{confirmed:true}` | `{ok}` | F19 |
| `dashboard.start` | поднять локальный сервер | UI | `{https}` | `{url, pairingCode}` | F18 |
| `dashboard.pairings` | устройства | UI | — | `DevicePairing[]` | F18 |
| `dashboard.revoke` | отозвать | UI | `{id}` | `{ok}` | F18 |
| `lock.set` | задать PIN/пароль | UI | `{kind, secret}` | `{ok}` | F20 |
| `lock.unlock` | разблокировать | UI | `{secret}` | `{ok, retryAfter?}` | F20 |
| `diagnostics.logs` | логи | UI | `{tail}` | `string[]` | S20 |
| `diagnostics.export` | экспорт логов | UI | — | `{path}` | S20 |
| `app.quit` | выход | UI | `{force?}` | — | — |

### Sidecar (Python, localhost)

| метод | что делает | кто | вход | выход | поток |
| --- | --- | --- | --- | --- | --- |
| `GET /health` | жив ли движок, версии | Rust | — | `{status, models, gpu}` | старт/рестарт |
| `GET /v1/models` | доступные модели Ollama/облака | Rust | `{providerId}` | `Model[]` | S15 |
| `POST /v1/stt` | распознать аудио | Rust | `audio/*` | `{text, lang, segments}` | F03 |
| `POST /v1/tts` | синтез речи | Rust | `{text, voice}` | `audio/wav` | F03 |
| `POST /v1/chat/stream` | стриминг ответа | Rust | `{messages, model, tools}` | SSE-токены | F02, F04 |
| `WS /ws/voice` | живая сессия: аудио, VAD, barge-in | Rust | бинарные кадры + JSON | аудио + события | F02, F03 |
| `WS /ws/plugins/{id}` | RPC плагина | Rust | JSON-RPC | JSON-RPC | F13, F14 |

### Dashboard (локальный HTTP, pairing)

| метод | что делает | кто | вход | выход | поток |
| --- | --- | --- | --- | --- | --- |
| `POST /pair` | обменять код на токен | браузер | `{code, deviceName}` | `{token}` | F18 |
| `GET /api/status` | статус ассистента | браузер | Bearer | `{status, telemetry}` | F18 |
| `GET /api/tasks` | задачи и отчёты | браузер | Bearer | `Task[]` | F18 |
| `POST /api/messages` | отправить запрос | браузер | Bearer + text | `{messageId}` | F18 |
| `GET /api/events` | SSE-события | браузер | Bearer | stream | F18 |
| `DELETE /api/pairings` | отозвать устройство | владелец | Bearer | `{ok}` | F18 |

**Webhooks in:** нет (продукт локальный; Telegram-бот — опциональный плагин, а не ядро).
**Webhooks out:** нет.
**Jobs:**
- `reminder-scheduler` — каждую минуту: найти `reminders.due_at <= now`, отправить уведомление, обновить статус.
- `background-worker` — очередь `background_tasks` со статусом `queued`, один воркер на пользователя, отмена по флагу.
- `update-check` — при старте и каждые 6 часов.
- `attachment-cleanup` — ежедневно: удалить осиротевшие файлы старше 30 дней.
- `log-rotation` — ежедневно: ротация и сжатие, лимит 50 МБ.
- `plugin-health` — при старте и после установки: проверить манифест, зависимости, процесс.
- `metric-sampler` — каждые 2 секунды в памяти (не в БД), график за 5 минут.

## Голосовой слой

Gemini Live не является обязательным. Голосовой цикл собирается из независимых провайдеров, а Gemini остаётся одним из опциональных адаптеров, если у пользователя уже есть ключ.

### Три режима

| режим | состав | задержка | интернет | кому |
| --- | --- | --- | --- | --- |
| **Локальный (по умолчанию)** | Silero VAD → faster-whisper → Ollama → Piper/Silero TTS | 0,8–1,8 с на GPU; 3–6 с на CPU | не нужен | большинство; основной путь |
| **Облачный fallback для РФ** | Yandex Streaming STT → YandexGPT → Yandex TTS | 0,8–1,5 с | нужен, VPN не нужен | слабые ПК, русский язык |
| **Realtime-адаптер (опция)** | OpenAI Realtime, Gemini Live | 0,3–0,8 с | нужен, часто VPN и зарубежная карта | EN, максимальное качество |

### Контракт провайдеров

В Python sidecar — четыре независимых протокола. Оркестратор не знает, локальный провайдер или облачный:

```python
class STT(Protocol):
    async def stream(self, audio: AsyncIterator[bytes]) -> AsyncIterator[TranscriptEvent]: ...

class LLM(Protocol):
    async def stream_chat(self, messages: list[Message], tools: list[Tool]) \
        -> AsyncIterator[TokenEvent | ToolCall]: ...

class TTS(Protocol):
    async def stream(self, text: str, voice: str) -> AsyncIterator[bytes]: ...

class Realtime(Protocol):
    async def session(self, audio_in: AsyncIterator[bytes], audio_out: AsyncIterator[bytes]) -> None: ...
```

Оркестратор: VAD → STT → LLM (с tools) → TTS. Событие `speech_started` очищает очередь TTS и отменяет текущий ответ — это barge-in. Аудио: PCM 16 кГц, 16 бит, моно, чанки 20 мс, WebSocket binary. Эхоподавление — WebRTC APM или speexdsp, иначе микрофон слышит собственный голос.

### Выбор моделей

- **STT:** faster-whisper `small`/`medium`/`large-v3-turbo`; для RU — `large-v3-turbo` на GPU, `small` на CPU. Vosk — лёгкий офлайн-вариант, качество ниже.
- **LLM:** Ollama `qwen2.5:7b` (RU), `llama3.1:8b`, `gemma2:9b`; для слабых ПК — `qwen2.5:3b`. Поддержка tools обязательна, иначе ассистент не вызывает команды.
- **TTS:** Piper `ru_RU-irina-medium`, `ru_RU-dmitri-medium` (MIT-код, голоса — проверить лицензию); Silero TTS (лучший русский, но лицензия CC BY-NC-SA — только для некоммерческого использования); Kokoro для EN (Apache 2.0); Fish Audio — опционально (проверить лицензию весов).
- **VAD:** Silero VAD (MIT) — 20–50 мс задержки, работает на CPU.

### Бюджет задержки

- Первый звук ≤ 1,5 с на GPU или облаке; ≤ 3 с на CPU — честно показывать в настройках.
- Первый токен LLM ≤ 600 мс (GPU) / ≤ 1,5 с (CPU).
- Кэш TTS по хэшу текста и голоса; предзагрузка модели при старте сессии.
- Метрики: `time_to_first_token`, `time_to_first_audio`, `real_time_factor`, `wer` — показывать в developer mode.

### Что удаляется из обязательного

- Google Cloud API key больше не требуется для запуска.
- Gemini Live остаётся адаптером `stage = live`; если ключа нет — просто не показывается в настройках.
- «Работает без VPN» становится проверяемым свойством: локальный режим запускается на чистой машине без сети.

## Части, которые кусаются

- **Голос в реальном времени.** WebSocket-аудио, частота дискретизации, эхо и barge-in. На Bluetooth-гарнитурах задержка и смена устройства. Лечение: единый аудиослой в sidecar, ring-buffer, VAD, явные события `listening/thinking/speaking`, отмена по `Escape`.
- **Три ОС — три набора API.** Windows: UAC, ConPTY, Credential Manager, WinRT для громкости. macOS: Accessibility и Screen Recording permissions, нотаризация, Keychain, события клавиатуры. Linux: X11 vs Wayland (захват экрана и глобальные хоткеи), PipeWire, libsecret, разные DE. Лечение: trait `Platform` в Rust, фичефлаги, честные «недоступно» вместо падений, CI на всех трёх ОС.
- **Плагины и безопасность.** Python-плагин исполняется с правами пользователя — это не песочница. Лечение: отдельный процесс, манифест с `permissions`, белый список API, таймаут, лимит памяти, подтверждение установки, подпись каталога, запрет автозапуска без согласия. Никакого «просто импортируем модуль в основной процесс».
- **Секреты.** Ключи не должны попасть в логи, БД, крэш-дампы и экспорт настроек. Лечение: keychain, `secret_ref`, маскирование в логах, отдельный redaction-фильтр, тест на утечку.
- **Локальные модели.** Память, размер, скорость, лицензии. Лечение: проверка железа на старте, рекомендованные пресеты (3B/7B), предупреждение о RAM/VRAM, возможность работать без локальной модели.
- **Обновления и подпись.** Без подписи Windows SmartScreen и macOS Gatekeeper блокируют установку. Лечение: code signing, notarization, stapling, подпись артефактов Tauri, каналы stable/beta.
- **Миграции и откат.** Пользователь может откатиться на старую версию. Лечение: forward-only миграции, резервная копия БД перед миграцией, запрет downgrade без бэкапа.
- **Приватность.** Скриншоты, файлы и аудио уходят провайдеру. Лечение: явные индикаторы, «локальный режим», список того, что и куда отправляется, отключение телеметрии по умолчанию, удаление данных.
- **DPI и доступность.** HUD на 100–200%, длинные русские строки, контраст, клавиатурная навигация. Лечение: токены, тесты на масштабах, aria, фокус-ринги.
- **Терминал.** ConPTY на Windows, PTY на Unix, кодировки, зависшие процессы, закрытие вкладки с живым процессом. Лечение: дерево процессов, kill по группе, подтверждение закрытия.
- **Размер и запуск.** Python sidecar утяжеляет установщик. Лечение: ленивая установка локальных моделей, on-demand загрузка Whisper/Piper, упаковка PyInstaller/Nuitka, health-check и автоперезапуск sidecar.

## Уроки конкурента JARVIS PRO

Отзывы реальных пользователей (группа AMBIONYS, 2026-11-23) дали шесть требований, которые важнее многих фич:

| наблюдение | требование к архитектуре |
| --- | --- |
| жалобы на задержку 1–2 с | бюджет: первый звук/токен ≤ 1,5 с на локальном пайплайне; стриминг и предзагрузка модели; отмена и barge-in |
| «нужен VPN» для облака | локальный режим должен быть полноценным: Ollama + Whisper + Piper без сети; облако — опция |
| антивирус блокирует неподписанный exe | подпись Windows и macOS notarization с первого публичного билда, а не «потом» |
| нет напоминаний | напоминания и задачи — must, уведомление в любом чате |
| «где скачать плагины» | каталог плагинов с установкой из приложения — should, не откладывать на «когда-нибудь» |
| «сам скачивает программы» | в MVP не автоматизировать; только предложение ссылки и явное подтверждение |

## Порядок сборки

### 1. Вертикальный срез (доказывает стек)

**Экраны:** S01 (Setup), S02 (главный), S04 (чат), S08 (General — только язык/тема).
**Таблицы:** `user_profile`, `settings`, `api_credentials`, `provider_configs`, `conversations`, `messages`.
**Маршруты:** `setup.status/complete`, `credentials.set/test`, `providers.list/upsert/apply`, `conversations.create/list`, `messages.send/list/cancel`, sidecar `/v1/chat/stream`, `/health`.
**Результат:** пользователь выбирает RU/EN и Ollama, пишет сообщение, получает стриминговый ответ, история сохраняется после перезапуска. HUD — статичная заглушка.

### 2. Must-haves по областям

- **Голос:** `attachments` (аудио), sidecar `/v1/stt`, `/v1/tts`, `WS /ws/voice`, PTT, устройства и тест (S10).
- **HUD и телеметрия:** `telemetry.subscribe`, `SystemMetric` в памяти, S03.
- **Команды и безопасность:** `permissions`, `actions`, `action_logs`, S14, подтверждения, открытие приложений, громкость, скриншот, выключение.
- **Проект:** `workspaces`, `project_files`, `terminal_sessions`, S22–S24, редактор с `baseMtime`.
- **Память и напоминания:** `memory_entries`, `reminders`, `tasks`, S06, S18, FTS5.
- **Плагины v1:** `plugins`, `plugin_configs`, `plugin_runs`, S16–S17, JSON-RPC-хост, манифест, разрешения.
- **Настройки:** S08–S15 полностью, поиск, миграции, i18n.
- **Обновления:** S21, подпись, GitHub Releases.

### 3. Should-haves

Wake-word, архив (S05), фоновые исследования и отчёты (S07), утренний бриф, журнал действий, PIN-блокировка (S27), developer mode (S20), DPI/доступность, экспорт/импорт, автопостановка черновика.

### 4. Could-haves

Курсор-ассистент (S13), каталог плагинов, плагины-дашборды (S25), локальный веб-дашборд и pairing (S26), Telegram/погода/YouTube/ElevenLabs, автозапуск, дополнительные темы.

### 5. Правки от `/replica-entrepreneur`

После первых отзывов: приоритизировать то, что пользователи просят, и закрыть найденные баги. До этого момента не расширять scope.

## Тесты и качество

- **Rust:** `cargo test` — permission-gate, пути workspace (нельзя выйти за папку), миграции, парсинг манифестов.
- **Python:** `pytest` — STT/TTS-адаптеры с моками, стриминг, JSON-RPC плагинов, таймауты.
- **UI:** Vitest + Playwright (Tauri-драйвер) — setup, чат, подтверждение действия, настройки.
- **Контракты:** JSON Schema для `plugin.json`, OpenAPI для sidecar и dashboard.
- **CI:** матрица ОС, сборка артефактов, проверка подписи, smoke-тест установки.
- **Приватность:** тест, что ключи и текст не попадают в логи и экспорт.

## Что осознанно не делаем

- Облачный аккаунт, синхронизация между устройствами, командная работа.
- Платежи, подписки, магазин приложений.
- Мобильные клиенты.
- Чужие плагины, бренд JARVIS, код и ассеты референсов.
- OSINT, трейдинг, биометрия лица в MVP.


## Уточнения второй партии (2026-11-25)

- Системные действия и проект реализованы **в Python sidecar**, а не только в Rust: это позволяет покрыть их pytest и Playwright в браузерном режиме. Tauri-команды остаются тонким нативным мостом (`notify_os`, `capture_screen_base64`, `window_hide/show`).
- Голос по умолчанию использует энергетический VAD; Silero включается `AMADEUS_VAD=silero`. TTS — системный (`pyttsx3`/SAPI5), Piper подключается через `AMADEUS_TTS=piper` + `AMADEUS_PIPER_BIN`/`AMADEUS_PIPER_MODEL`.
- Локальный wake-word работает на стороне ядра (`WS /ws/wake`, общая модель Whisper на процесс); браузерный `SpeechRecognition` остаётся запасным путём до подключения `/ws/wake` к UI.
- Все новые HTTP-маршруты следуют существующему соглашению с точкой: `/api/system.metrics`, `/api/workspace.tree`, `/api/settings.index` и т. д. Клиент `src/lib/api.ts` использует тот же формат.
- Подпись и установщик Tauri не настроены (нет сертификата); кроссплатформенность закрыта cfg-ветками в коде, проверено только на Windows.
