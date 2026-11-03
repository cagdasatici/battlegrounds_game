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
const outDir = evidenceDir(root);
const req = createRequire(path.join(root, "apps/client/package.json"));
import { resolveChromium } from "./harness/chromium-path.js";
import { evidenceDir } from "./harness/evidence.js";
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
  writeFileSync(path.join(outDir, "UX03-playwright.json"), JSON.stringify(evidence, null, 2));
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


test("UX03: home, settings and setup fit both landscape sizes with visible selection", async () => {
  const { ctx, page, errors } = await open("&name=Arel");
  try {
    for (const [width, height] of [[1024, 768], [1180, 820]]) {
      await page.setViewportSize({ width: width!, height: height! });
      await expect(page.locator("[data-ui=admin-link]")).toBeVisible();
      await page.screenshot({ path: path.join(outDir, `UX03-home-${width}.png`) });
      await page.click("[data-act=settings]");
      const panel = page.locator("[data-ui=settings]");
      await expect(panel.getByRole("heading", { name: "Graphics & comfort" })).toBeVisible();
      await panel.locator("[data-quality=high]").click();
      await expect(panel.locator("[data-quality=high]")).toHaveAttribute("aria-pressed", "true");
      await expect.poll(async () => panel.locator("[data-quality]").evaluateAll(els => getComputedStyle(els[0]!).borderColor !== getComputedStyle(els[2]!).borderColor)).toBe(true);
      await page.screenshot({ path: path.join(outDir, `UX03-settings-${width}.png`) });
      expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      await panel.locator("[data-act=close]").click();
    }
    await page.getByRole("button", { name: "Host sparring", exact: true }).click();
    await expect(page.getByRole("button", { name: "Add opponent", exact: true })).toBeVisible();
    await page.screenshot({ path: path.join(outDir, "UX03-host.png") });
    await page.getByRole("button", { name: "Back to game", exact: true }).first().click();
    expect(errors).toEqual([]);
  } finally { await ctx.close(); }
});

test("UX02: practice adds and removes server bots from the visible controls", async () => {
  const { ctx, page, errors } = await open("&name=Arel");
  try {
    await page.click("[data-act=practice]"); await page.click("[data-act=ready]");
    await page.waitForFunction(() => (window as unknown as { __eb?: unknown }).__eb !== undefined, undefined, { timeout: 30000 });
    await page.getByLabel("Opponent difficulty").selectOption("hard");
    await page.getByRole("button", { name: "Add bot", exact: true }).click();
    await expect(page.locator("[data-ui=practice]")).toContainText("1/2 active bots");
    await page.screenshot({ path: path.join(outDir, "UX03-practice.png") });
    await page.getByLabel("Opponent difficulty").selectOption("easy");
    await expect(page.locator("[data-ui=practice]")).toContainText("1/2 active bots · easy");
    await page.getByRole("button", { name: "Remove bots", exact: true }).click();
    await expect(page.locator("[data-ui=practice]")).toContainText("0/2 active bots");
    expect(errors).toEqual([]);
  } finally { await ctx.close(); }
});

