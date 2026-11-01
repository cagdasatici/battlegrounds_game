import { afterEach, describe, expect, test } from "vitest";
import { AbilityDefSchema, buildAbilityRegistry, defineAbility } from "../../packages/shared/src/abilities.js";
import { ALL_ABILITY_DEFS } from "../../packages/shared/src/config/kits/index.js";
import { ALL_HANDLERS } from "../../apps/server/src/kits/index.js";
import { applyReaction } from "../../apps/server/src/sim/ActionMachine.js";
import { MAX_PROJECTILES } from "../../apps/server/src/sim/Projectiles.js";
import { MovementSystem } from "../../apps/server/src/sim/Movement.js";
import { resolveHits, HitLedger, type HitCandidate } from "../../apps/server/src/sim/HitResolver.js";
import { CaptureRegistry } from "../../apps/server/src/sim/CaptureRegistry.js";
import { createFighter } from "../../apps/server/src/sim/ActionMachine.js";
import { MELEE_HANDLER, AbilityRunner, type AbilityHandler } from "../../apps/server/src/sim/AbilityRunner.js";
import { CombatSystem } from "../../apps/server/src/sim/Combat.js";
import { World } from "../../apps/server/src/sim/World.js";
import { flatMap, makeRig, orbDef, ORB_SPEC, type Rig } from "../fixtures/projectileRig.js";

const T0 = 100;
let rig: Rig | null = null;
afterEach(() => { rig?.dispose(); rig = null; });
const make = async (o?: Parameters<typeof makeRig>[0]) => (rig = await makeRig(o));

/** Presses slot 3 at T0 holding it, releases (held slot 0) at T0 + heldTicks and runs until `until`. */
function charge(r: Rig, heldTicks: number, until: number, guard: readonly number[] = []) {
  r.input.heldSlot = 3;
  r.step(T0, { press: [{ id: 1, slot: 3 }], guard });
  for (let t = T0 + 1; t < T0 + heldTicks; t++) r.step(t, { guard });
  r.input.heldSlot = 0;
  for (let t = T0 + heldTicks; t <= until; t++) r.step(t, { guard });
}

describe("T19 definition: projectile block and holdRelease", () => {
  test("the Ember Orb numbers validate and form a registry with the chargeProjectile handler", () => {
    const d = orbDef();
    expect([d.slot, d.form, d.input, d.handler]).toEqual([3, "Base", "holdRelease", "chargeProjectile"]);
    expect([d.startup, d.active, d.recovery, d.cooldown]).toEqual([6, 1, 24, 1500]);
    expect(d.damage100).toEqual([1500]);
    expect(d.projectile).toMatchObject({ speed: 24, lifeTicks: 120, maxRange: 40, radius: 0.35, splashRadius: 2, splashMax: 4, chargeMaxTicks: 180, fullDamage100: 2500, chip100: 500 });
    const reg = buildAbilityRegistry([...ALL_ABILITY_DEFS.filter((x) => x.id !== d.id), d], new Set(ALL_HANDLERS.map((h) => h.name)));
    expect(reg.slotted("ea", "Base", 3)?.id).toBe("ea.b3");
  });
  test("the projectile block is strict: unknown keys and bad numbers fail", () => {
    const raw = { ...orbDef(), projectile: { ...orbDef().projectile, extra: 1 } };
    expect(() => AbilityDefSchema.parse(raw)).toThrow();
    expect(() => defineAbility({ ...ORB_SPEC, projectile: { ...ORB_SPEC.projectile!, speed: -1 } })).toThrow();
    expect(() => defineAbility({ ...ORB_SPEC, projectile: { ...ORB_SPEC.projectile!, lifeTicks: 0 } })).toThrow();
  });
  test("a chargeProjectile definition without a projectile block throws when cast", async () => {
    const r = await make({ defs: [defineAbility({ ...ORB_SPEC, projectile: undefined })] });
    r.input.heldSlot = 3;
    expect(() => r.step(T0, { press: [{ id: 1, slot: 3 }] })).toThrow(/projectile block/);
  });
  test("T20 ships the Ember Orb: ea.b3 is in the shipped registry and the rig default is that very definition", () => {
    const shipped = ALL_ABILITY_DEFS.find((d) => d.id === "ea.b3")!;
    expect(shipped.label).toBe("Ember Orb");
    expect(orbDef()).toBe(shipped);
    expect(ALL_ABILITY_DEFS.filter((d) => d.id.startsWith("ea.") && !/^ea\.(wall|pickup|throw)$/.test(d.id)).map((d) => d.id)).toEqual(["ea.b1", "ea.b2", "ea.b3", "ea.b4"]);
  });
});

