/** Короткая звуковая подпись событий — без аудиофайлов и внешних сервисов. */

const SOUND_KEY = "amadeus.sound";

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

const NOTES: Record<SoundCue, number[]> = {
  wake: [660, 880],
  listen: [540],
  answer: [740, 990],
  error: [220],
};

/** Не блокирует интерфейс: если аудиоконтекст недоступен, звук просто не звучит. */
export function playCue(cue: SoundCue) {
  if (!soundEnabled()) return;
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const context = new Ctx();
    const now = context.currentTime;
    NOTES[cue].forEach((frequency, index) => {
      const at = now + index * 0.08;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = cue === "error" ? "triangle" : "sine";
      oscillator.frequency.setValueAtTime(frequency, at);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.06, at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(at);
      oscillator.stop(at + 0.18);
    });
    window.setTimeout(() => void context.close().catch(() => undefined), 500);
  } catch {
    // звук — декорация, его отсутствие не должно ломать сценарий
  }
}
