import { describe, expect, test } from "vitest";
import {
  AbilityDefSchema, buildAbilityRegistry, defineAbility, slotAndFormOf, validateAbility,
  type AbilitySpec,
} from "../../packages/shared/src/abilities.js";
import { ALL_ABILITY_DEFS } from "../../packages/shared/src/config/kits/index.js";
import { ALL_HANDLERS, buildKitRegistry } from "../../apps/server/src/kits/index.js";
import { applyReaction, kill } from "../../apps/server/src/sim/ActionMachine.js";
import { CombatSystem } from "../../apps/server/src/sim/Combat.js";
import {
  AbilityRunner, MELEE_HANDLER, shapeOverlaps, type AbilityHandler, type AbilityHost, type AbilityPose,
  type EndReason, type SkillOutcome,
} from "../../apps/server/src/sim/AbilityRunner.js";
import type { HitResult } from "../../apps/server/src/sim/HitResolver.js";

const T0 = 1000;

const base = (id: string, o: Partial<AbilitySpec> = {}): AbilitySpec => ({
  id, label: "Test", handler: "melee", startup: 6, active: 4, recovery: 10, cooldown: 60,
  damage100: [1000], range: 2, block: "B", ...o,
});

interface Probe { commits: number; ends: EndReason[] }
function probeHandler(): { handler: AbilityHandler; probe: Probe } {
  const probe: Probe = { commits: 0, ends: [] };
  return {
    probe,
    handler: { ...MELEE_HANDLER, name: "probe", onCommit: () => { probe.commits++; }, onEnd: (_c, why) => { probe.ends.push(why); } },
  };
}
const groundedHandler: AbilityHandler = { ...MELEE_HANDLER, name: "grounded", requiresGrounded: true };

/** Attacker 1 at the origin facing -Z (kit sv); targets 2 and 3 in front; all unprotected. */
function rig(specs: AbilitySpec[], n = 2) {
  const { handler, probe } = probeHandler();
  const defs = specs.map(defineAbility);
  const registry = buildAbilityRegistry(defs, new Set(["melee", "probe", "grounded"]));
  const cs = new CombatSystem();
  const poses = new Map<number, AbilityPose>();
  for (let i = 1; i <= n; i++) cs.add(i, i, 0, "sv").protectedUntilTick = 0;
  poses.set(1, { x: 0, y: 1, z: 0, facingYaw: 0, grounded: true });
  if (n >= 2) poses.set(2, { x: 0, y: 1, z: -1.5, facingYaw: Math.PI, grounded: true });
  if (n >= 3) poses.set(3, { x: 0, y: 1, z: -1.0, facingYaw: Math.PI, grounded: true });
  if (n >= 4) poses.set(4, { x: 0, y: 1, z: -2.0, facingYaw: Math.PI, grounded: true });
  let occluded = false;
  const host: AbilityHost = {
    combat: cs, pose: (id) => poses.get(id), blocked: () => occluded,
  };
  const runner = new AbilityRunner(registry, [MELEE_HANDLER, handler, groundedHandler], host);
  const results: { tick: number; r: HitResult }[] = [];
  const outcomes: { tick: number; edgeId: number; o: SkillOutcome }[] = [];
  /** One tick in spec 12 order: expiry, buffered intent, collision query, hit resolution. */
  const step = (tick: number, press?: { slot: 1 | 2 | 3 | 4; edgeId?: number }, opts: { block2?: boolean } = {}) => {
    cs.expire(tick, (id) => poses.get(id)!.grounded);
    const a = cs.get(1)!;
    const b = runner.consumeBuffer(a, tick);
    if (b) outcomes.push({ tick, edgeId: b.edgeId, o: b.outcome });
    if (press) outcomes.push({ tick, edgeId: press.edgeId ?? 1, o: runner.skillDown(a, tick, press.slot, press.edgeId ?? 1) });
    if (cs.get(2)) cs.updateGuard(2, tick, !!opts.block2, true);
    const cands = runner.collect(tick);
    const res = cs.resolve(tick, cands, (id) => poses.get(id));
    runner.afterResolve(tick, res);
    for (const r of res) results.push({ tick, r });
  };
  return { cs, runner, poses, results, outcomes, step, probe, setOccluded: (v: boolean) => { occluded = v; } };
}

