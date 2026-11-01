// ORB2: two real Chromium contexts, the shipped client and a real Colyseus server.
import { test, expect, chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer as netServer } from "node:net";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { matchMaker, type Server } from "colyseus";
import type { ArenaRoom } from "../../apps/server/src/rooms/ArenaRoom.js";
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
  projectiles: { id: string; x: number; y: number; z: number; ownerId: number; reflectionCount: number }[];
  hitMoveIds?: string[];
  localEntityId: number | null; serverTick: number; reconciles: number;
  corrections: Record<string, number>; predicted: { x: number; y: number; z: number } | null;
  players: { entityId: number; name: string; kitId: string; hp100: number; action: string; moveId: string; ready: boolean; x: number; y: number; z: number; local: boolean }[];
}

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

async function open(name: string, kit: string): Promise<{ ctx: BrowserContext; page: Page; errors: string[] }> {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  if (process.env["EB_PW_DEBUG"]) { page.on("console", (m) => console.log(name, m.type(), m.text())); page.on("requestfailed", (r) => console.log(name, "FAILED", r.url())); page.on("response", (r) => { if (r.status() >= 400) console.log(name, r.status(), r.url()); }); }
  const { token } = svc.invites.create({ ttlMs: 120_000, maxUses: 1 });
  await page.goto(`${base}/?room=match&name=${name}&kit=${kit}&debug=1&auto=1#invite=${token}`);
  await page.waitForFunction(() => (window as unknown as { __eb?: unknown }).__eb !== undefined, undefined, { timeout: 30_000 })
    .catch(async (e: unknown) => { throw new Error(`${String(e)}\npage: ${await page.evaluate(() => document.body.innerText)} url=${page.url()} tokenLen=${token.length}`); });
  return { ctx, page, errors };
}


test("ORB2: two browsers render authoritative flight, reflection and expiry", async () => {
  test.setTimeout(120_000);
  const A = await open("Arel", "ea");
  const B = await open("Nora", "sv");
  try {
    await until(async () => (await snap(B.page)).players.filter(p => p.ready).length === 2, 15000, "both ready");
    const room = matchMaker.query({ name: "arena" });
    const listings = await room;
    const arena = matchMaker.getLocalRoomById(listings[0]!.roomId) as unknown as ArenaRoom;
    const aId = (await snap(A.page)).localEntityId!;
    const bId = (await snap(B.page)).localEntityId!;
    // Deterministic server fixture keeps the shot in view long enough to inspect on software WebGL.
    // Uses the shipped projectile system; browser state and all presentation are real network clients.
    const groundY = (arena.world!.groundHeight(-4, 9) ?? 0) + 0.9;
    for (const [id, x] of [[aId, -4], [bId, -2]]) {
      const body = arena.movement!.get(id!)!;
      const position = { x: x!, y: groundY, z: 9 };
      body.rb.setTranslation(position, true); body.rb.setNextKinematicTranslation(position);
    }
    await until(async () => (await snap(A.page)).predicted!.z > 8 && (await snap(B.page)).predicted!.z > 8,
      5000, "cameras follow fixture positions");
    const x = -3, z = 4, y = groundY + 1.5;
    const spawnTick = arena.sim.tick;
    const id = arena.projectiles.spawn({
      ownerId: aId, ownerLifeId: arena.combat.get(aId)!.lifeId, castCounter: 99, moveId: "ea.b3",
      x, y, z, dirX: 0, dirY: 0, dirZ: -1, speed: 2, lifeTicks: 240, maxRange: 40,
      radius: 0.35, splashRadius: 2, splashMax: 4, reflectable: true,
      arcAmplitude: 0, arcSpan: 0, chargeClass: "partial", damage100: 1500, chip100: 500,
      block: "B", reaction: { kind: "none" },
    }, arena.sim.tick)!;
    expect(id).toBeGreaterThan(0);
    const orb = async (p: Page) => (await snap(p)).projectiles.find(q => q.id === String(id));
    for (const p of [A.page, B.page]) await until(async () => (await orb(p)) ?? false, 5000, "orb visible");
    const before = await Promise.all([orb(A.page), orb(B.page)]);
    await until(async () => {
      const values = await Promise.all([orb(A.page), orb(B.page)]);
      return values.every((v, i) => v && v.z < before[i]!.z - 0.4);
    }, 5000, "flight advances in both scenes");
    await A.page.screenshot({ path: path.join(outDir, "ORB2-flight-a.png") });
    await B.page.screenshot({ path: path.join(outDir, "ORB2-flight-b.png") });
    expect(arena.projectiles.reflect(id, bId, 100, arena.sim.tick)).toBe("reflected");
    for (const p of [A.page, B.page]) await until(async () => {
      const q = await orb(p); return q?.reflectionCount === 1 && q.ownerId === bId;
    }, 5000, "reflection visible");
    const reflected = await Promise.all([orb(A.page), orb(B.page)]);
    await until(async () => {
      const values = await Promise.all([orb(A.page), orb(B.page)]);
      return values.every((v, i) => v && v.z > reflected[i]!.z + 0.3);
    }, 5000, "reflected flight reverses in both scenes");
    await A.page.screenshot({ path: path.join(outDir, "ORB2-reflected.png") });
    await until(async () => !(await orb(A.page)) && !(await orb(B.page)), 12000, "server expiry removes both views");
    expect(arena.projectiles.size).toBe(0);
    expect(arena.sim.tick).toBeGreaterThanOrEqual(spawnTick + 240);
    expect(A.errors).toEqual([]); expect(B.errors).toEqual([]);
    writeFileSync(path.join(outDir, "ORB2-playwright.json"), JSON.stringify({ before, reflected, expiredInBoth: true }, null, 2));
  } finally { await A.ctx.close(); await B.ctx.close(); }
});
