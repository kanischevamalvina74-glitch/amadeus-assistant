import { useCallback, useEffect, useRef, useState } from "react";
import { HUDCore, MiniCore, MetricCard } from "./primitives";
import { RichText } from "./RichText";
import { conversations, type ChatMessage, type Conversation } from "../data/mock";
import type { HudState } from "./primitives";
import { OLLAMA_LABEL, OLLAMA_MODEL, type ModelState } from "../lib/ollama";
import type { AttachmentPayload } from "../lib/api";
import {
  api,
  control,
  shell,
  system,
  workspaceApi,
  type ActionItem,
} from "../lib/api";
import { useLocale } from "../lib/i18n";
import { loadStartSphere, saveStartSphere } from "../lib/preferences";

type Metrics = {
  cpu: number;
  memory: { percent: number; used_gb: number; total_gb: number };
  disk: { percent: number; free_gb: number };
  network: { down_bps: number; up_bps: number };
  temperature_c: number | null;
  gpu_percent: number | null;
  platform: string;
  sampled_at: number;
};

type Panel = "none" | "project" | "terminal";

type Props = {
  messages: ChatMessage[];
  state: HudState;
  theme: "dark" | "light";
  model: ModelState;
  backendOnline: boolean;
  threads?: Conversation[];
  onRefreshModel: () => void;
  onSend: (text: string, attachments?: AttachmentPayload[]) => void;
  onOpenWorkshop: () => void;
  onOpenCenter: () => void;
  onOpenSettings: () => void;
  onCapture: () => Promise<AttachmentPayload | null>;
  onCollapse: () => void;
  onTalk: () => void;
  onToggleTheme: () => void;
  onStop: () => void;
  onRegenerate: () => void;
  latencyMs?: number | null;
  tokensPerSecond?: number | null;
};



function Icon({ name }: { name: "core" | "history" | "folder" | "terminal" | "plugins" | "gear" | "center" }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const };
  switch (name) {
    case "core":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path d="M12 3l7 4v10l-7 4-7-4V7l7-4z" />
          <path d="M12 8v8M8.5 10l7 4M15.5 10l-7 4" />
        </svg>
      );
    case "history":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path d="M12 8v5l3 2" />
          <circle cx="12" cy="12" r="8" />
        </svg>
      );
    case "folder":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <path d="M3 7h6l2 2h10v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7z" />
        </svg>
      );
    case "terminal":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M7 9l3 3-3 3M13 15h4" />
        </svg>
      );
    case "plugins":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <rect x="4" y="4" width="7" height="7" rx="1" />
          <rect x="13" y="4" width="7" height="7" rx="1" />
          <rect x="4" y="13" width="7" height="7" rx="1" />
          <path d="M16.5 14v6M13.5 17h6" />
        </svg>
      );
    case "center":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M3 9h18M9 9v11" />
        </svg>
      );
    case "gear":
      return (
        <svg viewBox="0 0 24 24" {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
        </svg>
      );
  }
}

function Tools() {
  const items = [
    { name: "Календарь", tag: "чтение", tone: "" },
    { name: "Файлы проекта", tag: "чтение", tone: "" },
    { name: "Погода", tag: "сеть", tone: "" },
    { name: "Терминал", tag: "выкл", tone: "off" },
    { name: "Управление ПК", tag: "запрос", tone: "warn" },
  ];
  return (
    <div className="tools">
      {items.map((item) => (
        <div className="tool" key={item.name}>
          <span className={`led ${item.tone}`} />
          {item.name}
          <span className="tag">{item.tag}</span>
        </div>
      ))}
    </div>
  );
}

function Activity() {
  const rows = [
    ["17:42", "Сканирование проекта", "14 файлов"],
    ["17:41", "Проверка погоды", "Москва"],
    ["17:41", "Чтение календаря", "3 события"],
    ["17:38", "Распознавание речи", "2,4 с"],
    ["17:37", "Загрузка модели", "Nemotron"],
  ];
  return (
    <div className="log">
      {rows.map(([time, tool, detail]) => (
        <div className="row" key={tool}>
          <span className="t">{time}</span>
          <span className="x">
            <b>{tool}</b> · {detail}
          </span>
        </div>
      ))}
    </div>
  );
}

type FileEntry = { path: string; kind: string; size: number; text: boolean };
type SearchHit = { path: string; line: number; preview: string };

