import { useCallback, useEffect, useRef, useState } from "react";
import type { HudState } from "./components/primitives";
import { Workspace } from "./components/Workspace";
import { MiniOverlay } from "./components/MiniOverlay";
import { Workshop } from "./components/Workshop";
import { ControlCenter } from "./components/ControlCenter";
import { Settings } from "./components/Settings";
import { Setup } from "./components/Setup";
import { initialMessages, nowTime, type ChatMessage, type Conversation } from "./data/mock";
import {
  api,
  control,
  shell,
  streamAnswer,
  toTime,
  waitForBackend,
  type AttachmentPayload,
} from "./lib/api";
import {
  OLLAMA_MODEL,
  chatOnce,
  chatStream,
  checkModel,
  type ChatTurn,
  type ModelState,
} from "./lib/ollama";
import {
  executeCommand,
  loadCommands,
  matchCommand,
  matchHotkey,
  saveCommands,
  type Command,
} from "./lib/commands";
import { loadAvatar, saveAvatar, type AvatarMode } from "./lib/preferences";
import "./styles/app.css";

type View = "workspace" | "mini";

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.round(Math.random() * 1e6)}`;

const toTurns = (messages: ChatMessage[]): ChatTurn[] =>
  messages
    .filter((message) => message.text.trim().length > 0 && !message.error)
    .slice(-16)
    .map((message) => ({ role: message.role, content: message.text }));

export default function App() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [view, setView] = useState<View>("workspace");
  const [autoWake, setAutoWake] = useState(false);
  const [workshopOpen, setWorkshopOpen] = useState(false);
  const [centerOpen, setCenterOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [setupLocale, setSetupLocale] = useState("ru");
  const [setupTick, setSetupTick] = useState(0);
  const [commands, setCommands] = useState<Command[]>(loadCommands);
  const [avatar, setAvatar] = useState<AvatarMode>(loadAvatar);
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [state, setState] = useState<HudState>("idle");
  const [backendOnline, setBackendOnline] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [threads, setThreads] = useState<Conversation[] | null>(null);
  const [model, setModel] = useState<ModelState>({
    checked: false,
    online: false,
    hasModel: false,
    models: [],
  });
  const busy = useRef(false);
  const firedReminders = useRef<Set<string>>(new Set());

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    saveCommands(commands);
  }, [commands]);

  useEffect(() => {
    saveAvatar(avatar);
  }, [avatar]);

  const refreshModel = useCallback(async () => {
    const next = await checkModel();
    setModel(next);
  }, []);

  useEffect(() => {
    void refreshModel();
    const timer = window.setInterval(() => void refreshModel(), 20000);
    return () => window.clearInterval(timer);
  }, [refreshModel]);

  // Нативные уведомления: планировщик в ядре меняет статус, UI показывает ОС-уведомление один раз.
  useEffect(() => {
    if (!backendOnline) return;
    const check = async () => {
      try {
        const list = await control.reminders();
        for (const item of list) {
          if (item.status !== "done" || firedReminders.current.has(item.id)) continue;
          firedReminders.current.add(item.id);
          await shell.notify("Напоминание", item.title);
        }
      } catch {
        // опрос не должен ломать интерфейс
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 20_000);
    return () => window.clearInterval(timer);
  }, [backendOnline]);

  // Подключаем SQLite-ядро, если оно запущено. Без него приложение остаётся в демо-режиме.
  const syncThreads = useCallback(async (activeId?: string) => {
    const list = await api.conversations();
    setThreads(
      list.map((item) => ({
        id: item.id,
        title: item.title || "Новый диалог",
        time: toTime(item.updated_at),
        snippet: "",
        group:
          new Date(item.updated_at).toDateString() === new Date().toDateString()
            ? ("Сегодня" as const)
            : ("Вчера" as const),
        active: item.id === (activeId ?? list[0]?.id),
      })),
    );
    return list;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      try {
        await waitForBackend();
        const setup = await api.setupStatus();
        if (setup.needsSetup) {
          if (!cancelled) {
            setSetupLocale(setup.locale === "en" ? "en" : "ru");
            setNeedsSetup(true);
            setBackendOnline(true);
          }
          return;
        }
        if (!cancelled) setNeedsSetup(false);
        let list = await api.conversations();
        if (list.length === 0) await api.createConversation("Новый диалог");
        list = await syncThreads();
        const active = list[0];
        if (!active) return;
        const stored = await api.messages(active.id);
        if (cancelled) return;
        setConversationId(active.id);
        setMessages(
          stored
            .filter((item) => item.role === "user" || item.role === "assistant")
            .map((item) => ({
              id: item.id,
              role: item.role as "user" | "assistant",
              time: toTime(item.created_at),
              text: item.text,
              error: item.status === "error" || Boolean(item.error),
            })),
        );
        setBackendOnline(true);
      } catch {
        setBackendOnline(false);
        setNeedsSetup(false);
      }
    };
    void init();
    return () => {
      cancelled = true;
    };
  }, [syncThreads, setupTick]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (workshopOpen) return;
      if (event.key === "Escape" && settingsOpen) setSettingsOpen(false);
      else if (event.key === "Escape" && centerOpen) setCenterOpen(false);
      else if (event.key === "Escape" && view === "workspace") setView("mini");
      else if (event.key === "Escape" && view === "mini") setView("workspace");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, workshopOpen, centerOpen, settingsOpen]);

  const flashSpeaking = useCallback(() => {
    setState("speaking");
    window.setTimeout(() => setState("idle"), 1200);
  }, []);

  const runLocal = useCallback(
    (text: string, addUser = true, allowOpen = true): string | null => {
      const command = matchCommand(commands, text);
      if (!command) return null;
      const { reply } = executeCommand(command, { allowOpen });
      setMessages((prev) => [
        ...prev,
        ...(addUser ? [{ id: newId(), role: "user" as const, time: nowTime(), text }] : []),
        { id: newId(), role: "assistant" as const, time: nowTime(), text: reply },
      ]);
      flashSpeaking();
      return reply;
    },
    [commands, flashSpeaking],
  );

  const runByHotkey = useCallback(
    (command: Command) => {
      const { reply } = executeCommand(command);
      setMessages((prev) => [
        ...prev,
        {
          id: newId(),
          role: "assistant",
          time: nowTime(),
          text: reply,
        },
      ]);
      flashSpeaking();
    },
    [flashSpeaking],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (workshopOpen) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      const command = commands.find(
        (item) => item.enabled && item.hotkey.trim() && matchHotkey(item.hotkey, event),
      );
      if (command) {
        event.preventDefault();
        runByHotkey(command);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [commands, runByHotkey, workshopOpen]);

  const fail = (error: unknown): string => {
    const reason = error instanceof Error ? error.message : "неизвестная ошибка";
    if (!model.online) {
      return `Ollama не отвечает. Запустите её командой «ollama serve» и обновите страницу. Детали: ${reason}`;
    }
    if (!model.hasModel) {
      return `Модель ещё не загружена. Выполните «ollama pull ${OLLAMA_MODEL}» и проверьте снова. Детали: ${reason}`;
    }
    return `Не удалось получить ответ от модели. Детали: ${reason}`;
  };

  const send = async (text: string, attachments: AttachmentPayload[] = []) => {
    if (!text.trim() || busy.current) return;

    if (runLocal(text.trim())) return;

    if (attachments.length > 0 && !backendOnline) {
      setMessages((prev) => [
        ...prev,
        {
          id: newId(),
          role: "assistant",
          time: nowTime(),
          text: "Вложения требуют запущенное локальное ядро. Запустите бэкенд и попробуйте снова.",
          error: true,
        },
      ]);
      return;
    }

    busy.current = true;
    const userMessage: ChatMessage = {
      id: newId(),
      role: "user",
      time: nowTime(),
      text: text.trim(),
    };
    const history = [...messages.filter((message) => !message.streaming), userMessage];
    setMessages(history);
    setState("thinking");

    if (backendOnline && conversationId) {
      const answerId = newId();
      let received = "";
      try {
        await streamAnswer(conversationId, text.trim(), (chunk) => {
          if (!received) {
            received = chunk;
            setState("speaking");
            setMessages((prev) => [
              ...prev,
              { id: answerId, role: "assistant", time: nowTime(), text: chunk, streaming: true },
            ]);
          } else {
            received += chunk;
            setMessages((prev) =>
              prev.map((item) => (item.id === answerId ? { ...item, text: received } : item)),
            );
          }
        }, undefined, attachments);
        if (!received.trim()) throw new Error("ядро вернуло пустой ответ");
        setMessages((prev) =>
          prev.map((item) =>
            item.id === answerId ? { ...item, text: received.trim(), streaming: false } : item,
          ),
        );
        setState("idle");
        void syncThreads(conversationId).catch(() => undefined);
      } catch (error) {
        const reason = error instanceof Error ? error.message : "неизвестная ошибка";
        setMessages((prev) => [
          ...prev,
          {
            id: newId(),
            role: "assistant",
            time: nowTime(),
            text: `Не удалось получить ответ: ${reason}`,
            error: true,
          },
        ]);
        setState("error");
      } finally {
        busy.current = false;
      }
      return;
    }

    const assistantId = newId();
    let started = false;
    let received = "";

    try {
      for await (const chunk of chatStream(toTurns(history))) {
        received += chunk;
        if (!started) {
          started = true;
          setState("speaking");
          setMessages((prev) => [
            ...prev,
            {
              id: assistantId,
              role: "assistant",
              time: nowTime(),
              text: chunk,
              streaming: true,
            },
          ]);
        } else {
          setMessages((prev) =>
            prev.map((message) =>
              message.id === assistantId ? { ...message, text: received } : message,
            ),
          );
        }
      }

      if (!received.trim()) throw new Error("модель вернула пустой ответ");

      setMessages((prev) =>
        prev.map((message) =>
          message.id === assistantId ? { ...message, text: received, streaming: false } : message,
        ),
      );
      setState("idle");
    } catch (error) {
      setMessages((prev) => [
        ...prev.filter((message) => message.id !== assistantId),
        {
          id: newId(),
          role: "assistant",
          time: nowTime(),
          text: fail(error),
          error: true,
        },
      ]);
      setState("error");
    } finally {
      busy.current = false;
      void refreshModel();
    }
  };

  const voiceCommand = useCallback(
    async (text: string): Promise<string> => {
      const local = runLocal(text);
      if (local) return local;

      const userMessage: ChatMessage = {
        id: newId(),
        role: "user",
        time: nowTime(),
        text,
      };
      const history = [...messages.filter((message) => !message.streaming), userMessage];
      setMessages(history);

      if (backendOnline && conversationId) {
        try {
          const { text: reply } = await api.send(conversationId, text);
          setMessages((prev) => [
            ...prev,
            { id: newId(), role: "assistant", time: nowTime(), text: reply },
          ]);
          setState("idle");
          void syncThreads(conversationId).catch(() => undefined);
          return reply;
        } catch (error) {
          const reason = error instanceof Error ? error.message : "неизвестная ошибка";
          setMessages((prev) => [
            ...prev,
            { id: newId(), role: "assistant", time: nowTime(), text: reason, error: true },
          ]);
          setState("error");
          throw new Error(reason);
        }
      }

      try {
        const reply = await chatOnce(toTurns(history));
        if (!reply.trim()) throw new Error("модель вернула пустой ответ");
        setMessages((prev) => [
          ...prev,
          {
            id: newId(),
            role: "assistant",
            time: nowTime(),
            text: reply,
          },
        ]);
        setState("idle");
        void refreshModel();
        return reply;
      } catch (error) {
        const message = fail(error);
        setMessages((prev) => [
          ...prev,
          {
            id: newId(),
            role: "assistant",
            time: nowTime(),
            text: message,
            error: true,
          },
        ]);
        setState("error");
        throw new Error(message);
      }
    },
    [messages, runLocal, refreshModel, model.online, model.hasModel, backendOnline, conversationId, syncThreads],
  );

  return (
    <>
      <div hidden={view !== "workspace"}>
        <Workspace
          messages={messages}
          state={state}
          theme={theme}
          model={model}
          backendOnline={backendOnline}
          threads={threads ?? undefined}
          onRefreshModel={() => void refreshModel()}
          onSend={(text, attachments) => void send(text, attachments)}
          onOpenWorkshop={() => setWorkshopOpen(true)}
          onOpenCenter={() => setCenterOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
          onCapture={() =>
            shell.captureScreen().then((shot) => {
              if (!shot) {
                setMessages((prev) => [
                  ...prev,
                  {
                    id: newId(),
                    role: "assistant",
                    time: nowTime(),
                    text: "Снимок экрана работает в оболочке Tauri. В браузере прикрепите файл вручную.",
                    error: true,
                  },
                ]);
              }
              return shot;
            })
          }
          onCollapse={() => {
            setAutoWake(false);
            setView("mini");
          }}
          onTalk={() => {
            setAutoWake(true);
            setView("mini");
          }}
          onToggleTheme={() => setTheme((value) => (value === "dark" ? "light" : "dark"))}
        />
      </div>

      {view === "mini" && (
        <MiniOverlay
          autoWake={autoWake}
          avatar={avatar}
          conversationId={conversationId}
          onRestore={() => {
            setAutoWake(false);
            setView("workspace");
          }}
          onVoiceCommand={voiceCommand}
        />
      )}

      {needsSetup && (
        <Setup
          initialLocale={setupLocale}
          onComplete={() => {
            setNeedsSetup(false);
            setSetupTick((tick) => tick + 1);
          }}
        />
      )}

      {settingsOpen && (
        <Settings
          theme={theme}
          onTheme={setTheme}
          onOpenCenter={() => setCenterOpen(true)}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {centerOpen && <ControlCenter onClose={() => setCenterOpen(false)} />}

      {workshopOpen && (
        <Workshop
          commands={commands}
          onCommands={setCommands}
          avatar={avatar}
          onAvatar={setAvatar}
          onTelegramCommand={(text) => runLocal(text, true, false)}
          onClose={() => setWorkshopOpen(false)}
        />
      )}
    </>
  );
}
