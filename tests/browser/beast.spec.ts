// BEAST01: real browser, real sockets. The server seam only brings the spawn forward; the beast, its telegraph and the boss bar are ordinary replicated state.
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
import { roomDirectory } from "../../apps/server/src/rooms/RoomDirectory.js";
import type { SparringRoom } from "../../apps/server/src/rooms/SparringRoom.js";
import { ARENA } from "../../packages/shared/src/config/arena.js";
import type { Difficulty } from "../../packages/shared/src/sparring.js";
import { evidenceDir } from "./harness/evidence.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const req = createRequire(path.join(root, "apps/client/package.json"));
interface Dev { close(): Promise<void>; listen(): Promise<unknown> }
interface Snap {
  localEntityId: number | null; serverTick: number;
  players: { entityId: number; name: string; action: string; moveId: string; hp100: number; ready: boolean; kills: number; deaths: number; kitId: string }[];
}
let game: Server, svc: AuthServices, vite: Dev, browser: Browser, base: string;
let now = Date.now();
const freePort = (): Promise<number> => new Promise((resolve, reject) => {
  const s = netServer(); s.on("error", reject);
  s.listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); });
});
test.beforeAll(async () => {
  const gamePort = await freePort(), vitePort = await freePort();
  base = `http://localhost:${vitePort}`;
  svc = createAuthServices({ dataDir: mkdtempSync(path.join(tmpdir(), "eb-beast01-")), allowedOrigins: [base], secureCookies: false,
    roomCodes: { play: "arena", practice: "practice" }, buildId: "BEAST01", sessionsPerMinute: 10_000, globalSessionsPerMinute: 10_000 }, () => now);
  game = createGameServer(svc); await game.listen(gamePort, undefined, undefined);
  const target = `http://127.0.0.1:${gamePort}`;
  const v = req("vite") as { createServer(c: unknown): Promise<Dev> };
  vite = await v.createServer({ root: path.join(root, "apps/client"), configFile: false, logLevel: "error",
    server: { hmr: false, watch: null, port: vitePort, strictPort: true, host: "127.0.0.1", fs: { strict: false }, proxy: {
      "/api": { target }, "/matchmake": { target }, "^/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+(\\?.*)?$": { target, ws: true },
    } } });
  await vite.listen();
  browser = await chromium.launch({ ...(process.env["EB_CHROMIUM"] ? { executablePath: process.env["EB_CHROMIUM"] } : {}),
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
});
test.afterAll(async () => { await browser?.close(); await vite?.close(); await game?.gracefullyShutdown(false); });
const snap = (p: Page): Promise<Snap> => p.evaluate(() => (window as unknown as { __eb: { snapshot(): Snap } }).__eb.snapshot());
const button = (p: Page, name: string) => p.getByRole("button", { name, exact: true });
const roomOf = (code: string): SparringRoom => matchMaker.getLocalRoomById(roomDirectory.get(code)!) as unknown as SparringRoom;
async function open(): Promise<{ ctx: BrowserContext; page: Page; errors: string[] }> {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  // Clipboard denial exercises the selectable fallback using the real link route. Secrets stay in memory.
  await ctx.addInitScript(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("fixture denied"); } } }));
  const page = await ctx.newPage(), errors: string[] = [];
  page.on("pageerror", e => errors.push(String(e)));
  return { ctx, page, errors };
}
async function host(bots: Difficulty[]) {
  const h = await open();
  const invite = svc.invites.create({ ttlMs: 120_000, maxUses: 1 }).token;
  await h.page.goto(`${base}/?debug=1&name=Arel#invite=${invite}`);
  await button(h.page, "Fight bots").click();
  if (bots.length === 0) await button(h.page, "Remove Bot 1").click();
  for (let i = 1; i < bots.length; i++) await button(h.page, "Add opponent").click();
  for (let i = 0; i < bots.length; i++) await h.page.getByLabel(`Bot ${i + 1} difficulty`).selectOption(bots[i]!);
  await h.page.getByLabel("Your fighter").selectOption("td");
  const created = h.page.waitForResponse(r => new URL(r.url()).pathname === "/api/sparring" && r.request().method() === "POST");
  await button(h.page, "Start match").click();
  const code = (await (await created).json() as { roomCode: string }).roomCode;
  await expect.poll(async () => h.page.evaluate(() => !!(window as unknown as { __eb?: unknown }).__eb)).toBe(true);
  await expect.poll(async () => (await snap(h.page)).players.filter(p => p.ready).length).toBe(bots.length + 1);
  return { ...h, code };
}

function place(room: SparringRoom, id: number, x: number, z: number): void {
  const b = room.movement!.get(id)!;
  // All fixture positions in this file are on the main island, surface y=0.
  const pos = { x, y: ARENA.capsule.centreAboveSurface + 0.02, z };
  b.rb.setTranslation(pos, true); b.rb.setNextKinematicTranslation(pos);
  b.state.vx = b.state.vy = b.state.vz = 0; b.state.facingYaw = 0;
}
async function unprotected(room: SparringRoom): Promise<void> {
  await expect.poll(() => [...room.combat.all()].every(f => room.sim.tick > f.protectedUntilTick + 2), { timeout: 6000 }).toBe(true);
}


test("beast: warning banner, spawn with boss bar, telegraphed attack, defeat banner; no page errors", async () => {
  const h = await host([]);
  try {
    const room = roomOf(h.code); await unprotected(room);
    const bar = h.page.locator("[data-ui=beast-bar]");
    await expect(bar).toBeHidden();
    room.beast.spawnAt(room.sim.tick + 1);
    await expect(bar).toContainText("Something huge is coming", { timeout: 8000 });
    mkdirSync(evidenceDir(root), { recursive: true });
    await h.page.screenshot({ path: path.join(evidenceDir(root), "BEAST01-warning.png") });
    await expect(bar).toContainText("The Beast", { timeout: 10_000 });
    await h.page.setViewportSize({ width: 844, height: 390 });
    await expect(h.page.locator(".eb-hud")).toHaveAttribute("data-compact", "");
    const bossBox = (await bar.boundingBox())!;
    const awakenBox = (await h.page.locator("[data-control=awaken]").boundingBox())!;
    const joystickBox = (await h.page.locator("[data-control=joystick]").boundingBox())!;
    expect(bossBox.x + bossBox.width + 8).toBeLessThanOrEqual(awakenBox.x);
    expect(bossBox.y + bossBox.height + 8).toBeLessThanOrEqual(joystickBox.y);
    await h.page.screenshot({ path: path.join(evidenceDir(root), "RP01-sparring-beast-844x390.png") });
    await h.page.setViewportSize({ width: 1024, height: 768 });
    const human = (await snap(h.page)).players.find(p => p.name === "Arel")!;
    const b = room.movement!.position(254)!;
    place(room, human.entityId, b[0], b[2] + 11); // far enough that the first swing is only a telegraph; the default camera looks toward -Z, at the beast
    await expect.poll(() => room.combat.get(254)?.action, { timeout: 20_000 }).toBe("Windup");
    await h.page.screenshot({ path: path.join(evidenceDir(root), "BEAST01-windup.png") });
    room.combat.kill(254, room.sim.tick);
    await expect(bar).toContainText("down", { timeout: 5000 });
    await h.page.screenshot({ path: path.join(evidenceDir(root), "BEAST01-defeated.png") });
    expect(h.errors).toEqual([]);
  } finally { await h.ctx.close(); }
});
