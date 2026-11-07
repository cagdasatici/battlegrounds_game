import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { COMBAT } from "../../packages/shared/src/config/combat.js";
import { ARENA } from "../../packages/shared/src/config/arena.js";
import type { CombatEvent, KitId } from "../../packages/shared/src/protocol.js";
import { buildKitRegistry, ALL_HANDLERS } from "../../apps/server/src/kits/index.js";
import { CombatSystem } from "../../apps/server/src/sim/Combat.js";
import { OffensiveBuffer } from "../../apps/server/src/sim/OffensiveBuffer.js";
import { M1System } from "../../apps/server/src/sim/M1.js";
import { AbilityRunner, type AbilityHost } from "../../apps/server/src/sim/AbilityRunner.js";
import { AwakeningSystem } from "../../apps/server/src/sim/Awakening.js";
import { TickPipeline, type PipelineSeat } from "../../apps/server/src/sim/TickPipeline.js";
import { RespawnSystem, pickSpawn, finisherHeal100, type Pt } from "../../apps/server/src/sim/RespawnSystem.js";
import { MovementSystem } from "../../apps/server/src/sim/Movement.js";
import { World, initPhysics } from "../../apps/server/src/sim/World.js";
import type { HitCandidate } from "../../apps/server/src/sim/HitResolver.js";
import { InputChannel } from "../../apps/server/src/net/ValidateInput.js";
import { ArenaState } from "../../apps/server/src/state/ArenaSchema.js";
import { PlayerSchema } from "../../apps/server/src/state/PlayerSchema.js";

const anchors = ARENA.spawnAnchors.map((p, id) => ({ id, position: [...p] as [number, number, number] }));
const pt = (x: number, z: number): Pt => ({ x, z });

describe("A18 deterministic spawn choice (pure)", () => {
  test("picks the valid anchor farthest from the nearest living enemy; ties go to the lowest anchor id", () => {
    // Enemy at anchor 0 (-18,-14): farthest anchor is id 7 (46,3).
    expect(pickSpawn(anchors, [pt(-18, -14)], [], [pt(-18, -14)])).toMatchObject({ valid: true, anchor: { id: 7 } });
    // No enemies: every distance is infinite, lowest id wins.
    expect(pickSpawn(anchors, [], [], []).anchor.id).toBe(0);
    // Mirror symmetric enemy at the centre: all anchors on the +-18 ring tie only with equals; id 4 (-46,-3) is farthest first.
    const centre = pickSpawn(anchors, [pt(0, 0)], [], [pt(0, 0)]);
    expect(centre.anchor.id).toBe(4);
    expect(pickSpawn(anchors, [pt(0, 0)], [], [pt(0, 0)]).anchor.id).toBe(centre.anchor.id); // repeatable
  });

  test("rejects anchors within 2 m of an occupied capsule and inside an active hostile hit region", () => {
    const enemy = pt(-18, -14);
    // Occupy anchor 7 itself: the next farthest, id 5 (46,-3), wins (id 6 is 6 m farther south but nearer by rank).
    const occ = pickSpawn(anchors, [enemy, pt(46, 3)], [], [enemy, pt(46, 3)]);
    expect(occ.valid).toBe(true);
    expect(occ.anchor.id).not.toBe(7);
    expect(pickSpawn(anchors, [enemy, pt(46, 3.01)], [], [enemy]).anchor.id).not.toBe(7); // 0.01 m away: still rejected
    expect(pickSpawn(anchors, [enemy, pt(46, 5.0)], [], [enemy]).anchor.id).toBe(7); // exactly 2 m: allowed
    const hot = pickSpawn(anchors, [enemy], [{ x: 46, z: 3, r: 2 }], [enemy]);
    expect(hot.valid).toBe(true);
    expect(hot.anchor.id).not.toBe(7);
  });

  test("fallback: when no anchor qualifies, the farthest anchor is returned and flagged invalid", () => {
    const all = anchors.map((a) => pt(a.position[0], a.position[2]));
    const r = pickSpawn(anchors, all, [], all);
    expect(r.valid).toBe(false);
    expect(r.anchor.id).toBe(0); // every enemy stands on an anchor: all distances 0, lowest id
    const far = pickSpawn(anchors, all, [], [pt(-18, -14)]);
    expect(far).toMatchObject({ valid: false, anchor: { id: 7 } });
  });
});

