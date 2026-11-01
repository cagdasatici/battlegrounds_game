import { describe, expect, test } from "vitest";
import { SV_DEFS } from "../../packages/shared/src/config/kits/sv.js";
import { ALL_HANDLERS, buildKitRegistry } from "../../apps/server/src/kits/index.js";
import { applyReaction, kill } from "../../apps/server/src/sim/ActionMachine.js";
import { CombatSystem } from "../../apps/server/src/sim/Combat.js";
import {
  AbilityRunner, type AbilityHost, type AbilityPose, type Launch, type SkillOutcome,
} from "../../apps/server/src/sim/AbilityRunner.js";
import type { HitResult } from "../../apps/server/src/sim/HitResolver.js";

/**
 * T12 Stone Vanguard base moves (spec 15, A09). Uses the shipped registry and handlers with the real
 * AbilityRunner/CombatSystem driven in spec 12 tick order. Attacker 1 stands at the origin facing -Z (yaw 0);
 * victims face the attacker (yaw PI). Press ticks are explicit so every boundary is an exact integer tick.
 */
const T0 = 1000;
const def = (id: string) => SV_DEFS.find((d) => d.id === id)!;

interface Hit { tick: number; r: HitResult }

function rig(n = 2) {
  const registry = buildKitRegistry();
  const cs = new CombatSystem();
  const poses = new Map<number, AbilityPose>();
  for (let i = 1; i <= n; i++) cs.add(i, i, 0).protectedUntilTick = 0;
  poses.set(1, { x: 0, y: 1, z: 0, facingYaw: 0, grounded: true });
  for (let i = 2; i <= n; i++) poses.set(i, { x: 0, y: 1, z: -1.5, facingYaw: Math.PI, grounded: true });
  const host: AbilityHost = { combat: cs, pose: (id) => poses.get(id), blocked: () => false };
  const runner = new AbilityRunner(registry, ALL_HANDLERS, host);
  runner.setKit(1, "sv");
  const results: Hit[] = [];
  const outcomes: { tick: number; o: SkillOutcome }[] = [];
  const launches: { tick: number; l: Launch }[] = [];
  /** One tick in spec 12 order: expiry, buffered intent, skill edge, collision queries, serial resolution, launches. */
  const step = (tick: number, press?: 1 | 2 | 3 | 4, guard: readonly number[] = []) => {
    cs.expire(tick, (id) => poses.get(id)!.grounded);
    const a = cs.get(1)!;
    const b = runner.consumeBuffer(a, tick);
    if (b) outcomes.push({ tick, o: b.outcome });
    if (press) outcomes.push({ tick, o: runner.skillDown(a, tick, press, tick) });
    for (let i = 2; i <= n; i++) if (cs.get(i)) cs.updateGuard(i, tick, guard.includes(i), true);
    const res = cs.resolve(tick, runner.collect(tick), (id) => poses.get(id));
    runner.afterResolve(tick, res);
    for (const r of res) results.push({ tick, r });
    for (const l of runner.launches(tick, res)) {
      launches.push({ tick, l });
      const p = poses.get(l.targetId)!;
      if (l.vy > 0) p.grounded = false; // the room does the same with the body state
    }
  };
  const run = (from: number, to: number, guard: readonly number[] = []) => { for (let t = from; t <= to; t++) step(t, undefined, guard); };
  const hp = (id: number) => cs.get(id)!.hp100;
  const hitsOn = (id: number) => results.filter((x) => x.r.candidate.targetId === id && x.r.outcome === "hit");
  const place = (id: number, x: number, y: number, z: number, grounded = true) => {
    poses.set(id, { x, y, z, facingYaw: Math.PI, grounded });
  };
  return { cs, runner, poses, results, outcomes, launches, step, run, hp, hitsOn, place };
}

describe("sv.b1 Fault Strike definition", () => {
  test("matches the spec 15 table", () => {
    const d = def("sv.b1");
    expect([d.slot, d.form, d.handler]).toEqual([1, "Base", "faultStrike"]);
    expect([d.startup, d.active, d.recovery, d.cooldown]).toEqual([24, 4, 24, 1200]);
    expect(d.damage100).toEqual([2000]);
    expect(d.range).toBe(3);
    expect(d.block).toBe("U");
    expect(d.targetStates).toEqual(["standing", "air", "ragdoll"]);
    expect([d.stunTicks, d.ragdollTicks]).toEqual([0, 72]);
    expect(d.launch).toEqual({ forward: 14, up: 4 });
    expect(d.maxTargets).toBe(4);
    expect(d.maxHitsPerTarget).toBe(1);
    expect(d.armor).toBe("none");
  });
});

