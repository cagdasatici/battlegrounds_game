// T18d exit checks: Practice from Welcome, a private room with a dummy, every tutorial step confirmed by the server,
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
  writeFileSync(path.join(outDir, "T18d-playwright.json"), JSON.stringify(evidence, null, 2));
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

test("Practice from Welcome: dummy room, server confirmed tutorial in order, toggles, Leave cleans up", async () => {
  test.setTimeout(180_000);
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  try {
    await page.goto(`${base}/?room=flow&debug=1&name=Arel&kit=sv#invite=${svc.invites.create({ ttlMs: 120_000, maxUses: 1 }).token}`);
    await page.waitForSelector("[data-act=practice]");
    await expect(page.locator("[data-act=play]")).toBeVisible();
    await page.click("[data-act=practice]");
    await expect(page.locator("[data-ui=room-status]")).toContainText("training dummy");
    await expect(page.locator("[data-act=kit]")).toHaveCount(3);
    await page.click("[data-act=ready]");
    await page.waitForFunction(() => (window as unknown as { __eb?: unknown }).__eb !== undefined, undefined, { timeout: 30_000 });
    await until(async () => (await snap(page)).players.some((q) => q.local && q.action === "Idle") || null, 15_000, "ready");

    const panel = page.locator("[data-ui=practice]");
    await expect(panel).toBeVisible();
    await expect(panel.locator("li")).toHaveCount(7);
    const s0 = await snap(page);
    expect(s0.players.map((q) => q.name).sort()).toEqual(["Arel", "Practice dummy"]);
    expect(s0.practice).toMatchObject({ step: 0 });
    // The panel shows only what the server replicated: pressing a later step's control early completes nothing.
    await hold(page, "KeyQ", 80);
    await sleep(300);
    expect(await step(page)).toBeLessThanOrEqual(1);
    await localIdle(page);

    await page.keyboard.down("KeyW");
    await until(async () => (await step(page)) >= 1 || null, 6000, "move confirmed");
    await page.keyboard.up("KeyW");
    await expect(panel.locator("li[data-step=move]")).toHaveAttribute("data-status", "done");
    await page.keyboard.down("KeyD");
    await until(async () => (await step(page)) >= 2 || null, 6000, "turn confirmed");
    await page.keyboard.up("KeyD");
    const atk = (await page.locator("[data-control=attack]").boundingBox())!;
    await page.mouse.move(atk.x + atk.width / 2, atk.y + atk.height / 2);
    await page.mouse.down();
    await until(async () => (await step(page)) >= 3 || null, 8000, "hold attack confirmed");
    await page.mouse.up();
    await localIdle(page);
    await page.keyboard.down("KeyF");
    await until(async () => (await step(page)) >= 4 || null, 6000, "hold block confirmed");
    await page.keyboard.up("KeyF");
    await sleep(200);
    await localIdle(page);
    // The early dash above started a cooldown, so tap again until the server accepts one.
    await until(async () => { await hold(page, "KeyQ", 80); await sleep(250); return (await step(page)) >= 5 || null; }, 15_000, "dash confirmed");
    await localIdle(page);
    for (const n of [1, 2, 3, 4]) {
      await localIdle(page);
      await hold(page, `Digit${n}`, 120);
      await until(async () => (((await snap(page)).practice?.skillMask ?? 0) & (1 << (n - 1))) !== 0 || null, 5000, `skill ${n} confirmed`);
    }
    await expect(panel.locator("li[data-step=skills]")).toHaveAttribute("data-status", "done");
    await until(async () => (await snap(page)).players.find((q) => q.local)!.meter100 > 0 || null, 4000, "server filled meter for awaken");
    await localIdle(page);
    await hold(page, "KeyG", 100);
    await until(async () => (await step(page)) === 7 || null, 8000, "awaken confirmed");
    const done = await snap(page);
    expect(done.players.find((q) => q.local)!.form).toBe("Awakened");
    await expect(panel.locator("[data-ui=practice-hint]")).toContainText("Practice complete");
    expect(done.players.every((q) => q.kills === 0)).toBe(true);
    mkdirSync(outDir, { recursive: true });
    await page.screenshot({ path: path.join(outDir, "T18d-practice.png") });

    // Toggles are intent; the effect is read back from server state.
    await page.click("[data-toggle=guard]");
    await until(async () => (await snap(page)).players.find((q) => q.name === "Practice dummy")?.action === "Guard" || null, 4000, "dummy guards");
    await expect(page.locator("[data-toggle=guard]")).toHaveAttribute("aria-pressed", "true");
    await page.click("[data-toggle=guard]");
    await page.click("[data-toggle=ragdoll]");
    await until(async () => (await snap(page)).players.find((q) => q.name === "Practice dummy")?.action === "Ragdolled" || null, 4000, "dummy ragdolled");
    await page.click("[data-toggle=ragdoll]");

    // Leave: back to Welcome, panel and debug probe gone.
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /leave/i }).click();
    await expect(page.locator("[data-act=practice]")).toBeVisible();
    await expect(panel).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __eb?: unknown }).__eb === undefined)).toBe(true);
    evidence["practice"] = { stepsConfirmed: 7, finalForm: done.players.find((q) => q.local)!.form, pageErrors: errors };
    expect(errors).toEqual([]);
  } finally { await ctx.close(); }
});
