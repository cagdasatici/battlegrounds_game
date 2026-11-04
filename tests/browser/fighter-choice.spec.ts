// GR12: informed fighter choice. Real Colyseus server in-process, real client served by Vite, same origin, workers 1.
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
    dataDir: mkdtempSync(path.join(tmpdir(), "eb-pw-fighter-choice-")), allowedOrigins: [base], secureCookies: false,
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
  writeFileSync(path.join(outDir, "GR12-fighter-choice-playwright.json"), JSON.stringify(evidence, null, 2));
  await browser?.close();
  await vite?.close();
  await game?.gracefullyShutdown(false);
});



const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const snap = (p: Page): Promise<Snap> => p.evaluate(() => (window as unknown as { __eb: { snapshot(): unknown } }).__eb.snapshot() as never);

const CHOICES = {
  sv: { name: "Stone Vanguard", role: "Heavy close-range strikes", tip: "Face your rival before committing. Your awakening spends one finisher." },
  td: { name: "Tide Duelist", role: "Grabs, throws and counters", tip: "Get close, catch a rival, or wait for an attack to counter." },
  ea: { name: "Ember Artificer", role: "Charges, rushes and beams", tip: "Hold Ember Orb to charge. Use distance and cover to shape the fight." },
} as const;
type Kit = keyof typeof CHOICES;

async function open(vp: { width: number; height: number }, opts: { reduced?: boolean; stored?: string; touch?: boolean } = {}): Promise<{ ctx: BrowserContext; page: Page; errors: string[] }> {
  const ctx = await browser.newContext({ viewport: vp, hasTouch: opts.touch ?? false, reducedMotion: opts.reduced ? "reduce" : "no-preference" });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  // Count every canvas that ever asks for a WebGL context: one renderer means one.
  await page.addInitScript((stored) => {
    const w = window as unknown as { __gl: Set<HTMLCanvasElement> };
    w.__gl = new Set();
    const orig = HTMLCanvasElement.prototype.getContext;
    (HTMLCanvasElement.prototype as unknown as { getContext: unknown }).getContext = function (this: HTMLCanvasElement, t: string, ...a: unknown[]) {
      if (/webgl/.test(t)) w.__gl.add(this);
      return (orig as (...x: unknown[]) => unknown).call(this, t, ...a);
    };
    if (stored) try { localStorage.setItem("eb.settings.v1.Arel", stored); } catch { /* storage blocked */ }
  }, opts.stored ?? null);
  const { token } = svc.invites.create({ ttlMs: 120_000, maxUses: 1 });
  await page.goto(`${base}/?room=flow&name=Arel&kit=sv&debug=1#invite=${token}`);
  await page.waitForSelector("[data-act=play]");
  return { ctx, page, errors };
}
/** First entry loads the renderer and map (slow on software GL), so wait generously for the lobby. */
const enterLobby = async (p: Page): Promise<void> => { await p.click("[data-act=play]"); await p.waitForSelector("[data-act=ready]", { timeout: 60_000 }); };
const glCount = (p: Page): Promise<number> => p.evaluate(() => [...(window as unknown as { __gl: Set<HTMLCanvasElement> }).__gl].filter((c) => c.isConnected).length) /* detached capability-probe canvases are not renderers */;
const previewShot = async (p: Page): Promise<Buffer> => {
  const box = (await p.locator("[data-ui=fighter-preview]").boundingBox())!;
  return p.screenshot({ clip: box });
};

test("Lobby cards show verbatim role and tip, select each kit, preview follows, Ready sends the same kit", async () => {
  test.setTimeout(180_000);
  const { ctx, page, errors } = await open({ width: 1024, height: 768 });
  const seen: Record<string, unknown> = {};
  try {
    await enterLobby(page);
    await expect(page.locator("[data-ui=room-status]")).toContainText("Players seated");
    const preview = page.locator("[data-ui=fighter-preview]");
    const box = (await preview.boundingBox())!;
    expect([Math.round(box.width), Math.round(box.height)]).toEqual([220, 200]);
    for (const k of ["sv", "td", "ea"] as Kit[]) {
      const c = CHOICES[k];
      const card = page.locator(`[data-act=kit][data-kit=${k}]`);
      await expect(card.locator(".eb-card-name")).toHaveText(c.name);
      await expect(card.locator(".eb-card-role")).toHaveText(c.role);
      await expect(card.locator(".eb-card-tip")).toHaveText(c.tip);
    }
    const shots: Record<string, Buffer> = {};
    for (const k of ["ea", "td", "sv"] as Kit[]) {
      await page.click(`[data-act=kit][data-kit=${k}]`);
      await expect(page.locator(`[data-act=kit][data-kit=${k}]`)).toHaveAttribute("aria-pressed", "true");
      await expect(preview).toHaveAttribute("data-model-kit", k);
      await expect(page.locator("[data-ui=moves]")).toContainText("Moves:");
      shots[k] = await previewShot(page);
    }
    expect(shots["ea"]!.equals(shots["td"]!)).toBe(false);
    expect(shots["td"]!.equals(shots["sv"]!)).toBe(false);
    // Ready sends the selected kit; the server state agrees.
    await page.click("[data-act=kit][data-kit=td]");
    await page.click("[data-act=ready]");
    await page.waitForFunction(() => (window as unknown as { __eb?: unknown }).__eb !== undefined, undefined, { timeout: 30_000 });
    const me = (await snap(page)).players.find((p) => p.local)!;
    expect(me.kitId).toBe("td");
    // The preview fighter is released once the match starts.
    await expect(preview).toHaveCount(0);
    expect(await glCount(page)).toBe(1);
    seen["serverKit"] = me.kitId;
    evidence["cards"] = seen;
    expect(errors).toEqual([]);
  } finally { await ctx.close(); }
});

