// GR15a (derived from the T18d harness): Practice from Welcome, a private room with a dummy, every tutorial step confirmed by the server,
// the dummy toggles, and cleanup on Leave. Same harness as flow.spec.ts: real Colyseus server in-process, real client
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
    dataDir: mkdtempSync(path.join(tmpdir(), "eb-pw-practice-")), allowedOrigins: [base], secureCookies: false,
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
  writeFileSync(path.join(outDir, "GR15b-playwright.json"), JSON.stringify(evidence, null, 2));
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
const settings = (hand: "right" | "left"): string => JSON.stringify({ v: 2, sensitivity: 1, cameraDistance: 6.5, facingLock: false, quickUse: true, autoRun: false, handedness: hand, effectsVolume: 0.8, musicVolume: 0.5, quality: "medium", reducedMotion: hand === "left", flashLevel: 0.3, damageNumbers: true, combatText: "all", layouts: { wide: { opacity: 0.9, controls: {} }, compact: { opacity: 0.9, controls: {} } } });

for (const vp of [{ width: 1024, height: 768 }, { width: 1180, height: 820 }]) {
  for (const hand of ["right", "left"] as const) {
    test(`Land a strike ${vp.width}x${vp.height} ${hand}-handed: server success only, Retry, Exit`, async () => {
      test.setTimeout(180_000);
      const ctx = await browser.newContext({ viewport: vp, hasTouch: true, reducedMotion: hand === "left" ? "reduce" : "no-preference" });
      const page = await ctx.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.addInitScript((s) => { try { localStorage.setItem("eb.settings.v1.Arel", s); } catch { /* blocked */ } }, settings(hand));
      try {
        await page.goto(`${base}/?room=flow&debug=1&name=Arel&kit=sv#invite=${svc.invites.create({ ttlMs: 120_000, maxUses: 1 }).token}`);
        await page.waitForSelector("[data-act=practice]");
        await page.click("[data-act=practice]");
        await page.click("[data-act=ready]");
        await page.waitForFunction(() => (window as unknown as { __eb?: unknown }).__eb !== undefined, undefined, { timeout: 30_000 });
        await until(async () => (await snap(page)).players.some((q) => q.local && q.action === "Idle") || null, 15_000, "ready");
        const panel = page.locator("[data-ui=practice]");
        await panel.locator("[data-expand]").click();
        await expect(panel.locator("[data-ui=practice-lessons]")).toContainText("Combat lessons");
        await expect(panel.locator("li")).toHaveCount(7); // the seven-step tutorial is preserved
        await panel.locator("button[data-drill=start][data-lesson=hit]").click();
        const hint = panel.locator("[data-ui=practice-hint]");
        await expect(hint).toHaveText("Move close, face the dummy, then land a Strike.");
        await expect(panel.locator("button[data-drill=retry]")).toBeVisible();
        const m = await page.evaluate(() => {
          const b = document.querySelector("[data-ui=practice]")!.getBoundingClientRect();
          return { sw: document.documentElement.scrollWidth, iw: innerWidth, l: b.left, r: b.right, t: b.top, b: b.bottom, ih: innerHeight };
        });
        expect(m.sw).toBeLessThanOrEqual(m.iw);
        expect(m.l).toBeGreaterThanOrEqual(0); expect(m.r).toBeLessThanOrEqual(m.iw); expect(m.b).toBeLessThanOrEqual(m.ih);
        await page.screenshot({ path: path.join(outDir, `GR15a-lesson-running-${hand}-${vp.width}x${vp.height}.png`) });
        // Approach with real keys, then strike with the real attack control. Nothing in the page infers success.
        const dist = async (): Promise<number> => { const s = await snap(page); const me = s.players.find((q) => q.local)!, d = s.players.find((q) => q.name === "Practice dummy")!; return Math.hypot(me.x - d.x, me.z - d.z); };
        await until(async () => {
          if ((await dist()) <= 1.9) return true; // the body does not block, so stop before walking through the dummy
          await page.keyboard.down("KeyW"); await sleep(50); await page.keyboard.up("KeyW"); return null;
        }, 10_000, "close to dummy");
        await expect(hint).toHaveText("Move close, face the dummy, then land a Strike.");
        const atk = (await page.locator("[data-control=attack]").boundingBox())!;
        await page.mouse.move(atk.x + atk.width / 2, atk.y + atk.height / 2);
        await page.mouse.down();
        await expect(hint).toHaveText("Hit confirmed. Try a different distance.", { timeout: 10_000 });
        await page.mouse.up();
        await expect(panel.locator("button[data-drill=retry]")).toBeVisible();
        await page.screenshot({ path: path.join(outDir, `GR15a-lesson-success-${hand}-${vp.width}x${vp.height}.png`) });
        await panel.locator("button[data-drill=retry]").click();
        await expect(hint).toHaveText("Move close, face the dummy, then land a Strike.");
        await panel.locator("button[data-drill=exit]").click();
        await expect(panel.locator("button[data-drill=start][data-lesson=hit]")).toBeVisible();
        await expect(panel.locator("button[data-toggle=guard]")).toBeVisible();
        evidence[`${hand}-${vp.width}`] = { panel: m, pageErrors: errors };
        expect(errors).toEqual([]);
      } finally { await ctx.close(); }
    });
  }
}

