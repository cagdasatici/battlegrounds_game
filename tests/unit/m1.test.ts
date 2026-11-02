import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { HIT_STUN } from "../../packages/shared/src/config/combat.js";

// Decision 0049: these tests cover the legacy on-hit freeze, which is disabled in production by HIT_STUN.enabled=false.
beforeAll(() => { HIT_STUN.enabled = true; });
afterAll(() => { HIT_STUN.enabled = false; });
import { COMBAT } from "../../packages/shared/src/config/combat.js";
import { applyReaction } from "../../apps/server/src/sim/ActionMachine.js";
import { CombatSystem } from "../../apps/server/src/sim/Combat.js";
import type { HitResult } from "../../apps/server/src/sim/HitResolver.js";
import { M1System, launchOf, m1Overlaps, selectFourth, type M1Held, type M1Pose } from "../../apps/server/src/sim/M1.js";

const T0 = 1000;
const M = COMBAT.m1;
const held = (o: Partial<M1Held> = {}): M1Held => ({ attackHeld: false, blockHeld: false, jumpHeld: false, ...o });

/** Attacker 1 at the origin facing -Z; target 2 1.5 m in front facing the attacker; optional 3rd fighter. */
function rig(n = 2, targetZ = -1.5) {
  const cs = new CombatSystem();
  const m1 = new M1System();
  const poses = new Map<number, M1Pose>();
  for (let i = 1; i <= n; i++) cs.add(i, i, 0, "sv").protectedUntilTick = 0;
  poses.set(1, { x: 0, y: 1, z: 0, facingYaw: 0, grounded: true });
  poses.set(2, { x: 0, y: 1, z: targetZ, facingYaw: Math.PI, grounded: true });
  if (n >= 3) poses.set(3, { x: 0, y: 1, z: 1.5, facingYaw: 0, grounded: true });
  const results: { tick: number; r: HitResult }[] = [];
  const commits: { tick: number; moveId: string }[] = [];
  /** One tick in spec 12 order: expiry, input (M1 then guard), collision query, hit resolution. */
  const step = (tick: number, h1: M1Held, opts: { block2?: boolean; occluded?: boolean } = {}) => {
    cs.expire(tick, (id) => poses.get(id)!.grounded);
    const a = cs.get(1)!;
    const r = m1.update(a, tick, h1, poses.get(1));
    if (r?.ok) commits.push({ tick, moveId: a.moveId });
    cs.updateGuard(1, tick, h1.blockHeld, poses.get(1)!.grounded);
    if (cs.get(2)) cs.updateGuard(2, tick, !!opts.block2, true);
    const cands = m1.candidates(tick, cs.all(), (id) => poses.get(id), () => !!opts.occluded);
    for (const x of cs.resolve(tick, cands, (id) => poses.get(id))) results.push({ tick, r: x });
  };
  return { cs, m1, poses, results, commits, step };
}

