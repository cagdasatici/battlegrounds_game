import { describe, expect, test } from "vitest";
import { SV_DEFS } from "../../packages/shared/src/config/kits/sv.js";
import { ALL_HANDLERS, buildKitRegistry } from "../../apps/server/src/kits/index.js";
import { buildAbilityRegistry, type AbilityRegistry } from "../../packages/shared/src/abilities.js";
import { applyReaction, enterCaptured, kill } from "../../apps/server/src/sim/ActionMachine.js";
import { M1System } from "../../apps/server/src/sim/M1.js";
import { CombatSystem } from "../../apps/server/src/sim/Combat.js";
import {
  AbilityRunner, type AbilityHost, type AbilityPose, type Launch, type SkillOutcome,
} from "../../apps/server/src/sim/AbilityRunner.js";
import type { HitResult } from "../../apps/server/src/sim/HitResolver.js";
import type { ReflectableProjectile, ReflectableProjectiles, ReflectOutcome } from "../../apps/server/src/sim/Reflect.js";

/**
 * T12 Stone Vanguard base moves (spec 15, A09). Uses the shipped registry and handlers with the real
 * AbilityRunner/CombatSystem driven in spec 12 tick order. Attacker 1 stands at the origin facing -Z (yaw 0);
 * victims face the attacker (yaw PI). Press ticks are explicit so every boundary is an exact integer tick.
 */
const T0 = 1000;
const def = (id: string) => SV_DEFS.find((d) => d.id === id)!;

interface Hit { tick: number; r: HitResult }