for (const vp of [{ width: 1024, height: 768 }, { width: 1180, height: 820 }]) {
  for (const hand of ["right", "left"] as const) {
    test(`Block a strike ${vp.width}x${vp.height} ${hand}-handed: server confirms a real guard, Retry, Exit`, async () => {
      test.setTimeout(180_000);
      const ctx = await browser.newContext({ viewport: vp, hasTouch: true, reducedMotion: hand === "left" ? "reduce" : "no-preference" });
      const page = await ctx.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.addInitScript((s) => { try { localStorage.setItem("eb.settings.v1.Brin", s); } catch { /* blocked */ } }, settings(hand));
      try {
        await page.goto(`${base}/?room=flow&debug=1&name=Brin&kit=sv#invite=${svc.invites.create({ ttlMs: 120_000, maxUses: 1 }).token}`);
        await page.waitForSelector("[data-act=practice]");
        await page.click("[data-act=practice]");
        await page.click("[data-act=ready]");
        await page.waitForFunction(() => (window as unknown as { __eb?: unknown }).__eb !== undefined, undefined, { timeout: 30_000 });
        await until(async () => (await snap(page)).players.some((q) => q.local && q.action === "Idle") || null, 15_000, "ready");
        const panel = page.locator("[data-ui=practice]");
        await panel.locator("[data-expand]").click();
        await expect(panel.locator("li")).toHaveCount(7);
        await expect(panel.locator("button[data-drill=start]")).toHaveCount(2);
        await panel.locator("button[data-drill=start][data-lesson=block]").click();
        const hint = panel.locator("[data-ui=practice-hint]");
        await expect(hint).toHaveText("Face the dummy and hold Guard before its strike lands.");
        await expect(panel.locator("button[data-drill=retry]")).toBeVisible();
        const m = await page.evaluate(() => {
          const b = document.querySelector("[data-ui=practice]")!.getBoundingClientRect();
          return { sw: document.documentElement.scrollWidth, iw: innerWidth, l: b.left, r: b.right, b: b.bottom, ih: innerHeight };
        });
        expect(m.sw).toBeLessThanOrEqual(m.iw);
        expect(m.l).toBeGreaterThanOrEqual(0); expect(m.r).toBeLessThanOrEqual(m.iw); expect(m.b).toBeLessThanOrEqual(m.ih);
        await page.screenshot({ path: path.join(outDir, `GR15b-lesson-running-${hand}-${vp.width}x${vp.height}.png`) });
        // Hold the real guard control through the dummy's first strike; success text comes only from the server owner record.
        const guard = (await page.locator("[data-control=block]").boundingBox())!;
        await page.mouse.move(guard.x + guard.width / 2, guard.y + guard.height / 2);
        await page.mouse.down();
        await expect(hint).toHaveText("Block confirmed. Try holding Guard a little later.", { timeout: 20_000 });
        await page.mouse.up();
        await page.screenshot({ path: path.join(outDir, `GR15b-lesson-success-${hand}-${vp.width}x${vp.height}.png`) });
        await panel.locator("button[data-drill=retry]").click();
        await expect(hint).toHaveText("Face the dummy and hold Guard before its strike lands.");
        await panel.locator("button[data-drill=exit]").click();
        await expect(panel.locator("button[data-drill=start]")).toHaveCount(2);
        await expect(panel.locator("button[data-toggle=guard]")).toBeVisible();
        evidence[`block-${hand}-${vp.width}`] = { panel: m, pageErrors: errors };
        expect(errors).toEqual([]);
      } finally { await ctx.close(); }
    });
  }
}
