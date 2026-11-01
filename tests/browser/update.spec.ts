// WEB2: update button. Serves a copy of the production build, then swaps in a second "build" and taps Update.
import { test, expect, chromium, type Browser } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveChromium } from "./harness/chromium-path.js";

const PORT = 25732;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const root = new URL("../../", import.meta.url).pathname;
const dist = join(root, "apps/client/dist");
let child: ChildProcess | null = null, out = "", browser: Browser, served = "";

test.beforeAll(async () => {
  expect(existsSync(join(dist, "sw.js")), "run pnpm build first").toBe(true);
  served = mkdtempSync(join(tmpdir(), "eb-web2-static-"));
  cpSync(dist, served, { recursive: true });
  child = spawn(join(root, "apps/server/node_modules/.bin/tsx"), ["src/main.ts"], {
    cwd: join(root, "apps/server"),
    env: { ...process.env, NODE_ENV: "production", HOST: "127.0.0.1", PORT: String(PORT), PUBLIC_ORIGIN: ORIGIN, EB_ALLOW_HTTP_ORIGIN: "1", DATA_DIR: mkdtempSync(join(tmpdir(), "eb-web2-")), STATIC_DIR: served, BUILD_ID: "web2-local" },
  });
  child.stdout?.on("data", (d: Buffer) => { out += d.toString(); });
  child.stderr?.on("data", (d: Buffer) => { out += d.toString(); });
  const t0 = Date.now();
  while (!out.includes("server listening")) {
    if (Date.now() - t0 > 20000) throw new Error("server did not start: " + out);
    await new Promise((r) => setTimeout(r, 50));
  }
  browser = await chromium.launch({ executablePath: resolveChromium() });
});
test.afterAll(async () => {
  await browser?.close();
  if (child) { const c = child; const ex = new Promise((r) => c.once("exit", r)); c.kill("SIGTERM"); await ex; }
});

test("no button for the same build; a second build shows Update, a tap reloads onto it", async () => {
  const page = await (await browser.newContext()).newPage();
  await page.goto(ORIGIN + "/");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await expect(page.locator('button[data-act="play"]')).toBeVisible();
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForTimeout(500);
  await expect(page.locator('button[data-act="update"]')).toHaveCount(0);

  // Second build: new asset list and a new worker stamp.
  writeFileSync(join(served, "assets/web2-next.js"), "// next build\n");
  writeFileSync(join(served, "asset-manifest.json"), JSON.stringify({ buildId: "web2-next", assets: ["/assets/web2-next.js"] }) + "\n");
  writeFileSync(join(served, "sw.js"), readFileSync(join(served, "sw.js"), "utf8").replace(/const BUILD_ID = "[^"]*"/, 'const BUILD_ID = "web2-next"'));

  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  const btn = page.locator('button[data-act="update"]');
  await expect(btn).toBeVisible({ timeout: 15000 });

  await Promise.all([page.waitForEvent("framenavigated", { timeout: 15000 }), btn.click()]);
  await page.waitForLoadState("load");
  // Old worker's cache is deleted only when the new worker activates, so this proves the swap happened.
  await expect.poll(() => page.evaluate(() => caches.keys()), { timeout: 10000 }).toEqual(["eb-shell-web2-next"]);
});