describe("RespawnSystem scoring (pure)", () => {
  test("assist threshold at 19.99 vs 20 HP and the 480 tick window", () => {
    const r = new RespawnSystem();
    r.recordDamage(2, 9, 100, 1999);
    expect(r.resolveKo(9, 200, 1)).toEqual({ scorer: 1, assists: [] });
    r.recordDamage(2, 9, 100, 2000);
    expect(r.resolveKo(9, 200, 1)).toEqual({ scorer: 1, assists: [2] });
    r.recordDamage(2, 9, 100, 1000); r.recordDamage(2, 9, 150, 1000);
    expect(r.resolveKo(9, 200, 1).assists).toEqual([2]); // sums across hits
    r.recordDamage(2, 9, 100, 2000);
    expect(r.resolveKo(9, 580, 1).assists).toEqual([2]); // age 480 still counts
    r.recordDamage(2, 9, 100, 2000);
    expect(r.resolveKo(9, 581, 1).assists).toEqual([]); // age 481 is trimmed
  });

  test("ring-out credits the most recent hostile attacker within 480 ticks, otherwise nobody; no assists without a scorer", () => {
    const r = new RespawnSystem();
    r.recordDamage(1, 9, 100, 3000); r.recordDamage(2, 9, 300, 3000);
    expect(r.resolveKo(9, 400, undefined)).toEqual({ scorer: 2, assists: [1] });
    r.recordDamage(1, 9, 100, 3000);
    expect(r.resolveKo(9, 581, undefined)).toEqual({ scorer: undefined, assists: [] });
    expect(r.resolveKo(9, 600, undefined)).toEqual({ scorer: undefined, assists: [] });
  });

  test("combat timer: 480 quiet ticks, dealing or taking damage restarts it", () => {
    const r = new RespawnSystem();
    expect(r.inCombat(1, 0)).toBe(false);
    r.recordDamage(1, 2, 1000, 100);
    expect(r.inCombat(1, 1479)).toBe(true);
    expect(r.inCombat(2, 1479)).toBe(true);
    expect(r.inCombat(1, 1480)).toBe(false);
    r.forget(1);
    expect(r.inCombat(1, 1000)).toBe(false);
  });

  test("finisher passive table: Duelist only, a4 and unknown moves zero", () => {
    expect(["td.b1", "td.b2", "td.b3", "td.b4", "td.a1", "td.a2", "td.a3", "td.a4", "m1.4.finisher"].map((m) => finisherHeal100("td", m)))
      .toEqual([3500, 3000, 2000, 4000, 5000, 5000, 5000, 0, 0]);
    expect(finisherHeal100("sv", "td.b1")).toBe(0);
  });
});

// ---- tick pipeline rig: real world, movement and combat; only hit candidates are injected ----
interface Rig {
  tick: number; world: World; movement: MovementSystem; combat: CombatSystem; respawn: RespawnSystem; state: ArenaState;
  seats: Map<string, PipelineSeat>; events: CombatEvent[]; pipe: TickPipeline; runner: AbilityRunner; aw: AwakeningSystem;
  queue: HitCandidate[]; life: number;
  occupants: Map<number, number>;
  /** GR02: queue a detached projectile hit stamped with the given owner occupant and life. */
  projectileHit(attacker: number, ownerOccupant: number, ownerLifeId: number, target: number, damage100: number, moveId?: string): void;
  add(id: number, kit: KitId, x: number, z: number): void;
  hit(attacker: number, target: number, damage100: number, moveId?: string, toi?: number): void;
  step(n?: number): void;
  at(t: number): void;
  eventsOf(kind: string): CombatEvent[];
  pl(id: number): PlayerSchema;
}
const rigs: Rig[] = [];
beforeAll(async () => { await initPhysics(); });
afterEach(() => { for (const r of rigs.splice(0)) { r.movement.dispose(); r.world.dispose(); } });

