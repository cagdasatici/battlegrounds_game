import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { matchMaker } from "colyseus";
import { startHarness, loginClient, waitFor, players, freshCode, type Harness } from "../fixtures/harness.js";
import type { CombatEvent } from "../../packages/shared/src/protocol.js";
import { PROJECTILE_FIELDS, FORBIDDEN_STATE_FIELDS } from "../../packages/shared/src/schema.js";
import type { ArenaRoom } from "../../apps/server/src/rooms/ArenaRoom.js";
import { computeLayout } from "../../apps/client/src/input/ControlLayout.js";
import { PointerRouter } from "../../apps/client/src/input/PointerRouter.js";
import { IntentSampler } from "../../apps/client/src/input/IntentSampler.js";

/**
 * T19 wire tests with two real RoomClient connections. The Ember Artificer is T20, so no shipped definition fires a
 * projectile yet: the shot itself is a server fixture (room.projectiles.spawn, the same call the charge handler makes).
 * Everything asserted is what the clients replicate: the projectiles map, hp100 and combat events. The input lease rows
 * use the real client path (PointerRouter + IntentSampler packets) and read the server hold state the charge handler uses.
 */
let h: Harness;
beforeAll(async () => { h = await startHarness(25740); });
afterAll(async () => { await h.stop(); });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const L = computeLayout({ x0: 0, y0: 0, W: 1024, H: 768 });

async function openPair() {
  const code = freshCode();
  const a = await loginClient(h, "Arel");
  const b = await loginClient(h, "Nora");
  const ra = await a.join(code);
  const rb = await b.join(code);
  const events: CombatEvent[] = [];
  rb.onMessage("combatEvent", (e: CombatEvent) => { events.push(e); });
  const eventsA: CombatEvent[] = [];
  ra.onMessage("combatEvent", (e: CombatEvent) => { eventsA.push(e); });
  await waitFor(() => a.welcome !== null && players(ra).size === 2 && players(rb).size === 2, 3000, "joined");
  a.send("ready", { kitId: "sv", contentHash: a.localContentHash });
  b.send("ready", { kitId: "td", contentHash: b.localContentHash });
  const byName = (r: typeof rb, n: string) => [...players(r).values()].find((p) => p.displayName === n);
  await waitFor(() => byName(rb, "Arel")?.ready && byName(rb, "Nora")?.ready && byName(rb, "Arel").action === "Idle", 3000, "ready");
  const room = matchMaker.getLocalRoomById(ra.roomId) as unknown as ArenaRoom;
  const aId = byName(rb, "Arel").entityId as number, bId = byName(rb, "Nora").entityId as number;
  await waitFor(() => room.sim.tick > room.combat.get(bId)!.protectedUntilTick + 2
    && room.sim.tick > room.combat.get(aId)!.protectedUntilTick + 2 && room.movement!.get(bId)!.state.grounded, 4000, "settled");
  const put = (id: number, x: number, z: number) => {
    const y = (room.world!.groundHeight(x, z) ?? 0) + 0.9;
    const body = room.movement!.get(id)!;
    const p = { x, y, z };
    body.rb.setTranslation(p, true);
    body.rb.setNextKinematicTranslation(p);
    body.state.vx = 0; body.state.vz = 0; body.state.vy = 0;
    return y;
  };
  const projMapA = () => (ra.state as unknown as { projectiles: Map<string, Record<string, unknown>> }).projectiles;
  const projMapB = () => (rb.state as unknown as { projectiles: Map<string, Record<string, unknown>> }).projectiles;
  /** Server fixture: the call the charge handler makes at the spawn tick. */
  const shoot = (x: number, y: number, z: number, dz: number, speed: number) => room.projectiles.spawn({
    ownerId: aId, ownerOccupant: room.occupantOf(aId) ?? 0, ownerLifeId: room.combat.get(aId)!.lifeId, castCounter: 1, moveId: "ea.b3", x, y, z, dirX: 0, dirY: 0, dirZ: dz,
    speed, lifeTicks: 120, maxRange: 40, radius: 0.35, splashRadius: 2, splashMax: 4, reflectable: true,
    arcAmplitude: 0, arcSpan: 0, chargeClass: "partial", damage100: 1500, chip100: 500, block: "B", reaction: { kind: "none" },
  }, room.sim.tick);
  return { a, b, ra, rb, room, aId, bId, put, events, eventsA, byName, projMapA, projMapB, shoot };
}

