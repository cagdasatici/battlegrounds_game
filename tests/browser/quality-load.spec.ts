// QP01: cold/warm production load and repeated join/leave cycles against the real production server (NODE_ENV=production, apps/client/dist).
// Run `pnpm build` first. Desktop Chromium via SwiftShader: sizes are exact, timings and heap are NOT iPad figures. One worker.
import { test, expect, chromium, type Browser, type BrowserContext, type CDPSession, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer as netServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { InviteStore } from "../../apps/server/src/auth/InviteStore.js";
import { resolveChromium } from "./harness/chromium-path.js";
import { evidenceDir } from "./harness/evidence.js";

const root = new URL("../../", import.meta.url).pathname;
const dist = join(root, "apps/client/dist");
const outDir = join(evidenceDir(root), "QP01");
/** D budgets: local design choices, not verified facts. */
const SHELL_GZIP_BUDGET = 1_000_000; // welcome screen: unique responses, gzip bytes
const CYCLES = 10;
const GL_ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];

let child: ChildProcess | null = null, out = "", browser: Browser, origin = "", dataDir = "";
const evidence: Record<string, unknown> = {};

const freePort = (): Promise<number> => new Promise((resolve, reject) => {
  const s = netServer();
  s.listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); });
  s.on("error", reject);
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

interface Fetched { path: string; raw: number; gzip: number; transfer: number }
/** Records each distinct same-origin response once (raw body bytes, gzip -9 of the body, and Chromium's reported transfer size). */
function recorder(page: Page): { list: () => Fetched[]; reset: () => void } {
  const seen = new Map<string, Fetched>();
  const pending: Promise<void>[] = [];
  page.on("response", (res) => {
    const u = new URL(res.url());
    if (u.origin !== origin || u.pathname === "/api/session" || u.pathname.startsWith("/matchmake")) return;
    pending.push((async () => {
      try {
        const body = await res.body();
        const sizes = await res.request().sizes().catch(() => null);
        seen.set(u.pathname, { path: u.pathname, raw: body.length, gzip: gzipSync(body, { level: 9 }).length, transfer: sizes ? sizes.responseBodySize + sizes.responseHeadersSize : 0 });
      } catch { /* redirects and aborted bodies carry nothing */ }
    })());
  });
  return { list: () => [...seen.values()], reset: () => { seen.clear(); } };
}
const sum = (l: Fetched[], k: "raw" | "gzip" | "transfer"): number => l.reduce((a, b) => a + b[k], 0);

test.beforeAll(async () => {
  expect(existsSync(join(dist, "sw.js")), "run pnpm build first").toBe(true);
  const port = await freePort();
  origin = `http://127.0.0.1:${port}`;
  dataDir = mkdtempSync(join(tmpdir(), "eb-qp01-"));
  child = spawn(join(root, "apps/server/node_modules/.bin/tsx"), ["src/main.ts"], {
    cwd: join(root, "apps/server"),
    env: { ...process.env, NODE_ENV: "production", HOST: "127.0.0.1", PORT: String(port), PUBLIC_ORIGIN: origin, EB_ALLOW_HTTP_ORIGIN: "1", DATA_DIR: dataDir, STATIC_DIR: dist, BUILD_ID: "qp01-local" },
  });
  child.stdout?.on("data", (d: Buffer) => { out += d.toString(); });
  child.stderr?.on("data", (d: Buffer) => { out += d.toString(); });
  const t0 = Date.now();
  while (!out.includes("server listening")) {
    if (Date.now() - t0 > 20000) throw new Error("server did not start: " + out);
    await sleep(50);
  }
  browser = await chromium.launch({ executablePath: resolveChromium(), args: GL_ARGS });
});
test.afterAll(async () => {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "qp01-playwright.json"), JSON.stringify(evidence, null, 2));
  await browser?.close();
  if (child) { const c = child; child = null; const exited = new Promise((r) => c.once("exit", r)); c.kill("SIGTERM"); await exited; }
});

const invite = (): string => new InviteStore(join(dataDir, "invites.json")).create({ ttlMs: 120_000, maxUses: 1 }).token;

