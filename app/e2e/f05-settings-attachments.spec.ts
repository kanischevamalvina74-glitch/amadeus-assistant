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

  test("S08-H5 звуковая подпись событий отключается", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Ядро в сети")).toBeVisible();
    await page.getByRole("button", { name: "Настройки" }).click();
    const dialog = page.getByRole("dialog", { name: "Настройки" });
    const toggle = dialog.getByLabel("Звуковая подпись событий");
    await toggle.uncheck();
    await expect(page.evaluate(() => localStorage.getItem("amadeus.sound"))).resolves.toBe("off");
    await toggle.check();
    await expect(page.evaluate(() => localStorage.getItem("amadeus.sound"))).resolves.toBe("on");
  });

  test("S08-H6 запуск в режиме «Сфера» сохраняется", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Ядро в сети")).toBeVisible();
    await page.getByRole("button", { name: "Настройки" }).click();
    const dialog = page.getByRole("dialog", { name: "Настройки" });
    await dialog.getByLabel("Запускать в режиме Сфера").check();
    await dialog.getByRole("button", { name: "Закрыть настройки" }).click();

    await page.reload();
    await expect(page.locator(".hud-scene")).toBeVisible();
    await expect(page.getByRole("log", { name: "История сообщений" })).toHaveCount(0);

    await page.getByRole("button", { name: "Другие действия" }).click();
    await page.getByRole("menuitem", { name: "Чат" }).click();
    await page.getByRole("button", { name: "Настройки" }).click();
    const again = page.getByRole("dialog", { name: "Настройки" });
    await again.getByLabel("Запускать в режиме Сфера").uncheck();
  });

  test("F06-H2 выделение области экрана", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("SQLite · локальное хранилище")).toBeVisible();
    await page.getByRole("button", { name: "Добавить" }).click();
    await page.getByRole("menuitem", { name: "Область экрана" }).click();
    const dialog = page.getByRole("dialog", { name: "Выделение области экрана" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Отмена" }).click();
    await expect(dialog).toHaveCount(0);
  });

  test("S08-H4 палитра Ctrl+K", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Ядро в сети")).toBeVisible();
    await page.keyboard.press("Control+k");
    const palette = page.getByRole("dialog", { name: "Палитра команд" });
    await expect(palette).toBeVisible();
    await palette.getByRole("textbox", { name: "Поиск по палитре" }).fill("Настройки");
    await palette.getByRole("textbox", { name: "Поиск по палитре" }).press("Enter");
    await expect(page.getByRole("dialog", { name: "Настройки" })).toBeVisible();
  });

  test("S08-H3 сменить акцент оформления", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("SQLite · локальное хранилище")).toBeVisible();
    await page.getByRole("button", { name: "Настройки" }).click();
    const dialog = page.getByRole("dialog", { name: "Настройки" });
    await dialog.getByLabel("Акцент").selectOption("brass");
    await expect(page.locator("html")).toHaveAttribute("data-accent", "brass");
    await dialog.getByLabel("Акцент").selectOption("cyan");
    await expect(page.locator("html")).toHaveAttribute("data-accent", "cyan");
    await dialog.getByRole("button", { name: "Закрыть настройки" }).click();
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
