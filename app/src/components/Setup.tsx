import { useState } from "react";
import { api, prefs } from "../lib/api";
import "./control.css";
import "./setup.css";

type Props = {
  initialLocale: string;
  onComplete: () => void;
};

type Mode = "local" | "cloud" | "live";

const MODE_TEXT: Record<Mode, { title: string; detail: string }> = {
  local: {
    title: "Локальный пайплайн",
    detail: "Whisper, Ollama и Piper на этом компьютере. Интернет не нужен.",
  },
  cloud: {
    title: "Облачный адаптер",
    detail: "Свой ключ провайдера. Быстрее на слабом компьютере, нужен интернет.",
  },
  live: {
    title: "Realtime-адаптер",
    detail: "Минимальная задержка. Требует ключ и устойчивое соединение.",
  },
};

export function Setup({ initialLocale, onComplete }: Props) {
  const [locale, setLocale] = useState<"ru" | "en">(initialLocale === "en" ? "en" : "ru");
  const [mode, setMode] = useState<Mode>("local");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const finish = async () => {
    setBusy(true);
    setError("");
    try {
      await api.setupComplete(locale, mode);
      if (secret.trim()) await prefs.setCredential("custom", secret.trim());
      onComplete();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось завершить настройку");
      setBusy(false);
    }
  };

  return (
    <div className="center-overlay" role="dialog" aria-modal="true" aria-label="Первый запуск">
      <div className="center">
        <div className="center-head">
          <div>
            <h1>Добро пожаловать в Амадеуса</h1>
            <p>Несколько шагов — и ассистент готов работать на вашем компьютере.</p>
          </div>
        </div>

        <div className="center-body" role="tabpanel" tabIndex={0}>
          {error && <p className="center-error" role="alert">{error}</p>}

          <section aria-labelledby="setup-language">
            <h2 id="setup-language">1. Язык интерфейса</h2>
            <div className="center-tabs" role="radiogroup" aria-label="Язык интерфейса">
              <button
                type="button"
                role="radio"
                aria-checked={locale === "ru"}
                className={locale === "ru" ? "is-active" : ""}
                onClick={() => setLocale("ru")}
              >
                Русский
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={locale === "en"}
                className={locale === "en" ? "is-active" : ""}
                onClick={() => setLocale("en")}
              >
                English
              </button>
            </div>
          </section>

          <section aria-labelledby="setup-mode">
            <h2 id="setup-mode">2. Режим работы</h2>
            <div className="setup-modes" role="radiogroup" aria-label="Режим работы">
              {(Object.keys(MODE_TEXT) as Mode[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={mode === value}
                  className={mode === value ? "setup-mode is-selected" : "setup-mode"}
                  onClick={() => setMode(value)}
                >
                  <strong>{MODE_TEXT[value].title}</strong>
                  <span>{MODE_TEXT[value].detail}</span>
                </button>
              ))}
            </div>
          </section>

          <section aria-labelledby="setup-key">
            <h2 id="setup-key">3. Свой ключ — необязательно</h2>
            <p className="center-hint">
              Для локального режима ключ не нужен. Если он есть, он попадёт в системное хранилище ключей, а не в базу данных.
            </p>
            <label className="setup-field">
              Ключ провайдера
              <input
                type="password"
                value={secret}
                onChange={(event) => setSecret(event.target.value)}
                placeholder="Оставьте пустым для локального режима"
                autoComplete="off"
              />
            </label>
          </section>

          <button type="button" className="center-primary setup-start" onClick={() => void finish()} disabled={busy}>
            {busy ? "Настраиваю…" : "Начать работу"}
          </button>
        </div>
      </div>
    </div>
  );
}
