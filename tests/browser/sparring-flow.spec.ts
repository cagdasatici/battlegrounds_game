// BOT5: real browser contexts, HTTP auth, sockets, and authoritative combat on localhost.
// Server-only fixtures arrange poses/HP and observable actions; all damage/scoring uses the ordinary pipeline.
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
import { beginCast, releaseToIdle } from "../../apps/server/src/sim/ActionMachine.js";
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
  svc = createAuthServices({ dataDir: mkdtempSync(path.join(tmpdir(), "eb-bot5-")), allowedOrigins: [base], secureCookies: false,
    roomCodes: { play: "arena", practice: "practice" }, buildId: "BOT5", sessionsPerMinute: 10_000, globalSessionsPerMinute: 10_000 }, () => now);
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
  await button(h.page, "Host sparring").click();
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
async function link(p: Page): Promise<string> {
  await button(p, "Sparring controls").click();
  await button(p, "Copy guest link").click();
  const input = p.getByLabel("Guest link", { exact: true });
  await expect(input).toBeVisible();
  const url = await input.inputValue();
  expect(new URL(url).origin).toBe(base);
  // Hide bearer before any screenshot or game assertions.
  await button(p, "Back to game").click();
  return url;
}
async function end(p: Page): Promise<void> {
  await button(p, "Sparring controls").click(); await button(p, "End match").click();
  await expect(button(p, "Host sparring")).toBeVisible();
}
async function joinGuest(url: string) {
  const g = await open();
  const u = new URL(url); u.searchParams.set("debug", "1");
  await g.page.goto(u.href);
  await expect(g.page.getByLabel("Guest display name")).toBeVisible();
  expect(new URL(g.page.url()).hash).toBe("");
  await g.page.getByLabel("Guest display name").fill("Nora");
  await g.page.click("[data-act=play]");
  // QP01 loads renderer/physics/map on the first Play, so the lobby appears only after software-GL asset loading (~7s).
  await expect(g.page.locator("[data-act=ready]")).toBeVisible({ timeout: 30_000 });
  await g.page.click("[data-act=kit][data-kit=sv]"); await g.page.click("[data-act=ready]");
  await expect.poll(async () => g.page.evaluate(() => !!(window as unknown as { __eb?: unknown }).__eb)).toBe(true);
  return g;
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

test("solo Easy attacks and changes replicated HP; touch layout and host ends/rehosts", async () => {
  const h = await host(["easy"]);
  try {
    const room = roomOf(h.code); await unprotected(room);
    const state = await snap(h.page), bot = state.players.find(p => p.name === "Bot 1")!, human = state.players.find(p => p.name === "Arel")!;
    place(room, bot.entityId, 0, 0); place(room, human.entityId, 0, -1.5);
    await expect.poll(async () => (await snap(h.page)).players.find(p => p.name === "Arel")!.hp100, { timeout: 8000 }).toBeLessThan(10000);
    await expect.poll(async () => (await snap(h.page)).players.find(p => p.name === "Bot 1")!.moveId).toMatch(/^m1\./);
    for (const selector of ["attack", "block", "skill1", "joystick"]) await expect(h.page.locator(`[data-control=${selector}]`)).toBeVisible();
    mkdirSync(evidenceDir(root), { recursive: true });
    await h.page.screenshot({ path: path.join(evidenceDir(root), "BOT5-solo.png") });
    await end(h.page);
    expect(svc.sparring.describe(h.code)).toBeNull();
    await button(h.page, "Host sparring").click();
    await h.page.getByLabel("Bot 1 difficulty").selectOption("easy");
    const created = h.page.waitForResponse(r => new URL(r.url()).pathname === "/api/sparring" && r.request().method() === "POST");
    await button(h.page, "Start match").click();
    const next = (await (await created).json() as { roomCode: string }).roomCode;
    expect(next).not.toBe(h.code);
    await expect(button(h.page, "Sparring controls")).toBeVisible();
    await end(h.page);
    expect(h.errors).toEqual([]);
  } finally { await h.ctx.close(); }
});

test("mixed Medium/Hard deterministic visible-action guard and legal slot 1 cast", async () => {
  const h = await host(["medium", "hard"]);
  try {
    const room = roomOf(h.code); await unprotected(room);
    await expect.poll(() => [...room.state.players.values()].every(p => room.movement!.get(p.entityId)?.state.grounded)).toBe(true);
    room.setSimulationInterval(() => undefined, 1000);
    const state = await snap(h.page), medium = state.players.find(p => p.name === "Bot 1")!, hard = state.players.find(p => p.name === "Bot 2")!, human = state.players.find(p => p.name === "Arel")!;
    let tick = room.sim.tick;
    place(room, medium.entityId, 0, 0); place(room, human.entityId, 0, -1.5); place(room, hard.entityId, 12, 12);
    expect(beginCast(room.combat.get(human.entityId)!, tick, "m1.1", 60, 1, 0, 0).ok).toBe(true);
    for (let i = 0; i < 16; i++) room.stepTick(++tick);
    await expect.poll(async () => (await snap(h.page)).players.find(p => p.name === "Bot 1")!.action).toBe("Guard");
    releaseToIdle(room.combat.get(human.entityId)!, tick);
    place(room, hard.entityId, -5, 0); place(room, human.entityId, -5, -1.5); place(room, medium.entityId, 12, 12);
    for (let i = 0; i < 7; i++) room.stepTick(++tick);
    // BOT6 rotates bot kits (Bot 2 is td) and Hard scans slots from 1 + (k % 4); k depends on the bot's spawn tick, so any legal td Base slot is a pass.
    await expect.poll(async () => (await snap(h.page)).players.find(p => p.name === "Bot 2")!.moveId).toMatch(/^td\.b[1-4]$/);
    expect(room.combat.invariantViolations()).toEqual([]);
    await end(h.page); expect(h.errors).toEqual([]);
  } finally { await h.ctx.close(); }
});

test("zero bots, copied link, fresh isolated guest and shared touch-combat KO", async () => {
  const h = await host([]); let g: Awaited<ReturnType<typeof joinGuest>> | undefined;
  try {
    g = await joinGuest(await link(h.page));
    expect((await g.ctx.cookies()).some(c => c.name === "eb_session")).toBe(false);
    expect((await g.ctx.cookies()).some(c => c.name === "eb_spar_guest")).toBe(true);
    await expect.poll(async () => (await snap(g!.page)).players.length).toBe(2);
    const room = roomOf(h.code); await unprotected(room);
    const state = await snap(h.page), human = state.players.find(p => p.name === "Arel")!, guest = state.players.find(p => p.name === "Nora")!;
    place(room, human.entityId, 0, 1.5); place(room, guest.entityId, 0, 0);
    room.combat.get(guest.entityId)!.hp100 = 100;
    const attack = h.page.locator("[data-control=attack]"), bounds = (await attack.boundingBox())!;
    await h.page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); await h.page.mouse.down();
    try { await expect.poll(async () => (await snap(h.page)).players.find(p => p.name === "Arel")!.kills, { timeout: 6000 }).toBe(1); }
    finally { await h.page.mouse.up(); }
    await expect.poll(async () => (await snap(g!.page)).players.find(p => p.name === "Nora")!.deaths).toBe(1);
    const outcome = (s: Snap) => s.players.map(p => ({ name: p.name, hp: p.hp100, kills: p.kills, deaths: p.deaths }));
    await expect.poll(async () => outcome(await snap(g!.page))).toEqual(outcome(await snap(h.page)));
    await h.page.screenshot({ path: path.join(evidenceDir(root), "BOT5-shared-outcome.png") });
    await end(h.page);
    // GR03: a closed match is an explicit error route for the guest, never a silent reset; Back returns to Welcome.
    await expect(g.page.locator("[data-ui=error]")).toBeVisible();
    await g.page.click("[data-act=back]");
    await expect(g.page.locator("[data-act=play]")).toBeVisible();
    expect(g.errors).toEqual([]); expect(h.errors).toEqual([]);
  } finally { await g?.ctx.close(); await h.ctx.close(); }
});

