// Quality skills (QV03..): real Chromium + Colyseus. Cast phases are set on the server fighter by a fixture; replication, rendering and cleanup are real.
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
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { ARENA } from "../../packages/shared/src/config/arena.js";
import { defaultSettings } from "../../apps/client/src/app/SettingsStore.js";
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
async function open(name: string, kit: string): Promise<{ ctx: BrowserContext; page: Page; errors: string[] }> {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
      page.on("response", response => { if (response.status() >= 400) { const u = new URL(response.url()); errors.push(`HTTP ${response.status()} ${u.hostname}${u.pathname}`); } });
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

test("QV05: Furnace Ray is sustained for the whole replicated Active phase, then stops on interruption and drains", async () => {
  test.setTimeout(120_000);
  const A = await open("Eli", "ea");
  const B = await open("Sven", "sv");
  try {
    await until(async () => (await snap(B.page)).players.filter((p) => p.ready).length === 2, 15000, "both ready");
    const listings = await matchMaker.query({ name: "arena" });
    const arena = matchMaker.getLocalRoomById(listings[0]!.roomId) as unknown as ArenaRoom;
    const aId = await until(async () => (await snap(A.page)).localEntityId, 10000, "A id");
    const fa = arena.combat.get(aId)!;
    const set = (action: string, len: number) => { const tick = arena.sim.tick; fa.action = action as never; fa.moveId = action === "Idle" ? "" : "ea.a3"; fa.actionStartTick = tick; fa.actionEndTick = action === "Idle" ? Number.MAX_SAFE_INTEGER : tick + len; };
    const fxActive = (p: Page) => snap(p).then((s) => s.fx.active);
    await until(async () => (await fxActive(B.page)) === 0, 8000, "quiet pool");
    set("Active", 1000);
    await until(async () => (await fxActive(B.page)) > 0, 8000, "first sustained beam frame visible");
    // Sustained: particles live 0.1 s, so seeing them across 1.2 s means the beam is being re-emitted, not fired once.
    const samples: number[] = [];
    for (let i = 0; i < 8; i++) { await sleep(150); samples.push(await fxActive(B.page)); }
    expect(samples.filter((n) => n > 0).length).toBeGreaterThanOrEqual(7);
    expect(Math.max(...samples)).toBeLessThanOrEqual(200);
    // Authoritative interruption ends the beam; the observer pool drains.
    set("Stunned", 1000);
    await until(async () => (await fxActive(B.page)) === 0, 8000, "beam drains after interruption");
    // Active end: a short Active window ends the beam by itself.
    set("Active", 40);
    await until(async () => (await fxActive(B.page)) > 0, 8000, "short beam seen");
    await until(async () => (await fxActive(B.page)) === 0, 8000, "beam drains after active end");
    for (const x of [A, B]) expect(x.errors).toEqual([]);
  } finally { await A.ctx.close(); await B.ctx.close().catch(() => undefined); }
});

// ---- QV06: Vanguard ability and awakening coverage -------------------------------------------------------------
// Fixture (synthetic, labelled): fighter placement, camera yaw and the server fighter's action/moveId are set by the test; hits are
// server-broadcast combat events. Replication, rendering, pooling and cleanup are real. Stills are SwiftShader desktop Chromium, not a device.
const outDir6 = path.join(root, process.env.QV09_POLISH ? "docs/test-results/QV09/polish" : "docs/test-results/QV06"); // QV09 polish recaptures go beside QV09 so the original stills stay as the before set
interface Row { id: string; action: "Active" | "Awakening"; hits: number[]; sustained?: boolean }
const ROWS: Row[] = [
  { id: "sv.b1", action: "Active", hits: [2000] }, { id: "sv.b2", action: "Active", hits: [], sustained: true }, { id: "sv.b3", action: "Active", hits: [] },
  { id: "sv.b4", action: "Active", hits: [] }, { id: "sv.a1", action: "Active", hits: [10000] }, { id: "sv.a2", action: "Active", hits: [] },
  { id: "sv.a3", action: "Active", hits: [], sustained: true }, { id: "sv.a4", action: "Active", hits: [0, 10000] },
  { id: "sv.x1", action: "Active", hits: [] }, { id: "sv.x2", action: "Active", hits: [0, 4000] }, { id: "sv.x3", action: "Active", hits: [1500] },
  { id: "sv.activate", action: "Awakening", hits: [] },
];
const MEDIUM_ROWS = new Set(["sv.b1", "sv.a1", "sv.a3", "sv.activate"]);
for (const tier of ["low", "medium"] as const) {
  test(`QV06 ${tier}: every Vanguard move and the activation show a cue on an observer, react to confirmed hits only, and drain`, async () => {
    test.setTimeout(600_000);
    mkdirSync(outDir6, { recursive: true });
    const names = { A: "Sven", T: "Nora", O: "Tara" } as const;
    const openT = async (name: string, kit: string) => {
      const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
      await ctx.addInitScript(({ s, spoof }) => {
        try { for (const n of ["Sven", "Nora", "Tara", "default"]) localStorage.setItem(`eb.settings.v1.${n}`, JSON.stringify(s)); } catch { /* storage unavailable */ }
        if (spoof) for (const C of [WebGLRenderingContext, WebGL2RenderingContext]) {
          const orig = C.prototype.getParameter;
          C.prototype.getParameter = function (this: WebGLRenderingContext, p: number) { return p === 0x9246 ? "ANGLE (Apple, Apple M-series GPU, Metal) [QV06 fixture]" : orig.call(this, p); } as never;
        }
      }, { s: { ...defaultSettings(), quality: tier }, spoof: tier !== "low" });
      const page = await ctx.newPage(), errors: string[] = [];
      page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
      page.on("pageerror", (e) => errors.push(String(e)));
      page.on("response", response => { if (response.status() >= 400) { const u = new URL(response.url()); errors.push(`HTTP ${response.status()} ${u.hostname}${u.pathname}`); } });
      const { token } = svc.invites.create({ ttlMs: 120_000, maxUses: 1 });
      await page.goto(`${base}/?room=match&name=${name}&kit=${kit}&debug=1&auto=1#invite=${token}`);
      await page.waitForFunction(() => (window as unknown as { __eb?: unknown }).__eb !== undefined, undefined, { timeout: 30_000 });
      return { ctx, page, errors };
    };
    const A = await openT(names.A, "sv"), T = await openT(names.T, "ea"), O = await openT(names.O, "td");
    const report: { id: string; tier: string; cuePeak: number; hitPeaks: number[]; drained: boolean; stoppedOnInterrupt: boolean | null; render: { calls: number; triangles: number } | null; shot: string }[] = [];
    try {
      await until(async () => (await snap(O.page)).players.filter((p) => p.ready).length === 3, 30000, "three ready");
      const arena = matchMaker.getLocalRoomById((await matchMaker.query({ name: "arena" }))[0]!.roomId) as unknown as ArenaRoom;
      const aId = await until(async () => (await snap(A.page)).localEntityId, 10000, "A id"), tId = await until(async () => (await snap(T.page)).localEntityId, 10000, "T id");
      const oId = await until(async () => (await snap(O.page)).localEntityId, 10000, "O id");
      const place = (id: number, x: number, z: number, yaw: number): void => {
        const b = arena.movement!.get(id)!, pos = { x, y: ARENA.capsule.centreAboveSurface + 0.02, z };
        b.rb.setTranslation(pos, true); b.rb.setNextKinematicTranslation(pos); b.state.vx = b.state.vy = b.state.vz = 0; b.state.facingYaw = yaw;
      };
      // Caster faces east (+X, yaw -PI/2); target 2 m ahead; the observer stands south of the pair looking north (yaw 0) for a side view.
      const apply = () => { place(aId, 6, 8, -Math.PI / 2); place(tId, 8, 8, Math.PI / 2); place(oId, 7, 14, 0); };
      apply();
      await O.page.evaluate(() => (window as unknown as { __eb: { setCameraYaw(y: number): void } }).__eb.setCameraYaw(0));
      await sleep(1200);
      const fa = arena.combat.get(aId)!, ft = arena.combat.get(tId)!;
      const idle = () => { fa.action = "Idle" as never; fa.moveId = ""; fa.actionEndTick = Number.MAX_SAFE_INTEGER; };
      const fxOf = async () => (await snap(O.page)).fx.active;
      const server = arena as unknown as { broadcastEvent(t: number, k: string, a: number, b: number, life: number, move: string, dmg: number): void };
      for (const row of ROWS) {
        if (tier === "medium" && !MEDIUM_ROWS.has(row.id)) continue;
        apply(); idle(); ft.hp100 = 10000;
        await until(async () => (await fxOf()) === 0, 15000, `${row.id} quiet pool`);
        if (row.id === "td.a4") place(aId, 2, 8, -Math.PI / 2); // QV09 polish: the dash starts 4 m behind the target and really moves, so the trail exists
        const tick = arena.sim.tick;
        fa.action = row.action as never; fa.moveId = row.id; fa.actionStartTick = tick; fa.actionEndTick = tick + (row.action === "Awakening" ? 30 : 1000);
        const cue = await until(async () => { const n = await fxOf(); return n > 0 ? n : false; }, 8000, `${row.id} cue`);
        const t0 = Date.now();
        const s0 = await snap(O.page), file = `${tier}-${row.id}-cue.jpg`;
        await O.page.screenshot({ path: path.join(outDir6, file), type: "jpeg", quality: 82 });
        const hitPeaks: number[] = [];
        let shot = file;
        for (const dmg of row.hits) {
          const before = await fxOf();
          server.broadcastEvent(arena.sim.tick, "hit", aId, tId, ft.lifeId, row.id, dmg);
          const n = await until(async () => { const v = await fxOf(); return v > before ? v : false; }, 8000, `${row.id} hit ${dmg}`);
          hitPeaks.push(n);
          if (dmg === row.hits[row.hits.length - 1]) { shot = `${tier}-${row.id}-hit.jpg`; await O.page.screenshot({ path: path.join(outDir6, shot), type: "jpeg", quality: 82 }); }
        }
        let stopped: boolean | null = null;
        if (row.sustained) { // authoritative interruption: the emitter stops and the pool drains
          fa.action = "Stunned" as never; fa.moveId = row.id; fa.actionEndTick = arena.sim.tick + 1000;
          stopped = await until(async () => (await fxOf()) === 0, 8000, `${row.id} drains after interruption`).then(() => true);
        }
        idle();
        await until(async () => (await fxOf()) === 0, 15000, `${row.id} drains`);
        report.push({ id: row.id, tier, cuePeak: cue, hitPeaks, drained: true, stoppedOnInterrupt: stopped, render: s0.render ? { calls: (s0.render as unknown as { calls: number }).calls, triangles: (s0.render as unknown as { triangles: number }).triangles } : null, shot });
        void t0;
      }
      writeFileSync(path.join(outDir6, `${tier}-report.json`), JSON.stringify({ fixture: "synthetic server phase + broadcast hit events; SwiftShader desktop Chromium 1024x768", tier, report }, null, 1));
      for (const x of [A, T, O]) expect(x.errors).toEqual([]);
    } finally { await A.ctx.close(); await T.ctx.close().catch(() => undefined); await O.ctx.close().catch(() => undefined); }
  });
}


// ---- QV07: Duelist ability and awakening coverage -------------------------------------------------------------
// Fixture (synthetic, labelled): fighter placement, camera yaw and the server fighter's action/moveId are set by the test; hits are
// server-broadcast combat events. Replication, rendering, pooling and cleanup are real. Stills are SwiftShader desktop Chromium, not a device.
const RIPTIDE_LUNGE = 8; // td.a4 lunge ring particle count (RIPTIDE.lunge)
const outDir7 = path.join(root, process.env.QV09_POLISH ? "docs/test-results/QV09/polish" : "docs/test-results/QV07"); // QV09 polish recaptures go beside QV09 so the original stills stay as the before set
interface Row7 { id: string; action: "Active" | "Awakening"; hits: number[]; sustained?: boolean; counter?: boolean }
// A hit of 0 damage is sent as a server "capture" event, as the real pipeline reports captures; everything else is a "hit".
const ROWS7: Row7[] = [
  { id: "td.b1", action: "Active", hits: [0, 400, 800] }, { id: "td.b2", action: "Active", hits: [500, 2400] }, { id: "td.b3", action: "Active", hits: [0, 900] },
  { id: "td.b4", action: "Active", hits: [600, 1600], counter: true }, { id: "td.a1", action: "Active", hits: [400, 1000] }, { id: "td.a2", action: "Active", hits: [0, 2000, 6900] },
  { id: "td.a3", action: "Active", hits: [1200, 2600], sustained: true }, { id: "td.a4", action: "Active", hits: [0, 2200], sustained: true },
  { id: "td.activate", action: "Awakening", hits: [2000] },
];
const MEDIUM7 = new Set(["td.b4", "td.a2", "td.a3", "td.a4", "td.activate"]); // QV09 polish: td.a4 added (moving-caster trail)
for (const tier of ["low", "medium"] as const) {
  test(`QV07 ${tier}: every Duelist move and the activation show a cue on an observer, react to confirmed hits only, and drain`, async () => {
    test.setTimeout(600_000);
    mkdirSync(outDir7, { recursive: true });
    const names = { A: "Tara", T: "Nora", O: "Sven" } as const;
    const openT = async (name: string, kit: string) => {
      const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
      await ctx.addInitScript(({ s, spoof }) => {
        try { for (const n of ["Sven", "Nora", "Tara", "default"]) localStorage.setItem(`eb.settings.v1.${n}`, JSON.stringify(s)); } catch { /* storage unavailable */ }
        if (spoof) for (const C of [WebGLRenderingContext, WebGL2RenderingContext]) {
          const orig = C.prototype.getParameter;
          C.prototype.getParameter = function (this: WebGLRenderingContext, p: number) { return p === 0x9246 ? "ANGLE (Apple, Apple M-series GPU, Metal) [QV07 fixture]" : orig.call(this, p); } as never;
        }
      }, { s: { ...defaultSettings(), quality: tier }, spoof: tier !== "low" });
      const page = await ctx.newPage(), errors: string[] = [];
      page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
      page.on("pageerror", (e) => errors.push(String(e)));
      page.on("response", response => { if (response.status() >= 400) { const u = new URL(response.url()); errors.push(`HTTP ${response.status()} ${u.hostname}${u.pathname}`); } });
      const { token } = svc.invites.create({ ttlMs: 120_000, maxUses: 1 });
      await page.goto(`${base}/?room=match&name=${name}&kit=${kit}&debug=1&auto=1#invite=${token}`);
      await page.waitForFunction(() => (window as unknown as { __eb?: unknown }).__eb !== undefined, undefined, { timeout: 30_000 });
      return { ctx, page, errors };
    };
    const A = await openT(names.A, "td"), T = await openT(names.T, "ea"), O = await openT(names.O, "sv");
    const report: { id: string; tier: string; cuePeak: number; hitPeaks: number[]; drained: boolean; stoppedOnInterrupt: boolean | null; render: { calls: number; triangles: number } | null; shot: string }[] = [];
    try {
      await until(async () => (await snap(O.page)).players.filter((p) => p.ready).length === 3, 30000, "three ready");
      const arena = matchMaker.getLocalRoomById((await matchMaker.query({ name: "arena" }))[0]!.roomId) as unknown as ArenaRoom;
      const aId = await until(async () => (await snap(A.page)).localEntityId, 10000, "A id"), tId = await until(async () => (await snap(T.page)).localEntityId, 10000, "T id");
      const oId = await until(async () => (await snap(O.page)).localEntityId, 10000, "O id");
      const place = (id: number, x: number, z: number, yaw: number): void => {
        const b = arena.movement!.get(id)!, pos = { x, y: ARENA.capsule.centreAboveSurface + 0.02, z };
        b.rb.setTranslation(pos, true); b.rb.setNextKinematicTranslation(pos); b.state.vx = b.state.vy = b.state.vz = 0; b.state.facingYaw = yaw;
      };
      // Caster faces east (+X, yaw -PI/2); target 2 m ahead; the observer stands south of the pair looking north (yaw 0) for a side view.
      const apply = () => { place(aId, 6, 8, -Math.PI / 2); place(tId, 8, 8, Math.PI / 2); place(oId, 7, 14, 0); };
      apply();
      await O.page.evaluate(() => (window as unknown as { __eb: { setCameraYaw(y: number): void } }).__eb.setCameraYaw(0));
      await sleep(1200);
      const fa = arena.combat.get(aId)!, ft = arena.combat.get(tId)!;
      const idle = () => { fa.action = "Idle" as never; fa.moveId = ""; fa.actionEndTick = Number.MAX_SAFE_INTEGER; };
      const fxOf = async () => (await snap(O.page)).fx.active;
      const server = arena as unknown as { broadcastEvent(t: number, k: string, a: number, b: number, life: number, move: string, dmg: number): void };
      for (const row of ROWS7) {
        if (tier === "medium" && !MEDIUM7.has(row.id)) continue;
        apply(); idle(); ft.hp100 = 10000;
        await until(async () => (await fxOf()) === 0, 15000, `${row.id} quiet pool`);
        const tick = arena.sim.tick;
        fa.action = row.action as never; fa.moveId = row.id; fa.actionStartTick = tick; fa.actionEndTick = tick + (row.action === "Awakening" ? 30 : 1000);
        const cue = await until(async () => { const n = await fxOf(); return n > 0 ? n : false; }, 8000, `${row.id} cue`);
        const t0 = Date.now();
        const s0 = await snap(O.page), file = `${tier}-${row.id}-cue.jpg`;
        await O.page.screenshot({ path: path.join(outDir7, file), type: "jpeg", quality: 82 });
        let trailPeak: number | null = null;
        if (row.id === "td.a4") { // QV09 polish: move the caster 4 m east through Active and capture the trail mid-dash
          for (let st = 1; st <= 16; st++) {
            place(aId, 2 + st * 0.25, 8, -Math.PI / 2); await sleep(45);
            if (st === 9) { trailPeak = await fxOf(); await O.page.screenshot({ path: path.join(outDir7, `${tier}-td.a4-trail.jpg`), type: "jpeg", quality: 82 }); }
          }
          expect(trailPeak).toBeGreaterThan(RIPTIDE_LUNGE); // more than the lunge ring alone is alive mid-dash
        }
        const hitPeaks: number[] = [];
        let shot = file;
        for (const dmg of row.hits) {
          const before = await fxOf();
          server.broadcastEvent(arena.sim.tick, dmg === 0 ? "capture" : "hit", aId, tId, ft.lifeId, row.id, dmg);
          const n = await until(async () => { const v = await fxOf(); return v > before ? v : false; }, 8000, `${row.id} hit ${dmg}`);
          hitPeaks.push(n);
          if (dmg === row.hits[row.hits.length - 1]) { shot = `${tier}-${row.id}-hit.jpg`; await O.page.screenshot({ path: path.join(outDir7, shot), type: "jpeg", quality: 82 }); }
        }
        if (row.counter) { // confirmed counter against the Duelist in stance: the mirror flares
          const before = await fxOf();
          server.broadcastEvent(arena.sim.tick, "counter", tId, aId, fa.lifeId, "ea.b1", 0);
          hitPeaks.push(await until(async () => { const v = await fxOf(); return v > before ? v : false; }, 8000, `${row.id} counter flare`));
        }
        let stopped: boolean | null = null;
        if (row.sustained) { // authoritative interruption: the emitter stops and the pool drains
          fa.action = "Stunned" as never; fa.moveId = row.id; fa.actionEndTick = arena.sim.tick + 1000;
          stopped = await until(async () => (await fxOf()) === 0, 8000, `${row.id} drains after interruption`).then(() => true);
        }
        idle();
        await until(async () => (await fxOf()) === 0, 15000, `${row.id} drains`);
        report.push({ id: row.id, tier, cuePeak: cue, hitPeaks, drained: true, stoppedOnInterrupt: stopped, render: s0.render ? { calls: (s0.render as unknown as { calls: number }).calls, triangles: (s0.render as unknown as { triangles: number }).triangles } : null, shot });
        void t0;
      }
      writeFileSync(path.join(outDir7, `${tier}-report.json`), JSON.stringify({ fixture: "synthetic server phase + broadcast hit events; SwiftShader desktop Chromium 1024x768", tier, report }, null, 1));
      for (const x of [A, T, O]) expect(x.errors).toEqual([]);
    } finally { await A.ctx.close(); await T.ctx.close().catch(() => undefined); await O.ctx.close().catch(() => undefined); }
  });
}

// ---- QV08: Artificer ability and awakening coverage -------------------------------------------------------------
// Fixture (synthetic, labelled): fighter placement, camera yaw and the server fighter's action/moveId are set by the test; hits are
// server-broadcast combat events. Replication, rendering, pooling and cleanup are real. Stills are SwiftShader desktop Chromium, not a device.
const outDir8 = path.join(root, process.env.QV09_POLISH ? "docs/test-results/QV09/polish" : "docs/test-results/QV08"); // QV09 polish recaptures go beside QV09 so the original stills stay as the before set
interface Row8 { id: string; action: "Active" | "Awakening"; hits: number[]; sustained?: boolean; counter?: boolean }
// A hit of 0 damage is sent as a server "capture" event, as the real pipeline reports captures; everything else is a "hit".
const ROWS8: Row8[] = [
  { id: "ea.b1", action: "Active", hits: [200, 1000] }, { id: "ea.b2", action: "Active", hits: [1500, 1000] }, { id: "ea.b3", action: "Active", hits: [1500, 2500] },
  { id: "ea.b4", action: "Active", hits: [2000] }, { id: "ea.a1", action: "Active", hits: [0, 1500, 1300, 2000, 2500] }, { id: "ea.a2", action: "Active", hits: [0, 2000, 5000] },
  { id: "ea.a3", action: "Active", hits: [500], sustained: true }, { id: "ea.a4", action: "Active", hits: [700], sustained: true },
  { id: "ea.activate", action: "Awakening", hits: [1600] },
];
const MEDIUM8 = new Set(["ea.b4", "ea.a1", "ea.a4", "ea.activate"]);
for (const tier of ["low", "medium"] as const) {
  test(`QV08 ${tier}: every Artificer move and the activation show a cue on an observer, react to confirmed hits only, and drain`, async () => {
    test.setTimeout(600_000);
    mkdirSync(outDir8, { recursive: true });
    const names = { A: "Eli", T: "Nora", O: "Sven" } as const;
    const openT = async (name: string, kit: string) => {
      const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
      await ctx.addInitScript(({ s, spoof }) => {
        try { for (const n of ["Sven", "Nora", "Eli", "default"]) localStorage.setItem(`eb.settings.v1.${n}`, JSON.stringify(s)); } catch { /* storage unavailable */ }
        if (spoof) for (const C of [WebGLRenderingContext, WebGL2RenderingContext]) {
          const orig = C.prototype.getParameter;
          C.prototype.getParameter = function (this: WebGLRenderingContext, p: number) { return p === 0x9246 ? "ANGLE (Apple, Apple M-series GPU, Metal) [QV08 fixture]" : orig.call(this, p); } as never;
        }
      }, { s: { ...defaultSettings(), quality: tier }, spoof: tier !== "low" });
      const page = await ctx.newPage(), errors: string[] = [];
      page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
      page.on("pageerror", (e) => errors.push(String(e)));
      page.on("response", response => { if (response.status() >= 400) { const u = new URL(response.url()); errors.push(`HTTP ${response.status()} ${u.hostname}${u.pathname}`); } });
      const { token } = svc.invites.create({ ttlMs: 120_000, maxUses: 1 });
      await page.goto(`${base}/?room=match&name=${name}&kit=${kit}&debug=1&auto=1#invite=${token}`);
      await page.waitForFunction(() => (window as unknown as { __eb?: unknown }).__eb !== undefined, undefined, { timeout: 30_000 });
      return { ctx, page, errors };
    };
    const A = await openT(names.A, "ea"), T = await openT(names.T, "td"), O = await openT(names.O, "sv");
    const report: { id: string; tier: string; cuePeak: number; hitPeaks: number[]; drained: boolean; stoppedOnInterrupt: boolean | null; render: { calls: number; triangles: number } | null; shot: string }[] = [];
    try {
      await until(async () => (await snap(O.page)).players.filter((p) => p.ready).length === 3, 30000, "three ready");
      const arena = matchMaker.getLocalRoomById((await matchMaker.query({ name: "arena" }))[0]!.roomId) as unknown as ArenaRoom;
      const aId = await until(async () => (await snap(A.page)).localEntityId, 10000, "A id"), tId = await until(async () => (await snap(T.page)).localEntityId, 10000, "T id");
      const oId = await until(async () => (await snap(O.page)).localEntityId, 10000, "O id");
      const place = (id: number, x: number, z: number, yaw: number): void => {
        const b = arena.movement!.get(id)!, pos = { x, y: ARENA.capsule.centreAboveSurface + 0.02, z };
        b.rb.setTranslation(pos, true); b.rb.setNextKinematicTranslation(pos); b.state.vx = b.state.vy = b.state.vz = 0; b.state.facingYaw = yaw;
      };
      // Caster faces east (+X, yaw -PI/2); target 2 m ahead; the observer stands south of the pair looking north (yaw 0) for a side view.
      const apply = () => { place(aId, 6, 8, -Math.PI / 2); place(tId, 8, 8, Math.PI / 2); place(oId, 7, 14, 0); };
      apply();
      await O.page.evaluate(() => (window as unknown as { __eb: { setCameraYaw(y: number): void } }).__eb.setCameraYaw(0));
      await sleep(1200);
      const fa = arena.combat.get(aId)!, ft = arena.combat.get(tId)!;
      const idle = () => { fa.action = "Idle" as never; fa.moveId = ""; fa.actionEndTick = Number.MAX_SAFE_INTEGER; };
      const fxOf = async () => (await snap(O.page)).fx.active;
      const server = arena as unknown as { broadcastEvent(t: number, k: string, a: number, b: number, life: number, move: string, dmg: number): void };
      for (const row of ROWS8) {
        if (tier === "medium" && !MEDIUM8.has(row.id)) continue;
        apply(); idle(); ft.hp100 = 10000;
        await until(async () => (await fxOf()) === 0, 15000, `${row.id} quiet pool`);
        const tick = arena.sim.tick;
        fa.action = row.action as never; fa.moveId = row.id; fa.actionStartTick = tick; fa.actionEndTick = tick + (row.action === "Awakening" ? 90 : 1000);
        const cue = await until(async () => { const n = await fxOf(); return n > 0 ? n : false; }, 8000, `${row.id} cue`);
        const t0 = Date.now();
        const s0 = await snap(O.page), file = `${tier}-${row.id}-cue.jpg`;
        await O.page.screenshot({ path: path.join(outDir8, file), type: "jpeg", quality: 82 });
        const hitPeaks: number[] = [];
        let shot = file;
        for (const dmg of row.hits) {
          const before = await fxOf();
          server.broadcastEvent(arena.sim.tick, dmg === 0 ? "capture" : "hit", aId, tId, ft.lifeId, row.id, dmg);
          const n = await until(async () => { const v = await fxOf(); return v > before ? v : false; }, 8000, `${row.id} hit ${dmg}`);
          hitPeaks.push(n);
          if (dmg === row.hits[row.hits.length - 1]) { shot = `${tier}-${row.id}-hit.jpg`; await O.page.screenshot({ path: path.join(outDir8, shot), type: "jpeg", quality: 82 }); }
        }
        let stopped: boolean | null = null;
        if (row.sustained) { // authoritative interruption: the emitter stops and the pool drains
          fa.action = "Stunned" as never; fa.moveId = row.id; fa.actionEndTick = arena.sim.tick + 1000;
          stopped = await until(async () => (await fxOf()) === 0, 8000, `${row.id} drains after interruption`).then(() => true);
        }
        idle();
        await until(async () => (await fxOf()) === 0, 15000, `${row.id} drains`);
        report.push({ id: row.id, tier, cuePeak: cue, hitPeaks, drained: true, stoppedOnInterrupt: stopped, render: s0.render ? { calls: (s0.render as unknown as { calls: number }).calls, triangles: (s0.render as unknown as { triangles: number }).triangles } : null, shot });
        void t0;
      }
      writeFileSync(path.join(outDir8, `${tier}-report.json`), JSON.stringify({ fixture: "synthetic server phase + broadcast hit events; SwiftShader desktop Chromium 1024x768", tier, report }, null, 1));
      for (const x of [A, T, O]) expect(x.errors).toEqual([]);
    } finally { await A.ctx.close(); await T.ctx.close().catch(() => undefined); await O.ctx.close().catch(() => undefined); }
  });
}



// ---- QV09: universal attacks and contextual outcomes ----------------------------------------------------------------
// Real input: the attacker holds the real attack key (M1 chain, block when the defender holds the real guard key) and presses
// the real dash and guard keys; the server decides every hit, block and dash. Contextual events the keyboard cannot reach in a
// short test (wall, urn pickup/throw, capture/release, KO, respawn, counter) are server broadcast events on a synthetic fixture.
const outDir9 = path.join(root, "docs/test-results/QV09");
for (const tier of ["low", "medium"] as const) {
  test(`QV09 ${tier}: universal attacks, guard, dash and contextual outcomes read on both clients and drain`, async () => {
    test.setTimeout(600_000);
    mkdirSync(outDir9, { recursive: true });
    const openT = async (name: string, kit: string) => {
      const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
      await ctx.addInitScript(({ s, spoof }) => {
        try { for (const n of ["Sven", "Nora", "default"]) localStorage.setItem(`eb.settings.v1.${n}`, JSON.stringify(s)); } catch { /* storage unavailable */ }
        if (spoof) for (const C of [WebGLRenderingContext, WebGL2RenderingContext]) {
          const orig = C.prototype.getParameter;
          C.prototype.getParameter = function (this: WebGLRenderingContext, p: number) { return p === 0x9246 ? "ANGLE (Apple, Apple M-series GPU, Metal) [QV09 fixture]" : orig.call(this, p); } as never;
        }
      }, { s: { ...defaultSettings(), quality: tier }, spoof: tier !== "low" });
      const page = await ctx.newPage(), errors: string[] = [];
      page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
      page.on("pageerror", (e) => errors.push(String(e)));
      page.on("response", response => { if (response.status() >= 400) { const u = new URL(response.url()); errors.push(`HTTP ${response.status()} ${u.hostname}${u.pathname}`); } });
      const { token } = svc.invites.create({ ttlMs: 120_000, maxUses: 1 });
      await page.goto(`${base}/?room=match&name=${name}&kit=${kit}&debug=1&auto=1#invite=${token}`);
      await page.waitForFunction(() => (window as unknown as { __eb?: unknown }).__eb !== undefined, undefined, { timeout: 30_000 });
      return { ctx, page, errors };
    };
    const A = await openT("Sven", "sv"), B = await openT("Nora", "ea");
    const rep: Record<string, unknown> = { fixture: "real keyboard/mouse input for m1 chain, block, guard, dash; synthetic server broadcast events for contextual rows; SwiftShader desktop Chromium 1024x768", tier };
    const peaks: Record<string, number> = {};
    try {
      await until(async () => (await snap(B.page)).players.filter((p) => p.ready).length === 2, 30000, "both ready");
      const arena = matchMaker.getLocalRoomById((await matchMaker.query({ name: "arena" }))[0]!.roomId) as unknown as ArenaRoom;
      const aId = await until(async () => (await snap(A.page)).localEntityId, 10000, "A id"), bId = await until(async () => (await snap(B.page)).localEntityId, 10000, "B id");
      const place = (id: number, x: number, z: number, yaw: number): void => {
        const b = arena.movement!.get(id)!, pos = { x, y: ARENA.capsule.centreAboveSurface + 0.02, z };
        b.rb.setTranslation(pos, true); b.rb.setNextKinematicTranslation(pos); b.state.vx = b.state.vy = b.state.vz = 0; b.state.facingYaw = yaw;
      };
      const apply = () => { place(aId, 6, 8, -Math.PI / 2); place(bId, 7.4, 8, Math.PI / 2); for (const id of [aId, bId]) arena.combat.get(id)!.protectedUntilTick = 0; };
      const full = (p: Page) => snap(p) as unknown as Promise<Snap & { hitMoveIds: string[]; eventCounts: Record<string, number>; render: { calls: number; triangles: number } | null }>;
      const fxOf = async (p: Page = B.page) => (await snap(p)).fx.active;
      const fb = arena.combat.get(bId)!;
      const atk = (await A.page.locator("[data-control=attack]").boundingBox({ timeout: 5000 }))!;
      const swing = async (on: boolean) => { if (on) { await A.page.mouse.move(atk.x + atk.width / 2, atk.y + atk.height / 2); await A.page.mouse.down(); } else await A.page.mouse.up(); };
      const shot = async (p: Page, name: string) => { await p.screenshot({ path: path.join(outDir9, `${tier}-${name}.jpg`), type: "jpeg", quality: 82 }); };
      const track = async (name: string, ms: number, p: Page = B.page) => { // peak pool size over a window
        const t0 = Date.now(); let m = 0;
        while (Date.now() - t0 < ms) { m = Math.max(m, await fxOf(p)); await sleep(30); }
        peaks[name] = Math.max(peaks[name] ?? 0, m);
        return m;
      };
      apply();
      await A.page.evaluate(() => (window as unknown as { __eb: { setCameraYaw(y: number): void } }).__eb.setCameraYaw(-Math.PI / 2));
      await B.page.evaluate(() => (window as unknown as { __eb: { setCameraYaw(y: number): void } }).__eb.setCameraYaw(Math.PI / 2));
      await sleep(1200);
      await until(async () => (await fxOf()) === 0, 15000, "quiet pool");

      const T = Date.now(); const log = (m: string) => console.log(`[QV09 ${tier}] +${Date.now() - T}ms ${m}`);
      log("setup done");
      // 1. Real M1 chain: hold the attack key; the defender is re-placed in range between swings. Server-confirmed move ids prove the steps.
      await swing(true); log("attack down");
      const t0 = Date.now(); let seen = new Set<string>(), chainPeak = 0;
      while (Date.now() - t0 < 14000 && !(seen.has("m1.1") && seen.has("m1.4"))) {
        fb.hp100 = 10000; apply();
        chainPeak = Math.max(chainPeak, await fxOf());
        seen = new Set((await full(A.page)).hitMoveIds.map((m) => m.split(".").slice(0, 2).join(".")));
        await sleep(60);
      }
      log(`chain loop done ${[...seen]}`);
      await shot(B.page, "m1-chain");
      await swing(false);
      expect(seen.has("m1.1"), `server-confirmed m1 steps: ${[...seen]} A=${JSON.stringify((await snap(A.page)).players.map((p) => [p.name, p.action, p.hp100]))}`).toBe(true);
      peaks["m1 chain"] = chainPeak; rep["m1Seen"] = [...seen];
      await until(async () => (await fxOf()) === 0, 15000, "chain drains");
      await sleep(1500); apply(); fb.hp100 = 10000;

      // 2. Real guard: B holds the guard key; the guard cue plays on A's client, then A's real swing is blocked by the server.
      const bevents = async () => (await full(B.page)).eventCounts;
      await B.page.keyboard.down("KeyF");
      await until(async () => (await snap(A.page)).players.find((p) => p.entityId === bId)?.action === "Guard" || null, 8000, "B guarding");
      await shot(A.page, "guard-raised");
      const blocks0 = (await bevents())["block"] ?? 0;
      await swing(true);
      const t1 = Date.now(); let blockPeak = 0;
      while (Date.now() - t1 < 12000 && ((await bevents())["block"] ?? 0) === blocks0) { fb.hp100 = 10000; apply(); blockPeak = Math.max(blockPeak, await fxOf()); await sleep(40); }
      const blocked = ((await bevents())["block"] ?? 0) > blocks0;
      if (blocked) await shot(B.page, "block");
      await swing(false); await B.page.keyboard.up("KeyF");
      expect(blocked, "server confirmed a block from real input").toBe(true);
      peaks["block"] = blockPeak;
      await until(async () => (await fxOf()) === 0 && (await fxOf(A.page)) === 0, 15000, "block drains");

      // 3. Real directional dash: A holds forward and presses the dash key; B (observer) sees the streak for the replicated Dash.
      await B.page.evaluate(() => (window as unknown as { __eb: { setCameraYaw(y: number): void } }).__eb.setCameraYaw(0)); // side view of the pair (they stand along X)
      apply(); await sleep(800);
      await A.page.keyboard.down("KeyW"); await A.page.keyboard.press("KeyQ");
      const dash = await until(async () => { const n = await fxOf(); return n > 0 ? n : false; }, 5000, "dash streak on the observer");
      await shot(B.page, "dash"); await A.page.keyboard.up("KeyW");
      peaks["dash"] = dash;
      await until(async () => (await fxOf()) === 0, 15000, "dash drains");

      // 4. Contextual outcomes the keyboard cannot reach quickly: server broadcast events. Each must show on both clients and drain.
      apply(); await sleep(800);
      const server = arena as unknown as { broadcastEvent(t: number, k: string, a: number, b: number | undefined, life: number, move: string | undefined, dmg?: number, extra?: { hitClass?: string }): void };
      const rows: { name: string; kind: string; move?: string; dmg?: number; target?: number; actor?: number; heavy?: boolean }[] = [
        { name: "m1.4-hit", kind: "hit", move: "m1.4", dmg: 300 }, { name: "wall", kind: "hit", move: "sv.wall", dmg: 900 }, { name: "pickup", kind: "cast", move: "sv.pickup", target: -1 },
        { name: "throw", kind: "hit", move: "sv.throw", dmg: 1000 }, { name: "capture", kind: "capture", move: "sv.x2", dmg: 0 }, { name: "release", kind: "release", move: "sv.x2" },
        { name: "counter", kind: "counter", move: "m1.1", dmg: 0 }, { name: "ko", kind: "ko", move: "m1.4", dmg: 0 }, { name: "respawn", kind: "respawn", actor: bId, target: bId },
      ];
      const sel = tier === "medium" ? new Set(["m1.4-hit", "wall", "capture"]) : null;
      const outcome: { name: string; a: number; b: number }[] = [];
      for (const r of rows) {
        if (sel && !sel.has(r.name)) continue;
        await until(async () => (await fxOf()) === 0 && (await fxOf(A.page)) === 0, 15000, `${r.name} quiet`);
        const actor = r.actor ?? aId, target = r.target === -1 ? undefined : (r.target ?? bId);
        const before = await fxOf();
        server.broadcastEvent(arena.sim.tick, r.kind, actor, target, fb.lifeId, r.move, r.dmg, { hitClass: r.heavy ? "heavy" : "light" });
        const nb = await until(async () => { const v = await fxOf(); return v > before ? v : false; }, 8000, `${r.name} on B`);
        const na = await fxOf(A.page);
        await shot(B.page, r.name);
        outcome.push({ name: r.name, a: na, b: nb });
        expect(nb).toBeLessThan(100);
      }
      rep["contextual"] = outcome;
      await until(async () => (await fxOf()) === 0 && (await fxOf(A.page)) === 0, 15000, "everything drains");
      const s = await full(B.page);
      rep["render"] = s.render ? { calls: s.render.calls, triangles: s.render.triangles } : null;
      rep["peaks"] = peaks;
      writeFileSync(path.join(outDir9, `${tier}-report.json`), JSON.stringify(rep, null, 1));
      for (const x of [A, B]) expect(x.errors).toEqual([]);
    } finally { await A.ctx.close(); await B.ctx.close().catch(() => undefined); }
  });
}
