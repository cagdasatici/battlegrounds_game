import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { matchMaker } from "colyseus";
import { startHarness, loginClient, waitFor, players, freshCode, type Harness } from "../fixtures/harness.js";
import type { ActionResult, CombatEvent } from "../../packages/shared/src/protocol.js";
import type { ArenaRoom } from "../../apps/server/src/rooms/ArenaRoom.js";
import { computeLayout } from "../../apps/client/src/input/ControlLayout.js";
import { PointerRouter } from "../../apps/client/src/input/PointerRouter.js";
import { IntentSampler } from "../../apps/client/src/input/IntentSampler.js";

/**
 * T20 wire rows: the four Ember Artificer base moves cast by a real client through the touch input stack
 * (PointerRouter + IntentSampler) against a second real client, over real Colyseus connections. The Artificer is not
 * selectable in P0 (P0_KITS), so the server fixture switches seat A's fighter kit to "ea" after the normal ready
 * handshake (the single kit owner, R10). Every expectation reads what BOTH clients replicated (players, projectiles) and
 * the combat events each received; the server objects only place fighters. The arena lane x = -4, z from -4 to 9 is
 * flat free ground (the T19 wire rows use it).
 */
let h: Harness;
beforeAll(async () => { h = await startHarness(25760); });
afterAll(async () => { await h.stop(); });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const L = computeLayout({ x0: 0, y0: 0, W: 1024, H: 768 });
const HP = 10000;

async function open() {
  const code = freshCode();
  const a = await loginClient(h, "Arel");
  const b = await loginClient(h, "Nora");
  const ra = await a.join(code);
  const rb = await b.join(code);
  const events = { A: [] as CombatEvent[], B: [] as CombatEvent[] };
  const results: ActionResult[] = [];
  ra.onMessage("combatEvent", (e: CombatEvent) => { events.A.push(e); });
  rb.onMessage("combatEvent", (e: CombatEvent) => { events.B.push(e); });
  ra.onMessage("actionResult", (m: ActionResult) => { results.push(m); });
  await waitFor(() => a.welcome !== null && players(ra).size === 2 && players(rb).size === 2, 3000, "joined");
  a.send("ready", { kitId: "sv", contentHash: a.localContentHash });
  b.send("ready", { kitId: "td", contentHash: b.localContentHash });
  const by = (r: typeof ra, n: string) => [...players(r).values()].find((p) => p.displayName === n);
  await waitFor(() => by(ra, "Arel")?.ready && by(rb, "Nora")?.ready && by(ra, "Arel").action === "Idle" && by(rb, "Nora").action === "Idle", 3000, "ready");
  const room = matchMaker.getLocalRoomById(ra.roomId) as unknown as ArenaRoom;
  const aId = by(ra, "Arel").entityId as number, bId = by(ra, "Nora").entityId as number;
  await waitFor(() => room.sim.tick > room.combat.get(aId)!.protectedUntilTick + 2 && room.sim.tick > room.combat.get(bId)!.protectedUntilTick + 2
    && room.movement!.get(aId)!.state.grounded && room.movement!.get(bId)!.state.grounded, 4000, "settled");
  room.combat.get(aId)!.kitId = "ea"; // fixture: the Artificer is hidden in P0, the kit owner is the fighter record
  await waitFor(() => by(ra, "Arel").kitId === "ea" && by(rb, "Arel").kitId === "ea", 2000, "kit replicated");
  const place = (id: number, x: number, z: number, yaw: number): number => {
    const y = (room.world!.groundHeight(x, z) ?? 0) + 0.9;
    const body = room.movement!.get(id)!;
    body.rb.setTranslation({ x, y, z }, true);
    body.rb.setNextKinematicTranslation({ x, y, z });
    body.state.facingYaw = yaw; body.state.vx = 0; body.state.vy = 0; body.state.vz = 0;
    return y;
  };
  const router = new PointerRouter(L);
  const sampler = new IntentSampler(router, a.welcome!.epoch);
  let seq = 0, pid = 100;
  const sendInput = () => a.send("input", sampler.sample(++seq)!);
  const tap = async (slot: 1 | 2 | 3 | 4): Promise<ActionResult> => {
    const before = results.length;
    const c = L.controls[`skill${slot}` as "skill1"];
    const p = ++pid;
    router.down({ pointerId: p, x: c.cx, y: c.cy });
    sendInput();
    router.up(p);
    sendInput();
    await waitFor(() => results.length > before, 2000, `action result slot ${slot}`);
    return results[before]!;
  };
  const hpSeenByBoth = (name: string, hp: number) => by(ra, name).hp100 === hp && by(rb, name).hp100 === hp;
  const evs = (k: "A" | "B", moveId: string, kind: CombatEvent["kind"]) => events[k].filter((e) => e.moveId === moveId && e.kind === kind);
  return { a, b, ra, rb, room, aId, bId, by, place, router, sampler, sendInput, tap, results, events, hpSeenByBoth, evs, pidNext: () => ++pid };
}
type Ctx = Awaited<ReturnType<typeof open>>;
async function close(x: Ctx): Promise<void> {
  await waitFor(() => x.room.combat.get(x.aId)!.action === "Idle", 8000, "caster recovered");
  expect(x.room.combat.invariantViolations()).toEqual([]);
  expect(x.room.projectiles.size).toBe(0);
  await x.a.leave(); await x.b.leave();
}

