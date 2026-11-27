import { loadMiniPrefs } from "./preferences";
import { invoke } from "@tauri-apps/api/core";

/** Клиент локального ядра (HTTP-зеркало Tauri IPC). При недоступности ядра UI работает в демо-режиме. */

/** Доказательство моста: реальный вызов нативной команды, если UI работает в оболочке Tauri. */
export async function shellHealth(): Promise<{ status: string; shell: string; version: string } | null> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return null;
  try {
    return await invoke<{ status: string; shell: string; version: string }>("app_health");
  } catch {
    return null;
  }
}

export type BackendConversation = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

export type BackendMessage = {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  text: string;
  status: string;
  error: string | null;
  created_at: string;
};

const TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
export const backendOrigin = TAURI ? "http://127.0.0.1:8787" : "";
const BASE = `${backendOrigin}/api`;
export const wsUrl = (path: string): string =>
  TAURI
    ? `ws://127.0.0.1:8787${path}`
    : `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}${path}`;

async function request<T>(path: string, init?: RequestInit, timeout = 4000): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(`${BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
    if (!response.ok) throw new Error(`Ядро: HTTP ${response.status}`);
    return (await response.json()) as T;
  } finally {
    window.clearTimeout(timer);
  }
}

/** Ядро может подниматься дольше UI: делаем несколько попыток перед демо-режимом. */
export async function waitForBackend(attempts = 3): Promise<void> {
  for (let i = 0; i < attempts; i += 1) {
    try {
      await api.health();
      return;
    } catch {
      if (i === attempts - 1) throw new Error("Ядро не отвечает");
      await new Promise((resolve) => window.setTimeout(resolve, 800));
    }
  }
}

/** Нативные команды доступны только внутри оболочки Tauri. */
export const shell = {
  async startBackend(): Promise<string | null> {
    if (!TAURI) return null;
    try {
      return await invoke<string>("start_backend");
    } catch {
      return null;
    }
  },

  async notify(title: string, body: string): Promise<boolean> {
    if (!("__TAURI_INTERNALS__" in window)) return false;
    try {
      await invoke("notify_os", { title, body });
      return true;
    } catch {
      return false;
    }
  },

  async captureScreen(): Promise<AttachmentPayload | null> {
    if (!("__TAURI_INTERNALS__" in window)) return null;
    try {
      const base64 = await invoke<string>("capture_screen_base64");
      const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
      return {
        name: `screenshot-${Date.now()}.png`,
        mime: "image/png",
        size: Math.floor((base64.length * 3) / 4) - padding,
        content_base64: base64,
      };
    } catch {
      return null;
    }
  },

  async hideWindow(): Promise<void> {
    if (!("__TAURI_INTERNALS__" in window)) return;
    await invoke("window_hide").catch(() => undefined);
  },

  async showWindow(): Promise<void> {
    if (!("__TAURI_INTERNALS__" in window)) return;
    await invoke("window_show").catch(() => undefined);
  },

  /** Свёрнутый режим: маленькое прозрачное окно без рамки поверх всех. false — окно перестроить не удалось. */
  async setMiniWindow(enabled: boolean): Promise<boolean> {
    if (!("__TAURI_INTERNALS__" in window)) return true;
    try {
      await invoke("window_mini", { enabled, onTop: loadMiniPrefs().onTop });
      return true;
    } catch (error) {
      console.warn("window_mini", enabled, error);
      return false;
    }
  },

  /** Забыть место окошка: в следующий раз оно встанет в правый нижний угол. */
  async resetMiniPosition(): Promise<boolean> {
    if (!("__TAURI_INTERNALS__" in window)) return false;
    try {
      await invoke("window_mini_reset_position");
      return true;
    } catch {
      return false;
    }
  },

  /** «—» в окошке: убрать на панель задач. */
  async minimizeMini(): Promise<void> {
    if (!("__TAURI_INTERNALS__" in window)) return;
    await invoke("window_mini_minimize").catch(() => undefined);
  },

  async setFullscreen(enabled: boolean): Promise<void> {
    if ("__TAURI_INTERNALS__" in window) {
      await invoke("window_fullscreen", { enabled }).catch(() => undefined);
      return;
    }
    try {
      if (enabled && !document.fullscreenElement) await document.documentElement.requestFullscreen();
      if (!enabled && document.fullscreenElement) await document.exitFullscreen();
    } catch {
      // браузер может запретить полноэкранный режим без жеста пользователя
    }
  },
};

export const api = {
  async health(): Promise<{ status: string; version: string }> {
    return request("/health", undefined, 1500);
  },

  async setupStatus(): Promise<{ needsSetup: boolean; locale: string; mode: string }> {
    return request("/setup.status");
  },

  async setupComplete(locale: string, mode: string): Promise<void> {
    await request("/setup.complete", {
      method: "POST",
      body: JSON.stringify({ locale, mode }),
    });
  },

  async conversations(): Promise<BackendConversation[]> {
    return request("/conversations.list");
  },

  async createConversation(title = "Новый диалог"): Promise<{ id: string }> {
    return request("/conversations.create", { method: "POST", body: JSON.stringify({ title }) });
  },

  async messages(conversationId: string): Promise<BackendMessage[]> {
    return request(`/messages.list?conversation_id=${encodeURIComponent(conversationId)}`);
  },

  async send(conversationId: string, text: string): Promise<{ messageId: string; text: string }> {
    return request(
      "/messages.send",
      { method: "POST", body: JSON.stringify({ conversation_id: conversationId, text }) },
      120_000,
    );
  },

  async metrics(): Promise<unknown> {
    return request("/system.metrics", undefined, 4000);
  },

  async volume(body: { level?: number; delta?: number; mute?: boolean }): Promise<{ ok: boolean; level: number }> {
    return request("/system.volume", { method: "POST", body: JSON.stringify(body) });
  },

  async power(body: { action: string; confirm: string }): Promise<{ ok: boolean; message: string }> {
    return request("/system.power", { method: "POST", body: JSON.stringify(body) });
  },

  async powerCancel(): Promise<{ ok: boolean; message: string }> {
    return request("/system.powerCancel", { method: "POST", body: JSON.stringify({}) });
  },

  async openApp(target: string): Promise<{ ok: boolean; message: string }> {
    return request("/system.open", { method: "POST", body: JSON.stringify({ target }) });
  },

  async clipboard(): Promise<{ text: string }> {
    return request("/system.clipboard");
  },

  async screenshot(body?: { region?: number[] }): Promise<{ mime: string; size: number; content_base64: string }> {
    return request("/system.screenshot", { method: "POST", body: JSON.stringify(body ?? {}) });
  },

  async workspaceGet(): Promise<{ root: string | null; name: string | null; allow_write: boolean }> {
    return request("/workspace.get");
  },

  async workspaceSet(path: string, allowWrite: boolean): Promise<unknown> {
    return request("/workspace.set", { method: "POST", body: JSON.stringify({ path, allow_write: allowWrite }) });
  },

  async workspacePatch(allowWrite: boolean): Promise<unknown> {
    return request("/workspace.patch", { method: "POST", body: JSON.stringify({ allow_write: allowWrite }) });
  },

  async workspaceTree(): Promise<{ root: string; entries: Array<{ path: string; kind: string; size: number; text: boolean }> }> {
    return request("/workspace.tree");
  },

  async workspaceRead(path: string): Promise<{ text: string; encoding: string; size: number }> {
    return request("/workspace.read", { method: "POST", body: JSON.stringify({ path }) });
  },

  async workspaceWrite(path: string, text: string): Promise<unknown> {
    return request("/workspace.write", { method: "POST", body: JSON.stringify({ path, text }) });
  },

  async workspaceCreate(path: string, text = ""): Promise<unknown> {
    return request("/workspace.create", { method: "POST", body: JSON.stringify({ path, text }) });
  },

  async workspaceMove(source: string, target: string): Promise<unknown> {
    return request("/workspace.move", { method: "POST", body: JSON.stringify({ source, target }) });
  },

  async workspaceOpen(path: string): Promise<unknown> {
    return request("/workspace.open", { method: "POST", body: JSON.stringify({ path }) });
  },

  async workspaceRun(command: string, timeout = 30): Promise<unknown> {
    return request("/workspace.run", { method: "POST", body: JSON.stringify({ command, timeout }) });
  },

  async workspaceSearch(query: string): Promise<Array<{ path: string; line: number; preview: string }>> {
    return request(`/workspace.search?q=${encodeURIComponent(query)}`);
  },

  async webStatus(): Promise<{ provider: string; searx_url: string; has_brave_key: boolean }> {
    return request("/web.status");
  },

  async webSearch(query: string, count = 5): Promise<{ query: string; results: Array<{ title: string; url: string; description: string; provider: string }> }> {
    return request("/web.search", { method: "POST", body: JSON.stringify({ query, count }) });
  },

  async webFetch(url: string): Promise<{ url: string; title: string; text: string }> {
    return request(`/web.fetch?url=${encodeURIComponent(url)}`);
  },

  async settingsIndex(query = ""): Promise<Array<{ key: string; title: string; category: string }>> {
    return request(`/settings.index${query ? `?q=${encodeURIComponent(query)}` : ""}`);
  },

  async settingsExport(): Promise<{
    format: string;
    version: number;
    exported_at: string;
    profile: Record<string, unknown>;
    settings: Record<string, unknown>;
  }> {
    return request("/settings.export");
  },

  async settingsImport(data: { format?: string; version?: number; exported_at?: string; profile?: Record<string, unknown>; settings: Record<string, unknown> }): Promise<{ ok: boolean; applied: number }> {
    return request("/settings.import", { method: "POST", body: JSON.stringify({ data }) });
  },

  async modelsList(baseUrl?: string): Promise<{ ollama: string[]; error: string | null; active: Record<string, unknown> }> {
    const query = baseUrl ? `?base_url=${encodeURIComponent(baseUrl)}` : "";
    return request(`/models.list${query}`);
  },

  async modelsActivate(providerId: string, modelId: string, baseUrl?: string): Promise<{ ok: boolean; provider_id: string; model_id: string }> {
    return request("/providers.activate", {
      method: "POST",
      body: JSON.stringify({ provider_id: providerId, model_id: modelId, base_url: baseUrl ?? undefined }),
    });
  },

  async voiceVoices(): Promise<{ voices: Array<{ id: string; name: string; locale: string }>; piper: Record<string, unknown> }> {
    return request("/voice.voices");
  },

  async voiceSelect(voiceId: string): Promise<{ ok: boolean }> {
    return request("/voice.select", { method: "POST", body: JSON.stringify({ voice_id: voiceId }) });
  },

  async memorySummarize(conversationId: string): Promise<{ id: string; text: string }> {
    return request("/memory.summarize", { method: "POST", body: JSON.stringify({ conversation_id: conversationId }) });
  },

  async updatesStatus(): Promise<{
    current_version: string;
    manifest_url: string;
    channel: string;
    state: {
      current_version: string;
      available_version: string | null;
      last_checked_at: string | null;
      download_status: string;
      install_status: string;
    } | null;
  }> {
    return request("/updates.status");
  },

  async updatesCheck(body: { manifest_url: string; channel?: string }): Promise<Record<string, unknown>> {
    return request("/updates.check", { method: "POST", body: JSON.stringify(body) });
  },

  async updatesDownload(body: { url: string; sha256: string }): Promise<{ ok: boolean; file: string }> {
    return request("/updates.download", { method: "POST", body: JSON.stringify(body) });
  },

  async updatesInstall(): Promise<{ ok: boolean; message: string; path: string }> {
    return request("/updates.install", { method: "POST", body: JSON.stringify({}) });
  },

  async updatesCleanup(): Promise<{ ok: boolean }> {
    return request("/updates.cleanup", { method: "POST", body: JSON.stringify({}) });
  },

  async lockStatus(): Promise<{ enabled: boolean; failed_attempts: number; locked_until: string | null }> {
    return request("/lock.status");
  },

  async lockSet(pin: string): Promise<{ ok: boolean }> {
    return request("/lock.set", { method: "POST", body: JSON.stringify({ pin }) });
  },

  async lockVerify(pin: string): Promise<{ ok: boolean }> {
    return request("/lock.verify", { method: "POST", body: JSON.stringify({ pin }) });
  },
};

/** SSE-стриминг ответа с сохранением в SQLite. */
export async function streamAnswer(
  conversationId: string,
  text: string,
  onDelta: (chunk: string) => void,
  signal?: AbortSignal,
  attachments: AttachmentPayload[] = [],
): Promise<string> {
  const withFiles = attachments.length > 0;
  const params = new URLSearchParams({ conversation_id: conversationId, text });
  const response = withFiles
    ? await fetch(`${BASE}/v1/chat/stream`, {
        method: "POST",
        signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_id: conversationId, text, attachments }),
      })
    : await fetch(`${BASE}/v1/chat/stream?${params.toString()}`, { signal });
  if (!response.ok || !response.body) throw new Error(`Ядро: HTTP ${response.status}`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let answer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const event = frame.match(/^event: (.+)$/m)?.[1] ?? "message";
      const raw = frame.match(/^data: (.+)$/m)?.[1];
      if (raw) {
        const data = JSON.parse(raw) as { delta?: string; text?: string; message?: string };
        if (event === "delta" && data.delta) {
          answer += data.delta;
          onDelta(data.delta);
        }
        if (event === "done") answer = data.text ?? answer;
        if (event === "error") throw new Error(data.message ?? "Ошибка ядра");
        if (event === "canceled") return answer;
      }
      boundary = buffer.indexOf("\n\n");
    }
  }
  return answer;
}

export type AttachmentPayload = {
  name: string;
  mime: string;
  size: number;
  content_base64: string;
};

export const prefs = {
  get: (keys?: string[]) =>
    request<Record<string, unknown>>(`/settings.get${keys ? `?keys=${keys.join(",")}` : ""}`),
  patch: (patch: Record<string, unknown>) =>
    request<{ ok: boolean; requiresRestart: boolean }>("/settings.patch", {
      method: "POST",
      body: JSON.stringify({ patch }),
    }),
  setLocale: (locale: string) =>
    request<{ ok: boolean }>("/settings.locale", {
      method: "POST",
      body: JSON.stringify({ locale }),
    }),
  providers: () => request<Array<{ id: string; stage: string; provider_id: string; model_id: string | null; is_active: boolean; builtin: boolean }>>("/providers.list"),
  applyProvider: (mode: string) =>
    request<{ ok: boolean; reconnected: boolean }>("/providers.apply", {
      method: "POST",
      body: JSON.stringify({ mode }),
    }),
  setCredential: (providerId: string, secret: string) =>
    request<{ secretRef: string }>("/credentials.set", {
      method: "POST",
      body: JSON.stringify({ provider_id: providerId, secret }),
    }),
  testCredential: (providerId: string) =>
    request<{ ok: boolean; code: string; message: string }>("/credentials.test", {
      method: "POST",
      body: JSON.stringify({ provider_id: providerId }),
    }),
};

export type Permission = {
  id: string;
  scope: string;
  mode: "ask" | "approve" | "full" | "denied";
  updated_at: string;
};

export type Reminder = {
  id: string;
  title: string;
  due_at: string;
  repeat_rule: string | null;
  status: string;
};

export type TaskItem = {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  due_at: string | null;
};

export type MemoryItem = { id: string; kind: string; text: string; created_at: string };

export type PluginItem = {
  id: string;
  name: string;
  version: string;
  description: string;
  permissions: string[];
  config_schema: Array<{ key: string; label: string; type: string; default: string | boolean }>;
  actions: string[];
  enabled: boolean;
  broken_reason: string | null;
};

export type ActionItem = {
  id: string;
  tool_name: string;
  args_json: string;
  risk_level: string;
  permission_scope: string | null;
  status: string;
  error: string | null;
  created_at: string;
};

export const control = {
  permissions: () => request<Permission[]>("/permissions.get"),
  setPermission: (scope: string, mode: string) =>
    request<{ ok: boolean }>("/permissions.patch", {
      method: "POST",
      body: JSON.stringify({ scope, mode }),
    }),

  actions: () => request<ActionItem[]>("/actions.list"),
  propose: (tool: string, args: Record<string, unknown>, risk = "low") =>
    request<{ id: string; status: string; mode: string }>("/actions.propose", {
      method: "POST",
      body: JSON.stringify({ tool, args, risk }),
    }),
  approve: (id: string) =>
    request<{ ok: boolean; message: string }>("/actions.approve", {
      method: "POST",
      body: JSON.stringify({ id }),
    }),
  deny: (id: string) =>
    request<{ ok: boolean }>("/actions.deny", {
      method: "POST",
      body: JSON.stringify({ id }),
    }),

  reminders: () => request<Reminder[]>("/reminders.list"),
  createReminder: (title: string, dueAt: string) =>
    request<{ id: string }>("/reminders.create", {
      method: "POST",
      body: JSON.stringify({ title, due_at: dueAt }),
    }),
  deleteReminder: (id: string) =>
    request<{ ok: boolean }>("/reminders.delete", {
      method: "POST",
      body: JSON.stringify({ id }),
    }),

  tasks: () => request<TaskItem[]>("/tasks.list"),
  addTask: (title: string) =>
    request<{ id: string }>("/tasks.upsert", {
      method: "POST",
      body: JSON.stringify({ title }),
    }),
  deleteTask: (id: string) =>
    request<{ ok: boolean }>("/tasks.delete", {
      method: "POST",
      body: JSON.stringify({ id }),
    }),

  memory: (q = "") => request<MemoryItem[]>(`/memory.search?q=${encodeURIComponent(q)}`),
  addMemory: (text: string) =>
    request<{ id: string }>("/memory.add", {
      method: "POST",
      body: JSON.stringify({ patch: { kind: "fact", text } }),
    }),
  forgetMemory: (id: string) =>
    request<{ ok: boolean }>("/memory.forget", {
      method: "POST",
      body: JSON.stringify({ id }),
    }),

  plugins: () => request<PluginItem[]>("/plugins.list"),
  togglePlugin: (id: string, enabled: boolean) =>
    request<{ ok: boolean }>("/plugins.toggle", {
      method: "POST",
      body: JSON.stringify({ id, enabled }),
    }),
  pluginConfig: (id: string) =>
    request<{ schema: PluginItem["config_schema"]; values: Record<string, unknown> }>(
      `/plugins.config?id=${encodeURIComponent(id)}`,
    ),
  savePluginConfig: (id: string, values: Record<string, unknown>) =>
    request<{ ok: boolean }>("/plugins.saveConfig", {
      method: "POST",
      body: JSON.stringify({ id, values }),
    }),
  testPlugin: (id: string) =>
    request<{ ok: boolean; message: string }>("/plugins.test", {
      method: "POST",
      body: JSON.stringify({ id }),
    }),
};

export const system = {
  metrics: api.metrics,
  volume: api.volume,
  power: api.power,
  powerCancel: api.powerCancel,
  openApp: api.openApp,
  clipboard: api.clipboard,
  screenshot: api.screenshot,
};

export const workspaceApi = {
  get: api.workspaceGet,
  set: api.workspaceSet,
  patch: api.workspacePatch,
  tree: api.workspaceTree,
  read: api.workspaceRead,
  write: api.workspaceWrite,
  create: api.workspaceCreate,
  move: api.workspaceMove,
  open: api.workspaceOpen,
  run: api.workspaceRun,
  search: api.workspaceSearch,
};

export const webApi = {
  status: api.webStatus,
  search: api.webSearch,
  fetch: api.webFetch,
};

export const updatesApi = {
  status: api.updatesStatus,
  check: api.updatesCheck,
  download: api.updatesDownload,
  install: api.updatesInstall,
  cleanup: api.updatesCleanup,
};

export const voiceApi = {
  voices: api.voiceVoices,
  select: api.voiceSelect,
};

export const lockApi = {
  status: api.lockStatus,
  set: api.lockSet,
  verify: api.lockVerify,
};

export const modelsApi = {
  list: api.modelsList,
  activate: api.modelsActivate,
};

export const settingsApi = {
  index: api.settingsIndex,
  export: api.settingsExport,
  import: api.settingsImport,
};

export const memoryApi = {
  summarize: api.memorySummarize,
};

export const toTime = (iso: string | null | undefined): string => {
  if (!iso) return "только что";
  const date = new Date(iso);
  const time = date.getTime();
  if (!Number.isFinite(time)) return "только что";
  const seconds = Math.max(0, (Date.now() - time) / 1000);
  if (seconds < 60) return "только что";
  if (seconds < 86400 && date.toDateString() === new Date().toDateString()) {
    return date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "short" });
};
