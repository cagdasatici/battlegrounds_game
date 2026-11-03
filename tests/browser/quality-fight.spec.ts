// Q01: reproducible four-fighter workload with frame and renderer capture. Real Chromium contexts, real auth, real server.
// Setup (spawn, meter, HP, one projectile reflection) is deterministic server-side fixture (synthetic); combat is real input.
// Smoke runs one cycle. EB_QUALITY_LONG=1 repeats cycles for EB_QUALITY_MINUTES (default 5). Dev client on SwiftShader: diagnostic only.
import { test, expect, chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer as netServer } from "node:net";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import path from "node:path";
import { matchMaker, type Server } from "colyseus";
import { meterRequired100 } from "../../packages/shared/src/awakening.js";
import { createGameServer } from "../../apps/server/src/createServer.js";
import { createAuthServices, type AuthServices } from "../../apps/server/src/auth/Services.js";
import { roomDirectory } from "../../apps/server/src/rooms/RoomDirectory.js";
import type { SparringRoom } from "../../apps/server/src/rooms/SparringRoom.js";
import { ARENA } from "../../packages/shared/src/config/arena.js";
import { emptyEvents, frameStats, missingEvents, runRecord, type FrameSample } from "./harness/quality-metrics.js";
import { resolveChromium } from "./harness/chromium-path.js";
import { evidenceDir } from "./harness/evidence.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = path.join(evidenceDir(root), "Q01");
const req = createRequire(path.join(root, "apps/client/package.json"));
const LONG = process.env["EB_QUALITY_LONG"] === "1";
const MINUTES = Number(process.env["EB_QUALITY_MINUTES"] ?? 5);
interface Dev { close(): Promise<void>; listen(): Promise<unknown> }
interface Snap {
  localEntityId: number | null; serverTick: number; eventCounts: Record<string, number>;
  render: { calls: number; triangles: number; tier: string } | null;
  fx?: { active: number; capacity: number; shed?: number };
  projectiles: { id: string; reflectionCount: number }[];
  players: { entityId: number; name: string; kitId: string; action: string; hp100: number; ready: boolean; form?: string; kills: number; deaths: number }[];
}
let game: Server, svc: AuthServices, vite: Dev, browser: Browser, base: string;
const freePort = (): Promise<number> => new Promise((resolve, reject) => {
  const s = netServer(); s.on("error", reject);
  s.listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); });
});
test.beforeAll(async () => {
  const gamePort = await freePort(), vitePort = await freePort();
  base = `http://localhost:${vitePort}`;
  svc = createAuthServices({ dataDir: mkdtempSync(path.join(tmpdir(), "eb-q01-")), allowedOrigins: [base], secureCookies: false,
    roomCodes: { play: "arena", practice: "practice" }, buildId: "Q01", sessionsPerMinute: 10_000, globalSessionsPerMinute: 10_000 });
  game = createGameServer(svc); await game.listen(gamePort, undefined, undefined);
  const target = `http://127.0.0.1:${gamePort}`;
  const v = req("vite") as { createServer(c: unknown): Promise<Dev> };
  vite = await v.createServer({ root: path.join(root, "apps/client"), configFile: false, logLevel: "error",
    server: { hmr: false, watch: null, port: vitePort, strictPort: true, host: "127.0.0.1", fs: { strict: false }, proxy: {
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
async function open(): Promise<{ ctx: BrowserContext; page: Page; errors: string[] }> {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("fixture denied"); } } });
    const q = { samples: [] as { dtMs: number; hidden: boolean }[] }; (window as unknown as { __q: unknown }).__q = q;
    let last = performance.now();
    const tick = (t: number): void => { q.samples.push({ dtMs: t - last, hidden: document.hidden }); last = t; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  const page = await ctx.newPage(), errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("404")) errors.push(m.text()); });
  return { ctx, page, errors };
}
function place(room: SparringRoom, id: number, x: number, z: number, yaw = 0): void {
  const b = room.movement!.get(id)!;
  const pos = { x, y: ARENA.capsule.centreAboveSurface + 0.02, z };
  b.rb.setTranslation(pos, true); b.rb.setNextKinematicTranslation(pos);
  b.state.vx = b.state.vy = b.state.vz = 0; b.state.facingYaw = yaw;
}
const hold = async (p: Page, control: string, ms: number): Promise<void> => {
  const b = (await p.locator(`[data-control=${control}]`).boundingBox())!;
  await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await p.mouse.down(); await sleep(ms); await p.mouse.up();
};

