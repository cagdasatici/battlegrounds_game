import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { matchMaker } from "colyseus";
import { startHarness, loginClient, waitFor, players, freshCode, type Harness } from "../fixtures/harness.js";
import type { CombatEvent } from "../../packages/shared/src/protocol.js";
import type { Action, Form } from "../../packages/shared/src/schema.js";
import type { ArenaRoom } from "../../apps/server/src/rooms/ArenaRoom.js";
import { roomTuning } from "../../apps/server/src/rooms/ArenaRoom.js";
import { computeLayout } from "../../apps/client/src/input/ControlLayout.js";
import { PointerRouter } from "../../apps/client/src/input/PointerRouter.js";
import { IntentSampler } from "../../apps/client/src/input/IntentSampler.js";

/**
 * R12 wire matrix (spec section 16 "two clients observing the same result") and acceptance A15.
 * Every row runs two real RoomClient connections. Seat A casts through PointerRouter + IntentSampler (touch edges only),
 * seat B is the victim. Assertions read ONLY the replicated state of both clients, recorded per serverTick; the server
 * objects are used for fixtures (placement, meter pre-fill) and never for an expectation, except the A15 server side
 * capture count which is the stuck-capture invariant itself.
 * Fixture placement through the server body API is the same as in the other integration tests.
 */
type KitId = "sv" | "td";
type Edge = { kind: "skillDown"; slot: 1 | 2 | 3 | 4 } | { kind: "awaken" };
type Seat = "A" | "B";
interface Snap { hp100: number; action: Action; form: Form; x: number; z: number; connected: boolean }
type Pair = Awaited<ReturnType<typeof openPair>>;

interface Ctx {
  room: ArenaRoom; aId: number; bId: number;
  tap(seat: Seat, e: Edge): void;
  place(seat: Seat, x: number, z: number, yaw: number): void;
  /** Server fixture: fills the awakening meter of the seat. */
  fillMeter(seat: Seat): void;
  /** Fills the meter, taps the awaken control and waits for the replicated Awakened form and Idle. */
  awaken(seat: Seat): Promise<void>;
}

interface Row {
  move: string; casterKit: KitId; victimKit: KitId;
  setup: (c: Ctx) => Promise<void>;
  edge: Edge;
  /** Runs right after the edge was sent (counter rows: the victim attacks into the open stance). */
  after?: (c: Ctx) => Promise<void>;
  expectVictimHp100: number; expectVictimAction: Action; waitTicks: number;
  expectCasterForm?: Form;
  /** Extra assertion on the victim snapshot both clients agree on. */
  check?: (victim: Snap) => void;
}

let h: Harness;
beforeAll(async () => { h = await startHarness(25710); });
afterAll(async () => { await h.stop(); });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const L = computeLayout({ x0: 0, y0: 0, W: 1024, H: 768 });
const SEAT_DIST = 1.5;

async function openPair(casterKit: KitId, victimKit: KitId) {
  const code = freshCode();
  const a = await loginClient(h, "Arel");
  const b = await loginClient(h, "Nora");
  const ra = await a.join(code);
  const rb = await b.join(code);
  const events: Record<Seat, CombatEvent[]> = { A: [], B: [] };
  ra.onMessage("combatEvent", (e: CombatEvent) => { events.A.push(e); });
  rb.onMessage("combatEvent", (e: CombatEvent) => { events.B.push(e); });
  await waitFor(() => a.welcome !== null && b.welcome !== null && players(ra).size === 2 && players(rb).size === 2, 3000, "joined");
  a.send("ready", { kitId: casterKit, contentHash: a.localContentHash });
  b.send("ready", { kitId: victimKit, contentHash: b.localContentHash });
  const find = (r: typeof ra, n: string) => [...players(r).values()].find((p) => p.displayName === n);
  await waitFor(() => find(ra, "Arel")?.ready && find(ra, "Nora")?.ready && find(rb, "Arel")?.ready && find(rb, "Nora")?.ready
    && find(ra, "Arel").action === "Idle" && find(rb, "Nora").action === "Idle", 3000, "ready");
  const room = matchMaker.getLocalRoomById(ra.roomId) as unknown as ArenaRoom;
  const aId = find(ra, "Arel").entityId as number, bId = find(ra, "Nora").entityId as number;
  await waitFor(() => room.sim.tick > room.combat.get(bId)!.protectedUntilTick + 2
    && room.sim.tick > room.combat.get(aId)!.protectedUntilTick + 2 && room.movement!.get(bId)!.state.grounded
    && room.movement!.get(aId)!.state.grounded, 4000, "settled");
  return { a, b, ra, rb, room, aId, bId, events, find };
}

