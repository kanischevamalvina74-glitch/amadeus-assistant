import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function openCenter(page: Page) {
  const serverErrors: string[] = [];
  page.on("response", (response) => {
    if (response.status() >= 500) serverErrors.push(`${response.status()} ${response.url()}`);
  });
  await page.goto("/");
  await expect(page.getByText("SQLite · локальное хранилище")).toBeVisible();
  await page.getByRole("button", { name: /Центр управления/ }).click();
  const dialog = page.getByRole("dialog", { name: "Центр управления" });
  await expect(dialog).toBeVisible();
  return { dialog, serverErrors };
}

test.describe("F10/F15/F17 Центр управления", () => {
  test("F10-H1 создать и удалить напоминание", async ({ page }) => {
    const { dialog, serverErrors } = await openCenter(page);
    const title = `Позвонить ${Date.now()}`;
    await dialog.getByLabel("Что напомнить").fill(title);
    await dialog.getByLabel("Когда").fill("2030-01-01T10:00");
    await dialog.getByRole("button", { name: "Создать" }).click();
    await expect(dialog.getByText(title)).toBeVisible();
    await expect(dialog.getByRole("status")).toContainText("Напоминание создано");
    await dialog.getByRole("button", { name: `Удалить напоминание ${title}` }).click();
    await expect(dialog.getByText(title)).toHaveCount(0);
    expect(serverErrors).toEqual([]);
  });

  test("F17-H1 сменить режим разрешения", async ({ page }) => {
    const { dialog } = await openCenter(page);
    await dialog.getByRole("tab", { name: "Разрешения" }).click();
    const row = dialog.locator("li").filter({ hasText: "Клики и выбор" });
    await row.getByLabel("Режим").selectOption("full");
    await expect(dialog.getByRole("status")).toContainText("Разрешение обновлено");
    await expect(row.getByLabel("Режим")).toHaveValue("full");
    await row.getByLabel("Режим").selectOption("ask");
  });

  test("F15-H1 запомнить, найти и забыть факт", async ({ page }) => {
    const { dialog } = await openCenter(page);
    await dialog.getByRole("tab", { name: "Память" }).click();
    const word = `персиковый${Date.now()}`;
    await dialog.getByLabel("Запомнить").fill(`Пользователь упомянул ${word}`);
    await dialog.getByLabel("Запомнить").press("Enter");
    await expect(dialog.getByText(`Пользователь упомянул ${word}`)).toBeVisible();
    await dialog.getByLabel("Поиск по памяти").fill(word);
    await expect(dialog.getByText(`Пользователь упомянул ${word}`)).toBeVisible();
    await dialog.getByRole("button", { name: new RegExp(`Забыть факт:`) }).first().click();
    await expect(dialog.getByText(`Пользователь упомянул ${word}`)).toHaveCount(0);
  });

  test("F07-H1 подтвердить действие и проверить доступность", async ({ page }) => {
    const { dialog, serverErrors } = await openCenter(page);
    const proposed = await page.request.post("/api/actions.propose", {
      data: { tool: "notify", args: { text: "проверка" }, risk: "low" },
    });
    expect(proposed.ok()).toBeTruthy();
    await dialog.getByRole("tab", { name: "Журнал" }).click();
    const row = dialog.locator("li").filter({ hasText: "notify" }).first();
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: /Подтвердить действие/ }).click();
    await expect(dialog.getByRole("status")).toContainText("Уведомление записано");

    const a11y = await new AxeBuilder({ page }).analyze();
    expect(a11y.violations).toEqual([]);
    expect(serverErrors).toEqual([]);
  });
});
