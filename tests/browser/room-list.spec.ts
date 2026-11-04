// WEB3: real browser contexts open the room list and join with one tap (arena and listed sparring).
import { test, expect, chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync } from "node:fs";
import { createServer as netServer } from "node:net";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { Server } from "colyseus";
import { createGameServer } from "../../apps/server/src/createServer.js";
import { createAuthServices, type AuthServices } from "../../apps/server/src/auth/Services.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const req = createRequire(path.join(root, "apps/client/package.json"));
interface Dev { close(): Promise<void>; listen(): Promise<unknown> }
interface Snap {
  localEntityId: number | null; serverTick: number;
  players: { entityId: number; name: string; action: string; moveId: string; hp100: number; ready: boolean; kills: number; deaths: number; kitId: string }[];
}
let game: Server, svc: AuthServices, vite: Dev, browser: Browser, base: string;
let now = Date.now();
const freePort = (): Promise<number> => new Promise((resolve, reject) => {
  const s = netServer(); s.on("error", reject);
  s.listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); });
});
test.beforeAll(async () => {
  const gamePort = await freePort(), vitePort = await freePort();
  base = `http://localhost:${vitePort}`;
  svc = createAuthServices({ dataDir: mkdtempSync(path.join(tmpdir(), "eb-web3-")), allowedOrigins: [base], secureCookies: false,
    roomCodes: { play: "arena", practice: "practice" }, buildId: "WEB3", sessionsPerMinute: 10_000, globalSessionsPerMinute: 10_000 }, () => now);
  game = createGameServer(svc); await game.listen(gamePort, undefined, undefined);
  const target = `http://127.0.0.1:${gamePort}`;
  const v = req("vite") as { createServer(c: unknown): Promise<Dev> };
  vite = await v.createServer({ root: path.join(root, "apps/client"), configFile: false, logLevel: "error",
    server: { hmr: false, watch: null, port: vitePort, strictPort: true, host: "127.0.0.1", fs: { strict: false }, proxy: {
      "/api": { target }, "/matchmake": { target }, "^/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+(\\?.*)?$": { target, ws: true },
    } } });
  await vite.listen();
  browser = await chromium.launch({ ...(process.env["EB_CHROMIUM"] ? { executablePath: process.env["EB_CHROMIUM"] } : {}),
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
});
test.afterAll(async () => { await browser?.close(); await vite?.close(); await game?.gracefullyShutdown(false); });
const snap = (p: Page): Promise<Snap> => p.evaluate(() => (window as unknown as { __eb: { snapshot(): Snap } }).__eb.snapshot());
const button = (p: Page, name: string) => p.getByRole("button", { name, exact: true });
async function open(): Promise<{ ctx: BrowserContext; page: Page; errors: string[] }> {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  // Clipboard denial exercises the selectable fallback using the real link route. Secrets stay in memory.
  await ctx.addInitScript(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("fixture denied"); } } }));
  const page = await ctx.newPage(), errors: string[] = [];
  page.on("pageerror", e => errors.push(String(e)));
  return { ctx, page, errors };
}
async function invited(name: string): Promise<{ ctx: BrowserContext; page: Page; errors: string[] }> {
  const h = await open();
  const invite = svc.invites.create({ ttlMs: 120_000, maxUses: 1 }).token;
  await h.page.goto(`${base}/?debug=1&name=${name}#invite=${invite}`);
  return h;
}
const ready = (p: Page) => p.locator("[data-act=ready]");

test("one tap joins an arena room from the list; the list closes and Back returns", async () => {
  const a = await invited("Arel");
  try {
    await button(a.page, "Find a room").click();
    const row = a.page.locator("[data-join=play]");
    await expect(row).toBeVisible();
    await expect(a.page.getByText("Play: 0 of 4 players")).toBeVisible();
    expect(await a.page.locator("[data-join=practice]").count()).toBe(0);
    await row.click();
    await expect(ready(a.page)).toBeVisible();
    await expect(a.page.locator("[data-ui=room-list]")).toHaveCount(0);
    expect(a.errors).toEqual([]);
  } finally { await a.ctx.close(); }
});

test("a listed hosted match appears for another player and joins with one tap; an unlisted one does not", async () => {
  const h = await invited("Host");
  const g = await invited("Nora");
  try {
    await button(h.page, "Fight bots").click();
    const created = h.page.waitForResponse(r => new URL(r.url()).pathname === "/api/sparring" && r.request().method() === "POST");
    await h.page.getByLabel("List this match for other players").check();
    await button(h.page, "Start match").click();
    const code = (await (await created).json() as { roomCode: string }).roomCode;
    await expect.poll(async () => h.page.evaluate(() => !!(window as unknown as { __eb?: unknown }).__eb)).toBe(true);
    await button(g.page, "Find a room").click();
    const row = g.page.locator(`[data-join="${code}"]`);
    await expect(row).toBeVisible({ timeout: 15000 });
    await expect(row).toBeEnabled();
    // No bearer or id appears in the page text for the listed row.
    expect(await g.page.locator("[data-ui=room-list]").innerText()).not.toContain(code);
    await row.click();
    // QP01: the guest's first join loads the renderer chunk (many unbundled modules under the Vite dev server), so allow for it.
    await expect(ready(g.page)).toBeVisible({ timeout: 30_000 });
    expect(g.errors).toEqual([]);
  } finally { await h.ctx.close(); await g.ctx.close(); }
});

test("an unlisted hosted match is not shown", async () => {
  const h = await invited("Host2");
  const g = await invited("Nora2");
  try {
    await button(h.page, "Fight bots").click();
    const created = h.page.waitForResponse(r => new URL(r.url()).pathname === "/api/sparring" && r.request().method() === "POST");
    await button(h.page, "Start match").click();
    const code = (await (await created).json() as { roomCode: string }).roomCode;
    await expect.poll(async () => h.page.evaluate(() => !!(window as unknown as { __eb?: unknown }).__eb)).toBe(true);
    await button(g.page, "Find a room").click();
    await expect(g.page.locator("[data-join=play]")).toBeVisible();
    expect(await g.page.locator(`[data-join="${code}"]`).count()).toBe(0);
  } finally { await h.ctx.close(); await g.ctx.close(); }
});