describe("A10 charge release: 179 versus 180 ticks", () => {
  test("179 held ticks: partial 15 damage, blockable; exactly one projectile", async () => {
    const r = await make();
    charge(r, 179, T0 + 179 + 6 + 40);
    expect(r.spawnedAt).toEqual([T0 + 179 + 6]);
    expect(r.hp(2)).toBe(10000 - 1500);
    expect(r.hitsOn(2)).toHaveLength(1);
    expect(r.hitsOn(2)[0]!.r.candidate.projectile?.reflectable).toBe(true);
    expect(r.ps.size).toBe(0);
  });
  test("180 held ticks: full 25 damage; auto release at the cap even if the player keeps holding", async () => {
    const r = await make();
    r.input.heldSlot = 3;
    r.step(T0, { press: [{ id: 1, slot: 3 }] });
    for (let t = T0 + 1; t <= T0 + 180 + 6 + 40; t++) r.step(t); // never released by the player
    expect(r.spawnedAt).toEqual([T0 + 180 + 6]);
    expect(r.hp(2)).toBe(10000 - 2500);
    expect(r.hitsOn(2)).toHaveLength(1);
  });
  test("a release edge (skillUp) fires without a fresh hold change, once, even when sent twice", async () => {
    const r = await make();
    r.input.heldSlot = 3;
    r.step(T0, { press: [{ id: 1, slot: 3 }] });
    for (let t = T0 + 1; t < T0 + 30; t++) r.step(t);
    r.step(T0 + 30, { up: 3 });
    r.step(T0 + 31, { up: 3 }); // duplicate edge
    for (let t = T0 + 32; t <= T0 + 100; t++) r.step(t, { up: 3 });
    expect(r.spawnedAt).toEqual([T0 + 30 + 6]);
    expect(r.hp(2)).toBe(10000 - 1500);
  });
  test("partial is blockable with 5 chip, a frontal guard takes blockstun and no reaction; full bypasses the guard", async () => {
    const a = await make();
    charge(a, 100, T0 + 100 + 6 + 40, [2]);
    expect(a.results.some((x) => x.r.outcome === "blocked")).toBe(true);
    expect(a.hp(2)).toBe(10000 - 500);
    expect(a.cs.get(2)!.action).toBe("Guard");
    a.dispose();
    const b = await make();
    charge(b, 180, T0 + 180 + 6 + 40, [2]);
    expect(b.results.some((x) => x.r.outcome === "blocked")).toBe(false);
    expect(b.hp(2)).toBe(10000 - 2500);
    expect(b.cs.get(2)!.action).toBe("Ragdolled");
  });
  test("cooldown starts on the accepted press (1500 ticks), a second press during it is rejected", async () => {
    const r = await make();
    r.input.heldSlot = 3;
    r.step(T0, { press: [{ id: 1, slot: 3 }] });
    expect(r.cs.get(1)!.cooldowns.get("ea.b3")).toBe(T0 + 1500);
    r.input.heldSlot = 0;
    r.run(T0 + 1, T0 + 60);
    const o = r.runner.skillDown(r.cs.get(1)!, T0 + 200, 3, 99);
    expect(o).toEqual({ kind: "rejected", reason: "COOLDOWN" });
  });
  test("charge state: chargeStartTick is exposed only while charging; moveScale 0.15; Windup while charging", async () => {
    const r = await make();
    r.input.heldSlot = 3;
    r.step(T0, { press: [{ id: 1, slot: 3 }] });
    r.run(T0 + 1, T0 + 20);
    expect(r.runner.chargeStartOf(1)).toBe(T0);
    expect(r.runner.moveScaleOf(1)).toBe(0.15);
    expect(r.cs.get(1)!.action).toBe("Windup");
    r.input.heldSlot = 0;
    r.step(T0 + 21);
    expect(r.runner.chargeStartOf(1)).toBe(0);
  });
});

