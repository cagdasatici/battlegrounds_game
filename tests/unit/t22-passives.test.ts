import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { ARENA } from "../../packages/shared/src/config/arena.js";
import { COMBAT } from "../../packages/shared/src/config/combat.js";
import { EA_RESET_MOVE_IDS, killRewardFor } from "../../packages/shared/src/config/passives.js";
import type { CombatEvent, KitId } from "../../packages/shared/src/protocol.js";
import { buildKitRegistry, ALL_HANDLERS } from "../../apps/server/src/kits/index.js";
import { CombatSystem } from "../../apps/server/src/sim/Combat.js";
import { OffensiveBuffer } from "../../apps/server/src/sim/OffensiveBuffer.js";
import { M1System } from "../../apps/server/src/sim/M1.js";
import { AbilityRunner, type AbilityHost } from "../../apps/server/src/sim/AbilityRunner.js";
import { AwakeningSystem } from "../../apps/server/src/sim/Awakening.js";
import { TickPipeline, type PipelineSeat } from "../../apps/server/src/sim/TickPipeline.js";
import { RespawnSystem } from "../../apps/server/src/sim/RespawnSystem.js";
import { MovementSystem } from "../../apps/server/src/sim/Movement.js";
import { World, initPhysics } from "../../apps/server/src/sim/World.js";
import type { HitCandidate } from "../../apps/server/src/sim/HitResolver.js";
import { InputChannel } from "../../apps/server/src/net/ValidateInput.js";
import { ArenaState } from "../../apps/server/src/state/ArenaSchema.js";
import { PlayerSchema } from "../../apps/server/src/state/PlayerSchema.js";

// ---- tick pipeline rig: real world, movement and combat; only hit candidates are injected ----
interface Rig {
  tick: number; world: World; movement: MovementSystem; combat: CombatSystem; respawn: RespawnSystem; state: ArenaState;
  seats: Map<string, PipelineSeat>; events: CombatEvent[]; pipe: TickPipeline; runner: AbilityRunner; aw: AwakeningSystem;
  queue: HitCandidate[]; life: number;
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
  const rig = { tick: 1000, life: 0 } as Rig;
  (runner as unknown as { collect: () => HitCandidate[] }).collect = () => queue.splice(0);
  const pipe = new TickPipeline({
    state, combat, m1, abilities: runner, awakening: aw, movement: () => movement, world: () => world, seats: () => seats,
    poseOf: (id) => host.pose(id), respawn, nextLifeId: () => ++rig.life,
    sendActionResult: () => undefined,
    broadcastEvent: (tick, kind, actor, target, lifeId, moveId, dmg, extra) => {
      events.push({ eventId: `${events.length}`, tick, kind, actorId: String(actor), lifeId, ...(target !== undefined ? { targetId: String(target) } : {}), ...(moveId ? { moveId } : {}), ...(dmg !== undefined ? { damage100: dmg } : {}), ...(extra?.targetHp100 !== undefined ? { targetHp100: extra.targetHp100 } : {}) });
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
    step(n = 1) { for (let i = 0; i < n; i++) { rig.tick++; pipe.step(rig.tick); } },
    at(t: number) { rig.tick = t - 1; rig.step(); },
    eventsOf: (kind: string) => events.filter((e) => e.kind === kind),
    pl: (id: number) => state.players.get(String(id))!,
  });
  rigs.push(rig);
  return rig;
}

const voidOut = (r: Rig, id: number, y = -30): void => { r.movement.add(id, [0, y, 0]); };
const heals = (r: Rig): CombatEvent[] => r.eventsOf("heal");
const lethal = (r: Rig, id: number): void => { r.combat.get(id)!.hp100 = 100; };

describe("T22 reward registry (pure)", () => {
  test("Duelist heal table, Artificer reset list, exclusions and kits without a kill reward", () => {
    expect(["td.b1", "td.b2", "td.b3", "td.b4", "td.a1", "td.a2", "td.a3", "td.a4", "m1.4.finisher", "dash.forward"]
      .map((m) => killRewardFor("td", m)))
      .toEqual([3500, 3000, 2000, 4000, 5000, 5000, 5000, 0, 0, 0].map((a) => (a > 0 ? { kind: "heal", amount100: a } : null)));
    expect(EA_RESET_MOVE_IDS).toEqual(["ea.b1", "ea.b2", "ea.b3", "ea.b4", "ea.a1", "ea.a2"]);
    for (const m of ["ea.b1", "ea.b2", "ea.b3", "ea.b4", "ea.a1", "ea.a2"]) expect(killRewardFor("ea", m)).toEqual({ kind: "resetCooldowns", moveIds: EA_RESET_MOVE_IDS });
    for (const m of ["ea.a3", "ea.a4", "m1.4.finisher", "dash.forward", "evasive", undefined]) expect(killRewardFor("ea", m)).toBeNull();
    expect(killRewardFor("sv", "sv.b1")).toBeNull();
    expect(killRewardFor("td", "ea.b1")).toBeNull();
    expect(killRewardFor("ea", "td.b1")).toBeNull();
  });
});

describe("T22 CombatSystem.heal", () => {
  test("clamps at full HP, reports the applied amount, ignores dead and full fighters", () => {
    const cs = new CombatSystem();
    const seen: Array<[number, number, string, number]> = [];
    cs.onHeal = (f, a, m, t) => { seen.push([f.hp100, a, m, t]); };
    const f = cs.add(1, 1, 0, "sv");
    f.hp100 = 9000;
    expect(cs.heal(f, 5000, "sv.a3", 10)).toBe(1000);
    expect(cs.heal(f, 5000, "sv.a3", 11)).toBe(0); // already full
    expect(cs.heal(f, 0, "x", 12)).toBe(0);
    expect(cs.heal(f, -5, "x", 12)).toBe(0);
    expect(seen).toEqual([[10000, 1000, "sv.a3", 10]]);
    cs.kill(1, 20);
    expect(cs.heal(f, 5000, "sv.a3", 21)).toBe(0); // death: no heal and no event
    expect(f.hp100).toBe(0);
    expect(seen).toHaveLength(1);
  });
});

describe("T22 Duelist finisher heal through the pipeline", () => {
  test("a lethal td.b1 emits one heal event with targetHp100, the move id and the healed life", async () => {
    const r = await makeRig();
    r.add(1, "td", -18, -14); r.add(2, "sv", 18, -14);
    r.combat.get(1)!.hp100 = 5000; lethal(r, 2);
    r.hit(1, 2, 500, "td.b1"); r.step();
    const h = heals(r);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ actorId: "1", targetId: "1", moveId: "td.b1", damage100: 3500, targetHp100: 8500, lifeId: r.combat.get(1)!.lifeId });
    expect(r.combat.get(1)!.hp100).toBe(8500);
    expect(r.eventsOf("ko")).toHaveLength(1);
  });

