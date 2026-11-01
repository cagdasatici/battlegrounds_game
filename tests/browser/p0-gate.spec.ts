// T18e P0 playable gate: two real browser contexts (Chromium, SwiftShader WebGL) complete all 16 slotted moves
// (sv b1-b4, sv a1-a4, td b1-b4, td a1-a4) and both awakenings through the real UI (touch taps on the HUD and keyboard),
// against a real in-process Colyseus server. Expected numbers are the R12 wire-matrix numbers (docs/test-results/R12.md).
// Assertions read ONLY replicated state as seen by both browser clients (window.__eb.snapshot via ?debug=1).
// Server fixtures (documented in docs/test-results/T18e.md): placement through the room's movement body API and
// awakening meter pre-fill through room.combat, the same fixtures used by tests/integration/kit-matrix.test.ts.
import { test, expect, chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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
const outDir = path.join(root, "docs/test-results");
const req = createRequire(path.join(root, "apps/client/package.json"));
import { resolveChromium } from "./harness/chromium-path.js";
const CHROMIUM = resolveChromium();
const GL_ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];

interface Dev { close(): Promise<void>; listen(): Promise<unknown> }
interface P { entityId: number; name: string; kitId: string; hp100: number; action: string; moveId: string; ready: boolean; x: number; z: number; local: boolean; meter100: number; form: string }
interface Snap { serverTick: number; players: P[] }
type KitId = "sv" | "td";

let game: Server, svc: AuthServices, vite: Dev, browser: Browser;
let base = "";
let n = 0;
const evidence: Record<string, unknown> = {};

const freePort = (): Promise<number> => new Promise((resolve, reject) => {
  const s = netServer();
  s.listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); });
  s.on("error", reject);
});

test.beforeAll(async () => {
  const gamePort = await freePort(), vitePort = await freePort();
  base = `http://localhost:${vitePort}`;
  svc = createAuthServices({
    dataDir: mkdtempSync(path.join(tmpdir(), "eb-pw-p0-")), allowedOrigins: [base], secureCookies: false,
    roomCodes: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`p0r${i}`, "arena"])), buildId: "test", sessionsPerMinute: 10_000, globalSessionsPerMinute: 10_000,
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
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "T18e-playwright.json"), JSON.stringify(evidence, null, 2));
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

interface Fx {
  place(seat: "A" | "B", x: number, z: number, yaw: number): void;
  fillMeter(seat: "A" | "B"): void;
  /** Awakening through the real UI: touch tap on the Awaken control (or the G key). */
  awaken(how: "touch" | "key"): Promise<void>;
}
type Input = { kind: "skill"; slot: 1 | 2 | 3 | 4; how: "touch" | "key" } | { kind: "awaken"; how: "touch" | "key" };

