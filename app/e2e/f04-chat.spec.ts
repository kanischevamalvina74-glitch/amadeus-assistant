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

  test("S01-H4 узкое окно сохраняет поле ввода и меню шапки", async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 900 });
    await page.goto("/");
    await expect(page.getByText("Ядро в сети")).toBeVisible();
    const box = await page.locator(".composer").boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(600);
    await page.getByRole("button", { name: "Другие действия" }).click();
    await expect(page.getByRole("menuitem", { name: "Сфера" })).toBeVisible();
  });

  test("S02-H2 режим «Сфера» оставляет только ядро", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Ядро в сети")).toBeVisible();
    await page.getByRole("button", { name: "Сфера", exact: true }).click();
    await expect(page.getByRole("log", { name: "История сообщений" })).toHaveCount(0);
    await expect(page.locator(".hud-scene")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Сообщение" })).toBeVisible();
    await expect(page.locator(".sphere-subtitle")).toBeVisible();
    await page.getByRole("button", { name: "Чат", exact: true }).click();
    await expect(page.getByRole("log", { name: "История сообщений" })).toBeVisible();
  });

  test("F04-H5 подсказки и редактирование последнего сообщения", async ({ page }) => {
    await page.route("**/api/messages.list*", (route) => route.fulfill({ json: [] }));
    await page.goto("/");
    await expect(page.getByText("Ядро в сети")).toBeVisible();
    const input = page.getByRole("textbox", { name: "Сообщение" });
    await page.getByRole("button", { name: "Что у меня сегодня?" }).click();
    await expect(input).toHaveValue("Что у меня сегодня?");
    await input.press("Enter");
    await expect(input).toHaveValue("");
    await input.press("ArrowUp");
    await expect(input).not.toHaveValue("");
    await input.press("Shift+Enter");
    await expect(input).toHaveValue(/\n/);
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

  test("F04-E4 ошибка 404 показывает причину под сферой", async ({ page }) => {
    await page.route("**/api/v1/chat/stream*", (route) => route.fulfill({ status: 404, body: "model not found" }));
    await page.goto("/");
    await expect(page.getByText("Ядро в сети")).toBeVisible();
    const input = page.getByRole("textbox", { name: "Сообщение" });
    await input.fill("проверка ошибки");
    await input.press("Enter");
    await page.locator(".hud-status-button").first().click();
    const reason = page.locator(".hud-error");
    await expect(reason).toContainText("Модель не скачана");
    await expect(reason.getByRole("button", { name: "Скачать" })).toBeVisible();
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
