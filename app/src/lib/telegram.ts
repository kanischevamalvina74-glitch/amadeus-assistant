const BASE = "/telegram";

export type TelegramBot = { id: number; first_name: string; username?: string };
export type TelegramUpdate = {
  update_id: number;
  message?: {
    chat: { id: number };
    date?: number;
    text?: string;
    from?: { first_name?: string; username?: string };
  };
};

async function call<T>(token: string, method: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}/bot${token}/${method}`, init);
  const data = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    result?: T;
    description?: string;
  };
  if (response.status === 502 || response.status === 504) {
    throw new Error("Нет связи с Telegram. Проверьте интернет или VPN: api.telegram.org недоступен.");
  }
  if (!response.ok || !data.ok) {
    throw new Error(data.description || `Telegram: HTTP ${response.status}`);
  }
  return data.result as T;
}

export function looksLikeToken(token: string): boolean {
  return /^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(token.trim());
}

export function getMe(token: string): Promise<TelegramBot> {
  return call<TelegramBot>(token.trim(), "getMe");
}

export function sendMessage(token: string, chatId: string, text: string) {
  return call<{ message_id: number }>(token.trim(), "sendMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId.trim(), text }),
  });
}

export async function getUpdates(token: string, offset: number): Promise<TelegramUpdate[]> {
  return call<TelegramUpdate[]>(
    token.trim(),
    `getUpdates?timeout=20&offset=${offset}&allowed_updates=${encodeURIComponent('["message"]')}`,
  );
}
