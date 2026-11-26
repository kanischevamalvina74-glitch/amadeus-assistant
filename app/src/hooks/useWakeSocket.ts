import { useCallback, useEffect, useRef, useState } from "react";
import { wsUrl } from "../lib/api";

type WakeEvent = {
  event: string;
  text?: string;
  message?: string;
};

type Options = {
  onWake: () => void;
  onHeard: (text: string) => void;
};

/**
 * Локальный keyword spotter: браузер шлёт PCM16 16 кГц на /ws/wake,
 * ядро распознаёт «Амадеус» через общую модель Whisper и отдаёт событие wake.
 * При недоступности ядра или микрофона остаётся браузерный SpeechRecognition.
 */
export function useWakeSocket({ onWake, onHeard }: Options) {
  const [active, setActive] = useState(false);
  const socket = useRef<WebSocket | null>(null);
  const media = useRef<MediaStream | null>(null);
  const context = useRef<AudioContext | null>(null);
  const processor = useRef<ScriptProcessorNode | null>(null);
  // Номер запуска: stop() его меняет, и запоздавший getUserMedia понимает, что его отменили.
  const generation = useRef(0);
  const callbacks = useRef({ onWake, onHeard });
  callbacks.current = { onWake, onHeard };

  const stop = useCallback(() => {
    generation.current += 1;
    processor.current?.disconnect();
    processor.current = null;
    media.current?.getTracks().forEach((track) => track.stop());
    media.current = null;
    void context.current?.close().catch(() => undefined);
    context.current = null;
    socket.current?.close();
    socket.current = null;
    setActive(false);
  }, []);

  const start = useCallback(async (): Promise<boolean> => {
    if (socket.current || !navigator.mediaDevices?.getUserMedia) return false;
    const ws = new WebSocket(wsUrl("/ws/wake"));
    ws.binaryType = "arraybuffer";
    ws.onmessage = (message) => {
      if (typeof message.data !== "string") return;
      try {
        const event = JSON.parse(message.data) as WakeEvent;
        if (event.event === "wake") callbacks.current.onWake();
        if (event.event === "heard" && event.text) callbacks.current.onHeard(event.text);
      } catch {
        // некорректный кадр игнорируем
      }
    };
    ws.onclose = () => setActive(false);
    socket.current = ws;
    const run = generation.current;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (run !== generation.current) {
        // Пока ждали разрешения, сессию остановили: микрофон сразу гасим.
        stream.getTracks().forEach((track) => track.stop());
        ws.close();
        return false;
      }
      media.current = stream;
      const ctx = new AudioContext({ sampleRate: 16_000 });
      context.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const node = ctx.createScriptProcessor(512, 1, 1);
      processor.current = node;
      node.onaudioprocess = (samples) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        const input = samples.inputBuffer.getChannelData(0);
        const pcm = new Int16Array(input.length);
        for (let i = 0; i < input.length; i += 1) {
          const value = Math.max(-1, Math.min(1, input[i]));
          pcm[i] = value < 0 ? value * 0x8000 : value * 0x7fff;
        }
        ws.send(pcm.buffer);
      };
      const sink = ctx.createGain();
      sink.gain.value = 0; // без обратной связи с динамиком
      source.connect(node);
      node.connect(sink);
      sink.connect(ctx.destination);
      setActive(true);
      return true;
    } catch {
      if (run === generation.current) stop();
      else ws.close();
      return false;
    }
  }, [stop]);

  useEffect(() => {
    void start();
    return () => stop();
  }, [start, stop]);

  return { active };
}