describe("ability schema and registry validator (spec 14)", () => {
  test("defaults follow section 14", () => {
    const d = defineAbility(base("sv.b1", { range: 3 }));
    expect(d.slot).toBe(1);
    expect(d.form).toBe("Base");
    expect(d.shape).toEqual({ kind: "box", w: 2, h: 2, d: 3 });
    expect(d.hitOffsets).toEqual([0]);
    expect(d.maxHitsPerTarget).toBe(1);
    expect(d.maxTargets).toBe(1);
    expect(d.targetStates).toEqual(["standing", "air"]);
    expect(d.stunTicks).toBe(24);
    expect(d.ragdollTicks).toBe(0);
    expect(d.launch).toEqual({ forward: 0, up: 0 });
    expect(d.armor).toBe("none");
    expect(d.counterable).toBe(true);
    expect(d.armorBreak).toBe(false);
    expect(d.moveScale).toBe(0);
    expect(d.turnRate).toBe(0);
    expect(d.animationId).toBe("sv.b1.anim");
    expect(d.vfxId).toBe("sv.b1.vfx");
    expect(d.sfxId).toBe("sv.b1.sfx");
  });

  test("multi hit schedule sets maxHitsPerTarget to the offsets length", () => {
    const d = defineAbility(base("sv.b2", { hitOffsets: [0, 8, 16], damage100: [200, 200, 500] }));
    expect(d.maxHitsPerTarget).toBe(3);
  });

  test("slot and form follow the ID suffix", () => {
    expect(slotAndFormOf("td.a3")).toEqual({ slot: 3, form: "Awakened" });
    expect(slotAndFormOf("sv.x1")).toEqual({ slot: null, form: "Base" });
    expect(slotAndFormOf("sv.activate")).toEqual({ slot: null, form: "Base" });
    expect(() => validateAbility({ ...defineAbility(base("sv.b1")), slot: 2 })).toThrow(/slot\/form/);
    expect(() => validateAbility({ ...defineAbility(base("sv.b1")), form: "Awakened" })).toThrow(/slot\/form/);
  });

  test("unknown properties fail strict validation", () => {
    const d = defineAbility(base("sv.b1"));
    expect(AbilityDefSchema.safeParse({ ...d, extra: 1 }).success).toBe(false);
    expect(AbilityDefSchema.safeParse({ ...d, shape: { kind: "box", w: 1, h: 1, d: 1, q: 1 } }).success).toBe(false);
    expect(AbilityDefSchema.safeParse({ ...d, damage100: [Number.NaN] }).success).toBe(false);
    expect(AbilityDefSchema.safeParse({ ...d, cooldown: Number.POSITIVE_INFINITY }).success).toBe(false);
    expect(AbilityDefSchema.safeParse({ ...d, id: "xx.b1" }).success).toBe(false);
  });

  test("rejects inconsistent definitions", () => {
    expect(() => defineAbility(base("sv.b1", { hitOffsets: [0, 4], damage100: [100] }))).toThrow(/equal length/);
    expect(() => defineAbility(base("sv.b1", { hitOffsets: [4, 4], damage100: [100, 100] }))).toThrow(/ascending/);
    expect(() => defineAbility(base("sv.b1", { consumesForm: true }))).toThrow(/consumesForm/);
    expect(() => defineAbility(base("sv.b1", { oncePerForm: true }))).toThrow(/oncePerForm/);
    expect(() => defineAbility(base("sv.b1", { damage100: [-1] }))).toThrow();
  });

  test("registry: duplicate id, unknown handler and taken slot fail; kit lookup works", () => {
    const a = defineAbility(base("sv.b1"));
    const handlers = new Set(["melee"]);
    expect(() => buildAbilityRegistry([a, a], handlers)).toThrow(/duplicate/);
    expect(() => buildAbilityRegistry([defineAbility(base("sv.b1", { handler: "nope" }))], handlers)).toThrow(/unknown handler/);
    const reg = buildAbilityRegistry([a, defineAbility(base("sv.b2")), defineAbility(base("td.b1"))], handlers);
    expect(reg.slotted("sv", "Base", 2)?.id).toBe("sv.b2");
    expect(reg.slotted("sv", "Awakened", 1)).toBeUndefined();
    expect(reg.forKit("td").map((d) => d.id)).toEqual(["td.b1"]);
    expect(reg.byId("sv.b3")).toBeUndefined();
  });

  test("shipped definitions and handlers validate", () => {
    const reg = buildKitRegistry();
    expect(reg.defs.length).toBe(ALL_ABILITY_DEFS.length);
    expect(new Set(ALL_HANDLERS.map((h) => h.name)).size).toBe(ALL_HANDLERS.length);
  });
});

