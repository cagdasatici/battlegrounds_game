import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { matchMaker } from "colyseus";
import { startHarness, loginClient, waitFor, players, freshCode, type Harness } from "../fixtures/harness.js";
import type { ActionResult, CombatEvent } from "../../packages/shared/src/protocol.js";
import type { ArenaRoom } from "../../apps/server/src/rooms/ArenaRoom.js";
import { computeLayout } from "../../apps/client/src/input/ControlLayout.js";
import { PointerRouter } from "../../apps/client/src/input/PointerRouter.js";
import { IntentSampler } from "../../apps/client/src/input/IntentSampler.js";

/**
 * T16 Tide Duelist awakened moves over a real Colyseus connection: two real clients, client A (Tide Duelist) drives
 * the touch input stack (PointerRouter and IntentSampler, edges only), client B (Stone Vanguard) is the victim and
 * reads the replicated state and the combat events. Test fixtures only touch server objects to place the fighters
 * and to start A in the Awakened form (the awakening path itself is covered by tests/integration/awakening.test.ts).
 */
let h: Harness;
beforeAll(async () => { h = await startHarness(25712); });
afterAll(async () => { await h.stop(); });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const L = computeLayout({ x0: 0, y0: 0, W: 1024, H: 768 });

function placeAhead(room: ArenaRoom, aId: number, bId: number, dist: number): void {
  const mv = room.movement!;
  const bp = mv.position(bId)!;
  const a = mv.get(aId)!;
  const p = { x: bp[0], y: bp[1], z: bp[2] + dist };
  a.rb.setTranslation(p, true);
  a.rb.setNextKinematicTranslation(p);
  a.state.facingYaw = 0; // faces -Z, toward B
  a.state.vx = 0; a.state.vz = 0;
}

async function setup() {
  const code = freshCode();
  const a = await loginClient(h, "Arel");
  const b = await loginClient(h, "Nora");
  const ra = await a.join(code);
  const rb = await b.join(code);
  const events: CombatEvent[] = [];
  const results: ActionResult[] = [];
  rb.onMessage("combatEvent", (e: CombatEvent) => { events.push(e); });
  ra.onMessage("actionResult", (m: ActionResult) => { results.push(m); });
  await waitFor(() => a.welcome !== null && players(ra).size === 2 && players(rb).size === 2, 3000, "joined");
  a.send("ready", { kitId: "td", contentHash: a.localContentHash });
  b.send("ready", { kitId: "sv", contentHash: b.localContentHash });
  const byName = (n: string) => [...players(rb).values()].find((p) => p.displayName === n);
  await waitFor(() => byName("Arel")?.ready && byName("Nora")?.ready && byName("Arel").action === "Idle", 3000, "ready");
  const room = matchMaker.getLocalRoomById(ra.roomId) as unknown as ArenaRoom;
  const aId = byName("Arel").entityId as number, bId = byName("Nora").entityId as number;
  await waitFor(() => room.sim.tick > room.combat.get(bId)!.protectedUntilTick + 2
    && room.sim.tick > room.combat.get(aId)!.protectedUntilTick + 2 && room.movement!.get(bId)!.state.grounded
    && room.movement!.get(aId)!.state.grounded, 4000, "settled");
  const router = new PointerRouter(L);
  const sampler = new IntentSampler(router, a.welcome!.epoch);
  let tick = 0;
  let pid = 100;
  const tap = (id: "skill1" | "skill2" | "skill3" | "skill4") => {
    const c = L.controls[id];
    const p = ++pid;
    router.down({ pointerId: p, x: c.cx, y: c.cy });
    a.send("input", sampler.sample(++tick)!);
    router.up(p);
    a.send("input", sampler.sample(++tick)!);
  };
  const awaken = () => { const f = room.combat.get(aId)!; f.form = "Awakened"; f.awakenedUsedMask = 0; };
  return { a, b, ra, rb, events, results, byName, room, aId, bId, tap, awaken };
}
type Ctx = Awaited<ReturnType<typeof setup>>;

