// GR09 graphics recovery: real practice client, WEBGL_lose_context fixture, input neutralized and recovered. Same harness as flow.spec.ts: real Colyseus server in-process, real client
// served by Vite, same origin, workers 1.
import { test, expect, chromium, type Browser, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer as netServer } from "node:net";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { Server } from "colyseus";
import { createGameServer } from "../../apps/server/src/createServer.js";
import { createAuthServices, type AuthServices } from "../../apps/server/src/auth/Services.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const outDir = evidenceDir(root);
const req = createRequire(path.join(root, "apps/client/package.json"));
import { closeContext } from "./harness/leave.js";
import { resolveChromium } from "./harness/chromium-path.js";
import { evidenceDir } from "./harness/evidence.js";
const CHROMIUM = resolveChromium();
const GL_ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];

interface Dev { close(): Promise<void>; listen(): Promise<unknown> }
interface Snap {
  localEntityId: number | null; serverTick: number;
  players: { name: string; kitId: string; action: string; form: string; x: number; z: number; local: boolean; kills: number; deaths: number; meter100: number; hp100: number }[];
  practice: { step: number; skillMask: number; dummyGuard: boolean; dummyRagdoll: boolean } | null;
}

let game: Server, svc: AuthServices, vite: Dev, browser: Browser;
let base = "";
const evidence: Record<string, unknown> = {};

const freePort = (): Promise<number> => new Promise((resolve, reject) => {
  const s = netServer();
  s.listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); });
  s.on("error", reject);
});

test.beforeAll(async () => {
  const gamePort = await freePort(), vitePort = await freePort();
  base = `http://localhost:${vitePort}`;
  svc = createAuthServices({
    dataDir: mkdtempSync(path.join(tmpdir(), "eb-pw-gr09-")), allowedOrigins: [base], secureCookies: false,
    roomCodes: { flow: "arena", practice: "practice" }, buildId: "test", sessionsPerMinute: 10_000, globalSessionsPerMinute: 10_000,
  });
  game = createGameServer(svc);
  await game.listen(gamePort, undefined, undefined);
  const target = `http://127.0.0.1:${gamePort}`;
  const v = req("vite") as { createServer(c: unknown): Promise<Dev> };
  vite = await v.createServer({
    root: path.join(root, "apps/client"), configFile: false, logLevel: "error",
    server: { hmr: false, watch: null,
      port: vitePort, strictPort: true, host: "127.0.0.1", fs: { strict: false },
      proxy: {
        "/api": { target }, "/matchmake": { target },
        "^/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+(\\?.*)?$": { target, ws: true },
      },
    },
  });
  await vite.listen();
  browser = await chromium.launch({ executablePath: CHROMIUM, args: GL_ARGS });
});
test.afterAll(async () => {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "GR09-playwright.json"), JSON.stringify(evidence, null, 2));
  await browser?.close();
  await vite?.close();
  await game?.gracefullyShutdown(false);
});

const snap = (p: Page): Promise<Snap> => p.evaluate(() => (window as unknown as { __eb: { snapshot(): unknown } }).__eb.snapshot() as never);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(f: () => Promise<T | null | false>, ms: number, what: string): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await f();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timeout: ${what}`);
    await sleep(40);
  }
}
const local = async (p: Page) => (await snap(p)).players.find((q) => q.local)!;
const loseExt = (p: Page, op: "loseContext" | "restoreContext") => p.evaluate((o) => {
  const c = document.querySelector("canvas") as HTMLCanvasElement;
  const w = window as unknown as { __loseExt?: { loseContext(): void; restoreContext(): void } };
  w.__loseExt ??= (c.getContext("webgl2") as WebGL2RenderingContext).getExtension("WEBGL_lose_context") as never;
  w.__loseExt![o]();
}, op);
const banner = (p: Page) => p.locator("[data-ui=graphics-status]");

test("context loss during movement: neutral input and banner; restore keeps the same life and one renderer; three cycles plateau", async () => {
  test.setTimeout(180_000);
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: false });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  try {
    await page.goto(`${base}/?room=flow&debug=1&name=Arel&kit=sv#invite=${svc.invites.create({ ttlMs: 120_000, maxUses: 1 }).token}`);
    await page.waitForSelector("[data-act=practice]");
    await page.click("[data-act=practice]");
    await page.click("[data-act=ready]");
    await page.waitForFunction(() => (window as unknown as { __eb?: unknown }).__eb !== undefined, undefined, { timeout: 30_000 });
    await until(async () => (await local(page)).action === "Idle", 8000, "local idle");
    const cd0 = (await page.evaluate(() => (window as unknown as { __eb: { snapshot(): { players: { local: boolean; cooldownEndTicks: number[] }[] } } }).__eb.snapshot().players.find((q) => q.local)!.cooldownEndTicks));
    const counts: number[] = [];
    for (let cycle = 0; cycle < 3; cycle++) {
      const hpBefore = (await local(page)).hp100;
      await page.keyboard.down("KeyS");
      await sleep(300);
      await loseExt(page, "loseContext");
      await expect(banner(page)).toContainText("Recovering graphics… Your fighter is still in the arena.");
      await sleep(400);
      const frozen = await local(page);
      await sleep(500);
      const after = await local(page);
      expect(Math.hypot(after.x - frozen.x, after.z - frozen.z)).toBeLessThan(0.05); // held S no longer moves the fighter
      await loseExt(page, "restoreContext");
      await expect(banner(page)).toBeHidden({ timeout: 8000 });
      await sleep(500);
      const resumed = await local(page);
      expect(Math.hypot(resumed.x - after.x, resumed.z - after.z)).toBeLessThan(0.05); // still-held S needs a fresh press
      await page.keyboard.up("KeyS");
      expect(resumed.hp100).toBe(hpBefore);
      expect(await page.locator("canvas").count()).toBe(1);
      counts.push((await snap(page) as unknown as { render: { geometries: number } }).render.geometries);
    }
    const cd1 = (await page.evaluate(() => (window as unknown as { __eb: { snapshot(): { players: { local: boolean; cooldownEndTicks: number[] }[] } } }).__eb.snapshot().players.find((q) => q.local)!.cooldownEndTicks));
    expect(cd1).toEqual(cd0); // no old attack replayed
    expect(counts[2]).toBeLessThanOrEqual(counts[1]!);
    evidence["geometries"] = counts;
    // A fresh press moves again.
    const p0 = await local(page);
    await page.keyboard.down("KeyS");
    await until(async () => { const l = await local(page); return Math.hypot(l.x - p0.x, l.z - p0.z) > 0.3 || null; }, 8000, "fresh press moves");
    await page.keyboard.up("KeyS");
    expect(errors).toEqual([]);
  } finally {
    await closeContext(ctx);
  }
});