  test("the event reports the HP actually restored when the heal is clamped, and none at full HP", async () => {
    const r = await makeRig();
    r.add(1, "td", -18, -14); r.add(2, "sv", 18, -14); r.add(3, "sv", 0, 20);
    r.combat.get(1)!.hp100 = 9900; lethal(r, 2); lethal(r, 3);
    r.hit(1, 2, 500, "td.b4"); r.step();
    expect(heals(r)).toHaveLength(1);
    expect(heals(r)[0]).toMatchObject({ damage100: 100, targetHp100: 10000 });
    r.hit(1, 3, 500, "td.a1"); r.step(); // already full: the reward is spent but no event is emitted
    expect(heals(r)).toHaveLength(1);
  });

  test("once per victim life: a duplicate hit and a second killer in the same tick pay one heal; corpse hits pay nothing", async () => {
    const r = await makeRig();
    r.add(1, "td", -18, -14); r.add(2, "td", 18, -14); r.add(3, "sv", 0, 20);
    r.combat.get(1)!.hp100 = 5000; r.combat.get(2)!.hp100 = 5000; lethal(r, 3);
    r.hit(1, 3, 500, "td.b1", 0.2); r.hit(2, 3, 500, "td.b2", 0.4);
    r.queue.push(r.queue[0]!); // duplicate of the same cast and hit index
    r.step();
    expect(heals(r)).toHaveLength(1);
    expect(heals(r)[0]).toMatchObject({ actorId: "1", moveId: "td.b1" });
    expect(r.combat.get(2)!.hp100).toBe(5000);
    r.hit(2, 3, 500, "td.b2"); r.step(3); // corpse
    expect(heals(r)).toHaveLength(1);
    expect(r.eventsOf("ko")).toHaveLength(1);
  });

