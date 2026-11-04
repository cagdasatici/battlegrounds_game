// QV02: two real Chromium contexts observe attack telegraphs derived from replicated action phases (real Colyseus server).
// The cast phases are set on the server fighter by a fixture; rendering, replication and cleanup are real.
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
import { evidenceDir } from "./harness/evidence.js";
import { closeContext } from "./harness/leave.js";

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
  const { token } = svc.invites.create({ ttlMs: 120_000, maxUses: 1 });
  await page.goto(`${base}/?room=match&name=${name}&kit=${kit}&debug=1&auto=1#invite=${token}`);
  await page.waitForFunction(() => (window as unknown as { __eb?: unknown }).__eb !== undefined, undefined, { timeout: 30_000 });
  return { ctx, page, errors };
}

test("QV02: both observers see the authoritative phase warning, a missed windup stays unwarned, and cleanup holds", async () => {
  test.setTimeout(150_000);
  const A = await open("Arel", "ea");
  const B = await open("Nora", "sv");
  try {
    await until(async () => (await snap(B.page)).players.filter((p) => p.ready).length === 2, 15000, "both ready");
    const listings = await matchMaker.query({ name: "arena" });
    const arena = matchMaker.getLocalRoomById(listings[0]!.roomId) as unknown as ArenaRoom;
    const aId = await until(async () => (await snap(A.page)).localEntityId, 10000, "A local entity id " + JSON.stringify(A.errors));
    const fa = arena.combat.get(aId)!;
    const tele = (p: Page) => snap(p).then((s) => s.telegraphs!);
    const both = async (pred: (t: Awaited<ReturnType<typeof tele>>) => boolean, what: string) => {
      for (const p of [A.page, B.page]) await until(async () => pred(await tele(p)), 8000, what);
    };
    const cast = (action: string, moveId: string) => {
      const tick = arena.sim.tick;
      fa.action = action as never; fa.moveId = moveId; fa.actionStartTick = tick; fa.actionEndTick = tick + 1000;
    };
    const idle = () => { fa.action = "Idle" as never; fa.moveId = ""; fa.actionEndTick = Number.MAX_SAFE_INTEGER; };

    await both((t) => t.active === 0, "no warning before a cast");

    // Windup of the Furnace Ray beam, then the same cast turns Active: one warning, transferred.
    cast("Windup", "ea.a3");
    await both((t) => t.entries.length === 1 && t.entries[0]!.phase === "Windup" && t.entries[0]!.kind === "beam", "windup warning in both");
    const w = await tele(B.page);
    await sleep(300);
    expect((await tele(B.page)).entries[0]!.progress).toBeGreaterThan(w.entries[0]!.progress);
    cast("Active", "ea.a3");
    await both((t) => t.entries.length === 1 && t.entries[0]!.phase === "Active", "transfer to active in both");
    await A.page.screenshot({ path: path.join(evidenceDir(process.cwd()), "UX07-beam-warning.png") });
    // Particle saturation must not erase the retained warning.
    await A.page.evaluate(() => (window as unknown as { __eb: { floodFx(n: number): void } }).__eb.floodFx(900));
    await sleep(200);
    await both((t) => t.entries.length === 1, "warning survives a saturated particle pool");
    expect((await snap(B.page)).fx.active).toBeGreaterThan(0);

    // Interruption removes it everywhere.
    idle();
    await both((t) => t.active === 0, "interruption removes the warning");

    for (const move of ["sv.b3", "sv.b4", "td.b2"]) {
      cast("Windup", move); await both(t => t.active === 1 && t.entries[0]!.phase === "Windup", `new footprint ${move}`);
      await B.page.screenshot({ path: path.join(evidenceDir(process.cwd()), `UX07-warning-${move}.png`) });
      idle(); await both(t => t.active === 0, "close warning clears");
    }
    // A short phase the observers never saw as Windup: only Active is drawn, never a retroactive Windup.
    const histBefore = (await tele(B.page)).history.length;
    cast("Active", "sv.b1");
    await both((t) => t.entries.length === 1 && t.entries[0]!.phase === "Active", "active-only warning");
    const hist = (await tele(B.page)).history.slice(histBefore);
    expect(hist.length).toBe(1);
    expect(hist[0]).toMatch(/^Active:/);
    idle();
    await both((t) => t.active === 0, "removed after the short phase");

    // Cleanup: repeated casts do not grow renderer geometry; a leaving player's warning is removed from the remaining client.
    const g0 = (await snap(A.page)).render?.geometries ?? 0;
    for (let i = 0; i < 4; i++) { cast("Windup", "sv.b2"); await both((t) => t.active === 1, "cycle"); idle(); await both((t) => t.active === 0, "cycle end"); }
    expect((await snap(A.page)).render?.geometries ?? 0).toBeLessThanOrEqual(g0);
    cast("Windup", "ea.a3");
    await both((t) => t.active === 1, "warning before leave");
    await closeContext(B.ctx);
    await until(async () => (await snap(A.page)).players.length === 1, 8000, "B gone");
    idle();
    await until(async () => (await tele(A.page)).active === 0, 8000, "no warning after cast ends");
    for (const x of [A, B]) expect(x.errors).toEqual([]);
  } finally { await closeContext(A.ctx); await closeContext(B.ctx); }
});
