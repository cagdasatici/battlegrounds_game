// QW01: release-build acceptance. The built client (apps/client/dist) is served by the real same-origin static routes
// of createGameServer (HTTP + Colyseus on one loopback port, no dev server, no proxy). Two isolated browser contexts
// with ordinary sessions. Invite tokens are local test-only values minted in-process and never written to a report.
// Desktop Chromium via SwiftShader: this is NOT an iPad, Safari, TLS or a remote network. Run `pnpm build` first. One worker.
import { test, expect, chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer as netServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { matchMaker, type Server } from "colyseus";
import { createGameServer } from "../../apps/server/src/createServer.js";
import { createAuthServices, type AuthServices } from "../../apps/server/src/auth/Services.js";
import { roomDirectory } from "../../apps/server/src/rooms/RoomDirectory.js";
import type { SparringRoom } from "../../apps/server/src/rooms/SparringRoom.js";
import { ARENA } from "../../packages/shared/src/config/arena.js";
import type { Difficulty } from "../../packages/shared/src/sparring.js";
import { resolveChromium } from "./harness/chromium-path.js";

const root = new URL("../../", import.meta.url).pathname;
const dist = join(root, "apps/client/dist");
const GL_ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];
interface Snap {
  localEntityId: number | null; serverTick: number;
  players: { entityId: number; name: string; action: string; moveId: string; hp100: number; ready: boolean; kills: number; deaths: number; connected?: boolean }[];
}
let game: Server, svc: AuthServices, browser: Browser, origin = "", served = "";
let skewMs = 0; // test clock offset for wall-time expiry (auth, sparring link and seat deadlines)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const freePort = (): Promise<number> => new Promise((resolve, reject) => {
  const s = netServer(); s.on("error", reject);
  s.listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); });
});

test.beforeAll(async () => {
  expect(existsSync(join(dist, "sw.js")), "run pnpm build first").toBe(true);
  served = mkdtempSync(join(tmpdir(), "eb-qw01-static-"));
  cpSync(dist, served, { recursive: true });
  const port = await freePort();
  origin = `http://127.0.0.1:${port}`;
  svc = createAuthServices({ dataDir: mkdtempSync(join(tmpdir(), "eb-qw01-")), allowedOrigins: [origin], secureCookies: false,
    roomCodes: { play: "arena", practice: "practice" }, buildId: "qw01-local", sessionsPerMinute: 10_000, globalSessionsPerMinute: 10_000 }, () => Date.now() + skewMs);
  game = createGameServer(svc, { staticDir: served });
  await game.listen(port, "127.0.0.1");
  browser = await chromium.launch({ executablePath: resolveChromium(), args: GL_ARGS });
});
test.afterAll(async () => { await browser?.close(); await game?.gracefullyShutdown(false); });

const snap = (p: Page): Promise<Snap> => p.evaluate(() => (window as unknown as { __eb: { snapshot(): Snap } }).__eb.snapshot());
const button = (p: Page, name: string) => p.getByRole("button", { name, exact: true });
const roomOf = (code: string): SparringRoom => matchMaker.getLocalRoomById(roomDirectory.get(code)!) as unknown as SparringRoom;
async function open(): Promise<{ ctx: BrowserContext; page: Page; errors: string[] }> {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  // Clipboard denial exercises the selectable fallback; secrets stay in memory.
  await ctx.addInitScript(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("fixture denied"); } } }));
  const page = await ctx.newPage(), errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  // The release CSP has no unsafe-inline: any blocked style or script is a defect (found by QW01 in How to play and Sparring setup).
  page.on("console", (m) => { if (/Content Security Policy/i.test(m.text())) errors.push(m.text().slice(0, 160)); });
  return { ctx, page, errors };
}
async function invited(name: string) {
  const h = await open();
  const token = svc.invites.create({ ttlMs: 120_000, maxUses: 1 }).token;
  await h.page.goto(`${origin}/?debug=1&name=${name}#invite=${token}`);
  await h.page.waitForSelector("[data-act=play]");
  return h;
}
const hasProbe = (p: Page) => p.evaluate(() => !!(window as unknown as { __eb?: unknown }).__eb);