test("full four-fighter roster disables sharing and refuses link creation", async () => {
  const h = await host(["easy", "medium", "hard"]);
  try {
    await button(h.page, "Sparring controls").click();
    await expect(button(h.page, "Copy guest link")).toBeDisabled();
    const status = await h.page.evaluate(async code => {
      const { csrfToken } = await (await fetch("/api/csrf")).json() as { csrfToken: string };
      return (await fetch("/api/sparring/link", { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrfToken }, body: JSON.stringify({ roomCode: code }) })).status;
    }, h.code);
    expect(status).toBe(409);
    await button(h.page, "Back to game").click(); await end(h.page); expect(h.errors).toEqual([]);
  } finally { await h.ctx.close(); }
});

test("expired copied link rejects a fresh guest with no membership", async () => {
  const h = await host([]), g = await open();
  try {
    const url = await link(h.page); now += 600_001;
    await g.page.goto(url);
    await expect(g.page.getByLabel("Guest display name")).toBeVisible();
    expect(new URL(g.page.url()).hash).toBe("");
    const rejected = g.page.waitForResponse(r => new URL(r.url()).pathname === "/api/sparring/redeem");
    await g.page.click("[data-act=play]");
    expect((await rejected).status()).toBe(401);
    await expect(g.page.locator("[data-ui=error]")).toHaveAttribute("data-code", "INVITE_INVALID");
    expect((await g.ctx.cookies()).some(c => c.name === "eb_spar_guest")).toBe(false);
    await end(h.page); expect(g.errors).toEqual([]); expect(h.errors).toEqual([]);
  } finally { await g.ctx.close(); await h.ctx.close(); }
});
