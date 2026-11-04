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
    await expect(guide.getByText("Host sparring to fight bots", { exact: false })).toBeVisible();
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
        await sleep(400); // the first frames after Ready keep the input gate closed; an earlier press is ignored by design (GR05)
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

// GR12: Welcome hierarchy and the three entry routes.
async function welcome(vp = { width: 1024, height: 768 }, invited = true): Promise<{ ctx: import("@playwright/test").BrowserContext; page: Page; errors: string[] }> {
  const ctx = await browser.newContext({ viewport: vp, hasTouch: true });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const hash = invited ? `#invite=${svc.invites.create({ ttlMs: 120_000, maxUses: 1 }).token}` : "";
  await page.goto(`${base}/?room=flow&name=Arel&kit=sv${hash}`);
  await page.waitForSelector("[data-act=play]");
  return { ctx, page, errors };
}

test("Welcome hierarchy: one primary, Practice and Fight bots, then room, guide and settings; no floating launchers", async () => {
  const { ctx, page, errors } = await welcome();
  try {
    await expect(page.locator("[data-act=play]")).toHaveText("Play with friends");
    await expect(page.locator(".eb-mode-row [data-act=practice]")).toHaveText("Practice");
    await expect(page.locator(".eb-mode-row [data-act=bots]")).toHaveText("Fight bots");
    for (const [act, text] of [["rooms", "Find a room"], ["guide", "How to play"], ["settings", "Settings"]] as const) await expect(page.locator(`.eb-more-row [data-act=${act}]`)).toHaveText(text);
    await expect(page.locator("[data-ui=admin-link]")).toBeVisible();
    await expect(page.locator("[data-ui=presets]")).toHaveText("Choose the name shown in the arena.");
    await expect(page.locator("body")).not.toContainText("invitation unlocks");
    await expect(page.locator(".eb-launcher:visible")).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally { await ctx.close(); }
});

test("Welcome routes reach the intended modes: Play with friends, Practice, Fight bots (one medium bot, endless)", async () => {
  test.setTimeout(120_000);
  const { ctx, page, errors } = await welcome();
  try {
    await page.click("[data-act=play]");
    await expect(page.locator("[data-ui=room-status]")).toContainText("Players seated");
    await page.click("[data-act=back]");
    await expect(page.locator("[data-act=practice]")).toBeVisible();
    await page.click("[data-act=practice]");
    await expect(page.locator("[data-ui=room-status]")).toContainText("training dummy");
    await page.click("[data-act=back]");
    await page.click("[data-act=bots]");
    const setup = page.locator("[data-ui=sparring-setup]");
    await expect(setup).toBeVisible();
    await expect(setup.getByLabel("Bot 1 difficulty")).toHaveValue("medium");
    await expect(setup.getByLabel("Bot 2 difficulty")).toHaveCount(0);
    await expect(setup.getByLabel("Round length")).toHaveValue("0");
    evidence["routes"] = { play: "Private arena", practice: "Practice room", bots: "setup medium x1 endless" };
    expect(errors).toEqual([]);
  } finally { await ctx.close(); }
});

test("Double click on Play with friends makes one authentication attempt and one join", async () => {
  test.setTimeout(60_000);
  const { ctx, page, errors } = await welcome();
  try {
    const urls = net(page);
    await page.locator("[data-act=play]").dblclick();
    await expect(page.locator("[data-ui=room-status]")).toContainText("Players seated");
    expect(urls.filter((u) => u === "/api/session" || u === "/api/open-session").length).toBe(1);
    expect(urls.filter((u) => u.startsWith("/matchmake/")).length).toBeLessThanOrEqual(2); // one seat reservation; a consume is a separate request
    evidence["doubleClick"] = { requests: urls };
    expect(errors).toEqual([]);
  } finally { await ctx.close(); }
});

test("Throttled assets show Preparing arena…, controls are inert, then Joining arena… and the lobby", async () => {
  test.setTimeout(60_000);
  const { ctx, page, errors } = await welcome();
  try {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => { release = r; });
    await page.route(/islands\.v1.*\.json/, async (route) => { await gate; await route.continue(); });
    await page.click("[data-act=play]");
    const status = page.locator("[data-ui=status]");
    await expect(status).toHaveText("Preparing arena…");
    for (const b of await page.locator(".eb-screen button").all()) await expect(b).toBeDisabled();
    release();
    await expect(page.locator("[data-ui=room-status]")).toContainText("Players seated");
    evidence["busy"] = { preparing: true };
    expect(errors).toEqual([]);
  } finally { await ctx.close(); }
});

test("A held network join shows Joining arena… with inert controls", async () => {
  test.setTimeout(60_000);
  const { ctx, page, errors } = await welcome();
  try {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => { release = r; });
    await page.route("**/matchmake/**", async (route) => { await gate; await route.continue(); });
    await page.click("[data-act=play]");
    await expect(page.locator("[data-ui=status]")).toHaveText("Joining arena…", { timeout: 30_000 });
    await expect(page.locator("[data-act=play]")).toBeDisabled();
    release();
    await expect(page.locator("[data-ui=room-status]")).toContainText("Players seated");
    expect(errors).toEqual([]);
  } finally { await ctx.close(); }
});

test("Asset failure restores Retry and Back after the busy state", async () => {
  test.setTimeout(60_000);
  const { ctx, page } = await welcome();
  try {
    let failures = 1;
    await page.route(/islands\.v1.*\.json/, async (route) => { if (failures-- > 0) await route.abort(); else await route.continue(); });
    await page.click("[data-act=play]");
    await expect(page.locator("[data-ui=error]")).toHaveAttribute("data-code", "ASSET_FAILED");
    await expect(page.locator("[data-act=retry]")).toBeEnabled();
    await expect(page.locator("[data-act=back]")).toBeEnabled();
    await page.click("[data-act=retry]");
    await expect(page.locator("[data-ui=room-status]")).toContainText("Players seated", { timeout: 20_000 });
  } finally { await ctx.close(); }
});

for (const vp of [{ width: 1024, height: 768 }, { width: 1180, height: 820 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
  test(`Welcome fits ${vp.width}x${vp.height} with no horizontal scroll`, async () => {
    const { ctx, page } = await welcome(vp);
    try {
      const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, bw: document.body.scrollWidth }));
      expect(m.sw).toBeLessThanOrEqual(m.iw); expect(m.bw).toBeLessThanOrEqual(m.iw);
      await page.screenshot({ path: path.join(outDir, `GR12-welcome-${vp.width}x${vp.height}.png`) });
    } finally { await ctx.close(); }
  });
}