  test("reset on respawn: the next life of the same victim can be rewarded again, the old life cannot", async () => {
    const r = await makeRig();
    r.add(1, "td", -18, -14); r.add(2, "sv", 18, -14);
    r.combat.get(1)!.hp100 = 1000; lethal(r, 2);
    r.hit(1, 2, 500, "td.b3"); r.step();
    expect(heals(r)).toHaveLength(1);
    const oldLife = r.eventsOf("ko")[0]!.lifeId;
    expect(r.respawn.claimReward(oldLife)).toBe(false); // the dead life stays spent
    r.step(COMBAT.respawnTicks + 2);
    expect(r.combat.get(2)!.lifeId).not.toBe(oldLife);
    r.combat.get(2)!.protectedUntilTick = 0; lethal(r, 2);
    r.hit(1, 2, 500, "td.a2"); r.step();
    expect(r.eventsOf("ko")).toHaveLength(2);
    expect(heals(r)).toHaveLength(2);
    expect(heals(r)[1]).toMatchObject({ moveId: "td.a2", damage100: 5000 });
  });

  test("exclusions: td.a4, basic finisher, ring-out and an sv killer pay and emit nothing", async () => {
    const r = await makeRig();
    r.add(1, "td", -18, -14); r.add(2, "sv", 18, -14); r.add(3, "sv", 0, 20); r.add(4, "sv", 0, -20); r.add(5, "sv", 30, 30);
    r.combat.get(1)!.hp100 = 3000; r.combat.get(2)!.hp100 = 3000;
    for (const id of [3, 4, 5]) lethal(r, id);
    r.hit(1, 3, 500, "td.a4"); r.step();
    r.hit(1, 4, 500, "m1.4.finisher"); r.step();
    r.hit(2, 5, 500, "td.b1"); r.step(); // killer is sv
    expect(r.eventsOf("ko")).toHaveLength(3);
    expect(heals(r)).toHaveLength(0);
    expect([r.combat.get(1)!.hp100, r.combat.get(2)!.hp100]).toEqual([3000, 3000]);
    r.add(6, "sv", 10, 10); voidOut(r, 6); r.step();
    expect(heals(r)).toHaveLength(0);
  });

  test("death: a killer that dies first on the same tick, and a stale cast generation (interruption), pay nothing", async () => {
    const r = await makeRig();
    r.add(1, "td", -18, -14); r.add(2, "sv", 18, -14); r.add(3, "sv", 0, 20);
    r.combat.get(1)!.hp100 = 300; lethal(r, 2); lethal(r, 3);
    r.hit(2, 1, 500, "sv.b1", 0.1);
    r.hit(1, 3, 500, "td.b1", 0.3);
    r.step();
    expect(r.combat.get(1)!.hp100).toBe(0);
    expect(heals(r)).toHaveLength(0);
    r.add(4, "td", 5, 5); r.add(5, "sv", 6, 6);
    r.combat.get(4)!.hp100 = 4000; lethal(r, 5);
    r.hit(4, 5, 500, "td.b1");
    r.queue[0]!.attackerGeneration += 1;
    r.step();
    expect(r.combat.get(5)!.hp100).toBe(100);
    expect(r.combat.get(4)!.hp100).toBe(4000);
    expect(heals(r)).toHaveLength(0);
  });

  test("a detached projectile of a previous killer life heals nobody", async () => {
    const r = await makeRig();
    r.add(1, "td", -18, -14); r.add(2, "sv", 18, -14);
    r.combat.get(1)!.hp100 = 2000; lethal(r, 2);
    r.hit(1, 2, 500, "td.b3");
    r.queue[0]!.projectile = { ownerLifeId: r.combat.get(1)!.lifeId + 99 } as never;
    r.step();
    expect(r.eventsOf("ko")).toHaveLength(1);
    expect(r.combat.get(1)!.hp100).toBe(2000);
    expect(heals(r)).toHaveLength(0);
  });
});