const mine = (c: Ctx, moveId: string) => c.events.filter((e) => e.moveId === moveId && e.actorId === String(c.aId));
async function press(c: Ctx, slot: 1 | 2 | 3 | 4): Promise<ActionResult> {
  const before = c.results.length;
  c.tap(`skill${slot}` as "skill1");
  await waitFor(() => c.results.length > before, 2000, "action result");
  return c.results[before]!;
}
async function finish(c: Ctx): Promise<void> {
  await waitFor(() => c.room.combat.get(c.aId)!.action === "Idle", 6000, "caster recovered");
  expect(c.room.combat.captures.size).toBe(0);
  expect(c.room.combat.invariantViolations()).toEqual([]);
  await c.a.leave();
  await c.b.leave();
}

describe("T16 Tide Duelist awakened moves over a real Colyseus connection", () => {
  test("td.a1 Cascade Chain: edge, accepted cast, capture, [4,4,4,4,10] at +[0,8,16,24,32], release +33, 26 HP replicated", async () => {
    const c = await setup();
    placeAhead(c.room, c.aId, c.bId, 1.5);
    c.awaken();
    await sleep(60);
    const res = await press(c, 1);
    expect(res.accepted).toBe(true);
    expect(res.castId).toBe(`${c.aId}.${c.room.combat.get(c.aId)!.castCounter}`);
    await waitFor(() => mine(c, "td.a1").some((e) => e.kind === "release"), 6000, "release event");
    const ev = mine(c, "td.a1");
    const cast = ev.find((e) => e.kind === "cast")!;
    const cap = ev.find((e) => e.kind === "capture")!;
    expect(cast.tick).toBe(res.tick);
    expect(cap.tick - cast.tick).toBe(8);
    expect(cap.damage100).toBe(400);
    const hits = ev.filter((e) => e.kind === "hit");
    expect(hits.map((e) => e.damage100)).toEqual([400, 400, 400, 1000]);
    expect(hits.map((e) => e.tick - cap.tick)).toEqual([8, 16, 24, 32]);
    expect(ev.find((e) => e.kind === "release")!.tick - cap.tick).toBe(33);
    await waitFor(() => c.byName("Nora").hp100 === 10000 - 2600, 2000, "victim hp replicated");
    await waitFor(() => c.byName("Nora").action !== "Captured", 2000, "victim not captured");
    expect(c.byName("Arel").form).toBe("Awakened"); // not a consuming move
    await finish(c);
  }, 40000);

  test("td.a2 Deepfall: cinematic capture, 69 HP at +72, release +78, once per form (second press refused with FORM)", async () => {
    const c = await setup();
    placeAhead(c.room, c.aId, c.bId, 1.5);
    c.awaken();
    await sleep(60);
    const res = await press(c, 2);
    expect(res.accepted).toBe(true);
    await waitFor(() => mine(c, "td.a2").some((e) => e.kind === "release"), 8000, "release event");
    const ev = mine(c, "td.a2");
    const cap = ev.find((e) => e.kind === "capture")!;
    expect(cap.tick - ev.find((e) => e.kind === "cast")!.tick).toBe(16);
    expect(cap.damage100 ?? 0).toBe(0);
    const hits = ev.filter((e) => e.kind === "hit");
    expect(hits.map((e) => [e.tick - cap.tick, e.damage100])).toEqual([[72, 6900]]);
    expect(ev.find((e) => e.kind === "release")!.tick - cap.tick).toBe(78);
    await waitFor(() => c.byName("Nora").hp100 === 10000 - 6900, 2000, "victim hp replicated");
    expect(c.byName("Arel").awakenedUsedMask & 0b10).toBe(0b10);
    await waitFor(() => c.room.combat.get(c.aId)!.action === "Idle", 6000, "recovered");
    const again = await press(c, 2);
    expect(again.accepted).toBe(false);
    expect(again.reason).toBe("FORM");
    await finish(c);
  }, 40000);

  test("td.a3 Split Tide: 12 HP and stun at activeStart, 26 HP at +17, 38 HP replicated, no capture", async () => {
    const c = await setup();
    placeAhead(c.room, c.aId, c.bId, 1.5);
    c.awaken();
    await sleep(60);
    const res = await press(c, 3);
    expect(res.accepted).toBe(true);
    await waitFor(() => mine(c, "td.a3").filter((e) => e.kind === "hit").length === 2, 6000, "two hits");
    const ev = mine(c, "td.a3");
    const cast = ev.find((e) => e.kind === "cast")!;
    const hits = ev.filter((e) => e.kind === "hit");
    expect(hits.map((e) => [e.tick - cast.tick, e.damage100])).toEqual([[16, 1200], [33, 2600]]);
    expect(ev.some((e) => e.kind === "capture")).toBe(false);
    await waitFor(() => c.byName("Nora").hp100 === 10000 - 3800, 2000, "victim hp replicated");
    await finish(c);
  }, 40000);

  test("td.a4 Riptide Pursuit close branch: capture 8 HP at activeStart, 22 HP at +36, release +37", async () => {
    const c = await setup();
    placeAhead(c.room, c.aId, c.bId, 1.5);
    c.awaken();
    await sleep(60);
    const res = await press(c, 4);
    expect(res.accepted).toBe(true);
    await waitFor(() => mine(c, "td.a4").some((e) => e.kind === "release"), 6000, "release event");
    const ev = mine(c, "td.a4");
    const cap = ev.find((e) => e.kind === "capture")!;
    expect(cap.tick - ev.find((e) => e.kind === "cast")!.tick).toBe(12);
    expect(cap.damage100).toBe(800);
    expect(ev.filter((e) => e.kind === "hit").map((e) => [e.tick - cap.tick, e.damage100])).toEqual([[36, 2200]]);
    expect(ev.find((e) => e.kind === "release")!.tick - cap.tick).toBe(37);
    await waitFor(() => c.byName("Nora").hp100 === 10000 - 3000, 2000, "victim hp replicated");
    await finish(c);
  }, 40000);

  test("td.a4 Riptide Pursuit ranged branch: the server dashes the caster, captures after travel, 27 HP at +36", async () => {
    const c = await setup();
    placeAhead(c.room, c.aId, c.bId, 5);
    c.awaken();
    await sleep(60);
    const startZ = c.room.movement!.position(c.aId)![2];
    const res = await press(c, 4);
    expect(res.accepted).toBe(true);
    await waitFor(() => mine(c, "td.a4").some((e) => e.kind === "release"), 6000, "release event");
    const ev = mine(c, "td.a4");
    const cap = ev.find((e) => e.kind === "capture")!;
    const castTick = ev.find((e) => e.kind === "cast")!.tick;
    expect(cap.tick - castTick).toBeGreaterThan(12); // travel happened first
    expect(cap.tick - castTick).toBeLessThanOrEqual(12 + 29);
    expect(cap.damage100 ?? 0).toBe(0);
    expect(ev.filter((e) => e.kind === "hit").map((e) => [e.tick - cap.tick, e.damage100])).toEqual([[36, 2700]]);
    expect(ev.find((e) => e.kind === "release")!.tick - cap.tick).toBe(37);
    const endZ = c.room.movement!.position(c.aId)![2];
    expect(startZ - endZ).toBeGreaterThan(3); // moved forward (-Z) by the server, never by the client
    expect(startZ - endZ).toBeLessThanOrEqual(9.01);
    await waitFor(() => c.byName("Nora").hp100 === 10000 - 2700, 2000, "victim hp replicated");
    await finish(c);
  }, 40000);
});