test("cold install, offline Welcome, and the admin/api cache exclusions on the release build", async () => {
  const { ctx, page, errors } = await open();
  try {
    await page.goto(origin + "/");
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await page.reload();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    // Wait for the precache so the offline reload is meaningful.
    await expect.poll(async () => page.evaluate(async () => { let n = 0; for (const k of await caches.keys()) n += (await (await caches.open(k)).keys()).length; return n; }), { timeout: 30_000 }).toBeGreaterThan(25);
    const urls = await page.evaluate(async () => {
      const u: string[] = [];
      for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) u.push(new URL(r.url).pathname);
      return u;
    });
    expect(urls.some((u) => u.startsWith("/api/") || u === "/healthz" || u.startsWith("/matchmake") || u.startsWith("/admin"))).toBe(false);
    // Player/admin separation: the admin entry never ships in the player cache and the admin API refuses a player-less caller.
    const adminApi = await page.evaluate(async () => (await fetch("/api/admin/status")).status);
    expect([401, 403, 404]).toContain(adminApi);
    expect((await page.request.get(origin + "/admin.html")).headers()["cache-control"]).toBe("no-store");

    await ctx.setOffline(true);
    await page.reload();
    // Decision 0045: offline, the cached shell loads and shows the plain "cannot reach the game" state with Retry and Back.
    await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
    await expect(page.locator("body")).toContainText("cannot reach the game");
    expect(await page.title()).toBe("Elemental Battlegrounds");
    await ctx.setOffline(false);
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    // A visitor with no invitation is told so in plain words once the network is back (never a blank page).
    await expect(page.locator("body")).toContainText("invitation");
    expect(errors).toEqual([]);
  } finally { await ctx.close(); }
});

test("signed-in room list shows arena and a listed hosted match; one tap joins; a full roster reads Full", async () => {
  test.setTimeout(120_000);
  const a = await invited("Arel"), b = await invited("Nora");
  try {
    await button(a.page, "Find a room").click();
    const row = a.page.locator("[data-join=play]");
    await expect(row).toBeVisible();
    await row.click();
    await expect(a.page.locator("[data-act=ready]")).toBeVisible({ timeout: 30_000 });
    await a.page.click("[data-act=ready]");
    // The second client finds the same room with the first player counted, and joins with one tap.
    await button(b.page, "Find a room").click();
    await expect(b.page.getByText("Play: 1 of 4 players")).toBeVisible();
    await b.page.locator("[data-join=play]").click();
    await expect(b.page.locator("[data-act=ready]")).toBeVisible({ timeout: 30_000 });
    await b.page.click("[data-act=ready]");
    await expect.poll(async () => hasProbe(a.page)).toBe(true);
    await expect.poll(async () => (await snap(a.page)).players.length).toBe(2);
    expect(a.errors).toEqual([]); expect(b.errors).toEqual([]);
  } finally { await a.ctx.close(); await b.ctx.close(); }
  // Listed sparring match with the full four-fighter roster is shown as Full and cannot be joined.
  const h = await invited("Host"), g = await invited("Late");
  try {
    await button(h.page, "Host sparring").click();
    await button(h.page, "Add opponent").click(); await button(h.page, "Add opponent").click();
    const created = h.page.waitForResponse((r) => new URL(r.url()).pathname === "/api/sparring" && r.request().method() === "POST");
    await h.page.getByLabel("List this match for other players").check();
    await button(h.page, "Start match").click();
    const code = (await (await created).json() as { roomCode: string }).roomCode;
    await expect.poll(async () => hasProbe(h.page), { timeout: 30_000 }).toBe(true);
    await button(g.page, "Find a room").click();
    const full = g.page.locator(`[data-join="${code}"]`);
    await expect(full).toBeVisible({ timeout: 15_000 });
    await expect(full).toBeDisabled();
    await expect(full).toHaveText("Full");
    await button(h.page, "Sparring controls").click(); await button(h.page, "End match").click();
    expect(h.errors).toEqual([]);
  } finally { await h.ctx.close(); await g.ctx.close(); }
});