test("One WebGL renderer through three lobby/match cycles", async () => {
  test.setTimeout(240_000);
  const { ctx, page, errors } = await open({ width: 1024, height: 768 });
  try {
    const counts: number[] = [];
    for (let cycle = 0; cycle < 3; cycle++) {
      await enterLobby(page);
      await expect(page.locator("[data-ui=fighter-preview]")).toHaveAttribute("data-model-kit", "sv");
      counts.push(await glCount(page), await page.locator("canvas").count());
      await page.click("[data-act=ready]");
      await page.waitForFunction(() => (window as unknown as { __eb?: unknown }).__eb !== undefined, undefined, { timeout: 30_000 });
      counts.push(await glCount(page), await page.locator("canvas").count());
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: /leave/i }).click();
      await expect(page.locator("[data-act=play]")).toBeVisible();
    }
    expect(counts, "glContexts and canvases at each lobby and match").toEqual(Array(counts.length).fill(1));
    evidence["rendererCounts"] = counts;
    expect(errors).toEqual([]);
  } finally { await ctx.close(); }
});

for (const mode of ["os", "saved"] as const) {
  test(`Reduced motion (${mode}) holds the preview still; normal motion turns it`, async () => {
    test.setTimeout(120_000);
    const stored = mode === "saved" ? JSON.stringify({ v: 2, sensitivity: 1, cameraDistance: 6.5, facingLock: false, quickUse: true, autoRun: false, handedness: "right", effectsVolume: 0.8, musicVolume: 0.5, quality: "medium", reducedMotion: true, flashLevel: 0.3, damageNumbers: true, combatText: "all", layouts: { wide: { opacity: 0.9, controls: {} }, compact: { opacity: 0.9, controls: {} } } }) : undefined;
    const { ctx, page } = await open({ width: 1024, height: 768 }, { reduced: mode === "os", ...(stored ? { stored } : {}) });
    try {
      await enterLobby(page);
      const preview = page.locator("[data-ui=fighter-preview]");
      await expect(preview).toHaveAttribute("data-model-kit", "sv");
      await expect(preview).toHaveAttribute("data-animating", "false");
      const a = await previewShot(page); await sleep(900); const b = await previewShot(page);
      expect(a.equals(b)).toBe(true);
      evidence[`reduced-${mode}`] = { still: true };
    } finally { await ctx.close(); }
  });
}
test("Normal motion turns the preview", async () => {
  const { ctx, page } = await open({ width: 1024, height: 768 });
  try {
    await enterLobby(page);
    const preview = page.locator("[data-ui=fighter-preview]");
    await expect(preview).toHaveAttribute("data-animating", "true");
    const a = await previewShot(page); await sleep(900); const b = await previewShot(page);
    expect(a.equals(b)).toBe(false);
  } finally { await ctx.close(); }
});

for (const vp of [{ width: 1024, height: 768 }, { width: 1180, height: 820 }]) {
  for (const hand of ["right", "left"] as const) {
    test(`Lobby fits ${vp.width}x${vp.height}, ${hand}-handed: no horizontal scroll, preview clear of cards`, async () => {
      test.setTimeout(120_000);
      const stored = JSON.stringify({ v: 2, sensitivity: 1, cameraDistance: 6.5, facingLock: false, quickUse: true, autoRun: false, handedness: hand, effectsVolume: 0.8, musicVolume: 0.5, quality: "medium", reducedMotion: hand === "left", flashLevel: 0.3, damageNumbers: true, combatText: "all", layouts: { wide: { opacity: 0.9, controls: {} }, compact: { opacity: 0.9, controls: {} } } });
      const { ctx, page, errors } = await open(vp, { stored, reduced: hand === "left" });
      try {
        await enterLobby(page);
        await expect(page.locator("[data-ui=fighter-preview]")).toHaveAttribute("data-model-kit", "sv");
        const m = await page.evaluate(() => {
          const r = (s: string) => { const b = document.querySelector(s)!.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
          const cards = [...document.querySelectorAll("[data-act=kit]")].map((e) => { const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, over: e.scrollWidth > e.clientWidth + 1 }; });
          return { sw: document.documentElement.scrollWidth, iw: innerWidth, pv: r("[data-ui=fighter-preview]"), cards, ready: r("[data-act=ready]") };
        });
        expect(m.sw).toBeLessThanOrEqual(m.iw);
        for (const c of m.cards) {
          expect(c.over).toBe(false);
          const apart = c.l >= m.pv.r || c.r <= m.pv.l || c.t >= m.pv.b || c.b <= m.pv.t;
          expect(apart).toBe(true);
        }
        expect(m.pv.l).toBeGreaterThanOrEqual(0); expect(m.pv.r).toBeLessThanOrEqual(m.iw);
        await page.screenshot({ path: path.join(outDir, `GR12-lobby-${hand}-${vp.width}x${vp.height}.png`) });
        evidence[`fit-${hand}-${vp.width}`] = m;
        expect(errors).toEqual([]);
      } finally { await ctx.close(); }
    });
  }
}
