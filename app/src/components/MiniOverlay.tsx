import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MiniCore, type HudState } from "./primitives";
import { CharacterAvatar } from "./CharacterAvatar";
import type { AvatarMode } from "../lib/preferences";
import { useLocale } from "../lib/i18n";
import { useWakeWord } from "../hooks/useWakeWord";
import { useWakeSocket } from "../hooks/useWakeSocket";
import { useVoiceSocket } from "../hooks/useVoiceSocket";
import { playCue } from "../lib/sound";
import "./mini.css";

type Props = {
  onRestore: () => void;
  onVoiceCommand: (userText: string) => Promise<string>;
  conversationId?: string | null;
  avatar: AvatarMode;
  autoWake?: boolean;
};

const MIC_LABEL: Record<string, string> = {
  requesting: "включаю микрофон",
  listening: "жду «Amadeus»",
  denied: "нет доступа к микрофону",
  unsupported: "микрофон недоступен",
  error: "микрофон не отвечает",
};

export function MiniOverlay({ onRestore, onVoiceCommand, conversationId, avatar, autoWake = false }: Props) {
  const { t: tr } = useLocale();
  const [state, setState] = useState<HudState>("idle");
  const [caption, setCaption] = useState(tr("mini.wake"));
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

  const voice = useVoiceSocket((event) => {
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
      setLevel(event.level);
      window.dispatchEvent(new CustomEvent("amadeus.voice.level", { detail: event.level }));
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
  });
  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  useEffect(() => () => voice.stop(), [voice.stop]);

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

  return (
    <div className="mini-stage" aria-label="Свёрнутый режим Amadeus">
      <div className={`mini-caption ${state === "idle" ? "" : "mini-caption--active"}`}>
        <span className={`mini-caption__dot mini-caption__dot--${state}`} aria-hidden="true" />
        <span className="mini-caption__text" role="status" aria-label="Подпись состояния">
          {caption}
        </span>
      </div>

      {(subtitles.length > 0 || liveAnswer) && (
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

      {hintVisible && (
        <div className="mini-hint">
          <span className="mini-hint__key">Space</span> — говорить, не отпуская · <span className="mini-hint__key">W</span> — показать сценарий без микрофона
        </div>
      )}

      <div className="mini-orb">
        {avatar === "character" ? (
          <CharacterAvatar
            state={state}
            size={72}
            wake={wakeActive}
            dim={state === "idle" && !wakeActive && !hintVisible}
            tipAlign="right"
            onClick={onRestore}
            aria-label={`Amadeus: ${state}. Открыть окно`}
          />
        ) : (
          <MiniCore
            state={state}
            size={64}
            wake={wakeActive}
            level={level}
            dim={state === "idle" && !wakeActive && !hintVisible}
            tipAlign="right"
            onClick={onRestore}
            aria-label={`Amadeus: ${state}. Открыть окно`}
          />
        )}
      </div>

      <div className="mini-mic" aria-live="polite">
        <span className={`mini-mic__dot mini-mic__dot--${micStatus}`} aria-hidden="true" />
        {localWake.active ? "локальное кодовое слово · " : ""}{micText}
      </div>
    </div>
  );
}