describe("shape queries", () => {
  const a: AbilityPose = { x: 0, y: 1, z: 0, facingYaw: 0, grounded: true };
  const at = (x: number, z: number, y = 1): AbilityPose => ({ x, y, z, facingYaw: 0, grounded: true });
  test("box spans [0, depth] forward and +-w/2 sideways, plus the 0.35 capsule radius", () => {
    const box = { kind: "box", w: 2, h: 2, d: 3 } as const;
    expect(shapeOverlaps(box, 3, a, 0, at(0, -3.3))).toBe(true);
    expect(shapeOverlaps(box, 3, a, 0, at(0, -3.4))).toBe(false);
    expect(shapeOverlaps(box, 3, a, 0, at(1.3, -1))).toBe(true);
    expect(shapeOverlaps(box, 3, a, 0, at(1.4, -1))).toBe(false);
    expect(shapeOverlaps(box, 3, a, 0, at(0, 0.5))).toBe(false); // behind the attacker
    expect(shapeOverlaps(box, 3, a, 0, at(0, -1, 4))).toBe(false); // far above
  });
  test("aim yaw rotates the box", () => {
    const box = { kind: "box", w: 2, h: 2, d: 3 } as const;
    expect(shapeOverlaps(box, 3, a, Math.PI / 2, at(-2, 0))).toBe(true); // yaw +90 faces -X
    expect(shapeOverlaps(box, 3, a, Math.PI / 2, at(0, -2))).toBe(false);
  });
  test("sphere centred range ahead; range 0 surrounds the caster", () => {
    const s = { kind: "sphere", r: 5 } as const;
    expect(shapeOverlaps(s, 0, a, 0, at(5.3, 0))).toBe(true);
    expect(shapeOverlaps(s, 0, a, 0, at(5.4, 0))).toBe(false);
    expect(shapeOverlaps(s, 0, a, 0, at(0, 4))).toBe(true);
  });
  test("beam truncates at maxLength", () => {
    const b = { kind: "beam", length: 32, radius: 3 } as const;
    expect(shapeOverlaps(b, 0, a, 0, at(0, -30))).toBe(true);
    expect(shapeOverlaps(b, 0, a, 0, at(0, -30), 10)).toBe(false);
    expect(shapeOverlaps(b, 0, a, 0, at(3.3, -10))).toBe(true);
    expect(shapeOverlaps(b, 0, a, 0, at(3.4, -10))).toBe(false);
  });
});

