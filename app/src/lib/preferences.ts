export type AvatarMode = "core" | "character";

const AVATAR_KEY = "amadeus.avatar";

export function loadAvatar(): AvatarMode {
  try {
    return localStorage.getItem(AVATAR_KEY) === "character" ? "character" : "core";
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
