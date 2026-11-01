// T18c exit checks: app flow (Welcome, lobby, Ready), the five error states with stubbed HTTP, and the HUD bound to
// replicated state (cooldowns, rejection text, meter, scoreboard, respawn countdown, kit choice). Same harness as
// match.spec.ts: real Colyseus server in-process, real client served by Vite, same origin.
import { test, expect, chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
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
  players: { name: string; kitId: string; action: string; x: number; z: number; local: boolean; kills: number; deaths: number; meter100: number; cooldownEndTicks: number[] }[];
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
    dataDir: mkdtempSync(path.join(tmpdir(), "eb-pw-flow-")), allowedOrigins: [base], secureCookies: false,
    roomCodes: { flow: "arena" }, buildId: "test", sessionsPerMinute: 10_000, globalSessionsPerMinute: 10_000,
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
  writeFileSync(path.join(outDir, "T18c-playwright.json"), JSON.stringify(evidence, null, 2));
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

async function open(query: string, withInvite = true): Promise<{ ctx: BrowserContext; page: Page; errors: string[] }> {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  const page = await ctx.newPage();
  const errors: string[] = [];
  // Stubbed failures legitimately log failed fetches; real script errors are what must stay empty.
  page.on("pageerror", (e) => errors.push(String(e)));
  const frag = withInvite ? `#invite=${svc.invites.create({ ttlMs: 120_000, maxUses: 1 }).token}` : "";
  await page.goto(`${base}/?room=flow&debug=1${query}${frag}`);
  return { ctx, page, errors };
}
const centre = async (p: Page, control: string): Promise<{ x: number; y: number }> => {
  const b = (await p.locator(`[data-control=${control}]`).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const errorBox = (p: Page) => p.locator("[data-ui=error]");

test.describe("five error states, each with plain text and Retry or Back", () => {
  test("SERVER_OFFLINE: version endpoint unreachable, Retry then succeeds", async () => {
    const { ctx, page } = await open("&name=Arel");
    try {
      await page.waitForSelector("[data-act=play]");
      let block = true;
      await page.route("**/api/version", (r) => (block ? r.abort() : r.continue()));
      await page.click("[data-act=play]");
      await expect(errorBox(page)).toHaveAttribute("data-code", "SERVER_OFFLINE");
      await expect(errorBox(page)).not.toContainText(/error:|stack|at /i);
      await expect(page.locator("[data-act=retry]")).toBeVisible();
      await expect(page.locator("[data-act=back]")).toBeVisible();
      block = false;
      await page.click("[data-act=retry]"); // bounded exponential delay (0.5 s first)
      await expect(page.locator("[data-ui=room-status]")).toBeVisible({ timeout: 15_000 });
      evidence["serverOfflineRetryRecovered"] = true;
    } finally { await ctx.close(); }
  });

  test("VERSION_MISMATCH: Back only, no retry loop", async () => {
    const { ctx, page } = await open("&name=Arel");
    try {
      await page.waitForSelector("[data-act=play]");
      await page.route("**/api/version", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ protocolVersion: 99, contentHash: "0000000000000000", buildId: "x" }) }));
      await page.click("[data-act=play]");
      await expect(errorBox(page)).toHaveAttribute("data-code", "VERSION_MISMATCH");
      await expect(page.locator("[data-act=retry]")).toHaveCount(0);
      await page.click("[data-act=back]");
      await expect(page.locator("[data-act=play]")).toBeVisible();
    } finally { await ctx.close(); }
  });

  test("INVITE_INVALID: rejected session, and Play without any invitation sends no request", async () => {
    const a = await open("&name=Arel");
    try {
      await a.page.waitForSelector("[data-act=play]");
      await a.page.route("**/api/session", (r) => r.fulfill({ status: 401, contentType: "application/json", body: "{}" }));
      await a.page.click("[data-act=play]");
      await expect(errorBox(a.page)).toHaveAttribute("data-code", "INVITE_INVALID");
      await expect(a.page.locator("[data-act=retry]")).toHaveCount(0);
      await expect(a.page.locator("[data-act=back]")).toBeVisible();
    } finally { await a.ctx.close(); }
    const b = await open("&name=Arel", false);
    try {
      const calls: string[] = [];
      b.page.on("request", (r) => { if (r.url().includes("/api/") && !r.url().endsWith("/api/version")) calls.push(r.url()); }); // WEB2: public update check is allowed
      await b.page.waitForSelector("[data-act=play]");
      await b.page.click("[data-act=play]");
      await expect(errorBox(b.page)).toHaveAttribute("data-code", "INVITE_INVALID");
      expect(calls).toEqual([]);
    } finally { await b.ctx.close(); }
  });

  test("ROOM_FULL: matchmaker says the room is full, Retry offered", async () => {
    const { ctx, page } = await open("&name=Arel");
    try {
      await page.waitForSelector("[data-act=play]");
      await page.route("**/matchmake/joinById/**", (r) => r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: 4212, error: "room is full" }) }));
      await page.click("[data-act=play]");
      await expect(errorBox(page)).toHaveAttribute("data-code", "ROOM_FULL");
      await expect(page.locator("[data-act=retry]")).toBeVisible();
    } finally { await ctx.close(); }
  });

  test("ASSET_FAILED: map file missing, Retry then reaches Welcome", async () => {
    const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
    const page = await ctx.newPage();
    try {
      let fail = true;
      await page.route((u) => u.pathname.endsWith("islands.v1.json") && !u.search.includes("import"), (r) => (fail ? r.fulfill({ status: 404, body: "no" }) : r.continue()));
      await page.goto(`${base}/?room=flow`);
      await expect(errorBox(page)).toHaveAttribute("data-code", "ASSET_FAILED");
      await expect(page.locator("[data-act=retry]")).toBeVisible();
      fail = false;
      await page.click("[data-act=retry]");
      await expect(page.locator("[data-act=play]")).toBeVisible({ timeout: 15_000 });
    } finally { await ctx.close(); }
  });
});