async function makeRig(): Promise<Rig> {
  const world = await World.create();
  const movement = new MovementSystem(world);
  const combat = new CombatSystem();
  const buffer = new OffensiveBuffer();
  const m1 = new M1System(buffer);
  const host: AbilityHost = {
    combat, pose: (id) => { const b = movement.get(id), p = movement.position(id); return b && p ? { x: p[0], y: p[1], z: p[2], facingYaw: b.state.facingYaw, grounded: b.state.grounded } : undefined; },
    blocked: () => false,
  };
  const aw = new AwakeningSystem(host);
  const runner = new AbilityRunner(buildKitRegistry(), ALL_HANDLERS, host, buffer);
  const state = new ArenaState();
  const respawn = new RespawnSystem();
  const seats = new Map<string, PipelineSeat>();
  const events: CombatEvent[] = [];
  const queue: HitCandidate[] = [];
  const rig = { tick: 1000, life: 0, occupants: new Map<number, number>() } as Rig;
  (runner as unknown as { collect: () => HitCandidate[] }).collect = () => queue.splice(0);
  const pipe = new TickPipeline({
    state, combat, m1, abilities: runner, awakening: aw, movement: () => movement, world: () => world, seats: () => seats,
    poseOf: (id) => host.pose(id), occupantOf: (id) => rig.occupants.get(id) ?? 0, respawn, nextLifeId: () => ++rig.life,
    sendActionResult: () => undefined,
    broadcastEvent: (tick, kind, actor, target, lifeId, moveId, dmg) => {
      events.push({ eventId: `${events.length}`, tick, kind, actorId: String(actor), lifeId, ...(target !== undefined ? { targetId: String(target) } : {}), ...(moveId ? { moveId } : {}), ...(dmg !== undefined ? { damage100: dmg } : {}) });
    },
  });
  Object.assign(rig, {
    world, movement, combat, respawn, state, seats, events, pipe, runner, aw, queue,
    add(id: number, kit: KitId, x: number, z: number) {
      const p = new PlayerSchema();
      p.entityId = id; p.lifeId = ++rig.life; p.kitId = kit;
      state.players.set(String(id), p);
      const f = combat.add(id, p.lifeId, rig.tick, kit);
      f.protectedUntilTick = 0;
      respawn.startLife(id, rig.tick);
      movement.add(id, [x, (world.groundHeight(x, z) ?? 0) + ARENA.capsule.centreAboveSurface, z]);
      seats.set(`s${id}`, { entityId: id, input: new InputChannel(0), pendingKit: null });
      pipe.publishBody(id);
    },
    hit(attacker: number, target: number, damage100: number, moveId = "td.b1", toi = 0.5) {
      const ap = movement.position(attacker)!;
      const f = combat.get(attacker)!;
      queue.push({
        attackerId: attacker, attackerGeneration: f.generation, castCounter: ++f.castCounter, hitIndex: 0, toi, targetId: target, moveId,
        originX: ap[0], originZ: ap[2], block: "U", counterable: false, armorBreak: false, damage100,
        reaction: { kind: "none" }, maxHitsPerTarget: 1,
      });
    },
    projectileHit(attacker: number, ownerOccupant: number, ownerLifeId: number, target: number, damage100: number, moveId = "td.b1") {
      const ap = movement.position(attacker)!;
      queue.push({
        attackerId: attacker, attackerGeneration: 0, castCounter: -(queue.length + 1), hitIndex: 0, toi: 0.5, targetId: target, moveId,
        originX: ap[0], originZ: ap[2], block: "U", counterable: true, armorBreak: false, damage100,
        reaction: { kind: "none" }, maxHitsPerTarget: 1, projectile: { id: queue.length + 1, reflectable: true, ownerLifeId, ownerOccupant },
      });
    },
    step(n = 1) { for (let i = 0; i < n; i++) { rig.tick++; pipe.step(rig.tick); } },
    at(t: number) { rig.tick = t - 1; rig.step(); },
    eventsOf: (kind: string) => events.filter((e) => e.kind === kind),
    pl: (id: number) => state.players.get(String(id))!,
  });
  rigs.push(rig);
  return rig;
}
const voidOut = (r: Rig, id: number, y = -30): void => { r.movement.add(id, [0, y, 0]); };

