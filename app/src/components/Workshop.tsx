import { useEffect, useRef, useState } from "react";
import {
  emptyCommand,
  executeCommand,
  newCommandId,
  type Command,
  type CommandAction,
} from "../lib/commands";
import { getMe, getUpdates, looksLikeToken, sendMessage, type TelegramBot } from "../lib/telegram";
import { CoreMark } from "./CoreMark";
import { ParticleSphere } from "./ParticleSphere";
import { loadMiniPrefs, saveMiniPrefs, type AvatarMode, type MiniPrefs } from "../lib/preferences";
import { shell } from "../lib/api";
import "./workshop.css";

type Tab = "commands" | "telegram" | "avatar";

type Props = {
  commands: Command[];
  onCommands: (next: Command[]) => void;
  avatar: AvatarMode;
  onAvatar: (mode: AvatarMode) => void;
  onTelegramCommand: (text: string) => string | null;
  onClose: () => void;
};

const ACTION_LABEL: Record<CommandAction["type"], string> = {
  say: "Сказать",
  open_url: "Открыть ссылку",
};

export function Workshop({ commands, onCommands, avatar, onAvatar, onTelegramCommand, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("commands");
  const [editing, setEditing] = useState<Command | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (editing) setEditing(null);
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, onClose]);

  const startNew = () => {
    setEditing(emptyCommand());
    setError("");
    setResult("");
  };

  const startEdit = (command: Command) => {
    setEditing(structuredClone(command));
    setError("");
    setResult("");
  };

  const save = () => {
    if (!editing) return;
    const name = editing.name.trim();
    const phrase = editing.phrase.trim();
    const actions = editing.actions.filter((action) => action.value.trim());
    if (!name || !phrase) {
      setError("Нужны название и фраза-триггер.");
      return;
    }
    if (actions.length === 0) {
      setError("Добавьте хотя бы одно действие со значением.");
      return;
    }
    const next: Command = { ...editing, name, phrase, actions };
    const exists = commands.some((command) => command.id === next.id);
    onCommands(
      exists
        ? commands.map((command) => (command.id === next.id ? next : command))
        : [...commands, next],
    );
    setEditing(null);
    setError("");
    setResult("Команда сохранена.");
  };

  const test = (command: Command) => {
    const run = executeCommand(command);
    setResult(run.reply);
  };

  const remove = (id: string) => {
    if (confirmId !== id) {
      setConfirmId(id);
      return;
    }
    onCommands(commands.filter((command) => command.id !== id));
    setConfirmId(null);
  };

  const updateAction = (id: string, patch: Partial<CommandAction>) => {
    if (!editing) return;
    setEditing({
      ...editing,
      actions: editing.actions.map((action) =>
        action.id === id ? ({ ...action, ...patch } as CommandAction) : action,
      ),
    });
  };

  const addAction = () => {
    if (!editing) return;
    setEditing({
      ...editing,
      actions: [...editing.actions, { id: newCommandId(), type: "say", value: "" }],
    });
  };

  return (
    <div
      className="workshop-scrim"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section className="workshop" role="dialog" aria-modal="true" aria-label="Мастерская Amadeus">
        <aside className="workshop__side">
          <div className="workshop__brand">
            <span className="workshop__logo">A</span>
            <div>
              <strong>Мастерская</strong>
              <span>команды · Telegram · аватар</span>
            </div>
          </div>

          <nav className="workshop__tabs" aria-label="Разделы мастерской">
            <button type="button" aria-pressed={tab === "commands"} onClick={() => setTab("commands")}>
              Команды
            </button>
            <button type="button" aria-pressed={tab === "telegram"} onClick={() => setTab("telegram")}>
              Telegram
            </button>
            <button type="button" aria-pressed={tab === "avatar"} onClick={() => setTab("avatar")}>
              Аватар
            </button>
          </nav>

          <span className="workshop__grow" />
          <button type="button" className="workshop__close" onClick={onClose}>
            Закрыть
          </button>
        </aside>

        <div className="workshop__content">
          {tab === "commands" && (
            <CommandsTab
              commands={commands}
              editing={editing}
              error={error}
              result={result}
              confirmId={confirmId}
              onNew={startNew}
              onEdit={startEdit}
              onSave={save}
              onCancel={() => {
                setEditing(null);
                setError("");
              }}
              onTest={test}
              onRemove={remove}
              onToggle={(id, enabled) =>
                onCommands(
                  commands.map((command) => (command.id === id ? { ...command, enabled } : command)),
                )
              }
              onDraft={setEditing}
              onAction={updateAction}
              onAddAction={addAction}
              onRemoveAction={(id) => {
                if (!editing) return;
                setEditing({
                  ...editing,
                  actions: editing.actions.filter((action) => action.id !== id),
                });
              }}
            />
          )}

          {tab === "telegram" && <TelegramTab onTelegramCommand={onTelegramCommand} />}

          {tab === "avatar" && <AvatarTab avatar={avatar} onAvatar={onAvatar} />}
        </div>
      </section>
    </div>
  );
}

