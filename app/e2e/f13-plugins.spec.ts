import { expect, test } from "@playwright/test";

test.describe("F13/F16 плагины v1", () => {
  test("манифест, включение, настройки и тест", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("SQLite · локальное хранилище")).toBeVisible();
    await page.getByRole("button", { name: /Центр управления/ }).click();
    const dialog = page.getByRole("dialog", { name: "Центр управления" });
    await dialog.getByRole("tab", { name: "Плагины" }).click();

    await expect(dialog.getByText("demo-note")).toBeVisible();
    await expect(dialog.getByText("memory.read, memory.write")).toBeVisible();

    const toggle = dialog.getByLabel("Включить плагин demo-note");
    if (await toggle.isChecked()) await toggle.click();
    await expect(toggle).not.toBeChecked();
    await toggle.click();
    await expect(toggle).toBeChecked();

    await dialog.getByRole("button", { name: "Настроить" }).click();
    const prefix = dialog.getByLabel("Префикс заметки");
    const prefixValue = `Проверка${Date.now()}`;
    await expect(prefix).toBeEnabled();
    await prefix.fill(prefixValue);
    await dialog.getByRole("button", { name: "Сохранить" }).click();
    await expect(dialog.getByRole("status")).toContainText("Настройки сохранены");

    await dialog.getByRole("button", { name: "Тест плагина" }).click();
    await expect(dialog.getByText(`${prefixValue}: Плагин подключён и настроен`)).toBeVisible();

    await toggle.click();
    await expect(toggle).not.toBeChecked();
  });
});
