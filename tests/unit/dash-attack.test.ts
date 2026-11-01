import { describe, expect, test } from "vitest";
import { COMBAT } from "../../packages/shared/src/config/combat.js";
import { CombatSystem } from "../../apps/server/src/sim/Combat.js";
import { dashCandidates } from "../../apps/server/src/sim/DashAttack.js";
import type { HitResult } from "../../apps/server/src/sim/HitResolver.js";
import type { M1Pose } from "../../apps/server/src/sim/M1.js";

const T0 = 1000;
const D = COMBAT.dash.forward;

/** Attacker 1 at the origin facing -Z; target 2 in front facing the attacker. Poses are fixed. */
function rig(opts: { moveX?: number; moveZ?: number } = {}) {
  const cs = new CombatSystem();
  for (const i of [1, 2]) cs.add(i, i, 0).protectedUntilTick = 0;
  const poses = new Map<number, M1Pose>();
  poses.set(1, { x: 0, y: 1, z: 0, facingYaw: 0, grounded: true });
  poses.set(2, { x: 0, y: 1, z: -1.5, facingYaw: Math.PI, grounded: true });
  const results: { tick: number; r: HitResult }[] = [];
  const dash = cs.requestDash(1, T0, 0, opts.moveX ?? 0, opts.moveZ ?? -1);
  expect(dash.ok).toBe(true);
  const step = (tick: number, o: { guard2?: boolean } = {}) => {
    cs.expire(tick, () => true);
    cs.updateGuard(2, tick, !!o.guard2, true);
    const cands = dashCandidates(tick, cs.all(), (id) => poses.get(id));
    for (const x of cs.resolve(tick, cands, (id) => poses.get(id))) results.push({ tick, r: x });
  };
  return { cs, step, results };
}

describe("R06 forward dash hitbox", () => {
  test("hit on dash tick 15, none on tick 14", () => {
    const r = rig();
    for (let t = T0; t <= T0 + 14; t++) r.step(t);
    expect(r.results).toEqual([]);
    r.step(T0 + D.ticks - D.hitTicks);
    expect(r.results.map((x) => [x.tick - T0, x.r.outcome, x.r.damage100])).toEqual([[15, "hit", 400]]);
    expect(r.cs.get(2)!.action).toBe("Stunned");
    expect(r.cs.get(2)!.actionEndTick - r.cs.get(2)!.actionStartTick).toBe(D.stunTicks);
  });

  test("one hit only across ticks 15 to 17", () => {
    const r = rig();
    for (let t = T0; t <= T0 + 17; t++) r.step(t);
    expect(r.results.filter((x) => x.r.outcome === "hit")).toHaveLength(1);
    expect(r.cs.get(2)!.hp100).toBe(10000 - 400);
    for (let t = T0 + 18; t < T0 + 24; t++) r.step(t);
    expect(r.results.filter((x) => x.r.outcome === "hit")).toHaveLength(1);
  });

  test("blocked from the front", () => {
    const r = rig();
    for (let t = T0; t < T0 + 15; t++) r.step(t, { guard2: true });
    r.step(T0 + 15, { guard2: true });
    expect(r.results[0]!.r.outcome).toBe("blocked");
    expect(r.cs.get(2)!.hp100).toBe(10000);
  });

  test("side dash never hits", () => {
    const r = rig({ moveX: 1, moveZ: 0 });
    expect(r.cs.get(1)!.dash?.kind).toBe("side");
    for (let t = T0; t < T0 + 20; t++) r.step(t);
    expect(r.results).toEqual([]);
  });
});
