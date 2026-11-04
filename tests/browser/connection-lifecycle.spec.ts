// GR03: real browser clients and a real in-process Colyseus server. Server-side fixtures only terminate sockets,
// close seats with a code, revoke sessions and place bodies; every gameplay effect goes through the ordinary pipeline.
import { test, expect, chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { createServer as netServer } from "node:net";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { matchMaker, type Server } from "colyseus";
import { createGameServer } from "../../apps/server/src/createServer.js";
import { createAuthServices, type AuthServices } from "../../apps/server/src/auth/Services.js";
import { roomDirectory } from "../../apps/server/src/rooms/RoomDirectory.js";
import type { ArenaRoom } from "../../apps/server/src/rooms/ArenaRoom.js";
import { ARENA } from "../../packages/shared/src/config/arena.js";
import { resolveChromium } from "./harness/chromium-path.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const req = createRequire(path.join(root, "apps/client/package.json"));
const GL_ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];
interface Dev { close(): Promise<void>; listen(): Promise<unknown> }
interface P { entityId: number; name: string; hp100: number; action: string; ready: boolean; local: boolean; kills: number; deaths: number; cooldownEndTicks: number[]; x: number; z: number }
interface Snap { serverTick: number; localEntityId: number | null; players: P[] }

let game: Server, svc: AuthServices, vite: Dev, browser: Browser, base = "", n = 0;
const freePort = (): Promise<number> => new Promise((resolve, reject) => {
  const s = netServer(); s.on("error", reject);
  s.listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); });
});
test.beforeAll(async () => {
  const gamePort = await freePort(), vitePort = await freePort();
  base = `http://localhost:${vitePort}`;
  svc = createAuthServices({
    dataDir: mkdtempSync(path.join(tmpdir(), "eb-gr03-")), allowedOrigins: [base], secureCookies: false,
    roomCodes: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`gr3r${i}`, "arena"])), buildId: "GR03", sessionsPerMinute: 10_000, globalSessionsPerMinute: 10_000,
  });
  game = createGameServer(svc);
  await game.listen(gamePort, undefined, undefined);
  const target = `http://127.0.0.1:${gamePort}`;
  const v = req("vite") as { createServer(c: unknown): Promise<Dev> };
  vite = await v.createServer({
    root: path.join(root, "apps/client"), configFile: false, logLevel: "error",
    server: { hmr: false, watch: null, port: vitePort, strictPort: true, host: "127.0.0.1", fs: { strict: false }, proxy: {
      "/api": { target }, "/matchmake": { target }, "^/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+(\\?.*)?$": { target, ws: true },
    } },
  });
  await vite.listen();
  browser = await chromium.launch({ executablePath: resolveChromium(), args: GL_ARGS });
});
test.afterAll(async () => { await browser?.close(); await vite?.close(); await game?.gracefullyShutdown(false); });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const snap = (p: Page): Promise<Snap> => p.evaluate(() => (window as unknown as { __eb: { snapshot(): unknown } }).__eb.snapshot() as never);
const me = async (p: Page): Promise<P> => (await snap(p)).players.find((x) => x.local)!;
async function until<T>(f: () => Promise<T | null | false>, ms: number, what: string): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await f();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timeout: ${what}`);
    await sleep(40);
  }
}
const hasProbe = (p: Page) => p.evaluate(() => !!(window as unknown as { __eb?: unknown }).__eb).catch(() => false);
/** Net listener and outstanding-rAF counters installed before any page script runs (test-only; production exposes nothing). */
const COUNTERS = () => {
  const live = new Set<string>(); const ids = new Map<object, number>(); let next = 1;
  const idOf = (o: object): number => { let i = ids.get(o); if (!i) { i = next++; ids.set(o, i); } return i; };
  const key = (t: object, type: string, l: unknown, c: unknown): string => `${idOf(t)}|${type}|${idOf(l as object)}|${typeof c === "boolean" ? c : (c as { capture?: boolean } | undefined)?.capture === true}`;
  const add = EventTarget.prototype.addEventListener, rem = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function (type: string, l: EventListenerOrEventListenerObject | null, o?: boolean | AddEventListenerOptions) {
    if (l) live.add(key(this, type, l, o)); return add.call(this, type, l, o);
  };
  EventTarget.prototype.removeEventListener = function (type: string, l: EventListenerOrEventListenerObject | null, o?: boolean | EventListenerOptions) {
    if (l) live.delete(key(this, type, l, o)); return rem.call(this, type, l, o);
  };
  const raf = window.requestAnimationFrame.bind(window), caf = window.cancelAnimationFrame.bind(window);
  const pending = new Set<number>();
  window.requestAnimationFrame = (cb) => { const id = raf((t) => { pending.delete(id); cb(t); }); pending.add(id); return id; };
  window.cancelAnimationFrame = (id) => { pending.delete(id); caf(id); };
  (window as unknown as { __counts: () => unknown }).__counts = () => ({
    keydown: [...live].filter((k) => k.split("|")[1] === "keydown").length,
    pointerdown: [...live].filter((k) => k.split("|")[1] === "pointerdown").length,
    pagehide: [...live].filter((k) => k.split("|")[1] === "pagehide").length,
    raf: pending.size,
  });
};
async function open(room: string, name: string, extra = ""): Promise<{ ctx: BrowserContext; page: Page; errors: string[] }> {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  await ctx.addInitScript(COUNTERS);
  const page = await ctx.newPage(), errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  const { token } = svc.invites.create({ ttlMs: 120_000, maxUses: 1 });
  await page.goto(`${base}/?room=${room}&name=${name}&kit=sv&debug=1&auto=1${extra}#invite=${token}`);
  await until(() => hasProbe(page), 40_000, `${name} joined`);
  return { ctx, page, errors };
}
const roomOf = (code: string): ArenaRoom => matchMaker.getLocalRoomById(roomDirectory.get(code)!) as unknown as ArenaRoom;
async function pair(code: string) {
  const A = await open(code, "Arel"), B = await open(code, "Nora");
  await until(async () => { const s = await snap(A.page); return s.players.length === 2 && s.players.every((p) => p.ready); }, 30_000, "both ready");
  const room = roomOf(code), a = (await me(A.page)).entityId, b = (await me(B.page)).entityId;
  await until(async () => [...room.combat.all()].every((f) => f.action !== "Dead" && room.sim.tick > f.protectedUntilTick + 2), 10_000, "spawn protection over");
  return { A, B, room, a, b };
}
function place(room: ArenaRoom, id: number, x: number, z: number): void {
  const bd = room.movement!.get(id)!;
  const pos = { x, y: room.movement!.position(id)![1], z }; // the central area of the islands map; keep the current height
  bd.rb.setTranslation(pos, true); bd.rb.setNextKinematicTranslation(pos);
  bd.state.vx = bd.state.vy = bd.state.vz = 0; bd.state.facingYaw = 0;
}
const clientOf = (room: ArenaRoom, entity: number) => {
  for (const c of room.clients) { const seat = (room as unknown as { seats: Map<string, { entityId: number }> }).seats.get(c.sessionId); if (seat?.entityId === entity) return c; }
  throw new Error("no client for entity");
};
const terminate = (room: ArenaRoom, entity: number) => (clientOf(room, entity) as unknown as { ref: { terminate(): void } }).ref.terminate();
const stateOf = (room: ArenaRoom, id: number) => room.state.players.get(String(id))!;
const errorCode = (p: Page) => p.locator("[data-ui=error]").getAttribute("data-code");