describe("A13 lethal hit plus another hit in the same tick", () => {
  test("one KO, one passive reward, no negative HP", async () => {
    const r = await makeRig();
    r.add(1, "td", -18, -14); r.add(2, "td", 18, -14); r.add(3, "sv", 0, 20);
    r.combat.get(1)!.hp100 = 5000; r.combat.get(2)!.hp100 = 5000;
    r.combat.get(3)!.hp100 = 100;
    r.hit(1, 3, 500, "td.b1", 0.2); r.hit(2, 3, 500, "td.b2", 0.4); // both lethal; resolver order picks entity 1
    r.step();
    expect(r.eventsOf("ko")).toHaveLength(1);
    expect(r.eventsOf("ko")[0]).toMatchObject({ actorId: "1", targetId: "3", moveId: "td.b1" });
    expect(r.combat.get(3)!.hp100).toBe(0);
    expect(r.combat.get(3)!.koCount).toBe(1);
    expect([r.pl(1).kills, r.pl(2).kills, r.pl(3).deaths]).toEqual([1, 0, 1]);
    expect(r.combat.get(1)!.hp100).toBe(8500); // td.b1 finisher heal 35 HP, once
    expect(r.combat.get(2)!.hp100).toBe(5000); // the second hit is a deadTarget: no heal, no assist credit
    expect(r.pl(2).assists).toBe(0);
    // Later hits at the corpse do nothing.
    r.hit(2, 3, 500, "td.b2"); r.step(2);
    expect(r.eventsOf("ko")).toHaveLength(1);
    expect(r.combat.get(1)!.hp100).toBe(8500);
    expect(r.pl(3).hp100).toBe(0);
  });

  test("the passive is clamped at full HP, ignores sv, and an a4 or basic finisher pays zero", async () => {
    const r = await makeRig();
    r.add(1, "td", -18, -14); r.add(2, "sv", 18, -14); r.add(3, "sv", 0, 20); r.add(4, "sv", 0, -20);
    r.combat.get(1)!.hp100 = 9900; r.combat.get(2)!.hp100 = 5000; r.combat.get(3)!.hp100 = 100; r.combat.get(4)!.hp100 = 100;
    r.hit(1, 3, 500, "td.b4"); r.step();
    expect(r.combat.get(1)!.hp100).toBe(10000);
    r.hit(2, 4, 500, "td.b1"); r.step(); // sv killer: no Duelist passive
    expect(r.combat.get(2)!.hp100).toBe(5000);
  });

  test("a duplicate hit is recorded once: attribution holds 19.99 HP, so no assist", async () => {
    const r = await makeRig();
    r.add(1, "sv", -18, -14); r.add(2, "sv", 18, -14); r.add(3, "sv", 0, 20);
    r.hit(1, 3, 1999);
    r.queue.push({ ...r.queue[0]!, toi: 0.6 }); // same cast counter: the ledger rejects it as a duplicate
    r.step();
    expect(r.combat.get(3)!.hp100).toBe(COMBAT.hp100Max - 1999);
    r.hit(2, 3, 100000); r.step();
    expect(r.eventsOf("ko")).toHaveLength(1);
    expect([r.pl(1).assists, r.pl(2).kills]).toEqual([0, 1]);
    expect(r.combat.invariantViolations()).toEqual([]);
  });

  test("a hit on a protected victim deals nothing and starts no combat timer", async () => {
    const r = await makeRig();
    r.add(1, "sv", -18, -14); r.add(3, "sv", 0, 20);
    const spawn = r.tick;
    r.combat.get(3)!.protectedUntilTick = r.tick + 100;
    r.hit(1, 3, 500); r.step();
    expect(r.combat.get(3)!.hp100).toBe(COMBAT.hp100Max);
    expect(r.respawn.inCombat(3, spawn + COMBAT.assistWindowTicks)).toBe(false); // the blocked hit did not restart the timer
  });
});