async function host(bots: Difficulty[]) {
  const h = await invited("Arel");
  await button(h.page, "Host sparring").click();
  if (bots.length === 0) await button(h.page, "Remove Bot 1").click();
  await h.page.getByLabel("Your fighter").selectOption("td");
  const created = h.page.waitForResponse((r) => new URL(r.url()).pathname === "/api/sparring" && r.request().method() === "POST");
  await button(h.page, "Start match").click();
  const code = (await (await created).json() as { roomCode: string }).roomCode;
  await expect.poll(async () => hasProbe(h.page), { timeout: 30_000 }).toBe(true);
  await expect.poll(async () => (await snap(h.page)).players.filter((p) => p.ready).length).toBe(bots.length + 1);
  return { ...h, code };
}
async function guestLink(p: Page): Promise<string> {
  await button(p, "Sparring controls").click();
  await button(p, "Copy guest link").click();
  const input = p.getByLabel("Guest link", { exact: true });
  await expect(input).toBeVisible();
  await expect(input).toHaveValue(/^http/);
  const url = await input.inputValue();
  expect(new URL(url).origin).toBe(origin);
  await button(p, "Back to game").click(); // hide the bearer before anything else is captured
  return url;
}
async function joinGuest(url: string, name: string) {
  const g = await open();
  const u = new URL(url); u.searchParams.set("debug", "1");
  await g.page.goto(u.href);
  await expect(g.page.getByLabel("Guest display name")).toBeVisible();
  expect(new URL(g.page.url()).hash).toBe("");
  await g.page.getByLabel("Guest display name").fill(name);
  await g.page.click("[data-act=play]");
  await expect(g.page.locator("[data-act=ready]")).toBeVisible({ timeout: 30_000 });
  await g.page.click("[data-act=kit][data-kit=sv]"); await g.page.click("[data-act=ready]");
  await expect.poll(async () => hasProbe(g.page), { timeout: 30_000 }).toBe(true);
  return g;
}
function place(room: SparringRoom, id: number, x: number, z: number): void {
  const b = room.movement!.get(id)!;
  const pos = { x, y: ARENA.capsule.centreAboveSurface + 0.02, z };
  b.rb.setTranslation(pos, true); b.rb.setNextKinematicTranslation(pos);
  b.state.vx = b.state.vy = b.state.vz = 0; b.state.facingYaw = 0;
}
const outcome = (s: Snap) => s.players.map((p) => ({ name: p.name, hp: p.hp100, kills: p.kills, deaths: p.deaths }));