test("drop and reconnect: HP, life, cooldown and score survive; a physically held attack/move is not replayed after the new welcome", async () => {
  test.setTimeout(180_000);
  const { A, B, room, a, b } = await pair(`gr3r${n++}`);
  try {
    place(room, a, 0, -3); place(room, b, 0, 5); // far apart: a held M1 would swing at nothing, which still changes the action
    room.combat.get(a)!.hp100 = 6000;
    const skill = (await A.page.locator("[data-control=skill1]").boundingBox())!;
    await A.page.touchscreen.tap(skill.x + skill.width / 2, skill.y + skill.height / 2);
    await until(async () => (await me(A.page)).cooldownEndTicks[0]! > room.sim.tick, 5000, "skill1 cooldown started");
    await until(async () => (await me(A.page)).action === "Idle", 8000, "cast finished");
    const before = await me(A.page), life = stateOf(room, a).lifeId;
    await A.page.evaluate(() => { // record every banner text the page shows
      const el = document.querySelector("[data-ui=connection-status]") as HTMLElement; const log: string[] = [];
      (window as unknown as { __banner: string[] }).__banner = log;
      new MutationObserver(() => { log.push(el.hidden ? "" : el.textContent ?? ""); }).observe(el, { attributes: true, childList: true, characterData: true, subtree: true });
    });
    const attack = (await A.page.locator("[data-control=attack]").boundingBox())!;
    await A.page.mouse.move(attack.x + attack.width / 2, attack.y + attack.height / 2); await A.page.mouse.down();
    await sleep(5600); // the SDK only reconnects a room that has been up for 5 s (its minUptime)
    await A.page.keyboard.down("w"); // held briefly (the island is small), still down across the drop and the reconnect
    await sleep(400);
    terminate(room, a);
    await until(async () => stateOf(room, a).connected === false, 8000, "server saw the drop");
    expect(room.state.players.size).toBe(2); // seat kept, no duplicate
    await until(async () => stateOf(room, a).connected === true, 25_000, "reconnected inside the window");
    const log = await A.page.evaluate(() => (window as unknown as { __banner: string[] }).__banner);
    expect(log).toContain("Reconnecting… Your fighter is still in the arena.");
    await until(async () => (await A.page.locator("[data-ui=connection-status]").isHidden()), 15_000, "banner hidden once active");
    const z0 = stateOf(room, a).z;
    // Buttons are STILL physically down. Nothing from before the drop may act after the welcome.
    for (let i = 0; i < 30; i++) {
      expect(stateOf(room, a).action, "no attack replayed").toBe("Idle");
      await sleep(80);
    }
    expect(stateOf(room, a).z, "no movement replayed").toBe(z0);
    const after = await me(A.page);
    expect({ id: after.entityId, hp: after.hp100, kills: after.kills, deaths: after.deaths, cd: after.cooldownEndTicks })
      .toEqual({ id: before.entityId, hp: before.hp100, kills: before.kills, deaths: before.deaths, cd: before.cooldownEndTicks });
    expect(stateOf(room, a).lifeId).toBe(life);
    // A fresh press works again.
    await A.page.mouse.up(); await A.page.keyboard.up("w");
    await A.page.mouse.move(attack.x + attack.width / 2, attack.y + attack.height / 2); await A.page.mouse.down();
    await until(async () => stateOf(room, a).action !== "Idle", 5000, "fresh press acts");
    await A.page.mouse.up();
    expect(A.errors).toEqual([]); expect(B.errors).toEqual([]);
  } finally { await A.ctx.close(); await B.ctx.close(); }
});