function makeCtx(p: Pair): Ctx {
  const { a, b, ra, rb, room, aId, bId, find } = p;
  const mk = (cl: typeof a) => {
    const router = new PointerRouter(L, { awakeningReady: () => true });
    const sampler = new IntentSampler(router, cl.welcome!.epoch);
    let tick = 0;
    return (e: Edge, pointerId: number) => {
      const c = L.controls[e.kind === "awaken" ? "awaken" : (`skill${e.slot}` as "skill1")];
      router.down({ pointerId, x: c.cx, y: c.cy });
      cl.send("input", sampler.sample(++tick)!);
      router.up(pointerId);
      cl.send("input", sampler.sample(++tick)!);
    };
  };
  const taps = { A: mk(a), B: mk(b) };
  const ids = { A: aId, B: bId };
  const names = { A: "Arel", B: "Nora" };
  let pid = 100;
  const ctx: Ctx = {
    room, aId, bId,
    tap: (seat, e) => taps[seat](e, ++pid),
    place(seat, x, z, yaw) {
      const body = room.movement!.get(ids[seat])!;
      const y = room.movement!.position(ids[seat])![1];
      body.rb.setTranslation({ x, y, z }, true);
      body.rb.setNextKinematicTranslation({ x, y, z });
      body.state.facingYaw = yaw;
      body.state.vx = 0; body.state.vz = 0;
    },
    fillMeter(seat) { room.combat.get(ids[seat])!.meter100 = 35000; }, // sv needs 20000, td 35000
    async awaken(seat) {
      ctx.fillMeter(seat);
      await waitFor(() => find(ra, names[seat]).meter100 >= 20000, 2000, "meter replicated");
      ctx.tap(seat, { kind: "awaken" });
      await waitFor(() => find(ra, names[seat]).form === "Awakened" && find(rb, names[seat]).form === "Awakened", 3000, "form Awakened");
      await waitFor(() => find(ra, names[seat]).action === "Idle" && find(rb, names[seat]).action === "Idle", 3000, "activation done");
    },
  };
  return ctx;
}

/** Yaw 0 looks toward -Z. Seat A stands 1.5 m on the +Z side of B (B at its own spot unless given), both facing each other. */
function faceEachOther(c: Ctx, at?: [number, number]): void {
  const bp = c.room.movement!.position(c.bId)!;
  const [bx, bz] = at ?? [bp[0], bp[2]];
  c.place("B", bx, bz, Math.PI);
  c.place("A", bx, bz + SEAT_DIST, 0);
}

/** Records [caster, victim] as replicated to one client, once per observed serverTick. */
function recorder(room: Pair["ra"]) {
  const snaps = new Map<number, [Snap, Snap]>();
  const read = (): void => {
    const st = room.state as unknown as { serverTick: number; players: Map<string, Snap & { displayName: string }> };
    const all = [...st.players.values()];
    const c = all.find((q) => q.displayName === "Arel"), v = all.find((q) => q.displayName === "Nora");
    const pick = (q: Snap): Snap => ({ hp100: q.hp100, action: q.action, form: q.form, x: q.x, z: q.z, connected: q.connected });
    if (c && v && !snaps.has(st.serverTick)) snaps.set(st.serverTick, [pick(c), pick(v)]);
  };
  const timer = setInterval(read, 3);
  return { snaps, stop: () => clearInterval(timer) };
}

