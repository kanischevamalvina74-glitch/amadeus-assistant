import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import type { HudState } from "./primitives";
import { CoreMark } from "./CoreMark";
import { ParticleSphere } from "./ParticleSphere";
import { loadMiniPrefs, type AvatarMode } from "../lib/preferences";
import { useLocale } from "../lib/i18n";
import { useWakeWord } from "../hooks/useWakeWord";
import { useWakeSocket } from "../hooks/useWakeSocket";
import type { VoiceSocket, VoiceSocketEvent } from "../hooks/useVoiceSocket";
import { playCue } from "../lib/sound";
import { shell } from "../lib/api";
import "./mini.css";

type Props = {
  onRestore: () => void;
  onVoiceCommand: (userText: string) => Promise<string>;
  conversationId?: string | null;
  avatar: AvatarMode;
  autoWake?: boolean;
  voice: VoiceSocket;
  voiceHandler: MutableRefObject<(event: VoiceSocketEvent) => void>;
};

const MIC_LABEL: Record<string, string> = {
  requesting: "включаю микрофон",
  listening: "жду «Amadeus»",
  denied: "нет доступа к микрофону",
  unsupported: "микрофон недоступен",
  error: "микрофон не отвечает",
};

export function MiniOverlay({ onRestore, onVoiceCommand, conversationId, avatar, autoWake = false, voice, voiceHandler }: Props) {
  const { t: tr } = useLocale();
  const [state, setState] = useState<HudState>("idle");
  const [caption, setCaption] = useState(tr("mini.wake"));
  // Настройки окошка читаем при каждом открытии: меняют их в Мастерской.
  const [showCaption] = useState(() => loadMiniPrefs().showCaption);
  const [level, setLevel] = useState(0);
  const [hintVisible, setHintVisible] = useState(true);
  const [subtitles, setSubtitles] = useState<Array<{ speaker: "Вы" | "Amadeus"; text: string }>>([]);
  const [liveAnswer, setLiveAnswer] = useState("");
  const answerRef = useRef("");
  const timers = useRef<number[]>([]);

  const pushSubtitle = (speaker: "Вы" | "Amadeus", text: string) => {
    if (!text.trim()) return;
    setSubtitles((prev) => [...prev, { speaker, text }].slice(-2));
  };

  const clearTimers = () => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
  };

  useEffect(() => () => clearTimers(), []);

  useEffect(() => {
    const id = window.setTimeout(() => setHintVisible(false), 9000);
    return () => window.clearTimeout(id);
  }, []);

  const handleVoiceEvent = (event: VoiceSocketEvent) => {
    if (event.event === "transcript" && event.text) {
      setState("thinking");
      setCaption(`«${event.text}»`);
      answerRef.current = "";
      setLiveAnswer("");
      pushSubtitle("Вы", event.text);
    }
    if (event.event === "token" && event.text) {
      setState("speaking");
      setCaption(event.text);
      answerRef.current += event.text;
      setLiveAnswer(answerRef.current);
    }
    if (event.event === "audio") {
      pushSubtitle("Amadeus", answerRef.current);
      answerRef.current = "";
      setLiveAnswer("");
      playCue("answer");
    }
    if (event.event === "barge_in") setState("listening");
    if (event.event === "level" && typeof event.level === "number") {
      // Глобальное событие отправляет общий сокет в App.
      setLevel(event.level);
    }
    if (event.event === "screenshot") {
      setState("speaking");
      setCaption("Снимок экрана готов");
      if (event.content_base64) {
        const link = document.createElement("a");
        link.href = `data:image/png;base64,${event.content_base64}`;
        link.download = `amadeus-${Date.now()}.png`;
        link.click();
      }
    }
    if (event.event === "canceled") {
      setState("idle");
      setCaption("Отменено — скажите «Amadeus» снова");
    }
    if (event.event === "error") {
      setState("error");
      setCaption(event.message ?? "Ошибка голосовой сессии");
      playCue("error");
    }
  };
  voiceHandler.current = handleVoiceEvent;
  // Обработчик ставится и снимается эффектом, чтобы StrictMode и размонтирование
  // не оставляли в App ссылку на закрытое окошко.
  useEffect(() => {
    voiceHandler.current = handleVoiceEvent;
    return () => {
      voiceHandler.current = () => undefined;
    };
  });
  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  const handleWake = useCallback(() => {
    clearTimers();
    setHintVisible(false);
    setState("listening");
    setCaption(tr("mini.listening"));
    playCue("wake");
    void voiceRef.current.start(conversationId ?? undefined);
  }, [conversationId]);

  const handleCommand = useCallback(
    (text: string) => {
      clearTimers();
      setState("thinking");
      setCaption(`«${text}»`);
      pushSubtitle("Вы", text);
      if (voiceRef.current.active) {
        voiceRef.current.sendText(text);
        return;
      }
      void (async () => {
        try {
          const reply = await onVoiceCommand(text);
          setState("speaking");
          setCaption(reply);
          pushSubtitle("Amadeus", reply);
          playCue("answer");
        } catch (error) {
          setState("error");
          setCaption(error instanceof Error ? error.message : "Не смог ответить");
        } finally {
          timers.current.push(
            window.setTimeout(() => {
              setState("idle");
              setCaption(tr("mini.ready"));
            }, 6000),
          );
        }
      })();
    },
    [onVoiceCommand],
  );

  const handleCancel = useCallback(() => {
    voiceRef.current.stop();
    setState("idle");
    setCaption("Не расслышал — скажите «Amadeus» снова");
  }, []);

  // Локальное кодовое слово: ядро слушает PCM и ищет «Amadeus» своей моделью.
  const localWake = useWakeSocket({ onWake: handleWake, onHeard: handleCommand });

  const { wakeActive, micStatus, wake } = useWakeWord({
    enabled: !localWake.active,
    onWake: handleWake,
    onCommand: handleCommand,
    onCancel: handleCancel,
  });

  useEffect(() => {
    if (autoWake) {
      const id = window.setTimeout(() => wake(), 300);
      return () => window.clearTimeout(id);
    }
  }, [autoWake, wake]);

  // Push-to-talk: держим пробел — говорим; отпускаем — ядро договорит и ответит.
  useEffect(() => {
    let stopTimer: number | undefined;
    const isTyping = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      return Boolean(target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable));
    };
    const down = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat || isTyping(event)) return;
      event.preventDefault();
      window.clearTimeout(stopTimer);
      setState("listening");
      setCaption(tr("mini.ptt"));
      void voiceRef.current.start(conversationId ?? undefined);
    };
    const up = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      event.preventDefault();
      stopTimer = window.setTimeout(() => {
        voiceRef.current.stop();
        setState("idle");
        setCaption(tr("mini.ready"));
      }, 1500);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.clearTimeout(stopTimer);
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [conversationId]);

  const micText = useMemo(() => MIC_LABEL[micStatus] ?? MIC_LABEL.listening, [micStatus]);

  // В оболочке Tauri окошко маленькое и прозрачное: субтитры и подсказки
  // в него не помещаются, они остаются только в браузерной версии.
  const inShell = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  const statusText = tr(`mini.status.${state}`);

  return (
    <div className="mini-stage" aria-label="Свёрнутый режим Amadeus">
      {/* Tauri 2 тащит окно только за элемент с data-tauri-drag-region, а не за его детей,
          поэтому атрибут стоит на фоне, полосе и подписях, но не на кнопках и аватаре. */}
      <section className={`mini-card mini-card--${state}`} data-tauri-drag-region>
        <div className="mini-card__bar" data-tauri-drag-region>
          {inShell && (
            // На панель задач можно убрать только окно приложения; в браузере кнопки нет.
            <button
              type="button"
              className="mini-card__btn"
              title={tr("mini.minimize")}
              aria-label={tr("mini.minimize")}
              onClick={() => void shell.minimizeMini()}
            >
              <span aria-hidden="true">—</span>
            </button>
          )}
          <button
            type="button"
            className="mini-card__btn"
            title={tr("mini.expand")}
            aria-label={tr("mini.expand")}
            onClick={onRestore}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>

        <button
          type="button"
          className="mini-card__avatar"
          onClick={onRestore}
          aria-label={`Amadeus: ${statusText}. Открыть окно`}
          data-wake={wakeActive}
        >
          {avatar === "sphere" ? (
            <ParticleSphere state={state} level={level} size={184} />
          ) : (
            <CoreMark state={state} level={level} size={150} />
          )}
        </button>

        <div className={`mini-card__status mini-card__status--${state}`} data-tauri-drag-region>
          <span className="mini-card__dot" aria-hidden="true" />
          <span data-tauri-drag-region>{statusText}</span>
        </div>
        {showCaption && (
          <p className="mini-card__caption" role="status" aria-label="Подпись состояния" data-tauri-drag-region>
            {caption}
          </p>
        )}
        <span className="mini-card__hair" aria-hidden="true" />
      </section>

      {!inShell && (subtitles.length > 0 || liveAnswer) && (
        <div className="mini-subtitles" aria-live="polite" aria-label="Субтитры голосового режима">
          {subtitles.map((line, index) => (
            <div className="mini-subtitle" key={`${line.speaker}-${index}`}>
              <b>{line.speaker}:</b> {line.text}
            </div>
          ))}
          {liveAnswer && (
            <div className="mini-subtitle mini-subtitle--live">
              <b>Amadeus:</b> {liveAnswer}
            </div>
          )}
        </div>
      )}

      {!inShell && hintVisible && (
        <div className="mini-hint">
          <span className="mini-hint__key">Space</span> — говорить, не отпуская · <span className="mini-hint__key">W</span> — показать сценарий без микрофона
        </div>
      )}

      <div className="mini-mic" aria-live="polite">
        <span className={`mini-mic__dot mini-mic__dot--${micStatus}`} aria-hidden="true" />
        {localWake.active ? "локальное кодовое слово · " : ""}{micText}
      </div>
    </div>
  );
}
