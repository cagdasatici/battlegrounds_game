import { afterEach, beforeAll, describe, expect, test } from "vitest";
import {
  BEAST, BEAST_ENTITY_ID, BEAST_MOVES, beastHp100, beastLaunch, beastSpawnDelay, inBeastZone, pickBeastMove,
} from "../../packages/shared/src/config/beast.js";
import { ARENA } from "../../packages/shared/src/config/arena.js";
import { m1Overlaps } from "../../apps/server/src/sim/M1.js";
import { BeastSystem, type BeastHost, type BeastHuman } from "../../apps/server/src/sim/BeastSystem.js";
import { CombatSystem } from "../../apps/server/src/sim/Combat.js";
import { RespawnSystem } from "../../apps/server/src/sim/RespawnSystem.js";
import { MovementSystem } from "../../apps/server/src/sim/Movement.js";
import { World, initPhysics } from "../../apps/server/src/sim/World.js";
import { BeastSchema } from "../../apps/server/src/state/ArenaSchema.js";
import { applyReaction } from "../../apps/server/src/sim/ActionMachine.js";

describe("beast config (pure)", () => {
  test("spawn delay stays inside its ranges and grows between first and later spawns", () => {
    for (const u of [0, 0.25, 0.999999, 5, -1]) {
      const a = beastSpawnDelay(u, true), b = beastSpawnDelay(u, false);
      expect(a).toBeGreaterThanOrEqual(BEAST.firstSpawnTicks[0]);
      expect(a).toBeLessThanOrEqual(BEAST.firstSpawnTicks[1]);
      expect(b).toBeGreaterThanOrEqual(BEAST.nextSpawnTicks[0]);
      expect(b).toBeLessThanOrEqual(BEAST.nextSpawnTicks[1]);
    }
    expect(Number.isInteger(beastSpawnDelay(0.3, true))).toBe(true);
  });

  test("HP scales with humans, is far above a fighter and fits the uint16 wire field", () => {
    expect(beastHp100(1)).toBeLessThan(beastHp100(3));
    expect(beastHp100(0)).toBe(beastHp100(1));
    expect(beastHp100(9)).toBe(beastHp100(3));
    for (const n of [1, 2, 3]) { expect(beastHp100(n)).toBeGreaterThanOrEqual(30000); expect(beastHp100(n)).toBeLessThanOrEqual(0xffff); }
  });

  test("attack cadence: a slam every third attack, sooner when crowded", () => {
    expect([0, 1, 2, 3, 4, 5].map((i) => pickBeastMove(i, 1))).toEqual(["beast.swipe", "beast.swipe", "beast.slam", "beast.swipe", "beast.swipe", "beast.slam"]);
    expect(pickBeastMove(1, 2)).toBe("beast.slam");
  });

  test("swipe zone is a forward cone; slam is a full circle; both have a hard reach", () => {
    const swipe = BEAST_MOVES["beast.swipe"], slam = BEAST_MOVES["beast.slam"];
    // yaw 0 faces -Z
    expect(inBeastZone(swipe, 0, 0, 0, 0, -4)).toBe(true);
    expect(inBeastZone(swipe, 0, 0, 0, 0, 4)).toBe(false); // behind
    expect(inBeastZone(swipe, 0, 0, 0, 0, -(swipe.reach + 1))).toBe(false); // beyond reach
    expect(inBeastZone(slam, 0, 0, 0, 0, 4)).toBe(true);
    expect(inBeastZone(slam, 0, 0, 0, 0, slam.reach + 1)).toBe(false);
  });

  test("the large hurtbox lets a normal M1 reach the beast from outside its body", () => {
    const attacker = { x: 0, y: 0.9, z: 0, facingYaw: 0, grounded: true };
    const farFront = { x: 0, y: 0.9, z: -3.6, facingYaw: 0, grounded: true };
    expect(m1Overlaps(attacker, farFront, null)).toBe(false); // a normal fighter this far away is missed
    expect(m1Overlaps(attacker, { ...farFront, hurtRadius: BEAST.hurtRadius, hurtHalfHeight: BEAST.hurtHalfHeight }, null)).toBe(true);
  });

  test("a throw never lands past an edge: outward throws at the rim turn toward the centre", () => {
    // Ground is the half plane x <= 0 (rim at x = 0). A human stands 1 m inside the rim; the beast is on the centre side of it.
    const probe = (x: number): number | null => (x <= 0 ? 0 : null);
    const m = BEAST_MOVES["beast.swipe"];
    const air = (2 * m.launch.up) / 24;
    for (const [tx, bx] of [[-1, -6], [-0.3, -3], [-10, -16]] as const) {
      const l = beastLaunch((x) => probe(x), m, bx, 0, tx, 0);
      expect(tx + l.vx * air).toBeLessThanOrEqual(0);
      expect(l.vy).toBe(m.launch.up);
    }
    // Plenty of room: the full forward speed is kept.
    const open = beastLaunch(() => 0, m, -2, 0, 0, 0);
    expect(Math.hypot(open.vx, open.vz)).toBeCloseTo(m.launch.forward, 5);
  });
});

