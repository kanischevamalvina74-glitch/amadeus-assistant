/** Звуковая подпись «Дирижёра»: до мажор, челеста, короче 400 мс. */

const SOUND_KEY = "amadeus.sound";
const VOLUME_KEY = "amadeus.volume";

export type SoundCue = "wake" | "listen" | "answer" | "error";

export function soundEnabled(): boolean {
  try {
    return window.localStorage.getItem(SOUND_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSoundEnabled(value: boolean) {
  try {
    window.localStorage.setItem(SOUND_KEY, value ? "on" : "off");
  } catch {
    /* приватный режим браузера */
  }
}

export function soundVolume(): number {
  try {
    const raw = Number(window.localStorage.getItem(VOLUME_KEY));
    return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : 0.5;
  } catch {
    return 0.5;
  }
}

export function setSoundVolume(value: number) {
  try {
    window.localStorage.setItem(VOLUME_KEY, String(Math.max(0, Math.min(1, value))));
  } catch {
    /* приватный режим браузера */
  }
}

const NOTES: Record<SoundCue, number[]> = {
  wake: [523.25, 659.25],
  listen: [523.25],
  answer: [523.25, 659.25, 783.99],
  error: [311.13, 329.63],
};

/** Не блокирует интерфейс: если аудиоконтекст недоступен, звук просто не звучит. */
export function playCue(cue: SoundCue) {
  if (!soundEnabled()) return;
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const context = new Ctx();
    const now = context.currentTime;
    const gainBase = 0.11 * soundVolume();
    NOTES[cue].forEach((frequency, index) => {
      const at = now + index * 0.07;
      const voice = context.createOscillator();
      const shimmer = context.createOscillator();
      const gain = context.createGain();
      voice.type = cue === "error" ? "triangle" : "sine";
      shimmer.type = "sine";
      voice.frequency.setValueAtTime(frequency, at);
      shimmer.frequency.setValueAtTime(frequency * 2, at);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, gainBase), at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.19);
      voice.connect(gain);
      shimmer.connect(gain);
      gain.connect(context.destination);
      voice.start(at);
      shimmer.start(at);
      voice.stop(at + 0.2);
      shimmer.stop(at + 0.2);
    });
    window.setTimeout(() => void context.close().catch(() => undefined), 500);
  } catch {
    // звук — декорация, его отсутствие не должно ломать сценарий
  }
}