test("reload during life and during death restores the same fighter without a second seat or a second Ready", async () => {
  test.setTimeout(180_000);
  const { A, B, room, a, b } = await pair(`gr3r${n++}`);
  try {
    place(room, a, 0, -3); place(room, b, 0, 5);
    room.combat.get(a)!.hp100 = 7000;
    const idBefore = (await me(A.page)).entityId;
    const life1 = stateOf(room, a).lifeId;
    await A.page.reload();
    await until(() => hasProbe(A.page), 60_000, "resumed after reload (alive)");
    let s = await me(A.page);
    expect(s.entityId).toBe(idBefore);
    expect(s.hp100).toBe(7000);
    expect(s.ready).toBe(true);
    expect(stateOf(room, a).lifeId).toBe(life1);
    expect(room.state.players.size).toBe(2);
    await expect(A.page.locator("[data-act=play]")).toHaveCount(0); // never showed Welcome

    // Death: the ordinary void rule ends the life; reload while the fighter is dead or just respawned.
    const deaths0 = stateOf(room, a).deaths;
    place(room, a, 0, -3);
    const bd = room.movement!.get(a)!; const gone = { x: 0, y: ARENA.voidY - 15, z: 0 };
    bd.rb.setTranslation(gone, true); bd.rb.setNextKinematicTranslation(gone);
    await until(async () => stateOf(room, a).deaths === deaths0 + 1, 10_000, "void KO");
    await A.page.reload();
    await until(() => hasProbe(A.page), 60_000, "resumed after reload (death)");
    s = await me(A.page);
    expect(s.entityId).toBe(idBefore);
    expect(s.deaths).toBe(deaths0 + 1);
    expect(room.state.players.size).toBe(2);
    await until(async () => stateOf(room, a).action !== "Dead", 15_000, "respawned");
    expect(stateOf(room, a).lifeId).toBeGreaterThan(life1);
    expect(A.errors).toEqual([]);
  } finally { await A.ctx.close(); await B.ctx.close(); }
});