describe("A11 stale input lease", () => {
  test("14 missing ticks still charging; 15 missing ticks cancels with no projectile and the cooldown retained", async () => {
    const r = await make();
    r.input.heldSlot = 3;
    r.step(T0, { press: [{ id: 1, slot: 3 }] }); // the last packet arrives at T0
    for (let t = T0 + 1; t <= T0 + 14; t++) r.step(t, { packet: false });
    expect(r.cs.get(1)!.action).toBe("Windup");
    r.step(T0 + 15, { packet: false });
    expect(r.cs.get(1)!.action).toBe("Idle");
    expect(r.runner.castOf(1)).toBeUndefined();
    r.run(T0 + 16, T0 + 400, {});
    expect(r.spawnedAt).toEqual([]);
    expect(r.ps.size).toBe(0);
    expect(r.hp(2)).toBe(10000);
    expect(r.cs.get(1)!.cooldowns.get("ea.b3")).toBe(T0 + 1500);
  });
  test("every fresh packet refreshes the lease: a long hold with steady packets is never cancelled", async () => {
    const r = await make();
    r.input.heldSlot = 3;
    r.step(T0, { press: [{ id: 1, slot: 3 }] });
    for (let t = T0 + 1; t <= T0 + 120; t++) r.step(t);
    expect(r.cs.get(1)!.action).toBe("Windup");
  });
  test("a lapsed lease after release has no effect: the shot in flight is not cancelled", async () => {
    const r = await make();
    charge(r, 10, T0 + 10 + 6 + 1);
    expect(r.ps.size).toBe(1);
    for (let t = T0 + 18; t <= T0 + 18 + 60; t++) r.step(t, { packet: false });
    expect(r.hp(2)).toBe(10000 - 1500);
  });
});

describe("miss and expiry", () => {
  test("a shot with no target flies to the 40 m range limit, then is removed with no damage", async () => {
    const r = await make();
    r.poses.get(2)!.x = 8; // off the lane
    charge(r, 20, T0 + 20 + 6 + 140);
    expect(r.spawnedAt).toHaveLength(1);
    expect(r.ps.size).toBe(0);
    expect(r.results.filter((x) => x.r.candidate.projectile)).toHaveLength(0);
    expect(r.hp(2)).toBe(10000);
  });
  test("lifeTicks ends a slow shot before the range limit", async () => {
    const slow = orbDef({ projectile: { ...ORB_SPEC.projectile!, speed: 12, lifeTicks: 30 } });
    const r = await make({ defs: [slow] });
    r.poses.get(2)!.x = 8;
    charge(r, 1, T0 + 7);
    expect(r.ps.size).toBe(1);
    const spawnTick = r.spawnedAt[0]!;
    for (let t = spawnTick + 1; t < spawnTick + 29; t++) r.step(t);
    expect(r.ps.size).toBe(1);
    r.step(spawnTick + 29);
    expect(r.ps.size).toBe(0);
  });
  test("the arc is a fixed 0.5 m lateral swing that returns to the centre line at 20 m", async () => {
    const r = await make();
    r.poses.get(2)!.x = 8;
    charge(r, 1, T0 + 7);
    const id = r.ps.list()[0]!.id;
    let maxLateral = 0;
    let atRange = Infinity;
    for (let t = T0 + 8; t < T0 + 8 + 70; t++) {
      r.step(t);
      const p = r.ps.get(id);
      if (!p) break;
      maxLateral = Math.max(maxLateral, Math.abs(p.x));
      if (Math.abs(p.z) > 20.8) { atRange = Math.min(atRange, Math.abs(p.x)); }
    }
    expect(maxLateral).toBeGreaterThan(0.45);
    expect(maxLateral).toBeLessThanOrEqual(0.5 + 1e-6);
    expect(atRange).toBeLessThan(1e-6);
  });
  test("splash radius 2 m, max 4 targets, nearest first; direct and splash never stack", async () => {
    const r = await make({ defs: [orbDef({ projectile: { ...ORB_SPEC.projectile!, arcAmplitude: 0 } })] });
    r.poses.get(2)!.z = -10;
    r.poses.get(3)!.x = 0; r.poses.get(3)!.z = -10.8; // behind the direct target
    r.poses.get(4)!.x = 1.2; r.poses.get(4)!.z = -10;
    r.poses.get(5)!.x = -1.5; r.poses.get(5)!.z = -9.6;
    r.poses.get(6)!.x = 1.9; r.poses.get(6)!.z = -9.8; // fifth in range: capped out
    charge(r, 1, T0 + 7 + 40);
    const hit = r.results.filter((x) => x.r.outcome === "hit").map((x) => x.r.candidate.targetId);
    expect(hit).toHaveLength(4);
    expect(new Set(hit).size).toBe(4);
    expect(hit).toContain(2);
    expect(r.hp(2)).toBe(10000 - 1500); // one application, not direct plus splash
    expect(r.hp(6)).toBe(10000);
    expect(r.ps.size).toBe(0);
  });
});