interface Row {
  id: string; casterKit: KitId; victimKit: KitId;
  setup: "plain" | "filled" | "awakened" | "awakenedCentre" | "wall";
  input: Input;
  /** Victim attacks into the open counter stance 100 ms after the cast starts (touch). */
  counterSlot?: 1 | 2 | 3 | 4;
  victimHp100: number; dead?: true; waitTicks: number;
  casterForm?: string; moveId: string; victimActions?: string[];
  check?: (v: P) => void;
}
const sk = (slot: 1 | 2 | 3 | 4, how: "touch" | "key"): Input => ({ kind: "skill", slot, how });
// Numbers and waits are the R12 rows (docs/test-results/R12.md). Base moves use touch taps, awakened moves use keys.
const ROWS: Row[] = [
  { id: "sv.b1", casterKit: "sv", victimKit: "td", setup: "plain", input: sk(1, "touch"), victimHp100: 7000, waitTicks: 200, moveId: "sv.b1" },
  { id: "sv.b2", casterKit: "sv", victimKit: "td", setup: "plain", input: sk(2, "touch"), victimHp100: 8500, waitTicks: 150, moveId: "sv.b2" },
  { id: "sv.b3", casterKit: "sv", victimKit: "td", setup: "plain", input: sk(3, "touch"), victimHp100: 9300, waitTicks: 25, moveId: "sv.b3", victimActions: ["Stunned"] },
  { id: "sv.b4", casterKit: "sv", victimKit: "td", setup: "plain", input: sk(4, "touch"), victimHp100: 8500, waitTicks: 50, moveId: "sv.b4", victimActions: ["Ragdolled"] },
  { id: "sv.a1", casterKit: "sv", victimKit: "td", setup: "awakened", input: sk(1, "key"), counterSlot: 1, victimHp100: 0, dead: true, waitTicks: 200, moveId: "sv.a1" },
  { id: "sv.a2", casterKit: "sv", victimKit: "td", setup: "awakened", input: sk(2, "key"), victimHp100: 0, dead: true, waitTicks: 160, moveId: "sv.a2" },
  { id: "sv.a3", casterKit: "sv", victimKit: "td", setup: "awakened", input: sk(3, "key"), victimHp100: 0, dead: true, waitTicks: 160, moveId: "sv.a3" },
  { id: "sv.a4", casterKit: "sv", victimKit: "td", setup: "awakened", input: sk(4, "key"), victimHp100: 0, dead: true, waitTicks: 200, moveId: "sv.a4" },
  { id: "sv.activate", casterKit: "sv", victimKit: "td", setup: "filled", input: { kind: "awaken", how: "touch" }, victimHp100: 10000, waitTicks: 60, casterForm: "Awakened", moveId: "sv.activate" },
  { id: "td.b1", casterKit: "td", victimKit: "sv", setup: "plain", input: sk(1, "touch"), victimHp100: 7600, waitTicks: 85, moveId: "td.b1", victimActions: ["Ragdolled"] },
  { id: "td.b2", casterKit: "td", victimKit: "sv", setup: "wall", input: sk(2, "touch"), victimHp100: 8100, waitTicks: 90, moveId: "td.b2", victimActions: ["Ragdolled"],
    check: (v) => { expect(v.z).toBeGreaterThan(0.3 + 0.4 - 0.05); expect(1.0 - v.z).toBeLessThan(0.6); } },
  { id: "td.b3", casterKit: "td", victimKit: "sv", setup: "plain", input: sk(3, "touch"), victimHp100: 9100, waitTicks: 60, moveId: "td.b3", victimActions: ["Ragdolled"] },
  { id: "td.b4", casterKit: "td", victimKit: "sv", setup: "plain", input: sk(4, "touch"), counterSlot: 3, victimHp100: 7800, waitTicks: 80, moveId: "td.b4", victimActions: ["Ragdolled"] },
  { id: "td.activate", casterKit: "td", victimKit: "sv", setup: "filled", input: { kind: "awaken", how: "key" }, victimHp100: 8000, waitTicks: 75, casterForm: "Awakened", moveId: "td.activate", victimActions: ["Ragdolled"] },
  { id: "td.a1", casterKit: "td", victimKit: "sv", setup: "awakenedCentre", input: sk(1, "key"), victimHp100: 7400, waitTicks: 60, moveId: "td.a1", victimActions: ["Ragdolled"] },
  { id: "td.a2", casterKit: "td", victimKit: "sv", setup: "awakenedCentre", input: sk(2, "key"), victimHp100: 3100, waitTicks: 110, moveId: "td.a2", victimActions: ["Ragdolled"] },
  { id: "td.a3", casterKit: "td", victimKit: "sv", setup: "awakenedCentre", input: sk(3, "key"), victimHp100: 6200, waitTicks: 45, moveId: "td.a3", victimActions: ["Ragdolled"] },
  { id: "td.a4", casterKit: "td", victimKit: "sv", setup: "awakenedCentre", input: sk(4, "key"), victimHp100: 7000, waitTicks: 65, moveId: "td.a4", victimActions: ["Ragdolled"] },
];

// Both players stand in the clear central area. Yaw 0 faces -Z (the default camera), so A is on the +Z side of B.
const SEAT_DIST = 1.5;

