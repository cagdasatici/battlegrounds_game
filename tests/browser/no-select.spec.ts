// FB01: rapid taps on HUD buttons never leave a selection; body is user-select none, real inputs stay selectable.
import { test, expect, chromium, type Browser } from "@playwright/test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { resolveChromium } from "./harness/chromium-path.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const req = createRequire(path.join(root, "apps/client/package.json"));
interface Dev { close(): Promise<void>; listen(): Promise<unknown>; resolvedUrls: { local: string[] } | null }
let server: Dev; let browser: Browser; let base = "";

test.beforeAll(async () => {
  const vite = req("vite") as { createServer(c: unknown): Promise<Dev> };
  server = await vite.createServer({ root: path.join(here, "harness"), configFile: false, server: { hmr: false, watch: null, port: 0, host: "127.0.0.1", fs: { strict: false } }, logLevel: "error" });
  await server.listen();
  base = server.resolvedUrls!.local[0]!;
  browser = await chromium.launch({ executablePath: resolveChromium() });
});
test.afterAll(async () => { await browser?.close(); await server?.close(); });

test("FB01 rapid taps leave no selection; inputs stay selectable", async () => {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  await page.goto(`${base}?fb01=1`);
  await page.waitForFunction(() => (window as unknown as { __layout?: unknown }).__layout !== undefined);
  const css = await page.evaluate(() => ({
    body: getComputedStyle(document.body).userSelect,
    input: getComputedStyle(document.getElementById("fb01-input")!).userSelect,
    ta: getComputedStyle(document.body).touchAction,
  }));
  expect(css.body).toBe("none");
  expect(css.input).toBe("text");
  expect(css.ta).toBe("manipulation");
  const ids = await page.$$eval("[data-control]", (els) => els.map((e) => (e as HTMLElement).dataset["control"]!));
  for (let round = 0; round < 6; round++) {
    for (const id of ids) {
      const l = page.locator(`[data-control="${id}"]`);
      await l.dblclick({ force: true });
      await l.click({ force: true, clickCount: 3 });
    }
  }
  await page.keyboard.press("ControlOrMeta+A");
  await page.evaluate(() => new Promise((r) => setTimeout(r, 50)));
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("");
  // The input is still selectable and editable.
  await page.locator("#fb01-input").click();
  await page.keyboard.press("ControlOrMeta+A");
  expect(await page.evaluate(() => { const i = document.getElementById("fb01-input") as HTMLInputElement; return i.value.substring(i.selectionStart ?? 0, i.selectionEnd ?? 0); })).toBe("Fighter name");
  await page.close();
});