describe("AbilityRunner phase scheduler and hit deduplication", () => {
  test("phases use exclusive integer ticks; one hit across the active window", () => {
    const { cs, results, outcomes, step } = rig([base("sv.b1")]);
    const f = cs.get(1)!;
    step(T0, { slot: 1 });
    expect(outcomes[0]!.o).toMatchObject({ kind: "started", moveId: "sv.b1" });
    expect(f.action).toBe("Windup");
    for (let t = T0 + 1; t < T0 + 30; t++) {
      step(t);
      const rel = t - T0;
      const expected = rel < 6 ? "Windup" : rel < 10 ? "Active" : rel < 20 ? "Recovery" : "Idle";
      expect(f.action, `tick +${rel}`).toBe(expected);
    }
    const hits = results.filter((x) => x.r.outcome === "hit");
    expect(hits.map((x) => x.tick - T0)).toEqual([6]);
    expect(hits[0]!.r.damage100).toBe(1000);
    expect(cs.get(2)!.hp100).toBe(9000);
    expect(results.filter((x) => x.r.outcome === "duplicate")).toEqual([]); // pre-filtered by the query
    expect(cs.invariantViolations()).toEqual([]);
  });

  test("miss spends the cooldown and deals nothing; cooldown ends exactly at press + cooldown", () => {
    const { cs, poses, outcomes, step } = rig([base("sv.b1")]);
    poses.get(2)!.z = -8;
    step(T0, { slot: 1, edgeId: 1 });
    for (let t = T0 + 1; t < T0 + 60; t++) step(t);
    expect(cs.get(2)!.hp100).toBe(10000);
    step(T0 + 59, { slot: 1, edgeId: 2 });
    expect(outcomes.at(-1)!.o).toEqual({ kind: "rejected", reason: "COOLDOWN" });
    step(T0 + 60, { slot: 1, edgeId: 3 });
    expect(outcomes.at(-1)!.o.kind).toBe("started");
  });

  test("multi hit schedule: a target entering only at the last offset takes only that hit", () => {
    const { cs, poses, results, step } = rig([base("sv.b1", { startup: 4, active: 40, hitOffsets: [0, 8, 16], damage100: [200, 200, 500], range: 3 })]);
    poses.get(2)!.z = -9; // out of range for the first two hit groups
    step(T0, { slot: 1 });
    for (let t = T0 + 1; t < T0 + 40; t++) {
      if (t === T0 + 4 + 16 - 1) poses.get(2)!.z = -1.5;
      step(t);
    }
    const hits = results.filter((x) => x.r.outcome === "hit");
    expect(hits.map((x) => [x.tick - T0, x.r.damage100])).toEqual([[20, 500]]);
    expect(cs.get(2)!.hp100).toBe(9500);
  });

  test("multi hit schedule sums to its declared total and never exceeds maxHitsPerTarget", () => {
    const { cs, results, step } = rig([base("sv.b1", { startup: 4, active: 40, hitOffsets: [0, 8, 16], damage100: [200, 200, 500], range: 3, stunTicks: 0 })]);
    step(T0, { slot: 1 });
    for (let t = T0 + 1; t < T0 + 50; t++) step(t);
    expect(results.filter((x) => x.r.outcome === "hit").map((x) => x.tick - T0)).toEqual([4, 12, 20]);
    expect(cs.get(2)!.hp100).toBe(10000 - 900);
  });

  test("maxTargets keeps the nearest targets (3 at 1.0 m, 2 at 1.5 m, 4 at 2.0 m)", () => {
    const { results, step } = rig([base("sv.b1", { maxTargets: 2, range: 3 })], 4);
    step(T0, { slot: 1 });
    for (let t = T0 + 1; t < T0 + 12; t++) step(t);
    const hit = results.filter((x) => x.r.outcome === "hit").map((x) => x.r.candidate.targetId);
    expect(hit.sort()).toEqual([2, 3]);
  });

  test("ragdolled targets are only hit when the move supports them", () => {
    const a = rig([base("sv.b1")]);
    applyReaction(a.cs.get(2)!, T0 - 1, { kind: "ragdoll", ticks: 200 }, false);
    a.step(T0, { slot: 1 });
    for (let t = T0 + 1; t < T0 + 12; t++) a.step(t);
    expect(a.cs.get(2)!.hp100).toBe(10000);
    const b = rig([base("sv.b1", { targetStates: ["standing", "air", "ragdoll"] })]);
    applyReaction(b.cs.get(2)!, T0 - 1, { kind: "ragdoll", ticks: 200 }, false);
    b.step(T0, { slot: 1 });
    for (let t = T0 + 1; t < T0 + 12; t++) b.step(t);
    expect(b.cs.get(2)!.hp100).toBe(9000);
  });
});