describe("duplicate hit and ledger", () => {
  test("two candidates of one projectile on one target: the second is a duplicate", () => {
    const a = createFighter(1, 1, 0, "ea"), t = createFighter(2, 1, 0, "td");
    a.protectedUntilTick = 0; t.protectedUntilTick = 0;
    const c: HitCandidate = {
      attackerId: 1, attackerGeneration: 0, castCounter: -7, hitIndex: 0, toi: 0.5, targetId: 2, moveId: "ea.b3", originX: 0, originZ: 0,
      block: "B", counterable: true, armorBreak: false, damage100: 1500, reaction: { kind: "none" }, maxHitsPerTarget: 1,
      projectile: { id: 7, reflectable: true, ownerLifeId: 1 },
    };
    const res = resolveHits(10, [c, { ...c, toi: 0.6 }], {
      fighter: (id) => (id === 1 ? a : t), pose: () => ({ x: 0, z: 0, facingYaw: 0, grounded: true }),
      captures: new CaptureRegistry(), ledger: new HitLedger(), onLethal: () => undefined,
    });
    expect(res.map((x) => x.outcome)).toEqual(["hit", "duplicate"]);
    expect(t.hp100).toBe(10000 - 1500);
  });
  test("chip damage never kills: a blocked partial leaves the guard at 1 hundredth of HP", async () => {
    const r = await make();
    r.cs.get(2)!.hp100 = 300;
    charge(r, 50, T0 + 50 + 6 + 40, [2]);
    expect(r.results.some((x) => x.r.outcome === "blocked")).toBe(true);
    expect(r.hp(2)).toBe(1);
    expect(r.cs.get(2)!.action).toBe("Guard");
  });
});

describe("interruption", () => {
  test("a stun during the charge cancels: no projectile, cooldown retained, charge state cleared", async () => {
    const r = await make();
    r.input.heldSlot = 3;
    r.step(T0, { press: [{ id: 1, slot: 3 }] });
    r.run(T0 + 1, T0 + 40);
    applyReaction(r.cs.get(1)!, T0 + 41, { kind: "stun", ticks: 24 }, false);
    r.run(T0 + 41, T0 + 400);
    expect(r.spawnedAt).toEqual([]);
    expect(r.runner.castOf(1)).toBeUndefined();
    expect(r.runner.chargeStartOf(1)).toBe(0);
    expect(r.cs.get(1)!.cooldowns.get("ea.b3")).toBe(T0 + 1500);
    expect(r.hp(2)).toBe(10000);
  });
  test("a stun inside the 6 tick windup after release also cancels the shot", async () => {
    const r = await make();
    charge(r, 30, T0 + 30 + 2);
    applyReaction(r.cs.get(1)!, T0 + 33, { kind: "stun", ticks: 24 }, false);
    r.run(T0 + 33, T0 + 300);
    expect(r.spawnedAt).toEqual([]);
    expect(r.hp(2)).toBe(10000);
  });
  test("a shot already fired is detached: interrupting the caster afterwards does not remove it", async () => {
    const r = await make();
    charge(r, 30, T0 + 30 + 6 + 2);
    expect(r.ps.size).toBe(1);
    applyReaction(r.cs.get(1)!, T0 + 40, { kind: "ragdoll", ticks: 60 }, false);
    r.run(T0 + 40, T0 + 120);
    expect(r.hp(2)).toBe(10000 - 1500);
  });
});