test.describe("T18e: all 16 slotted moves and both awakenings through the UI, two browser clients agree", () => {
  for (const row of ROWS) {
    test(`${row.id}`, async () => {
      test.setTimeout(120_000);
      const code = `p0r${n++}`;
      const A = await open(code, "Arel", row.casterKit);
      await until(async () => (await snap(A.page)).players.some((p) => p.local), 20_000, "A joined");
      const B = await open(code, "Nora", row.victimKit);
      try {
        await until(async () => {
          const [a, b] = [await snap(A.page), await snap(B.page)];
          return a.players.length === 2 && b.players.length === 2 && a.players.every((p) => p.ready) && b.players.every((p) => p.ready) ? true : null;
        }, 25_000, "both ready");
        const rooms = await matchMaker.query({ name: "arena" });
        const info = rooms.find((r) => r.clients === 2);
        expect(info, "room with both clients").toBeDefined();
        const room = matchMaker.getLocalRoomById(info!.roomId) as unknown as ArenaRoom;
        const sa = await snap(A.page);
        const aId = sa.players.find((p) => p.local)!.entityId, bId = sa.players.find((p) => !p.local)!.entityId;
        // Spawn protection (120 ticks) must be over and both bodies grounded.
        await until(async () => room.sim.tick > room.combat.get(aId)!.protectedUntilTick + 2 && room.sim.tick > room.combat.get(bId)!.protectedUntilTick + 2
          && room.movement!.get(aId)!.state.grounded && room.movement!.get(bId)!.state.grounded ? true : null, 15_000, "settled");
        const ids = { A: aId, B: bId };
        const fx: Fx = {
          place(seat, x, z, yaw) {
            const body = room.movement!.get(ids[seat])!;
            const y = room.movement!.position(ids[seat])![1];
            body.rb.setTranslation({ x, y, z }, true);
            body.rb.setNextKinematicTranslation({ x, y, z });
            body.state.facingYaw = yaw; body.state.vx = 0; body.state.vz = 0;
          },
          fillMeter(seat) { room.combat.get(ids[seat])!.meter100 = 35000; }, // server fixture; sv needs 20000, td 35000
          async awaken(how) {
            fx.fillMeter("A");
            await until(async () => (await snap(A.page)).players.find((p) => p.local)!.meter100 >= 20000 ? true : null, 4000, "meter replicated");
            if (how === "touch") await touch(A.page, "awaken"); else await key(A.page, "KeyG");
            await until(async () => {
              const [a, b] = [await snap(A.page), await snap(B.page)];
              const fa = a.players.find((p) => p.local)!, fb = b.players.find((p) => p.name === "Arel")!;
              return fa.form === "Awakened" && fb.form === "Awakened" && fa.action === "Idle" && fb.action === "Idle" ? true : null;
            }, 8000, "Awakened on both clients");
          },
        };
        const face = (at: [number, number] = [0, -3], dist = SEAT_DIST): void => {
          fx.place("B", at[0], at[1], Math.PI); fx.place("A", at[0], at[1] + dist, 0);
        };
        if (row.setup === "wall") { face([-10, 1.0]); }
        else if (row.setup === "awakened") { face(); await sleep(150); await fx.awaken("touch"); face(); }
        else if (row.setup === "awakenedCentre") { face([0, -3], 8); await sleep(150); await fx.awaken("touch"); face(); }
        else { face(); }
        await sleep(250);
        if (row.setup === "filled") { fx.fillMeter("A"); await sleep(250); }

        const t0 = (await snap(A.page)).serverTick;
        const traceA = { hp: [] as number[], actions: new Set<string>(), moves: new Set<string>() };
        const traceB = { hp: [] as number[], actions: new Set<string>() };
        const sample = async (): Promise<void> => {
          const [a, b] = [await snap(A.page), await snap(B.page)];
          const va = a.players.find((p) => p.name === "Nora")!, vb = b.players.find((p) => p.local)!;
          if (traceA.hp.at(-1) !== va.hp100) traceA.hp.push(va.hp100);
          if (traceB.hp.at(-1) !== vb.hp100) traceB.hp.push(vb.hp100);
          traceA.actions.add(va.action); traceB.actions.add(vb.action);
          const m = a.players.find((p) => p.local)!.moveId;
          if (m) traceA.moves.add(m);
        };
        // Real UI input.
        const inp = row.input;
        if (inp.kind === "awaken") { if (inp.how === "touch") await touch(A.page, "awaken"); else await key(A.page, "KeyG"); }
        else if (inp.how === "touch") await touch(A.page, `skill${inp.slot}`);
        else await key(A.page, `Digit${inp.slot}`);
        const tCast = Date.now();
        let countered = false;
        let last: Snap = await snap(A.page);
        while (last.serverTick < t0 + row.waitTicks + 30) {
          if (row.counterSlot && !countered && Date.now() - tCast > 100) { countered = true; await touch(B.page, `skill${row.counterSlot}`); }
          await sample();
          last = await snap(A.page);
          if (Date.now() - tCast > 30_000) throw new Error("timeout waiting for ticks");
        }
        await sample();
        const finalA = (await snap(A.page)).players, finalB = (await snap(B.page)).players;
        const vA = finalA.find((p) => p.name === "Nora")!, vB = finalB.find((p) => p.local)!;
        if (row.dead) {
          expect(traceA.hp, "A sees victim reach 0").toContain(0);
          expect(traceB.hp, "B sees own death").toContain(0);
          expect(traceA.actions.has("Dead")).toBe(true);
          expect(traceB.actions.has("Dead")).toBe(true);
        } else {
          expect(vA.hp100).toBe(row.victimHp100);
          expect(vB.hp100).toBe(row.victimHp100);
          // Both clients saw the same sequence of HP values.
          expect(traceB.hp).toEqual(traceA.hp);
          if (row.victimActions) for (const act of row.victimActions) { expect(traceA.actions.has(act), `A saw ${act}`).toBe(true); expect(traceB.actions.has(act), `B saw ${act}`).toBe(true); }
          row.check?.(vA);
          row.check?.(vB);
        }
        expect(traceA.moves.has(row.moveId), `caster client saw ${row.moveId}; saw ${[...traceA.moves].join(",")}`).toBe(true);
        if (row.casterForm) {
          expect(finalA.find((p) => p.local)!.form).toBe(row.casterForm);
          expect(finalB.find((p) => p.name === "Arel")!.form).toBe(row.casterForm);
        }
        expect(room.combat.invariantViolations()).toEqual([]);
        evidence[row.id] = { victimHpTraceSeenByA: traceA.hp, victimHpTraceSeenByB: traceB.hp, actionsSeenByA: [...traceA.actions], moves: [...traceA.moves], finalVictimHp100: { A: vA.hp100, B: vB.hp100 }, errorsA: A.errors, errorsB: B.errors };
        expect(A.errors).toEqual([]);
        expect(B.errors).toEqual([]);
      } finally {
        await A.ctx.close();
        await B.ctx.close();
      }
    });
  }
});