// ---- system with a real world ----
let world: World;
let movement: MovementSystem;
beforeAll(async () => { await initPhysics(); });
afterEach(() => { movement?.dispose(); world?.dispose(); });

interface Rig {
  beast: BeastSystem; combat: CombatSystem; respawns: RespawnSystem; state: BeastSchema; humans: BeastHuman[];
  phases: string[]; tick: number;
  addHuman(id: number, x: number, z: number, hp?: number): void;
  /** Runs `n` ticks of: beast.update, combat expiry. Hit resolution is explicit in each test. */
  run(n: number): void;
}
async function makeRig(startTick = 0): Promise<Rig> {
  world = await World.create();
  movement = new MovementSystem(world);
  const combat = new CombatSystem(), respawns = new RespawnSystem(), state = new BeastSchema();
  const humans: BeastHuman[] = [], phases: string[] = [];
  let life = 0;
  const host: BeastHost = {
    state, combat, respawns, movement: () => movement, world: () => world, nextLifeId: () => ++life,
    registerOccupant: () => 1, releaseOccupant: () => undefined, humans: () => humans, rand: () => 0,
    onPhase: (p) => phases.push(p),
  };
  const beast = new BeastSystem(host, startTick);
  const rig: Rig = {
    beast, combat, respawns, state, humans, phases, tick: startTick,
    addHuman(id, x, z, hp = 10000) {
      combat.add(id, id, rig.tick, "sv");
      combat.get(id)!.hp100 = hp;
      movement.add(id, [x, ARENA.capsule.centreAboveSurface, z]);
      humans.push({ id, x, y: ARENA.capsule.centreAboveSurface, z, grounded: true });
    },
    run(n) {
      for (let i = 0; i < n; i++) {
        rig.tick++;
        combat.expire(rig.tick, () => true);
        beast.update(rig.tick);
      }
    },
  };
  return rig;
}
/** Spawn the beast at the first anchor and walk the clock to its first decision. */
function spawnBeast(r: Rig): void {
  r.beast.spawnAt(r.tick + 1);
  r.run(2);
  expect(r.beast.currentPhase).toBe("warning");
  r.run(BEAST.warningTicks + 1);
  expect(r.beast.currentPhase).toBe("alive");
}
const beastPos = (): [number, number, number] => movement.position(BEAST_ENTITY_ID)!;

