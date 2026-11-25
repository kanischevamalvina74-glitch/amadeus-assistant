import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe("F01 первый запуск", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.request.post("/api/settings.patch", {
      data: { patch: { "setup.completed": false, "app.locale": "ru" } },
    });
    await page.request.post("/api/settings.locale", { data: { locale: "ru" } });
  });

  test.afterEach(async ({ page }) => {
    await page.request.post("/api/settings.patch", {
      data: { patch: { "setup.completed": true, "app.locale": "ru" } },
    });
    await page.request.post("/api/settings.locale", { data: { locale: "ru" } });
    await page.request.post("/api/providers.apply", { data: { mode: "local" } });
  });

  test("F01-H1 выбор языка, режима и ключа", async ({ page }) => {
    await page.reload();
    const setup = page.getByRole("dialog", { name: "Первый запуск" });
    await expect(setup).toBeVisible();

    await setup.getByRole("radio", { name: "English" }).click();
    await setup.getByRole("radio", { name: /Облачный адаптер/ }).click();
    await setup.getByLabel("Ключ провайдера").fill("e2e-only-key");
    await setup.getByRole("button", { name: "Начать работу" }).click();

    await expect(setup).toHaveCount(0);
    await expect(page.getByText("SQLite · локальное хранилище")).toBeVisible();

    const status = await page.request.get("/api/setup.status");
    const data = await status.json();
    expect(data.needsSetup).toBe(false);
    expect(data.locale).toBe("en");
    expect(data.mode).toBe("cloud");

    const a11y = await new AxeBuilder({ page }).analyze();
    expect(a11y.violations).toEqual([]);
  });

  test("F01-E1 локальный режим без ключа", async ({ page }) => {
    await page.reload();
    const setup = page.getByRole("dialog", { name: "Первый запуск" });
    await expect(setup).toBeVisible();
    await setup.getByRole("radio", { name: /Локальный пайплайн/ }).click();
    await setup.getByRole("button", { name: "Начать работу" }).click();
    await expect(setup).toHaveCount(0);
    await expect(page.getByText("SQLite · локальное хранилище")).toBeVisible();
  });
});