test("UX04: settings affect live input, graphics status and music, survive closing and reopening", async () => {
  const { ctx, page, errors } = await open("&name=Arel");
  try {
    await page.click("[data-act=practice]"); await page.click("[data-act=ready]");
    await page.waitForFunction(() => (window as unknown as { __eb?: unknown }).__eb !== undefined, undefined, { timeout: 30000 });
    await page.keyboard.press("Escape"); await page.click("[data-settings]");
    const panel = page.locator("[data-ui=settings]");
    for (const toggle of ["autoRun", "quickUse", "facingLock"]) await panel.locator(`[data-toggle=${toggle}]`).click();
    await panel.locator("[data-quality=high]").click();
    await expect(panel.locator("[data-ui=quality-status]")).toContainText("software rendering");
    await expect(panel.locator("[data-ui=settings-message]")).toContainText("Graphics high selected");
    await page.screenshot({ path: path.join(outDir, "UX04-settings.png") });
    await panel.locator("[data-act=close]").click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __eb: { snapshot(): { preferences: unknown } } }).__eb.snapshot().preferences)).toEqual({ autoRun: true, quickUse: false, facingLock: true });
    await expect.poll(() => page.evaluate(() => (window as unknown as { __ebAudio: { audio: { musicPlaying: boolean } } }).__ebAudio.audio.musicPlaying)).toBe(true);
    await page.keyboard.press("Escape"); await page.click("[data-settings]");
    await panel.locator("[data-k=musicVolume]").fill("0");
    await expect.poll(() => page.evaluate(() => (window as unknown as { __ebAudio: { audio: { musicPlaying: boolean } } }).__ebAudio.audio.musicPlaying)).toBe(false);
    await page.keyboard.press("Escape"); await expect(panel).toBeHidden();
    expect(errors).toEqual([]);
  } finally { await ctx.close(); }
});

test("UX07: move guide explains base and awakened skills without casting; HUD keeps full names", async () => {
  const { ctx, page, errors } = await open("&name=Arel");
  try {
    await page.click("[data-act=practice]"); await page.click("[data-act=ready]");
    await page.waitForFunction(() => (window as unknown as { __eb?: unknown }).__eb !== undefined, undefined, { timeout: 30000 });
    await expect(page.locator("[data-control=skill2]")).toContainText("Gravel Flurry");
    await expect(page.locator("[data-control=skill3]")).toContainText("Reflect");
    await page.getByRole("button", { name: "Moves & ranges", exact: true }).click();
    const guide = page.getByRole("dialog", { name: "Moves & ranges", exact: true });
    await expect(guide.locator("article")).toHaveCount(4);
    await expect(guide).toContainText("narrow ground wave continues 8 m");
    await page.screenshot({ path: path.join(outDir, "UX07-move-guide.png") });
    await guide.getByRole("button", { name: "Awakened", exact: true }).click();
    await expect(guide).toContainText("20 m wide and 24 m ahead");
    await page.screenshot({ path: path.join(outDir, "UX07-awakened-guide.png") });
    await page.keyboard.press("Escape"); await expect(guide).toBeHidden();
    await page.screenshot({ path: path.join(outDir, "UX07-hud.png") });
    expect(errors).toEqual([]);
  } finally { await ctx.close(); }
});

test("UX08: returning to the bookmarked root uses the saved player session", async () => {
  const { ctx, page, errors } = await open("&name=Arel");
  try {
    await page.click("[data-act=practice]"); await page.click("[data-act=ready]");
    await page.waitForFunction(() => (window as unknown as { __eb?: unknown }).__eb !== undefined, undefined, { timeout: 30000 });
    await page.keyboard.press("Escape"); await page.click("[data-leave]");
    await expect(page.locator("[data-act=practice]")).toBeVisible();
    await page.goto(`${base}/?debug=1`);
    expect(new URL(page.url()).hash).toBe("");
    await page.click("[data-act=practice]");
    await expect(page.locator("[data-ui=room-status]")).toContainText("training dummy");
    expect(errors).toEqual([]);
  } finally { await ctx.close(); }
});
test("UX08: host setup includes Ember Artificer and starts the actual server fighter", async () => {
  const { ctx, page, errors } = await open("&name=Arel");
  try {
    await page.getByRole("button", { name: "Host sparring", exact: true }).click();
    await page.getByLabel("Your fighter").selectOption("ea");
    await page.getByRole("button", { name: "Start match", exact: true }).click();
    await page.waitForFunction(() => (window as unknown as { __eb?: unknown }).__eb !== undefined, undefined, { timeout: 30000 });
    await expect.poll(async () => (await snap(page)).players.find(p => p.local)?.kitId).toBe("ea");
    expect(errors).toEqual([]);
  } finally { await ctx.close(); }
});
