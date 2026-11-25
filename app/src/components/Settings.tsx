import { useCallback, useEffect, useState } from "react";
import {
  lockApi,
  modelsApi,
  prefs,
  settingsApi,
  shellHealth,
  updatesApi,
  voiceApi,
  webApi,
  workspaceApi,
} from "../lib/api";
import { t as translate, type Locale } from "../lib/i18n";
import { setSoundEnabled, setSoundVolume, soundEnabled, soundVolume } from "../lib/sound";
import { loadStartSphere, saveStartSphere } from "../lib/preferences";
import "./control.css";
import "./settings.css";

type Props = {
  theme: "dark" | "light" | "auto";
  onTheme: (theme: "dark" | "light" | "auto") => void;
  onOpenCenter: () => void;
  onClose: () => void;
};

type ProviderRow = {
  id: string;
  stage: string;
  provider_id: string;
  model_id: string | null;
  is_active: boolean;
  builtin: boolean;
};

type WebStatus = { provider: string; searx_url: string; has_brave_key: boolean };

type WorkspaceState = { root: string | null; name: string | null; allow_write: boolean };

type UpdateState = {
  current_version: string;
  manifest_url: string;
  channel: string;
  state: Record<string, unknown> | null;
};

type VoiceInfo = { voices: Array<{ id: string; name: string; locale: string }>; piper: Record<string, unknown> };