test("scoped guest: disconnect during combat keeps the seat and rejoins, KO agrees on both clients, a new match starts at zero", async () => {
  test.setTimeout(180_000);
  const h = await host([]); let g: Awaited<ReturnType<typeof joinGuest>> | undefined;
  try {
    g = await joinGuest(await guestLink(h.page), "Nora");
    expect((await g.ctx.cookies()).some((c) => c.name === "eb_session")).toBe(false); // scoped: no ordinary session
    expect((await g.ctx.cookies()).some((c) => c.name === "eb_spar_guest")).toBe(true);
    const room = roomOf(h.code);
    await expect.poll(() => [...room.combat.all()].every((f) => room.sim.tick > f.protectedUntilTick + 2), { timeout: 8000 }).toBe(true);
    const s0 = await snap(h.page), human = s0.players.find((p) => p.name === "Arel")!, guest = s0.players.find((p) => p.name === "Nora")!;
    place(room, human.entityId, 0, 1.5); place(room, guest.entityId, 0, 0);

    // The SDK only auto-reconnects a room that has been up for 5 s (its minUptime); drop after that, as a real mid-fight loss would be.
    await sleep(5500);
    // Disconnect the guest's socket mid-fight (server-side terminate) while the host is attacking.
    const attack = h.page.locator("[data-control=attack]"), bounds = (await attack.boundingBox())!;
    await h.page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); await h.page.mouse.down();
    try {
      await expect.poll(async () => (await snap(h.page)).players.find((p) => p.name === "Nora")!.hp100, { timeout: 8000 }).toBeLessThan(10000);
      const hpBefore = room.combat.get(guest.entityId)!.hp100;
      const guestClient = room.clients[room.clients.length - 1]!; // the guest joined after the host
      (guestClient as unknown as { ref: { terminate(): void } }).ref.terminate();
      await expect.poll(() => [...room.state.players.values()].filter((p) => p.connected === false).length, { timeout: 8000 }).toBe(1);
      expect([...room.combat.all()].map((f) => f.entityId).sort()).toEqual([human.entityId, guest.entityId].sort()); // no duplicate fighter, seat retained
      expect(room.combat.get(guest.entityId)!.hp100).toBeLessThanOrEqual(hpBefore);
      // The client reconnects with the same seat inside the 20 s window.
      await expect.poll(() => [...room.state.players.values()].every((p) => p.connected !== false), { timeout: 20_000 }).toBe(true);
      expect([...room.combat.all()].length).toBe(2);
    } finally { await h.page.mouse.up(); }

    // KO agreement: host finishes the guest; both clients read the same kills, deaths and HP.
    room.combat.get(guest.entityId)!.hp100 = 100;
    await h.page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); await h.page.mouse.down();
    try { await expect.poll(async () => (await snap(h.page)).players.find((p) => p.name === "Arel")!.kills, { timeout: 8000 }).toBe(1); }
    finally { await h.page.mouse.up(); }
    await expect.poll(async () => (await snap(g!.page)).players.find((p) => p.name === "Nora")!.deaths).toBe(1);
    await expect.poll(async () => outcome(await snap(g!.page))).toEqual(outcome(await snap(h.page)));

    // End the match: the guest returns to Welcome and its scope is dead. A new match gets a new code, a fresh link, zero scores.
    await button(h.page, "Sparring controls").click(); await button(h.page, "End match").click();
    await expect(button(h.page, "Host sparring")).toBeVisible();
    await expect(g.page.locator("[data-act=play]")).toBeVisible({ timeout: 15_000 });
    await g.ctx.close(); g = undefined;
    await button(h.page, "Host sparring").click();
    await button(h.page, "Remove Bot 1").click();
    const created = h.page.waitForResponse((r) => new URL(r.url()).pathname === "/api/sparring" && r.request().method() === "POST");
    await button(h.page, "Start match").click();
    const next = (await (await created).json() as { roomCode: string }).roomCode;
    expect(next).not.toBe(h.code);
    await expect.poll(async () => hasProbe(h.page), { timeout: 30_000 }).toBe(true);
    await expect.poll(async () => (await snap(h.page)).players.length).toBe(1);
    g = await joinGuest(await guestLink(h.page), "Nora");
    await expect.poll(async () => (await snap(g!.page)).players.length).toBe(2);
    expect(outcome(await snap(g.page)).every((p) => p.kills === 0 && p.deaths === 0 && p.hp === 10000)).toBe(true);
    expect(outcome(await snap(g.page))).toEqual(outcome(await snap(h.page)));
    await button(h.page, "Sparring controls").click(); await button(h.page, "End match").click();
    expect(h.errors).toEqual([]); expect(g.errors).toEqual([]);
  } finally { await g?.ctx.close(); await h.ctx.close(); }
});