/** S22–S24: папка проекта, редактор файла и терминал в проекте. */
function ProjectPanel({ kind, onClose }: { kind: "project" | "terminal"; onClose: () => void }) {
  const [info, setInfo] = useState<{ root: string | null; allow_write: boolean }>({ root: null, allow_write: false });
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [selected, setSelected] = useState("");
  const [text, setText] = useState("");
  const [newPath, setNewPath] = useState("");
  const [command, setCommand] = useState("");
  const [output, setOutput] = useState("");
  const [search, setSearch] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<string[]>([]);

  const run = async (work: () => Promise<void>) => {
    setError("");
    setBusy(true);
    try {
      await work();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Ошибка проекта");
    } finally {
      setBusy(false);
    }
  };

  const loadTree = async () => {
    const [state, tree] = await Promise.all([workspaceApi.get(), workspaceApi.tree()]);
    setInfo({ root: state.root, allow_write: state.allow_write });
    setEntries(tree.entries);
  };

  useEffect(() => {
    void run(async () => {
      const state = await workspaceApi.get();
      setInfo({ root: state.root, allow_write: state.allow_write });
      if (state.root) await loadTree();
    });
  }, []);

  const openFile = (path: string) => {
    void run(async () => {
      const file = await workspaceApi.read(path);
      setSelected(path);
      setText(file.text);
    });
  };

  const saveFile = () => {
    if (!selected) return;
    void run(async () => {
      await workspaceApi.write(selected, text);
      await loadTree();
    });
  };

  const runCommand = () => {
    if (!command.trim()) return;
    void run(async () => {
      const result = await workspaceApi.run(command.trim(), 30) as { exit_code: number; output: string };
      setOutput(`${command}\n${result.output}\nКод: ${result.exit_code}`);
      setHistory((prev) => [command.trim(), ...prev].slice(0, 20));
    });
  };

  return (
    <div className="center-overlay" role="dialog" aria-modal="true" aria-label={kind === "project" ? "Проект" : "Терминал"}>
      <div className="center" style={{ maxWidth: 960 }}>
        <div className="center-head">
          <div>
            <h1>{kind === "project" ? "Проект" : "Терминал проекта"}</h1>
            <p>{info.root ?? "Папка проекта не выбрана. Укажите её в настройках."}</p>
          </div>
          <button type="button" className="center-close" onClick={onClose} aria-label="Закрыть">×</button>
        </div>
        <div className="center-body">
          {error && <p className="center-error" role="alert">{error}</p>}
          {!info.root ? (
            <div className="center-form">
              <label>
                Папка проекта
                <input id="project-root" placeholder="/путь/к/проекту" />
              </label>
              <button type="button" className="center-primary" onClick={() => {
                const input = document.getElementById("project-root") as HTMLInputElement | null;
                if (input?.value.trim()) void run(async () => {
                  const state = await workspaceApi.set(input.value.trim(), false) as { root: string | null; allow_write: boolean };
                  setInfo({ root: state.root, allow_write: state.allow_write });
                  await loadTree();
                });
              }}>Выбрать</button>
            </div>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 12 }}>
                <div>
                  <label className="center-inline">
                    Изменения разрешены
                    <input type="checkbox" checked={info.allow_write} onChange={(event) => void run(async () => {
                      await workspaceApi.patch(event.target.checked);
                      setInfo((prev) => ({ ...prev, allow_write: event.target.checked }));
                    })} />
                  </label>
                  <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск по файлам" aria-label="Поиск по файлам" />
                  <button type="button" onClick={() => void run(async () => setHits(await workspaceApi.search(search)))}>Найти</button>
                  {hits.map((hit) => (
                    <div key={`${hit.path}-${hit.line}`} className="center-item-meta" onClick={() => openFile(hit.path)}>
                      {hit.path}:{hit.line} — {hit.preview}
                    </div>
                  ))}
                  <ul className="center-list" style={{ maxHeight: 360, overflow: "auto" }}>
                    {entries.map((entry) => (
                      <li key={entry.path}>
                        <button type="button" onClick={() => openFile(entry.path)}>
                          {entry.kind === "dir" ? "▸ " : "· "}{entry.path}
                        </button>
                      </li>
                    ))}
                  </ul>
                  <div className="center-form">
                    <input value={newPath} onChange={(event) => setNewPath(event.target.value)} placeholder="новый/файл.txt" aria-label="Новый файл" />
                    <button type="button" className="center-primary" disabled={!newPath.trim()} onClick={() => void run(async () => {
                      await workspaceApi.create(newPath.trim(), "");
                      setNewPath("");
                      await loadTree();
                    })}>Создать файл</button>
                  </div>
                </div>
                <div>
                  {kind === "project" ? (
                    <>
                      <label>
                        Файл: {selected || "не выбран"}
                        <textarea value={text} onChange={(event) => setText(event.target.value)} rows={16} style={{ width: "100%" }} aria-label="Редактор файла" />
                      </label>
                      <button type="button" className="center-primary" disabled={!selected || !info.allow_write || busy} onClick={saveFile}>Сохранить</button>
                    </>
                  ) : (
                    <>
                      <label>
                        Команда
                        <input value={command} onChange={(event) => setCommand(event.target.value)} placeholder="например, python -V" aria-label="Команда" />
                      </label>
                      <button type="button" className="center-primary" disabled={!command.trim() || !info.allow_write || busy} onClick={runCommand}>Выполнить</button>
                      <pre aria-label="Вывод терминала" style={{ whiteSpace: "pre-wrap", maxHeight: 240, overflow: "auto" }}>{output || "Вывод появится здесь"}</pre>
                      <div className="center-hint">История: {history.join(" · ") || "пусто"}</div>
                    </>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function Workspace({
  messages,
  state,
  theme,
  model,
  backendOnline,
  threads,
  onRefreshModel,
  onSend,
  onOpenWorkshop,
  onOpenCenter,
  onOpenSettings,
  onCapture,
  onCollapse,
  onTalk,
  onToggleTheme,
  onStop,
  onRegenerate,
  latencyMs = null,
  tokensPerSecond = null,
}: Props) {
  const { t: tr } = useLocale();
  const [draft, setDraft] = useState(() => {
    try {
      return window.localStorage.getItem("amadeus.draft") ?? "";
    } catch {
      return "";
    }
  });
  const [files, setFiles] = useState<AttachmentPayload[]>([]);
  const [fileError, setFileError] = useState("");
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [historySamples, setHistorySamples] = useState<number[]>([]);
  const [pickingRegion, setPickingRegion] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragRect, setDragRect] = useState<number[] | null>(null);
  const [telemetryOpen, setTelemetryOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [focusMode, setFocusMode] = useState(false);
  const [sphereMode, setSphereMode] = useState(loadStartSphere);
  const [headMenuOpen, setHeadMenuOpen] = useState(false);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [errorOpen, setErrorOpen] = useState(false);
  const [voiceLevel, setVoiceLevel] = useState(0);
  const [pendingActions, setPendingActions] = useState<ActionItem[]>([]);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (state !== "error") setErrorOpen(false);
  }, [state]);

  useEffect(() => {
    const onLevel = (event: Event) => {
      const value = (event as CustomEvent<number>).detail;
      setVoiceLevel(typeof value === "number" ? value : 0);
    };
    window.addEventListener("amadeus.voice.level", onLevel);
    return () => window.removeEventListener("amadeus.voice.level", onLevel);
  }, []);

  useEffect(() => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const refreshActions = useCallback(() => {
    void control.actions().then((list) => setPendingActions(list.filter((item) => item.status === "proposed"))).catch(() => undefined);
  }, []);

  useEffect(() => {
    refreshActions();
    const timer = window.setInterval(refreshActions, 5000);
    return () => window.clearInterval(timer);
  }, [refreshActions]);
  const [panel, setPanel] = useState<Panel>("none");
  const chatRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key === ".") {
        event.preventDefault();
        setTelemetryOpen((value) => !value);
      }
      if (event.key === "Escape" && focusMode) setFocusMode(false);
      if (event.ctrlKey && event.key.toLowerCase() === "b") {
        event.preventDefault();
        setHistoryOpen((value) => !value);
      }
      if (event.key === "F11") {
        event.preventDefault();
        setSphereMode((value) => {
          const next = !value;
          void shell.setFullscreen(next);
          return next;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusMode]);

  useEffect(() => {
    const el = chatRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (!backendOnline) return;
    let cancelled = false;
    const load = async () => {
      try {
        const data = await system.metrics() as Metrics;
        if (!cancelled) {
          setMetrics(data);
          setHistorySamples((prev) => [...prev, data.cpu].slice(-12));
        }
      } catch {
        // телеметрия необязательна: ядро может быть выключено
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [backendOnline]);

  const capture = () => {
    void onCapture().then((shot) => {
      if (shot) setFiles((prev) => [...prev, shot].slice(0, 5));
    });
  };

  const captureRegionWith = (rect: number[]) => {
    setFileError("");
    void api
      .screenshot({ region: rect })
      .then((shot) => {
        setFiles((prev) => [
          ...prev,
          {
            name: `область-${Date.now()}.png`,
            mime: "image/png",
            size: shot.size,
            content_base64: shot.content_base64,
          },
        ].slice(0, 5));
      })
      .catch((error: unknown) => {
        setFileError(error instanceof Error ? error.message : "Не удалось снять область");
      })
      .finally(() => {
        setPickingRegion(false);
        setDragStart(null);
        setDragRect(null);
      });
  };

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

  useEffect(() => {
    try {
      window.localStorage.setItem("amadeus.draft", draft);
    } catch {
      // приватный режим браузера
    }
  }, [draft]);

  const submit = () => {
    const text = draft.trim();
    if (!text && files.length === 0) return;
    onSend(text || "Посмотри вложение", files);
    setDraft("");
    setFiles([]);
    setFileError("");
  };

  const addFiles = (selected: FileList | null) => {
    if (!selected) return;
    setFileError("");
    const picked = Array.from(selected).slice(0, 5);
    Promise.all(
      picked.map(
        (file) =>
          new Promise<AttachmentPayload>((resolve, reject) => {
            if (file.size > 5_242_880) {
              reject(new Error(`${file.name}: больше 5 МБ`));
              return;
            }
            const reader = new FileReader();
            reader.onload = () =>
              resolve({
                name: file.name,
                mime: file.type || "application/octet-stream",
                size: file.size,
                content_base64: String(reader.result).split(",")[1] ?? "",
              });
            reader.onerror = () => reject(new Error(`Не удалось прочитать ${file.name}`));
            reader.readAsDataURL(file);
          }),
      ),
    )
      .then((items) => setFiles((prev) => [...prev, ...items].slice(0, 5)))
      .catch((error: unknown) => setFileError(error instanceof Error ? error.message : "Ошибка файла"));
    if (fileRef.current) fileRef.current.value = "";
  };

  const hour = new Date().getHours();
  const greetingLine = hour < 5 ? "Доброй ночи, мисс" : hour < 12 ? "Доброе утро, мисс" : hour < 18 ? "Добрый день, мисс" : "Добрый вечер, мисс";
  const lastError = [...messages].reverse().find((item) => item.error);
  const modelMissing = Boolean(
    lastError && (lastError.errorKind === "model-missing" || lastError.text.includes("404")),
  );
  const compactHud = messages.length > 0;
  const visibleMessages = messages.filter(
    (message, index, all) =>
      all.findIndex((item) => item.id === message.id) === index &&
      (message.streaming || message.text.trim() !== "" || Boolean(message.tools?.length) || Boolean(message.code)),
  );
  let lastAnswerIndex = -1;
  for (let i = visibleMessages.length - 1; i >= 0; i -= 1) {
    const item = visibleMessages[i];
    if (item.role === "assistant" && !item.error && !item.streaming) {
      lastAnswerIndex = i;
      break;
    }
  }
  const lastAnswer = lastAnswerIndex >= 0 ? visibleMessages[lastAnswerIndex] : undefined;
  const toggleSphere = () =>
    setSphereMode((value) => {
      const next = !value;
      saveStartSphere(next);
      if (!next) void shell.setFullscreen(false);
      return next;
    });

  return (
    <div className="app" data-focus={focusMode ? "true" : undefined} data-sphere={sphereMode ? "true" : undefined}>
      <div className="app-header" role="banner">
        <h1 className="name">Amadeus</h1>
        <div
          className={`status-orb status-orb--${state}`}
          title={`Процессор ${metrics ? `${metrics.cpu}%` : "—"} · Память ${metrics ? `${metrics.memory.used_gb} ГБ` : "—"} · Сеанс ${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")} · ${OLLAMA_LABEL}`}
        >
          <MiniCore state={state} size={40} level={voiceLevel} />
          <strong className="app-status-text">
            {!backendOnline ? tr("status.offline") : model.hasModel ? tr("status.online") : tr("status.noModel")}
          </strong>
          <span className="sr-only" role="status" aria-label="Состояние ядра">
            ● {state === "idle" ? tr("state.idle") : tr(`state.${state}`)}
          </span>
          <span className="sr-only status-storage">{backendOnline ? tr("status.storage") : tr("status.demo")}</span>
        </div>
        <span className="grow" />
        <span className="model model--chip" title={OLLAMA_MODEL}>
          {OLLAMA_LABEL}
        </span>
        <div className="head-actions">
          <button className="head-icon" onClick={toggleSphere} title="Сфера" aria-label="Сфера">
            <Icon name="core" />
          </button>
          <button className="head-icon" onClick={onOpenWorkshop} title="Мастерская" aria-label="Мастерская">
            <Icon name="plugins" />
          </button>
          <button
            className="head-more"
            aria-label="Меню: другие действия"
            aria-expanded={headMenuOpen}
            onClick={() => setHeadMenuOpen((value) => !value)}
          >
            <span aria-hidden="true">⋯</span>
            <span className="head-more__text">Меню</span>
          </button>
          {headMenuOpen && (
            <div className="head-menu" role="menu">
              <button role="menuitem" title="Оставить только сферу и ввод" onClick={() => { toggleSphere(); setHeadMenuOpen(false); }}>
                {sphereMode ? "Чат" : "Сфера"}
              </button>
              <button role="menuitem" title="Скрыть боковые панели" onClick={() => { setFocusMode((value) => !value); setHeadMenuOpen(false); }}>
                {focusMode ? "Выйти из фокуса" : "Фокус"}
              </button>
              <button role="menuitem" onClick={() => { onOpenWorkshop(); setHeadMenuOpen(false); }}>
                Мастерская
              </button>
              <button role="menuitem" title="Свернуть в маленькую сферу поверх окон" onClick={() => { onCollapse(); setHeadMenuOpen(false); }}>
                Свернуть
              </button>
              <button role="menuitem" onClick={() => { onToggleTheme(); setHeadMenuOpen(false); }}>
                {theme === "dark" ? tr("theme.toggle") : tr("theme.toggleDark")}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="shell" data-panel={telemetryOpen ? "open" : "closed"}>
        <nav className="rail" aria-label="Основное">
          <button aria-current="page" title="Amadeus" onClick={() => setPanel("none")}>
            <Icon name="core" />
            <span className="rail-label" aria-hidden="true">Главная</span>
          </button>
          <button title={tr("nav.history")} aria-expanded={historyOpen} onClick={() => setHistoryOpen((value) => !value)}>
            <Icon name="history" />
            <span className="rail-label" aria-hidden="true">История</span>
          </button>
          <button title={tr("nav.project")} onClick={() => setPanel((current) => (current === "project" ? "none" : "project"))}>
            <Icon name="folder" />
            <span className="rail-label" aria-hidden="true">Проект</span>
          </button>
          <button title={tr("nav.terminal")} onClick={() => setPanel((current) => (current === "terminal" ? "none" : "terminal"))}>
            <Icon name="terminal" />
            <span className="rail-label" aria-hidden="true">Терминал</span>
          </button>
          <span className="spacer" />
          <button title={tr("nav.center")} onClick={onOpenCenter}>
            <Icon name="center" />
            <span className="rail-label" aria-hidden="true">Центр</span>
          </button>
          <button title={tr("nav.settings")} onClick={onOpenSettings}>
            <Icon name="gear" />
            <span className="rail-label" aria-hidden="true">Настройки</span>
          </button>
        </nav>

        {historyOpen && !focusMode && (
        <aside className="sidebar" aria-label="История диалогов" data-open={historyOpen ? "true" : undefined}>
          <div className="sidebar-head">
            <h2>История</h2>
            <span className="count">{threads ? threads.length : 128}</span>
            <span style={{ flex: 1 }} />
            <button className="side-add" title="Новый диалог">
              ＋
            </button>
          </div>
          <div className="search">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
            {tr("sidebar.search")}
            <kbd>Ctrl+K</kbd>
          </div>
          <div className="threads">
            {(["Сегодня", "Вчера"] as const).map((group) => (
              <div key={group}>
                <div className="group-label">{group}</div>
                {(threads ?? conversations)
                  .filter((c) => c.group === group)
                  .map((c) => (
                    <div className="thread" key={c.id} data-active={c.active ? "true" : undefined}>
                      <span className="title">{c.title}</span>
                      <span className="time">{c.time}</span>
                      <span className="snippet">{c.snippet}</span>
                    </div>
                  ))}
              </div>
            ))}
          </div>
        </aside>
        )}

        <main className="stage" data-hud={messages.length > 0 ? "compact" : "full"}>
          <div className="hud-scene" data-state={state}>
            <div className="scan" />
            <div className="hud-meta left">
              <div>
                <span className="tick" />
                процессор <b className="v">{metrics ? `${metrics.cpu}%` : "—"}</b>
              </div>
              <div>
                <span className="tick" />
                задержка <b className="v">{latencyMs != null ? `${latencyMs} мс` : "—"}</b>
              </div>
              <div>
                <span className="tick" />
                распознавание речи <b>Whisper · русский</b>
              </div>
            </div>
            <div className="hud-meta right">
              <div>
                модель <b className="v">{OLLAMA_LABEL}</b>
                <span className="tick tick--right" />
              </div>
              <div>
                детектор речи <b>Silero</b>
                <span className="tick tick--right" />
              </div>
              <div>
                синтез речи <b>Piper · Ирина</b>
                <span className="tick tick--right" />
              </div>
            </div>
            <div className="hud-meta bottom">
              <div>
                токенов в секунду <b>{tokensPerSecond != null ? tokensPerSecond.toFixed(1) : "—"}</b>
              </div>
            </div>
            <div className="hud-meta bottom-r">
              <div>
                <b>{metrics?.memory.used_gb ?? "—"} ГБ</b> памяти
              </div>
            </div>

            <HUDCore state={state} size={sphereMode ? 380 : 248} level={voiceLevel} />

            {!sphereMode && (
              <div className="hud-compact">
                <MiniCore state={state} size={64} />
                <div className="hud-compact__column">
                  <span className="sr-only" role="status" aria-label="Состояние ядра">
                    ● {state === "idle" ? tr("state.idle") : tr(`state.${state}`)}
                  </span>
                  {state === "error" ? (
                    <button
                      type="button"
                      className={`hud-compact__status hud-compact__status--${state} hud-status-button`}
                      aria-expanded={errorOpen}
                      onClick={() => setErrorOpen((value) => !value)}
                    >
                      ● {tr("state.error")} · {errorOpen ? "скрыть" : "подробнее"}
                    </button>
                  ) : (
                    <span className={`hud-compact__status hud-compact__status--${state}`}>
                      ● {state === "idle" ? tr("state.idle") : tr(`state.${state}`)}
                    </span>
                  )}
                  {compactHud && state === "error" && lastError && errorOpen && (
                    <div className="hud-error hud-error--inline" role="alert">
                      <span>{modelMissing ? "Модель не скачана" : "Не удалось получить ответ"}</span>
                      <button type="button" onClick={onOpenSettings}>
                        {modelMissing ? "Скачать" : "Настройки"}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="tool-satellites" aria-hidden="true" title="Инструменты: память, поиск, экран, проект">
              <span className="satellite satellite--a"><Icon name="history" /></span>
              <span className="satellite satellite--b"><Icon name="plugins" /></span>
              <span className="satellite satellite--c"><Icon name="folder" /></span>
              <span className="satellite satellite--d"><Icon name="terminal" /></span>
            </div>

            {sphereMode && (
              <div className="sphere-subtitle" aria-live="polite">
                {lastAnswer ? (
                  <>
                    <b>Amadeus:</b> {lastAnswer.text}
                  </>
                ) : (
                  "Готов. Скажите «Amadeus» или введите сообщение ниже."
                )}
              </div>
            )}

            {state === "error" && lastError && errorOpen && (sphereMode || !compactHud) && (
              <div className="hud-error" role="alert">
                <span>{modelMissing ? "Модель не скачана" : "Не удалось получить ответ"}</span>
                <button type="button" onClick={onOpenSettings}>
                  {modelMissing ? "Скачать" : "Настройки"}
                </button>
              </div>
            )}

            <div className="hud-caption" role="status" aria-label="Состояние ядра">
              {state === "error" ? (
                <button
                  type="button"
                  className="hud-status-button"
                  onClick={() => setErrorOpen((value) => !value)}
                  aria-expanded={errorOpen}
                >
                  ● {tr("state.error")} · {errorOpen ? "скрыть" : "подробнее"}
                </button>
              ) : (
                <span className="live">● {state === "idle" ? tr("state.idle") : tr(`state.${state}`)}</span>
              )}
            </div>
          </div>

          <div
            className="chat"
            ref={chatRef}
            role="log"
            aria-label="История сообщений"
            tabIndex={0}
          >
            {messages.length === 0 && (
              <div className="greeting">
                <p className="greeting__line">{greetingLine}</p>
                <p className="greeting__hint">Я за пультом. Скажите, что сыграть сегодня.</p>
              </div>
            )}
            {visibleMessages.map((message, index) => (
                <div
                  className={`msg ${message.role} ${message.error ? "msg--error" : ""} ${
                    index > 0 && visibleMessages[index - 1].role === message.role ? "msg--grouped" : ""
                  }`}
                  key={message.id}
                  role="article"
                  aria-label={`Сообщение: ${message.role === "user" ? "вы" : "ядро"}`}
                >
                  <div className="who">
                    <span className="mark">{message.role === "user" ? "◆" : "▲"}</span>
                    {message.role === "user" ? "ВЫ" : "ЯДРО"} · {message.time}
                  </div>
                  <div className="body">
                    {message.role === "assistant" ? <RichText text={message.text} /> : message.text}
                    {message.errorKind === "model-missing" && (
                      <div className="model-error-card" role="alert">
                        <button type="button" onClick={() => void navigator.clipboard.writeText(`ollama pull ${OLLAMA_MODEL}`)}>
                          Скачать
                        </button>
                        <button type="button" onClick={onOpenSettings}>
                          Выбрать другую
                        </button>
                        <button type="button" onClick={onRegenerate}>
                          Повторить
                        </button>
                      </div>
                    )}
                    {message.streaming && <span className="stream-cursor" aria-hidden="true" />}
                    {index === lastAnswerIndex && (
                      <button type="button" className="regenerate" onClick={onRegenerate}>
                        ↻ Перегенерировать
                      </button>
                    )}
                    {!message.streaming &&
                      message.tools?.map((tool) => (
                        <details className="tool-chip" key={tool.name}>
                          <summary>✓ {tool.name} · {tool.detail}</summary>
                          <span>{tool.detail}</span>
                        </details>
                      ))}
                    {!message.streaming && message.code && (
                      <div className="code">
                        <button
                          type="button"
                          className="code-copy"
                          onClick={() => void navigator.clipboard.writeText(message.code?.lines.join("\n") ?? "")}
                        >
                          Скопировать
                        </button>
                        <span className="k">{message.code.file}</span>:142{"\n"}
                        <span className="s"># ЗАДАЧА:</span> вынести детектор активности речи в отдельный процесс{"\n"}
                        <span className="k">{message.code.lines[1].split(":")[0]}</span>: новый
                      </div>
                    )}
                  </div>
                </div>
              ))}

          </div>

          {pendingActions.length > 0 && (
            <div className="approve-cards" aria-label="Запросы одобрения">
              {pendingActions.map((action) => {
                let args: Record<string, unknown> = {};
                try { args = JSON.parse(action.args_json) as Record<string, unknown>; } catch { args = {}; }
                return (
                  <div className="approve-card" key={action.id} role="group" aria-label={`Действие ${action.tool_name}`}>
                    <div className="approve-card__title">
                      ⚠ {action.tool_name} · {action.risk_level}
                    </div>
                    <code className="approve-card__args">{JSON.stringify(args).slice(0, 180)}</code>
                    <div className="approve-card__actions">
                      <button type="button" onClick={() => { void control.approve(action.id).finally(refreshActions); }}>
                        Разрешить
                      </button>
                      <button type="button" onClick={() => { void control.deny(action.id).finally(refreshActions); }}>
                        Отклонить
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="composer-wrap">
            <input
              ref={fileRef}
              type="file"
              multiple
              hidden
              aria-label="Прикрепить файлы"
              onChange={(event) => addFiles(event.target.files)}
            />
            {files.length > 0 && (
              <div className="attachments" aria-label="Прикреплённые файлы">
                {files.map((file, index) => (
                  <span className="attachment" key={`${file.name}-${index}`}>
                    {file.name}
                    <button
                      type="button"
                      aria-label={`Убрать вложение ${file.name}`}
                      onClick={() => setFiles((prev) => prev.filter((_, i) => i !== index))}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            {fileError && <p className="attachment-error" role="alert">{fileError}</p>}
            <div className="composer">
              <textarea
                ref={inputRef}
                className="input"
                rows={1}
                value={draft}
                placeholder={tr("composer.placeholder")}
                aria-label="Сообщение"
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && event.shiftKey) return;
                  if (event.key === "Enter") {
                    event.preventDefault();
                    submit();
                  }
                  if (event.key === "ArrowUp" && !draft.trim()) {
                    const last = [...messages].reverse().find((m) => m.role === "user");
                    if (last) {
                      event.preventDefault();
                      setDraft(last.text);
                    }
                  }
                }}
                style={{ resize: "none", maxHeight: 160 }}
              />
              <div className="attach-menu">
                <button
                  className="icon-btn"
                  title="Прикрепить файл, снимок или область экрана"
                  aria-label="Добавить файл"
                  aria-expanded={attachMenuOpen}
                  type="button"
                  onClick={() => setAttachMenuOpen((value) => !value)}
                >
                  <span aria-hidden="true">＋</span>
                  <span className="composer__attach-text">Файл</span>
                </button>
                {attachMenuOpen && (
                  <div className="attach-popover" role="menu">
                    <button type="button" role="menuitem" onClick={() => { fileRef.current?.click(); setAttachMenuOpen(false); }}>
                      Файл
                    </button>
                    <button type="button" role="menuitem" onClick={() => { capture(); setAttachMenuOpen(false); }}>
                      Снимок экрана
                    </button>
                    <button type="button" role="menuitem" onClick={() => { setPickingRegion(true); setAttachMenuOpen(false); }}>
                      Область экрана
                    </button>
                  </div>
                )}
              </div>
              <button className="icon-btn" title={tr("voice.microphone")} type="button" onClick={onTalk} aria-label={tr("voice.microphone")}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <rect x="9" y="3" width="6" height="11" rx="3" />
                  <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
                </svg>
              </button>
              {(state === "thinking" || state === "speaking") && (
                <button className="stop-btn" type="button" title="Остановить генерацию" onClick={onStop}>
                  ■ Стоп
                </button>
              )}
              <button className="send" title="Отправить" type="button" onClick={submit}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 12l16-8-6 16-3-6-7-2z" />
                </svg>
              </button>
            </div>
            {messages.length === 0 && (
              <div className="quick-prompts" aria-label="Подсказки">
                {["Что у меня сегодня?", "Открой проект", "Сделай скриншот", "Напомни через 10 минут"].map((hint) => (
                  <button key={hint} type="button" onClick={() => setDraft(hint)}>
                    {hint}
                  </button>
                ))}
              </div>
            )}
          </div>
        </main>

        {telemetryOpen && !focusMode && (
        <aside className="panel" aria-label="Телеметрия">
          <div className="panel-head">
            <h2>{tr("panel.telemetry")}</h2>
            <span className="demo-badge">демо</span>
            <span className="grow" />
            <span className="hud-label">2 с</span>
          </div>
          <div className="panel-body">
            <div className="model-card">
              <div className="model-card__head">
                <span className="hud-label">модель</span>
                <span
                  className={`model-dot ${model.hasModel ? "model-dot--ok" : model.online ? "model-dot--warn" : "model-dot--off"}`}
                />
              </div>
              <div className="model-card__name">{OLLAMA_LABEL}</div>
              <div className="model-card__id" title={OLLAMA_MODEL}>
                {OLLAMA_MODEL}
              </div>
              <div className="model-card__state">
                {!model.checked
                  ? "проверяю подключение…"
                  : !model.online
                    ? "Ollama не отвечает"
                    : model.hasModel
                      ? "загружена и готова"
                      : "не загружена в Ollama"}
              </div>
              {model.checked && model.online && !model.hasModel && (
                <code className="model-card__cmd">ollama pull {OLLAMA_MODEL}</code>
              )}
              <button className="model-card__refresh" onClick={onRefreshModel} type="button">
                Проверить
              </button>
            </div>

            <MetricCard label="процессор" value={metrics?.cpu ?? 0} unit="%" percent={metrics?.cpu ?? 0} history={historySamples.length ? historySamples : [0]} />
            <MetricCard label="память" value={metrics?.memory.used_gb ?? 0} unit="ГБ" percent={metrics?.memory.percent ?? 0} history={[metrics?.memory.percent ?? 0]} />
            <MetricCard label="диск" value={metrics?.disk.free_gb ?? 0} unit="ГБ" percent={metrics?.disk.percent ?? 0} history={[metrics?.disk.percent ?? 0]} />
            <MetricCard
              label="температура"
              value={metrics?.temperature_c ?? 0}
              unit="°C"
              percent={metrics?.temperature_c ?? 0}
              critical
              history={[metrics?.temperature_c ?? 0]}
            />

            <hr className="hud-rule" style={{ margin: "4px 0" }} />
            <div className="hud-label panel-section">{tr("panel.tools")}</div>
            <Tools />
            <hr className="hud-rule" style={{ margin: "4px 0" }} />
            <div className="hud-label panel-section">{tr("panel.activity")}</div>
            <Activity />
          </div>
        </aside>
        )}
      </div>

      {panel !== "none" && <ProjectPanel kind={panel} onClose={() => setPanel("none")} />}

      {pickingRegion && (
        <div
          className="region-picker"
          role="dialog"
          aria-label="Выделение области экрана"
          style={{
            position: "fixed", inset: 0, zIndex: 10_000,
            background: "color-mix(in srgb, var(--color-mask) 40%, transparent)",
            cursor: "crosshair",
          }}
          onPointerDown={(event) => {
            if ((event.target as HTMLElement).tagName === "BUTTON") return;
            setDragStart({ x: event.clientX, y: event.clientY });
            setDragRect([event.clientX, event.clientY, 0, 0]);
          }}
          onPointerMove={(event) => {
            if (!dragStart) return;
            setDragRect([
              Math.min(dragStart.x, event.clientX),
              Math.min(dragStart.y, event.clientY),
              Math.abs(event.clientX - dragStart.x),
              Math.abs(event.clientY - dragStart.y),
            ]);
          }}
          onPointerUp={() => {
            if (!dragStart || !dragRect || dragRect[2] < 8 || dragRect[3] < 8) return;
            captureRegionWith(dragRect);
          }}
        >
          <div style={{ position: "absolute", top: 24, left: "50%", transform: "translateX(-50%)", color: "white" }}>
            Перетащите курсор, чтобы выделить область. Двойной клик — отмена.
          </div>
          <button
            type="button"
            style={{ position: "absolute", top: 24, right: 24 }}
            onDoubleClick={(event) => event.stopPropagation()}
            onClick={() => {
              setPickingRegion(false);
              setDragStart(null);
              setDragRect(null);
            }}
          >
            Отмена
          </button>
          {dragRect && dragRect[2] > 0 && dragRect[3] > 0 && (
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                left: dragRect[0], top: dragRect[1],
                width: dragRect[2], height: dragRect[3],
                border: "2px solid var(--color-accent)",
                background: "color-mix(in srgb, var(--color-accent) 12%, transparent)",
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