describe("AbilityRunner combat matrix", () => {
  test("static occlusion blocks the hit", () => {
    const r = rig([base("sv.b1")]);
    r.setOccluded(true);
    r.step(T0, { slot: 1 });
    for (let t = T0 + 1; t < T0 + 12; t++) r.step(t);
    expect(r.cs.get(2)!.hp100).toBe(10000);
  });

  test("B hit is blocked by a frontal guard (0 chip, blockstun) and U bypasses it", () => {
    const b = rig([base("sv.b1")]);
    b.step(T0 - 10, undefined, { block2: true });
    b.step(T0 - 5, undefined, { block2: true });
    b.step(T0, { slot: 1 }, { block2: true });
    for (let t = T0 + 1; t < T0 + 12; t++) b.step(t, undefined, { block2: true });
    expect(b.results.filter((x) => x.r.outcome === "blocked").length).toBe(1);
    expect(b.cs.get(2)!.hp100).toBe(10000);
    const u = rig([base("sv.b1", { block: "U" })]);
    u.step(T0 - 10, undefined, { block2: true });
    u.step(T0 - 5, undefined, { block2: true });
    u.step(T0, { slot: 1 }, { block2: true });
    for (let t = T0 + 1; t < T0 + 12; t++) u.step(t, undefined, { block2: true });
    expect(u.cs.get(2)!.hp100).toBe(9000);
  });

  test("a counter stance consumes a counterable hit; noncounterable moves ignore it", () => {
    const c = rig([base("sv.b1")]);
    c.cs.get(2)!.counterOpenUntil = T0 + 100;
    c.step(T0, { slot: 1 });
    for (let t = T0 + 1; t < T0 + 12; t++) c.step(t);
    expect(c.results.filter((x) => x.r.outcome === "countered").length).toBe(1);
    expect(c.cs.get(2)!.hp100).toBe(10000);
    const n = rig([base("sv.b1", { counterable: false })]);
    n.cs.get(2)!.counterOpenUntil = T0 + 100;
    n.step(T0, { slot: 1 });
    for (let t = T0 + 1; t < T0 + 12; t++) n.step(t);
    expect(n.cs.get(2)!.hp100).toBe(9000);
  });

  test("interruption before the hit phase cancels it; scheduled effects go stale; cancel is idempotent", () => {
    const r = rig([base("sv.b1", { handler: "probe" })]);
    r.step(T0, { slot: 1 });
    expect(r.probe.commits).toBe(1);
    r.step(T0 + 3);
    applyReaction(r.cs.get(1)!, T0 + 3, { kind: "stun", ticks: 24 }, false);
    for (let t = T0 + 4; t < T0 + 40; t++) r.step(t);
    expect(r.cs.get(2)!.hp100).toBe(10000);
    expect(r.probe.ends).toEqual(["cancelled"]);
    r.runner.cancel(1);
    r.runner.cancel(1);
    expect(r.probe.ends).toEqual(["cancelled"]);
    expect(r.runner.activeCount).toBe(0);
  });

  test("same tick interruption: an attacker stunned earlier in the tick deals no damage", () => {
    const r = rig([base("sv.b1", { startup: 2 })]);
    r.step(T0, { slot: 1 });
    r.step(T0 + 1);
    // Third party hit lands on the attacker on the tick its hit would resolve.
    applyReaction(r.cs.get(1)!, T0 + 2, { kind: "stun", ticks: 10 }, false);
    r.step(T0 + 2);
    expect(r.cs.get(2)!.hp100).toBe(10000);
  });

  test("death of the attacker mid cast ends it once and fires no later hit", () => {
    const r = rig([base("sv.b1", { handler: "probe", startup: 10 })]);
    r.step(T0, { slot: 1 });
    r.step(T0 + 4);
    r.cs.kill(1, T0 + 5);
    expect(r.cs.get(1)!.koCount).toBe(1);
    for (let t = T0 + 5; t < T0 + 30; t++) r.step(t);
    expect(r.cs.get(2)!.hp100).toBe(10000);
    expect(r.probe.ends).toEqual(["died"]);
    expect(kill(r.cs.get(1)!, T0 + 6)).toBe(false); // one KO per life
    expect(r.cs.get(1)!.koCount).toBe(1);
  });

  test("lethal damage clamps to remaining HP and the victim has one KO", () => {
    const r = rig([base("sv.b1", { damage100: [5000] })]);
    r.cs.get(2)!.hp100 = 700;
    r.step(T0, { slot: 1 });
    for (let t = T0 + 1; t < T0 + 12; t++) r.step(t);
    const lethal = r.results.filter((x) => x.r.killed);
    expect(lethal.length).toBe(1);
    expect(lethal[0]!.r.damage100).toBe(700);
    expect(r.cs.get(2)!.hp100).toBe(0);
    expect(r.cs.get(2)!.koCount).toBe(1);
  });

  test("armor during startup keeps the cast through a non-armorBreak hit but still takes damage; armorBreak bypasses it", () => {
    for (const armorBreak of [false, true]) {
      const r = rig([base("sv.b1", { armor: "startup", startup: 10 }), base("sv.b2", { startup: 2, damage100: [500], armorBreak })]);
      const f2 = r.cs.get(2)!;
      r.poses.get(2)!.facingYaw = Math.PI;
      expect(r.runner.skillDown(f2, T0, 1, 9).kind).toBe("started");
      r.step(T0, { slot: 2 });
      expect(f2.armored).toBe(true);
      r.step(T0 + 1);
      r.step(T0 + 2); // entity 1's hit resolves here
      expect(f2.hp100).toBe(9500);
      expect(f2.action).toBe(armorBreak ? "Stunned" : "Windup");
    }
  });

  test("armor ends at activeStart for startup armor", () => {
    const r = rig([base("sv.b1", { armor: "startup", startup: 4 })]);
    const f = r.cs.get(1)!;
    r.step(T0, { slot: 1 });
    expect(f.armored).toBe(true);
    for (let t = T0 + 1; t < T0 + 4; t++) { r.step(t); expect(f.armored, `+${t - T0}`).toBe(true); }
    r.step(T0 + 4);
    expect(f.armored).toBe(false);
  });
});