test("expiry: an expired guest link is refused with no membership; a guest seat that stays disconnected past its window is released", async () => {
  test.setTimeout(120_000);
  const h = await host([]); const late = await open();
  let g: Awaited<ReturnType<typeof joinGuest>> | undefined;
  try {
    const stale = await guestLink(h.page);
    skewMs += 600_001; // past the 10 minute link lifetime
    await late.page.goto(stale);
    await expect(late.page.getByLabel("Guest display name")).toBeVisible();
    const rejected = late.page.waitForResponse((r) => new URL(r.url()).pathname === "/api/sparring/redeem");
    await late.page.click("[data-act=play]");
    expect((await rejected).status()).toBe(401);
    await expect(late.page.locator("[data-ui=error]")).toHaveAttribute("data-code", "INVITE_INVALID");
    expect((await late.ctx.cookies()).some((c) => c.name === "eb_spar_guest")).toBe(false);

    // Fresh link on the advanced clock; the guest joins, then its socket drops and cannot reconnect (page closed).
    // The sparring seat deadline is wall time (20 s); the sweep releases it.
    g = await joinGuest(await guestLink(h.page), "Nora");
    const room = roomOf(h.code);
    await expect.poll(async () => (await snap(h.page)).players.length).toBe(2);
    await sleep(5500); // past the SDK's 5 s reconnect minUptime, so the drop is a real unexpected loss
    await g.ctx.setOffline(true); // the device cannot come back inside the window
    (room.clients[room.clients.length - 1] as unknown as { ref: { terminate(): void } }).ref.terminate();
    await expect.poll(() => [...room.state.players.values()].filter((p) => p.connected === false).length, { timeout: 8000 }).toBe(1);
    skewMs += 21_000;
    await expect.poll(async () => (await snap(h.page)).players.length, { timeout: 40_000 }).toBe(1);
    await button(h.page, "Sparring controls").click(); await button(h.page, "End match").click();
    expect(h.errors).toEqual([]); expect(late.errors).toEqual([]);
  } finally { await g?.ctx.close(); await late.ctx.close(); await h.ctx.close(); }
});

test("update held back inside a room, offered only after leaving, applied only by tap", async () => {
  test.setTimeout(120_000);
  const { ctx, page, errors } = await open();
  try {
    await page.goto(`${origin}/`);
    await page.waitForSelector("[data-act=play]");
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await page.reload();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    // The worker now controls the page; sign in with an ordinary invitation on a fresh navigation (the fragment is consumed on first use).
    const token = svc.invites.create({ ttlMs: 120_000, maxUses: 1 }).token;
    await page.goto(`${origin}/?debug=1&name=Arel#invite=${token}`);
    await page.waitForSelector("[data-act=practice]");
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await sleep(500);
    await expect(page.locator('button[data-act="update"]')).toHaveCount(0);

    // Publish a second build, then join a room: no Update control in the room and no reload under the player.
    const prev = JSON.parse(readFileSync(join(served, "asset-manifest.json"), "utf8")) as { assets: string[] };
    writeFileSync(join(served, "assets/qw01-next.js"), "// next build\n");
    writeFileSync(join(served, "asset-manifest.json"), JSON.stringify({ ...prev, buildId: "qw01-next", assets: [...prev.assets, "/assets/qw01-next.js"] }) + "\n");
    writeFileSync(join(served, "sw.js"), readFileSync(join(served, "sw.js"), "utf8").replace(/const BUILD_ID = "[^"]*"/, 'const BUILD_ID = "qw01-next"'));
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(page.locator('button[data-act="update"]')).toBeVisible({ timeout: 15_000 });
    let navigations = 0;
    page.on("framenavigated", (f) => { if (f === page.mainFrame()) navigations++; });
    await page.click("[data-act=practice]");
    await page.click("[data-act=ready]");
    await expect.poll(async () => hasProbe(page), { timeout: 30_000 }).toBe(true);
    await sleep(1500);
    expect(await page.locator('button[data-act="update"]').count()).toBe(0);
    expect(navigations).toBe(0);
    expect(await hasProbe(page)).toBe(true);

    // Leave: the offer returns, nothing has reloaded yet, and a tap applies it.
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /leave/i }).click();
    await expect(page.locator('button[data-act="update"]')).toBeVisible({ timeout: 15_000 });
    expect(navigations).toBe(0);
    await Promise.all([page.waitForEvent("framenavigated", { timeout: 15_000 }), page.locator('button[data-act="update"]').click()]);
    await page.waitForLoadState("load");
    await expect.poll(() => page.evaluate(() => caches.keys()), { timeout: 10_000 }).toEqual(["eb-shell-qw01-next"]);
    expect(errors).toEqual([]);
  } finally { await ctx.close(); }
});