test("cold then warm load: the welcome screen needs no renderer chunk and fits the shell budget", async () => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  const page = await ctx.newPage();
  const rec = recorder(page);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  try {
    const t0 = Date.now();
    await page.goto(`${origin}/?debug=1&name=Arel#invite=${invite()}`);
    await page.waitForSelector("[data-act=play]");
    const coldMs = Date.now() - t0;
    await sleep(500); // let late same-tick responses land
    const cold = rec.list().filter((f) => f.path !== "/sw.js");
    const coldJs = cold.filter((f) => f.path.endsWith(".js"));
    // The renderer/physics chunk must not be on the welcome path.
    expect(cold.some((f) => /gameRuntime/.test(f.path)), "renderer chunk loaded before Play").toBe(false);
    expect(sum(cold, "gzip")).toBeLessThanOrEqual(SHELL_GZIP_BUDGET);
    evidence["coldWelcome"] = { responses: cold.length, rawBytes: sum(cold, "raw"), gzipBytes: sum(cold, "gzip"), transferBytes: sum(cold, "transfer"), jsGzipBytes: sum(coldJs, "gzip"), msToInteractive: coldMs, files: cold };

    // Play-to-first-frame: Practice then Ready, count what gets fetched in addition.
    rec.reset();
    const tPlay = Date.now();
    await page.click("[data-act=practice]");
    await expect(page.locator("[data-ui=room-status]")).toContainText("training dummy");
    await page.click("[data-act=ready]");
    await page.waitForFunction(() => (window as unknown as { __eb?: unknown }).__eb !== undefined, undefined, { timeout: 30_000 });
    const playMs = Date.now() - tPlay;
    await sleep(500);
    const p0 = rec.list();
    expect(p0.some((f) => /gameRuntime/.test(f.path))).toBe(true);
    evidence["playToFirstFrame"] = { responses: p0.length, rawBytes: sum(p0, "raw"), gzipBytes: sum(p0, "gzip"), transferBytes: sum(p0, "transfer"), msFromClick: playMs, files: p0.map((f) => ({ path: f.path, gzip: f.gzip })) };

    // P1: everything the worker has cached once installed (includes PWA assets).
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    const cached = await until(async () => {
      const list = await page.evaluate(async () => {
        const r: { path: string; raw: number }[] = [];
        for (const k of await caches.keys()) { const c = await caches.open(k); for (const q of await c.keys()) { const res = await c.match(q); r.push({ path: new URL(q.url).pathname, raw: (await res!.clone().arrayBuffer()).byteLength }); } }
        return r;
      });
      return list.some((x) => x.path === "/asset-manifest.json" || x.path.endsWith(".png")) && list.length > 25 ? list : null;
    }, 30_000, "service worker precache complete");
    evidence["p1Cache"] = { entries: cached.length, rawBytes: cached.reduce((a, b) => a + b.raw, 0) };

    // Warm profile: same context (worker controls the page), fresh navigation. Nothing renderer-related may be refetched from the network.
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /leave/i }).click();
    await expect(page.locator("[data-act=practice]")).toBeVisible();
    await page.goto("about:blank");
    const network: string[] = [];
    const onReq = (r: { url(): string }): void => { network.push(new URL(r.url()).pathname); };
    ctx.on("request", onReq);
    const tWarm = Date.now();
    await page.goto(`${origin}/?debug=1&name=Arel#invite=${invite()}`);
    await page.waitForSelector("[data-act=play]");
    const warmMs = Date.now() - tWarm;
    await sleep(500);
    ctx.off("request", onReq);
    evidence["warmWelcome"] = { msToInteractive: warmMs, requestsSeenByPage: network.length, paths: [...new Set(network)] };
    expect(errors).toEqual([]);
  } finally { await ctx.close(); }
});

interface CycleSample {
  cycle: number; heapUsedMB: number; jsEventListeners: number; domNodes: number; audioContextsCreated: number; audioContextsOpen: number;
  inMatch: { geometries: number | null; calls: number | null; fxActive: number; projectiles: number; urns: number; players: number };
}

async function metrics(cdp: CDPSession): Promise<{ heap: number; listeners: number; nodes: number }> {
  await cdp.send("HeapProfiler.collectGarbage");
  await cdp.send("HeapProfiler.collectGarbage");
  const m = (await cdp.send("Performance.getMetrics")).metrics;
  const get = (n: string): number => m.find((x) => x.name === n)?.value ?? 0;
  return { heap: get("JSHeapUsedSize"), listeners: get("JSEventListeners"), nodes: get("Nodes") };
}