describe("respawn timing and safety (T17)", () => {
  test("a KO respawns exactly 180 ticks later with full HP, a new life, protection and a respawn event", async () => {
    const r = await makeRig();
    r.add(1, "td", -18, -14); r.add(2, "sv", 18, -14);
    const oldLife = r.combat.get(2)!.lifeId;
    r.combat.get(2)!.hp100 = 100;
    r.hit(1, 2, 500);
    r.step();
    const t0 = r.tick;
    expect(r.combat.get(2)!.action).toBe("Dead");
    r.at(t0 + COMBAT.respawnTicks - 1);
    expect(r.combat.get(2)!.action).toBe("Dead");
    expect(r.eventsOf("respawn")).toHaveLength(0);
    r.at(t0 + COMBAT.respawnTicks);
    const f = r.combat.get(2)!;
    expect(f.action).toBe("Idle");
    expect(f.hp100).toBe(COMBAT.hp100Max);
    expect(f.lifeId).not.toBe(oldLife);
    expect(f.koCount).toBe(0);
    expect(f.protectedUntilTick).toBe(r.tick + COMBAT.spawnProtectionTicks);
    expect(r.pl(2).lifeId).toBe(f.lifeId);
    expect(r.pl(2).hp100).toBe(COMBAT.hp100Max);
    expect(r.eventsOf("respawn")).toHaveLength(1);
    expect(r.eventsOf("respawn")[0]).toMatchObject({ actorId: "2", lifeId: f.lifeId, tick: r.tick });
    // Chosen anchor: farthest from the living enemy at anchor 0 is id 7 (46,3).
    const pos = r.movement.position(2)!;
    expect([Math.round(pos[0]), Math.round(pos[2])]).toEqual([46, 3]);
    // The first life's KO cannot be repeated.
    r.step(5);
    expect(r.eventsOf("ko")).toHaveLength(1);
  });

  test("protection is cancelled by an offensive request and blocks damage until then", async () => {
    const r = await makeRig();
    r.add(1, "td", -18, -14); r.add(2, "sv", 18, -14);
    r.combat.get(2)!.hp100 = 100; r.hit(1, 2, 500); r.step();
    r.at(r.tick + COMBAT.respawnTicks);
    const f = r.combat.get(2)!;
    expect(r.tick < f.protectedUntilTick).toBe(true);
    r.hit(1, 2, 500); r.step();
    expect(f.hp100).toBe(COMBAT.hp100Max); // protected from damage
    expect(r.combat.requestDash(2, r.tick, 0, 0, -1).ok).toBe(true); // offensive request
    expect(f.protectedUntilTick).toBeLessThanOrEqual(r.tick);
  });

  test("A18 pipeline: an active hostile hit region at the best anchor moves the spawn to the next best", async () => {
    const r = await makeRig();
    r.add(1, "td", -18, -14); r.add(2, "sv", 18, -14);
    r.combat.get(2)!.hp100 = 100; r.hit(1, 2, 500); r.step();
    const due = r.tick + COMBAT.respawnTicks - 1;
    r.at(due);
    // The attacker stands at anchor 7's x/z while swinging on the respawn tick.
    r.movement.add(1, [46, 0.9 + (r.world.groundHeight(46, 3) ?? 0), 3]);
    r.hit(1, 2, 500);
    r.step();
    expect(r.combat.get(2)!.action).toBe("Idle");
    const pos = r.movement.position(2)!;
    expect(`${Math.round(pos[0])},${Math.round(pos[2])}`).not.toBe("46,3");
  });

  test("A18 fallback: with every anchor occupied it waits 60 ticks, then spawns at the farthest anchor with protection", async () => {
    const r = await makeRig();
    anchors.forEach((a, i) => r.add(10 + i, "sv", a.position[0], a.position[2]));
    r.add(1, "sv", 0, 30);
    r.combat.get(1)!.hp100 = 100;
    r.hit(10, 1, 500); r.step();
    const t0 = r.tick;
    const due = t0 + COMBAT.respawnTicks;
    r.at(due + 59);
    expect(r.combat.get(1)!.action).toBe("Dead");
    r.at(due + 60);
    const f = r.combat.get(1)!;
    expect(f.action).toBe("Idle");
    expect(f.protectedUntilTick).toBe(due + 60 + COMBAT.spawnProtectionTicks);
    const pos = r.movement.position(1)!;
    expect([Math.round(pos[0]), Math.round(pos[2])]).toEqual([-18, -14]); // all enemies on anchors: lowest id
  });

  test("a valid anchor freed during the retry window is used before the 60 ticks end", async () => {
    const r = await makeRig();
    anchors.forEach((a, i) => r.add(10 + i, "sv", a.position[0], a.position[2]));
    r.add(1, "sv", 0, 30);
    r.combat.get(1)!.hp100 = 100;
    r.hit(10, 1, 500); r.step();
    const due = r.tick + COMBAT.respawnTicks;
    r.at(due + 10);
    expect(r.combat.get(1)!.action).toBe("Dead");
    r.movement.remove(17); // enemy standing on anchor 7 leaves... movement body gone
    r.combat.remove(17, r.tick);
    r.step();
    expect(r.combat.get(1)!.action).toBe("Idle");
    const pos = r.movement.position(1)!;
    expect([Math.round(pos[0]), Math.round(pos[2])]).toEqual([46, 3]);
  });

  test("leaving during the countdown forgets the respawn; nothing spawns later", async () => {
    const r = await makeRig();
    r.add(1, "td", -18, -14); r.add(2, "sv", 18, -14);
    r.combat.get(2)!.hp100 = 100; r.hit(1, 2, 500); r.step();
    expect(r.respawn.isPending(2)).toBe(true);
    r.combat.remove(2, r.tick); r.movement.remove(2); r.respawn.forget(2); r.seats.delete("s2"); r.state.players.delete("2");
    r.step(COMBAT.respawnTicks + 5);
    expect(r.eventsOf("respawn")).toHaveLength(0);
    expect(r.movement.position(2)).toBeNull();
  });
});

