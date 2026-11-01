// WEB1: installable shell. Runs the real production server against apps/client/dist (run `pnpm build` first).
import { test, expect, chromium, type Browser } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveChromium } from "./harness/chromium-path.js";

const PORT = 25731;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const root = new URL("../../", import.meta.url).pathname;
const dist = join(root, "apps/client/dist");
let child: ChildProcess | null = null, out = "", browser: Browser;

async function stopServer(): Promise<void> {
  if (!child) return;
  const c = child; child = null;
  const exited = new Promise((r) => c.once("exit", r));
  c.kill("SIGTERM");
  await exited;
}

test.beforeAll(async () => {
  expect(existsSync(join(dist, "sw.js")), "run pnpm build first").toBe(true);
  child = spawn(join(root, "apps/server/node_modules/.bin/tsx"), ["src/main.ts"], {
    cwd: join(root, "apps/server"),
    env: { ...process.env, NODE_ENV: "production", HOST: "127.0.0.1", PORT: String(PORT), PUBLIC_ORIGIN: ORIGIN, EB_ALLOW_HTTP_ORIGIN: "1", DATA_DIR: mkdtempSync(join(tmpdir(), "eb-web1-")), STATIC_DIR: dist, BUILD_ID: "web1-local" },
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
test.afterAll(async () => { await browser?.close(); await stopServer(); });

test("manifest is linked and valid, headers are right, worker registers, offline reload works, api is never cached", async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const cspViolations: string[] = [];
  page.on("console", (m) => { if (/Content Security Policy/i.test(m.text()) && /worker|manifest|script-src|connect-src/i.test(m.text())) cspViolations.push(m.text()); });
  await page.goto(ORIGIN + "/");

  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(href).toBe("/manifest.webmanifest");
  const mres = await page.request.get(ORIGIN + href!);
  expect(mres.headers()["content-type"]).toContain("application/manifest+json");
  expect(mres.headers()["cache-control"]).toBe("no-cache");
  const m = await mres.json();
  expect(m).toMatchObject({ name: "Elemental Battlegrounds", short_name: "Battlegrounds", display: "fullscreen", orientation: "landscape", start_url: "/", scope: "/" });
  for (const i of m.icons as { src: string }[]) expect((await page.request.get(ORIGIN + i.src)).status()).toBe(200);
  expect(await page.locator('link[rel="apple-touch-icon"]').getAttribute("href")).toBe("/icons/icon-180.png");
  expect(await page.locator('meta[name="apple-mobile-web-app-capable"]').getAttribute("content")).toBe("yes");
  expect(await page.locator('meta[name="viewport"]').getAttribute("content")).toContain("viewport-fit=cover");

  const sw = await page.request.get(ORIGIN + "/sw.js");
  expect(sw.headers()["service-worker-allowed"]).toBe("/");
  expect(sw.headers()["cache-control"]).toBe("no-cache");
  expect(sw.headers()["content-type"]).toContain("javascript");
  expect(await sw.text()).not.toContain("__BUILD_ID__");

  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  const online = await page.evaluate(async () => (await fetch("/api/version")).json());
  expect(online.buildId).toBe("web1-local");
  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) urls.push(new URL(r.url).pathname);
    return urls;
  });
  expect(cached.some((u) => u.startsWith("/assets/"))).toBe(true);
  expect(cached.some((u) => u.startsWith("/api/") || u === "/healthz")).toBe(false);

  await stopServer();
  await page.reload();
  await expect(page.locator("body")).toBeVisible();
  expect(await page.title()).toBe("Elemental Battlegrounds");
  const offlineApi = await page.evaluate(async () => { try { await fetch("/api/version"); return "answered"; } catch { return "failed"; } });
  expect(offlineApi).toBe("failed");
  expect(cspViolations).toEqual([]);
  await ctx.close();
});
