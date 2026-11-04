// GR08 durable round state and live objective: real Chromium + Colyseus client against a bot room with first-to-5 rounds. The KO tally is set on the server fighter by a fixture; replication, objective strip and results card are real.
import { test, expect, chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { createServer as netServer } from "node:net";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { matchMaker, type Server } from "colyseus";
import type { ArenaRoom } from "../../apps/server/src/rooms/ArenaRoom.js";
import { createGameServer } from "../../apps/server/src/createServer.js";
import { createAuthServices, type AuthServices } from "../../apps/server/src/auth/Services.js";
import { mkdtempSync } from "node:fs";
import { resolveChromium } from "./harness/chromium-path.js";
import { closeContext } from "./harness/leave.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const req = createRequire(path.join(root, "apps/client/package.json"));
const CHROMIUM = resolveChromium();
const GL_ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];

interface Dev { close(): Promise<void>; listen(): Promise<unknown> }

interface Snap { localEntityId: number | null; players: { entityId: number; ready: boolean; local: boolean; action: string }[] }

let game: Server, svc: AuthServices, vite: Dev, browser: Browser;
let base = "";
const freePort = (): Promise<number> => new Promise((resolve, reject) => {
  const s = netServer();
  s.listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); });
  s.on("error", reject);
});
test.beforeAll(async () => {
  const gamePort = await freePort(), vitePort = await freePort();
  base = `http://localhost:${vitePort}`;
  svc = createAuthServices({
    dataDir: mkdtempSync(path.join(tmpdir(), "eb-pw-")), allowedOrigins: [base], secureCookies: false,
    roomCodes: { rounds: "arena" }, buildId: "test", sessionsPerMinute: 10_000, globalSessionsPerMinute: 10_000,
  });
  svc.roomMeta.set("rounds", { name: "Rounds", listed: true, bots: ["easy"], roundTarget: 5 });
  game = createGameServer(svc);
  await game.listen(gamePort, undefined, undefined);
  const target = `http://127.0.0.1:${gamePort}`;
  const v = req("vite") as { createServer(c: unknown): Promise<Dev> };
  vite = await v.createServer({
    root: path.join(root, "apps/client"), configFile: false, logLevel: "error",
    server: { hmr: false, watch: null, port: vitePort, strictPort: true, host: "127.0.0.1", fs: { strict: false },
      proxy: { "/api": { target }, "/matchmake": { target }, "^/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+(\\?.*)?$": { target, ws: true } } },
  });
  await vite.listen();
  browser = await chromium.launch({ executablePath: CHROMIUM, args: GL_ARGS });
});
test.afterAll(async () => { await browser?.close(); await vite?.close(); await game?.gracefullyShutdown(false); });

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

async function open(vp: { width: number; height: number }): Promise<{ ctx: BrowserContext; page: Page; errors: string[] }> {
  const ctx = await browser.newContext({ viewport: vp, hasTouch: false });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const { token } = svc.invites.create({ ttlMs: 120_000, maxUses: 1 });
  await page.goto(`${base}/?room=rounds&name=Aria&kit=sv&debug=1#invite=${token}`);
  await page.waitForSelector("[data-act=play]");
  await page.click("[data-act=play]");
  await page.click("[data-act=kit][data-kit=sv]");
  await page.click("[data-act=ready]");
  await page.waitForFunction(() => (window as unknown as { __eb?: unknown }).__eb !== undefined, undefined, { timeout: 30_000 });
  return { ctx, page, errors };
}

