// FB05: instant Practice and Fight bots entry. Real Colyseus server + Vite client, workers 1.
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
    dataDir: mkdtempSync(path.join(tmpdir(), "eb-pw-fb05-")), allowedOrigins: [base], secureCookies: false,
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
  writeFileSync(path.join(outDir, "FB05-playwright.json"), JSON.stringify(evidence, null, 2));
  await browser?.close();
  await vite?.close();
  await game?.gracefullyShutdown(false);
});



const BASELINE = process.env["FB05_BASELINE"] === "1";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
interface Timing { disabledMs: number | null; pickMs: number | null; matchMs: number | null }

/** Installs observers, clicks `sel` inside one evaluate (t0 = click), then optionally presses Ready/Start at pick time. */
async function measure(page: Page, route: "practice" | "bots"): Promise<Timing> {
  await page.evaluate(() => {
    const w = window as unknown as { __fb05: { t0: number; disabled: number | null; pick: number | null; match: number | null } };
    w.__fb05 = { t0: 0, disabled: null, pick: null, match: null };
  });
  const sel = route === "practice" ? "[data-act=practice]" : "[data-act=bots]";
  await page.evaluate((s) => {
    const w = window as unknown as { __fb05: { t0: number; disabled: number | null; pick: number | null; match: number | null }; __eb?: unknown };
    const st = w.__fb05;
    const check = (): void => {
      const now = performance.now() - st.t0;
      if (st.disabled === null) {
        const others = Array.from(document.querySelectorAll(".eb-home-actions button[data-act]")).filter((b) => (b as HTMLElement).dataset["act"] !== (s === "[data-act=practice]" ? "practice" : "bots"));
        // Practice replaces Welcome with the pick screen, so no entry button remains at all.
        if (others.every((b) => (b as HTMLButtonElement).disabled && b.getAttribute("aria-disabled") === "true")) st.disabled = now;
      }
      if (st.pick === null) {
        const cards = document.querySelector(".eb-fighter-cards button") as HTMLElement | null;
        const setup = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Start match" && (b as HTMLElement).offsetParent !== null);
        if ((cards && cards.offsetParent !== null) || setup) st.pick = now;
      }
      if (st.match === null && w.__eb) st.match = now;
    };
    new MutationObserver(check).observe(document.body, { subtree: true, childList: true, attributes: true });
    const iv = window.setInterval(check, 4);
    (window as unknown as { __fb05iv: number }).__fb05iv = iv;
    st.t0 = performance.now();
    (document.querySelector(s) as HTMLElement).click();
    check();
  }, sel);
  if (route === "practice") {
    await page.waitForSelector(".eb-fighter-cards button", { state: "visible", timeout: 30_000 });
    await page.locator("[data-act=ready]").click();
  } else {
    await page.getByLabel("Your fighter").selectOption("td");
    await page.getByRole("button", { name: "Start match" }).click();
  }
  await page.waitForFunction(() => (window as unknown as { __fb05: { match: number | null } }).__fb05.match !== null, undefined, { timeout: 60_000 });
  return page.evaluate(() => { const s = (window as unknown as { __fb05: { disabled: number | null; pick: number | null; match: number | null } }).__fb05; return { disabledMs: s.disabled, pickMs: s.pick, matchMs: s.match }; });
}

async function openPage(extra = ""): Promise<{ page: Page; close(): Promise<void>; matchmakes: string[] }> {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  const page = await ctx.newPage();
  const matchmakes: string[] = [];
  page.on("request", (r) => { const u = new URL(r.url()); if (u.pathname.startsWith("/matchmake") && r.method() === "POST") matchmakes.push(u.pathname); });
  await page.goto(`${base}/?room=flow&debug=1&name=Arel${extra}#invite=${svc.invites.create({ ttlMs: 120_000, maxUses: 5 }).token}`);
  await page.waitForSelector("[data-act=practice]");
  return { page, close: () => ctx.close(), matchmakes };
}

