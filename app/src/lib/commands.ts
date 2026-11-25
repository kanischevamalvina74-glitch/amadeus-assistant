export type CommandAction =
  | { id: string; type: "open_url"; value: string }
  | { id: string; type: "say"; value: string };

export type Command = {
  id: string;
  name: string;
  phrase: string;
  hotkey: string;
  enabled: boolean;
  actions: CommandAction[];
};

const STORAGE_KEY = "amadeus.commands.v1";

export const newCommandId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `cmd-${Date.now()}-${Math.round(Math.random() * 1e6)}`;

export const emptyCommand = (): Command => ({
  id: newCommandId(),
  name: "",
  phrase: "",
  hotkey: "",
  enabled: true,
  actions: [{ id: newCommandId(), type: "say", value: "" }],
});

const DEFAULT_COMMANDS: Command[] = [
  {
    id: "demo-time",
    name: "Который час",
    phrase: "который час",
    hotkey: "",
    enabled: true,
    actions: [{ id: "a1", type: "say", value: "Сейчас {time}." }],
  },
  {
    id: "demo-focus",
    name: "Рабочий режим",
    phrase: "рабочий режим",
    hotkey: "Ctrl+Alt+1",
    enabled: true,
    actions: [{ id: "a2", type: "say", value: "Рабочий режим включён. Открываю почту и календарь — уже в настольной версии." }],
  },
];

export function loadCommands(): Command[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_COMMANDS;
    const parsed = JSON.parse(raw) as Command[];
    if (!Array.isArray(parsed)) return DEFAULT_COMMANDS;
    return parsed.filter(
      (command) =>
        command &&
        typeof command.id === "string" &&
        typeof command.name === "string" &&
        typeof command.phrase === "string" &&
        Array.isArray(command.actions),
    );
  } catch {
    return DEFAULT_COMMANDS;
  }
}

export function saveCommands(commands: Command[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(commands));
}

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[.,!?;:«»"'()—–-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchCommand(commands: Command[], text: string): Command | undefined {
  const normalized = normalize(text);
  return commands.find(
    (command) => command.enabled && command.phrase && normalized.includes(normalize(command.phrase)),
  );
}

export function matchHotkey(hotkey: string, event: KeyboardEvent): boolean {
  if (!hotkey.trim()) return false;
  const parts = hotkey
    .split("+")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  const key = parts.pop();
  if (!key) return false;
  const wantsCtrl = parts.includes("ctrl");
  const wantsAlt = parts.includes("alt");
  const wantsShift = parts.includes("shift");
  const wantsMeta = parts.includes("meta");
  if (event.ctrlKey !== wantsCtrl) return false;
  if (event.altKey !== wantsAlt) return false;
  if (event.shiftKey !== wantsShift) return false;
  if (event.metaKey !== wantsMeta) return false;
  return event.key.toLowerCase() === key;
}

export function renderSay(value: string): string {
  return value.replace(/\{time\}/g, () =>
    new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }),
  );
}

export type CommandResult = { reply: string; opened: string[] };

export function executeCommand(
  command: Command,
  options: { allowOpen?: boolean } = {},
): CommandResult {
  const allowOpen = options.allowOpen ?? true;
  const replies: string[] = [];
  const opened: string[] = [];
  command.actions.forEach((action) => {
    if (action.type === "say" && action.value.trim()) {
      replies.push(renderSay(action.value.trim()));
    }
    if (action.type === "open_url" && action.value.trim()) {
      const url = /^https?:\/\//i.test(action.value) ? action.value : `https://${action.value}`;
      if (!allowOpen) {
        replies.push(`Открою ${url} в десктопной версии.`);
        return;
      }
      try {
        window.open(url, "_blank", "noopener,noreferrer");
        opened.push(url);
      } catch {
        replies.push(`Не удалось открыть ${url}.`);
      }
    }
  });
  if (replies.length === 0 && opened.length > 0) replies.push("Открыл, что просили.");
  if (replies.length === 0) replies.push("Команда выполнена.");
  return { reply: replies.join("\n"), opened };
}
