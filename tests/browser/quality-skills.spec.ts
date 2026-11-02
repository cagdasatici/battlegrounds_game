// Quality skills (QV03..): real Chromium + Colyseus. Cast phases are set on the server fighter by a fixture; replication, rendering and cleanup are real.
import { test, expect, chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { createServer as netServer } from "node:net";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { matchMaker, type Server } from "colyseus";
import type { ArenaRoom } from "../../apps/server/src/rooms/ArenaRoom.js";
import { createGameServer } from "../../apps/server/src/createServer.js";
import { createAuthServices, type AuthServices } from "../../apps/server/src/auth/Services.js";
import { resolveChromium } from "./harness/chromium-path.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const req = createRequire(path.join(root, "apps/client/package.json"));
const CHROMIUM = resolveChromium();
const GL_ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];

interface Dev { close(): Promise<void>; listen(): Promise<unknown> }

interface Tele { key: string; phase: string; progress: number; length: number; kind: string }
interface Snap { telegraphs: { capacity: number; active: number; dropped: number; history: string[]; entries: Tele[] } | null; localEntityId: number | null; fx: { active: number; capacity: number }; render: { geometries: number } | null; players: { entityId: number; ready: boolean }[] }

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
    roomCodes: { match: "arena" }, buildId: "test", sessionsPerMinute: 10_000, globalSessionsPerMinute: 10_000,
  });
  game = createGameServer(svc);
  await game.listen(gamePort, undefined, undefined);
  const target = `http://127.0.0.1:${gamePort}`;
  const v = req("vite") as { createServer(c: unknown): Promise<Dev> };
  vite = await v.createServer({
    root: path.join(root, "apps/client"), configFile: false, logLevel: "error",
    server: { port: vitePort, strictPort: true, host: "127.0.0.1", fs: { strict: false },
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
async function open(name: string, kit: string): Promise<{ ctx: BrowserContext; page: Page; errors: string[] }> {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  const { token } = svc.invites.create({ ttlMs: 120_000, maxUses: 1 });
  await page.goto(`${base}/?room=match&name=${name}&kit=${kit}&debug=1&auto=1#invite=${token}`);
  await page.waitForFunction(() => (window as unknown as { __eb?: unknown }).__eb !== undefined, undefined, { timeout: 30_000 });
  return { ctx, page, errors };
}

test("QV03: Fault Strike windup, contact and settling layers appear from the replicated phase and drain", async () => {
  test.setTimeout(120_000);
  const A = await open("Sven", "sv");
  const B = await open("Nora", "ea");
  try {
    await until(async () => (await snap(B.page)).players.filter((p) => p.ready).length === 2, 15000, "both ready");
    const listings = await matchMaker.query({ name: "arena" });
    const arena = matchMaker.getLocalRoomById(listings[0]!.roomId) as unknown as ArenaRoom;
    const aId = await until(async () => (await snap(A.page)).localEntityId, 10000, "A id");
    const fa = arena.combat.get(aId)!;
    const cast = (action: string) => { const tick = arena.sim.tick; fa.action = action as never; fa.moveId = "sv.b1"; fa.actionStartTick = tick; fa.actionEndTick = tick + 1000; };
    const idle = () => { fa.action = "Idle" as never; fa.moveId = ""; fa.actionEndTick = Number.MAX_SAFE_INTEGER; };
    const fxActive = (p: Page) => snap(p).then((s) => s.fx.active);
    await until(async () => (await fxActive(B.page)) === 0, 8000, "quiet pool");
    cast("Windup");
    const windup = await until(async () => { const n = await fxActive(B.page); return n > 0 ? n : false; }, 8000, "windup ring seen by the observer");
    expect(windup).toBeLessThanOrEqual(12); // grounded ring only, no active layers yet
    cast("Active");
    const active = await until(async () => { const n = await fxActive(B.page); return n > windup ? n : false; }, 8000, "contact and settling layers");
    expect(active).toBeGreaterThan(windup);
    idle();
    await until(async () => (await fxActive(B.page)) === 0, 8000, "particles drain after the cast");
    await until(async () => (await fxActive(A.page)) === 0, 8000, "own particles drain");
    for (const x of [A, B]) expect(x.errors).toEqual([]);
  } finally { await A.ctx.close(); await B.ctx.close().catch(() => undefined); }
});

test("QV04: Undertow Spiral ribbon appears only after a confirmed capture hit and drains", async () => {
  test.setTimeout(120_000);
  const A = await open("Tara", "td");
  const B = await open("Nora", "ea");
  try {
    await until(async () => (await snap(B.page)).players.filter((p) => p.ready).length === 2, 15000, "both ready");
    const listings = await matchMaker.query({ name: "arena" });
    const arena = matchMaker.getLocalRoomById(listings[0]!.roomId) as unknown as ArenaRoom;
    const aId = await until(async () => (await snap(A.page)).localEntityId, 10000, "A id");
    const bId = await until(async () => (await snap(B.page)).localEntityId, 10000, "B id");
    const fa = arena.combat.get(aId)!;
    const cast = (action: string) => { const tick = arena.sim.tick; fa.action = action as never; fa.moveId = "td.b2"; fa.actionStartTick = tick; fa.actionEndTick = tick + 1000; };
    const idle = () => { fa.action = "Idle" as never; fa.moveId = ""; fa.actionEndTick = Number.MAX_SAFE_INTEGER; };
    const fxActive = (p: Page) => snap(p).then((s) => s.fx.active);
    await until(async () => (await fxActive(B.page)) === 0, 8000, "quiet pool");
    // Miss: windup and active only (no hit event) -> no ribbon, so the pool stays at the generic ring plus spiral.
    cast("Windup");
    await until(async () => { const n = await fxActive(B.page); return n > 0 ? n : false; }, 8000, "windup ring");
    cast("Active");
    const missPeak = await until(async () => { const n = await fxActive(B.page); return n > 12 ? n : false; }, 8000, "active spiral");
    expect(missPeak).toBeLessThanOrEqual(12 + 28); // ring + generic spiral; no victim-bound ribbon budget
    idle();
    await until(async () => (await fxActive(B.page)) === 0, 8000, "miss drains");
    // Confirmed capture: the server broadcasts a hit; the ribbon appears for both clients.
    const server = arena as unknown as { broadcastEvent(t: number, k: string, a: number, b: number, life: number, move: string, dmg: number): void };
    server.broadcastEvent(arena.sim.tick, "hit", aId, bId, arena.combat.get(bId)!.lifeId, "td.b2", 500);
    const hit = await until(async () => { const n = await fxActive(B.page); return n >= 20 ? n : false; }, 8000, "ribbon after capture hit");
    expect(hit).toBeGreaterThanOrEqual(20);
    await until(async () => (await fxActive(B.page)) === 0, 8000, "ribbon drains");
    for (const x of [A, B]) expect(x.errors).toEqual([]);
  } finally { await A.ctx.close(); await B.ctx.close().catch(() => undefined); }
});