describe("ring-outs and scoring through the pipeline (T17)", () => {
  test("void KO credits the most recent hostile attacker inside 480 ticks; assists need 20 HP", async () => {
    const r = await makeRig();
    r.add(1, "sv", -18, -14); r.add(2, "sv", 18, -14); r.add(3, "sv", 0, 20);
    r.hit(1, 3, 1999); r.step();
    r.hit(2, 3, 100); r.step();
    voidOut(r, 3);
    r.step();
    expect(r.eventsOf("ko")).toHaveLength(1);
    expect(r.eventsOf("ko")[0]).toMatchObject({ actorId: "2", targetId: "3" });
    expect([r.pl(1).kills, r.pl(2).kills, r.pl(3).deaths]).toEqual([0, 1, 1]);
    expect(r.pl(1).assists).toBe(0); // 19.99 HP
    r.step(); // dead bodies below the void are not killed again
    expect(r.eventsOf("ko")).toHaveLength(1);
  });

  test("assist at exactly 20 HP is awarded; the scorer never gets an assist", async () => {
    const r = await makeRig();
    r.add(1, "sv", -18, -14); r.add(2, "sv", 18, -14); r.add(3, "sv", 0, 20);
    r.hit(1, 3, 2000); r.step();
    r.hit(2, 3, 100000); r.step();
    expect(r.eventsOf("ko")[0]).toMatchObject({ actorId: "2" });
    expect([r.pl(1).assists, r.pl(2).assists, r.pl(2).kills]).toEqual([1, 0, 1]);
  });

  test("a ring-out after the 480 tick window credits nobody; the victim still dies once", async () => {
    const r = await makeRig();
    r.add(1, "sv", -18, -14); r.add(3, "sv", 0, 20);
    r.hit(1, 3, 500); r.step();
    r.step(COMBAT.assistWindowTicks + 1);
    voidOut(r, 3);
    r.step();
    expect(r.eventsOf("ko")).toHaveLength(1);
    expect(r.eventsOf("ko")[0]).toMatchObject({ actorId: "3", targetId: "3" });
    expect([r.pl(1).kills, r.pl(3).deaths]).toEqual([0, 1]);
  });

  test("the 90 m horizontal boundary is a KO too, once per life", async () => {
    const r = await makeRig();
    r.add(1, "sv", -18, -14); r.add(3, "sv", 0, 20);
    r.movement.add(3, [95, 5, 0]);
    r.step();
    expect(r.eventsOf("ko")).toHaveLength(1);
    expect(r.pl(3).deaths).toBe(1);
    r.step(3);
    expect(r.eventsOf("ko")).toHaveLength(1);
  });

  test("damage KO and void in the same tick: the damage resolves first, only one KO", async () => {
    const r = await makeRig();
    r.add(1, "sv", -18, -14); r.add(3, "sv", 0, 20);
    r.combat.get(3)!.hp100 = 100;
    r.hit(1, 3, 500);
    voidOut(r, 3);
    r.step();
    expect(r.eventsOf("ko")).toHaveLength(1);
    expect(r.eventsOf("ko")[0]).toMatchObject({ actorId: "1" });
    expect(r.pl(3).deaths).toBe(1);
  });

  test("a new life starts with a clean attribution ledger", async () => {
    const r = await makeRig();
    r.add(1, "sv", -18, -14); r.add(3, "sv", 0, 20);
    r.hit(1, 3, 3000); r.step();
    voidOut(r, 3); r.step(); // KO 1 credits 1
    r.step(COMBAT.respawnTicks);
    expect(r.combat.get(3)!.action).toBe("Idle");
    voidOut(r, 3);
    r.step(COMBAT.assistWindowTicks); // quiet; but a ledger carried over would still be inside 480 ticks only at the start
    expect(r.pl(1).kills).toBe(1);
  });
});

