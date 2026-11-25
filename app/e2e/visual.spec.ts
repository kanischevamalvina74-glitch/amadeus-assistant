import { expect, test } from "@playwright/test";

/** Снимки обеих тем на трёх ширинах — артефакты приходят в CI. */
for (const theme of ["dark", "light"] as const) {
  for (const width of [1440, 1024, 820]) {
    test(`S24-${theme}-${width} снимок интерфейса`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript((value) => localStorage.setItem("amadeus.themeMode", value), theme);
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      await expect(page.getByText("Ядро в сети")).toBeVisible();
      await page.screenshot({ path: `test-results/visual-${theme}-${width}.png` });
      expect(errors).toEqual([]);
    });
  }
}
