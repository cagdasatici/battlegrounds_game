// FX2 exit checks: hitting the practice dummy shows red damage text, casting a skill shows its shipped label, and
// disposing removes the overlay. Same harness as flow.spec.ts: real Colyseus server in-process, real client
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
    dataDir: mkdtempSync(path.join(tmpdir(), "eb-pw-fx2-")), allowedOrigins: [base], secureCookies: false,
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
  writeFileSync(path.join(outDir, "FX2-playwright.json"), JSON.stringify(evidence, null, 2));
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

test("combat text: dummy hit shows red damage, a cast shows its label, Leave removes the overlay", async () => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  try {
    await page.goto(`${base}/?room=flow&debug=1&name=Arel&kit=sv#invite=${svc.invites.create({ ttlMs: 120_000, maxUses: 1 }).token}`);
    await page.waitForSelector("[data-act=practice]");
    await page.click("[data-act=practice]");
    await expect(page.locator("[data-ui=room-status]")).toContainText("training dummy");
    await page.click("[data-act=ready]");
    await page.waitForFunction(() => (window as unknown as { __eb?: unknown }).__eb !== undefined, undefined, { timeout: 30_000 });
    await until(async () => (await snap(page)).players.some((q) => q.local && q.action === "Idle") || null, 15_000, "ready");
    await expect(page.locator("[data-ui=combat-text]")).toHaveCount(1);

    // GR00: a skill pressed in the first ~1 s after spawn (before the body has landed) is rejected by the server; wait for the spawn drop to settle.
    await until(async () => (await snap(page)).serverTick >= 150 || null, 15_000, "spawn settled");
    // Cast: skill 1 (Fault Strike for Stone Vanguard). Text comes from the confirmed server event.
    await page.keyboard.down("Digit1");
    await sleep(120);
    await page.keyboard.up("Digit1");
    const cast = page.locator("[data-ct=cast]").first();
    await expect(cast).toHaveText("Fault Strike", { timeout: 5000 });
    await expect(page.locator("[data-ct=castSelf]").first()).toHaveText("Fault Strike");

    // Hit: attack the dummy until the server confirms a hit; the text is red "-N".
    const atk = (await page.locator("[data-control=attack]").boundingBox())!;
    await until(async () => (await snap(page)).players.find((q) => q.local)?.action === "Idle" || null, 8000, "idle");
    const t0 = Date.now();
    let hit = "";
    while (!hit && Date.now() - t0 < 30_000) {
      await page.keyboard.down("KeyW");
      await page.mouse.move(atk.x + atk.width / 2, atk.y + atk.height / 2);
      await page.mouse.down();
      await sleep(150);
      await page.mouse.up();
      await page.keyboard.up("KeyW");
      hit = await page.evaluate(() => document.querySelector<HTMLElement>("[data-ct=hit]")?.textContent ?? "");
      if (!hit) await sleep(150);
    }
    expect(hit).toMatch(/^-\d+(\.\d)?$/);
    const color = await page.evaluate(() => getComputedStyle(document.querySelector("[data-ct=hit]") ?? document.body).color);
    expect(color).toBe("rgb(255, 77, 77)");
    evidence["combatText"] = { hit, color, cast: "Fault Strike", pageErrors: errors };

    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /leave/i }).click();
    await expect(page.locator("[data-act=practice]")).toBeVisible();
    await expect(page.locator("[data-ui=combat-text]")).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally { await ctx.close(); }
});
