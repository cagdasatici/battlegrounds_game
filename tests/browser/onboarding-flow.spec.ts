// HELP2 exit checks: Welcome guide entry, focus restoration, and the guide to Practice handoff. Same harness as flow.spec.ts: real Colyseus server in-process, real client
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
import { resolveChromium } from "./harness/chromium-path.js";
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
    dataDir: mkdtempSync(path.join(tmpdir(), "eb-pw-onboarding-")), allowedOrigins: [base], secureCookies: false,
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
  writeFileSync(path.join(outDir, "HELP2-playwright.json"), JSON.stringify(evidence, null, 2));
  await browser?.close();
  await vite?.close();
  await game?.gracefullyShutdown(false);
});


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
const net = (p: Page): string[] => {
  const urls: string[] = [];
  p.on("request", (r) => { const u = new URL(r.url()); if (u.pathname.startsWith("/api") || u.pathname.startsWith("/matchmake")) urls.push(u.pathname); });
  return urls;
};
const focusedAct = (p: Page): Promise<string | null> => p.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset["act"] ?? null);

test("Unauthenticated: How to play opens without a request, Back restores Welcome and launcher focus", async () => {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  try {
    await page.goto(`${base}/?room=flow&name=Arel`);
    await page.waitForSelector("[data-act=guide]");
    const urls = net(page);
    await page.locator("[data-act=guide]").focus();
    await page.keyboard.press("Enter");
    const guide = page.locator("[data-ui=how-to-play]");
    await expect(guide).toBeVisible();
    await expect(guide.getByText("Practice uses a stationary dummy")).toBeVisible();
    await expect(guide.getByText("Host sparring")).toHaveCount(0);
    // QU01: the five first-match prompts sit beside the touch and keyboard bindings.
    for (const mode of ["Touch", "Keyboard"]) {
      await guide.getByRole("button", { name: mode, exact: true }).click();
      for (const prompt of ["Move:", "Aim:", "Strike:", "Guard:", "Use a skill:"]) await expect(guide.locator("#how-to-play-controls li", { hasText: prompt })).toHaveCount(1);
    }
    await guide.getByRole("button", { name: "Back" }).click();
    await expect(guide).toHaveCount(0);
    await expect(page.locator("[data-act=practice]")).toBeVisible();
    expect(await focusedAct(page)).toBe("guide");
    expect(urls).toEqual([]);
    expect(errors).toEqual([]);
    evidence["unauthenticated"] = { requestsWhileOpen: urls.length };
  } finally { await ctx.close(); }
});

test("Invited: guide, Try practice once, first server-confirmed step, leave, replay x3 without duplicate handlers", async () => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  try {
    await page.goto(`${base}/?room=flow&debug=1&name=Arel&kit=sv#invite=${svc.invites.create({ ttlMs: 120_000, maxUses: 1 }).token}`);
    await page.waitForSelector("[data-act=guide]");
    const urls = net(page);
    const joins: number[] = [];
    for (let cycle = 0; cycle < 3; cycle++) {
      await page.click("[data-act=guide]");
      const guide = page.locator("[data-ui=how-to-play]");
      await expect(guide).toBeVisible();
      await guide.getByRole("button", { name: "Keyboard" }).click();
      await expect(guide.getByText("WASD: move.")).toBeVisible();
      const before = urls.filter((u) => u.startsWith("/matchmake")).length;
      await guide.getByRole("button", { name: "Try practice" }).click();
      await expect(guide).toHaveCount(0);
      await expect(page.locator("[data-ui=room-status]")).toContainText("training dummy");
      await page.click("[data-act=ready]");
      await page.waitForFunction(() => (window as unknown as { __eb?: unknown }).__eb !== undefined, undefined, { timeout: 30_000 });
      if (cycle === 0) {
        await until(async () => { const s = await page.evaluate(() => (window as unknown as { __eb: { snapshot(): { players: { local: boolean; action: string }[] } } }).__eb.snapshot()); return s.players.some((q) => q.local && q.action === "Idle") || null; }, 15_000, "ready");
        await page.keyboard.down("KeyW");
        await until(async () => { const s = await page.evaluate(() => (window as unknown as { __eb: { snapshot(): { practice: { step: number } | null } } }).__eb.snapshot()); return (s.practice?.step ?? 0) >= 1 || null; }, 8000, "move confirmed by server");
        await page.keyboard.up("KeyW");
      }
      joins.push(urls.filter((u) => u.startsWith("/matchmake")).length - before);
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: /leave/i }).click();
      await expect(page.locator("[data-act=guide]")).toBeVisible();
      await expect(page.locator("[data-ui=how-to-play]")).toHaveCount(0);
    }
    expect(joins.every((n) => n >= 1)).toBe(true);
    // Each Try practice produced the same number of room requests: no listener accumulated across cycles.
    expect(new Set(joins).size).toBe(1);
    evidence["invited"] = { joinRequestsPerCycle: joins, pageErrors: errors };
    expect(errors).toEqual([]);
  } finally { await ctx.close(); }
});
