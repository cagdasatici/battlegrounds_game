// QV01: two real Chromium contexts observe the replicated urn lifecycle from a real Colyseus server.
// Pickup/interruption/throw/return transitions are produced by the server's UrnSystem (fixture-driven); rendering is real.
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
interface UrnSnap { id: number; state: string; visible: boolean; x: number; y: number; z: number; holderId: number }
interface Snap { urns: UrnSnap[]; localEntityId: number | null; players: { entityId: number; x: number; y: number; z: number; ready: boolean }[] }

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

test("QV01: both clients see urn pickup, interruption, throw, return and rejoin", async () => {
  test.setTimeout(150_000);
  const A = await open("Arel", "ea");
  const B = await open("Nora", "sv");
  let C: Awaited<ReturnType<typeof open>> | null = null;
  try {
    await until(async () => (await snap(B.page)).players.filter((p) => p.ready).length === 2, 15000, "both ready");
    const listings = await matchMaker.query({ name: "arena" });
    const arena = matchMaker.getLocalRoomById(listings[0]!.roomId) as unknown as ArenaRoom;
    const aId = await until(async () => (await snap(A.page)).localEntityId, 10000, "A local entity id " + JSON.stringify(A.errors));
    // Stand fighter A beside urn 0 (anchor -9, 0.25, -10) so it is in view.
    const gy = (arena.world!.groundHeight(-8, -10) ?? 0) + 0.9;
    await until(async () => (arena.movement?.get(aId) ? true : false), 5000, "movement body exists");
    const body = arena.movement!.get(aId)!;
    const pos = { x: -8, y: gy, z: -10 };
    body.rb.setTranslation(pos, true); body.rb.setNextKinematicTranslation(pos);
    const urn = (p: Page) => snap(p).then((s) => s.urns.find((u) => u.id === 0));
    const both = async (pred: (u: UrnSnap | undefined) => boolean, what: string) => {
      for (const p of [A.page, B.page]) await until(async () => pred(await urn(p)), 8000, what);
    };
    await both((u) => u?.state === "anchored" && u.visible, "anchored visible in both");
    const a0 = await urn(B.page);
    expect(a0!.x).toBeCloseTo(-9, 1); expect(a0!.z).toBeCloseTo(-10, 1);

    // Pickup channel: server reserves; the move id lets the server keep it reserved.
    const fa = arena.combat.get(aId)!;
    fa.moveId = "ea.pickup";
    expect(arena.urns.reserve(0, fa)).toBe(true);
    await both((u) => u?.state === "reserved" && u.visible, "reserved highlight in both");
    // Interruption: server drops it back to the anchor.
    arena.urns.drop(aId); fa.moveId = "";
    await both((u) => u?.state === "anchored" && u.visible, "interrupted pickup re-anchors");

    // Completed pickup: held, rendered beside the holder in both clients.
    fa.moveId = "ea.pickup";
    arena.urns.reserve(0, fa); arena.urns.complete(aId);
    await both((u) => u?.state === "held" && u.visible, "held visible in both");
    for (const p of [A.page, B.page]) {
      const s = await snap(p);
      const holder = s.players.find((q) => q.entityId === aId)!;
      const u = s.urns.find((q) => q.id === 0)!;
      expect(Math.hypot(u.x - holder.x, u.z - holder.z)).toBeLessThan(1.5);
    }
    // Throw: urn leaves the hand and is hidden until the server re-anchors it.
    fa.moveId = "";
    const thrown = arena.urns.consumeThrown(aId, arena.sim.tick)!;
    thrown.returnTick = arena.sim.tick + 100_000; // keep it returning while the rejoin completes
    await both((u) => u?.state === "returning" && !u.visible, "returning hidden in both");
    // Rejoin: client B leaves and a fresh client joins mid-return; it sees the same hidden state, then the return.
    await B.ctx.close();
    C = await open("Late", "td");
    await until(async () => (await urn(C!.page))?.state === "returning", 8000, "late joiner sees returning");
    await until(async () => (await urn(A.page))?.state === "returning", 8000, "A still sees returning");
    thrown.returnTick = arena.sim.tick + 1;
    for (const p of [A.page, C.page]) await until(async () => { const u = await urn(p); return u?.state === "anchored" && u.visible; }, 8000, "returned to anchor");
    for (const x of [A, B, C]) expect(x.errors).toEqual([]);
  } finally { await A.ctx.close(); await B.ctx.close().catch(() => undefined); await C?.ctx.close(); }
});