describe("kit change (T17)", () => {
  async function two() {
    const r = await makeRig();
    r.add(1, "sv", -18, -14); r.add(2, "sv", 18, -14);
    return r;
  }
  const seatOf = (r: Rig, id: number): PipelineSeat => r.seats.get(`s${id}`)!;

  test("in combat the new kit waits for the next respawn, which switches abilities, awakening threshold and replicated kit together", async () => {
    const r = await two();
    r.hit(1, 2, 300); r.step(); // 2 is now in combat
    seatOf(r, 2).pendingKit = "td"; r.pl(2).owner.pendingKit = "td";
    r.step(120);
    expect(r.combat.get(2)!.kitId).toBe("sv");
    expect(r.pl(2).kitId).toBe("sv");
    r.combat.get(2)!.hp100 = 100; r.hit(1, 2, 500); r.step();
    r.at(r.tick + COMBAT.respawnTicks);
    expect(r.combat.get(2)!.kitId).toBe("td");
    expect(r.runner.kitOf(2)).toBe("td");
    expect(r.pl(2).kitId).toBe("td");
    expect(r.pl(2).owner.pendingKit).toBe("");
    expect(seatOf(r, 2).pendingKit).toBeNull();
    expect(r.combat.get(2)!.hp100).toBe(COMBAT.hp100Max);
  });

  test("out of combat the kit applies after 480 quiet ticks, resets meter and cooldowns, and never heals", async () => {
    const r = await two();
    const f = r.combat.get(2)!;
    const spawn = r.tick;
    f.hp100 = 5000; f.meter100 = 12345; f.cooldowns.set("dash.forward", r.tick + 9999);
    r.hit(1, 2, 0); // no damage: does not start the combat timer
    seatOf(r, 2).pendingKit = "td";
    r.at(spawn + COMBAT.assistWindowTicks - 1);
    expect(f.kitId).toBe("sv"); // a fresh spawn is not yet 8 quiet seconds
    r.at(spawn + COMBAT.assistWindowTicks);
    expect(f.kitId).toBe("td");
    expect([f.hp100, f.meter100, f.cooldowns.size]).toEqual([5000, 0, 0]);
    expect(seatOf(r, 2).pendingKit).toBeNull();
  });

  test("dealing or taking damage restarts the 480 tick wait; a change after it applies without respawn", async () => {
    const r = await two();
    r.hit(1, 2, 100); r.step();
    const hitTick = r.tick;
    seatOf(r, 1).pendingKit = "td"; seatOf(r, 2).pendingKit = "td";
    r.at(hitTick + COMBAT.assistWindowTicks - 1);
    expect([r.combat.get(1)!.kitId, r.combat.get(2)!.kitId]).toEqual(["sv", "sv"]);
    r.at(hitTick + COMBAT.assistWindowTicks);
    expect([r.combat.get(1)!.kitId, r.combat.get(2)!.kitId]).toEqual(["td", "td"]);
    expect(r.combat.get(2)!.hp100).toBe(COMBAT.hp100Max - 100);
  });

  test("an awakened or mid action fighter keeps its kit; the request stays queued and nothing is consumed", async () => {
    const r = await two();
    const f = r.combat.get(2)!;
    f.form = "Awakened"; f.meter100 = 0;
    seatOf(r, 2).pendingKit = "td";
    r.step(5);
    expect(f.kitId).toBe("sv");
    expect(f.form).toBe("Awakened");
    expect(seatOf(r, 2).pendingKit).toBe("td");
  });

  test("asking for the current kit clears the queued change", async () => {
    const r = await two();
    seatOf(r, 2).pendingKit = "sv";
    r.step();
    expect(seatOf(r, 2).pendingKit).toBeNull();
  });
});