test("timeout shows Reload and Leave", async () => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const page = await ctx.newPage();
  try {
    await page.goto(`${base}/?room=flow&debug=1&name=Arel&kit=sv#invite=${svc.invites.create({ ttlMs: 120_000, maxUses: 1 }).token}`);
    await page.waitForSelector("[data-act=practice]");
    await page.click("[data-act=practice]");
    await page.click("[data-act=ready]");
    await page.waitForFunction(() => (window as unknown as { __eb?: unknown }).__eb !== undefined, undefined, { timeout: 30_000 });
    await loseExt(page, "loseContext");
    await expect(banner(page)).toContainText("Graphics could not recover.", { timeout: 8000 });
    await expect(page.locator("[data-ui=graphics-reload]")).toBeVisible();
    await expect(page.locator("[data-ui=graphics-leave]")).toBeVisible();
  } finally {
    await closeContext(ctx);
  }
});

test("failed boot after the canvas exists is cleaned up; retry leaves one canvas and no listener growth", async () => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const page = await ctx.newPage();
  try {
    await page.addInitScript(() => {
      const w = window as unknown as { __fails: number; __ctxListeners: number };
      w.__fails = 0; w.__ctxListeners = 0;
      const add = EventTarget.prototype.addEventListener, rem = EventTarget.prototype.removeEventListener;
      EventTarget.prototype.addEventListener = function (this: EventTarget, t: string, ...r: unknown[]) {
        if (t === "webglcontextlost" && this instanceof HTMLCanvasElement) w.__ctxListeners++;
        if (t === "resize" && this === window && new Error().stack?.includes("GameScene") && w.__fails < 2) { w.__fails++; throw new Error("injected scene failure"); }
        return (add as (...a: unknown[]) => void).call(this, t, ...r);
      } as typeof add;
      EventTarget.prototype.removeEventListener = function (this: EventTarget, t: string, ...r: unknown[]) {
        if (t === "webglcontextlost" && this instanceof HTMLCanvasElement) w.__ctxListeners--;
        return (rem as (...a: unknown[]) => void).call(this, t, ...r);
      } as typeof rem;
    });
    await page.goto(`${base}/?room=flow&debug=1&name=Arel&kit=sv#invite=${svc.invites.create({ ttlMs: 120_000, maxUses: 1 }).token}`);
    await page.waitForSelector("[data-act=practice]");
    await page.click("[data-act=practice]");
    const failures = () => page.evaluate(() => (window as unknown as { __fails: number }).__fails);
    for (let seen = 0; seen < 2;) {
      await page.waitForSelector("[data-act=retry]", { timeout: 15_000 });
      if ((await failures()) <= seen) continue; // stale button from the previous attempt
      seen = await failures();
      expect(await page.locator("canvas").count()).toBe(0); // the failed attempt removed its canvas
      await page.click("[data-act=retry]");
    }
    await page.waitForSelector("[data-act=ready]", { timeout: 30_000 }).catch(async (e) => { throw new Error(`${e} :: ${(await page.locator("body").innerText()).slice(0, 400)}`); });
    expect(await page.locator("canvas").count()).toBe(1); // GR12: the lobby preview shares the one game canvas
    const grown = await page.evaluate(() => (window as unknown as { __ctxListeners: number }).__ctxListeners);
    expect(grown).toBeLessThanOrEqual(3); // game renderer (three + lifecycle) and the lobby preview renderer; failed attempts net zero
    evidence["listeners"] = grown;
  } finally {
    await closeContext(ctx);
  }
});
