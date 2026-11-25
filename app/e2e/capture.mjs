import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "clone-screens");
mkdirSync(dir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://127.0.0.1:5173/");
await page.getByText("SQLite · локальное хранилище").waitFor({ timeout: 10_000 });
await page.waitForTimeout(800);
await page.screenshot({ path: resolve(dir, "S02_workspace.png") });

await page.getByRole("button", { name: "Свернуть" }).click();
await page.getByLabel("Свёрнутый режим Амадеуса").waitFor();
await page.waitForTimeout(400);
await page.screenshot({ path: resolve(dir, "S27_mini.png") });

await browser.close();
console.log("Скриншоты сохранены в replica/clone-screens/");