describe("A02 held M1 chain cadence", () => {
  test("hold 180 ticks at a target in range: legal timing, no attack in fourth recovery, 14 HP per chain", () => {
    const { cs, results, commits, step } = rig();
    for (let t = T0; t < T0 + 180; t++) step(t, held({ attackHeld: true }));
    const rel = commits.map((c) => c.tick - T0);
    // 1-3: startup 8 + active 3 + recovery 10 = 21; fourth: 8 + 3 + 30 = 41; chain = 104 ticks.
    expect(rel).toEqual([0, 21, 42, 63, 104, 125, 146, 167]);
    expect(commits.map((c) => c.moveId)).toEqual(["m1.1", "m1.2", "m1.3", "m1.4.finisher", "m1.1", "m1.2", "m1.3", "m1.4.finisher"]);
    // No commit inside the fourth recovery window [63+11, 63+41).
    expect(rel.filter((t) => t > 63 && t < 104)).toEqual([]);
    const hits = results.filter((x) => x.r.outcome === "hit");
    expect(hits.map((x) => x.tick - T0)).toEqual(rel.map((t) => t + M.startup));
    const perChain = (lo: number, hi: number) =>
      hits.filter((x) => x.tick - T0 >= lo && x.tick - T0 < hi).reduce((s, x) => s + x.r.damage100, 0);
    expect(perChain(0, 104)).toBe(1400);
    expect(perChain(104, 180)).toBe(1400);
    expect(cs.get(2)!.hp100).toBe(10000 - 2800);
    // Duplicate queries on active ticks 2 and 3 of every swing are rejected by the ledger.
    expect(results.filter((x) => x.r.outcome === "duplicate").length).toBe(16);
    expect(cs.invariantViolations()).toEqual([]);
  });

  test("hits 1-3 stun 24; fourth ragdolls 72 with forward 8 up 3 launch", () => {
    const { cs, m1, poses, results, step } = rig();
    step(T0, held({ attackHeld: true }));
    for (let t = T0 + 1; t <= T0 + 8; t++) step(t, held({ attackHeld: true }));
    expect(cs.get(2)!.action).toBe("Stunned");
    expect(cs.get(2)!.actionEndTick).toBe(T0 + 8 + M.stunTicks);
    for (let t = T0 + 9; t <= T0 + 71; t++) step(t, held({ attackHeld: true }));
    expect(cs.get(2)!.action).toBe("Ragdolled");
    expect(cs.get(2)!.actionEndTick).toBe(T0 + 71 + M.finisherRagdollTicks);
    const last = results.filter((x) => x.tick === T0 + 71).map((x) => x.r);
    const l = m1.launches(T0 + 71, last, (id) => cs.get(id), (id) => poses.get(id));
    expect(l).toHaveLength(1);
    expect(l[0]!.vz).toBeCloseTo(-8); // attacker forward is -Z
    expect(l[0]!.vy).toBe(3);
  });
});

describe("A03 fourth hit variants", () => {
  test("grounded with Jump held selects mini uppercut; repeated airborne selects downslam", () => {
    const { commits, poses, step, m1, cs } = rig();
    for (let t = T0; t < T0 + 63; t++) step(t, held({ attackHeld: true, jumpHeld: true }));
    // A combo is active, so the room suppresses an ordinary jump while Jump is held.
    expect(m1.comboActive(cs.get(1)!, T0 + 62)).toBe(true);
    step(T0 + 63, held({ attackHeld: true, jumpHeld: true }));
    expect(commits.at(-1)!.moveId).toBe("m1.4.uppercut");
    expect(m1.comboActive(cs.get(1)!, T0 + 63)).toBe(true);
    for (let t = T0 + 64; t < T0 + 104 + 63; t++) step(t, held({ attackHeld: true }));
    poses.get(1)!.grounded = false;
    step(T0 + 167, held({ attackHeld: true, jumpHeld: true }));
    expect(commits.at(-1)!.moveId).toBe("m1.4.downslam");
    expect(selectFourth(true, false)).toBe("finisher");
    expect(launchOf("uppercut", 0)).toEqual({ vx: 0, vy: 10, vz: 0 });
    expect(launchOf("downslam", 0)).toEqual({ vx: 0, vy: -16, vz: 0 });
  });
  test("no combo before the first commit: a jump edge then is an ordinary jump", () => {
    const { m1, cs } = rig();
    expect(m1.comboActive(cs.get(1)!, T0)).toBe(false);
  });
  test("downslam radial volume hits beside the attacker once; the plain box does not", () => {
    const a: M1Pose = { x: 0, y: 1, z: 0, facingYaw: 0, grounded: false };
    const side: M1Pose = { x: 1.6, y: 1, z: 0, facingYaw: 0, grounded: true };
    expect(m1Overlaps(a, side, "downslam")).toBe(true);
    expect(m1Overlaps(a, side, "finisher")).toBe(false);
  });
});

describe("M1 geometry", () => {
  const a: M1Pose = { x: 0, y: 1, z: 0, facingYaw: 0, grounded: true };
  const t = (x: number, z: number, y = 1): M1Pose => ({ x, y, z, facingYaw: 0, grounded: true });
  test("front face at 2.1 m plus capsule radius; width 1.5; nothing behind; height slab", () => {
    expect(m1Overlaps(a, t(0, -(2.1 + 0.35 - 0.01)), null)).toBe(true);
    expect(m1Overlaps(a, t(0, -(2.1 + 0.35 + 0.01)), null)).toBe(false);
    expect(m1Overlaps(a, t(0.75 + 0.34, -1), null)).toBe(true);
    expect(m1Overlaps(a, t(0.75 + 0.36, -1), null)).toBe(false);
    expect(m1Overlaps(a, t(0, 1), null)).toBe(false);
    // Box half height 0.85 + capsule segment 0.55 + radius 0.35 = 1.75 m vertical reach.
    expect(m1Overlaps(a, t(0, -1, 1 + 1.74), null)).toBe(true);
    expect(m1Overlaps(a, t(0, -1, 1 + 1.76), null)).toBe(false);
    // Rotated facing: yaw pi/2 faces -X.
    expect(m1Overlaps({ ...a, facingYaw: Math.PI / 2 }, t(-1.5, 0), null)).toBe(true);
  });
});