describe("death and detached attribution", () => {
  test("the owner dying while charging fires nothing", async () => {
    const r = await make();
    r.input.heldSlot = 3;
    r.step(T0, { press: [{ id: 1, slot: 3 }] });
    r.run(T0 + 1, T0 + 20);
    r.cs.kill(1, T0 + 21);
    r.run(T0 + 21, T0 + 400);
    expect(r.spawnedAt).toEqual([]);
    expect(r.ps.size).toBe(0);
  });
  test("a fired shot outlives its dead owner and still damages; it builds no meter for the next life", async () => {
    const r = await make();
    charge(r, 30, T0 + 30 + 6 + 2);
    expect(r.ps.size).toBe(1);
    r.cs.kill(1, T0 + 40);
    r.runner.reset(1);
    r.cs.respawn(1, T0 + 41, 9); // a new life
    r.cs.get(1)!.protectedUntilTick = 0;
    r.run(T0 + 41, T0 + 120);
    expect(r.hp(2)).toBe(10000 - 1500);
    expect(r.hitsOn(2)[0]!.r.candidate.projectile?.ownerLifeId).toBe(1);
    expect(r.cs.get(1)!.meter100).toBe(0);
  });
  test("a living owner of the same life gains meter equal to the damage dealt", async () => {
    const r = await make();
    charge(r, 30, T0 + 30 + 6 + 40);
    expect(r.cs.get(1)!.meter100).toBe(1500);
  });
  test("a lethal projectile hit is one KO and never negative HP", async () => {
    const r = await make();
    r.cs.get(2)!.hp100 = 1000;
    charge(r, 30, T0 + 30 + 6 + 40);
    expect(r.hp(2)).toBe(0);
    expect(r.cs.get(2)!.koCount).toBe(1);
    expect(r.results.filter((x) => x.r.killed)).toHaveLength(1);
  });
  test("a dead target is not hit by a later projectile", async () => {
    const r = await make();
    r.cs.kill(2, T0);
    charge(r, 30, T0 + 30 + 6 + 40);
    expect(r.results.filter((x) => x.r.candidate.targetId === 2 && x.r.outcome === "hit")).toHaveLength(0);
  });
});

describe("counter and reflect (A10 reflect rows)", () => {
  test("td.b4 Mirror Current reflects the incoming orb: it returns to the caster with its existing charge damage", async () => {
    const r = await make();
    r.input.heldSlot = 3;
    r.step(T0, { press: [{ id: 1, slot: 3 }] });
    r.input.heldSlot = 0;
    r.run(T0 + 1, T0 + 6 + 6);
    r.step(T0 + 13, { press: [{ id: 2, slot: 4 }] }); // counter window [T0+13, T0+73)
    r.run(T0 + 14, T0 + 120);
    expect(r.results.some((x) => x.r.outcome === "countered" && x.r.candidate.projectile)).toBe(true);
    const back = r.hitsOn(1);
    expect(back).toHaveLength(1);
    expect(back[0]!.r.candidate.attackerId).toBe(2); // the reflector owns it now
    expect(back[0]!.r.damage100).toBe(1500); // preserved
    expect(r.hp(2)).toBe(10000); // the counter ended the stance; no damage to the reflector
    expect(r.ps.size).toBe(0);
  });
  test("a full-charge orb is still reflectable by a counter; damage stays 25", async () => {
    const r = await make();
    r.input.heldSlot = 3;
    r.step(T0, { press: [{ id: 1, slot: 3 }] });
    r.run(T0 + 1, T0 + 179);
    r.step(T0 + 180, { press: [{ id: 2, slot: 4 }] }); // full cap is hit here; the orb spawns at +6
    r.run(T0 + 181, T0 + 260);
    expect(r.hitsOn(1)[0]!.r.damage100).toBe(2500);
  });
  test("reflection API: owner, life and cast id change; heading turns to the ORIGINAL owner's current position; no teleport", async () => {
    const r = await make();
    const id = r.spawn({ x: 0, z: -4 })!;
    const before = { ...r.ps.get(id)! };
    r.poses.get(1)!.x = 6; r.poses.get(1)!.z = -4; // the original owner moved
    expect(r.ps.reflect(id, 2, 5, 10)).toBe("reflected");
    const p = r.ps.get(id)!;
    expect([p.ownerId, p.ownerLifeId, p.castCounter, p.castId, p.reflectionCount]).toEqual([2, 2, 5, "2.5", 1]);
    expect([p.x, p.y, p.z]).toEqual([before.x, before.y, before.z]);
    expect(p.vx).toBeGreaterThan(23.9); // toward +X, where the owner stands now
    expect(Math.abs(p.vz)).toBeLessThan(1e-6);
    expect(p.damage100).toBe(1500);
  });
  test("a second reflection attempt absorbs with no damage; own and non-reflectable projectiles are rejected", async () => {
    const r = await make();
    const id = r.spawn()!;
    expect(r.ps.reflect(id, 1, 3, 1)).toBe("rejected"); // own
    expect(r.ps.reflect(id, 2, 3, 1)).toBe("reflected");
    expect(r.ps.reflect(id, 3, 4, 2)).toBe("absorbed");
    expect(r.ps.size).toBe(0);
    expect(r.ps.reflect(id, 3, 4, 3)).toBe("rejected");
    const nr = r.spawn({ reflectable: false })!;
    expect(r.ps.reflect(nr, 2, 3, 1)).toBe("rejected");
    expect(r.ps.reflectable().map((p) => p.id)).not.toContain(nr);
  });
  test("Rift Palm reflects an orb inside the 1.8 m frontal hemisphere once; it returns with its damage to the original owner", async () => {
    const r = await make({ kits: { 2: "sv" } });
    r.step(10, { press: [{ id: 2, slot: 3 }] }); // palm: active [18, 21)
    r.run(11, 15);
    r.spawn({ x: 0, z: -7 }, 16);
    r.run(16, 80);
    const back = r.hitsOn(1);
    expect(back).toHaveLength(1);
    expect(back[0]!.r.candidate.attackerId).toBe(2);
    expect(back[0]!.r.damage100).toBe(1500);
    expect(r.hp(2)).toBe(10000);
    expect(r.cs.get(2)!.meter100).toBe(1500); // meter only once the reflected shot damages someone
  });
  test("the reflect gains no meter before the reflected shot lands", async () => {
    const r = await make({ kits: { 2: "sv" } });
    r.step(10, { press: [{ id: 2, slot: 3 }] });
    r.run(11, 15);
    r.spawn({ x: 0, z: -7 }, 16);
    r.run(16, 20);
    expect(r.cs.get(2)!.meter100).toBe(0);
    expect(r.ps.list()[0]!.reflectionCount).toBe(1);
  });
});

