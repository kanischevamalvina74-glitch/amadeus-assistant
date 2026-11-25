const env = import.meta.env as Record<string, string | undefined>;

/** Можно переопределить через .env: VITE_OLLAMA_MODEL и VITE_OLLAMA_LABEL. */
export const OLLAMA_MODEL =
  env.VITE_OLLAMA_MODEL ?? "hf.co/nvidia/NVIDIA-Nemotron-3.5-Bolt-E4B-4GB:Q4_K_M";
export const OLLAMA_LABEL = env.VITE_OLLAMA_LABEL ?? "Nemotron 3.5 Bolt · Q4_K_M";

/** В dev-режиме запросы идут через Vite-прокси, чтобы не упираться в CORS. */
const BASE = "/ollama";

export type ModelState = {
  checked: boolean;
  online: boolean;
  hasModel: boolean;
  models: string[];
  error?: string;
};

export type ChatRole = "system" | "user" | "assistant";
export type ChatTurn = { role: ChatRole; content: string };

export const SYSTEM_PROMPT =
  "Ты — Амадеус, локальный голосовой ассистент на компьютере пользователя. " +
  "Отвечай по-русски, кратко и по делу. Не используй markdown-таблицы без просьбы. " +
  "Если данных не хватает, скажи об этом прямо и не выдумывай доступ к файлам или системам.";

export async function checkModel(): Promise<ModelState> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(`${BASE}/api/tags`, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = (await response.json()) as { models?: Array<{ name: string }> };
    const models = (data.models ?? []).map((item) => item.name);
    return {
      checked: true,
      online: true,
      hasModel: models.includes(OLLAMA_MODEL),
      models,
    };
  } catch (error) {
    return {
      checked: true,
      online: false,
      hasModel: false,
      models: [],
      error: error instanceof Error ? error.message : "Ollama не отвечает",
    };
  } finally {
    window.clearTimeout(timer);
  }
}

async function* readLines(response: Response): AsyncGenerator<string> {
  if (!response.body) throw new Error("Ollama вернула пустой поток");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) yield line;
      newline = buffer.indexOf("\n");
    }
  }
  if (buffer.trim()) yield buffer.trim();
}

export async function* chatStream(
  turns: ChatTurn[],
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const response = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...turns],
      stream: true,
      options: { temperature: 0.55, num_ctx: 8192 },
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Ollama: HTTP ${response.status}${detail ? ` — ${detail.slice(0, 200)}` : ""}`);
  }

  for await (const line of readLines(response)) {
    try {
      const chunk = JSON.parse(line) as {
        message?: { content?: string; thinking?: string };
        error?: string;
        done?: boolean;
      };
      if (chunk.error) throw new Error(chunk.error);
      if (chunk.message?.content) yield chunk.message.content;
      if (chunk.done) return;
    } catch (error) {
      if (error instanceof SyntaxError) continue;
      throw error;
    }
  }
}

export async function chatOnce(turns: ChatTurn[], signal?: AbortSignal): Promise<string> {
  let text = "";
  for await (const chunk of chatStream(turns, signal)) text += chunk;
  return text.trim();
}