export function Settings({ theme, onTheme, onOpenCenter, onClose }: Props) {
  const [locale, setLocale] = useState<Locale>("ru");
  const [accent, setAccent] = useState("cyan");
  const [mode, setMode] = useState("local");
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [shell, setShell] = useState("браузер");
  const [webProvider, setWebProvider] = useState("off");
  const [webSearxUrl, setWebSearxUrl] = useState("");
  const [braveKey, setBraveKey] = useState("");
  const [webStatus, setWebStatus] = useState<WebStatus | null>(null);
  const [manifestUrl, setManifestUrl] = useState("");
  const [channel, setChannel] = useState("stable");
  const [updates, setUpdates] = useState<UpdateState | null>(null);
  const [updatesBusy, setUpdatesBusy] = useState(false);
  const [workspace, setWorkspace] = useState<WorkspaceState>({
    root: null,
    name: null,
    allow_write: false,
  });
  const [autostart, setAutostart] = useState(false);
  const [sound, setSound] = useState(soundEnabled);
  const [volume, setVolume] = useState(() => Math.round(soundVolume() * 100));
  const [startSphere, setStartSphere] = useState(loadStartSphere);
  const [settingsQuery, setSettingsQuery] = useState("");
  const [settingsIndex, setSettingsIndex] = useState<Array<{ key: string; title: string; category: string }>>([]);
  const [exportText, setExportText] = useState("");
  const [importText, setImportText] = useState("");
  const [importData, setImportData] = useState<{ format?: string; version?: number; exported_at?: string; profile?: Record<string, unknown>; settings: Record<string, unknown> } | null>(null);
  const [voiceId, setVoiceId] = useState("");
  const [voices, setVoices] = useState<VoiceInfo["voices"]>([]);
  const [ollamaUrl, setOllamaUrl] = useState("http://127.0.0.1:11434");
  const [ollamaError, setOllamaError] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState("");
  const [lockPin, setLockPin] = useState("");
  const [lockVerify, setLockVerify] = useState("");
  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3000);
  }, []);

  const run = useCallback(async (work: () => Promise<void>) => {
    try {
      setError("");
      await work();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Ошибка");
    }
  }, []);

  useEffect(() => {
    void shellHealth().then((info) => setShell(info ? `Tauri ${info.version}` : "браузер"));
  }, []);

  useEffect(() => {
    void run(async () => {
      const values = await prefs.get([
        "app.locale",
        "ai.mode",
        "ui.accent",
        "web.provider",
        "web.searx_url",
        "workspace.root",
        "workspace.allow_write",
        "app.autostart",
        "updates.manifest_url",
        "updates.channel",
        "voice.tts_voice",
        "privacy.telemetry",
      ]);
      setLocale(values["app.locale"] === "en" ? "en" : "ru");
      setAccent(typeof values["ui.accent"] === "string" ? String(values["ui.accent"]) : "cyan");
      setMode(typeof values["ai.mode"] === "string" ? values["ai.mode"] : "local");
      setWebProvider(typeof values["web.provider"] === "string" ? values["web.provider"] : "off");
      setWebSearxUrl(typeof values["web.searx_url"] === "string" ? String(values["web.searx_url"]) : "");
      setWorkspace({
        root: typeof values["workspace.root"] === "string" ? String(values["workspace.root"]) : null,
        name: null,
        allow_write: Boolean(values["workspace.allow_write"]),
      });
      setAutostart(Boolean(values["app.autostart"]));
      setManifestUrl(typeof values["updates.manifest_url"] === "string" ? String(values["updates.manifest_url"]) : "");
      setChannel(typeof values["updates.channel"] === "string" ? String(values["updates.channel"]) : "stable");
      const voiceStored = typeof values["voice.tts_voice"] === "string" ? String(values["voice.tts_voice"]) : "";
      const voiceInfo = await voiceApi.voices();
      setVoices(voiceInfo.voices);
      setVoiceId(voiceStored || voiceInfo.voices[0]?.id || "");
      setWebStatus(await webApi.status());
      const updatesInfo = await updatesApi.status();
      setUpdates(updatesInfo);
      setProviders(await prefs.providers());
      const info = await modelsApi.list();
      setModels(info.ollama);
      setOllamaError(info.error);
      setSelectedModel(String(info.active?.model_id ?? info.ollama[0] ?? ""));
      if (!values["ai.mode"] && info.active?.provider_id) {
        setMode(String(info.active.provider_id));
      }
      const index = await settingsApi.index(settingsQuery);
      setSettingsIndex(index);
    });
  }, [run, settingsQuery]);

  const changeLocale = (value: string) => {
    const next: Locale = value === "en" ? "en" : "ru";
    setLocale(next);
    void run(async () => {
      await prefs.setLocale(next);
      await prefs.patch({ "app.locale": next });
      window.dispatchEvent(new CustomEvent("amadeus.locale", { detail: next }));
      notify("Язык сохранён");
    });
  };

  const changeAccent = (value: string) => {
    setAccent(value);
    void run(async () => {
      await prefs.patch({ "ui.accent": value });
      window.dispatchEvent(new CustomEvent("amadeus.accent", { detail: value }));
      notify("Акцент сохранён");
    });
  };

  const changeMode = (value: string) => {
    setMode(value);
    void run(async () => {
      await prefs.applyProvider(value);
      notify("Провайдер применён");
    });
  };

  const changeWebProvider = (value: string) => {
    setWebProvider(value);
    void run(async () => {
      await prefs.patch({ "web.provider": value });
      notify("Провайдер поиска сохранён");
    });
  };

  const checkUpdates = () => {
    void run(async () => {
      setUpdatesBusy(true);
      const result = await updatesApi.check({ manifest_url: manifestUrl, channel });
      setUpdates(result as UpdateState);
      notify("Проверка обновлений выполнена");
    });
  };

  const exportSettings = () => {
    void run(async () => {
      const payload = await settingsApi.export();
      setExportText(JSON.stringify(payload, null, 2));
      setImportData(payload);
      notify("Настройки экспортированы");
    });
  };

  const importSettings = () => {
    if (!importData) return;
    void run(async () => {
      const result = await settingsApi.import(importData);
      notify(`Импортировано настроек: ${result.applied}`);
      setImportText("");
    });
  };

  const saveWorkspaceRoot = (value: string) => {
    void run(async () => {
      await workspaceApi.set(value, workspace.allow_write);
      notify("Папка проекта сохранена");
    });
  };

  const toggleWorkspaceWrite = (value: boolean) => {
    setWorkspace((prev) => ({ ...prev, allow_write: value }));
    void run(async () => {
      await workspaceApi.patch(value);
      notify(value ? "Запись в проект разрешена" : "Запись в проект выключена");
    });
  };

  const saveAutostart = (value: boolean) => {
    setAutostart(value);
    void run(async () => {
      await prefs.patch({ "app.autostart": value });
      notify(value ? "Автозапуск включён" : "Автозапуск выключен");
    });
  };

  const saveVoice = (id: string) => {
    setVoiceId(id);
    void run(async () => {
      const result = await voiceApi.select(id);
      if (result.ok) notify("Голос синтеза сохранён");
    });
  };

  const checkOllama = () => {
    void run(async () => {
      const info = await modelsApi.list();
      setModels(info.ollama);
      setOllamaError(info.error);
      setSelectedModel(String(info.active?.model_id ?? info.ollama[0] ?? ""));
      notify(info.error ? `Ollama не отвечает: ${info.error}` : `Ollama подключена. Моделей: ${info.ollama.length}`);
    });
  };

  const connectOllama = () => {
    if (!selectedModel) {
      notify("Сначала выберите модель из списка");
      return;
    }
    void run(async () => {
      await modelsApi.activate("ollama", selectedModel, ollamaUrl.trim() || undefined);
      await prefs.applyProvider("local");
      notify(`Подключена модель: ${selectedModel}`);
      checkOllama();
    });
  };

  const checkMicrophone = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      notify("Микрофон работает");
    } catch {
      notify("Микрофон недоступен. Разрешите доступ в системе");
    }
  };

  const saveLockPin = () => {
    void run(async () => {
      const result = await lockApi.set(lockPin);
      if (result.ok) notify("PIN установлен");
    });
  };

  const verifyLockPin = () => {
    void run(async () => {
      const result = await lockApi.verify(lockVerify);
      notify(result.ok ? "PIN принят" : "PIN не принят");
    });
  };

  const saveBraveKey = async () => {
    if (!braveKey.trim()) return;
    const saved = await prefs.setCredential("brave-search", braveKey.trim());
    setBraveKey("");
    notify("Ключ сохранён в keychain");
    setWebStatus(await webApi.status());
    return saved;
  };

  const categories = Array.from(new Set(settingsIndex.map((item) => item.category)));

  return (
    <div className="center-overlay" role="dialog" aria-modal="true" aria-label="Настройки">
      <div className="center settings">
        <div className="center-head">
          <div>
            <h1>{translate(locale, "settings.title")}</h1>
            <p>Всё хранится на этом компьютере. Никакой облачной учётной записи. Оболочка: {shell}.</p>
          </div>
          <button type="button" className="center-close" onClick={onClose} aria-label="Закрыть настройки">
            ×
          </button>
        </div>

        <div className="center-body" role="tabpanel" tabIndex={0}>
          {error && <p className="center-error" role="alert">{error}</p>}

          <section className="setup-guide" aria-labelledby="quick-setup">
            <h2 id="quick-setup">Как запустить голос</h2>
            <ol className="setup-steps">
              <li>
                <b>1. Подключите Ollama</b>
                <p>Это локальная программа с моделями. Она должна быть запущена на этом компьютере.</p>
                <div className="center-form">
                  <label>
                    Адрес Ollama
                    <input
                      value={ollamaUrl}
                      onChange={(event) => setOllamaUrl(event.target.value)}
                      placeholder="http://127.0.0.1:11434"
                    />
                  </label>
                  <div className="center-actions">
                    <button type="button" className="center-primary" onClick={checkOllama}>
                      Проверить подключение
                    </button>
                  </div>
                  <p className={`center-hint ${ollamaError ? "center-error" : ""}`}>
                    {ollamaError
                      ? `Не подключено: ${ollamaError}. Запустите Ollama и нажмите «Проверить подключение».`
                      : `Подключено. Доступно моделей: ${models.length}.`}
                  </p>
                </div>
              </li>
              <li>
                <b>2. Выберите модель и подключите её</b>
                <p>Без выбранной модели ассистент не сможет отвечать.</p>
                <div className="center-form">
                  <label>
                    Модель
                    <select value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)}>
                      {models.length === 0 && <option value="">Нет доступных моделей</option>}
                      {models.map((model) => (
                        <option key={model} value={model}>{model}</option>
                      ))}
                    </select>
                  </label>
                  <div className="center-actions">
                    <button type="button" className="center-primary" onClick={connectOllama}>
                      Подключить модель
                    </button>
                  </div>
                </div>
              </li>
              <li>
                <b>3. Выберите голос и проверьте микрофон</b>
                <p>Раздел «Голос» ниже. Нажмите «Проверить микрофон», чтобы убедиться, что ассистент вас слышит.</p>
              </li>
            </ol>
          </section>

          <section aria-labelledby="general-settings">
            <h2 id="general-settings">{translate(locale, "settings.general")}</h2>
            <div className="center-form">
              <label>
                Язык интерфейса
                <select value={locale} onChange={(event) => changeLocale(event.target.value)}>
                  <option value="ru">Русский</option>
                  <option value="en">Английский</option>
                </select>
              </label>
              <label>
                Тема
                <select value={theme} onChange={(event) => onTheme(event.target.value as "dark" | "light" | "auto")}>
                  <option value="dark">Тёмная</option>
                  <option value="light">Светлая · Партитура</option>
                  <option value="auto">Авто</option>
                </select>
              </label>
              <label>
                {translate(locale, "settings.accent")}
                <select value={accent} onChange={(event) => changeAccent(event.target.value)}>
                  {(["cyan", "brass", "green"] as const).map((value) => (
                    <option key={value} value={value}>
                      {translate(locale, `accent.${value}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="center-inline">
                Автозапуск с системой
                <input
                  type="checkbox"
                  checked={autostart}
                  aria-label="Автозапуск с системой"
                  onChange={(event) => saveAutostart(event.target.checked)}
                />
              </label>
              <label className="center-inline">
                Звуковая подпись событий
                <input
                  type="checkbox"
                  checked={sound}
                  aria-label="Звуковая подпись событий"
                  onChange={(event) => {
                    setSound(event.target.checked);
                    setSoundEnabled(event.target.checked);
                  }}
                />
              </label>
              <label className="center-inline">
                Громкость подписи <span aria-hidden="true">{volume}%</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={volume}
                  aria-label="Громкость звуковой подписи"
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    setVolume(next);
                    setSoundVolume(next / 100);
                  }}
                />
              </label>
              <label className="center-inline">
                Запускать в режиме «Сфера»
                <input
                  type="checkbox"
                  checked={startSphere}
                  aria-label="Запускать в режиме Сфера"
                  onChange={(event) => {
                    setStartSphere(event.target.checked);
                    saveStartSphere(event.target.checked);
                  }}
                />
              </label>
            </div>
          </section>

          <section aria-labelledby="provider-settings">
            <h2 id="provider-settings">{translate(locale, "settings.providers")}</h2>
            <div className="center-form">
              <label>
                Режим
                <select value={mode} onChange={(event) => changeMode(event.target.value)}>
                  <option value="local">Локальный пайплайн</option>
                  <option value="cloud">Облачный адаптер</option>
                  <option value="live">Realtime-адаптер</option>
                </select>
              </label>
              <label>
                Модель
                <select
                  value={providers.find((item) => item.is_active)?.model_id ?? models[0] ?? ""}
                  onChange={(event) => void run(async () => {
                    const selected = providers.find((item) => item.is_active)?.provider_id ?? "ollama";
                    await modelsApi.activate(selected, event.target.value);
                    notify("Модель выбрана");
                  })}
                >
                  {models.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <ul className="center-list">
              {providers.map((item) => (
                <li key={item.id}>
                  <span className="center-item-title">{item.provider_id}</span>
                  <span className="center-item-meta">{item.stage} · {item.model_id ?? "модель не задана"}</span>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="web-settings">
            <h2 id="web-settings">Веб-поиск</h2>
            <div className="center-form">
              <label>
                Провайдер
                <select value={webProvider} onChange={(event) => changeWebProvider(event.target.value)}>
                  <option value="off">Не настроен</option>
                  <option value="brave">Brave Search</option>
                  <option value="searxng">SearXNG</option>
                </select>
              </label>
              {webProvider === "searxng" && (
                <label>
                  Адрес SearXNG
                  <input value={webSearxUrl} onChange={(event) => setWebSearxUrl(event.target.value)} placeholder="https://searx.example" />
                </label>
              )}
              <label>
                Ключ Brave Search
                <input
                  type="password"
                  value={braveKey}
                  onChange={(event) => setBraveKey(event.target.value)}
                  placeholder="Не сохраняется в базе"
                  autoComplete="off"
                />
              </label>
              <button type="button" className="center-primary" onClick={() => void run(async () => {
                await saveBraveKey();
              })}>
                Сохранить ключ
              </button>
              {webStatus && (
                <p className="center-hint">
                  Поиск: {webStatus.provider === "off" ? "не настроен" : webStatus.provider}
                  {" · "}ключ Brave: {webStatus.has_brave_key ? "сохранён" : "не задан"}
                </p>
              )}
              <button
                type="button"
                className="center-primary"
                onClick={() => void run(async () => {
                  setWebStatus(await webApi.status());
                })}
              >
                Обновить статус
              </button>
              <label>
                Запрос поиска
                <input value={settingsQuery} onChange={(event) => setSettingsQuery(event.target.value)} placeholder="Например, модель или голос" />
              </label>
            </div>
          </section>

          <section aria-labelledby="voice-settings">
            <h2 id="voice-settings">{translate(locale, "settings.voice")}</h2>
            <div className="center-form">
              <label>
                Голос
                <select value={voiceId} onChange={(event) => saveVoice(event.target.value)}>
                  {voices.length === 0 && <option value="">Голосов не найдено</option>}
                  {voices.map((voice) => (
                    <option key={voice.id} value={voice.id}>
                      {voice.name} ({voice.locale})
                    </option>
                  ))}
                </select>
              </label>
              <p className="center-hint">Это голос, которым Амадеус отвечает. Микрофон нужен, чтобы он вас слышал.</p>
              <div className="center-actions">
                <button type="button" className="center-primary" onClick={() => void checkMicrophone()}>
                  Проверить микрофон
                </button>
              </div>
              <p className="center-hint">Проверенный путь: микрофон → Whisper → локальная модель → TTS.</p>
            </div>
          </section>

          <section aria-labelledby="update-settings">
            <h2 id="update-settings">Обновления</h2>
            <div className="center-form">
              <label>
                Сервер обновлений
                <input value={manifestUrl} onChange={(event) => setManifestUrl(event.target.value)} placeholder="https://update.amadeus.local/latest.json" />
              </label>
              <label>
                Канал
                <select value={channel} onChange={(event) => setChannel(event.target.value)}>
                  <option value="stable">стабильный</option>
                  <option value="beta">бета</option>
                </select>
              </label>
              <button type="button" className="center-primary" onClick={checkUpdates} disabled={updatesBusy}>
                Проверить обновления
              </button>
              {updates && (
                <p className="center-hint">
                  {String(updates.state?.available ?? false)} · версия {String(updates.current_version)} · заметки {String(updates.state?.notes ?? "")}
                </p>
              )}
            </div>
          </section>

          <section aria-labelledby="project-settings">
            <h2 id="project-settings">Проект</h2>
            <div className="center-form">
              <label>
                Папка проекта
                <input value={workspace.root ?? ""} onChange={(event) => setWorkspace((prev) => ({ ...prev, root: event.target.value }))} placeholder="/home/user/проект" />
              </label>
              <button type="button" className="center-primary" onClick={() => void run(async () => {
                if (workspace.root) await saveWorkspaceRoot(workspace.root);
              })}>
                Сохранить папку
              </button>
              <label className="center-inline">
                Разрешить изменения в проекте
                <input type="checkbox" checked={workspace.allow_write} onChange={(event) => toggleWorkspaceWrite(event.target.checked)} />
              </label>
            </div>
          </section>

          <section aria-labelledby="search-settings">
            <h2 id="search-settings">Поиск по настройкам</h2>
            <div className="center-form">
              <p className="center-hint">Категории: {categories.join(" · ") || "загрузка"}</p>
              <input
                value={settingsQuery}
                onChange={(event) => setSettingsQuery(event.target.value)}
                placeholder="Например, модель или голос"
                aria-label="Поиск по настройкам"
              />
              <ul className="center-list">
                {settingsIndex.map((item) => (
                  <li key={item.key}>
                    <span className="center-item-title">{item.title}</span>
                    <span className="center-item-meta">{item.key} · {item.category}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section aria-labelledby="security-settings">
            <h2 id="security-settings">{translate(locale, "settings.security")}</h2>
            <div className="center-form">
              <label>
                Новый PIN
                <input value={lockPin} onChange={(event) => setLockPin(event.target.value)} placeholder="4 цифры" inputMode="numeric" maxLength={4} />
              </label>
              <button type="button" className="center-primary" onClick={saveLockPin} disabled={lockPin.length < 4}>
                Установить PIN
              </button>
              <label>
                Проверка PIN
                <input value={lockVerify} onChange={(event) => setLockVerify(event.target.value)} placeholder="4 цифры" inputMode="numeric" maxLength={4} />
              </label>
              <button type="button" className="center-primary" onClick={verifyLockPin} disabled={lockVerify.length < 4}>
                Проверить
              </button>
            </div>
          </section>

          <section aria-labelledby="data-settings">
            <h2 id="data-settings">{translate(locale, "settings.data")}</h2>
            <div className="center-actions">
              <button type="button" className="center-primary" onClick={exportSettings}>Экспорт</button>
              <button type="button" className="center-primary" onClick={importSettings} disabled={!importData}>
                Импорт
              </button>
            </div>
            {exportText && <textarea value={exportText} readOnly aria-label="Экспортированные настройки" rows={6} style={{ width: "100%" }} />}
            <textarea
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
              placeholder='Импорт: {"format":"amadeus-settings","settings":{}}'
              aria-label="Файл настроек"
              rows={6}
              style={{ width: "100%" }}
            />
            <button
              type="button"
              className="center-primary"
              disabled={!importText.trim()}
              onClick={() => void run(async () => {
                let data: { format?: string; version?: number; exported_at?: string; profile?: Record<string, unknown>; settings: Record<string, unknown> };
                try {
                  data = JSON.parse(importText);
                } catch {
                  setError("Не удалось прочитать JSON");
                  return;
                }
                const result = await settingsApi.import(data);
                setImportData(data);
                notify(`Импортировано настроек: ${result.applied}`);
              })}
            >
              Импортировать файл
            </button>
          </section>

          <section aria-labelledby="more-settings">
            <h2 id="more-settings">Память и безопасность</h2>
            <button type="button" onClick={() => {
              onClose();
              onOpenCenter();
            }}>
              Открыть центр управления
            </button>
          </section>
        </div>

        {toast && <div className="center-toast" role="status" aria-live="polite">{toast}</div>}
      </div>
    </div>
  );
}