describe("A19 thin cover", () => {
  test("a 120 m/s shot (2 m per tick) cannot tunnel a 0.1 m plate: it detonates on the plate and the target behind takes nothing", async () => {
    const r = await make({ thinCover: true });
    r.poses.get(2)!.z = -6.2; // 0.4 m behind the plate, inside the 2 m splash radius
    r.spawn({ speed: 120, z: -0.8 }, T0);
    r.run(T0, T0 + 10);
    expect(r.ps.size).toBe(0);
    expect(r.hp(2)).toBe(10000);
    expect(r.results.filter((x) => x.r.candidate.projectile)).toHaveLength(0);
  });
  test("the same shot without the plate hits the target (control)", async () => {
    const r = await make({ thinCover: false });
    r.poses.get(2)!.z = -6.2;
    r.spawn({ speed: 120, z: -0.8 }, T0);
    r.run(T0, T0 + 10);
    expect(r.hp(2)).toBe(10000 - 1500);
  });
  test("a point sample per tick would have skipped the plate (proves the fixture is a real tunnelling case)", async () => {
    const r = await make({ thinCover: true });
    // Samples every 2 m from z = -0.8: -2.8, -4.8, -6.8 straddle the plate at z = -5 +- 0.05.
    const samples = [-2.8, -4.8, -6.8];
    expect(samples.every((z) => Math.abs(z + 5) > 0.05 + 0.35)).toBe(false); // -4.8 is inside the swept radius, but not inside the plate
    expect(r.world.sweepSphere([0, 0.9, -0.8], [0, 0.9, -2.8], 0.35)).toBeNull();
    expect(r.world.sweepSphere([0, 0.9, -2.8], [0, 0.9, -4.8], 0.35)).not.toBeNull();
    expect(r.world.sweepSphere([0, 0.9, -2.8], [0, 0.9, -6.8], 0.35)).not.toBeNull();
  });
  test("spawn is pulled back from a wall in front of the caster (never inside geometry)", async () => {
    const r = await make({ thinCover: true });
    r.poses.get(1)!.z = -4.5; // 0.5 m from the plate: the 0.8 m spawn offset would pass through it
    r.poses.get(2)!.z = -5.6; // just behind the plate, inside the splash radius
    charge(r, 1, T0 + 7 + 30);
    expect(r.spawnedAt).toHaveLength(1);
    expect(r.ps.size).toBe(0); // detonated on the plate it was pulled back from, not spawned beyond it
    expect(r.hp(2)).toBe(10000);
  });
});