describe("GR02 detached projectile ownership across id reuse", () => {
  test("a replacement occupant of the owner id is a damageable target, not a self hit, and earns nothing", async () => {
    const r = await makeRig();
    r.add(1, "td", -18, -14); r.add(2, "sv", 18, -14); r.add(3, "sv", 0, 20);
    const oldLife = r.combat.get(1)!.lifeId;
    r.occupants.set(1, 2); // id 1 now belongs to a second occupant; the shot was fired by occupant 1
    r.combat.get(1)!.hp100 = 5000; r.combat.get(2)!.hp100 = 100;
    r.projectileHit(1, 1, oldLife, 1, 1500);
    r.step();
    expect(r.combat.get(1)!.hp100).toBe(3500); // the new occupant takes the damage
    expect(r.eventsOf("hit")[0]).toMatchObject({ actorId: "1", targetId: "1" }); // absent attacker reports the victim, never a name
    r.projectileHit(1, 1, oldLife, 2, 500, "td.b1");
    r.step();
    expect(r.combat.get(2)!.hp100).toBe(0);
    expect([r.pl(1).kills, r.pl(1).assists, r.pl(2).deaths]).toEqual([0, 0, 1]);
    expect(r.combat.get(1)!.hp100).toBe(3500); // no finisher heal for the new occupant
    expect(r.eventsOf("ko")[0]).toMatchObject({ targetId: "2", actorId: "2" }); // environmental scorer fallback
  });

  test("departed owner damage never enters the attribution ledger, so no later KO yields an assist to the replacement", async () => {
    const r = await makeRig();
    r.add(1, "td", -18, -14); r.add(2, "sv", 18, -14); r.add(3, "sv", 0, 20);
    const oldLife = r.combat.get(1)!.lifeId;
    r.occupants.set(1, 2);
    r.projectileHit(1, 1, oldLife, 3, 3000); r.step(); // would be a 30 HP assist if credited
    r.hit(2, 3, 7000, "sv.b1"); r.step();
    expect(r.pl(3).deaths).toBe(1);
    expect([r.pl(1).assists, r.pl(1).kills, r.pl(2).kills]).toEqual([0, 0, 1]);
  });

  test("the same occupant that died and respawned still earns the posthumous KO, but no heal", async () => {
    const r = await makeRig();
    r.add(1, "td", -18, -14); r.add(2, "sv", 18, -14);
    r.occupants.set(1, 1);
    const oldLife = r.combat.get(1)!.lifeId;
    r.combat.kill(1, r.tick); r.runner.reset(1);
    r.combat.respawn(1, r.tick, 99); r.combat.get(1)!.protectedUntilTick = 0;
    r.combat.get(1)!.hp100 = 5000; r.combat.get(2)!.hp100 = 100;
    r.projectileHit(1, 1, oldLife, 2, 500);
    r.step();
    expect(r.pl(1).kills).toBe(1);
    expect(r.combat.get(1)!.hp100).toBe(5000); // td.b1 finisher heal needs the firing life
    expect(r.combat.get(1)!.meter100).toBe(0);
  });

  test("owner dead and gone with no replacement: the shot still lands and nobody is credited", async () => {
    const r = await makeRig();
    r.add(1, "td", -18, -14); r.add(2, "sv", 18, -14);
    const oldLife = r.combat.get(1)!.lifeId;
    r.occupants.delete(1); r.combat.remove(1, r.tick);
    r.combat.get(2)!.hp100 = 1500;
    r.projectileHit(1, 1, oldLife, 2, 1500);
    r.step();
    expect(r.combat.get(2)!.hp100).toBe(0);
    expect(r.pl(2).deaths).toBe(1);
    expect(r.eventsOf("ko")[0]).toMatchObject({ targetId: "2", actorId: "2" });
  });
});