function rig(n = 2, projectiles?: ReflectableProjectiles, registry: AbilityRegistry = buildKitRegistry()) {
  const cs = new CombatSystem();
  const poses = new Map<number, AbilityPose>();
  for (let i = 1; i <= n; i++) cs.add(i, i, 0, "sv").protectedUntilTick = 0;
  poses.set(1, { x: 0, y: 1, z: 0, facingYaw: 0, grounded: true });
  for (let i = 2; i <= n; i++) poses.set(i, { x: 0, y: 1, z: -1.5, facingYaw: Math.PI, grounded: true });
  const host: AbilityHost = { combat: cs, pose: (id) => poses.get(id), blocked: () => false, ...(projectiles ? { projectiles } : {}) };
  const runner = new AbilityRunner(registry, ALL_HANDLERS, host);
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

describe("sv.b2 Gravel Flurry", () => {
  const SCHEDULE = [T0 + 10, T0 + 18, T0 + 26, T0 + 34, T0 + 42, T0 + 49];

  test("definition matches the spec 15 table", () => {
    const d = def("sv.b2");
    expect([d.slot, d.form, d.handler]).toEqual([2, "Base", "barrage"]);
    expect([d.startup, d.active, d.recovery, d.cooldown]).toEqual([10, 40, 18, 900]);
    expect(d.hitOffsets).toEqual([0, 8, 16, 24, 32, 39]);
    expect(d.damage100).toEqual([200, 200, 200, 200, 200, 500]);
    expect(d.damage100.reduce((a, b) => a + b, 0)).toBe(1500);
    expect([d.range, d.block, d.stunTicks, d.ragdollTicks, d.maxTargets, d.maxHitsPerTarget]).toEqual([2.5, "B", 12, 0, 3, 6]);
    expect([d.moveScale, d.turnRate, d.armor]).toEqual([0.15, 90, "none"]);
    expect(d.targetStates).toContain("ragdoll");
  });

  test("six hits on exact ticks: 2,2,2,2,2 then 5 HP (15 total)", () => {
    const r = rig();
    r.step(T0, 2);
    for (let t = T0 + 1; t <= T0 + 60; t++) {
      r.step(t);
      const done = SCHEDULE.filter((s) => s <= t).length;
      expect(r.hp(2)).toBe(10000 - (done === 6 ? 1500 : done * 200));
    }
    expect(r.hitsOn(2).map((x) => x.tick)).toEqual(SCHEDULE);
    expect(r.hitsOn(2).map((x) => x.r.damage100)).toEqual([200, 200, 200, 200, 200, 500]);
  });

  test("reactions: intermediate stun 12 at the hit tick, final ragdoll 60 with launch F7 U2", () => {
    const r = rig();
    r.step(T0, 2);
    r.run(T0 + 1, T0 + 10);
    expect(r.cs.get(2)!.action).toBe("Stunned");
    expect(r.cs.get(2)!.actionEndTick).toBe(T0 + 10 + 12);
    expect(r.launches).toHaveLength(0);
    r.run(T0 + 11, T0 + 49);
    const v = r.cs.get(2)!;
    expect(v.action).toBe("Ragdolled");
    expect([v.actionStartTick, v.actionEndTick]).toEqual([T0 + 49, T0 + 49 + 60]);
    expect(r.launches.map((x) => [x.tick, x.l.targetId, x.l.vx + 0, x.l.vy, x.l.vz])).toEqual([[T0 + 49, 2, 0, 2, -7]]);
  });

  test("movement scale 0.15 applies for the whole cast and ends at startTick+68", () => {
    const r = rig();
    r.step(T0, 2);
    expect(r.runner.moveScaleOf(1)).toBe(0.15);
    r.run(T0 + 1, T0 + 67);
    expect(r.runner.moveScaleOf(1)).toBe(0.15);
    r.step(T0 + 68);
    expect(r.runner.moveScaleOf(1)).toBeNull();
  });

  test("acceptance: a target entering only at offset 39 receives 5 HP, not the missed hits", () => {
    const r = rig();
    r.place(2, 0, 1, -9);
    r.step(T0, 2);
    r.run(T0 + 1, T0 + 48);
    r.place(2, 0, 1, -1.5);
    r.step(T0 + 49);
    expect(r.hp(2)).toBe(9500);
    expect(r.hitsOn(2)).toHaveLength(1);
    const mid = rig();
    mid.place(2, 0, 1, -9);
    mid.step(T0, 2);
    mid.run(T0 + 1, T0 + 25);
    mid.place(2, 0, 1, -1.5);
    mid.run(T0 + 26, T0 + 60);
    expect(mid.hp(2)).toBe(10000 - (200 + 200 + 200 + 500)); // hits at offsets 16, 24, 32 and 39 only
  });

  test("maximum 15 HP and 6 hits per target over the whole cast", () => {
    const r = rig();
    r.step(T0, 2);
    r.run(T0 + 1, T0 + 80);
    expect(r.hp(2)).toBe(8500);
    expect(r.hitsOn(2)).toHaveLength(6);
  });

  test("maximum 3 targets: the 4th and farthest is never hit", () => {
    const r = rig(5);
    r.place(2, 0, 1, -1); r.place(3, 0, 1, -1.5); r.place(4, 0, 1, -2); r.place(5, 0, 1, -2.4);
    r.step(T0, 2);
    r.run(T0 + 1, T0 + 60);
    expect([2, 3, 4].map((id) => r.hp(id))).toEqual([8500, 8500, 8500]);
    expect(r.hp(5)).toBe(10000);
  });

  test("block: guard blocks every group, each consumes its entry, no damage and no reactions", () => {
    const r = rig();
    r.run(T0 - 5, T0 - 1, [2]);
    r.step(T0, 2, [2]);
    r.run(T0 + 1, T0 + 60, [2]);
    expect(r.hp(2)).toBe(10000);
    expect(r.results.filter((x) => x.r.outcome === "blocked").map((x) => x.tick)).toEqual(SCHEDULE);
    expect(r.cs.get(2)!.action).toBe("Guard");
    expect(r.launches).toHaveLength(0);
  });

  test("counter consumes exactly one scheduled hit; the remaining five still land", () => {
    const r = rig();
    r.cs.get(2)!.counterOpenUntil = T0 + 12;
    r.step(T0, 2);
    r.run(T0 + 1, T0 + 60);
    expect(r.results.filter((x) => x.r.outcome === "countered").map((x) => x.tick)).toEqual([T0 + 10]);
    expect(r.hp(2)).toBe(10000 - 1300);
  });

  test("duplicate hit: one hit per target per tick group, never two in a tick", () => {
    const r = rig();
    r.step(T0, 2);
    r.run(T0 + 1, T0 + 60);
    const perTick = new Map<number, number>();
    for (const x of r.results) perTick.set(x.tick, (perTick.get(x.tick) ?? 0) + 1);
    expect([...perTick.values()].every((n) => n === 1)).toBe(true);
    expect(r.results.every((x) => x.r.outcome === "hit")).toBe(true);
  });

  test("supports ragdolled targets: damage only on intermediate hits (ragdoll kept), final hit re-ragdolls 60", () => {
    const r = rig();
    applyReaction(r.cs.get(2)!, T0 - 5, { kind: "ragdoll", ticks: 400 }, false);
    r.step(T0, 2);
    r.run(T0 + 1, T0 + 48);
    expect(r.cs.get(2)!.action).toBe("Ragdolled");
    expect(r.cs.get(2)!.actionStartTick).toBe(T0 - 5);
    expect(r.hp(2)).toBe(10000 - 1000);
    r.step(T0 + 49);
    expect(r.hp(2)).toBe(8500);
    expect([r.cs.get(2)!.actionStartTick, r.cs.get(2)!.actionEndTick]).toEqual([T0 + 49, T0 + 109]);
  });

  test("interruption: a stun on the attacker voids the remaining hits, including in the tick of a scheduled hit", () => {
    const r = rig();
    r.step(T0, 2);
    r.run(T0 + 1, T0 + 19);
    applyReaction(r.cs.get(1)!, T0 + 20, { kind: "stun", ticks: 24 }, false); // third party hit
    r.run(T0 + 20, T0 + 70);
    expect(r.hp(2)).toBe(9600);
    const same = rig();
    same.step(T0, 2);
    same.run(T0 + 1, T0 + 25);
    applyReaction(same.cs.get(1)!, T0 + 26, { kind: "stun", ticks: 24 }, false); // before the tick 26 query
    same.run(T0 + 26, T0 + 70);
    expect(same.hp(2)).toBe(9600);
    expect(same.runner.castOf(1)).toBeUndefined();
  });

  test("death of the attacker stops the flurry; death of the victim clamps and yields one KO", () => {
    const a = rig();
    a.step(T0, 2);
    a.run(T0 + 1, T0 + 29);
    a.cs.kill(1, T0 + 30);
    a.run(T0 + 30, T0 + 70);
    expect(a.hp(2)).toBe(9400);
    const v = rig();
    v.cs.get(2)!.hp100 = 300;
    v.step(T0, 2);
    v.run(T0 + 1, T0 + 70);
    expect(v.cs.get(2)!.action).toBe("Dead");
    expect(v.cs.get(2)!.koCount).toBe(1);
    expect(v.results.filter((x) => x.r.killed)).toHaveLength(1);
    expect(v.results.filter((x) => x.r.outcome === "hit").map((x) => x.r.damage100)).toEqual([200, 100]);
  });

  test("miss spends the cooldown; ready exactly 900 ticks after the press", () => {
    const r = rig(1);
    r.step(T0, 2);
    r.run(T0 + 1, T0 + 100);
    r.step(T0 + 899, 2);
    expect(r.outcomes.at(-1)!.o).toEqual({ kind: "rejected", reason: "COOLDOWN" });
    r.step(T0 + 900, 2);
    expect(r.outcomes.at(-1)!.o.kind).toBe("started");
  });
});

/** Fake projectile provider standing in for the T19 projectile system (spec 13 reflection rules). */
class FakeProjectiles implements ReflectableProjectiles {
  readonly list: (ReflectableProjectile & { damage100: number; alive: boolean; castCounter: number })[] = [];
  readonly calls: { id: number; newOwnerId: number; castCounter: number; tick: number }[] = [];
  add(id: number, ownerId: number, x: number, y: number, z: number, damage100 = 1500, radius = 0): void {
    this.list.push({ id, ownerId, x, y, z, radius, reflectCount: 0, damage100, alive: true, castCounter: 0 });
  }
  reflectable(): readonly ReflectableProjectile[] { return this.list.filter((p) => p.alive).sort((a, b) => a.id - b.id); }
  reflect(id: number, newOwnerId: number, castCounter: number, tick: number): ReflectOutcome {
    this.calls.push({ id, newOwnerId, castCounter, tick });
    const p = this.list.find((q) => q.id === id && q.alive);
    if (!p) return "rejected";
    if (p.reflectCount >= 1) { p.alive = false; return "absorbed"; } // second attempt absorbs with no damage
    p.ownerId = newOwnerId; p.reflectCount = 1; p.castCounter = castCounter;
    return "reflected";
  }
}

describe("sv.b3 Rift Palm", () => {
  test("definition matches the spec 15 table", () => {
    const d = def("sv.b3");
    expect([d.slot, d.form, d.handler]).toEqual([3, "Base", "reflectPalm"]);
    expect([d.startup, d.active, d.recovery, d.cooldown]).toEqual([8, 3, 14, 600]);
    expect(d.damage100).toEqual([700]);
    expect([d.range, d.block, d.stunTicks, d.ragdollTicks]).toEqual([2, "U", 30, 0]);
    expect(d.launch).toEqual({ forward: 2, up: 0 });
    expect(d.targetStates).toContain("ragdoll");
    expect(d.maxTargets).toBe(1);
  });

  test("melee hit at startTick+8: 7 HP, stun 30, launch F2 U0, no ragdoll, one hit over the 3 tick window", () => {
    const r = rig();
    r.step(T0, 3);
    r.run(T0 + 1, T0 + 7);
    expect(r.hp(2)).toBe(10000);
    r.step(T0 + 8);
    expect(r.hp(2)).toBe(9300);
    const v = r.cs.get(2)!;
    expect([v.action, v.actionStartTick, v.actionEndTick]).toEqual(["Stunned", T0 + 8, T0 + 38]);
    expect(r.launches.map((x) => [x.tick, x.l.targetId, x.l.vx + 0, x.l.vy, x.l.vz])).toEqual([[T0 + 8, 2, 0, 0, -2]]);
    r.run(T0 + 9, T0 + 30);
    expect(r.hitsOn(2).map((x) => x.tick)).toEqual([T0 + 8]);
    expect(r.hp(2)).toBe(9300);
  });

  test("guard bypass (U): a frontally guarding target is hit and no block is recorded", () => {
    const r = rig();
    r.run(T0 - 5, T0 - 1, [2]);
    r.step(T0, 3, [2]);
    r.run(T0 + 1, T0 + 10, [2]);
    expect(r.hp(2)).toBe(9300);
    expect(r.results.some((x) => x.r.outcome === "blocked")).toBe(false);
  });

  test("supports ragdolled targets: damage, stun 30 and launch apply", () => {
    const r = rig();
    applyReaction(r.cs.get(2)!, T0 - 5, { kind: "ragdoll", ticks: 200 }, false);
    r.step(T0, 3);
    r.run(T0 + 1, T0 + 8);
    expect(r.hp(2)).toBe(9300);
    expect(r.cs.get(2)!.action).toBe("Stunned");
    expect(r.launches).toHaveLength(1);
  });

  test("counter consumes the melee hit: no damage, no launch", () => {
    const r = rig();
    r.cs.get(2)!.counterOpenUntil = T0 + 100;
    r.step(T0, 3);
    r.run(T0 + 1, T0 + 12);
    expect(r.results.filter((x) => x.r.outcome === "countered").map((x) => x.tick)).toEqual([T0 + 8]);
    expect(r.hp(2)).toBe(10000);
    expect(r.launches).toHaveLength(0);
  });

  test("miss spends the cooldown; ready exactly 600 ticks after the press", () => {
    const r = rig(1);
    r.step(T0, 3);
    r.run(T0 + 1, T0 + 100);
    expect(r.results).toHaveLength(0);
    r.step(T0 + 599, 3);
    expect(r.outcomes.at(-1)!.o).toEqual({ kind: "rejected", reason: "COOLDOWN" });
    r.step(T0 + 600, 3);
    expect(r.outcomes.at(-1)!.o.kind).toBe("started");
  });

  test("target entering during the window is still hit once; leaving before activeStart or after activeEnd is a miss", () => {
    const r = rig();
    r.place(2, 0, 1, -4);
    r.step(T0, 3);
    r.run(T0 + 1, T0 + 8);
    r.place(2, 0, 1, -1.5);
    r.step(T0 + 9);
    expect(r.hitsOn(2).map((x) => x.tick)).toEqual([T0 + 9]);
    const late = rig();
    late.place(2, 0, 1, -4);
    late.step(T0, 3);
    late.run(T0 + 1, T0 + 10);
    late.place(2, 0, 1, -1.5);
    late.run(T0 + 11, T0 + 20); // activeEnd is T0+11 (exclusive)
    expect(late.hp(2)).toBe(10000);
  });

  test("interruption: stun during startup (and in the activeStart tick) cancels the palm", () => {
    const r = rig();
    r.step(T0, 3);
    r.run(T0 + 1, T0 + 4);
    applyReaction(r.cs.get(1)!, T0 + 5, { kind: "stun", ticks: 24 }, false);
    r.run(T0 + 5, T0 + 30);
    expect(r.hp(2)).toBe(10000);
    const same = rig();
    same.step(T0, 3);
    same.run(T0 + 1, T0 + 7);
    applyReaction(same.cs.get(1)!, T0 + 8, { kind: "stun", ticks: 24 }, false);
    same.run(T0 + 8, T0 + 30);
    expect(same.hp(2)).toBe(10000);
  });

  test("death of the attacker voids the palm; death of the victim clamps and yields one KO", () => {
    const a = rig();
    a.step(T0, 3);
    a.run(T0 + 1, T0 + 5);
    a.cs.kill(1, T0 + 6);
    a.run(T0 + 6, T0 + 30);
    expect(a.hp(2)).toBe(10000);
    const v = rig();
    v.cs.get(2)!.hp100 = 300;
    v.step(T0, 3);
    v.run(T0 + 1, T0 + 12);
    expect(v.cs.get(2)!.action).toBe("Dead");
    expect(v.cs.get(2)!.koCount).toBe(1);
    expect(v.results.find((x) => x.r.killed)!.r.damage100).toBe(300);
    expect(v.launches).toHaveLength(0);
  });

  describe("reflection (fake T19 provider; the real Ember Orb acceptance is pending T19)", () => {
    test("a projectile in the 1.8 m frontal hemisphere is reflected on the first active tick, once per cast", () => {
      const pr = new FakeProjectiles();
      pr.add(10, 2, 0, 1, -1.2);
      pr.add(11, 2, 0, 1, -1.0);
      const r = rig(2, pr);
      r.step(T0, 3);
      r.run(T0 + 1, T0 + 7);
      expect(pr.calls).toHaveLength(0); // not during startup
      r.step(T0 + 8);
      expect(pr.calls).toEqual([{ id: 11, newOwnerId: 1, castCounter: 1, tick: T0 + 8 }]); // nearest first
      expect(pr.list.find((p) => p.id === 11)!.ownerId).toBe(1);
      r.run(T0 + 9, T0 + 12);
      expect(pr.calls).toHaveLength(1); // at most one reflected projectile per cast
      expect(pr.list.find((p) => p.id === 10)!.ownerId).toBe(2);
      expect(r.runner.castOf(1)!.data.reflectedProjectileIds).toEqual([11]);
    });

    test("reflect preserves damage, grants no damage or meter, and does not reset the cooldown", () => {
      const pr = new FakeProjectiles();
      pr.add(10, 2, 0, 1, -1.2, 2500);
      const r = rig(2, pr);
      r.step(T0, 3);
      r.run(T0 + 1, T0 + 8);
      expect(pr.list[0]!.damage100).toBe(2500);
      expect(pr.list[0]!.reflectCount).toBe(1);
      expect(r.cs.get(1)!.cooldowns.get("sv.b3")).toBe(T0 + 600);
      r.run(T0 + 9, T0 + 40);
      r.step(T0 + 599, 3);
      expect(r.outcomes.at(-1)!.o).toEqual({ kind: "rejected", reason: "COOLDOWN" });
    });

    test("a projectile can be reflected in a later active tick; behind, beyond 1.8 m, own or after activeEnd is ignored", () => {
      const pr = new FakeProjectiles();
      pr.add(1, 2, 0, 1, 1.0); // behind the palm
      pr.add(2, 2, 0, 1, -2.2); // outside 1.8 m
      pr.add(3, 1, 0, 1, -1.0); // own projectile
      const r = rig(2, pr);
      r.step(T0, 3);
      r.run(T0 + 1, T0 + 8);
      expect(pr.calls).toHaveLength(0);
      pr.add(4, 2, 0, 1, -1.5);
      r.step(T0 + 9);
      expect(pr.calls.map((c) => c.id)).toEqual([4]);
      const late = new FakeProjectiles();
      const l = rig(2, late);
      l.step(T0, 3);
      l.run(T0 + 1, T0 + 10);
      late.add(5, 2, 0, 1, -1.0);
      l.run(T0 + 11, T0 + 30); // activeEnd T0+11 exclusive
      expect(late.calls).toHaveLength(0);
    });

    test("projectile radius extends the reach: centre at 2.2 m with radius 0.5 is reflectable", () => {
      const pr = new FakeProjectiles();
      pr.add(7, 2, 0, 1, -2.2, 1500, 0.5);
      const r = rig(2, pr);
      r.step(T0, 3);
      r.run(T0 + 1, T0 + 8);
      expect(pr.calls.map((c) => c.id)).toEqual([7]);
    });

    test("cannot bounce indefinitely: an already reflected projectile is absorbed, not returned, and uses the cast's one interaction", () => {
      const pr = new FakeProjectiles();
      pr.add(10, 2, 0, 1, -1.0);
      pr.list[0]!.reflectCount = 1; // already bounced once by someone else
      pr.add(11, 2, 0, 1, -1.5);
      const r = rig(2, pr);
      r.step(T0, 3);
      r.run(T0 + 1, T0 + 12);
      expect(pr.list[0]!.alive).toBe(false); // absorbed, no damage anywhere
      expect(pr.list[0]!.ownerId).toBe(2);
      expect(pr.calls.map((c) => c.id)).toEqual([10]);
      expect(pr.list[1]!.ownerId).toBe(2); // second projectile untouched this cast
      expect(r.runner.castOf(1)!.data.reflectedProjectileIds).toBeUndefined();
      expect(r.hitsOn(2).every((x) => x.r.candidate.moveId === "sv.b3")).toBe(true);
    });

    test("melee branch is independent: reflect one projectile and still hit one other target", () => {
      const pr = new FakeProjectiles();
      pr.add(10, 3, 0, 1, -1.0);
      const r = rig(3, pr);
      r.place(3, 5, 1, 5); // projectile owner is far away and not in the palm box
      r.step(T0, 3);
      r.run(T0 + 1, T0 + 12);
      expect(pr.list[0]!.ownerId).toBe(1);
      expect(r.hp(2)).toBe(9300);
      expect(r.hp(3)).toBe(10000);
    });

    test("without a projectile provider only the melee branch runs", () => {
      const r = rig();
      r.step(T0, 3);
      r.run(T0 + 1, T0 + 10);
      expect(r.hp(2)).toBe(9300);
    });

    test("a rejected projectile does not consume the cast's reflect", () => {
      const pr = new FakeProjectiles();
      pr.add(1, 2, 0, 1, -1.0);
      pr.add(2, 2, 0, 1, -1.5);
      const origReflect = pr.reflect.bind(pr);
      pr.reflect = (id, o, c, t) => (id === 1 ? (pr.calls.push({ id, newOwnerId: o, castCounter: c, tick: t }), "rejected") : origReflect(id, o, c, t));
      const r = rig(2, pr);
      r.step(T0, 3);
      r.run(T0 + 1, T0 + 8);
      expect(pr.calls.map((c) => c.id)).toEqual([1, 2]);
      expect(pr.list.find((p) => p.id === 2)!.ownerId).toBe(1);
    });
  });
});

describe("sv.b4 Rising Pillar", () => {
  test("definition matches the spec 15 table", () => {
    const d = def("sv.b4");
    expect([d.slot, d.form, d.handler]).toEqual([4, "Base", "launcher"]);
    expect([d.startup, d.active, d.recovery, d.cooldown]).toEqual([16, 4, 20, 900]);
    expect(d.damage100).toEqual([1500]);
    expect([d.range, d.block, d.ragdollTicks]).toEqual([2, "U", 84]);
    expect(d.launch).toEqual({ forward: 1, up: 11 });
    expect(d.targetStates).toEqual(["standing", "air", "ragdoll"]);
  });

  test("hit at startTick+16: 15 HP, ragdoll 84, launch F1 U11, one hit over the 4 tick window", () => {
    const r = rig();
    r.step(T0, 4);
    r.run(T0 + 1, T0 + 15);
    expect(r.hp(2)).toBe(10000);
    r.step(T0 + 16);
    expect(r.hp(2)).toBe(8500);
    const v = r.cs.get(2)!;
    expect([v.action, v.actionStartTick, v.actionEndTick]).toEqual(["Ragdolled", T0 + 16, T0 + 16 + 84]);
    expect(r.launches.map((x) => [x.tick, x.l.targetId, x.l.vx + 0, x.l.vy, x.l.vz])).toEqual([[T0 + 16, 2, 0, 11, -1]]);
    r.run(T0 + 17, T0 + 40);
    expect(r.hitsOn(2).map((x) => x.tick)).toEqual([T0 + 16]);
    expect(r.hp(2)).toBe(8500);
  });

  test("guard bypass (U): a frontally guarding target is launched anyway", () => {
    const r = rig();
    r.run(T0 - 5, T0 - 1, [2]);
    r.step(T0, 4, [2]);
    r.run(T0 + 1, T0 + 16, [2]);
    expect(r.hp(2)).toBe(8500);
    expect(r.cs.get(2)!.action).toBe("Ragdolled");
    expect(r.results.some((x) => x.r.outcome === "blocked")).toBe(false);
  });

  test("supports ragdolled targets: re-launched with a fresh ragdoll", () => {
    const r = rig();
    applyReaction(r.cs.get(2)!, T0 - 10, { kind: "ragdoll", ticks: 300 }, false);
    r.step(T0, 4);
    r.run(T0 + 1, T0 + 16);
    expect(r.hp(2)).toBe(8500);
    expect([r.cs.get(2)!.actionStartTick, r.cs.get(2)!.actionEndTick]).toEqual([T0 + 16, T0 + 100]);
    expect(r.launches).toHaveLength(1);
  });

  test("aerial use is relative to the authoritative capsule: attacker and target airborne; vertical reach 2.1 m", () => {
    const r = rig();
    r.poses.set(1, { x: 0, y: 6, z: 0, facingYaw: 0, grounded: false });
    r.place(2, 0, 8.0, -1.5, false);
    r.step(T0, 4);
    r.run(T0 + 1, T0 + 16);
    expect(r.hp(2)).toBe(8500);
    const miss = rig();
    miss.poses.set(1, { x: 0, y: 6, z: 0, facingYaw: 0, grounded: false });
    miss.place(2, 0, 8.3, -1.5, false);
    miss.step(T0, 4);
    miss.run(T0 + 1, T0 + 30);
    expect(miss.hp(2)).toBe(10000);
    const below = rig();
    below.poses.set(1, { x: 0, y: 6, z: 0, facingYaw: 0, grounded: false });
    below.place(2, 0, 4.5, -1.5, false);
    below.step(T0, 4);
    below.run(T0 + 1, T0 + 16);
    expect(below.hp(2)).toBe(8500); // box spans 1.0 below the attacker centre plus the capsule
    // The server pose carries no camera pitch at all.
    expect(Object.keys(below.poses.get(1)!).sort()).toEqual(["facingYaw", "grounded", "x", "y", "z"]);
  });

  test("no extra damage when landing, even for an airborne victim that gets the generic landing flag", () => {
    const r = rig();
    r.poses.set(1, { x: 0, y: 6, z: 0, facingYaw: 0, grounded: false });
    r.place(2, 0, 6.5, -1.5, false);
    r.step(T0, 4);
    r.run(T0 + 1, T0 + 20);
    expect(r.hp(2)).toBe(8500);
    expect(r.runner.landing.size).toBe(0);
    r.place(2, 0, 1, -1.5, true); // lands
    r.run(T0 + 21, T0 + 200);
    expect(r.hp(2)).toBe(8500);
  });

  test("a target captured by another attacker is ineligible until released", () => {
    const r = rig(3);
    r.place(3, 4, 1, 4);
    const captor = r.cs.get(3)!;
    r.cs.captures.tryCapture({
      victimId: 2, captorId: 3, captorGeneration: captor.generation, castCounter: 1, moveId: "td.b1", cinematic: false,
      startTick: T0, endTick: T0 + 500,
    });
    enterCaptured(r.cs.get(2)!, T0, "td.b1");
    r.step(T0, 4);
    r.run(T0 + 1, T0 + 40);
    expect(r.hp(2)).toBe(10000);
    expect(r.cs.get(2)!.action).toBe("Captured");
    expect(r.results).toHaveLength(0);
    // Released before activeStart: eligible again.
    const rel = rig(3);
    rel.place(3, 4, 1, 4);
    rel.cs.captures.tryCapture({
      victimId: 2, captorId: 3, captorGeneration: rel.cs.get(3)!.generation, castCounter: 1, moveId: "td.b1", cinematic: false,
      startTick: T0, endTick: T0 + 500,
    });
    enterCaptured(rel.cs.get(2)!, T0, "td.b1");
    rel.step(T0, 4);
    rel.run(T0 + 1, T0 + 9);
    rel.cs.releaseFinal(2, T0 + 10);
    rel.run(T0 + 10, T0 + 16);
    expect(rel.hp(2)).toBe(8500);
  });

  test("animation playback speed cannot change the active tick or the launch velocity", () => {
    const base = rig();
    const slow = buildAbilityRegistry(
      SV_DEFS.map((d) => (d.id === "sv.b4" ? { ...d, animationId: "sv.b4.anim.slow", vfxId: "x", sfxId: "y" } : d)),
      new Set(ALL_HANDLERS.map((h) => h.name)),
    );
    const alt = rig(2, undefined, slow);
    for (const r of [base, alt]) { r.step(T0, 4); r.run(T0 + 1, T0 + 30); }
    const key = (r: ReturnType<typeof rig>) => [r.hitsOn(2).map((x) => x.tick), r.launches.map((x) => [x.tick, x.l.vx + 0, x.l.vy, x.l.vz])];
    expect(key(alt)).toEqual(key(base));
    expect(key(base)[0]).toEqual([T0 + 16]);
  });

  test("counter consumes the hit: no damage, no launch", () => {
    const r = rig();
    r.cs.get(2)!.counterOpenUntil = T0 + 100;
    r.step(T0, 4);
    r.run(T0 + 1, T0 + 20);
    expect(r.results.filter((x) => x.r.outcome === "countered").map((x) => x.tick)).toEqual([T0 + 16]);
    expect(r.hp(2)).toBe(10000);
    expect(r.launches).toHaveLength(0);
  });

  test("miss spends the cooldown; ready exactly 900 ticks after the press", () => {
    const r = rig(1);
    r.step(T0, 4);
    r.run(T0 + 1, T0 + 100);
    expect(r.results).toHaveLength(0);
    r.step(T0 + 899, 4);
    expect(r.outcomes.at(-1)!.o).toEqual({ kind: "rejected", reason: "COOLDOWN" });
    r.step(T0 + 900, 4);
    expect(r.outcomes.at(-1)!.o.kind).toBe("started");
  });

  test("interruption: stun in startup or in the activeStart tick cancels the pillar; a stun after the hit changes nothing", () => {
    const r = rig();
    r.step(T0, 4);
    r.run(T0 + 1, T0 + 9);
    applyReaction(r.cs.get(1)!, T0 + 10, { kind: "stun", ticks: 24 }, false);
    r.run(T0 + 10, T0 + 40);
    expect(r.hp(2)).toBe(10000);
    const same = rig();
    same.step(T0, 4);
    same.run(T0 + 1, T0 + 15);
    applyReaction(same.cs.get(1)!, T0 + 16, { kind: "stun", ticks: 24 }, false);
    same.run(T0 + 16, T0 + 40);
    expect(same.hp(2)).toBe(10000);
    const after = rig();
    after.step(T0, 4);
    after.run(T0 + 1, T0 + 16);
    applyReaction(after.cs.get(1)!, T0 + 17, { kind: "stun", ticks: 24 }, false);
    after.run(T0 + 17, T0 + 40);
    expect(after.hp(2)).toBe(8500);
  });

  test("death of the attacker voids the pillar; death of the victim clamps and yields one KO", () => {
    const a = rig();
    a.step(T0, 4);
    a.run(T0 + 1, T0 + 9);
    a.cs.kill(1, T0 + 10);
    a.run(T0 + 10, T0 + 40);
    expect(a.hp(2)).toBe(10000);
    const v = rig();
    v.cs.get(2)!.hp100 = 900;
    v.step(T0, 4);
    v.run(T0 + 1, T0 + 40);
    expect(v.cs.get(2)!.action).toBe("Dead");
    expect(v.cs.get(2)!.koCount).toBe(1);
    expect(v.results.find((x) => x.r.killed)!.r.damage100).toBe(900);
    expect(v.launches).toHaveLength(0);
    const early = rig();
    early.step(T0, 4);
    early.run(T0 + 1, T0 + 8);
    kill(early.cs.get(2)!, T0 + 9);
    early.run(T0 + 10, T0 + 40);
    expect(early.results.filter((x) => x.r.outcome === "hit")).toHaveLength(0);
  });
});

describe("base abilities and M1 chain progression", () => {
  const held = (a: boolean) => ({ attackHeld: a, blockHeld: false, jumpHeld: false });
  const pose = { x: 0, y: 1, z: 0, facingYaw: 0, grounded: true };
  // slot, total ticks (startup + active + recovery)
  const cases: [1 | 2 | 3 | 4, number][] = [[1, 52], [2, 68], [3, 25], [4, 40]];

  test.each(cases)("slot %i does not reset the chain: next index stays 1 while casting; resets only after a gap above 54", (slot, total) => {
    const r = rig(1);
    const m1 = new M1System();
    const f = r.cs.get(1)!;
    r.step(T0);
    expect(m1.update(f, T0, held(true), pose)?.ok).toBe(true); // m1.1: ends T0+21
    for (let t = T0 + 1; t < T0 + 21; t++) { r.step(t); m1.update(f, t, held(false), pose); }
    const lastEnd = T0 + 21;
    r.step(lastEnd, slot);
    expect(r.outcomes.at(-1)!.o.kind).toBe("started");
    for (let t = lastEnd + 1; t < lastEnd + total; t++) {
      r.step(t);
      if (t - lastEnd <= 54) expect(m1.nextIndex(f, t)).toBe(1);
      expect(m1.update(f, t, held(true), pose)).toBeNull(); // no M1 while a base cast is running
    }
    r.step(lastEnd + total);
    expect(f.action).toBe("Idle");
    const gap = total;
    expect(m1.nextIndex(f, lastEnd + total)).toBe(gap > 54 ? 0 : 1);
    expect(m1.nextIndex(f, lastEnd + 54)).toBe(1); // a gap of exactly 54 continues the chain
    expect(m1.nextIndex(f, lastEnd + 55)).toBe(0); // a gap above 54 resets normally
    if (gap <= 54) {
      const next = m1.update(f, lastEnd + total, held(true), pose);
      expect(next?.ok).toBe(true);
      expect(f.moveId).toBe("m1.2");
    }
  });
});