describe("room cap and cleanup", () => {
  test(`at most ${MAX_PROJECTILES} live projectiles per room; the next spawn is refused and nothing leaks after clear`, async () => {
    const r = await make();
    for (let i = 0; i < MAX_PROJECTILES; i++) expect(r.spawn({ x: 20 + i * 0.01 })).not.toBeNull();
    expect(r.spawn()).toBeNull();
    expect(r.ps.size).toBe(MAX_PROJECTILES);
    r.ps.clear();
    expect(r.ps.size).toBe(0);
    expect(r.spawn()).not.toBeNull();
  });
  test("a spawn with a non-finite or zero heading is refused", async () => {
    const r = await make();
    expect(r.spawn({ dirX: 0, dirY: 0, dirZ: 0 })).toBeNull();
    expect(r.spawn({ x: Number.NaN })).toBeNull();
  });
  test("runner.dispose and removal cancel an in-progress charge without leaving state behind", async () => {
    const r = await make();
    r.input.heldSlot = 3;
    r.step(T0, { press: [{ id: 1, slot: 3 }] });
    r.runner.remove(1);
    expect(r.runner.castOf(1)).toBeUndefined();
    expect(r.runner.chargeStartOf(1)).toBe(0);
    r.runner.dispose();
    expect(r.runner.activeCount).toBe(0);
  });
});

describe("recast and air branches (framework hooks used by T20)", () => {
  test("a recast press reaches onRecast only while the cast runs; accepted presses answer started, ignored ones STATE", async () => {
    const calls: number[] = [];
    const probe: AbilityHandler = { ...MELEE_HANDLER, name: "recastProbe", onRecast: (c) => { calls.push(c.tick); return c.tick - c.cast.startTick >= 6; } };
    const def = defineAbility({ id: "ea.b2", label: "Probe", handler: "recastProbe", startup: 2, active: 20, recovery: 5, cooldown: 100, damage100: [100], range: 1, block: "B", input: "recast" });
    const reg = buildAbilityRegistry([def], new Set(["recastProbe"]));
    const cs = new CombatSystem();
    const f = cs.add(1, 1, 0, "ea"); f.protectedUntilTick = 0;
    const host = { combat: cs, pose: () => ({ x: 0, y: 1, z: 0, facingYaw: 0, grounded: true }), blocked: () => false };
    const runner = new AbilityRunner(reg, [probe], host);
    expect(runner.skillDown(f, 10, 2, 1).kind).toBe("started");
    cs.expire(11, () => true);
    expect(runner.skillDown(f, 11, 2, 2)).toEqual({ kind: "rejected", reason: "STATE" }); // ignored: too early
    cs.expire(17, () => true);
    expect(runner.skillDown(f, 17, 2, 3).kind).toBe("started");
    expect(calls).toEqual([11, 17]);
    runner.dispose();
  });
  test("airborne casters have their vertical velocity frozen from commit until the orb spawns", async () => {
    const r = await make();
    r.input.heldSlot = 3;
    r.step(T0, { press: [{ id: 1, slot: 3 }] });
    expect(r.runner.freezesVertical(1, T0 + 1)).toBe(true);
    r.input.heldSlot = 0;
    r.run(T0 + 1, T0 + 6 + 1);
    expect(r.runner.freezesVertical(1, T0 + 8)).toBe(false);
  });
  test("MovementSystem holds an airborne body at constant height while holdVertical is true and falls otherwise", async () => {
    const w = await World.create(flatMap(false));
    const mv = new MovementSystem(w);
    const b = mv.add(1, [0, 6, 0]);
    const neutral = { moveX: 0, moveZ: 0, run: false, guard: false, jumpPressed: false };
    for (let t = 1; t <= 30; t++) mv.step(t, () => neutral, undefined, undefined, () => true);
    expect(mv.position(1)![1]).toBeCloseTo(6, 5);
    expect(b.state.vy).toBe(0);
    for (let t = 31; t <= 60; t++) mv.step(t, () => neutral);
    expect(mv.position(1)![1]).toBeLessThan(5.5);
    mv.dispose();
    w.dispose();
  });
});