describe("BeastSystem lifecycle and attacks", () => {
  test("waits for a human, warns, then spawns armoured with scaled HP and a hurtbox-ready body", async () => {
    const r = await makeRig();
    r.beast.spawnAt(1);
    r.run(5);
    expect(r.beast.currentPhase).toBe("none"); // nobody to fight: it does not appear
    expect(r.beast.scheduledSpawnTick).toBeGreaterThan(r.tick);
    r.addHuman(1, 0, 10);
    r.beast.spawnAt(r.tick + 1);
    r.run(2);
    expect(r.state.phase).toBe("warning");
    const warnEnd = r.state.phaseEndTick;
    r.run(warnEnd - r.tick);
    expect(r.state.phase).toBe("alive");
    const f = r.combat.get(BEAST_ENTITY_ID)!;
    expect(f.hp100).toBe(beastHp100(1));
    expect(f.armored).toBe(true);
    expect(r.state.hpMax100).toBe(beastHp100(1));
    expect(r.phases).toEqual(["warning", "spawned"]);
    // It spawned on a main island anchor, far from the human.
    expect(Math.hypot(beastPos()[0], beastPos()[2])).toBeGreaterThan(20);
  });

  test("the warning is cancelled when every human leaves", async () => {
    const r = await makeRig();
    r.addHuman(1, 0, 10);
    r.beast.spawnAt(r.tick + 1);
    r.run(2);
    expect(r.state.phase).toBe("warning");
    r.humans.length = 0;
    r.run(2);
    expect(r.state.phase).toBe("none");
    expect(r.combat.get(BEAST_ENTITY_ID)).toBeUndefined();
  });

  test("expiry: it leaves on its own after its lifetime, frees its entity and schedules the next one later", async () => {
    const r = await makeRig();
    r.addHuman(1, 0, 10);
    spawnBeast(r);
    r.run(BEAST.lifetimeTicks);
    expect(r.state.phase).toBe("none");
    expect(r.combat.get(BEAST_ENTITY_ID)).toBeUndefined();
    expect(movement.get(BEAST_ENTITY_ID)).toBeUndefined();
    expect(r.beast.scheduledSpawnTick).toBeGreaterThanOrEqual(r.tick - 5 + BEAST.nextSpawnTicks[0]);
    expect(r.phases.at(-1)).toBe("left");
  });

  test("death: defeat heals living humans, removes the entity, cancels any respawn and clears after the collapse", async () => {
    const r = await makeRig();
    r.addHuman(1, 0, 10, 4000);
    spawnBeast(r);
    r.combat.kill(BEAST_ENTITY_ID, r.tick);
    r.respawns.schedule(BEAST_ENTITY_ID, r.tick); // what the pipeline's KO bookkeeping does
    r.run(1);
    expect(r.state.phase).toBe("defeated");
    expect(r.combat.get(BEAST_ENTITY_ID)).toBeUndefined();
    expect(r.respawns.isPending(BEAST_ENTITY_ID)).toBe(false);
    expect(r.combat.get(1)!.hp100).toBe(4000 + BEAST.defeatHeal100);
    r.run(BEAST.defeatedTicks + 1);
    expect(r.state.phase).toBe("none");
    expect(r.beast.scheduledSpawnTick).toBeGreaterThan(r.tick);
  });

  /** Spawn, put one human in front of the beast, and run to the first Active tick of its first swipe. */
  async function toSwipe(humanHp = 10000, offset = 4): Promise<Rig> {
    const r = await makeRig();
    r.addHuman(1, 0, 0, humanHp); // far from every anchor so the beast spawns, then we relocate everyone
    spawnBeast(r);
    // Stand the human right in front of the beast.
    const [bx, , bz] = beastPos();
    const body = movement.get(BEAST_ENTITY_ID)!;
    body.state.facingYaw = 0; // faces -Z
    const hx = bx, hz = bz - offset;
    const hb = movement.get(1)!;
    hb.rb.setTranslation({ x: hx, y: ARENA.capsule.centreAboveSurface, z: hz }, true); hb.rb.setNextKinematicTranslation({ x: hx, y: ARENA.capsule.centreAboveSurface, z: hz });
    r.humans[0] = { id: 1, x: hx, y: ARENA.capsule.centreAboveSurface, z: hz, grounded: true };
    // Run until the cast starts, then until its active window opens.
    let guard = 0;
    while (r.combat.get(BEAST_ENTITY_ID)!.action !== "Windup" && guard++ < 400) r.run(1);
    expect(r.combat.get(BEAST_ENTITY_ID)!.action).toBe("Windup");
    expect(r.combat.get(BEAST_ENTITY_ID)!.moveId).toBe("beast.swipe");
    while (r.combat.get(BEAST_ENTITY_ID)!.action !== "Active" && guard++ < 800) r.run(1);
    return r;
  }
  const resolve = (r: Rig) => r.combat.resolve(r.tick, r.beast.candidates(r.tick), (id) => {
    const b = movement.get(id), p = movement.position(id);
    return b && p ? { x: p[0], z: p[2], facingYaw: b.state.facingYaw, grounded: true } : undefined;
  });

  test("hit: the swipe lands on a human in its cone, deals damage and ragdolls once (duplicate ticks add nothing)", async () => {
    const r = await toSwipe();
    expect(r.beast.candidates(r.tick)).toHaveLength(1);
    const first = resolve(r);
    expect(first[0]).toMatchObject({ outcome: "hit", damage100: BEAST_MOVES["beast.swipe"].damage100 });
    expect(r.combat.get(1)!.action).toBe("Ragdolled");
    expect(r.combat.get(1)!.hp100).toBe(10000 - BEAST_MOVES["beast.swipe"].damage100);
    // Later active ticks of the same cast are duplicates.
    let hits = 1;
    for (let i = 0; i < BEAST_MOVES["beast.swipe"].active - 1; i++) {
      r.run(1);
      for (const x of resolve(r)) { expect(x.outcome).toBe("duplicate"); hits += x.outcome === "hit" ? 1 : 0; }
    }
    expect(hits).toBe(1);
  });

  test("miss: a human outside the cone or beyond reach is never a candidate", async () => {
    const r = await toSwipe();
    const body = movement.get(1)!, [bx, , bz] = beastPos();
    const behind = { x: bx, y: ARENA.capsule.centreAboveSurface, z: bz + 4 }; // dodged around behind the swing
    body.rb.setTranslation(behind, true); body.rb.setNextKinematicTranslation(behind);
    r.humans[0] = { id: 1, ...behind, grounded: true };
    expect(r.beast.candidates(r.tick)).toEqual([]);
    const far = { x: bx, y: ARENA.capsule.centreAboveSurface, z: bz - (BEAST_MOVES["beast.swipe"].reach + 3) }; // or out of reach
    body.rb.setTranslation(far, true); body.rb.setNextKinematicTranslation(far);
    r.humans[0] = { id: 1, ...far, grounded: true };
    expect(r.beast.candidates(r.tick)).toEqual([]);
    expect(resolve(r)).toEqual([]);
    expect(r.combat.get(1)!.hp100).toBe(10000);
  });

  test("block: a guarding human takes only chip damage and is not thrown", async () => {
    const r = await toSwipe();
    movement.get(1)!.state.facingYaw = Math.PI; // faces the beast (yaw 0 faces -Z; the beast is toward +Z of the human)
    r.combat.updateGuard(1, r.tick - 10, true, true);
    r.combat.updateGuard(1, r.tick - 3, true, true);
    const res = resolve(r);
    expect(res[0]!.outcome).toBe("blocked");
    expect(r.combat.get(1)!.hp100).toBe(10000 - BEAST_MOVES["beast.swipe"].chip100);
    expect(r.beast.launches(r.tick, res)).toEqual([]);
  });

  test("never lethal: a human at low HP is left on at least 1 HP and still thrown", async () => {
    const r = await toSwipe(500);
    const res = resolve(r);
    expect(res[0]!.outcome).toBe("hit");
    expect(r.combat.get(1)!.hp100).toBeGreaterThanOrEqual(100);
    expect(r.combat.get(1)!.action).toBe("Ragdolled");
    const l = r.beast.launches(r.tick, res);
    expect(l).toHaveLength(1);
    expect(l[0]!.vy).toBeGreaterThan(0);
  });

  test("interruption: enough damage staggers it mid-windup and cancels the attack", async () => {
    const r = await makeRig();
    r.addHuman(1, 0, 0);
    spawnBeast(r);
    const [bx, , bz] = beastPos();
    const hb = movement.get(1)!;
    const p = { x: bx, y: ARENA.capsule.centreAboveSurface, z: bz - 4 };
    hb.rb.setTranslation(p, true); hb.rb.setNextKinematicTranslation(p);
    r.humans[0] = { id: 1, ...p, grounded: true } as BeastHuman;
    let guard = 0;
    while (r.combat.get(BEAST_ENTITY_ID)!.action !== "Windup" && guard++ < 600) r.run(1);
    const f = r.combat.get(BEAST_ENTITY_ID)!;
    expect(f.action).toBe("Windup");
    f.hp100 -= BEAST.staggerDamage100; // a burst of damage from several fighters
    r.run(1);
    expect(f.action).toBe("Stunned");
    r.run(BEAST_MOVES["beast.swipe"].startup + BEAST_MOVES["beast.swipe"].active);
    for (let t = 0; t < 5; t++) { r.run(1); expect(r.beast.candidates(r.tick)).toEqual([]); }
    r.run(BEAST.staggerTicks + 5);
    expect(["Idle", "Windup"]).toContain(f.action); // recovers and carries on
  });

  test("an external reaction cannot carry the beast: velocity is cleared every tick", async () => {
    const r = await makeRig();
    r.addHuman(1, 0, 10);
    spawnBeast(r);
    const body = movement.get(BEAST_ENTITY_ID)!;
    body.state.vx = 30; body.state.vz = -30;
    r.run(1);
    expect(body.state.vx).toBe(0);
    expect(body.state.vz).toBe(0);
    applyReaction(r.combat.get(BEAST_ENTITY_ID)!, r.tick, { kind: "ragdoll", ticks: 30 }, false); // armor-breaking effect from elsewhere
    r.run(1);
    expect(body.state.vx).toBe(0);
  });

  test("captures against the beast are discarded", () => {
    const base = { attackerId: 1, attackerGeneration: 0, castCounter: 1, hitIndex: 0, toi: 0, moveId: "x", originX: 0, originZ: 0, block: "B" as const,
      counterable: true, armorBreak: false, damage100: 0, reaction: { kind: "none" as const }, maxHitsPerTarget: 1 };
    expect(BeastSystem.capturesBeast({ ...base, targetId: BEAST_ENTITY_ID, capture: { cinematic: false, maxTicks: 30 } })).toBe(true);
    expect(BeastSystem.capturesBeast({ ...base, targetId: BEAST_ENTITY_ID })).toBe(false);
    expect(BeastSystem.capturesBeast({ ...base, targetId: 2, capture: { cinematic: false, maxTicks: 30 } })).toBe(false);
  });
});
