import { useCallback, useRef, useState } from "react";
import { wsUrl } from "../lib/api";

export type VoiceSocketEvent = {
  event: string;
  text?: string;
  wav_base64?: string;
  content_base64?: string;
  message?: string;
};

export type VoiceSocket = {
  active: boolean;
  start: (conversationId?: string) => Promise<boolean>;
  stop: () => void;
  sendText: (text: string) => void;
};

/** Браузерный клиент WS /ws/voice: PCM16 16 кГц на входе, события VAD/STT/TTS на выходе. */
export function useVoiceSocket(onEvent: (event: VoiceSocketEvent) => void): VoiceSocket {
  const [active, setActive] = useState(false);
  const socket = useRef<WebSocket | null>(null);
  const media = useRef<MediaStream | null>(null);
  const context = useRef<AudioContext | null>(null);
  const processor = useRef<ScriptProcessorNode | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const handler = useRef(onEvent);
  handler.current = onEvent;

  const stop = useCallback(() => {
    processor.current?.disconnect();
    processor.current = null;
    media.current?.getTracks().forEach((track) => track.stop());
    media.current = null;
    void context.current?.close().catch(() => undefined);
    context.current = null;
    socket.current?.close();
    socket.current = null;
    audio.current?.pause();
    audio.current = null;
    setActive(false);
  }, []);

  const start = useCallback(
    async (conversationId?: string): Promise<boolean> => {
      if (socket.current) return true;
      if (!navigator.mediaDevices?.getUserMedia) return false;

      const query = conversationId ? `?conversation_id=${encodeURIComponent(conversationId)}` : "";
      const ws = new WebSocket(wsUrl(`/ws/voice${query}`));
      ws.binaryType = "arraybuffer";
      ws.onmessage = (message) => {
        if (typeof message.data !== "string") return;
        try {
          const event = JSON.parse(message.data) as VoiceSocketEvent;
          handler.current(event);
          if (event.event === "barge_in") {
            audio.current?.pause();
            audio.current = null;
          }
          if (event.event === "audio" && event.wav_base64) {
            audio.current = new Audio(`data:audio/wav;base64,${event.wav_base64}`);
            void audio.current.play().catch(() => undefined);
          }
        } catch {
          // некорректный кадр игнорируем
        }
      };
      ws.onclose = () => setActive(false);
      socket.current = ws;

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
        sink.gain.value = 0;  // без обратной связи с динамиком
        source.connect(node);
        node.connect(sink);
        sink.connect(ctx.destination);
        setActive(true);
        return true;
      } catch {
        stop();
        return false;
      }
    },
    [stop],
  );

  const sendText = useCallback((text: string) => {
    if (socket.current?.readyState === WebSocket.OPEN) {
      socket.current.send(JSON.stringify({ type: "text", text }));
    }
  }, []);

  return { active, start, stop, sendText };
}