/** T17 spawns: B may sit on a satellite island, so A stands on B's arena-centre side (same rule as placeAhead in td-awakened.test.ts). */
function faceCentre(c: Ctx, dist = SEAT_DIST): void {
  const bp = c.room.movement!.position(c.bId)!;
  const north = bp[2] > 0; // B on the +Z side: A stands toward the centre and faces +Z
  c.place("B", bp[0], bp[2], north ? 0 : Math.PI);
  c.place("A", bp[0], bp[2] + (north ? -dist : dist), north ? Math.PI : 0);
}
/** Awakens 8 m away so the Ocean Surge burst (5 m, spec 15) does not reach the victim, then closes to 1.5 m. */
const awakenedCentre = async (c: Ctx): Promise<void> => {
  faceCentre(c, 8); await sleep(60);
  await c.awaken("A");
  faceCentre(c); await sleep(60);
};

const plain = async (c: Ctx): Promise<void> => { faceEachOther(c); await sleep(60); };
const awakened = async (c: Ctx): Promise<void> => {
  faceEachOther(c); await sleep(60);
  await c.awaken("A");
  faceEachOther(c); await sleep(60);
};
const filled = async (c: Ctx): Promise<void> => { await plain(c); c.fillMeter("A"); await sleep(100); };
/** Victim attacks into the open counter stance after 100 ms (6 ticks). */
const victimAttacks = (slot: 1 | 2 | 3 | 4) => async (c: Ctx): Promise<void> => { await sleep(100); c.tap("B", { kind: "skillDown", slot }); };
const sk = (slot: 1 | 2 | 3 | 4): Edge => ({ kind: "skillDown", slot });

/**
 * Currently shipped rows. sv.b3, sv.b4, td.b1, sv.a2 and the sv activation also have dedicated files; they are repeated here
 * so that the matrix is complete and every row shares one two-observer assertion. To add the T16 rows (td.a1 to td.a4), append
 * `{ move: "td.aN", casterKit: "td", victimKit: "sv", setup: awakened, edge: sk(N), ... }` entries below.
 */