for (const vp of [{ width: 1024, height: 768 }, { width: 1180, height: 820 }]) {
  test(`objective strip, results card from state, actions and no death card at ${vp.width}x${vp.height}`, async () => {
    test.setTimeout(150_000);
    const { ctx, page, errors } = await open(vp);
    try {
      const listings = await matchMaker.query({ name: "arena" });
      const arena = matchMaker.getLocalRoomById(listings[0]!.roomId) as unknown as ArenaRoom;
      expect(arena.state.roundTarget).toBe(5);
      const aId = await until(async () => (await snap(page)).localEntityId, 15000, "local id");
      // Live objective: one line, 14 px, <= 360 px wide, centred at y=68 below the health row, no results card.
      const strip = page.locator("[data-hud=objective]");
      await until(async () => (await strip.isVisible()) || null, 8000, "objective visible");
      await expect(strip).toHaveText(/^First to 5 \u00b7 You 0 \u00b7 Leader /);
      const box = (await strip.boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(66); expect(box.y).toBeLessThanOrEqual(70);
      expect(box.width).toBeLessThanOrEqual(360);
      expect(box.height).toBeLessThan(24); // single line
      expect(await strip.evaluate((el) => getComputedStyle(el).fontSize)).toBe("14px");
      expect(Math.abs(box.x + box.width / 2 - vp.width / 2)).toBeLessThan(2);
      await expect(page.locator("[data-ui=round-results]")).toBeHidden();

      // End the round on the server: the local player reaches the target.
      const me = arena.state.players.get(String(aId))!;
      me.kills = 5;
      const card = page.locator("[data-ui=round-results]");
      await until(async () => (await card.isVisible()) || null, 8000, "results card");
      await expect(card).toContainText(/Aria wins: first to 5 KOs/);
      await expect(card).toContainText(/Next round in \d+/);
      await expect(card.getByText(/^1\. Aria\s+5 KOs/)).toBeVisible();
      await expect(strip).toBeHidden(); // objective is for active rounds only
      await expect(page.locator("[data-hud=respawn]")).toBeHidden();
      const secs = Number(/Next round in (\d+)/.exec((await card.textContent()) ?? "")?.[1]);
      expect(secs).toBeGreaterThanOrEqual(8); expect(secs).toBeLessThanOrEqual(10);
      const cb = (await card.boundingBox())!;
      expect(cb.x).toBeGreaterThanOrEqual(0); expect(cb.x + cb.width).toBeLessThanOrEqual(vp.width);
      await page.screenshot({ path: `test-results/GR08-results-${vp.width}x${vp.height}.png` });

      // Change fighter opens the existing fighter menu (card steps aside); input stays gated by the round.
      await card.getByRole("button", { name: "Change fighter" }).click();
      await expect(page.locator("[data-hud=kit]")).toBeVisible();
      await expect(card).toBeHidden();
      await page.keyboard.press("Escape");
      await until(async () => (await card.isVisible()) || null, 4000, "card returns after the menu");

      // The next round clears the card and standings and bumps the round number.
      await until(async () => arena.state.phase === "playing" || null, 20000, "next round");
      expect(arena.state.roundNumber).toBe(2);
      await until(async () => (await card.isHidden()) || null, 5000, "card hidden");
      await until(async () => (await strip.isVisible()) || null, 5000, "objective back");
      await expect(strip).toHaveText(/^First to 5 \u00b7 You 0 /);
      expect(errors).toEqual([]);
    } finally { await closeContext(ctx); }
  });
}

test("Leave from the results card returns to the lobby", async () => {
  test.setTimeout(120_000);
  const { ctx, page, errors } = await open({ width: 1024, height: 768 });
  try {
    const listings = await matchMaker.query({ name: "arena" });
    const arena = matchMaker.getLocalRoomById(listings[0]!.roomId) as unknown as ArenaRoom;
    const aId = await until(async () => (await snap(page)).localEntityId, 15000, "local id");
    await until(async () => arena.state.phase === "playing" || null, 20000, "playing");
    arena.state.players.get(String(aId))!.kills = 5;
    const card = page.locator("[data-ui=round-results]");
    await until(async () => (await card.isVisible()) || null, 8000, "results card");
    await card.getByRole("button", { name: "Leave" }).click();
    await page.waitForSelector("[data-act=play]", { timeout: 15_000 });
    await until(async () => arena.state.players.size <= 1 || null, 25000, "human removed");
    expect(errors).toEqual([]);
  } finally { await closeContext(ctx); }
});
