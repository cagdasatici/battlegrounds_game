import { describe, expect, test } from "vitest";
import type { KitId } from "../../packages/shared/src/protocol.js";
import { buildAbilityRegistry, defineAbility, type AbilitySpec } from "../../packages/shared/src/abilities.js";
import { meterCap100, meterRequired100, meterStackFraction } from "../../packages/shared/src/awakening.js";
import { BEAST_FORM, beastFormDamage100, beastFormTaken100 } from "../../packages/shared/src/config/beast.js";
import { COMBAT } from "../../packages/shared/src/config/combat.js";
import { m1Overlaps } from "../../apps/server/src/sim/M1.js";
import { CombatSystem } from "../../apps/server/src/sim/Combat.js";
import { AbilityRunner, MELEE_HANDLER, type AbilityHost, type AbilityPose } from "../../apps/server/src/sim/AbilityRunner.js";
import { AwakeningSystem } from "../../apps/server/src/sim/Awakening.js";
import { kill, respawn } from "../../apps/server/src/sim/ActionMachine.js";
import type { HitCandidate } from "../../apps/server/src/sim/HitResolver.js";

const T0 = 1000;
const spec = (id: string, o: Partial<AbilitySpec> = {}): AbilitySpec => ({
  id, label: "Test", handler: "melee", startup: 4, active: 2, recovery: 6, cooldown: 0, damage100: [1000], range: 2, block: "B", ...o,
});

function rig(kit: KitId = "sv") {
  const cs = new CombatSystem();
  const poses = new Map<number, AbilityPose>();
  cs.add(1, 1, 0, kit).protectedUntilTick = 0;
  cs.add(2, 2, 0, "td").protectedUntilTick = 0;
  poses.set(1, { x: 0, y: 1, z: 0, facingYaw: 0, grounded: true });
  poses.set(2, { x: 0, y: 1, z: -1.5, facingYaw: Math.PI, grounded: true });
  const host: AbilityHost = { combat: cs, pose: (id) => poses.get(id), blocked: () => false };
  const specs = [spec("sv.b1"), spec("sv.a1", { recovery: 4, active: 30, consumesForm: true, oncePerForm: true }), spec("td.b1")];
  const runner = new AbilityRunner(buildAbilityRegistry(specs.map(defineAbility), new Set(["melee"])), [MELEE_HANDLER], host);
  const aw = new AwakeningSystem(host);
  const step = (tick: number, extra: HitCandidate[] = []) => {
    cs.expire(tick, () => true);
    aw.update(tick);
    const res = cs.resolve(tick, [...runner.collect(tick), ...aw.collect(tick), ...extra], (id) => poses.get(id));
    runner.afterResolve(tick, res);
    aw.gain(res);
    return res;
  };
  /** Presses Awaken at T0 and runs the activation to completion. */
  const awaken = (): ReturnType<AwakeningSystem["request"]> => {
    const out = aw.request(cs.get(1)!, T0);
    for (let t = T0; t <= T0 + 100; t++) step(t);
    return out;
  };
  return { cs, aw, runner, step, awaken };
}
const strike = (attackerId: number, targetId: number, damage100: number, moveId: string, gen: number): HitCandidate => ({
  attackerId, attackerGeneration: gen, castCounter: 99, hitIndex: 0, toi: 0, targetId, moveId, originX: 0, originZ: 0,
  block: "U", counterable: false, armorBreak: false, damage100, reaction: { kind: "none" }, maxHitsPerTarget: 1,
});

describe("stacked meter", () => {
  test("banks two bars per kit and reports the stack fraction", () => {
    expect(meterCap100("sv")).toBe(40000);
    expect(meterCap100("td")).toBe(70000);
    expect(meterStackFraction("sv", 30000)).toBe(1.5);
    expect(meterStackFraction("td", 999999)).toBe(2);
  });

  test("the meter keeps filling past one bar up to two, and stops there", () => {
    const r = rig();
    const f = r.cs.get(1)!;
    f.meter100 = meterRequired100("sv") - 100;
    r.step(T0, [strike(1, 2, 3000, "x.hit", f.generation)]);
    expect(f.meter100).toBeGreaterThan(meterRequired100("sv"));
    f.meter100 = meterCap100("sv") - 100;
    r.step(T0 + 1, [strike(1, 2, 3000, "y.hit", f.generation)]);
    expect(f.meter100).toBe(meterCap100("sv"));
  });
});

