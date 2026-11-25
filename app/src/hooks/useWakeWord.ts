import { useCallback, useEffect, useRef, useState } from "react";

const WAKE_RE = /(?:эй[,\s]+)?амадеус/i;
const WAKE_TIMEOUT_MS = 7000;

export type MicStatus = "requesting" | "listening" | "denied" | "unsupported" | "error";

type SpeechResult = {
  isFinal: boolean;
  0: { transcript: string };
};

type SpeechEvent = {
  resultIndex: number;
  results: ArrayLike<SpeechResult>;
};

type Recognizer = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onresult: ((event: SpeechEvent) => void) | null;
  start: () => void;
  stop: () => void;
};

type RecognizerCtor = new () => Recognizer;

type Options = {
  enabled: boolean;
  onWake: () => void;
  onCommand: (text: string) => void;
  onCancel: () => void;
};

/**
 * Активация кодовым словом «Амадеус» для свёрнутого режима.
 * В браузере используется SpeechRecognition как заглушка; в продукте —
 * локальный keyword spotter, без облака.
 */
export function useWakeWord({ enabled, onWake, onCommand, onCancel }: Options) {
  const [wakeActive, setWakeActive] = useState(false);
  const [micStatus, setMicStatus] = useState<MicStatus>("requesting");
  const [heard, setHeard] = useState("");

  const wakeRef = useRef(false);
  const timerRef = useRef<number | undefined>(undefined);
  const callbacks = useRef({ onWake, onCommand, onCancel });
  callbacks.current = { onWake, onCommand, onCancel };

  const setWake = useCallback((next: boolean) => {
    wakeRef.current = next;
    setWakeActive(next);
    window.clearTimeout(timerRef.current);
    if (next) {
      timerRef.current = window.setTimeout(() => {
        if (!wakeRef.current) return;
        wakeRef.current = false;
        setWakeActive(false);
        callbacks.current.onCancel();
      }, WAKE_TIMEOUT_MS);
    }
  }, []);

  const wake = useCallback(() => {
    if (wakeRef.current) return;
    setWake(true);
    callbacks.current.onWake();
  }, [setWake]);

  const cancel = useCallback(() => {
    if (!wakeRef.current) return;
    setWake(false);
    callbacks.current.onCancel();
  }, [setWake]);

  const command = useCallback(
    (text: string) => {
      if (!wakeRef.current) return;
      setWake(false);
      setHeard(text);
      callbacks.current.onCommand(text);
    },
    [setWake],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      const key = event.key.toLowerCase();
      if (key === "w") {
        event.preventDefault();
        if (!wakeRef.current) wake();
        else command("открой отчёт по проекту");
      }
      if (key === "f4") {
        event.preventDefault();
        if (wakeRef.current) cancel();
        else wake();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [wake, command, cancel]);

  useEffect(() => {
    if (!enabled) {
      setWake(false);
      return;
    }

    const Ctor = (
      window as unknown as {
        SpeechRecognition?: RecognizerCtor;
        webkitSpeechRecognition?: RecognizerCtor;
      }
    ).webkitSpeechRecognition ??
      (window as unknown as { SpeechRecognition?: RecognizerCtor }).SpeechRecognition;

    if (!Ctor) {
      setMicStatus("unsupported");
      return;
    }

    let stopped = false;
    let wanted = true;
    let recognizer: Recognizer | null = null;

    const handle = (text: string, isFinal: boolean) => {
      if (!text) return;
      if (!wakeRef.current && WAKE_RE.test(text)) {
        const rest = text.replace(WAKE_RE, "").replace(/^[\s,.:;!—–-]+/, "").trim();
        wake();
        if (isFinal && rest.length > 1) command(rest);
        return;
      }
      if (wakeRef.current && isFinal) {
        const clean = text.replace(WAKE_RE, "").replace(/^[\s,.:;!—–-]+/, "").trim();
        if (clean.length > 1) command(clean);
      }
    };

    const start = () => {
      if (stopped) return;
      try {
        recognizer = new Ctor();
        recognizer.lang = "ru-RU";
        recognizer.continuous = true;
        recognizer.interimResults = true;
        recognizer.onstart = () => setMicStatus("listening");
        recognizer.onerror = (event) => {
          if (event.error === "not-allowed" || event.error === "service-not-allowed") {
            wanted = false;
            setMicStatus("denied");
          } else if (event.error === "audio-capture") {
            wanted = false;
            setMicStatus("error");
          }
        };
        recognizer.onend = () => {
          if (!wanted || stopped) return;
          window.setTimeout(() => {
            try {
              recognizer?.start();
            } catch {
              /* уже слушает */
            }
          }, 600);
        };
        recognizer.onresult = (event) => {
          let finalText = "";
          let interimText = "";
          for (let i = event.resultIndex; i < event.results.length; i += 1) {
            const result = event.results[i];
            if (result.isFinal) finalText += result[0].transcript;
            else interimText += result[0].transcript;
          }
          if (interimText.trim()) handle(interimText.trim(), false);
          if (finalText.trim()) handle(finalText.trim(), true);
        };
        setMicStatus("requesting");
        recognizer.start();
        window.setTimeout(() => {
          setMicStatus((current) => (current === "requesting" ? "error" : current));
        }, 6000);
      } catch {
        setMicStatus("error");
      }
    };

    start();

    return () => {
      stopped = true;
      wanted = false;
      window.clearTimeout(timerRef.current);
      try {
        recognizer?.stop();
      } catch {
        /* не запущен */
      }
      setWake(false);
    };
  }, [enabled, wake, command, setWake]);

  return { wakeActive, micStatus, heard, wake, cancel };
}