describe("sv.b1 Fault Strike behaviour", () => {
  test("direct hit lands exactly at startTick+24: 20 HP, ragdoll 72, launch F14 U4, one hit across the 4 tick window", () => {
    const r = rig();
    r.step(T0, 1);
    expect(r.outcomes[0]!.o.kind).toBe("started");
    r.run(T0 + 1, T0 + 23);
    expect(r.hp(2)).toBe(10000);
    r.step(T0 + 24);
    expect(r.hp(2)).toBe(8000);
    const v = r.cs.get(2)!;
    expect(v.action).toBe("Ragdolled");
    expect(v.actionStartTick).toBe(T0 + 24);
    expect(v.actionEndTick).toBe(T0 + 24 + 72);
    expect(r.launches.map((x) => [x.tick, x.l.targetId, x.l.vx + 0, x.l.vy, x.l.vz])).toEqual([[T0 + 24, 2, 0, 4, -14]]);
    r.run(T0 + 25, T0 + 28); // rest of the active window and one recovery tick
    expect(r.hitsOn(2).map((x) => x.tick)).toEqual([T0 + 24]);
    expect(r.hp(2)).toBe(8000);
  });

  test("direct hit supports a ragdolled target and ignores guard (U)", () => {
    const r = rig();
    applyReaction(r.cs.get(2)!, T0 - 5, { kind: "ragdoll", ticks: 72 }, false);
    r.step(T0, 1);
    r.run(T0 + 1, T0 + 24);
    expect(r.hp(2)).toBe(8000);
    const g = rig();
    g.step(T0, 1);
    g.run(T0 + 1, T0 + 24, [2]); // victim guards frontally the whole time
    expect(g.cs.get(2)!.action).toBe("Ragdolled");
    expect(g.hp(2)).toBe(8000);
    expect(g.results.some((x) => x.r.outcome === "blocked")).toBe(false);
  });

  test("landing bonus: +10 HP on the first ground contact after an airborne tick, once, total 30", () => {
    const r = rig();
    r.step(T0, 1);
    r.run(T0 + 1, T0 + 29);
    expect(r.hp(2)).toBe(8000);
    expect(r.cs.get(2)!.landingBonus).toBe(true);
    expect(r.poses.get(2)!.grounded).toBe(false); // launched
    r.poses.get(2)!.grounded = true;
    r.step(T0 + 30);
    expect(r.hp(2)).toBe(7000);
    const land = r.hitsOn(2).filter((x) => x.tick === T0 + 30);
    expect(land).toHaveLength(1);
    expect(land[0]!.r.candidate.hitIndex).toBe(100);
    expect(land[0]!.r.damage100).toBe(1000);
    expect(r.runner.landing.size).toBe(0);
    r.run(T0 + 31, T0 + 60);
    expect(r.hp(2)).toBe(7000); // no second landing hit
  });

  test("no ground contact without a prior airborne tick: standing victim never takes the bonus", () => {
    const r = rig();
    r.step(T0, 1);
    r.run(T0 + 1, T0 + 24);
    r.poses.get(2)!.grounded = true; // never observed airborne by the tick pass
    r.run(T0 + 25, T0 + 24 + 130);
    expect(r.hp(2)).toBe(8000);
    expect(r.runner.landing.size).toBe(0); // expired and removed
  });

  test("landing bonus expires after 120 ticks (exclusive): contact at +119 applies, at +120 does not", () => {
    const apply = rig();
    apply.step(T0, 1);
    apply.run(T0 + 1, T0 + 24 + 118);
    apply.poses.get(2)!.grounded = true;
    apply.step(T0 + 24 + 119);
    expect(apply.hp(2)).toBe(7000);
    const late = rig();
    late.step(T0, 1);
    late.run(T0 + 1, T0 + 24 + 119);
    late.poses.get(2)!.grounded = true;
    late.step(T0 + 24 + 120);
    expect(late.hp(2)).toBe(8000);
    expect(late.runner.landing.size).toBe(0);
  });

  test("A09: evasive before landing clears the bonus: exactly 20; without evasive exactly 30", () => {
    const ev = rig();
    ev.step(T0, 1);
    ev.run(T0 + 1, T0 + 24 + 11);
    const dash = ev.cs.requestDash(2, T0 + 24 + 12, Math.PI, 0, 0); // ragdoll age 12 is the minimum
    expect(dash.ok).toBe(true);
    expect(ev.cs.get(2)!.landingBonus).toBe(false);
    ev.run(T0 + 24 + 13, T0 + 24 + 20);
    ev.poses.get(2)!.grounded = true;
    ev.run(T0 + 24 + 21, T0 + 24 + 60);
    expect(ev.hp(2)).toBe(8000);
    expect(ev.runner.landing.size).toBe(0);
    const plain = rig();
    plain.step(T0, 1);
    plain.run(T0 + 1, T0 + 24 + 20);
    plain.poses.get(2)!.grounded = true;
    plain.run(T0 + 24 + 21, T0 + 24 + 60);
    expect(plain.hp(2)).toBe(7000);
  });

  test("landing damage is attributed to the attacker, noncounterable, and survives the attacker being stunned", () => {
    const r = rig();
    r.step(T0, 1);
    r.run(T0 + 1, T0 + 24);
    applyReaction(r.cs.get(1)!, T0 + 25, { kind: "stun", ticks: 24 }, true); // attacker interrupted after the direct hit
    r.run(T0 + 25, T0 + 29);
    r.cs.get(2)!.counterOpenUntil = T0 + 100; // victim counter stance is open at landing
    r.poses.get(2)!.grounded = true;
    r.step(T0 + 30);
    expect(r.hp(2)).toBe(7000);
    expect(r.cs.get(2)!.counterOpenUntil).toBe(T0 + 100); // not consumed
    expect(r.results.at(-1)!.r.candidate.attackerId).toBe(1);
  });

  test("wave: 8 m box hits non-direct targets for 10 HP, R36 F6 U1, B; no landing bonus on the wave", () => {
    const r = rig(3);
    r.place(3, 0, 1, -6);
    r.step(T0, 1);
    r.run(T0 + 1, T0 + 24);
    expect(r.hp(2)).toBe(8000); // direct 20, not 20+10
    expect(r.hp(3)).toBe(9000);
    expect(r.cs.get(3)!.action).toBe("Ragdolled");
    expect(r.cs.get(3)!.actionEndTick).toBe(T0 + 24 + 36);
    const wl = r.launches.find((x) => x.l.targetId === 3)!.l;
    expect([wl.vx + 0, wl.vy, wl.vz]).toEqual([0, 1, -6]);
    expect(r.hitsOn(2)).toHaveLength(1);
    expect(r.hitsOn(3)).toHaveLength(1);
    expect(r.cs.get(3)!.landingBonus).toBe(false);
    r.poses.get(3)!.grounded = true;
    r.run(T0 + 25, T0 + 80);
    expect(r.hp(3)).toBe(9000);
    expect(r.hitsOn(2).filter((x) => x.r.candidate.hitIndex === 1)).toHaveLength(0); // never also wave-hit
  });

  test("wave is only queried at activeStart and skips ragdolled and out of box targets", () => {
    const r = rig(4);
    r.place(3, 0, 1, -6);
    r.place(4, 0, 1, -9); // beyond 8 m
    applyReaction(r.cs.get(3)!, T0 - 5, { kind: "ragdoll", ticks: 200 }, false);
    r.step(T0, 1);
    r.run(T0 + 1, T0 + 24);
    expect(r.hp(3)).toBe(10000);
    expect(r.hp(4)).toBe(10000);
    expect(r.hp(2)).toBe(8000);
    // A target stepping into the wave box after activeStart is not wave hit.
    const late = rig(3);
    late.place(3, 0, 1, -12);
    late.step(T0, 1);
    late.run(T0 + 1, T0 + 24);
    late.place(3, 0, 1, -6);
    late.run(T0 + 25, T0 + 40);
    expect(late.hp(3)).toBe(10000);
  });

  test("wave is blockable and a block consumes the hit; direct is not", () => {
    const r = rig(3);
    r.place(3, 0, 1, -6);
    r.run(T0 - 5, T0 - 1, [3]); // guard established (startup 3)
    r.step(T0, 1, [3]);
    r.run(T0 + 1, T0 + 24, [3]);
    expect(r.hp(3)).toBe(10000);
    expect(r.results.filter((x) => x.r.outcome === "blocked").map((x) => [x.tick, x.r.candidate.targetId])).toEqual([[T0 + 24, 3]]);
    expect(r.hp(2)).toBe(8000);
  });

  test("maximum 4 targets across direct and wave, direct first then nearest wave targets", () => {
    const r = rig(6);
    r.place(2, 0, 1, -1); r.place(3, 0, 1, -2);
    r.place(4, 0, 1, -4); r.place(5, 0, 1, -5); r.place(6, 0, 1, -6);
    r.step(T0, 1);
    r.run(T0 + 1, T0 + 40);
    const damaged = [2, 3, 4, 5, 6].filter((id) => r.hp(id) < 10000);
    expect(damaged).toEqual([2, 3, 4, 5]);
    expect([2, 3, 4, 5].map((id) => r.hp(id))).toEqual([8000, 8000, 9000, 9000]);
    expect(r.hp(6)).toBe(10000);
  });

  test("counter consumes the direct hit and attaches no landing bonus", () => {
    const r = rig();
    r.cs.get(2)!.counterOpenUntil = T0 + 100;
    r.step(T0, 1);
    r.run(T0 + 1, T0 + 24);
    expect(r.results.filter((x) => x.r.outcome === "countered")).toHaveLength(1);
    expect(r.hp(2)).toBe(10000);
    expect(r.runner.landing.size).toBe(0);
    expect(r.cs.get(2)!.landingBonus).toBe(false);
  });

  test("miss: spends the cooldown; ready again exactly 1200 ticks after the accepted press", () => {
    const r = rig(1);
    r.step(T0, 1);
    r.run(T0 + 1, T0 + 100);
    expect(r.results).toHaveLength(0);
    r.step(T0 + 1199, 1);
    expect(r.outcomes.at(-1)!.o).toEqual({ kind: "rejected", reason: "COOLDOWN" });
    r.step(T0 + 1200, 1);
    expect(r.outcomes.at(-1)!.o.kind).toBe("started");
  });

  test("interruption: stun during startup cancels the cast with no damage and no wave; cooldown stays spent", () => {
    const r = rig(3);
    r.place(3, 0, 1, -6);
    r.step(T0, 1);
    r.run(T0 + 1, T0 + 9);
    applyReaction(r.cs.get(1)!, T0 + 10, { kind: "stun", ticks: 24 }, false);
    r.run(T0 + 10, T0 + 60);
    expect(r.hp(2)).toBe(10000);
    expect(r.hp(3)).toBe(10000);
    expect(r.runner.castOf(1)).toBeUndefined();
    r.step(T0 + 61, 1);
    expect(r.outcomes.at(-1)!.o).toEqual({ kind: "rejected", reason: "COOLDOWN" });
  });

  test("interruption in the same tick as activeStart (before resolution) voids the strike", () => {
    const r = rig();
    r.step(T0, 1);
    r.run(T0 + 1, T0 + 23);
    applyReaction(r.cs.get(1)!, T0 + 24, { kind: "stun", ticks: 24 }, false); // input phase of tick 24
    r.step(T0 + 24);
    expect(r.hp(2)).toBe(10000);
  });

  test("death of the attacker voids the strike; death after the direct hit drops the pending landing bonus", () => {
    const early = rig();
    early.step(T0, 1);
    early.run(T0 + 1, T0 + 10);
    early.cs.kill(1, T0 + 11);
    early.run(T0 + 11, T0 + 40);
    expect(early.hp(2)).toBe(10000);
    const late = rig();
    late.step(T0, 1);
    late.run(T0 + 1, T0 + 26);
    expect(late.hp(2)).toBe(8000);
    late.cs.kill(1, T0 + 27);
    late.run(T0 + 27, T0 + 30);
    late.poses.get(2)!.grounded = true;
    late.run(T0 + 31, T0 + 60);
    expect(late.hp(2)).toBe(8000);
    expect(late.runner.landing.size).toBe(0);
  });

  test("death of the victim: no hit on a dead target, a pending landing bonus is dropped and no damage after respawn", () => {
    const before = rig();
    before.step(T0, 1);
    before.run(T0 + 1, T0 + 10);
    kill(before.cs.get(2)!, T0 + 11);
    before.run(T0 + 12, T0 + 40);
    expect(before.cs.get(2)!.hp100).toBe(0);
    expect(before.results.filter((x) => x.r.outcome === "hit")).toHaveLength(0);
    const after = rig();
    after.step(T0, 1);
    after.run(T0 + 1, T0 + 26);
    after.cs.kill(2, T0 + 27);
    after.run(T0 + 27, T0 + 29);
    after.cs.respawn(2, T0 + 30, 99);
    after.cs.get(2)!.protectedUntilTick = 0;
    after.run(T0 + 30, T0 + 33);
    after.poses.get(2)!.grounded = true;
    after.run(T0 + 34, T0 + 60);
    expect(after.hp(2)).toBe(10000);
    expect(after.runner.landing.size).toBe(0);
  });

  test("lethal landing hit clamps to remaining HP and yields one KO", () => {
    const r = rig();
    r.step(T0, 1);
    r.run(T0 + 1, T0 + 26);
    r.cs.get(2)!.hp100 = 600;
    r.poses.get(2)!.grounded = true;
    r.run(T0 + 27, T0 + 30);
    expect(r.cs.get(2)!.action).toBe("Dead");
    expect(r.cs.get(2)!.hp100).toBe(0);
    expect(r.cs.get(2)!.koCount).toBe(1);
    expect(r.results.filter((x) => x.r.killed)).toHaveLength(1);
    expect(r.results.find((x) => x.r.killed)!.r.damage100).toBe(600);
  });
});
