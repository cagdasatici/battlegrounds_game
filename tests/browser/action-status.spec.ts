// GR07 honest action status: real Chromium + Colyseus clients, real key presses. Awakened form and ragdoll are set on the server fighter by a fixture; replication, HUD text and server rejection are real.
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
import { mkdtempSync } from "node:fs";
import { resolveChromium } from "./harness/chromium-path.js";
import { closeContext } from "./harness/leave.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const req = createRequire(path.join(root, "apps/client/package.json"));
const CHROMIUM = resolveChromium();
const GL_ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];

interface Dev { close(): Promise<void>; listen(): Promise<unknown> }

interface Snap { localEntityId: number | null; players: { entityId: number; ready: boolean; local: boolean; action: string; moveId: string; chargeStartTick: number; awakenedUsedMask: number; evasiveEndTick: number }[] }

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
const ctrl = (p: Page, id: string) => p.locator(`[data-control=${id}]`);
const text = async (p: Page, id: string): Promise<string> => ((await ctrl(p, id).textContent()) ?? "").replace(/\s+/g, " ").trim();
async function watchPulse(p: Page): Promise<void> {
  await p.evaluate(() => {
    (window as unknown as { __pulses: number }).__pulses = 0;
    new MutationObserver((ms) => { for (const m of ms) if ((m.target as HTMLElement).classList.contains("eb-ready-pulse")) (window as unknown as { __pulses: number }).__pulses++; })
      .observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class"] });
  });
}
const pulses = (p: Page): Promise<number> => p.evaluate(() => (window as unknown as { __pulses: number }).__pulses);

async function open(name: string, kit: string): Promise<{ ctx: BrowserContext; page: Page; errors: string[] }> {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: false });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const { token } = svc.invites.create({ ttlMs: 120_000, maxUses: 1 });
  await page.goto(`${base}/?room=match&name=${name}&kit=sv&debug=1#invite=${token}`);
  await page.waitForSelector("[data-act=play]");
  await page.click("[data-act=play]");
  await page.click(`[data-act=kit][data-kit=${kit}]`);
  await page.click("[data-act=ready]");
  await page.waitForFunction(() => (window as unknown as { __eb?: unknown }).__eb !== undefined, undefined, { timeout: 30_000 });
  return { ctx, page, errors };
}
async function pair(kit: string) {
  const A = await open("Aria", kit);
  const B = await open("Bo", "sv");
  await until(async () => (await snap(B.page)).players.filter((p) => p.ready).length === 2, 15000, "both ready");
  const listings = await matchMaker.query({ name: "arena" });
  const arena = matchMaker.getLocalRoomById(listings[0]!.roomId) as unknown as ArenaRoom;
  const aId = await until(async () => (await snap(A.page)).localEntityId, 10000, "A id");
  const fa = arena.combat.get(aId)!;
  const mine = async () => (await snap(A.page)).players.find((p) => p.local)!;
  expect(fa.kitId).toBe(kit);
  await until(async () => (await mine()).action === "Idle", 15000, "A idle (spawn protection may run)");
  return { A, B, arena, fa, mine };
}

test("td.a2 miss: Used persists, the server rejects the retry, form reset clears it, no ready pulse on the switch", async () => {
  test.setTimeout(150_000);
  const { A, B, arena, fa, mine } = await pair("td");
  try {
    await watchPulse(A.page);
    fa.form = "Awakened"; fa.formEndTick = arena.sim.tick + 6000; fa.awakenedUsedMask = 0;
    await until(async () => (await text(A.page, "skill2")).includes("Ready") , 8000, "awakened slot 2 ready");
    expect(await pulses(A.page)).toBe(0); // Base to Awakened slot change never pulses
    await A.page.keyboard.down("Digit2"); await sleep(120); await A.page.keyboard.up("Digit2");
    await until(async () => ((await mine()).awakenedUsedMask & 2) !== 0 || null, 8000, "td.a2 committed");
    await until(async () => (await mine()).action === "Idle", 15000, "recovered after the miss");
    await until(async () => (await text(A.page, "skill2")).includes("Used"), 8000, "HUD says Used");
    // Retry: the server rejects (FORM) and the HUD stays Used with the rejection notice.
    const tick0 = arena.sim.tick;
    await A.page.keyboard.down("Digit2"); await sleep(120); await A.page.keyboard.up("Digit2");
    await until(async () => (await A.page.locator("[data-hud=rejection]").innerText().catch(() => "")).includes("Already used this awakening") || null, 5000, "rejection toast");
    expect((await mine()).action).toBe("Idle");
    expect(fa.cast).toBeNull();
    expect(arena.sim.tick).toBeGreaterThan(tick0);
    expect(await text(A.page, "skill2")).toContain("Used");
    // Server form reset clears the mask: Used goes away, and nothing pulsed (Used transition and form switch).
    fa.form = "Base"; fa.formEndTick = 0; fa.awakenedUsedMask = 0;
    await until(async () => !(await text(A.page, "skill2")).includes("Used"), 8000, "Used cleared by form reset");
    await sleep(600);
    expect(await pulses(A.page)).toBe(0);
    for (const x of [A, B]) expect(x.errors).toEqual([]);
  } finally { await closeContext(A.ctx); await closeContext(B.ctx); }
});