describe("T19 projectile wire rows", () => {
  test("replicated projectile entity: fields, owner, cast id; the hit is one event and one hp drop seen by both clients", async () => {
    const p = await openPair();
    p.put(p.aId, -4, 9);
    const y = p.put(p.bId, -4, 1);
    await sleep(60);
    const id = p.shoot(-4, y, -4, 1, 6)!; // 6 m/s so several 20 Hz patches observe it
    expect(id).toBeGreaterThan(0);
    await waitFor(() => p.projMapB().size === 1 && p.projMapA().size === 1, 2000, "projectile replicated to both clients");
    const rec = [...p.projMapB().values()][0]!;
    expect(Object.keys(rec).sort()).toEqual([...PROJECTILE_FIELDS].sort());
    for (const f of FORBIDDEN_STATE_FIELDS) expect(Object.keys(rec).map((k) => k.toLowerCase())).not.toContain(f);
    expect([rec.entityId, rec.ownerId, rec.castId, rec.chargeClass, rec.reflectionCount]).toEqual([id, p.aId, `${p.aId}.1`, "partial", 0]);
    expect(Number(rec.remainingTicks)).toBeGreaterThan(0);
    await waitFor(() => p.byName(p.rb, "Nora").hp100 === 8500 && p.byName(p.ra, "Nora").hp100 === 8500, 4000, "hp replicated");
    await waitFor(() => p.projMapB().size === 0 && p.projMapA().size === 0, 2000, "projectile removed on impact");
    const hits = p.events.filter((e) => e.kind === "hit" && e.moveId === "ea.b3");
    expect(hits).toHaveLength(1);
    expect([hits[0]!.actorId, hits[0]!.targetId, hits[0]!.damage100]).toEqual([String(p.aId), String(p.bId), 1500]);
    expect(p.eventsA.filter((e) => e.kind === "hit" && e.moveId === "ea.b3")).toHaveLength(1);
    expect(p.room.combat.invariantViolations()).toEqual([]);
    expect(p.room.projectiles.size).toBe(0);
    await p.a.leave(); await p.b.leave();
  }, 30000);

  test("A19: a 120 m/s shot hits a free lane but is stopped by thin cover; nothing lands behind the cover", async () => {
    const p = await openPair();
    p.put(p.aId, -4, 9);
    const y = p.put(p.bId, -4, 1);
    await sleep(60);
    p.shoot(-4, y, -4, 1, 120); // free lane: control
    await waitFor(() => p.byName(p.rb, "Nora").hp100 === 8500 && p.byName(p.ra, "Nora").hp100 === 8500, 3000, "control hit replicated");
    // Cover lane: wall.0 is 0.6 m thick at x -10, z 0; B stands 1 m behind it.
    const y2 = p.put(p.bId, -10, 1);
    await waitFor(() => p.room.combat.get(p.bId)!.action === "Idle" || p.room.combat.get(p.bId)!.action === "Recovery", 2000, "B settles");
    await sleep(200);
    const before = p.events.length;
    const hpBefore = p.room.combat.get(p.bId)!.hp100;
    p.shoot(-10, y2, -4, 1, 120);
    await sleep(400);
    expect(p.room.projectiles.size).toBe(0);
    expect(p.room.combat.get(p.bId)!.hp100).toBe(hpBefore);
    expect(p.byName(p.rb, "Nora").hp100).toBe(hpBefore);
    expect(p.byName(p.ra, "Nora").hp100).toBe(hpBefore);
    expect(p.events.slice(before).filter((e) => e.moveId === "ea.b3")).toHaveLength(0);
    expect(p.projMapA().size).toBe(0);
    await p.a.leave(); await p.b.leave();
  }, 30000);

  test("hold lease over the wire: fresh packets keep the slot held, a release edge releases it, silence for 15 ticks goes stale (A11 input half)", async () => {
    const p = await openPair();
    const router = new PointerRouter(L);
    const sampler = new IntentSampler(router, p.a.welcome!.epoch);
    let seq = 0;
    const hold = () => (p.room as unknown as { pipeline: { holdOf(id: number, slot: 1 | 2 | 3 | 4, tick: number): string } }).pipeline.holdOf(p.aId, 3, p.room.sim.tick);
    const c = L.controls.skill3;
    router.down({ pointerId: 31, x: c.cx, y: c.cy });
    for (let i = 0; i < 8; i++) { p.a.send("input", sampler.sample(++seq)!); await sleep(33); }
    expect(hold()).toBe("held");
    router.up(31);
    p.a.send("input", sampler.sample(++seq)!);
    await waitFor(() => hold() === "released", 1000, "released by the next packet");
    // Hold again, then go silent: the lease lapses after 15 ticks (250 ms).
    router.down({ pointerId: 32, x: c.cx, y: c.cy });
    p.a.send("input", sampler.sample(++seq)!);
    await waitFor(() => hold() === "held", 1000, "held again");
    await waitFor(() => hold() === "stale", 1500, "stale after silence");
    router.up(32);
    await p.a.leave(); await p.b.leave();
  }, 30000);
});
