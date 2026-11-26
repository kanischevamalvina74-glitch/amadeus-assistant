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