describe("T20 Ember Artificer over a real Colyseus connection", () => {
  test("ea.b1 Cinder Array: six hits, 21 HP, ragdoll finish; both clients agree on hp, events and the replicated cooldown", async () => {
    const x = await open();
    x.place(x.aId, -4, 9, 0);
    x.place(x.bId, -4, 7.5, Math.PI);
    await sleep(80);
    const res = await x.tap(1);
    expect(res.accepted).toBe(true);
    const cast = x.room.sim.tick;
    await waitFor(() => x.hpSeenByBoth("Nora", HP - 2100), 4000, "21 HP on both clients");
    await waitFor(() => x.by(x.rb, "Nora").action === "Ragdolled" && x.by(x.ra, "Nora").action === "Ragdolled", 2000, "ragdoll replicated");
    for (const k of ["A", "B"] as const) {
      const hits = x.evs(k, "ea.b1", "hit");
      expect(hits.map((e) => e.damage100), `hits seen by ${k}`).toEqual([200, 200, 200, 200, 300, 1000]);
      expect(hits.map((e) => e.tick - hits[0]!.tick)).toEqual([0, 8, 16, 24, 32, 39]);
      expect(hits[0]!.tick - cast).toBeGreaterThanOrEqual(8);
    }
    expect(x.by(x.ra, "Arel").cooldownEndTicks[0]).toBeGreaterThan(x.room.sim.tick + 700);
    expect(x.evs("A", "ea.b1", "cast")).toHaveLength(1);
    await close(x);
  }, 30000);

  test("ea.b1 miss and cooldown over the wire: a second tap during the cooldown is rejected COOLDOWN", async () => {
    const x = await open();
    x.place(x.aId, -4, 9, 0);
    x.place(x.bId, -4, 2, Math.PI);
    await sleep(80);
    expect((await x.tap(1)).accepted).toBe(true);
    await waitFor(() => x.room.combat.get(x.aId)!.action === "Idle", 4000, "cast over");
    const second = await x.tap(1);
    expect(second.accepted).toBe(false);
    expect(second.reason).toBe("COOLDOWN");
    expect(x.by(x.ra, "Nora").hp100).toBe(HP);
    expect(x.by(x.rb, "Nora").hp100).toBe(HP);
    await close(x);
  }, 30000);

  test("ea.b2 Vent Rush: the caster rushes 8 m (replicated position), the front blast hits at travel end for 15 HP R72", async () => {
    const x = await open();
    x.place(x.aId, -4, 9, 0);
    x.place(x.bId, -4, -0.5, Math.PI);
    await sleep(80);
    expect((await x.tap(2)).accepted).toBe(true);
    await waitFor(() => x.hpSeenByBoth("Nora", HP - 1500), 4000, "15 HP on both clients");
    for (const k of ["A", "B"] as const) {
      const hits = x.evs(k, "ea.b2", "hit");
      expect(hits).toHaveLength(1);
      expect([hits[0]!.targetId, hits[0]!.damage100]).toEqual([String(x.bId), 1500]);
    }
    await waitFor(() => x.by(x.rb, "Nora").action === "Ragdolled", 2000, "ragdoll replicated");
    await waitFor(() => x.room.combat.get(x.aId)!.action === "Idle", 4000, "caster back to idle");
    const az = x.by(x.rb, "Arel").z / 100;
    expect(az).toBeLessThan(2.5); // started at z 9 and rushed about 8 m toward -Z
    expect(az).toBeGreaterThan(-1);
    await close(x);
  }, 30000);

  test("ea.b2 recast over the wire: a second tap after 6 active ticks ends the rush early; one before is answered STATE", async () => {
    const x = await open();
    x.place(x.aId, -4, 9, 0);
    x.place(x.bId, -4, -9, Math.PI);
    await sleep(80);
    expect((await x.tap(2)).accepted).toBe(true);
    const cast = x.room.abilities.castOf(x.aId)!;
    // FLAKE1: `>=`, not `===`: the fixed clock can step several ticks in one event-loop turn under CPU load, which skipped the exact tick and timed out.
    await waitFor(() => x.room.sim.tick >= cast.activeStart + 2, 2000, "two active ticks in");
    const early = await x.tap(2);
    expect(early.accepted).toBe(false);
    expect(early.reason).toBe("STATE");
    await waitFor(() => x.room.sim.tick >= cast.activeStart + 7, 2000, "six active ticks passed");
    const late = await x.tap(2);
    expect(late.accepted).toBe(true);
    await waitFor(() => x.room.combat.get(x.aId)!.action === "Recovery" || x.room.combat.get(x.aId)!.action === "Idle", 2000, "travel ended");
    await waitFor(() => x.room.combat.get(x.aId)!.action === "Idle", 4000, "caster back to idle");
    const az = x.by(x.rb, "Arel").z / 100;
    expect(az).toBeGreaterThan(5.5); // 7 to 8 steps of one third metre, nowhere near the 8 m
    expect(x.hpSeenByBoth("Nora", HP)).toBe(true);
    await close(x);
  }, 30000);

  test("ea.b3 Ember Orb: a held touch charge releases a replicated projectile that hits for 15 HP on both clients", async () => {
    const x = await open();
    x.place(x.aId, -4, 9, 0);
    x.place(x.bId, -4, -1, Math.PI);
    await sleep(80);
    const c = L.controls.skill3;
    const p = x.pidNext();
    x.router.down({ pointerId: p, x: c.cx, y: c.cy });
    x.sendInput();
    await waitFor(() => x.results.length >= 1, 2000, "charge accepted");
    expect(x.results[0]!.accepted).toBe(true);
    for (let i = 0; i < 12; i++) { x.sendInput(); await sleep(33); }
    expect(x.by(x.ra, "Arel").owner?.chargeStartTick ?? x.room.abilities.chargeStartOf(x.aId)).toBeGreaterThan(0);
    x.router.up(p);
    x.sendInput();
    const seenA = (): number => (x.ra.state as unknown as { projectiles: Map<string, unknown> }).projectiles.size;
    const seenB = (): number => (x.rb.state as unknown as { projectiles: Map<string, unknown> }).projectiles.size;
    let sawProjectile = false;
    await waitFor(() => { if (seenA() === 1 && seenB() === 1) sawProjectile = true; return x.hpSeenByBoth("Nora", HP - 1500); }, 5000, "15 HP on both clients");
    expect(sawProjectile).toBe(true);
    for (const k of ["A", "B"] as const) {
      const hits = x.evs(k, "ea.b3", "hit");
      expect(hits).toHaveLength(1);
      expect([hits[0]!.actorId, hits[0]!.targetId, hits[0]!.damage100]).toEqual([String(x.aId), String(x.bId), 1500]);
    }
    await waitFor(() => seenA() === 0 && seenB() === 0, 2000, "projectile removed");
    await close(x);
  }, 30000);

  test("ea.b4 Furnace Drop: the caster rises, lands near the point 8 m ahead and the impact hits for 20 HP R84 on both clients", async () => {
    const x = await open();
    x.place(x.aId, -4, 9, 0);
    x.place(x.bId, -4, 0.2, Math.PI);
    await sleep(80);
    expect((await x.tap(4)).accepted).toBe(true);
    let peak = 0;
    await waitFor(() => { peak = Math.max(peak, x.by(x.rb, "Arel").y / 100); return x.hpSeenByBoth("Nora", HP - 2000); }, 5000, "20 HP on both clients");
    expect(peak).toBeGreaterThan(2.5); // rose above the standing height of about 1 m
    for (const k of ["A", "B"] as const) {
      const hits = x.evs(k, "ea.b4", "hit");
      expect(hits).toHaveLength(1);
      expect(hits[0]!.damage100).toBe(2000);
    }
    await waitFor(() => x.by(x.rb, "Nora").action === "Ragdolled", 2000, "ragdoll replicated");
    expect(x.room.movement!.get(x.aId)!.state.grounded).toBe(true);
    await close(x);
  }, 30000);

  test("ea.b4 interruption over the wire: a stun during the rise cancels the drop; nothing lands", async () => {
    const x = await open();
    x.place(x.aId, -4, 9, 0);
    x.place(x.bId, -4, 0.2, Math.PI);
    await sleep(80);
    expect((await x.tap(4)).accepted).toBe(true);
    await sleep(100);
    const f = x.room.combat.get(x.aId)!;
    const { applyReaction } = await import("../../apps/server/src/sim/ActionMachine.js");
    applyReaction(f, x.room.sim.tick, { kind: "stun", ticks: 30 }, true); // fixture: an enemy hit stand-in
    await waitFor(() => x.room.combat.get(x.aId)!.action === "Idle", 6000, "caster idle again");
    expect(x.hpSeenByBoth("Nora", HP)).toBe(true);
    expect(x.evs("B", "ea.b4", "hit")).toHaveLength(0);
    await close(x);
  }, 30000);
});