describe("T22 Artificer cooldown reset through the pipeline", () => {
  const arm = (r: Rig, id: number): void => {
    const f = r.combat.get(id)!;
    for (const k of [...EA_RESET_MOVE_IDS, "ea.a3", "ea.a4", "evasive", "dash.forward"]) f.cooldowns.set(k, r.tick + 2000);
    f.awakenedUsedMask = 0b1000;
  };

  test.each(["ea.b1", "ea.b2", "ea.b3", "ea.b4", "ea.a1", "ea.a2"])("a lethal %s readies b1-b4 and a1-a2 at the current tick and nothing else", async (move) => {
    const r = await makeRig();
    r.add(1, "ea", -18, -14); r.add(2, "sv", 18, -14);
    arm(r, 1); lethal(r, 2);
    r.hit(1, 2, 500, move); r.step();
    const f = r.combat.get(1)!;
    for (const k of EA_RESET_MOVE_IDS) expect(f.cooldowns.get(k)).toBe(r.tick);
    for (const k of ["ea.a3", "ea.a4", "evasive", "dash.forward"]) expect(f.cooldowns.get(k)).toBeGreaterThan(r.tick);
    expect(f.awakenedUsedMask).toBe(0b1000); // once-per-form bits are never restored
    expect(heals(r)).toHaveLength(0); // a reset is not a heal
    expect(r.eventsOf("ko")).toHaveLength(1);
  });

  test("exclusions: lethal ea.a3, ea.a4, a basic finisher, a ring-out and another kit reset nothing", async () => {
    const r = await makeRig();
    r.add(1, "ea", -18, -14);
    r.add(3, "sv", 0, 20); r.add(4, "sv", 0, -20); r.add(5, "sv", 30, 30); r.add(6, "sv", 31, 31);
    arm(r, 1); for (const id of [3, 4, 5]) lethal(r, id);
    const before = new Map(r.combat.get(1)!.cooldowns);
    r.hit(1, 3, 500, "ea.a3"); r.step();
    r.hit(1, 4, 500, "ea.a4"); r.step();
    r.hit(1, 5, 500, "m1.4.finisher"); r.step();
    expect(r.eventsOf("ko")).toHaveLength(3);
    expect(r.combat.get(1)!.cooldowns).toEqual(before);
    r.add(7, "sv", 10, 10); voidOut(r, 7); r.step();
    expect(r.combat.get(1)!.cooldowns).toEqual(before);
    r.add(8, "td", 12, 12); const f8 = r.combat.get(8)!; f8.cooldowns.set("ea.b1", r.tick + 500); lethal(r, 6);
    r.hit(8, 6, 500, "ea.b1"); r.step();
    expect(f8.cooldowns.get("ea.b1")).toBeGreaterThan(r.tick);
  });

  test("one reward per victim life, to the actual killer only: later phases and a second attacker cannot reset again", async () => {
    const r = await makeRig();
    r.add(1, "ea", -18, -14); r.add(2, "ea", 18, -14); r.add(3, "sv", 0, 20);
    arm(r, 1); arm(r, 2); lethal(r, 3);
    r.hit(1, 3, 500, "ea.b1", 0.2); r.hit(2, 3, 500, "ea.b2", 0.4);
    r.step();
    expect(r.combat.get(1)!.cooldowns.get("ea.b1")).toBe(r.tick);
    expect(r.combat.get(2)!.cooldowns.get("ea.b2")).toBeGreaterThan(r.tick); // not the killer
    r.combat.get(1)!.cooldowns.set("ea.b1", r.tick + 900);
    r.hit(1, 3, 500, "ea.b1"); r.step(3);
    expect(r.combat.get(1)!.cooldowns.get("ea.b1")).toBeGreaterThan(r.tick);
  });

  test("reset on respawn: a new victim life pays again; a stale cast pays nothing", async () => {
    const r = await makeRig();
    r.add(1, "ea", -18, -14); r.add(2, "sv", 18, -14);
    arm(r, 1); lethal(r, 2);
    r.hit(1, 2, 500, "ea.a1"); r.step();
    expect(r.combat.get(1)!.cooldowns.get("ea.a2")).toBe(r.tick);
    r.step(COMBAT.respawnTicks + 2);
    r.combat.get(2)!.protectedUntilTick = 0; lethal(r, 2); arm(r, 1);
    r.hit(1, 2, 500, "ea.a2"); r.step();
    expect(r.eventsOf("ko")).toHaveLength(2);
    expect(r.combat.get(1)!.cooldowns.get("ea.b4")).toBe(r.tick);
    r.add(4, "ea", 5, 5); r.add(5, "sv", 6, 6); arm(r, 4); lethal(r, 5);
    r.hit(4, 5, 500, "ea.b3"); r.queue[0]!.attackerGeneration += 1; r.step();
    expect(r.combat.get(5)!.hp100).toBe(100);
    expect(r.combat.get(4)!.cooldowns.get("ea.b3")).toBeGreaterThan(r.tick);
  });

  test("death: an Artificer killed earlier on the same tick is not rewarded", async () => {
    const r = await makeRig();
    r.add(1, "ea", -18, -14); r.add(3, "sv", 0, 20);
    arm(r, 1); r.combat.get(1)!.hp100 = 100; lethal(r, 3);
    r.hit(3, 1, 500, "sv.b1", 0.1); r.hit(1, 3, 500, "ea.b1", 0.3);
    r.step();
    expect(r.combat.get(1)!.hp100).toBe(0);
    expect(r.combat.get(3)!.hp100).toBe(100);
    expect(r.combat.get(1)!.cooldowns.get("ea.b1")).toBeGreaterThan(r.tick);
  });
});