test("ten complete practice join/leave cycles leave listeners, scene objects, audio contexts and heap flat", async () => {
  test.setTimeout(600_000);
  const ctx: BrowserContext = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  await ctx.addInitScript(() => {
    const W = window as unknown as { AudioContext?: new () => { close(): Promise<void>; state: string }; __ac: { created: number; open: number } };
    W.__ac = { created: 0, open: 0 };
    const Orig = W.AudioContext;
    if (!Orig) return;
    W.AudioContext = class extends Orig {
      constructor() {
        super();
        W.__ac.created++; W.__ac.open++;
        const close = this.close.bind(this);
        let closed = false;
        this.close = (): Promise<void> => { if (!closed) { closed = true; W.__ac.open--; } return close(); };
      }
    } as never;
  });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Performance.enable");
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const samples: CycleSample[] = [];
  const count = (re: RegExp): number => (out.match(re) ?? []).length;
  const joins0 = count(/player joined/g), lefts0 = count(/player left/g); // earlier tests in this file also join
  try {
    await page.goto(`${origin}/?debug=1&name=Arel&kit=sv#invite=${invite()}`);
    await page.waitForSelector("[data-act=practice]");
    for (let cycle = 0; cycle <= CYCLES; cycle++) { // cycle 0 is warmup (shaders, caches, lazy chunk); samples start at cycle 1
      await page.click("[data-act=practice]");
      await expect(page.locator("[data-ui=room-status]")).toContainText("training dummy");
      await page.click("[data-act=ready]");
      await page.waitForFunction(() => (window as unknown as { __eb?: unknown }).__eb !== undefined, undefined, { timeout: 30_000 });
      const snap = await until(async () => {
        const s = await page.evaluate(() => (window as unknown as { __eb: { snapshot(): any } }).__eb.snapshot()); // eslint-disable-line @typescript-eslint/no-explicit-any
        return s.players.some((p: { local: boolean; action: string }) => p.local && p.action === "Idle") ? s : null;
      }, 20_000, "local Idle");
      await sleep(1000); // settled in-match point
      const inMatch = await page.evaluate(() => {
        const s = (window as unknown as { __eb: { snapshot(): any } }).__eb.snapshot(); // eslint-disable-line @typescript-eslint/no-explicit-any
        return { geometries: s.render?.geometries ?? null, calls: s.render?.calls ?? null, fxActive: s.fx.active, projectiles: s.projectiles.length ?? 0, urns: s.urns.length ?? 0, players: s.players.length };
      });
      void snap;
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: /leave/i }).click();
      await expect(page.locator("[data-act=practice]")).toBeVisible();
      await sleep(1500); // settled welcome point
      const m = await metrics(cdp);
      const ac = await page.evaluate(() => (window as unknown as { __ac: { created: number; open: number } }).__ac);
      if (cycle >= 1) samples.push({ cycle, heapUsedMB: +(m.heap / 1048576).toFixed(2), jsEventListeners: m.listeners, domNodes: m.nodes, audioContextsCreated: ac.created, audioContextsOpen: ac.open, inMatch });
    }
    evidence["cycles"] = samples;
    await until(async () => count(/player left/g) - lefts0 === CYCLES + 1 || null, 5000, "server saw every leave");
    evidence["serverLog"] = { joins: count(/player joined/g) - joins0, lefts: count(/player left/g) - lefts0, expected: CYCLES + 1 };
    expect(errors).toEqual([]);
    expect(count(/player joined/g) - joins0).toBe(CYCLES + 1);

    const first = samples[0]!, last = samples[samples.length - 1]!;
    // Residual subscriptions or growing object counts fail even if the heap passes.
    const strictlyGrowing = (f: (s: CycleSample) => number): boolean => samples.every((s, i) => i === 0 || f(s) > f(samples[i - 1]!));
    for (const [name, f] of [
      ["jsEventListeners", (s: CycleSample) => s.jsEventListeners], ["domNodes", (s: CycleSample) => s.domNodes],
      ["audioContextsOpen", (s: CycleSample) => s.audioContextsOpen], ["geometries", (s: CycleSample) => s.inMatch.geometries ?? 0],
      ["fxActive", (s: CycleSample) => s.inMatch.fxActive],
    ] as const) {
      expect(strictlyGrowing(f), `${name} grows every cycle`).toBe(false);
      expect(f(last), `${name} last vs first`).toBeLessThanOrEqual(f(first));
    }
    expect(last.audioContextsOpen).toBe(0);
    expect(last.inMatch.players).toBe(first.inMatch.players);
    const growth = last.heapUsedMB - first.heapUsedMB;
    evidence["heapGrowthMB"] = +growth.toFixed(2);
    expect(growth, "heap growth over ten cycles (D budget 10 MB)").toBeLessThanOrEqual(10);
  } finally { await ctx.close(); }
});