test("happy path to Ready, then HUD: meter, cooldown, rejection, scoreboard, kit choice, respawn countdown", async () => {
  test.setTimeout(150_000);
  const { ctx, page, errors } = await open("&name=Nora&kit=sv");
  try {
    // Welcome: Play, local name presets (labels only), connection status.
    await page.waitForSelector("[data-act=play]");
    await expect(page.locator("[data-ui=status]")).toContainText("offline");
    await expect(page.locator("[data-act=name]")).toHaveCount(2);
    await page.click("[data-act=name][data-name=Arel]");
    await page.click("[data-act=play]");

    // Lobby: room status, the three kits (the Artificer joined with T21), four base moves, Ready.
    await expect(page.locator("[data-ui=room-status]")).toContainText("1 of 4");
    await expect(page.locator("[data-act=kit]")).toHaveCount(3);
    await page.click("[data-act=kit][data-kit=ea]");
    await expect(page.locator("[data-act=kit][data-kit=ea]")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("[data-ui=moves]")).toContainText("Cinder Array, Vent Rush, Ember Orb, Furnace Drop");
    await page.click("[data-act=kit][data-kit=td]");
    await expect(page.locator("[data-ui=moves]")).toContainText("Current Bind");
    await page.click("[data-act=kit][data-kit=sv]");
    await expect(page.locator("[data-ui=moves]")).toContainText("Fault Strike, Gravel Flurry, Rift Palm, Rising Pillar");
    await page.click("[data-act=ready]");

    await page.waitForFunction(() => (window as unknown as { __eb?: unknown }).__eb !== undefined, undefined, { timeout: 30_000 });
    await until(async () => { const s = await snap(page); return s.players.some((p) => p.local && p.kitId === "sv" && p.name === "Arel") || null; }, 15_000, "ready as Arel/sv");
    await expect(page.locator("[data-control=health]")).toContainText("Arel 100 / 100");
    await expect(page.locator("[data-control=awaken]")).toContainText("Awaken 0%");
    await sleep(3000); // spawn protection and clock settle
    mkdirSync(outDir, { recursive: true });
    await page.screenshot({ path: path.join(outDir, "T18c-hud.png") });

    // Cooldown from cooldownEndTicks: sv.b3 has a 600 tick (10 s) cooldown.
    const s3 = await centre(page, "skill3");
    await page.touchscreen.tap(s3.x, s3.y);
    const cd = await until(async () => {
      const t = (await page.locator("[data-control=skill3]").textContent()) ?? "";
      const m = /^3 (\d+(?:\.\d)?)$/.exec(t);
      return m ? m[1]! : null;
    }, 5000, "skill 3 cooldown text");
    expect(Number(cd)).toBeGreaterThan(5);
    expect(Number(cd)).toBeLessThanOrEqual(10);
    const ticks = (await snap(page)).players.find((p) => p.local)!.cooldownEndTicks;
    expect(ticks[2]).toBeGreaterThan((await snap(page)).serverTick);
    evidence["cooldownTextAfterTap"] = cd;
    evidence["cooldownEndTicks"] = ticks;

    // Rejection while cooling down: plain text for 0.7 s, then gone.
    await sleep(1500);
    await page.touchscreen.tap(s3.x, s3.y);
    await expect(page.locator("[data-hud=rejection]")).toHaveText("Cooling down", { timeout: 3000 });
    await expect(page.locator("[data-hud=rejection]")).toBeHidden({ timeout: 3000 });
    // Awakening with an empty meter is refused client side (no edge) and the meter stays 0%.
    await expect(page.locator("[data-control=awaken]")).toContainText("0%");

    // Scoreboard (does not pause the world) and kit choice open from their controls.
    const sb = await centre(page, "scoreboard");
    await page.touchscreen.tap(sb.x, sb.y);
    await expect(page.locator("[data-hud=scoreboard]")).toContainText("Arel");
    await page.touchscreen.tap(sb.x, sb.y);
    await expect(page.locator("[data-hud=scoreboard]")).toBeHidden();
    const fc = await centre(page, "fighter");
    await page.touchscreen.tap(fc.x, fc.y);
    await expect(page.locator("[data-hud=kit] button[data-kit]")).toHaveCount(3);
    await page.click("[data-hud=kit] button[data-kit=td]");
    await expect(page.locator("[data-hud=kit]")).toBeHidden();
    evidence["pendingKitAfterChange"] = (await page.evaluate(() => document.body.innerText)).includes("Next life") ? "shown" : "not shown";

    // Walk off the island (void ring-out, nobody credited): respawn countdown 3 to 1, then a fresh life.
    const joy = await centre(page, "joystick");
    await page.mouse.move(joy.x, joy.y);
    await page.mouse.down();
    await page.mouse.move(joy.x, joy.y - 60, { steps: 4 });
    const seen = new Set<string>();
    await until(async () => {
      const t = await page.locator("[data-hud=respawn]").textContent().catch(() => "");
      const m = /Respawning in (\d)/.exec(t ?? "");
      if (m) seen.add(m[1]!);
      return seen.size >= 2 ? true : null;
    }, 60_000, "respawn countdown visible");
    await page.mouse.up();
    evidence["respawnSecondsSeen"] = [...seen];
    await expect(page.locator("[data-hud=respawn]")).toBeHidden({ timeout: 8000 });
    const after = (await snap(page)).players.find((p) => p.local)!;
    expect(after.deaths).toBe(1);
    expect(after.action).not.toBe("Dead");

    // Leave via the menu returns to Welcome and closes the room.
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-hud=menu]")).toContainText("The arena continues while this menu is open.");
    await page.click("[data-hud=menu] button[data-leave]");
    await expect(page.locator("[data-act=play]")).toBeVisible();
    await expect(page.locator("[data-control]")).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally { await ctx.close(); }
});