test(`Q01: four-fighter workload ${LONG ? `long ${MINUTES} min` : "smoke"} records frames, geometry and six events`, async () => {
  test.setTimeout(LONG ? (MINUTES + 5) * 60_000 : 180_000);
  const host = await open();
  let guest: Awaited<ReturnType<typeof open>> | undefined;
  try {
    // Host sparring with two legal server bots (Easy, Medium); host plays Tide Duelist.
    const invite = svc.invites.create({ ttlMs: 120_000, maxUses: 1 }).token;
    await host.page.goto(`${base}/?debug=1&name=Arel#invite=${invite}`);
    await button(host.page, "Host sparring").click();
    await button(host.page, "Add opponent").click();
    await host.page.getByLabel("Bot 1 difficulty").selectOption("easy");
    await host.page.getByLabel("Bot 2 difficulty").selectOption("medium");
    await host.page.getByLabel("Your fighter").selectOption("td");
    const created = host.page.waitForResponse((r) => new URL(r.url()).pathname === "/api/sparring" && r.request().method() === "POST");
    await button(host.page, "Start match").click();
    const code = (await (await created).json() as { roomCode: string }).roomCode;
    await until(async () => host.page.evaluate(() => !!(window as unknown as { __eb?: unknown }).__eb), 30_000, "host probe");
    await button(host.page, "Sparring controls").click();
    await button(host.page, "Copy guest link").click();
    await expect(host.page.getByLabel("Guest link", { exact: true })).toBeVisible();
    const url = await host.page.getByLabel("Guest link", { exact: true }).inputValue();
    await button(host.page, "Back to game").click();
    guest = await open();
    const u = new URL(url); u.searchParams.set("debug", "1");
    await guest.page.goto(u.href);
    await guest.page.getByLabel("Guest display name").fill("Nora");
    await guest.page.click("[data-act=play]");
    await guest.page.click("[data-act=kit][data-kit=ea]"); await guest.page.click("[data-act=ready]");
    await until(async () => guest!.page.evaluate(() => !!(window as unknown as { __eb?: unknown }).__eb), 30_000, "guest probe");
    await until(async () => (await snap(host.page)).players.filter((p) => p.ready).length === 4, 30_000, "four fighters ready");

    const room = roomOf(code);
    const koLog: string[] = [];
    { const r = room as unknown as { broadcast: (t: unknown, m: unknown, o?: unknown) => void }; const orig = r.broadcast.bind(room);
      r.broadcast = (t, m, o) => { const e = m as { kind?: string; actorId?: string; targetId?: string; moveId?: string; tick?: number }; if (e?.kind === "ko" || e?.kind === "respawn") koLog.push(`${e.kind} t${e.tick} ${e.actorId}->${e.targetId} ${e.moveId}`); orig(t, m, o); }; }
    await until(async () => [...room.combat.all()].every((f) => room.sim.tick > f.protectedUntilTick + 2), 8000, "spawn protection over");
    const s0 = await snap(host.page);
    const A = s0.players.find((p) => p.name === "Arel")!.entityId, B = s0.players.find((p) => p.name === "Nora")!.entityId;
    const bots = s0.players.filter((p) => p.name.startsWith("Bot"));
    expect(bots.length).toBe(2);

    // Measured interval starts here; everything before is setup, tracked by sample index.
    const startIdx = await host.page.evaluate(() => (window as unknown as { __q: { samples: unknown[] } }).__q.samples.length);
    koLog.push(`ids A=${A} B=${B} bots=${bots.map((b) => b.entityId)} tick=${room.sim.tick}`);
    const t0 = Date.now();
    const events = emptyEvents();
    let maxCalls = 0, maxTris = 0, tier = "unknown", reflected = 0, maxFx = 0, fxCap = 0, shed = 0;
    const sample = async (): Promise<Snap> => {
      const s = await snap(host.page);
      if (s.render) { maxCalls = Math.max(maxCalls, s.render.calls); maxTris = Math.max(maxTris, s.render.triangles); tier = s.render.tier; }
      if (s.fx) { maxFx = Math.max(maxFx, s.fx.active); fxCap = s.fx.capacity; shed = s.fx.shed ?? shed; }
      const forms = s.players.filter((p) => p.form === "Awakened").length;
      if (forms >= 2) events.overlapAwakening = Math.max(events.overlapAwakening, 1);
      return s;
    };
    const reset = (): void => {
      for (const id of [A, B]) { const f = room.combat.get(id)!; f.hp100 = 10000; }
      for (const b of bots) place(room, b.entityId, b.entityId % 2 ? 11 : -11, 11);
      place(room, A, 0, 1.5); place(room, B, 0, 0, Math.PI);
    };
    const cycle = async (): Promise<void> => {
      // A respawned fighter is protected, and protected targets neither block nor take damage (no events), so wait it out each cycle.
      await until(async () => [...room.combat.all()].every((f) => room.sim.tick > f.protectedUntilTick + 2), 8000, "spawn protection over");
      reset();
      for (const [id, page, kit] of [[A, host.page, "td"], [B, guest!.page, "ea"]] as const) {
        const f = room.combat.get(id)!; if (f.form !== "Awakened") f.meter100 = meterRequired100(kit);
        const trail: string[] = [];
        await until(async () => { await sample(); { const c = room.combat.get(id)!; const t = `${room.sim.tick}:${c.form}/${c.action?.kind ?? "?"}/m${c.meter100}/l${c.lifeId}/hp${c.hp100}/p${JSON.stringify(room.movement!.position(id)?.map((v) => Math.round(v * 10) / 10))}`; if (trail.at(-1)?.slice(trail.at(-1)!.indexOf(":")) !== t.slice(t.indexOf(":"))) trail.push(t); } return (await snap(page)).players.find((p) => p.entityId === id)?.form === "Awakened" || (await page.keyboard.press("KeyG"), false); }, 8000, `${kit} awakened`).catch((e: unknown) => {
          const c = room.combat.get(id)!;
          throw new Error(`${String(e)} | server form=${c.form} action=${c.action?.kind ?? JSON.stringify(c.action)} meter100=${c.meter100} hp100=${c.hp100} lifeId=${c.lifeId} protectedUntil=${c.protectedUntilTick} tick=${room.sim.tick} trail=${trail.slice(0, 14).join(" ")} kos=${koLog.join("; ")}`);
        });
      }
      await until(async () => { await sample(); return events.overlapAwakening >= 1; }, 5000, "overlapping awakened fighters");
      // Real dash by keyboard fallback on the host.
      // The dash is short and polling is slow under software raster, so press again (cooldown permitting) until one is observed.
      await until(async () => {
        await host.page.keyboard.down("KeyQ"); await sleep(60); await host.page.keyboard.up("KeyQ");
        for (let k = 0; k < 6; k++) { if ((await sample()).players.find((p) => p.entityId === A)?.action === "Dash") return true; }
        return false;
      }, 12_000, "dash seen");
      events.dash++;
      await sleep(900); reset();
      // Block: guest holds guard while the host chain lands.
      await guest!.page.keyboard.down("KeyF");
      const b0 = (await snap(guest!.page)).eventCounts["block"] ?? 0;
      // Re-swing (and re-place) until the server confirms a block: a later cycle may start with a dash cooldown or a drifted stance.
      await until(async () => {
        // Swing only at a guest who is up: a knocked-down fighter cannot guard, and further hits would keep it down.
        const act = (await snap(guest!.page)).players.find((p) => p.entityId === B)?.action;
        if (act === "Ragdolled" || act === "Dead" || act === "Knockdown") { await sleep(300); return false; }
        reset(); await hold(host.page, "attack", 1200); await sample(); return ((await snap(guest!.page)).eventCounts["block"] ?? 0) > b0; }, 15_000, "block event").catch(async (e: unknown) => {
        const g = (await snap(guest!.page)).players.find((p) => p.entityId === B), f = room.combat.get(B)!;
        throw new Error(`${String(e)} | guest action=${g?.action} hp=${g?.hp100} form=${g?.form} protectedUntil=${f.protectedUntilTick} tick=${room.sim.tick} pos=${JSON.stringify(room.movement!.position(B))} vy=${room.movement!.get(B)!.state.vy}`);
      });
      await guest!.page.keyboard.up("KeyF");
      events.block++;
      // Reflection: authoritative orb spawned and reflected through the shipped projectile system (synthetic fixture).
      reset(); await sleep(300);
      const pid = room.projectiles.spawn({ ownerId: A, ownerLifeId: room.combat.get(A)!.lifeId, castCounter: 99, moveId: "ea.b3", x: 1, y: 1.8, z: -3, dirX: 0, dirY: 0, dirZ: -1,
        speed: 2, lifeTicks: 120, maxRange: 40, radius: 0.35, splashRadius: 2, splashMax: 4, reflectable: true, arcAmplitude: 0, arcSpan: 0, chargeClass: "partial",
        damage100: 1500, chip100: 500, block: "B", reaction: { kind: "none" } }, room.sim.tick)!;
      expect(room.projectiles.reflect(pid, B, 100, room.sim.tick)).toBe("reflected");
      await until(async () => { await sample(); return (await snap(guest!.page)).projectiles.some((q) => q.reflectionCount >= 1); }, 5000, "reflection visible");
      reflected++; events.reflection++;
      // Hit and KO: leave the guest one HP and attack with real input.
      reset(); room.combat.get(B)!.hp100 = 100;
      const ko0 = (await snap(host.page)).players.find((p) => p.entityId === B)!.deaths;
      await hold(host.page, "attack", 2500);
      await until(async () => { await sample(); return (await snap(host.page)).players.find((p) => p.entityId === B)!.deaths > ko0; }, 6000, "guest KO");
      events.ko++;
      await until(async () => { await sample(); return (await snap(guest!.page)).players.find((p) => p.entityId === B)!.action !== "Dead"; }, 12_000, "guest respawn");
    };
    do { await cycle(); console.log("QP02 cycle done", Date.now() - t0); } while (LONG && Date.now() - t0 < MINUTES * 60_000);

    // Server-confirmed counts come from the client event bus on the host (hit) and agree across clients on damage.
    const sh = await snap(host.page), sg = await snap(guest.page);
    events.hit = sh.eventCounts["hit"] ?? 0;
    expect(sh.players.map((p) => [p.entityId, p.hp100])).toEqual(sg.players.map((p) => [p.entityId, p.hp100]));
    const endIdx = await host.page.evaluate(() => (window as unknown as { __q: { samples: unknown[] } }).__q.samples.length);
    const raw = await host.page.evaluate(() => (window as unknown as { __q: { samples: { dtMs: number; hidden: boolean }[] } }).__q.samples);
    const samples: FrameSample[] = raw.map((s, i) => i < startIdx ? { dtMs: s.dtMs, excluded: "setup" } : i >= endIdx - 1 ? { dtMs: s.dtMs, excluded: "teardown" } : s.hidden ? { dtMs: s.dtMs, excluded: "hidden" } : { dtMs: s.dtMs });
    const stats = frameStats(samples);
    const sha = execSync("git rev-parse HEAD", { cwd: root }).toString().trim();
    const record = runRecord({ buildSha: sha, workload: `four-fighter-sparring-${LONG ? "long" : "smoke"} (synthetic spawn/meter/HP/reflection fixture, real input, dev client)`,
      device: "desktop Chromium (not a device)", os: process.platform, browser: browser.version(), renderer: "SwiftShader (software)", tier, viewport: [1024, 768],
      evidence: ["tests/browser/quality-fight.spec.ts", "docs/test-results/Q00/static-fixtures.json"] },
      stats, { maxDrawCalls: maxCalls || null, maxVisibleTriangles: maxTris || null, events, unavailable: [`omittedSeconds ${JSON.stringify(stats.omittedSeconds)}`, "FPS is software-rendered diagnostic only"] });
    mkdirSync(outDir, { recursive: true });
    writeFileSync(path.join(outDir, `${LONG ? "long" : "smoke"}-${tier}-run.json`), JSON.stringify(record, null, 2) + "\n");
    await host.page.screenshot({ path: path.join(outDir, `${LONG ? "long" : "smoke"}-host.png`) });
    // QP02: peak particle, geometry and worst-frame record plus budget assertions (spec section 24: 120 calls, 300k triangles, pool cap).
    const worst = samples.filter((s) => !s.excluded).map((s) => s.dtMs).sort((a, b) => b - a).slice(0, 5).map((v) => +v.toFixed(1));
    writeFileSync(path.join(outDir, `${LONG ? "long" : "smoke"}-${tier}-qp02.json`), JSON.stringify({ tier, maxDrawCalls: maxCalls, maxVisibleTriangles: maxTris,
      maxParticlesLive: maxFx, particleCapacity: fxCap, nonEssentialSpawnsShed: shed, worstFiveFramesMs: worst, medianFps: stats.medianFps, frameP95Ms: stats.frameP95Ms,
      environment: "Playwright Chromium on SwiftShader, Apple Mac; software raster, not an iPad" }, null, 2) + "\n");
    expect(maxCalls).toBeLessThanOrEqual(120);
    expect(maxTris).toBeLessThanOrEqual(300_000);
    expect(maxFx).toBeLessThanOrEqual(fxCap);
    expect(maxFx).toBeGreaterThan(0);
    expect(missingEvents(events)).toEqual([]);
    expect(reflected).toBeGreaterThan(0);
    expect(stats.sampleCount).toBeGreaterThan(30);
    expect(host.errors).toEqual([]); expect(guest.errors).toEqual([]);
  } finally { await guest?.ctx.close(); await host.ctx.close(); }
});