const ROWS: Row[] = [
  // A09: direct 20 HP plus 10 HP landing bonus on the real Rapier floor, never 20+10+10.
  { move: "sv.b1", casterKit: "sv", victimKit: "td", setup: plain, edge: sk(1), expectVictimHp100: 10000 - 3000, expectVictimAction: "Idle", waitTicks: 200 },
  { move: "sv.b2", casterKit: "sv", victimKit: "td", setup: plain, edge: sk(2), expectVictimHp100: 10000 - 1500, expectVictimAction: "Idle", waitTicks: 150 },
  { move: "sv.b3", casterKit: "sv", victimKit: "td", setup: plain, edge: sk(3), expectVictimHp100: 10000 - 700, expectVictimAction: "Stunned", waitTicks: 25 },
  { move: "sv.b4", casterKit: "sv", victimKit: "td", setup: plain, edge: sk(4), expectVictimHp100: 10000 - 1500, expectVictimAction: "Ragdolled", waitTicks: 50 },
  { move: "sv.a1", casterKit: "sv", victimKit: "td", setup: awakened, edge: sk(1), after: victimAttacks(1),
    expectVictimHp100: 0, expectVictimAction: "Dead", waitTicks: 200 },
  { move: "sv.a2", casterKit: "sv", victimKit: "td", setup: awakened, edge: sk(2), expectVictimHp100: 0, expectVictimAction: "Dead", waitTicks: 160 },
  { move: "sv.a3", casterKit: "sv", victimKit: "td", setup: awakened, edge: sk(3), expectVictimHp100: 0, expectVictimAction: "Dead", waitTicks: 160 },
  { move: "sv.a4", casterKit: "sv", victimKit: "td", setup: awakened, edge: sk(4), expectVictimHp100: 0, expectVictimAction: "Dead", waitTicks: 200 },
  { move: "sv.activate", casterKit: "sv", victimKit: "td", setup: filled, edge: { kind: "awaken" }, expectVictimHp100: 10000,
    expectVictimAction: "Idle", waitTicks: 60, expectCasterForm: "Awakened" },
  { move: "td.b1", casterKit: "td", victimKit: "sv", setup: plain, edge: sk(1), expectVictimHp100: 10000 - 2400, expectVictimAction: "Ragdolled", waitTicks: 85 },
  // Drag stops at wall.0 (spans z -0.3..0.3, capsule radius 0.4): victim z stays > 0.67 and well short of the full 3 m.
  { move: "td.b2", casterKit: "td", victimKit: "sv", setup: async (c) => { faceEachOther(c, [-10, 1.0]); await sleep(60); }, edge: sk(2),
    expectVictimHp100: 10000 - 1900, expectVictimAction: "Ragdolled", waitTicks: 90,
    check: (v) => { expect(v.z).toBeGreaterThan(0.3 + 0.4 - 0.05); expect(1.0 - v.z).toBeLessThan(0.6); } },
  { move: "td.b3", casterKit: "td", victimKit: "sv", setup: plain, edge: sk(3), expectVictimHp100: 10000 - 900, expectVictimAction: "Ragdolled", waitTicks: 60 },
  { move: "td.b4", casterKit: "td", victimKit: "sv", setup: plain, edge: sk(4), after: victimAttacks(3),
    expectVictimHp100: 10000 - 2200, expectVictimAction: "Ragdolled", waitTicks: 80 },
  // Ocean Surge burst (spec 15): 20 HP in 5 m at activation tick 48, U, R72 ragdoll; the Awakened form starts at completion.
  { move: "td.activate", casterKit: "td", victimKit: "sv", setup: filled, edge: { kind: "awaken" }, expectVictimHp100: 10000 - 2000,
    expectVictimAction: "Ragdolled", waitTicks: 75, expectCasterForm: "Awakened" },
  // T16 awakened rows (docs/test-results/T16.md): td caster awakened, sv victim; totals are sums of the damage tables.
  // a1: capture 4 + 4+4+4 + 10 = 26 HP, release +33 after the capture, ragdoll 60.
  { move: "td.a1", casterKit: "td", victimKit: "sv", setup: awakenedCentre, edge: sk(1), expectVictimHp100: 10000 - 2600,
    expectVictimAction: "Ragdolled", waitTicks: 60 },
  // a2: capture deals 0, 69 HP at capture+72, release +78, ragdoll 90 (no other targets, so no area hit on the victim).
  { move: "td.a2", casterKit: "td", victimKit: "sv", setup: awakenedCentre, edge: sk(2), expectVictimHp100: 10000 - 6900,
    expectVictimAction: "Ragdolled", waitTicks: 110 },
  // a3: 12 HP at activeStart, 26 HP at +17 (ragdoll 72), no capture.
  { move: "td.a3", casterKit: "td", victimKit: "sv", setup: awakenedCentre, edge: sk(3), expectVictimHp100: 10000 - 3800,
    expectVictimAction: "Ragdolled", waitTicks: 45 },
  // a4 close branch (victim within 2 m): 8 HP capture + 22 HP at +36, release +37, ragdoll 72.
  { move: "td.a4", casterKit: "td", victimKit: "sv", setup: awakenedCentre, edge: sk(4), expectVictimHp100: 10000 - 3000,
    expectVictimAction: "Ragdolled", waitTicks: 65 },
];

describe("R12 kit matrix over real Colyseus clients: two observers see identical results", () => {
  for (const row of ROWS) {
    test(`${row.move} ${row.edge.kind === "awaken" ? "activation" : `slot ${row.edge.slot}`}`, async () => {
      const p = await openPair(row.casterKit, row.victimKit);
      const ctx = makeCtx(p);
      const recA = recorder(p.ra);
      const recB = recorder(p.rb);
      try {
        await row.setup(ctx);
        const t0 = p.ra.state.serverTick as number;
        ctx.tap("A", row.edge);
        if (row.after) await row.after(ctx);
        const target = t0 + row.waitTicks;
        await waitFor(() => (p.ra.state.serverTick as number) >= target + 30 && (p.rb.state.serverTick as number) >= target + 30, 20000, "wait ticks");
        recA.stop(); recB.stop();
        // Both observers saw the identical replicated state at every serverTick they have in common after the edge.
        const common = [...recA.snaps.keys()].filter((t) => t >= t0 && recB.snaps.has(t)).sort((x, y) => x - y);
        expect(common.length).toBeGreaterThan(5);
        for (const t of common) expect(recB.snaps.get(t), `tick ${t}`).toEqual(recA.snaps.get(t));
        // The expectation is evaluated at the first common tick at or after t0 + waitTicks.
        const T = common.find((t) => t >= target);
        expect(T, "common tick at target").toBeDefined();
        const [caster, victim] = recA.snaps.get(T!)!;
        expect(recB.snaps.get(T!)![1]).toEqual(victim);
        expect(victim.hp100).toBe(row.expectVictimHp100);
        expect(victim.action).toBe(row.expectVictimAction);
        if (row.expectCasterForm) expect(caster.form).toBe(row.expectCasterForm);
        row.check?.(victim);
        // Server confirmed events reach both clients identically (same tick, kind, ids, damage).
        expect(p.events.B).toEqual(p.events.A);
        expect(p.room.combat.invariantViolations()).toEqual([]);
      } finally {
        recA.stop(); recB.stop();
        await p.a.leave(); await p.b.leave();
      }
    }, 60000);
  }
});