describe("AbilityRunner input rules", () => {
  test("rejects unknown slots, airborne grounded-only moves and dead casters", () => {
    const r = rig([base("sv.b1"), base("sv.b2", { handler: "grounded" })]);
    const f = r.cs.get(1)!;
    expect(r.runner.skillDown(f, T0, 4, 1)).toEqual({ kind: "rejected", reason: "INVALID" });
    expect(r.runner.skillDown(f, T0, 3, 1)).toEqual({ kind: "rejected", reason: "INVALID" });
    r.poses.get(1)!.grounded = false;
    expect(r.runner.skillDown(f, T0, 2, 1)).toEqual({ kind: "rejected", reason: "STATE" });
    expect(f.cooldowns.has("sv.b2")).toBe(false); // a rejected press spends nothing
    r.poses.get(1)!.grounded = true;
    expect(r.runner.skillDown(f, T0, 2, 1).kind).toBe("started");
    const dead = rig([base("sv.b1")]);
    dead.cs.kill(1, T0);
    expect(dead.runner.skillDown(dead.cs.get(1)!, T0, 1, 1)).toEqual({ kind: "rejected", reason: "STATE" });
  });

  test("the awakened slot set replaces the base set while form is Awakened", () => {
    const r = rig([base("sv.b1"), base("sv.a1", { oncePerForm: true, cooldown: 0 })]);
    const f = r.cs.get(1)!;
    f.form = "Awakened";
    expect(r.runner.skillDown(f, T0, 1, 1)).toMatchObject({ kind: "started", moveId: "sv.a1" });
  });

  test("oncePerForm sets its bit at commit even on a miss; consumesForm returns to Base at commit", () => {
    const r = rig([base("sv.a2", { oncePerForm: true, consumesForm: true, cooldown: 0 })]);
    r.poses.get(2)!.z = -9;
    const f = r.cs.get(1)!;
    f.form = "Awakened";
    expect(r.runner.skillDown(f, T0, 2, 1).kind).toBe("started");
    expect(f.form).toBe("Base");
    expect(f.awakenedUsedMask & 2).toBe(2);
    for (let t = T0 + 1; t < T0 + 30; t++) r.step(t);
    expect(r.runner.skillDown(f, T0 + 30, 2, 2)).toMatchObject({ kind: "rejected" });
    f.form = "Awakened";
    expect(r.runner.skillDown(f, T0 + 30, 2, 3)).toEqual({ kind: "rejected", reason: "FORM" });
  });

  test("consumesForm: the cast in progress still resolves after the form is spent", () => {
    const r = rig([base("sv.a1", { consumesForm: true, oncePerForm: true, cooldown: 0, damage100: [3000] })]);
    const f = r.cs.get(1)!;
    f.form = "Awakened";
    r.step(T0, { slot: 1 });
    expect(f.form).toBe("Base");
    for (let t = T0 + 1; t < T0 + 12; t++) r.step(t);
    expect(r.cs.get(2)!.hp100).toBe(7000);
  });

  test("buffer: one offensive edge for 6 ticks, most recent replaces, consumed at the Idle boundary", () => {
    const r = rig([base("sv.b1", { cooldown: 0, recovery: 10, startup: 2, active: 2 }), base("sv.b2", { cooldown: 0 })]);
    r.step(T0, { slot: 1, edgeId: 1 });
    // Cast ends at T0+14. Press at T0+9 (5 ticks before Idle): buffered, then replaced by slot 2.
    for (let t = T0 + 1; t < T0 + 9; t++) r.step(t);
    r.step(T0 + 9, { slot: 1, edgeId: 2 });
    r.step(T0 + 10, { slot: 2, edgeId: 3 });
    expect(r.runner.bufferedCount).toBe(1);
    for (let t = T0 + 11; t <= T0 + 14; t++) r.step(t);
    expect(r.outcomes.find((o) => o.edgeId === 3 && o.tick === T0 + 14)?.o).toMatchObject({ kind: "started", moveId: "sv.b2" });
    expect(r.outcomes.some((o) => o.edgeId === 2 && o.o.kind === "started")).toBe(false);
    expect(r.runner.bufferedCount).toBe(0);
  });

  test("buffer: an edge older than 6 ticks expires with a rejection and starts nothing", () => {
    const r = rig([base("sv.b1", { cooldown: 0, recovery: 30 }), base("sv.b2", { cooldown: 0 })]);
    r.step(T0, { slot: 1, edgeId: 1 });
    r.step(T0 + 5, { slot: 2, edgeId: 2 });
    for (let t = T0 + 6; t < T0 + 60; t++) r.step(t);
    const o2 = r.outcomes.filter((o) => o.edgeId === 2 && o.o.kind !== "buffered");
    expect(o2.length).toBe(1);
    expect(o2[0]!.o).toEqual({ kind: "rejected", reason: "STATE" });
    expect(o2[0]!.tick - (T0 + 5)).toBeGreaterThan(6);
    expect(r.runner.bufferedCount).toBe(0);
    expect(r.cs.get(1)!.cooldowns.has("sv.b2")).toBe(false);
  });

  test("death clears the buffered edge", () => {
    const r = rig([base("sv.b1", { cooldown: 0, recovery: 30 }), base("sv.b2", { cooldown: 0 })]);
    r.step(T0, { slot: 1 });
    r.step(T0 + 5, { slot: 2, edgeId: 2 });
    expect(r.runner.bufferedCount).toBe(1);
    r.cs.kill(1, T0 + 6);
    r.runner.reset(1);
    expect(r.runner.bufferedCount).toBe(0);
  });

  test("stunned, ragdolled and captured fighters reject skills instead of buffering", () => {
    const r = rig([base("sv.b1")]);
    const f = r.cs.get(1)!;
    applyReaction(f, T0, { kind: "stun", ticks: 20 }, false);
    expect(r.runner.skillDown(f, T0 + 1, 1, 1)).toEqual({ kind: "rejected", reason: "STATE" });
    expect(r.runner.bufferedCount).toBe(0);
  });

  test("moveScale is exposed only while an ability cast runs", () => {
    const r = rig([base("sv.b1", { moveScale: 0.15 })]);
    expect(r.runner.moveScaleOf(1)).toBeNull();
    r.step(T0, { slot: 1 });
    expect(r.runner.moveScaleOf(1)).toBe(0.15);
    for (let t = T0 + 1; t < T0 + 25; t++) r.step(t);
    expect(r.runner.moveScaleOf(1)).toBeNull();
  });
});

describe("AbilityRunner cleanup", () => {
  test("no casts, buffers or ledger entries survive completion, removal or dispose", () => {
    const r = rig([base("sv.b1")]);
    r.step(T0, { slot: 1 });
    for (let t = T0 + 1; t < T0 + 30; t++) r.step(t);
    expect(r.runner.activeCount).toBe(0);
    expect(r.cs.ledger.size).toBe(0);
    r.step(T0 + 100, { slot: 1 });
    r.runner.remove(1);
    expect(r.runner.activeCount).toBe(0);
    expect(r.runner.kitOf(1)).toBe("sv"); // R10: the kit lives on the fighter, not in the runner
    r.runner.dispose();
    expect(r.runner.bufferedCount).toBe(0);
  });

  test("a registry with an unhandled definition cannot construct a runner", () => {
    const reg = buildAbilityRegistry([defineAbility(base("sv.b1", { handler: "melee" }))], new Set(["melee"]));
    expect(() => new AbilityRunner(reg, [], { combat: new CombatSystem(), pose: () => undefined, blocked: () => false })).toThrow(/unknown handler/);
  });
});
