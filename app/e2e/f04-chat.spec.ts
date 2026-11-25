import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const ANSWER = "Ответ тестовой модели Ollama.";

async function openWorkspace(page: Page) {
  const consoleErrors: string[] = [];
  const serverErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 500) serverErrors.push(`${response.status()} ${response.url()}`);
  });
  await page.goto("/");
  await expect(page.getByText("SQLite · локальное хранилище")).toBeVisible();
  await expect(page.getByText("Ядро в сети")).toBeVisible();
  return { consoleErrors, serverErrors };
}

function assertNoErrors(errors: { consoleErrors: string[]; serverErrors: string[] }) {
  expect(errors.consoleErrors).toEqual([]);
  expect(errors.serverErrors).toEqual([]);
}

test.describe("F04 текстовая беседа с контекстом", () => {
  test("S03-H1 телеметрия скрыта и открывается Ctrl+.", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Ядро в сети")).toBeVisible();
    const panel = page.getByRole("complementary", { name: "Телеметрия" });
    await expect(panel).toHaveCount(0);
    await page.keyboard.press("Control+.");
    await expect(panel).toBeVisible();
    await page.keyboard.press("Control+.");
    await expect(panel).toHaveCount(0);
  });

  test("S02-H1 режим фокуса убирает боковые панели", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Ядро в сети")).toBeVisible();
    await page.getByRole("button", { name: "Фокус" }).click();
    await expect(page.getByRole("complementary", { name: "История диалогов" })).toHaveCount(0);
    await page.getByRole("button", { name: "Выйти" }).click();
    await expect(page.getByRole("complementary", { name: "История диалогов" })).toBeVisible();
  });

  test("F04-H1 Send → стриминговый ответ → история", async ({ page }) => {
    const errors = await openWorkspace(page);
    const input = page.getByRole("textbox", { name: "Сообщение" });
    await input.fill("Привет, это проверка чата");
    await input.press("Enter");

    await expect(page.getByText("Привет, это проверка чата").first()).toBeVisible();
    await expect(page.getByText(ANSWER).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("status", { name: "Состояние ядра" })).toContainText("готов");
    assertNoErrors(errors);

    const a11y = await new AxeBuilder({ page }).analyze();
    expect(a11y.violations).toEqual([]);
  });

  test("F04-E1 двойная отправка создаёт одно сообщение", async ({ page }) => {
    const errors = await openWorkspace(page);
    const uniqueText = `Двойная отправка ${Date.now()}`;
    const input = page.getByRole("textbox", { name: "Сообщение" });
    const send = page.getByRole("button", { name: "Отправить" });
    await input.fill(uniqueText);
    await Promise.all([send.click(), send.click()]);
    await expect(page.getByText(ANSWER).first()).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("article", { name: "Сообщение: вы" }).filter({ hasText: uniqueText }),
    ).toHaveCount(1);
    assertNoErrors(errors);
  });

  test("F04-E2 пустой ввод ничего не отправляет", async ({ page }) => {
    await openWorkspace(page);
    const before = await page.getByRole("article", { name: /Сообщение:/ }).count();
    await page.getByRole("button", { name: "Отправить" }).click();
    await expect(page.getByRole("article", { name: /Сообщение:/ })).toHaveCount(before);
  });

  test("F04-E3 ответ сохраняется после перезагрузки", async ({ page }) => {
    await openWorkspace(page);
    const input = page.getByRole("textbox", { name: "Сообщение" });
    await input.fill("Запомни меня — проверка истории");
    await input.press("Enter");
    await expect(page.getByText(ANSWER).first()).toBeVisible({ timeout: 15_000 });

    await page.reload();
    await expect(page.getByText("SQLite · локальное хранилище")).toBeVisible();
    await expect(page.getByText("Запомни меня — проверка истории").first()).toBeVisible();
    await expect(page.getByText(ANSWER).first()).toBeVisible();
  });
});
