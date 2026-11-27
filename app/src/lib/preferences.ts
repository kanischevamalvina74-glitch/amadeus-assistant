/** «core» — живой логотип (ядро и орбиты), «sphere» — сфера из точек. */
export type AvatarMode = "core" | "sphere";

const AVATAR_KEY = "amadeus.avatar";
const START_SPHERE_KEY = "amadeus.startSphere";

export function loadAvatar(): AvatarMode {
  try {
    // Старое значение «character» (персонаж убран) превращается в «core».
    return localStorage.getItem(AVATAR_KEY) === "sphere" ? "sphere" : "core";
  } catch {
    return "core";
  }
}

export function saveAvatar(mode: AvatarMode) {
  try {
    localStorage.setItem(AVATAR_KEY, mode);
  } catch {
    /* приватный режим — просто не сохраняем */
  }
}

/** Запускать рабочее окно сразу в режиме «Сфера». По умолчанию выключено. */
export function loadStartSphere(): boolean {
  try {
    return localStorage.getItem(START_SPHERE_KEY) === "on";
  } catch {
    return false;
  }
}

export function saveStartSphere(value: boolean) {
  try {
    localStorage.setItem(START_SPHERE_KEY, value ? "on" : "off");
  } catch {
    /* приватный режим — просто не сохраняем */
  }
}

/** Настройки свёрнутого окошка. */
export type MiniPrefs = {
  /** Окошко поверх всех окон (в оболочке Tauri). */
  onTop: boolean;
  /** Показывать последнюю фразу под статусом. */
  showCaption: boolean;
};

const MINI_PREFS_KEY = "amadeus.mini";
const MINI_DEFAULTS: MiniPrefs = { onTop: true, showCaption: true };

export function loadMiniPrefs(): MiniPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(MINI_PREFS_KEY) ?? "{}") as Partial<MiniPrefs>;
    return {
      onTop: typeof raw.onTop === "boolean" ? raw.onTop : MINI_DEFAULTS.onTop,
      showCaption: typeof raw.showCaption === "boolean" ? raw.showCaption : MINI_DEFAULTS.showCaption,
    };
  } catch {
    return { ...MINI_DEFAULTS };
  }
}

export function saveMiniPrefs(prefs: MiniPrefs) {
  try {
    localStorage.setItem(MINI_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* приватный режим — просто не сохраняем */
  }
}
