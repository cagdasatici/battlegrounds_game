// QI01: integrated east-bridge fight. Real Chromium contexts, real auth, real server, real held key input for every skill.
// Fixture (synthetic, labelled): fighter placement, camera yaw, HP/meter/cooldown resets, and for the medium tier a spoofed
// WebGL renderer string (the ordinary client pins SwiftShader to low). Damage, hits and phases come from the server.
// Captures: dev client on SwiftShader desktop Chromium 1024x768. Diagnostic evidence for review, not a device.
import { test, expect, chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer as netServer } from "node:net";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { matchMaker, type Server } from "colyseus";
import { meterRequired100 } from "../../packages/shared/src/awakening.js";
import { createGameServer } from "../../apps/server/src/createServer.js";
import { createAuthServices, type AuthServices } from "../../apps/server/src/auth/Services.js";
import { roomDirectory } from "../../apps/server/src/rooms/RoomDirectory.js";
import type { SparringRoom } from "../../apps/server/src/rooms/SparringRoom.js";
import { ARENA } from "../../packages/shared/src/config/arena.js";
import { defaultSettings } from "../../apps/client/src/app/SettingsStore.js";
import { resolveChromium } from "./harness/chromium-path.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = path.join(root, "docs/test-results/QI01");
const req = createRequire(path.join(root, "apps/client/package.json"));
interface Dev { close(): Promise<void>; listen(): Promise<unknown> }
interface Snap {
  localEntityId: number | null; hitMoveIds: string[]; eventCounts: Record<string, number>; serverTick: number;
  render: { calls: number; triangles: number; tier: string } | null; fx: { active: number; capacity: number };
  players: { entityId: number; name: string; action: string; moveId: string; form?: string; ready: boolean; hp100: number }[];
}
let game: Server, svc: AuthServices, vite: Dev, browser: Browser, base: string;
const freePort = (): Promise<number> => new Promise((resolve, reject) => {
  const s = netServer(); s.on("error", reject);
  s.listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); });
});
test.beforeAll(async () => {
  const gamePort = await freePort(), vitePort = await freePort();
  base = `http://localhost:${vitePort}`;
  svc = createAuthServices({ dataDir: mkdtempSync(path.join(tmpdir(), "eb-qi01-")), allowedOrigins: [base], secureCookies: false,
    roomCodes: { play: "arena", practice: "practice" }, buildId: "QI01", sessionsPerMinute: 10_000, globalSessionsPerMinute: 10_000 });
  game = createGameServer(svc); await game.listen(gamePort, undefined, undefined);
  const target = `http://127.0.0.1:${gamePort}`;
  const v = req("vite") as { createServer(c: unknown): Promise<Dev> };
  vite = await v.createServer({ root: path.join(root, "apps/client"), configFile: false, logLevel: "error",
    server: { port: vitePort, strictPort: true, host: "127.0.0.1", fs: { strict: false }, proxy: {
      "/api": { target }, "/matchmake": { target }, "^/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+(\\?.*)?$": { target, ws: true },
    } } });
  await vite.listen();
  browser = await chromium.launch({ executablePath: resolveChromium(), args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
});
test.afterAll(async () => { await browser?.close(); await vite?.close(); await game?.gracefullyShutdown(false); });

const snap = (p: Page): Promise<Snap> => p.evaluate(() => (window as unknown as { __eb: { snapshot(): Snap } }).__eb.snapshot());
const button = (p: Page, name: string) => p.getByRole("button", { name, exact: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const roomOf = (code: string): SparringRoom => matchMaker.getLocalRoomById(roomDirectory.get(code)!) as unknown as SparringRoom;
async function until(f: () => Promise<boolean>, ms: number, what: string): Promise<void> {
  const t0 = Date.now();
  while (!(await f())) { if (Date.now() - t0 > ms) throw new Error(`timeout: ${what}`); await sleep(40); }
}
interface Cfg { tier: "low" | "medium"; reduced: boolean; video: boolean }
interface Client { ctx: BrowserContext; page: Page; errors: string[]; name: string; kit: "sv" | "td" | "ea"; id: number }
async function open(cfg: Cfg, name: string, kit: "sv" | "td" | "ea"): Promise<Client> {
  const settings = { ...defaultSettings(), quality: cfg.tier, reducedMotion: cfg.reduced };
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true,
    ...(cfg.video ? { recordVideo: { dir: path.join(outDir, "video-tmp"), size: { width: 640, height: 480 } } } : {}) });
  await ctx.addInitScript(({ s, spoof }) => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("fixture denied"); } } });
    try { for (const n of ["Arel", "Nora", "Tara", "default"]) localStorage.setItem(`eb.settings.v1.${n}`, JSON.stringify(s)); } catch { /* storage unavailable */ }
    if (spoof) { // medium tier: report a hardware renderer string so the client does not pin the CPU rasteriser to low
      for (const C of [WebGLRenderingContext, WebGL2RenderingContext]) {
        const orig = C.prototype.getParameter;
        C.prototype.getParameter = function (this: WebGLRenderingContext, p: number) { return p === 0x9246 ? "ANGLE (Apple, Apple M-series GPU, Metal) [QI01 fixture]" : orig.call(this, p); } as never;
      }
    }
  }, { s: settings, spoof: cfg.tier !== "low" });
  const page = await ctx.newPage(), errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("404")) errors.push(m.text()); });
  return { ctx, page, errors, name, kit, id: -1 };
}
function place(room: SparringRoom, id: number, x: number, z: number, yaw: number): void {
  const b = room.movement!.get(id)!;
  const pos = { x, y: ARENA.capsule.centreAboveSurface + 0.02, z };
  b.rb.setTranslation(pos, true); b.rb.setNextKinematicTranslation(pos);
  b.state.vx = b.state.vy = b.state.vz = 0; b.state.facingYaw = yaw;
}
// yaw 0 faces -Z; forward = (-sin yaw, -cos yaw). East bridge runs along +X at z = 0 (centre x = 27, width 4 m).
const FACE_EAST = -Math.PI / 2, FACE_WEST = Math.PI / 2;
const setYaw = (p: Page, y: number) => p.evaluate((yaw) => (window as unknown as { __eb: { setCameraYaw(y: number): void } }).__eb.setCameraYaw(yaw), y);
const KEYS = { sv: "Digit1", td: "Digit2", ea: "Digit3" } as const; // sv.b1, td.b2, ea.a3 (awakened slot 3)
const MOVE = { sv: "sv.b1", td: "td.b2", ea: "ea.a3" } as const;