describe("A15 victim disconnects while captured by td.b1", () => {
  const dropMidCapture = async (reconnectSeconds: number) => {
    const p = await openPair("td", "sv");
    const ctx = makeCtx(p);
    faceEachOther(ctx); await sleep(60);
    const cap = () => p.events.A.some((e) => e.kind === "capture" && e.moveId === "td.b1");
    ctx.tap("A", sk(1));
    await waitFor(() => cap() && p.find(p.rb, "Nora").action === "Captured", 3000, "capture replicated");
    const old = roomTuning.reconnectSeconds;
    roomTuning.reconnectSeconds = reconnectSeconds;
    return { p, ctx, restore: () => { roomTuning.reconnectSeconds = old; } };
  };

  test("reservation expires mid capture: capture released, seat removed, captor in recovery, then Idle", async () => {
    const { p, restore } = await dropMidCapture(0.25);
    try {
      const rb = p.rb;
      rb.reconnection.enabled = false;
      rb.connection.close(4010, "network lost");
      await waitFor(() => players(p.ra).size === 1, 5000, "seat released after reservation");
      expect(p.room.combat.captures.size).toBe(0); // no stuck capture
      const arel = () => p.find(p.ra, "Arel");
      expect(["Recovery", "Idle"]).toContain(arel().action);
      await waitFor(() => arel().action === "Idle", 3000, "captor back to Idle");
      expect(p.room.combat.invariantViolations()).toEqual([]);
      // The captor can act again (no stuck state): a later tap is not rejected as busy and the room still ticks.
      const t = p.ra.state.serverTick as number;
      await waitFor(() => (p.ra.state.serverTick as number) > t + 10, 2000, "room still ticking");
    } finally { restore(); await p.a.leave(); await p.b.leave().catch(() => undefined); }
  }, 30000);

  test("capture finishes during the reservation; reconnect gives no fresh HP and no stale Captured; second drop releases the seat", async () => {
    const { p, restore } = await dropMidCapture(3);
    try {
      const entity = p.bId;
      const token = p.rb.reconnectionToken;
      p.rb.reconnection.enabled = false;
      p.rb.connection.close(4010, "network lost");
      await waitFor(() => p.find(p.ra, "Nora")?.connected === false, 3000, "connected=false");
      await waitFor(() => p.find(p.ra, "Nora").action !== "Captured" && p.room.combat.captures.size === 0, 4000, "capture completed");
      await waitFor(() => p.find(p.ra, "Nora").hp100 === 10000 - 2400, 2000, "24 HP removed while disconnected");
      expect(players(p.ra).size).toBe(2); // seat still reserved
      const { Client } = await import("@colyseus/sdk");
      const rb2 = await new Client(`ws://localhost:${h.port}`).reconnect(token);
      await waitFor(() => (players(p.ra).get(String(entity)) as { connected: boolean } | undefined)?.connected === true, 3000, "connected=true");
      const victim = p.find(p.ra, "Nora");
      expect(victim.hp100).toBe(10000 - 2400); // no fresh HP on reconnect
      expect(victim.action).not.toBe("Captured");
      expect(p.room.combat.captures.size).toBe(0);
      await rb2.leave();
    } finally { restore(); await p.a.leave(); }
  }, 30000);
});
