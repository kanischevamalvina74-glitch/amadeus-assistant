import { useCallback, useEffect, useState } from "react";
import {
  control,
  shell,
  toTime,
  type ActionItem,
  type MemoryItem,
  type Permission,
  type PluginItem,
  type Reminder,
  type TaskItem,
} from "../lib/api";
import "./control.css";

type Tab = "reminders" | "permissions" | "memory" | "plugins" | "activity";

const SCOPE_LABEL: Record<string, string> = {
  observe_screen: "Наблюдение за экраном",
  find_elements: "Поиск элементов",
  move_mouse: "Движение мыши",
  click: "Клики и выбор",
  type: "Ввод текста",
  system: "Система и питание",
  apps: "Запуск приложений",
  files: "Файлы проекта",
  terminal: "Терминал",
  web: "Веб и ссылки",
};

const MODE_LABEL: Record<string, string> = {
  ask: "Спрашивать",
  approve: "Подтверждать",
  full: "Разрешить",
  denied: "Запретить",
};

export function ControlCenter({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("reminders");
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [memory, setMemory] = useState<MemoryItem[]>([]);
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [plugins, setPlugins] = useState<PluginItem[]>([]);
  const [pluginValues, setPluginValues] = useState<Record<string, unknown>>({});
  const [selectedPlugin, setSelectedPlugin] = useState<string | null>(null);
  const [pluginResult, setPluginResult] = useState("");
  const [pluginLoading, setPluginLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3500);
  }, []);

  const run = useCallback(
    async (work: () => Promise<void>) => {
      try {
        setError("");
        await work();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Не удалось выполнить действие");
      }
    },
    [],
  );

  const load = useCallback(async () => {
    await run(async () => {
      if (tab === "permissions") setPermissions(await control.permissions());
      if (tab === "reminders") {
        const [nextReminders, nextTasks] = await Promise.all([control.reminders(), control.tasks()]);
        setReminders(nextReminders);
        setTasks(nextTasks);
      }
      if (tab === "memory") setMemory(await control.memory(query));
      if (tab === "activity") setActions(await control.actions());
      if (tab === "plugins") {
        const list = await control.plugins();
        setPlugins(list);
        const current = list.find((item) => item.id === selectedPlugin) ?? list[0] ?? null;
        setSelectedPlugin(current?.id ?? null);
        if (current) setPluginValues((await control.pluginConfig(current.id)).values);
      }
    });
  }, [tab, query, selectedPlugin, run]);

  useEffect(() => {
    void load();
  }, [load]);

  const addReminder = () => {
    if (!title.trim() || !due) return;
    const dueAt = new Date(due).toISOString();
    void run(async () => {
      await control.createReminder(title.trim(), dueAt);
      setTitle("");
      setDue("");
      notify("Напоминание создано");
      await load();
    });
  };

  const addTask = () => {
    if (!title.trim()) return;
    void run(async () => {
      await control.addTask(title.trim());
      setTitle("");
      notify("Задача добавлена");
      await load();
    });
  };

  return (
    <div className="center-overlay" role="dialog" aria-modal="true" aria-label="Центр управления">
      <div className="center">
        <div className="center-head">
          <div>
            <h1>Центр управления</h1>
            <p>Разрешения, напоминания, задачи и память — всё на этом компьютере.</p>
          </div>
          <button type="button" className="center-close" onClick={onClose} aria-label="Закрыть центр управления">
            ×
          </button>
        </div>

        <div className="center-tabs" role="tablist" aria-label="Разделы">
          {(
            [
              ["reminders", "Напоминания"],
              ["permissions", "Разрешения"],
              ["memory", "Память"],
              ["plugins", "Плагины"],
              ["activity", "Журнал"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={tab === id ? "is-active" : ""}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {error && <p className="center-error" role="alert">{error}</p>}

        <div className="center-body" role="tabpanel" tabIndex={0}>
          {tab === "reminders" && (
            <>
              <section aria-labelledby="new-reminder">
                <h2 id="new-reminder">Новое напоминание</h2>
                <div className="center-form">
                  <label>
                    Что напомнить
                    <input
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      placeholder="Например, позвонить в команду"
                      maxLength={200}
                    />
                  </label>
                  <label>
                    Когда
                    <input type="datetime-local" value={due} onChange={(event) => setDue(event.target.value)} />
                  </label>
                  <button type="button" className="center-primary" onClick={addReminder} disabled={!title.trim() || !due}>
                    Создать
                  </button>
                </div>
              </section>

              <section aria-labelledby="reminder-list">
                <h2 id="reminder-list">Запланировано</h2>
                {reminders.length === 0 ? (
                  <p className="center-empty">Пока нет напоминаний. Добавьте первое выше.</p>
                ) : (
                  <ul className="center-list">
                    {reminders.map((item) => (
                      <li key={item.id}>
                        <span className="center-item-title">{item.title}</span>
                        <span className="center-item-meta">{new Date(item.due_at).toLocaleString("ru-RU")} · {item.status}</span>
                        <button
                          type="button"
                          onClick={() => void run(async () => {
                            await control.deleteReminder(item.id);
                            notify("Напоминание удалено");
                            await load();
                          })}
                          aria-label={`Удалить напоминание ${item.title}`}
                        >
                          Удалить
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section aria-labelledby="task-list">
                <h2 id="task-list">Задачи</h2>
                <div className="center-form">
                  <label>
                    Новая задача
                    <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Что сделать" maxLength={200} />
                  </label>
                  <button type="button" className="center-primary" onClick={addTask} disabled={!title.trim()}>
                    Добавить
                  </button>
                </div>
                {tasks.length === 0 ? (
                  <p className="center-empty">Список задач пуст.</p>
                ) : (
                  <ul className="center-list">
                    {tasks.map((item) => (
                      <li key={item.id}>
                        <span className="center-item-title">{item.title}</span>
                        <span className="center-item-meta">{item.status} · {item.priority}</span>
                        <button
                          type="button"
                          onClick={() => void run(async () => {
                            await control.deleteTask(item.id);
                            await load();
                          })}
                          aria-label={`Удалить задачу ${item.title}`}
                        >
                          Удалить
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}

          {tab === "permissions" && (
            <section aria-labelledby="perm-list">
              <h2 id="perm-list">Пять разрешений на управление компьютером</h2>
              <p className="center-hint">«Разрешить» действует только на безопасные действия. Опасные действия всегда требуют подтверждения.</p>
              <ul className="center-list">
                {permissions.map((item) => (
                  <li key={item.id}>
                    <span className="center-item-title">{SCOPE_LABEL[item.scope] ?? item.scope}</span>
                    <label className="center-inline">
                      Режим
                      <select
                        value={item.mode}
                        onChange={(event) => void run(async () => {
                          await control.setPermission(item.scope, event.target.value);
                          notify("Разрешение обновлено");
                          await load();
                        })}
                      >
                        {Object.entries(MODE_LABEL).map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {tab === "memory" && (
            <section aria-labelledby="memory-list">
              <h2 id="memory-list">Факты и саммари</h2>
              <div className="center-form">
                <label>
                  Поиск по памяти
                  <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Слово или фраза" />
                </label>
                <label>
                  Запомнить
                  <input
                    id="new-memory"
                    placeholder="Новый факт"
                    maxLength={2000}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return;
                      const input = event.currentTarget;
                      if (!input.value.trim()) return;
                      void run(async () => {
                        await control.addMemory(input.value.trim());
                        input.value = "";
                        notify("Факт сохранён");
                        await load();
                      });
                    }}
                  />
                </label>
              </div>
              {memory.length === 0 ? (
                <p className="center-empty">В памяти пока пусто.</p>
              ) : (
                <ul className="center-list">
                  {memory.map((item) => (
                    <li key={item.id}>
                      <span className="center-item-title">{item.text}</span>
                      <span className="center-item-meta">{item.kind} · {toTime(item.created_at)}</span>
                      <button
                        type="button"
                        onClick={() => void run(async () => {
                          await control.forgetMemory(item.id);
                          notify("Запись забыта");
                          await load();
                        })}
                        aria-label={`Забыть факт: ${item.text.slice(0, 40)}`}
                      >
                        Забыть
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {tab === "plugins" && (
            <section aria-labelledby="plugin-list">
              <h2 id="plugin-list">Своя экосистема плагинов</h2>
              <p className="center-hint">
                Плагины описаны манифестом: разрешения, настройки и действия. Исполняемый код появится вместе с изолированным процессом.
              </p>
              {plugins.length === 0 ? (
                <p className="center-empty">Плагинов пока нет.</p>
              ) : (
                <>
                  <ul className="center-list">
                    {plugins.map((item) => (
                      <li key={item.id}>
                        <span className="center-item-title">
                          {item.name} <small>v{item.version}</small>
                        </span>
                        <span className="center-item-meta">{item.permissions.join(", ") || "без разрешений"}</span>
                        <label className="center-inline">
                          Включён
                          <input
                            type="checkbox"
                            checked={item.enabled}
                            aria-label={`Включить плагин ${item.name}`}
                            onChange={(event) => void run(async () => {
                              await control.togglePlugin(item.id, event.target.checked);
                              notify("Плагин обновлён");
                              await load();
                            })}
                          />
                        </label>
                        <button type="button" onClick={() => {
                          setSelectedPlugin(item.id);
                          setPluginLoading(true);
                          void run(async () => {
                            setPluginValues((await control.pluginConfig(item.id)).values);
                            setPluginResult("");
                            setPluginLoading(false);
                          });
                        }}>
                          Настроить
                        </button>
                      </li>
                    ))}
                  </ul>

                  {selectedPlugin && (
                    <div className="plugin-config">
                      <h3>Настройки плагина</h3>
                      {(plugins.find((item) => item.id === selectedPlugin)?.config_schema ?? []).map((field) => (
                        <label key={field.key} className="plugin-field">
                          {field.label}
                          {field.type === "boolean" ? (
                            <input
                              type="checkbox"
                              checked={Boolean(pluginValues[field.key])}
                              disabled={pluginLoading}
                              onChange={(event) => setPluginValues((prev) => ({ ...prev, [field.key]: event.target.checked }))}
                            />
                          ) : (
                            <input
                              value={String(pluginValues[field.key] ?? "")}
                              disabled={pluginLoading}
                              onChange={(event) => setPluginValues((prev) => ({ ...prev, [field.key]: event.target.value }))}
                            />
                          )}
                        </label>
                      ))}
                      <div className="center-actions">
                        <button type="button" className="center-primary" disabled={pluginLoading} onClick={() => void run(async () => {
                          await control.savePluginConfig(selectedPlugin, pluginValues);
                          notify("Настройки сохранены");
                        })}>
                          Сохранить
                        </button>
                        <button type="button" onClick={() => void run(async () => {
                          const result = await control.testPlugin(selectedPlugin);
                          setPluginResult(result.message);
                        })}>
                          Тест плагина
                        </button>
                      </div>
                      {pluginResult && <p className="center-hint" role="status">{pluginResult}</p>}
                    </div>
                  )}
                </>
              )}
            </section>
          )}

          {tab === "activity" && (
            <section aria-labelledby="activity-list">
              <h2 id="activity-list">Действия ассистента</h2>
              {actions.length === 0 ? (
                <p className="center-empty">Действий пока не было.</p>
              ) : (
                <ul className="center-list">
                  {actions.map((item) => (
                    <li key={item.id}>
                      <span className="center-item-title">{item.tool_name}</span>
                      <span className="center-item-meta">
                        {item.risk_level} · {item.status} · {toTime(item.created_at)}
                      </span>
                      {item.status === "proposed" && (
                        <span className="center-actions">
                          <button
                            type="button"
                            onClick={() => void run(async () => {
                              const result = await control.approve(item.id);
                              if (result.ok && item.tool_name === "notify") {
                                const args = JSON.parse(item.args_json) as { text?: string };
                                await shell.notify("Амадеус", args.text ?? "Уведомление");
                              }
                              notify(result.message);
                              await load();
                            })}
                            aria-label={`Подтвердить действие ${item.tool_name}`}
                          >
                            Подтвердить
                          </button>
                          <button
                            type="button"
                            onClick={() => void run(async () => {
                              await control.deny(item.id);
                              notify("Действие отклонено");
                              await load();
                            })}
                            aria-label={`Отклонить действие ${item.tool_name}`}
                          >
                            Отклонить
                          </button>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>

        {toast && <div className="center-toast" role="status" aria-live="polite">{toast}</div>}
      </div>
    </div>
  );
}
