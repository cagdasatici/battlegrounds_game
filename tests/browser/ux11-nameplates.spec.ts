// UX11 base (copied setup from p0-gate): two real browser contexts (Chromium, SwiftShader WebGL) complete all 16 slotted moves
// (sv b1-b4, sv a1-a4, td b1-b4, td a1-a4) and both awakenings through the real UI (touch taps on the HUD and keyboard),
// against a real in-process Colyseus server. Expected numbers are the R12 wire-matrix numbers (docs/test-results/R12.md).
// Assertions read ONLY replicated state as seen by both browser clients (window.__eb.snapshot via ?debug=1).
// Server fixtures (documented in docs/test-results/T18e.md): placement through the room's movement body API and
// awakening meter pre-fill through room.combat, the same fixtures used by tests/integration/kit-matrix.test.ts.
import { test, expect, chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync } from "node:fs";
import { createServer as netServer } from "node:net";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { matchMaker, type Server } from "colyseus";
import { createGameServer } from "../../apps/server/src/createServer.js";
import { createAuthServices, type AuthServices } from "../../apps/server/src/auth/Services.js";
import type { ArenaRoom } from "../../apps/server/src/rooms/ArenaRoom.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const outDir = evidenceDir(root);
const req = createRequire(path.join(root, "apps/client/package.json"));
import { resolveChromium } from "./harness/chromium-path.js";
import { evidenceDir } from "./harness/evidence.js";
const CHROMIUM = resolveChromium();
const GL_ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];

interface Dev { close(): Promise<void>; listen(): Promise<unknown> }
interface P { entityId: number; name: string; kitId: string; hp100: number; action: string; moveId: string; ready: boolean; x: number; z: number; local: boolean; meter100: number; form: string }
interface Snap { serverTick: number; players: P[] }
type KitId = "sv" | "td";

let game: Server, svc: AuthServices, vite: Dev, browser: Browser;
let base = "";
let n = 0;

const freePort = (): Promise<number> => new Promise((resolve, reject) => {
  const s = netServer();
  s.listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); });
  s.on("error", reject);
});

test.beforeAll(async () => {
  const gamePort = await freePort(), vitePort = await freePort();
  base = `http://localhost:${vitePort}`;
  svc = createAuthServices({
    dataDir: mkdtempSync(path.join(tmpdir(), "eb-pw-u11-")), allowedOrigins: [base], secureCookies: false,
    roomCodes: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`u11r${i}`, "arena"])), buildId: "test", sessionsPerMinute: 10_000, globalSessionsPerMinute: 10_000,
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
    await sleep(30);
  }
}

async function open(room: string, name: string, kit: KitId): Promise<{ ctx: BrowserContext; page: Page; errors: string[] }> {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  const { token } = svc.invites.create({ ttlMs: 120_000, maxUses: 1 });
  await page.goto(`${base}/?room=${room}&name=${name}&kit=${kit}&debug=1&auto=1#invite=${token}`);
  await page.waitForFunction(() => (window as unknown as { __eb?: unknown }).__eb !== undefined, undefined, { timeout: 30_000 });
  return { ctx, page, errors };
}

const touch = async (p: Page, control: string): Promise<void> => {
  const b = (await p.locator(`[data-control=${control}]`).boundingBox())!;
  await p.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
};
const key = async (p: Page, code: string): Promise<void> => { await p.keyboard.down(code); await sleep(120); await p.keyboard.up(code); };


test("UX11: enemy plate with HP, and an off-screen arrow when the enemy is behind", async () => {
  test.setTimeout(120_000);
  const code = `u11r${n++}`;
  const A = await open(code, "Arel", "sv");
  await until(async () => (await snap(A.page)).players.some((p) => p.local), 20_000, "A joined");
  const B = await open(code, "Nora", "td");
  try {
    await until(async () => {
      const [a, b] = [await snap(A.page), await snap(B.page)];
      return a.players.length === 2 && b.players.length === 2 && a.players.every((p) => p.ready) && b.players.every((p) => p.ready) ? true : null;
    }, 25_000, "both ready");
    const info = (await matchMaker.query({ name: "arena" })).find((r) => r.clients === 2);
    const room = matchMaker.getLocalRoomById(info!.roomId) as unknown as ArenaRoom;
    const sa = await snap(A.page);
    const ids = { A: sa.players.find((p) => p.local)!.entityId, B: sa.players.find((p) => !p.local)!.entityId };
    await until(async () => room.movement!.get(ids.A)!.state.grounded && room.movement!.get(ids.B)!.state.grounded ? true : null, 15_000, "settled");
    const place = (seat: "A" | "B", x: number, z: number, yaw: number): void => {
      const body = room.movement!.get(ids[seat])!;
      const y = room.movement!.position(ids[seat])![1];
      body.rb.setTranslation({ x, y, z }, true);
      body.rb.setNextKinematicTranslation({ x, y, z });
      body.state.facingYaw = yaw; body.state.vx = 0; body.state.vz = 0;
    };
    // Yaw 0 faces -Z: A on the +Z side of B, both facing each other.
    place("B", 0, -3, Math.PI); place("A", 0, -1.5, 0);
    for (const p of [A.page, B.page]) {
      await until(async () => (await p.locator("[data-plate]").count()) === 1 ? true : null, 10_000, "one plate");
      expect(await p.locator("[data-arrow]").count()).toBe(0);
    }
    mkdirSync(outDir, { recursive: true });
    await A.page.screenshot({ path: path.join(outDir, "UX11-plate.png") });
    await A.page.evaluate(() => (window as unknown as { __eb: { setCameraYaw(y: number): void } }).__eb.setCameraYaw(Math.PI));
    // Camera now orbits to the far side (z=-8 looking +z); put B behind the camera so it is off-screen.
    place("B", 0, -10, Math.PI);
    await until(async () => (await A.page.locator("[data-arrow]").count()) === 1 ? true : null, 10_000, "arrow when enemy behind");
    expect(await A.page.locator("[data-plate]").count()).toBe(0);
    await A.page.screenshot({ path: path.join(outDir, "UX11-arrow.png") });
    expect(A.errors).toEqual([]);
    expect(B.errors).toEqual([]);
  } finally {
    await A.ctx.close(); await B.ctx.close();
  }
});