describe("M1 combat matrix", () => {
  test("miss: out of range produces no candidate, chain still advances and no HP changes", () => {
    const { cs, m1, results, step } = rig(2, -3);
    for (let t = T0; t < T0 + 21; t++) step(t, held({ attackHeld: true }));
    expect(results).toEqual([]);
    expect(cs.get(2)!.hp100).toBe(10000);
    expect(m1.nextIndex(cs.get(1)!, T0 + 21)).toBe(1);
  });
  test("static occlusion rejects the hit", () => {
    const { cs, results, step } = rig();
    for (let t = T0; t < T0 + 21; t++) step(t, held({ attackHeld: true }), { occluded: true });
    expect(results).toEqual([]);
    expect(cs.get(2)!.hp100).toBe(10000);
  });
  test("block: frontal guard blocks with zero chip, 6 tick blockstun, one entry per swing", () => {
    const { cs, results, step } = rig();
    for (let t = T0; t < T0 + 21; t++) step(t, held({ attackHeld: true }), { block2: true });
    expect(results.map((x) => x.r.outcome)).toEqual(["blocked", "duplicate", "duplicate"]);
    expect(cs.get(2)!.hp100).toBe(10000);
    expect(cs.get(2)!.blockstunUntil).toBe(T0 + 8 + COMBAT.guard.blockstun);
    expect(cs.get(2)!.action).toBe("Guard");
  });
  test("guard from behind does not block", () => {
    const { cs, poses, step } = rig();
    poses.get(2)!.facingYaw = 0; // facing away
    for (let t = T0; t < T0 + 21; t++) step(t, held({ attackHeld: true }), { block2: true });
    expect(cs.get(2)!.hp100).toBe(9700);
  });
  test("counter: an open counter interval consumes the M1 hit", () => {
    const { cs, results, step } = rig();
    cs.get(2)!.counterOpenUntil = T0 + 20;
    for (let t = T0; t < T0 + 21; t++) step(t, held({ attackHeld: true }));
    expect(results.map((x) => x.r.outcome)).toEqual(["countered", "duplicate", "duplicate"]);
    expect(cs.get(2)!.hp100).toBe(10000);
  });
  test("interruption: attacker stunned during windup never hits; next request restarts legally", () => {
    const { cs, results, step } = rig(3);
    step(T0, held({ attackHeld: true }));
    applyReaction(cs.get(1)!, T0 + 4, { kind: "stun", ticks: 24 }, false);
    for (let t = T0 + 4; t < T0 + 28; t++) step(t, held({ attackHeld: true }));
    expect(results).toEqual([]);
    expect(cs.get(1)!.action).toBe("Stunned");
    step(T0 + 28, held({ attackHeld: true }));
    expect(cs.get(1)!.moveId).toBe("m1.2"); // chain advanced at commit; gap 0 from the planned end
  });
  test("same tick interruption: an earlier hit on the attacker invalidates its later candidate", () => {
    const { cs, m1, poses } = rig(2, -1.5);
    // Both start together; fighter 1 is resolved first (lower id), stunning 2 before 2's candidate applies.
    m1.update(cs.get(1)!, T0, held({ attackHeld: true }), poses.get(1));
    m1.update(cs.get(2)!, T0, held({ attackHeld: true }), poses.get(2));
    for (let t = T0 + 1; t <= T0 + 8; t++) cs.expire(t, () => true);
    const out = cs.resolve(T0 + 8, m1.candidates(T0 + 8, cs.all(), (id) => poses.get(id)), (id) => poses.get(id));
    expect(out.map((r) => [r.candidate.attackerId, r.outcome])).toEqual([[1, "hit"], [2, "staleAttacker"]]);
  });
  test("death: lethal hit kills once, dead target produces no further candidates, attacker chain reset on own death", () => {
    const { cs, m1, results, step } = rig();
    cs.get(2)!.hp100 = 300;
    for (let t = T0; t < T0 + 30; t++) step(t, held({ attackHeld: true }));
    const lethal = results.filter((x) => x.r.killed);
    expect(lethal).toHaveLength(1);
    expect(cs.get(2)!.action).toBe("Dead");
    expect(cs.get(2)!.koCount).toBe(1);
    expect(results.filter((x) => x.tick > T0 + 8).length).toBe(0);
    cs.kill(1, T0 + 30);
    expect(m1.update(cs.get(1)!, T0 + 31, held({ attackHeld: true }), { x: 0, y: 1, z: 0, facingYaw: 0, grounded: true })).toBeNull();
    expect(m1.nextIndex(cs.get(1)!, T0 + 31)).toBe(0);
    expect(cs.invariantViolations()).toEqual([]);
  });
  test("expiry: chain gap > 54 resets to the first hit; exactly 54 continues", () => {
    const a = rig();
    a.step(T0, held({ attackHeld: true }));
    for (let t = T0 + 1; t < T0 + 21 + 54; t++) a.step(t, held());
    a.step(T0 + 21 + 54, held({ attackHeld: true }));
    expect(a.commits.at(-1)!.moveId).toBe("m1.2");
    const b = rig();
    b.step(T0, held({ attackHeld: true }));
    for (let t = T0 + 1; t < T0 + 21 + 55; t++) b.step(t, held());
    b.step(T0 + 21 + 55, held({ attackHeld: true }));
    expect(b.commits.at(-1)!.moveId).toBe("m1.1");
  });
  test("expiry: no hit candidates outside the 3 active ticks", () => {
    const { cs, m1, poses, step } = rig();
    step(T0, held({ attackHeld: true }));
    for (let t = T0 + 1; t < T0 + 8; t++) { step(t, held()); expect(m1.candidates(t, cs.all(), (id) => poses.get(id))).toEqual([]); }
    for (let t = T0 + 11; t < T0 + 21; t++) { step(t, held()); expect(m1.candidates(t, cs.all(), (id) => poses.get(id))).toEqual([]); }
  });
  test("tap buffer: a press during recovery is buffered 6 ticks; older presses are dropped", () => {
    const a = rig();
    a.step(T0, held({ attackHeld: true }));
    for (let t = T0 + 1; t < T0 + 15; t++) a.step(t, held());
    a.step(T0 + 15, held({ attackHeld: true })); // tap during recovery (ends T0+21)
    for (let t = T0 + 16; t <= T0 + 21; t++) a.step(t, held());
    expect(a.commits.map((c) => c.tick - T0)).toEqual([0, 21]);
    const b = rig();
    b.step(T0, held({ attackHeld: true }));
    for (let t = T0 + 1; t < T0 + 14; t++) b.step(t, held());
    b.step(T0 + 14, held({ attackHeld: true })); // 7 ticks before Idle: expired
    for (let t = T0 + 15; t <= T0 + 30; t++) b.step(t, held());
    expect(b.commits.map((c) => c.tick - T0)).toEqual([0]);
  });
  test("cannot attack and guard simultaneously; guard release recovery delays the attack", () => {
    const { cs, commits, step } = rig();
    for (let t = T0; t < T0 + 10; t++) step(t, held({ attackHeld: true, blockHeld: true }));
    expect(commits).toEqual([]);
    expect(cs.get(1)!.action).toBe("Guard");
    for (let t = T0 + 10; t < T0 + 10 + COMBAT.guard.recovery; t++) step(t, held({ attackHeld: true }));
    expect(commits).toEqual([]);
    step(T0 + 10 + COMBAT.guard.recovery, held({ attackHeld: true }));
    expect(commits).toHaveLength(1);
  });
  test("cleanup: remove and dispose drop chain state", () => {
    const { m1, step } = rig();
    step(T0, held({ attackHeld: true }));
    expect(m1.size).toBe(1);
    m1.remove(1);
    expect(m1.size).toBe(0);
    m1.dispose();
  });
});