test("ea.b3 charge: percentage and release hint come from the authoritative start tick, cancellation clears it", async () => {
  test.setTimeout(150_000);
  const { A, B, arena, mine } = await pair("ea");
  try {
    const box = (await ctrl(A.page, "skill3").boundingBox())!;
    await A.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await A.page.mouse.down();
    await until(async () => (await mine()).chargeStartTick > 0 || null, 8000, "server charge start");
    const first = await until(async () => { const t = await text(A.page, "skill3"); return /Charge \d+%/.test(t) ? t : false; }, 5000, "Charge NN% shown");
    expect(first).toContain("Release to fire");
    // The displayed percentage derives from the authoritative start tick: compare with the server clock (client estimate loose 25 % tolerance for client clock estimate and sampling lag).
    const m = await mine();
    const shownPct = Number(/Charge (\d+)%/.exec(await text(A.page, "skill3"))?.[1] ?? NaN);
    const serverPct = Math.floor(Math.min(1, Math.max(0, (arena.sim.tick - m.chargeStartTick) / 180)) * 100);
    if (m.chargeStartTick > 0 && Number.isFinite(shownPct)) expect(Math.abs(shownPct - serverPct)).toBeLessThanOrEqual(25);
    await A.page.mouse.up();
    await until(async () => (await mine()).chargeStartTick === 0 || null, 8000, "charge ended on release");
    await until(async () => !/Charge \d+%/.test(await text(A.page, "skill3")), 8000, "Charge text cleared");
    for (const x of [A, B]) expect(x.errors).toEqual([]);
  } finally { await closeContext(A.ctx); await closeContext(B.ctx); }
});

test("Ragdolled Dash reads Escape: Wait, then Ready, then the server evasive cooldown", async () => {
  test.setTimeout(150_000);
  const { A, B, arena, fa, mine } = await pair("td");
  try {
    expect(await text(A.page, "dash")).toBe("Dash");
    // Ragdoll that has not reached the minimum age (start tick in the future): Wait.
    const t = arena.sim.tick;
    fa.action = "Ragdolled" as never; fa.ragdollStartTick = t + 3000; fa.actionStartTick = t + 3000; fa.actionEndTick = t + 6000;
    await until(async () => (await text(A.page, "dash")).includes("Escape") || null, 8000, "Escape label");
    expect(await text(A.page, "dash")).toContain("Wait");
    // Old enough: Ready, and the real key is accepted by the server (evasive cooldown starts, matching the HUD).
    fa.ragdollStartTick = arena.sim.tick - 20; fa.actionStartTick = arena.sim.tick - 20; fa.actionEndTick = arena.sim.tick + 6000;
    await until(async () => (await text(A.page, "dash")).includes("Ready") || null, 8000, "Escape Ready");
    await A.page.keyboard.down("KeyQ"); await sleep(120); await A.page.keyboard.up("KeyQ");
    await until(async () => (await mine()).evasiveEndTick > arena.sim.tick || null, 8000, "server evasive cooldown");
    fa.action = "Ragdolled" as never; fa.ragdollStartTick = arena.sim.tick - 40; fa.actionStartTick = arena.sim.tick - 40; fa.actionEndTick = arena.sim.tick + 6000;
    await until(async () => /Escape\s*\d+/.test(await text(A.page, "dash")) || null, 8000, "Escape cooldown seconds");
    for (const x of [A, B]) expect(x.errors).toEqual([]);
  } finally { await closeContext(A.ctx); await closeContext(B.ctx); }
});

test("four skill rows stay readable at target sizes", async () => {
  test.setTimeout(120_000);
  const { A, B } = await pair("ea");
  try {
    for (const vp of [{ width: 1024, height: 768 }, { width: 1180, height: 820 }]) {
      await A.page.setViewportSize(vp);
      await sleep(400);
      for (const id of ["skill1", "skill2", "skill3", "skill4"]) {
        const m = await ctrl(A.page, id).evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight, sw: el.scrollWidth, cw: el.clientWidth }));
        expect(m.sh, `${id} ${vp.width} vertical clip`).toBeLessThanOrEqual(m.ch + 1);
        expect(m.sw, `${id} ${vp.width} horizontal clip`).toBeLessThanOrEqual(m.cw + 1);
      }
    }
  } finally { await closeContext(A.ctx); await closeContext(B.ctx); }
});