function CommandsTab({
  commands,
  editing,
  error,
  result,
  confirmId,
  onNew,
  onEdit,
  onSave,
  onCancel,
  onTest,
  onRemove,
  onToggle,
  onDraft,
  onAction,
  onAddAction,
  onRemoveAction,
}: {
  commands: Command[];
  editing: Command | null;
  error: string;
  result: string;
  confirmId: string | null;
  onNew: () => void;
  onEdit: (command: Command) => void;
  onSave: () => void;
  onCancel: () => void;
  onTest: (command: Command) => void;
  onRemove: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
  onDraft: (command: Command) => void;
  onAction: (id: string, patch: Partial<CommandAction>) => void;
  onAddAction: () => void;
  onRemoveAction: (id: string) => void;
}) {
  if (editing) {
    return (
      <div className="workshop__pane">
        <header className="workshop__head">
          <div>
            <span className="hud-label">конструктор</span>
            <h1>{commands.some((command) => command.id === editing.id) ? "Изменить команду" : "Новая команда"}</h1>
          </div>
          <button type="button" className="w-btn w-btn--primary" onClick={onSave}>
            Сохранить
          </button>
        </header>

        <div className="command-form">
          <label className="w-field">
            <span>Название</span>
            <input
              value={editing.name}
              onChange={(event) => onDraft({ ...editing, name: event.target.value })}
              placeholder="Например: Рабочий режим"
            />
          </label>
          <label className="w-field">
            <span>Фраза-триггер</span>
            <input
              value={editing.phrase}
              onChange={(event) => onDraft({ ...editing, phrase: event.target.value })}
              placeholder="рабочий режим"
            />
            <small>Скажите или напишите эту фразу — команда запустится без модели.</small>
          </label>
          <label className="w-field">
            <span>Горячая клавиша</span>
            <input
              value={editing.hotkey}
              onChange={(event) => onDraft({ ...editing, hotkey: event.target.value })}
              placeholder="Ctrl+Alt+1"
            />
            <small>Необязательно. Формат: Ctrl, Alt, Shift, Meta и клавиша.</small>
          </label>

          <div className="w-actions">
            <div className="w-actions__head">
              <span className="hud-label">действия</span>
              <button type="button" className="w-btn" onClick={onAddAction}>
                + Действие
              </button>
            </div>
            {editing.actions.map((action, index) => (
              <div className="w-action" key={action.id}>
                <span className="w-action__num">{index + 1}</span>
                <select
                  value={action.type}
                  aria-label="Тип действия"
                  onChange={(event) =>
                    onAction(action.id, { type: event.target.value as CommandAction["type"] })
                  }
                >
                  {Object.entries(ACTION_LABEL).map(([value, label]) => (
                    <option value={value} key={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <input
                  value={action.value}
                  aria-label="Значение действия"
                  placeholder={
                    action.type === "say"
                      ? "Что сказать. Можно вставить {time}"
                      : "https://example.com"
                  }
                  onChange={(event) => onAction(action.id, { value: event.target.value })}
                />
                <button
                  type="button"
                  className="w-action__remove"
                  aria-label="Удалить действие"
                  onClick={() => onRemoveAction(action.id)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          {error && (
            <p className="w-error" role="alert">
              {error}
            </p>
          )}
          {result && <p className="w-result">{result}</p>}

          <div className="workshop__footer">
            <button type="button" className="w-btn" onClick={onCancel}>
              Отмена
            </button>
            <button type="button" className="w-btn w-btn--primary" onClick={onSave}>
              Сохранить
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="workshop__pane">
      <header className="workshop__head">
        <div>
          <span className="hud-label">без модели</span>
          <h1>Команды</h1>
          <p>Фраза или горячая клавиша запускает цепочку действий. Модель для этого не нужна.</p>
        </div>
        <button type="button" className="w-btn w-btn--primary" onClick={onNew}>
          Новая команда
        </button>
      </header>

      {result && <p className="w-result">{result}</p>}

      <div className="command-list">
        {commands.length === 0 && (
          <div className="w-empty">
            <p>Пока пусто. Создайте первую команду — например, «который час».</p>
          </div>
        )}
        {commands.map((command) => (
          <article className={`command ${command.enabled ? "" : "command--off"}`} key={command.id}>
            <div className="command__top">
              <div>
                <h3>{command.name || "Без названия"}</h3>
                <span className="command__phrase">«{command.phrase}»</span>
              </div>
              <label className="w-switch" title={command.enabled ? "Выключить" : "Включить"}>
                <input
                  type="checkbox"
                  checked={command.enabled}
                  onChange={(event) => onToggle(command.id, event.target.checked)}
                />
                <span />
              </label>
            </div>
            <div className="command__meta">
              {command.hotkey && <span className="command__key">{command.hotkey}</span>}
              <span>{command.actions.length} действ.</span>
            </div>
            <ul className="command__actions">
              {command.actions.map((action) => (
                <li key={action.id}>
                  <b>{ACTION_LABEL[action.type]}</b> {action.value}
                </li>
              ))}
            </ul>
            <div className="command__buttons">
              <button type="button" className="w-btn" onClick={() => onTest(command)}>
                Проверить
              </button>
              <button type="button" className="w-btn" onClick={() => onEdit(command)}>
                Изменить
              </button>
              <button
                type="button"
                className={`w-btn ${confirmId === command.id ? "w-btn--danger" : ""}`}
                onClick={() => onRemove(command.id)}
              >
                {confirmId === command.id ? "Точно удалить" : "Удалить"}
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function TelegramTab({ onTelegramCommand }: { onTelegramCommand: (text: string) => string | null }) {
  const [token, setToken] = useState("");
  const [chatId, setChatId] = useState(() => localStorage.getItem("amadeus.telegram.chat") ?? "");
  const [bot, setBot] = useState<TelegramBot | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const callbackRef = useRef(onTelegramCommand);
  callbackRef.current = onTelegramCommand;

  useEffect(() => {
    localStorage.setItem("amadeus.telegram.chat", chatId);
  }, [chatId]);

  useEffect(() => {
    if (!receiving || !token || !chatId) return;
    let stopped = false;
    let offset = 0;
    const startedAt = Math.floor(Date.now() / 1000) - 2;

    const loop = async () => {
      while (!stopped) {
        try {
          const updates = await getUpdates(token, offset);
          if (stopped) return;
          for (const update of updates) {
            offset = Math.max(offset, update.update_id + 1);
            const message = update.message;
            if (!message?.text) continue;
            if (message.date && message.date < startedAt) continue;
            if (String(message.chat.id) !== chatId.trim()) continue;
            const reply = callbackRef.current(message.text);
            await sendMessage(
              token,
              chatId,
              reply ?? "Такой команды нет. Добавьте её в мастерской «Команды».",
            );
            setLog((items) =>
              [`${new Date().toLocaleTimeString("ru-RU")} · ${message.text}`, ...items].slice(0, 6),
            );
          }
        } catch (caught) {
          if (!stopped) {
            setError(caught instanceof Error ? caught.message : "Приём остановлен");
            setReceiving(false);
          }
          return;
        }
      }
    };

    void loop();
    return () => {
      stopped = true;
    };
  }, [receiving, token, chatId]);

  const connect = async () => {
    setError("");
    setStatus("");
    if (!looksLikeToken(token)) {
      setError("Токен не похож на токен Telegram-бота. Скопируйте его из @BotFather.");
      return;
    }
    setBusy(true);
    try {
      const info = await getMe(token);
      setBot(info);
      setStatus(`Бот подключён: @${info.username ?? info.first_name}`);
    } catch (caught) {
      setBot(null);
      setError(caught instanceof Error ? caught.message : "Не удалось подключиться");
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setError("");
    setStatus("");
    if (!bot) {
      setError("Сначала подключите бота.");
      return;
    }
    if (!chatId.trim()) {
      setError("Нужен идентификатор вашего чата: напишите боту любое сообщение, затем узнайте его идентификатор.");
      return;
    }
    setBusy(true);
    try {
      await sendMessage(token, chatId, "Амадеус на связи. Это тестовое сообщение.");
      setStatus("Тестовое сообщение отправлено.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось отправить");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="workshop__pane">
      <header className="workshop__head">
        <div>
          <span className="hud-label">удалённое управление</span>
          <h1>Telegram</h1>
          <p>Собственный бот и идентификатор чата. Команды выполняются на этом компьютере, пока приложение открыто.</p>
        </div>
      </header>

      <div className="tg-grid">
        <label className="w-field">
          <span>Токен бота</span>
          <input
            type="password"
            value={token}
            autoComplete="off"
            onChange={(event) => setToken(event.target.value)}
            placeholder="123456789:AA..."
          />
          <small>Токен хранится только в памяти вкладки. В полной версии приложения его можно хранить в защищённом хранилище операционной системы.</small>
        </label>
        <label className="w-field">
          <span>Ваш идентификатор чата</span>
          <input
            value={chatId}
            onChange={(event) => setChatId(event.target.value)}
            placeholder="123456789"
          />
          <small>Бот принимает команды только из этого чата.</small>
        </label>
      </div>

      <div className="tg-actions">
        <button type="button" className="w-btn w-btn--primary" onClick={() => void connect()} disabled={busy}>
          Подключить
        </button>
        <button type="button" className="w-btn" onClick={() => void test()} disabled={busy}>
          Отправить тест
        </button>
        <label className="w-switch w-switch--labeled">
          <input
            type="checkbox"
            checked={receiving}
            disabled={!bot || !chatId}
            onChange={(event) => {
              setError("");
              setReceiving(event.target.checked);
            }}
          />
          <span />
          <em>Принимать команды</em>
        </label>
      </div>

      {status && <p className="w-result">{status}</p>}
      {error && (
        <p className="w-error" role="alert">
          {error}
        </p>
      )}
      {!bot && !error && (
        <p className="w-note">
          Откройте @BotFather в Telegram, создайте бота и вставьте токен. Затем напишите своему боту
          любое сообщение и укажите идентификатор чата.
        </p>
      )}
      {receiving && <p className="w-note">Слушаю Telegram. Приём работает, пока окно приложения открыто.</p>}
      {log.length > 0 && (
        <div className="tg-log">
          <span className="hud-label">последние сообщения</span>
          {log.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function AvatarTab({ avatar, onAvatar }: { avatar: AvatarMode; onAvatar: (mode: AvatarMode) => void }) {
  return (
    <div className="workshop__pane">
      <header className="workshop__head">
        <div>
          <span className="hud-label">внешность</span>
          <h1>Аватар</h1>
          <p>Что показывать в свёрнутом окошке. Состояния и кодовое слово работают одинаково.</p>
        </div>
      </header>

      <div className="avatar-options">
        <div
          role="button"
          tabIndex={0}
          className={`avatar-option ${avatar === "core" ? "avatar-option--active" : ""}`}
          onClick={() => onAvatar("core")}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onAvatar("core");
            }
          }}
          aria-pressed={avatar === "core"}
        >
          <div className="avatar-option__preview">
            <CoreMark state="listening" size={88} />
          </div>
          <strong>Ядро</strong>
          <span>Наш логотип: ядро и две орбиты. Думает — орбиты вращаются, говорит — латунная пульсирует, ядро дышит от голоса.</span>
        </div>

        <div
          role="button"
          tabIndex={0}
          className={`avatar-option ${avatar === "sphere" ? "avatar-option--active" : ""}`}
          onClick={() => onAvatar("sphere")}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onAvatar("sphere");
            }
          }}
          aria-pressed={avatar === "sphere"}
        >
          <div className="avatar-option__preview">
            <ParticleSphere state="listening" size={88} />
          </div>
          <strong>Сфера</strong>
          <span>Облако светящихся точек: вращается, дышит от голоса и меняет цвет по состоянию.</span>
        </div>
      </div>

      <p className="w-note">
        Оба варианта нарисованы с нуля. Позже сюда можно добавить загрузку собственной модели.
      </p>

      <MiniSettings />
    </div>
  );
}

/** Окошко: поверх всех окон, последняя фраза, сброс положения. */
function MiniSettings() {
  const [prefs, setPrefs] = useState<MiniPrefs>(loadMiniPrefs);
  const [resetNote, setResetNote] = useState("");
  const inShell = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  const update = (patch: Partial<MiniPrefs>) =>
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      saveMiniPrefs(next);
      return next;
    });

  return (
    <section className="mini-settings" aria-label="Окошко">
      <h2>Окошко</h2>
      <label className="mini-settings__row">
        <span>
          <strong>Поверх всех окон</strong>
          <small>Окошко не прячется за другими программами.</small>
        </span>
        <input
          type="checkbox"
          checked={prefs.onTop}
          disabled={!inShell}
          aria-label="Окошко поверх всех окон"
          onChange={(event) => update({ onTop: event.target.checked })}
        />
      </label>
      <label className="mini-settings__row">
        <span>
          <strong>Показывать последнюю фразу</strong>
          <small>Под статусом видно, что вы сказали и что ответил Amadeus.</small>
        </span>
        <input
          type="checkbox"
          checked={prefs.showCaption}
          aria-label="Показывать последнюю фразу"
          onChange={(event) => update({ showCaption: event.target.checked })}
        />
      </label>
      <div className="mini-settings__row">
        <span>
          <strong>Положение окошка</strong>
          <small>{resetNote || "Окошко запоминает, куда вы его перетащили."}</small>
        </span>
        <button
          type="button"
          className="w-btn"
          disabled={!inShell}
          onClick={() =>
            void shell
              .resetMiniPosition()
              .then((ok) => setResetNote(ok ? "Готово: в следующий раз окошко встанет в правый нижний угол." : "Не получилось сбросить положение."))
          }
        >
          Вернуть в угол
        </button>
      </div>
      {!inShell && <p className="w-note">Поверх окон и положение работают в установленном приложении.</p>}
    </section>
  );
}
