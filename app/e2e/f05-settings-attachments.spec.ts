import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe("S08/S15 настройки и F05 вложения", () => {
  test("S08-H1 открыть настройки, сменить тему и язык", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("SQLite · локальное хранилище")).toBeVisible();
    await page.getByRole("button", { name: "Настройки" }).click();
    const dialog = page.getByRole("dialog", { name: "Настройки" });
    await expect(dialog).toBeVisible();

    await dialog.getByLabel("Тема").selectOption("light");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await dialog.getByLabel("Язык интерфейса").selectOption("en");
    await expect(dialog.getByRole("status")).toContainText("Язык сохранён");
    await expect(dialog.getByText("ollama")).toBeVisible();

    const a11y = await new AxeBuilder({ page }).analyze();
    expect(a11y.violations).toEqual([]);

    await dialog.getByLabel("Тема").selectOption("dark");
    await dialog.getByLabel("Язык интерфейса").selectOption("ru");
    await dialog.getByRole("button", { name: "Закрыть настройки" }).click();
    await expect(dialog).toHaveCount(0);
  });

  test("F06-H2 выделение области экрана", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("SQLite · локальное хранилище")).toBeVisible();
    await page.getByRole("button", { name: "Выделить область" }).click();
    const dialog = page.getByRole("dialog", { name: "Выделение области экрана" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Отмена" }).click();
    await expect(dialog).toHaveCount(0);
  });

  test("F05-H1 прикрепить текстовый файл и получить ответ", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("SQLite · локальное хранилище")).toBeVisible();

    const name = `заметка-${Date.now()}.txt`;
    await page.getByLabel("Прикрепить файлы").setInputFiles({
      name,
      mimeType: "text/plain",
      buffer: Buffer.from("Содержимое файла: тестовое вложение для ассистента."),
    });
    await expect(page.getByText(name)).toBeVisible();

    const input = page.getByRole("textbox", { name: "Сообщение" });
    await input.fill("Прочитай вложение");
    await input.press("Enter");

    await expect(page.getByText("Ответ тестовой модели Ollama.").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(name)).toHaveCount(0);
  });

  test("F05-E1 снять вложение перед отправкой", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("SQLite · локальное хранилище")).toBeVisible();
    const name = "лишний.txt";
    await page.getByLabel("Прикрепить файлы").setInputFiles({
      name,
      mimeType: "text/plain",
      buffer: Buffer.from("не отправлять"),
    });
    await expect(page.getByText(name)).toBeVisible();
    await page.getByRole("button", { name: `Убрать вложение ${name}` }).click();
    await expect(page.getByText(name)).toHaveCount(0);
  });
});
