// FX1 exit check: hitting the practice dummy draws pooled particles and flashes the victim. Same harness as flow.spec.ts: real Colyseus server in-process, real client
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
const outDir = path.join(root, "docs/test-results");
const req = createRequire(path.join(root, "apps/client/package.json"));
const CHROMIUM = process.env["EB_CHROMIUM"] ?? "/opt/pw-browsers/chromium";
const GL_ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];

interface Dev { close(): Promise<void>; listen(): Promise<unknown> }
interface Snap {
  localEntityId: number | null; serverTick: number;
  players: { name: string; kitId: string; action: string; form: string; x: number; z: number; local: boolean; kills: number; deaths: number; meter100: number; hp100: number; flashing: boolean }[];
  practice: { step: number } | null;
  fx: { active: number; effects: number };
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
    dataDir: mkdtempSync(path.join(tmpdir(), "eb-pw-fx1-")), allowedOrigins: [base], secureCookies: false,
    roomCodes: { flow: "arena", practice: "practice" }, buildId: "test", sessionsPerMinute: 10_000,
  });
  game = createGameServer(svc);
  await game.listen(gamePort, undefined, undefined);
  const target = `http://127.0.0.1:${gamePort}`;
  const v = req("vite") as { createServer(c: unknown): Promise<Dev> };
  vite = await v.createServer({
    root: path.join(root, "apps/client"), configFile: false, logLevel: "error",
    server: {
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
  writeFileSync(path.join(outDir, "FX1-playwright.json"), JSON.stringify(evidence, null, 2));
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
const step = async (p: Page): Promise<number> => (await snap(p)).practice?.step ?? -1;
const hold = async (p: Page, code: string, ms: number): Promise<void> => { await p.keyboard.down(code); await sleep(ms); await p.keyboard.up(code); };
const localIdle = (p: Page) => until(async () => (await snap(p)).players.find((q) => q.local)?.action === "Idle", 8000, "local idle");

test("Practice: hitting the dummy draws pooled particles and flashes the victim within 2 frames", async () => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  try {
    await page.goto(`${base}/?room=flow&debug=1&name=Arel&kit=sv#invite=${svc.invites.create({ ttlMs: 120_000, maxUses: 1 }).token}`);
    await page.waitForSelector("[data-act=practice]");
    await page.click("[data-act=practice]");
    await page.click("[data-act=ready]");
    await page.waitForFunction(() => (window as unknown as { __eb?: unknown }).__eb !== undefined, undefined, { timeout: 30_000 });
    await until(async () => (await snap(page)).players.some((q) => q.local && q.action === "Idle") || null, 15_000, "ready");
    // In page recorder: on every animation frame note the effects counter and whether the dummy is flashing, and
    // count the frames between the first new effect and the first flashing frame.
    await page.evaluate(() => {
      const w = window as unknown as { __eb: { snapshot(): Snap }; __fxRec: { frames: number; sinceEffect: number | null; lag: number | null; maxActive: number } };
      const rec = w.__fxRec = { frames: 0, sinceEffect: null, lag: null, maxActive: 0 };
      let lastEffects = 0;
      const tick = (): void => {
        const s = w.__eb.snapshot();
        rec.frames++;
        rec.maxActive = Math.max(rec.maxActive, s.fx.active);
        if (s.fx.effects > lastEffects) { lastEffects = s.fx.effects; rec.sinceEffect = 0; }
        else if (rec.sinceEffect !== null) rec.sinceEffect++;
        if (rec.sinceEffect !== null && rec.lag === null && s.players.some((p) => !p.local && p.flashing)) rec.lag = rec.sinceEffect;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const atk = (await page.locator("[data-control=attack]").boundingBox())!;
    await page.mouse.move(atk.x + atk.width / 2, atk.y + atk.height / 2);
    const rec = await until(async () => {
      const ps = (await snap(page)).players;
      const me = ps.find((q) => q.local)!, dummy = ps.find((q) => !q.local)!;
      if (Math.hypot(me.x - dummy.x, me.z - dummy.z) > 1.8) { await page.keyboard.down("KeyW"); await sleep(250); await page.keyboard.up("KeyW"); return null; }
      await page.mouse.down(); await sleep(200); await page.mouse.up(); await sleep(300);
      const r = await page.evaluate(() => (window as unknown as { __fxRec: { lag: number | null; maxActive: number; frames: number } }).__fxRec);
      return r.lag !== null && r.maxActive > 0 ? r : null;
    }, 60_000, "dummy hit shows particles and flash");
    evidence["rec"] = rec;
    expect(rec.maxActive).toBeGreaterThan(0);
    expect(rec.lag).toBeLessThanOrEqual(2);
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
});
