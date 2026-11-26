import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function collapse(page: Page) {
  await page.goto("/");
  await expect(page.getByText("SQLite · локальное хранилище")).toBeVisible();
  await page.getByRole("button", { name: "Другие действия" }).click();
  await page.getByRole("menuitem", { name: "Свернуть" }).click();
  await expect(page.getByLabel("Свёрнутый режим Amadeus")).toBeVisible();
}

test.describe("F21 кодовая фраза и свёрнутый режим", () => {
  test("F21-H1 свернуть и вернуть окно по клику", async ({ page }) => {
    await collapse(page);
    await page.getByRole("button", { name: /Открыть окно/ }).click();
    await expect(page.getByText("SQLite · локальное хранилище")).toBeVisible();

    const a11y = await new AxeBuilder({ page }).analyze();
    expect(a11y.violations).toEqual([]);
  });

  test("F21-H3 окошко: статус капсом и кнопка «Развернуть»", async ({ page }) => {
    await collapse(page);
    await expect(page.locator(".mini-card__status")).toHaveText("Жду");
    await expect(page.locator(".mini-card .core-mark")).toBeVisible();
    await page.getByRole("button", { name: "Развернуть" }).click();
    await expect(page.getByText("SQLite · локальное хранилище")).toBeVisible();
  });

  test("F21-H4 аватар «Сфера» в окошке", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("amadeus.avatar", "sphere"));
    await collapse(page);
    await expect(page.locator(".mini-card canvas")).toBeVisible();
    await expect(page.locator(".mini-card .core-mark")).toHaveCount(0);
  });

  test("F21-H5 старый аватар «character» становится ядром", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("amadeus.avatar", "character"));
    await collapse(page);
    await expect(page.locator(".mini-card .core-mark")).toBeVisible();
  });

  test("F21-H2 активация клавишей W и голосовая команда", async ({ page }) => {
    await collapse(page);
    const caption = page.getByRole("status", { name: "Подпись состояния" });
    await page.keyboard.press("w");
    await expect(caption).toHaveText("Слушаю — говорите команду");
    await page.keyboard.press("w");
    await expect(caption).toContainText("открой отчёт по проекту");
    await expect(caption).toContainText("Ответ тестовой модели Ollama", { timeout: 15_000 });
  });

  test("F03-H2 push-to-talk удержанием пробела", async ({ page }) => {
    await collapse(page);
    const caption = page.getByRole("status", { name: "Подпись состояния" });
    await page.keyboard.down("Space");
    await expect(caption).toHaveText("Говорите — отпустите пробел");
    await page.keyboard.up("Space");
    await expect(caption).toContainText("Готов", { timeout: 5000 });
  });

  test("F03-H1 текстовая команда через WS /ws/voice", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("SQLite · локальное хранилище")).toBeVisible();

    const events = await page.evaluate(async () => {
      const ws = new WebSocket("ws://127.0.0.1:5173/ws/voice");
      const received: string[] = [];
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error("WS timeout")), 10_000);
        ws.onopen = () => ws.send(JSON.stringify({ type: "text", text: "проверка голосовой сессии" }));
        ws.onmessage = (message) => {
          const data = JSON.parse(String(message.data)) as { event: string };
          received.push(data.event);
          if (data.event === "token") {
            window.clearTimeout(timer);
            resolve();
          }
        };
        ws.onerror = () => {
          window.clearTimeout(timer);
          reject(new Error("WS error"));
        };
      });
      ws.close();
      return received;
    });

    expect(events).toContain("transcript");
    expect(events).toContain("token");
  });

  test("F21-E1 Escape переключает рабочее окно и ядро", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("SQLite · локальное хранилище")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByLabel("Свёрнутый режим Amadeus")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByText("SQLite · локальное хранилище")).toBeVisible();
  });
});
