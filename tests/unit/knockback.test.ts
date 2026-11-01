import { describe, expect, test } from "vitest";
import { COMBAT } from "../../packages/shared/src/config/combat.js";
import { ALL_HANDLERS, buildKitRegistry } from "../../apps/server/src/kits/index.js";
import { applyReaction } from "../../apps/server/src/sim/ActionMachine.js";
import { CombatSystem } from "../../apps/server/src/sim/Combat.js";
import { AbilityRunner, type AbilityPose } from "../../apps/server/src/sim/AbilityRunner.js";
import type { HitCandidate, HitResult } from "../../apps/server/src/sim/HitResolver.js";
import { launchVector } from "../../apps/server/src/sim/Knockback.js";
import { M1System, type M1Pose } from "../../apps/server/src/sim/M1.js";

const T = 1000;

const candidate = (moveId: string, over: Partial<HitCandidate> = {}): HitCandidate => ({
  attackerId: 1, attackerGeneration: 0, castCounter: 1, hitIndex: 0, toi: 0, targetId: 2, moveId, originX: 0, originZ: 0,
  block: "B", counterable: true, armorBreak: false, damage100: 100, reaction: { kind: "ragdoll", ticks: 60 },
  maxHitsPerTarget: 1, ...over,
});

describe("R11 knockback direction", () => {
  test("launchVector pushes away from the origin and falls back to attacker forward at zero distance", () => {
    const side = launchVector(0, 0, 3, 0, 0, 7, 2);
    expect(side.vx).toBeCloseTo(7, 9);
    expect(side.vz + 0).toBeCloseTo(0, 9);
    expect(side.vy).toBe(2);
    const zero = launchVector(1, 1, 1, 1, 0, 7, 2); // yaw 0 faces -Z
    expect(zero.vx + 0).toBeCloseTo(0, 9);
    expect(zero.vz).toBeCloseTo(-7, 9);
    const diag = launchVector(0, 0, -3, -3, 0, 10, 0);
    expect(Math.hypot(diag.vx, diag.vz)).toBeCloseTo(10, 9);
    expect(diag.vx).toBeLessThan(0);
  });

  test("a target standing 90 degrees to the side of an sv.b2 caster is pushed sideways, away from the caster", () => {
    const cs = new CombatSystem();
    for (const i of [1, 2]) cs.add(i, i, 0, "sv").protectedUntilTick = 0;
    const poses = new Map<number, AbilityPose>([
      [1, { x: 0, y: 1, z: 0, facingYaw: 0, grounded: true }], // faces -Z
      [2, { x: 1.5, y: 1, z: 0, facingYaw: Math.PI, grounded: true }], // exactly to the caster's side (+X)
    ]);
    const runner = new AbilityRunner(buildKitRegistry(), ALL_HANDLERS, { combat: cs, pose: (id) => poses.get(id), blocked: () => false });
    applyReaction(cs.get(2)!, T, { kind: "ragdoll", ticks: 60 }, false);
    const res: HitResult = { candidate: candidate("sv.b2", { launch: { forward: 7, up: 2 } }), outcome: "hit", damage100: 100, killed: false };
    const [l] = runner.launches(T, [res]);
    expect(l!.vx).toBeCloseTo(7, 9);
    expect(l!.vz + 0).toBeCloseTo(0, 9);
    expect(l!.vy).toBe(2);
  });

  test("M1 finisher pushes along the hit origin to target direction, not the attacker facing", () => {
    const cs = new CombatSystem();
    for (const i of [1, 2]) cs.add(i, i, 0, "sv").protectedUntilTick = 0;
    const poses = new Map<number, M1Pose>([
      [1, { x: 0, y: 1, z: 0, facingYaw: 0, grounded: true }],
      [2, { x: -1.2, y: 1, z: 0, facingYaw: Math.PI, grounded: true }], // to the side (-X)
    ]);
    applyReaction(cs.get(2)!, T, { kind: "ragdoll", ticks: 72 }, false);
    const res: HitResult = {
      candidate: candidate("m1.4.finisher", { reaction: { kind: "ragdoll", ticks: 72 } }), outcome: "hit", damage100: 400, killed: false,
    };
    const [l] = new M1System().launches(T, [res], (id) => cs.get(id), (id) => poses.get(id));
    expect(l!.vx).toBeCloseTo(-COMBAT.m1.finisherLaunch.forward, 9);
    expect(l!.vz + 0).toBeCloseTo(0, 9);
    expect(l!.vy).toBe(COMBAT.m1.finisherLaunch.up);
  });
});