test("a rejected resume shows Welcome and discards the stored token and metadata", async () => {
  test.setTimeout(120_000);
  const { A, B } = await pair(`gr3r${n++}`);
  try {
    await A.page.evaluate(() => {
      sessionStorage.setItem("eb.reconnect", "no-such-room:no-such-token");
      sessionStorage.setItem("eb.reconnect.meta", JSON.stringify({ roomCode: "gr3r0", mode: "play", host: false }));
    });
    await A.page.reload();
    await expect(A.page.locator("[data-act=play]")).toBeVisible({ timeout: 30_000 });
    expect(await A.page.evaluate(() => [sessionStorage.getItem("eb.reconnect"), sessionStorage.getItem("eb.reconnect.meta")])).toEqual([null, null]);
  } finally { await A.ctx.close(); await B.ctx.close(); }
});

test("an unexpected terminal close (other code) says Connection lost, offers Retry, and Retry joins again by the ordinary path", async () => {
  test.setTimeout(180_000);
  const { A, B, room, a } = await pair(`gr3r${n++}`);
  try {
    clientOf(room, a).leave(4000); // a consented, non-special close code
    await expect(A.page.locator("[data-ui=error]")).toHaveText("Connection lost. Try joining again.", { timeout: 15_000 });
    expect(await errorCode(A.page)).toBe("CONNECTION_LOST");
    await expect(A.page.locator("[data-control]")).toHaveCount(0); // match resources disposed, not a frozen HUD
    await until(async () => room.state.players.size === 1, 10_000, "seat released");
    await sleep(1500); // no silent rejoin
    expect(room.state.players.size).toBe(1);
    await A.page.click("[data-act=retry]");
    await expect(A.page.locator("[data-act=ready]")).toBeVisible({ timeout: 30_000 });
    await A.page.click("[data-act=ready]");
    await until(async () => room.state.players.size === 2 && (await hasProbe(A.page)) && (await snap(A.page)).players.some((p) => p.local && p.ready), 20_000, "match after Retry");
    expect(A.errors).toEqual([]);
  } finally { await A.ctx.close(); await B.ctx.close(); }
});

test("4500 says the arena closed with Back only; Back returns to Welcome", async () => {
  test.setTimeout(180_000);
  const { A, B, room, a } = await pair(`gr3r${n++}`);
  try {
    clientOf(room, a).leave(4500);
    await expect(A.page.locator("[data-ui=error]")).toHaveText("This arena closed. Return to the welcome screen.", { timeout: 15_000 });
    expect(await errorCode(A.page)).toBe("ARENA_CLOSED");
    await expect(A.page.locator("[data-act=retry]")).toHaveCount(0);
    await expect(A.page.locator("[data-control]")).toHaveCount(0);
    await A.page.click("[data-act=back]");
    await expect(A.page.locator("[data-act=play]")).toBeVisible();
    expect(await A.page.evaluate(() => [sessionStorage.getItem("eb.reconnect"), sessionStorage.getItem("eb.reconnect.meta")])).toEqual([null, null]);
  } finally { await A.ctx.close(); await B.ctx.close(); }
});