describe("Beast Awaken", () => {
  test("one bar is an ordinary awaken: not a beast", () => {
    const r = rig();
    const f = r.cs.get(1)!;
    f.meter100 = meterRequired100("sv") + 5000;
    expect(r.awaken().kind).toBe("started");
    expect(f.form).toBe("Awakened");
    expect(f.beast).toBe(false);
  });

  test("two bars transform: Awakened underneath, beast flag, full HP, armour, a fixed 10 s, meter spent", () => {
    const r = rig();
    const f = r.cs.get(1)!;
    f.hp100 = 3000;
    f.meter100 = meterCap100("sv");
    r.awaken();
    expect(f.form).toBe("Awakened");
    expect(f.beast).toBe(true);
    expect(f.hp100).toBe(COMBAT.hp100Max);
    expect(f.armored).toBe(true);
    expect(f.meter100).toBe(0);
    const end = f.formEndTick;
    expect(end).toBeGreaterThan(0);
    // The activation took 30 ticks; the form lasts exactly BEAST_FORM.ticks from completion.
    expect(end - (T0 + 30)).toBe(BEAST_FORM.ticks);
    r.step(end - 1);
    expect(f.beast).toBe(true);
    r.step(end);
    expect(f.beast).toBe(false);
    expect(f.form).toBe("Base");
    expect(f.armored).toBe(false);
  });

  test("beast awaken can be disabled per room: the meter then caps at one bar and two bars never exist", () => {
    const r = rig();
    r.aw.beastEnabled = false;
    const f = r.cs.get(1)!;
    f.meter100 = meterRequired100("sv");
    r.awaken();
    expect(f.beast).toBe(false);
  });

  test("an awakened special does not end the transformation (consumesForm bypass) and the once-per-form bit still holds", () => {
    const r = rig();
    const f = r.cs.get(1)!;
    f.meter100 = meterCap100("sv");
    r.awaken();
    const t = T0 + 101;
    expect(r.runner.skillDown(f, t, 1, 7).kind).toBe("started");
    expect(f.form).toBe("Awakened");
    expect(f.beast).toBe(true);
    for (let i = 0; i < 40; i++) r.step(t + i);
    expect(r.runner.skillDown(f, t + 50, 1, 8)).toMatchObject({ kind: "rejected" });
    expect(f.beast).toBe(true);
  });

  test("death ends it at once and respawn does not restore it", () => {
    const r = rig();
    const f = r.cs.get(1)!;
    f.meter100 = meterCap100("sv");
    r.awaken();
    kill(f, T0 + 200);
    expect(f.beast).toBe(false);
    respawn(f, T0 + 400, 9);
    expect(f.beast).toBe(false);
  });

  test("no meter is gained while transformed", () => {
    const r = rig();
    const f = r.cs.get(1)!;
    f.meter100 = meterCap100("sv");
    r.awaken();
    r.step(T0 + 120, [strike(1, 2, 3000, "x.hit", f.generation)]);
    expect(f.meter100).toBe(0);
  });
});

describe("beast form combat numbers", () => {
  test("specials deal double, basics 1.5x, anything else is untouched", () => {
    expect(beastFormDamage100("sv.a1", 1000)).toBe(2000);
    expect(beastFormDamage100("td.a4", 1500)).toBe(3000);
    expect(beastFormDamage100("ea.a3", 700)).toBe(1400);
    expect(beastFormDamage100("m1.1", 300)).toBe(450);
    expect(beastFormDamage100("dash.forward", 400)).toBe(600);
    expect(beastFormDamage100("sv.b1", 1000)).toBe(1000); // a base special is not an awakened special
    expect(beastFormDamage100("sv.activate", 1600)).toBe(1600);
  });

  test("a transformed attacker's special lands doubled through the real resolver; a normal attacker's does not", () => {
    const r = rig();
    const a = r.cs.get(1)!, t = r.cs.get(2)!;
    a.beast = true; a.form = "Awakened"; // the invariant: beast only exists inside the Awakened form
    const hit = r.step(T0, [strike(1, 2, 1000, "sv.a1", a.generation)]);
    expect(hit[0]).toMatchObject({ outcome: "hit", damage100: 2000 });
    expect(t.hp100).toBe(COMBAT.hp100Max - 2000);
    a.beast = false; a.form = "Base";
    r.step(T0 + 1, [strike(1, 2, 1000, "sv.a1", a.generation)]);
    expect(t.hp100).toBe(COMBAT.hp100Max - 3000);
  });

  test("a transformed target takes half damage", () => {
    const r = rig();
    const a = r.cs.get(1)!, t = r.cs.get(2)!;
    t.beast = true; t.form = "Awakened";
    r.step(T0, [strike(1, 2, 1000, "x.hit", a.generation)]);
    expect(t.hp100).toBe(COMBAT.hp100Max - beastFormTaken100(1000));
    expect(beastFormTaken100(1000)).toBe(500);
  });

  test("a bigger M1 box reaches farther and a bigger hurtbox is easier to hit", () => {
    const a = { x: 0, y: 0.9, z: 0, facingYaw: 0, grounded: true };
    const far = { x: 0, y: 0.9, z: -4, facingYaw: 0, grounded: true };
    expect(m1Overlaps(a, far, null)).toBe(false);
    expect(m1Overlaps({ ...a, reachScale: BEAST_FORM.reachScale }, far, null)).toBe(true);
  });
});