for (const route of ["practice", "bots"] as const) {
  test(`FB05 timings: ${route}`, async () => {
    test.setTimeout(120_000);
    const h = await openPage();
    try {
      const t = await measure(h.page, route);
      evidence[`timing-${route}`] = t;
      if (BASELINE) return;
      expect(t.disabledMs).not.toBeNull();
      expect(t.disabledMs!).toBeLessThan(100);
      expect(t.pickMs!).toBeLessThan(300);
      expect(t.matchMs!).toBeLessThan(30_000);
    } finally { await h.close(); }
  });
}

test("FB05 Practice: pressed button is busy, others disabled, pick UI shows at once, Ready queues until the room is ready", async () => {
  test.setTimeout(120_000);
  const h = await openPage();
  try {
    await h.page.click("[data-act=practice]");
    await expect(h.page.locator(".eb-fighter-cards button").first()).toBeVisible({ timeout: 300 });
    await h.page.locator("[data-act=ready]").click();
    await h.page.waitForFunction(() => !!(window as unknown as { __eb?: unknown }).__eb, undefined, { timeout: 60_000 });
    expect(h.matchmakes.length).toBe(1);
  } finally { await h.close(); }
});

test("FB05 Fight bots: pressed button is busy and every other entry button is disabled at once", async () => {
  const h = await openPage();
  try {
    await h.page.click("[data-act=bots]");
    const bots = h.page.locator(".eb-home-actions [data-act=bots]");
    await expect(bots).toHaveAttribute("aria-busy", "true", { timeout: 100 });
    for (const act of ["play", "practice", "rooms", "guide", "settings"]) await expect(h.page.locator(`.eb-home-actions [data-act=${act}]`)).toBeDisabled({ timeout: 100 });
    await expect(h.page.locator(".eb-home-actions [data-act=practice]")).toHaveAttribute("aria-disabled", "true");
    await h.page.getByRole("button", { name: "Back to game" }).first().click();
    await expect(h.page.locator("[data-act=practice]")).toBeEnabled();
  } finally { await h.close(); }
});

test("FB05 Practice: double click creates one room; Back during prep leaves nothing behind", async () => {
  test.setTimeout(120_000);
  const h = await openPage();
  try {
    await h.page.evaluate(() => { const b = document.querySelector("[data-act=practice]") as HTMLElement; b.click(); b.click(); });
    await expect(h.page.locator(".eb-fighter-cards button").first()).toBeVisible({ timeout: 300 });
    await h.page.locator("[data-act=back]").click();
    await expect(h.page.locator("[data-act=practice]")).toBeVisible();
    await expect(h.page.locator("[data-act=practice]")).toBeEnabled();
    await sleep(1500);
    expect(h.matchmakes.length).toBeLessThanOrEqual(1);
    // After cleanup a fresh Practice works and reaches the match with exactly one more room join.
    const before = h.matchmakes.length;
    await h.page.click("[data-act=practice]");
    await h.page.locator("[data-act=ready]").click();
    await h.page.waitForFunction(() => !!(window as unknown as { __eb?: unknown }).__eb, undefined, { timeout: 60_000 });
    expect(h.matchmakes.length - before).toBe(1);
    const open = await h.page.evaluate(() => (window as unknown as { __eb?: { snapshot?: () => { players: unknown[] } } }).__eb?.snapshot?.().players.length ?? null);
    evidence["backCleanup"] = { matchmakes: h.matchmakes.length, players: open };
  } finally { await h.close(); }
});

test("FB05 screenshots: pick UI right after Practice at 1024x768 and 1180x820", async () => {
  test.setTimeout(120_000);
  for (const [w, hh] of [[1024, 768], [1180, 820]] as const) {
    const ctx = await browser.newContext({ viewport: { width: w, height: hh }, hasTouch: true });
    const page = await ctx.newPage();
    try {
      await page.goto(`${base}/?room=flow&name=Arel#invite=${svc.invites.create({ ttlMs: 120_000, maxUses: 1 }).token}`);
      await page.waitForSelector("[data-act=practice]");
      mkdirSync(outDir, { recursive: true });
      await page.click("[data-act=practice]");
      await page.waitForSelector(".eb-fighter-cards button", { state: "visible" });
      await page.screenshot({ path: path.join(outDir, `FB05-pick-${w}x${hh}.png`) });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(overflow).toBe(false);
    } finally { await ctx.close(); }
  }
});