interface Shot { file: string; who: string; view: "attacker" | "defender" | "observer"; phase: string; tMs: number; tick: number; action: string; fx: number; calls: number | null; triangles: number | null }
const shots: Shot[] = [];
const exchanges: { name: string; move: string; hit: boolean; fxPeak: number; drained: boolean; tMs: number }[] = [];

test.describe.configure({ mode: "serial" });
for (const cfg of [
  { tier: "low", reduced: false, video: false }, { tier: "medium", reduced: false, video: false },
  { tier: "low", reduced: true, video: false }, { tier: "medium", reduced: true, video: false },
] as Cfg[]) {
  const tag = `${cfg.reduced ? "reduced" : "normal"}-${cfg.tier}`;
  test(`QI01 ${tag}: Fault Strike, Undertow Spiral, Furnace Ray in successive exchanges, then a three-way overlap`, async () => {
    test.setTimeout(900_000);
    mkdirSync(outDir, { recursive: true });
    const host = await open(cfg, "Arel", "sv");
    const guests: Client[] = [];
    try {
      const invite = svc.invites.create({ ttlMs: 120_000, maxUses: 1 }).token;
      await host.page.goto(`${base}/?debug=1&name=Arel#invite=${invite}`);
      await button(host.page, "Host sparring").click();
      await button(host.page, "Remove Bot 1").click();
      await host.page.getByLabel("Your fighter").selectOption("sv");
      const created = host.page.waitForResponse((r) => new URL(r.url()).pathname === "/api/sparring" && r.request().method() === "POST");
      await button(host.page, "Start match").click();
      const code = (await (await created).json() as { roomCode: string }).roomCode;
      await until(async () => host.page.evaluate(() => !!(window as unknown as { __eb?: unknown }).__eb), 30_000, "host probe");
      for (const [name, kit] of [["Tara", "td"], ["Nora", "ea"]] as const) {
        // The guest link is single use: host mints one per guest.
        await button(host.page, "Sparring controls").click();
        await button(host.page, "Copy guest link").click();
        await expect(host.page.getByLabel("Guest link", { exact: true })).toBeVisible();
        const url = await host.page.getByLabel("Guest link", { exact: true }).inputValue();
        await button(host.page, "Back to game").click();
        const g = await open(cfg, name, kit); guests.push(g);
        const u = new URL(url); u.searchParams.set("debug", "1");
        await g.page.goto(u.href);
        await g.page.getByLabel("Guest display name").fill(name);
        await g.page.click("[data-act=play]");
        await g.page.click(`[data-act=kit][data-kit=${kit}]`); await g.page.click("[data-act=ready]");
        await until(async () => g.page.evaluate(() => !!(window as unknown as { __eb?: unknown }).__eb), 30_000, `${name} probe`);
      }
      const [tara, nora] = guests as [Client, Client];
      const all: Client[] = [host, tara, nora];
      await until(async () => (await snap(host.page)).players.filter((p) => p.ready).length === 3, 30_000, "three fighters ready");
      const room = roomOf(code);
      await until(async () => [...room.combat.all()].every((f) => room.sim.tick > f.protectedUntilTick + 2), 8000, "spawn protection over");
      const s0 = await snap(host.page);
      for (const c of all) c.id = s0.players.find((p) => p.name === c.name)!.entityId;
      const [sv, td, ea] = all as [Client, Client, Client];

      // Awaken the Ember Artificer once (a3 is an awakened slot); the form lasts through the run.
      const fe = room.combat.get(ea.id)!; fe.meter100 = meterRequired100("ea");
      await until(async () => (await snap(ea.page)).players.find((p) => p.entityId === ea.id)?.form === "Awakened" || (await ea.page.keyboard.press("KeyG"), false), 10_000, "ea awakened");

      const reset = (): void => { for (const c of all) { const f = room.combat.get(c.id)!; f.hp100 = 10000; f.cooldowns.clear(); } };
      const park = (c: Client, i: number): void => place(room, c.id, i % 2 ? 11 : -11, 11, 0); // off the bridge, on the main island
      const t0 = Date.now();

      /** Casts `caster`'s skill by real held key at `target`; captures attacker and defender at windup, impact and settle. */
      async function exchange(name: string, caster: Client, target: Client, dist: number, x0: number, observers: Client[]): Promise<void> {
        reset();
        place(room, caster.id, x0, 0, FACE_EAST); place(room, target.id, x0 + dist, 0, FACE_WEST);
        for (const o of all) if (o !== caster && o !== target) park(o, all.indexOf(o));
        await Promise.all([setYaw(caster.page, FACE_EAST), setYaw(target.page, FACE_WEST)]);
        await sleep(1300); // camera easing and boom settle
        const move = MOVE[caster.kit], before = new Set((await snap(caster.page)).hitMoveIds);
        const start = Date.now(); let fxPeak = 0; const seen = new Set<string>(); let impactAt = 0;
        await caster.page.keyboard.down(caster.kit === "sv" ? "Digit1" : caster.kit === "td" ? "Digit2" : "Digit3");
        const capture = async (phase: string): Promise<void> => {
          seen.add(phase);
          const views: [Client, Shot["view"]][] = [[caster, "attacker"], [target, "defender"], ...observers.map((o) => [o, "observer"] as [Client, Shot["view"]])];
          await Promise.all(views.map(async ([c, view]) => {
            const s = await snap(c.page), file = `${tag}-${name}-${view}-${phase}.jpg`;
            await c.page.screenshot({ path: path.join(outDir, file), type: "jpeg", quality: 82 });
            shots.push({ file: `${tag}/${file}`, who: c.name, view, phase, tMs: Date.now() - start, tick: s.serverTick, action: s.players.find((p) => p.entityId === caster.id)?.action ?? "",
              fx: s.fx.active, calls: s.render?.calls ?? null, triangles: s.render?.triangles ?? null });
          }));
        };
        while (Date.now() - start < 30_000) {
          const s = await snap(caster.page);
          fxPeak = Math.max(fxPeak, s.fx.active);
          const act = s.players.find((p) => p.entityId === caster.id)?.action ?? "";
          const hit = s.hitMoveIds.includes(move) && !before.has(move);
          if (act === "Windup" && !seen.has("windup")) await capture("windup");
          else if (hit && !impactAt) { impactAt = Date.now(); await capture("impact"); }
          else if (impactAt && Date.now() - impactAt > 450 && !seen.has("settle")) { await capture("settle"); break; }
          else if (caster.kit === "ea" && act === "Active" && !seen.has("beam")) { await sleep(500); await capture("beam"); }
          await sleep(25);
        }
        await caster.page.keyboard.up(caster.kit === "sv" ? "Digit1" : caster.kit === "td" ? "Digit2" : "Digit3");
        const hitSeen = (await snap(caster.page)).hitMoveIds.includes(move);
        await until(async () => (await snap(target.page)).fx.active === 0 && (await snap(caster.page)).fx.active === 0, 12_000, `${name} fx drained`).catch(() => undefined);
        const drained = (await snap(target.page)).fx.active === 0;
        exchanges.push({ name: `${tag}/${name}`, move, hit: hitSeen, fxPeak, drained, tMs: Date.now() - t0 });
        expect(hitSeen, `${tag} ${name}: server-confirmed hit for ${move}`).toBe(true);
        await sleep(900);
      }

      await exchange("1-vanguard-fault-strike", sv, td, 1.8, 24.6, [nora]);
      await exchange("2-tide-undertow-spiral", td, sv, 1.7, 24.6, [nora]);
      await exchange("3-ember-furnace-ray", ea, td, 6, 22.5, [sv]);

      // Overlap: all three on the bridge at once, everyone casting their signature in the same moment.
      reset();
      place(room, sv.id, 25.4, -0.5, FACE_EAST); place(room, td.id, 27.1, 0.4, FACE_WEST); place(room, ea.id, 29.2, 0, FACE_WEST);
      await Promise.all([setYaw(sv.page, FACE_EAST), setYaw(td.page, FACE_WEST), setYaw(ea.page, FACE_WEST)]);
      await sleep(1300);
      const keyOf = (c: Client) => (c.kit === "sv" ? "Digit1" : c.kit === "td" ? "Digit2" : "Digit3");
      const o0 = Date.now(); let fxPeak = 0;
      await Promise.all(all.map((c) => c.page.keyboard.down(keyOf(c))));
      for (const [phase, wait] of [["overlap-early", 450], ["overlap-mid", 800], ["overlap-late", 900]] as const) {
        await sleep(wait);
        await Promise.all(all.map(async (c) => {
          const s = await snap(c.page); fxPeak = Math.max(fxPeak, s.fx.active);
          const file = `${tag}-4-three-way-${c.kit}-${phase}.jpg`;
          await c.page.screenshot({ path: path.join(outDir, file), type: "jpeg", quality: 82 });
          shots.push({ file: `${tag}/${file}`, who: c.name, view: "observer", phase, tMs: Date.now() - o0, tick: s.serverTick, action: s.players.find((p) => p.entityId === c.id)?.action ?? "",
            fx: s.fx.active, calls: s.render?.calls ?? null, triangles: s.render?.triangles ?? null });
        }));
      }
      await Promise.all(all.map((c) => c.page.keyboard.up(keyOf(c))));
      const hits = await Promise.all(all.map(async (c) => (await snap(c.page)).hitMoveIds));
      exchanges.push({ name: `${tag}/4-three-way`, move: "sv.b1+td.b2+ea.a3", hit: hits.some((h) => h.length > 0), fxPeak, drained: true, tMs: Date.now() - t0 });

      const peak = await Promise.all(all.map(async (c) => (await snap(c.page)).render?.tier));
      expect(peak.every((t) => t === cfg.tier || t === "low"), `tier ${peak.join(",")}`).toBe(true);
      expect(tara.errors.concat(host.errors, nora.errors)).toEqual([]);
      for (const c of all) await c.page.close(); // flush video
    } finally { for (const c of [host, ...guests]) await c.ctx.close().catch(() => undefined); }
  });
}
test.afterAll(() => {
  writeFileSync(path.join(outDir, "bridge-metrics.json"), JSON.stringify({
    note: "Dev client on SwiftShader, desktop Chromium 1024x768. Placement, camera yaw, HP, cooldown and medium-tier renderer string are synthetic fixtures; every skill is a held real key and hits come from the server. Not a device.",
    exchanges, shots,
  }, null, 2) + "\n");
});
