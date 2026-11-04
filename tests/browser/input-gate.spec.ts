// GR05 input gate: a real practice client, real keyboard events, no gameplay intent while an overlay owns input. Same harness as flow.spec.ts: real Colyseus server in-process, real client
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
    dataDir: mkdtempSync(path.join(tmpdir(), "eb-pw-gr05-")), allowedOrigins: [base], secureCookies: false,
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
  writeFileSync(path.join(outDir, "GR05-playwright.json"), JSON.stringify(evidence, null, 2));
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


const pos = async (p: Page) => { const l = (await snap(p)).players.find((q) => q.local)!; return { x: l.x, z: l.z }; };
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

test("overlays suspend gameplay: no motion, no casts, no typing into settings; fresh press required", async () => {
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
    await localIdle(page);
    await sleep(400); // GR12: the first frames after Ready still hold the input gate closed; a press before it syncs is ignored by design (GR05)

    // W held, then the menu opens: movement stops; D during the menu does nothing.
    const p0 = await pos(page);
    await page.keyboard.down("KeyW");
    await until(async () => (dist(await pos(page), p0) > 0.5) || null, 8000, "W moves");
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-hud=menu]")).toBeVisible();
    await sleep(400);
    const settled = await pos(page);
    await page.keyboard.down("KeyD");
    await sleep(500);
    await page.keyboard.up("KeyD");
    expect(dist(await pos(page), settled)).toBeLessThan(0.05);
    // Close with W still physically held (OS repeat): no motion until a fresh press.
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-hud=menu]")).toBeHidden();
    await page.keyboard.down("KeyW");
    await sleep(600);
    const afterClose = await pos(page);
    expect(dist(afterClose, settled)).toBeLessThan(0.05);
    await page.keyboard.up("KeyW");
    // A fresh press works again. S walks away from whatever W may have run into (the unit test covers fresh W itself).
    await page.keyboard.down("KeyS");
    await until(async () => (dist(await pos(page), afterClose) > 0.3) || null, 8000, "fresh press moves");
    await page.keyboard.up("KeyS");
    await sleep(600);

    // Key 2 with Settings open: no cast, no cooldown. Typing into the import textarea does not play.
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.locator("[data-ui=settings]")).toBeVisible();
    const cd0 = await page.evaluate(() => Array.from((window as unknown as { __eb: { snapshot(): { players: { local: boolean; cooldownEndTicks: number[] }[] } } }).__eb.snapshot().players.find((q) => q.local)!.cooldownEndTicks));
    const p1 = await pos(page);
    await page.keyboard.press("Digit2");
    await page.locator("[data-ui=settings-json]").focus();
    await page.keyboard.type("wasd2 1234");
    await sleep(500);
    const cd1 = await page.evaluate(() => Array.from((window as unknown as { __eb: { snapshot(): { players: { local: boolean; cooldownEndTicks: number[] }[] } } }).__eb.snapshot().players.find((q) => q.local)!.cooldownEndTicks));
    expect(cd1).toEqual(cd0);
    expect(dist(await pos(page), p1)).toBeLessThan(0.05);
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-ui=settings]")).toBeHidden();
    expect(errors).toEqual([]);
  } finally {
    await closeContext(ctx);
  }
});