test("a revoked session closes with 4401: Your session ended, no Retry; the other client keeps playing", async () => {
  test.setTimeout(180_000);
  const { A, B, b } = await pair(`gr3r${n++}`);
  try {
    const rec = svc.sessions.list().filter((s) => s.displayName === "Arel").sort((x, y) => y.createdAt - x.createdAt)[0]; // earlier tests leave older Arel sessions
    expect(rec).toBeDefined();
    svc.sessions.revokeById(rec!.id);
    await expect(A.page.locator("[data-ui=error]")).toHaveText("Your session ended. Return to the welcome screen.", { timeout: 15_000 });
    expect(await errorCode(A.page)).toBe("SESSION_ENDED");
    await expect(A.page.locator("[data-act=retry]")).toHaveCount(0);
    await until(async () => (await snap(B.page)).players.length === 1, 10_000, "B sees A gone");
    expect((await me(B.page)).entityId).toBe(b);
    expect(B.errors).toEqual([]);
  } finally { await A.ctx.close(); await B.ctx.close(); }
});

test("two BFCache-style pagehide/pageshow cycles leave one input listener set and one frame loop; the same fighter resumes", async () => {
  test.setTimeout(240_000);
  const { A, B, room, a } = await pair(`gr3r${n++}`);
  try {
    const counts = () => A.page.evaluate(() => (window as unknown as { __counts: () => Record<string, number> }).__counts());
    const base0 = await counts();
    for (let cycle = 0; cycle < 2; cycle++) {
      await A.page.evaluate(() => { window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })); });
      await until(async () => stateOf(room, a).connected === false, 10_000, `cycle ${cycle}: server saw the suspension`);
      await A.page.evaluate(() => { window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })); });
      await until(async () => (await hasProbe(A.page)) && (await snap(A.page)).players.some((p) => p.local && p.ready), 60_000, `cycle ${cycle}: resumed`);
      await until(async () => stateOf(room, a).connected === true, 20_000, `cycle ${cycle}: reconnected`);
      expect((await me(A.page)).entityId).toBe(a);
      expect(room.state.players.size).toBe(2);
      const c = await counts();
      expect(c, `cycle ${cycle} listener/loop counts`).toEqual(base0);
      expect(await A.page.locator("canvas").count()).toBe(1);
    }
    expect(A.errors).toEqual([]);
  } finally { await A.ctx.close(); await B.ctx.close(); }
});

test("three ordinary leave/rejoin cycles still work and each leaves no stored resume state", async () => {
  test.setTimeout(240_000);
  const { A, B, room } = await pair(`gr3r${n++}`);
  try {
    for (let i = 0; i < 3; i++) {
      await A.page.keyboard.press("Escape");
      await A.page.click("[data-hud=menu] button[data-leave]");
      await expect(A.page.locator("[data-act=play]")).toBeVisible();
      expect(await A.page.evaluate(() => [sessionStorage.getItem("eb.reconnect"), sessionStorage.getItem("eb.reconnect.meta")])).toEqual([null, null]);
      await until(async () => room.state.players.size === 1, 10_000, `cycle ${i}: seat released`);
      await A.page.click("[data-act=play]");
      await expect(A.page.locator("[data-act=ready]")).toBeVisible({ timeout: 40_000 });
      await A.page.click("[data-act=ready]");
      await until(async () => room.state.players.size === 2 && (await hasProbe(A.page)) && (await snap(A.page)).players.some((p) => p.local && p.ready), 20_000, `cycle ${i}: back in`);
    }
    expect(A.errors).toEqual([]);
  } finally { await A.ctx.close(); await B.ctx.close(); }
});