// T27: Settings wired into the real app. Welcome opens it; in a match the menu opens it, the arena keeps running,
// left hand mirrors the real HUD, and Leave still works with the panel closed.
test("T27 Settings from Welcome and from the match menu; arena keeps running", async () => {
  const { ctx, page, errors } = await open("&name=Arel&kit=sv");
  try {
    await page.waitForSelector("[data-act=play]");
    await page.click("[data-act=settings]");
    await expect(page.locator("[data-ui=settings]")).toBeVisible();
    await expect(page.locator("[data-ui=settings] p")).toBeHidden(); // note only while a match runs
    await page.click("button[data-act=close]");
    await page.click("[data-act=play]");
    await page.click("[data-act=ready]");
    await page.waitForFunction(() => (window as unknown as { __eb?: unknown }).__eb !== undefined, undefined, { timeout: 30_000 });
    await until(async () => { const s = await snap(page); return s.players.some((p) => p.local) || null; }, 15_000, "in match");
    const a0 = await centre(page, "attack");
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-hud=menu]")).toBeVisible();
    await page.click("[data-hud=menu] button[data-settings]");
    const panel = page.locator("[data-ui=settings]");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("The arena continues while this menu is open.");
    await expect(page.locator("[data-hud=menu]")).toBeHidden();
    const t0 = (await snap(page)).serverTick;
    await until(async () => ((await snap(page)).serverTick > t0 + 10 ? true : null), 5000, "ticks advance with Settings open");
    await page.click("button[data-toggle=hand]");
    await page.click("button[data-act=close]");
    await expect(panel).toBeHidden();
    const a1 = await centre(page, "attack");
    expect(Math.abs(a1.x - (1024 - a0.x))).toBeLessThan(2);
    evidence["t27InMatchSettings"] = { ticksAdvancedWhileOpen: true, leftHandMirrorsHud: true };
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-hud=menu]")).toBeVisible(); // Escape reaches the game after Settings closes
    await page.click("[data-hud=menu] button[data-leave]");
    await expect(page.locator("[data-act=settings]")).toBeVisible();
    await page.click("[data-act=settings]");
    await expect(page.locator("[data-ui=settings]")).toBeVisible();
    await expect(page.locator("button[data-toggle=hand]")).toHaveAttribute("aria-pressed", "true"); // persisted per profile
    await page.click("button[data-act=reset-all]");
    await page.click("button[data-act=close]");
    expect(errors).toEqual([]);
  } finally { await ctx.close(); }
});
