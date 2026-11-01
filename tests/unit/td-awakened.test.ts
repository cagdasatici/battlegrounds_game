import { describe, expect, test } from "vitest";
import { TD_DEFS } from "../../packages/shared/src/config/kits/td.js";
import { ALL_HANDLERS, buildKitRegistry } from "../../apps/server/src/kits/index.js";
import { segmentDistance } from "../../apps/server/src/kits/td/riptidePursuit.js";
import { COMBAT } from "../../packages/shared/src/config/combat.js";
import { CAPTOR_RELEASE_RECOVERY } from "../../apps/server/src/sim/ActionMachine.js";
import { CombatSystem } from "../../apps/server/src/sim/Combat.js";
import { AbilityRunner, type AbilityHost, type AbilityPose, type SkillOutcome } from "../../apps/server/src/sim/AbilityRunner.js";
import { AwakeningSystem } from "../../apps/server/src/sim/Awakening.js";
import type { HitCandidate, HitResult } from "../../apps/server/src/sim/HitResolver.js";
import type { Release } from "../../apps/server/src/sim/CaptureRegistry.js";

/**
 * Tide Duelist awakened moves (T16): td.a1 Cascade Chain, td.a2 Deepfall, td.a3 Split Tide, td.a4 Riptide Pursuit.
 * Driven tick by tick in the room's order (expiry, buffered intent, input, collision query, serial resolution,
 * handler results) against a fake host, so every boundary is an exact integer tick.
 */
const T0 = 1000;
const HP = COMBAT.hp100Max;

const reg = buildKitRegistry();
const def = (id: string) => reg.byId(id)!;

function makeRig(n = 3, hostOpts: { moveTogether?: AbilityHost["moveTogether"] } = {}) {
  const cs = new CombatSystem();
  const poses = new Map<number, AbilityPose>();
  for (let i = 1; i <= n; i++) cs.add(i, i, 0, "td").protectedUntilTick = 0;
  // 1: Tide Duelist at the origin facing -Z (awaken() makes the form Awakened). 2: victim 1.5 m ahead. 3: second fighter
  // 3 m ahead and slightly right. 4 and up: far bystanders, placed per test.
  poses.set(1, { x: 0, y: 1, z: 0, facingYaw: 0, grounded: true });
  poses.set(2, { x: 0, y: 1, z: -1.5, facingYaw: Math.PI, grounded: true });
  if (n >= 3) poses.set(3, { x: 0.3, y: 1, z: -3, facingYaw: Math.PI, grounded: true });
  for (let i = 4; i <= n; i++) poses.set(i, { x: 30 + i, y: 1, z: -2, facingYaw: Math.PI, grounded: true });
  let wallZ: number | null = null; // a wall plane at z = wallZ blocks any segment that crosses it
  let occluded = false;
  const launches: { id: number; vx: number; vy: number; vz: number; tick: number }[] = [];
  const moves: { ids: number[]; dx: number; dz: number; tick: number }[] = [];
  const releases: { rel: Release; tick: number }[] = [];
  cs.onRelease = (rel, tick) => { releases.push({ rel, tick }); };
  let curTick = T0;
  const host: AbilityHost = {
    combat: cs, pose: (id) => poses.get(id),
    blocked: (a, b) => occluded || (wallZ !== null && (a[2] - wallZ) * (b[2] - wallZ) < 0),
    launch: (id, vx, vy, vz) => { launches.push({ id, vx, vy, vz, tick: curTick }); },
    moveTogether: hostOpts.moveTogether ?? ((ids, dx, dz) => {
      moves.push({ ids: [...ids], dx, dz, tick: curTick });
      for (const i of ids) { const p = poses.get(i)!; p.x += dx; p.z += dz; }
      return { dx, dz };
    }),
  };
  const runner = new AbilityRunner(reg, ALL_HANDLERS, host);
  const results: { tick: number; r: HitResult }[] = [];
  const outcomes: { tick: number; who: number; o: SkillOutcome }[] = [];
  let strikeSeq = 100;
  /** A third party ordinary hit (counterable stun by default) not tied to any ability cast. */
  const strike = (a: number, t: number, o: Partial<HitCandidate> = {}): HitCandidate => ({
    attackerId: a, attackerGeneration: cs.get(a)!.generation, castCounter: ++strikeSeq, hitIndex: 0, toi: 0, targetId: t,
    moveId: "test.strike", originX: poses.get(a)?.x ?? 0, originZ: poses.get(a)?.z ?? 0, block: "U", counterable: true,
    armorBreak: false, damage100: 300, reaction: { kind: "stun", ticks: 24 }, maxHitsPerTarget: 1, ...o,
  });
  interface StepOpts { press?: { who?: number; slot: 1 | 2 | 3 | 4 }[]; extra?: HitCandidate[]; guard?: number[] }
  const step = (tick: number, o: StepOpts = {}): HitResult[] => {
    curTick = tick;
    cs.expire(tick, (id) => poses.get(id)?.grounded ?? true);
    for (let i = 1; i <= n; i++) {
      const f = cs.get(i);
      if (!f) continue;
      const b = runner.consumeBuffer(f, tick);
      if (b) outcomes.push({ tick, who: i, o: b.outcome });
    }
    for (const p of o.press ?? []) {
      const f = cs.get(p.who ?? 1);
      if (f) outcomes.push({ tick, who: p.who ?? 1, o: runner.skillDown(f, tick, p.slot, 1) });
    }
    for (const id of o.guard ?? []) cs.updateGuard(id, tick, true, true);
    const cands = [...runner.collect(tick), ...(o.extra ?? [])];
    const res = cs.resolve(tick, cands, (id) => { const q = poses.get(id); return q && { x: q.x, z: q.z, facingYaw: q.facingYaw, grounded: q.grounded }; });
    runner.afterResolve(tick, res);
    for (const r of res) results.push({ tick, r });
    expect(cs.invariantViolations()).toEqual([]);
    return res;
  };
  const run = (from: number, to: number, opts?: (t: number) => StepOpts | undefined): void => {
    for (let t = from; t <= to; t++) step(t, opts?.(t));
  };
  const hp = (id: number): number => cs.get(id)!.hp100;
  const awaken = (): void => { const f = cs.get(1)!; f.form = "Awakened"; f.awakenedUsedMask = 0; };
  /** Damage events (tick, damage100) dealt by `a` to `t` that took effect, in order. */
  const dealt = (a: number, t: number) => results.filter((x) => x.r.candidate.attackerId === a && x.r.candidate.targetId === t && x.r.damage100 > 0 && (x.r.outcome === "hit" || x.r.outcome === "captured"))
    .map((x) => [x.tick, x.r.damage100] as const);
  const outs = (): string[] => results.map((x) => x.r.outcome);
  return {
    cs, poses, runner, host, results, outcomes, launches, moves, releases, strike, step, run, hp, dealt, awaken, outs,
    setWallZ: (z: number | null) => { wallZ = z; }, setOccluded: (v: boolean) => { occluded = v; },
  };
}
type Rig = ReturnType<typeof makeRig>;
const put = (r: Rig, id: number, x: number, z: number, y = 1): void => { r.poses.set(id, { x, y, z, facingYaw: Math.PI, grounded: true }); };
const started = (r: Rig, moveId: string): void => { expect(r.outcomes.at(-1)!.o).toMatchObject({ kind: "started", moveId }); };

describe("td awakened definitions match the spec 15 table", () => {
  test("slotted awakened moves carry the exact table numbers", () => {
    expect(TD_DEFS.filter((d) => d.form === "Awakened").map((d) => d.id)).toEqual(["td.a1", "td.a2", "td.a3", "td.a4"]);
    const table: Record<string, [number, number, number, number, number, string, string, boolean, boolean, boolean]> = {
      // startup, active, recovery, cooldown, range, block, handler, oncePerForm, consumesForm, armorBreak
      "td.a1": [8, 5, 16, 510, 2.5, "U", "cascadeChain", false, false, false],
      "td.a2": [16, 5, 30, 0, 2.5, "U", "deepfall", true, false, true],
      "td.a3": [16, 18, 24, 840, 3, "U", "splitTide", false, false, false],
      "td.a4": [12, 30, 30, 570, 9, "U", "riptidePursuit", false, false, false],
    };
    for (const id of Object.keys(table)) {
      const d = def(id);
      expect([d.startup, d.active, d.recovery, d.cooldown, d.range, d.block, d.handler, d.oncePerForm, d.consumesForm, d.armorBreak]).toEqual(table[id]);
      expect(d.form).toBe("Awakened");
    }
    expect(def("td.a1").hitOffsets).toEqual([0, 8, 16, 24, 32]);
    expect(def("td.a1").damage100).toEqual([400, 400, 400, 400, 1000]);
    expect(def("td.a1").damage100.reduce((a, b) => a + b, 0)).toBe(2600);
    expect(def("td.a2").hitOffsets).toEqual([0, 72]);
    expect(def("td.a2").damage100).toEqual([0, 6900]);
    expect(def("td.a2").maxTargets).toBe(4);
    expect(def("td.a3").hitOffsets).toEqual([0, 17]);
    expect(def("td.a3").damage100).toEqual([1200, 2600]);
    expect(def("td.a3").stunTicks).toBe(30);
    expect(def("td.a4").hitOffsets).toEqual([0, 36]);
    expect(def("td.a4").damage100).toEqual([800, 2200]);
  });
});

describe("td.a1 Cascade Chain (cascadeChain)", () => {
  const C = T0 + 8; // capture tick = activeStart

  test("hit: capture at activeStart, [4,4,4,4,10] at capture+[0,8,16,24,32], release +33 R60 F5 U4, recovery 16", () => {
    const r = makeRig(2);
    r.awaken();
    r.step(T0, { press: [{ slot: 1 }] });
    started(r, "td.a1");
    r.run(T0 + 1, C - 1);
    expect(r.cs.get(1)!.action).toBe("Windup");
    expect(r.cs.get(1)!.armored).toBe(false);
    r.step(C);
    expect(r.cs.get(2)!.action).toBe("Captured");
    expect(r.cs.get(1)!.armored).toBe(true); // armor on capture
    r.run(C + 1, C + 32);
    expect(r.dealt(1, 2)).toEqual([[C, 400], [C + 8, 400], [C + 16, 400], [C + 24, 400], [C + 32, 1000]]);
    expect(r.hp(2)).toBe(HP - 2600);
    expect(r.cs.get(2)!.action).toBe("Captured");
    r.step(C + 33);
    const v = r.cs.get(2)!;
    expect(v.action).toBe("Ragdolled");
    expect(v.actionEndTick - v.actionStartTick).toBe(60);
    expect(r.cs.captures.size).toBe(0);
    expect(r.launches.map((l) => [l.id, l.vx + 0, l.vy, l.vz, l.tick])).toEqual([[2, 0, 4, -5, C + 33]]);
    expect(r.releases.map((x) => [x.tick, x.rel.cause])).toEqual([[C + 33, "final"]]);
    expect(r.cs.get(1)!.armored).toBe(false);
    r.run(C + 34, C + 33 + 15);
    expect(r.cs.get(1)!.action).toBe("Recovery");
    r.step(C + 33 + 16);
    expect(r.cs.get(1)!.action).toBe("Idle");
    expect(r.hp(2)).toBe(HP - 2600);
    expect(r.cs.get(1)!.form).toBe("Awakened"); // not a consuming move
  });

  test("the capture hit is index 0: five damage events in all, never six", () => {
    const r = makeRig(2);
    r.awaken();
    r.step(T0, { press: [{ slot: 1 }] });
    r.run(T0 + 1, T0 + 120);
    expect(r.dealt(1, 2).length).toBe(5);
    expect(r.results.filter((x) => x.r.outcome === "captured").length).toBe(1);
  });

  test("capture supports standing, air and ragdoll (grounded or airborne) targets", () => {
    for (const mode of ["air", "ragdoll", "airRagdoll"] as const) {
      const r = makeRig(2);
      r.awaken();
      const p = r.poses.get(2)!;
      if (mode !== "ragdoll") p.grounded = false;
      if (mode !== "air") r.cs.get(2)!.action = "Ragdolled", r.cs.get(2)!.actionStartTick = T0 - 5, r.cs.get(2)!.actionEndTick = T0 + 400;
      r.step(T0, { press: [{ slot: 1 }] });
      r.run(T0 + 1, C);
      expect(r.cs.captures.size, mode).toBe(1);
    }
  });

  test("miss: no capture, recovery starts at the end of the probe window, cooldown 510 from the press", () => {
    const r = makeRig(2);
    r.awaken();
    r.poses.get(2)!.z = -5;
    r.step(T0, { press: [{ slot: 1 }] });
    r.run(T0 + 1, C + 4);
    expect(r.cs.get(1)!.action).toBe("Active");
    r.step(C + 5);
    expect(r.cs.get(1)!.action).toBe("Recovery");
    expect(r.runner.castOf(1)!.activeEnd).toBe(C + 5);
    r.poses.get(2)!.z = -1.5; // steps into reach after the window: nothing may attach
    r.run(C + 6, C + 5 + 15);
    expect(r.cs.get(2)!.action).toBe("Idle");
    expect(r.results.length).toBe(0);
    r.step(C + 5 + 16);
    expect(r.cs.get(1)!.action).toBe("Idle");
    r.step(T0 + 509, { press: [{ slot: 1 }] });
    expect(r.outcomes.at(-1)!.o).toEqual({ kind: "rejected", reason: "COOLDOWN" });
    r.step(T0 + 510, { press: [{ slot: 1 }] });
    started(r, "td.a1");
  });

  test("block: U ignores a frontal guard", () => {
    const r = makeRig(2);
    r.awaken();
    r.run(T0 - 10, T0 - 1, () => ({ guard: [2] }));
    r.step(T0, { press: [{ slot: 1 }], guard: [2] });
    r.run(T0 + 1, C + 10, () => ({ guard: [2] }));
    expect(r.cs.get(2)!.action).toBe("Captured");
    expect(r.outs().includes("blocked")).toBe(false);
  });

  test("counter: the counterable initial hit is intercepted, nothing is captured, no duplicate counter", () => {
    const r = makeRig(2);
    r.awaken();
    r.cs.get(2)!.counterOpenUntil = T0 + 100;
    r.step(T0, { press: [{ slot: 1 }] });
    r.run(T0 + 1, C + 8);
    const o = r.outs();
    expect(o[0]).toBe("countered");
    expect(o.slice(1).every((x) => x === "duplicate")).toBe(true);
    expect(r.cs.get(2)!.counterOpenUntil).toBe(0);
    expect(r.hp(2)).toBe(HP);
    expect(r.cs.captures.size).toBe(0);
    expect(r.cs.get(1)!.armored).toBe(false);
  });

  test("scheduled hits are noncounterable even when the victim opens a counter mid sequence", () => {
    const r = makeRig(2);
    r.awaken();
    r.step(T0, { press: [{ slot: 1 }] });
    r.run(T0 + 1, C + 4);
    r.cs.get(2)!.counterOpenUntil = T0 + 500;
    r.run(C + 5, C + 33);
    expect(r.dealt(1, 2).length).toBe(5);
    expect(r.outs().includes("countered")).toBe(false);
  });

  test("duplicate hit: two Cascade Chains on one victim in the same tick leave one capture owner; the loser deals nothing", () => {
    const r = makeRig(3);
    r.awaken();
    put(r, 3, 0, 1.5); // second caster on the far side of the victim, facing it
    r.poses.get(3)!.facingYaw = 0;
    r.poses.get(2)!.z = 0;
    r.poses.get(2)!.x = 0;
    r.poses.get(1)!.z = 1.5; r.poses.get(1)!.x = 0.0; r.poses.get(1)!.facingYaw = 0;
    r.poses.get(3)!.z = -1.5; r.poses.get(3)!.facingYaw = Math.PI;
    const g = r.cs.get(3)!; g.form = "Awakened"; g.awakenedUsedMask = 0;
    r.step(T0, { press: [{ slot: 1 }, { who: 3, slot: 1 }] });
    r.run(T0 + 1, C + 40);
    expect(r.results.filter((x) => x.r.outcome === "captured" && x.r.candidate.targetId === 2).length).toBe(1);
    expect(r.results.some((x) => x.r.outcome === "captureLost")).toBe(true);
    const owners = new Set(r.results.filter((x) => x.r.damage100 > 0 && x.r.candidate.targetId === 2).map((x) => x.r.candidate.attackerId));
    expect(owners.size).toBe(1);
    expect(r.cs.captures.size).toBe(0);
  });

  test("two eligible victims in the same tick: only the nearest is captured", () => {
    const r = makeRig(3);
    r.awaken();
    r.step(T0, { press: [{ slot: 1 }] });
    r.run(T0 + 1, C);
    expect(r.cs.get(2)!.action).toBe("Captured");
    expect(r.cs.get(3)!.action).toBe("Idle");
    expect(r.cs.captures.size).toBe(1);
  });

  test("third party ordinary damage reaches the captured victim without breaking the capture", () => {
    const r = makeRig(3);
    r.awaken();
    put(r, 3, 6, -2);
    r.step(T0, { press: [{ slot: 1 }] });
    r.run(T0 + 1, C + 3);
    r.step(C + 4, { extra: [r.strike(3, 2, { damage100: 500 })] });
    expect(r.hp(2)).toBe(HP - 400 - 500);
    expect(r.cs.get(2)!.action).toBe("Captured");
    r.run(C + 5, C + 33);
    expect(r.hp(2)).toBe(HP - 2600 - 500);
  });

  test("interruption in startup (stun) cancels the cast: no capture, no damage; the cooldown is spent", () => {
    const r = makeRig(3);
    r.awaken();
    put(r, 3, 6, -2);
    r.step(T0, { press: [{ slot: 1 }] });
    r.run(T0 + 1, T0 + 3);
    r.step(T0 + 4, { extra: [r.strike(3, 1)] });
    expect(r.cs.get(1)!.action).toBe("Stunned");
    r.run(T0 + 5, T0 + 60);
    expect(r.cs.get(2)!.action).toBe("Idle");
    expect(r.hp(2)).toBe(HP);
    expect(r.runner.castOf(1)).toBeUndefined();
  });

  test("interruption mid sequence: armor ignores stun and ragdoll but takes damage; the chain completes", () => {
    const r = makeRig(3);
    r.awaken();
    put(r, 3, 6, -2);
    r.step(T0, { press: [{ slot: 1 }] });
    r.run(T0 + 1, C + 9);
    r.step(C + 10, { extra: [r.strike(3, 1, { damage100: 700 }), r.strike(3, 1, { damage100: 100, reaction: { kind: "ragdoll", ticks: 60 } })] });
    expect(r.hp(1)).toBe(HP - 800);
    expect(r.cs.get(1)!.action).toBe("Active");
    r.run(C + 11, C + 33);
    expect(r.hp(2)).toBe(HP - 2600);
  });

  test("interruption mid sequence by armorBreak: capture released, remaining damage never lands", () => {
    const r = makeRig(3);
    r.awaken();
    put(r, 3, 6, -2);
    r.step(T0, { press: [{ slot: 1 }] });
    r.run(T0 + 1, C + 16);
    expect(r.hp(2)).toBe(HP - 1200);
    r.step(C + 17, { extra: [r.strike(3, 1, { armorBreak: true })] });
    expect(r.cs.get(1)!.action).toBe("Stunned");
    expect(r.cs.get(2)!.action).toBe("Idle");
    expect(r.cs.captures.size).toBe(0);
    expect(r.releases.at(-1)!.rel.cause).toBe("cancelled");
    r.run(C + 18, C + 80);
    expect(r.hp(2)).toBe(HP - 1200);
  });

  test("death of the captor mid sequence releases the victim and stops the damage", () => {
    const r = makeRig(2);
    r.awaken();
    r.step(T0, { press: [{ slot: 1 }] });
    r.run(T0 + 1, C + 10);
    r.cs.kill(1, C + 11);
    expect(r.cs.get(2)!.action).toBe("Idle");
    r.run(C + 11, C + 60);
    expect(r.hp(2)).toBe(HP - 800);
    expect(r.cs.captures.size).toBe(0);
    expect(r.runner.castOf(1)).toBeUndefined();
  });

  test("death of the victim mid sequence stops the damage and the captor recovers for 18 ticks", () => {
    const r = makeRig(3);
    r.awaken();
    put(r, 3, 6, -2);
    r.step(T0, { press: [{ slot: 1 }] });
    r.run(T0 + 1, C + 10);
    r.cs.get(2)!.hp100 = 100;
    r.step(C + 11, { extra: [r.strike(3, 2, { damage100: 5000 })] });
    expect(r.cs.get(2)!.action).toBe("Dead");
    expect(r.hp(2)).toBe(0);
    expect(r.cs.get(2)!.koCount).toBe(1);
    expect(r.cs.get(1)!.action).toBe("Recovery");
    expect(r.cs.get(1)!.actionEndTick).toBe(C + 11 + CAPTOR_RELEASE_RECOVERY);
    r.run(C + 12, C + 70);
    expect(r.dealt(1, 2).length).toBe(2);
    expect(r.cs.captures.size).toBe(0);
  });

  test("lethal final hit: one KO, no negative HP, no orphan capture", () => {
    const r = makeRig(2);
    r.awaken();
    r.cs.get(2)!.hp100 = 600;
    r.step(T0, { press: [{ slot: 1 }] });
    r.run(T0 + 1, C + 60);
    expect(r.hp(2)).toBe(0);
    expect(r.cs.get(2)!.koCount).toBe(1);
    expect(r.cs.captures.size).toBe(0);
  });

  test("static occlusion prevents the capture", () => {
    const r = makeRig(2);
    r.awaken();
    r.setOccluded(true);
    r.step(T0, { press: [{ slot: 1 }] });
    r.run(T0 + 1, C + 40);
    expect(r.results.length).toBe(0);
  });

  test("a protected or invulnerable victim does not block a farther valid one", () => {
    const r = makeRig(3);
    r.awaken();
    r.cs.get(2)!.invulnerableUntil = T0 + 1000;
    put(r, 3, 0, -2.2);
    r.step(T0, { press: [{ slot: 1 }] });
    r.run(T0 + 1, C);
    expect(r.cs.get(2)!.action).toBe("Idle");
    expect(r.cs.get(3)!.action).toBe("Captured");
  });

  test("expiry: the form expiring mid capture never cancels the cast; no new awakened cast can start afterwards", () => {
    const r = makeRig(2);
    const aw = new AwakeningSystem(r.host);
    r.awaken();
    const f = r.cs.get(1)!;
    f.formEndTick = C + 10;
    r.step(T0, { press: [{ slot: 1 }] });
    for (let t = T0 + 1; t <= C + 60; t++) { aw.update(t); r.step(t, t === C + 20 ? { press: [{ slot: 1 }] } : undefined); }
    expect(f.form).toBe("Base");
    expect(r.dealt(1, 2).length).toBe(5);
    const second = r.outcomes.at(-1)!.o;
    expect(second.kind === "buffered" || (second.kind === "rejected")).toBe(true);
    expect(r.runner.castOf(1)?.def.id).not.toBe("td.a1");
    expect(r.cs.captures.size).toBe(0);
    expect(f.armored).toBe(false);
  });

  test("cleanup: cancel is idempotent and no capture remains", () => {
    const r = makeRig(2);
    r.awaken();
    r.step(T0, { press: [{ slot: 1 }] });
    r.run(T0 + 1, C + 3);
    r.runner.cancel(1);
    r.runner.cancel(1);
    expect(r.cs.captures.size).toBe(0);
    expect(r.cs.get(2)!.action).toBe("Idle");
  });
});

describe("td.a2 Deepfall (deepfall)", () => {
  const C = T0 + 16; // capture tick
  const area = (r: Rig) => r.results.filter((x) => x.r.candidate.moveId === "td.a2" && x.r.candidate.hitIndex === 0 && x.r.candidate.targetId !== 2);

  test("hit: startup armor, cinematic capture, 69 HP at capture+72, release +78 R90 F4 U12, recovery 30", () => {
    const r = makeRig(2);
    r.awaken();
    r.step(T0, { press: [{ slot: 1 }].map(() => ({ slot: 2 as const })) });
    started(r, "td.a2");
    expect(r.cs.get(1)!.armored).toBe(true);
    r.run(T0 + 1, C - 1);
    expect(r.cs.get(1)!.armored).toBe(true); // startup armor through the last startup tick
    r.step(C);
    expect(r.cs.get(2)!.action).toBe("Captured");
    expect(r.cs.captures.captureOn(2)!.cinematic).toBe(true);
    r.run(C + 1, C + 71);
    expect(r.hp(2)).toBe(HP); // the capture hit deals nothing
    r.step(C + 72);
    expect(r.dealt(1, 2)).toEqual([[C + 72, 6900]]);
    expect(r.hp(2)).toBe(HP - 6900);
    r.run(C + 73, C + 77);
    expect(r.cs.get(2)!.action).toBe("Captured");
    r.step(C + 78);
    const v = r.cs.get(2)!;
    expect(v.action).toBe("Ragdolled");
    expect(v.actionEndTick - v.actionStartTick).toBe(90);
    expect(r.launches.map((l) => [l.id, l.vx + 0, l.vy, l.vz, l.tick])).toEqual([[2, 0, 12, -4, C + 78]]);
    expect(r.releases.map((x) => [x.tick, x.rel.cause])).toEqual([[C + 78, "final"]]);
    r.run(C + 79, C + 78 + 29);
    expect(r.cs.get(1)!.action).toBe("Recovery");
    r.step(C + 78 + 30);
    expect(r.cs.get(1)!.action).toBe("Idle");
    expect(r.cs.get(1)!.form).toBe("Awakened");
  });

  test("armor is startup only before the capture; a recovery hit stuns", () => {
    const r = makeRig(3);
    r.awaken();
    put(r, 3, 6, -2);
    r.poses.get(2)!.z = -9; // miss
    r.step(T0, { press: [{ slot: 2 }] });
    r.run(T0 + 1, C + 4);
    expect(r.cs.get(1)!.armored).toBe(false); // armor ends at activeStart
    r.run(C + 5, C + 6);
    r.step(C + 7, { extra: [r.strike(3, 1)] });
    expect(r.cs.get(1)!.action).toBe("Stunned");
  });

  test("once per form: a miss spends the use and a second press is rejected", () => {
    const r = makeRig(2);
    r.awaken();
    r.poses.get(2)!.z = -9;
    r.step(T0, { press: [{ slot: 2 }] });
    started(r, "td.a2");
    expect(r.cs.get(1)!.awakenedUsedMask & 2).toBe(2);
    r.run(T0 + 1, C + 5 + 30);
    expect(r.cs.get(1)!.action).toBe("Idle");
    expect(r.results.length).toBe(0);
    expect(r.cs.captures.size).toBe(0);
    r.step(C + 60, { press: [{ slot: 2 }] });
    expect(r.outcomes.at(-1)!.o).toEqual({ kind: "rejected", reason: "FORM" });
  });

  test("area: 20 HP U noncounterable R60 F6 U4 to others within 4 m at the impact, max 3 others, nearest first, victim excluded", () => {
    const r = makeRig(7);
    r.awaken();
    put(r, 3, 2, -1.5); // 2 m from the victim
    put(r, 4, -3.9, -1.5); // 3.9 m
    put(r, 5, 0, -5.4); // 3.9 m
    put(r, 6, 0, 1.5); // 3 m behind the caster side, in range
    put(r, 7, 30, -1.5); // far
    r.cs.get(3)!.counterOpenUntil = T0 + 1000; // noncounterable area
    r.step(T0, { press: [{ slot: 2 }] });
    r.run(T0 + 1, C + 71);
    for (const id of [3, 4, 5, 6, 7]) expect(r.hp(id)).toBe(HP);
    r.step(C + 72);
    const hit = area(r).filter((x) => x.r.outcome === "hit").map((x) => x.r.candidate.targetId);
    expect([...hit].sort()).toEqual([3, 4, 6]); // the three nearest of 3 (2 m), 6 (3 m), 4 and 5 (3.9 m, tie by id)
    expect(r.hp(3)).toBe(HP - 2000);
    expect(r.hp(6)).toBe(HP - 2000);
    expect(r.hp(4)).toBe(HP - 2000);
    expect(r.hp(5)).toBe(HP);
    expect(r.hp(7)).toBe(HP);
    expect(r.cs.get(3)!.action).toBe("Ragdolled");
    expect(r.cs.get(3)!.actionEndTick - r.cs.get(3)!.actionStartTick).toBe(60);
    expect(r.dealt(1, 2)).toEqual([[C + 72, 6900]]); // the original victim takes only the 69
    expect(r.results.filter((x) => x.r.candidate.moveId === "td.a2" && x.tick === C + 72).length).toBe(4);
  });

  test("area boundary: just inside 4 m hits, beyond 4.35 m does not; a wall between impact and target stops it", () => {
    const r = makeRig(5);
    r.awaken();
    put(r, 3, 4.0, -1.5);
    put(r, 4, 4.5, -1.5);
    put(r, 5, 0, -5); // 3.5 m from the victim, behind a wall plane at z = -3.5
    r.setWallZ(-3.5);
    r.step(T0, { press: [{ slot: 2 }] });
    r.run(T0 + 1, C + 72);
    expect(r.hp(3)).toBe(HP - 2000);
    expect(r.hp(4)).toBe(HP);
    expect(r.hp(5)).toBe(HP);
  });

  test("area is U: a frontal guard does not block it", () => {
    const r = makeRig(3);
    r.awaken();
    put(r, 3, 2, -1.5);
    r.run(T0 - 10, T0 - 1, () => ({ guard: [3] }));
    r.step(T0, { press: [{ slot: 2 }], guard: [3] });
    r.run(T0 + 1, C + 72, () => ({ guard: [3] }));
    expect(r.hp(3)).toBe(HP - 2000);
  });

  test("cinematic: a third party cannot damage the captured victim or the caster during the sequence", () => {
    const r = makeRig(3);
    r.awaken();
    put(r, 3, 6, -2);
    r.step(T0, { press: [{ slot: 2 }] });
    r.run(T0 + 1, C + 10);
    r.step(C + 11, { extra: [r.strike(3, 2, { damage100: 500 }), r.strike(3, 1, { damage100: 500 })] });
    const o = r.results.filter((x) => x.tick === C + 11).map((x) => x.r.outcome);
    expect(o).toEqual(["shielded", "shielded"]);
    expect(r.hp(2)).toBe(HP);
    expect(r.hp(1)).toBe(HP);
  });

  test("block and counter: U ignores guard; the counterable initial capture is intercepted (no capture, no area, use spent)", () => {
    const g = makeRig(2);
    g.awaken();
    g.run(T0 - 10, T0 - 1, () => ({ guard: [2] }));
    g.step(T0, { press: [{ slot: 2 }], guard: [2] });
    g.run(T0 + 1, C + 3, () => ({ guard: [2] }));
    expect(g.cs.get(2)!.action).toBe("Captured");
    expect(g.outs().includes("blocked")).toBe(false);

    const r = makeRig(3);
    r.awaken();
    put(r, 3, 2, -1.5);
    r.cs.get(2)!.counterOpenUntil = T0 + 100;
    r.step(T0, { press: [{ slot: 2 }] });
    r.run(T0 + 1, C + 100);
    expect(r.outs()[0]).toBe("countered");
    expect(r.cs.captures.size).toBe(0);
    expect(r.hp(2)).toBe(HP);
    expect(r.hp(3)).toBe(HP);
    expect(r.cs.get(1)!.awakenedUsedMask & 2).toBe(2);
  });

  test("duplicate hit: exactly one 69 and one area hit per target in the whole cast", () => {
    const r = makeRig(3);
    r.awaken();
    put(r, 3, 2, -1.5);
    r.step(T0, { press: [{ slot: 2 }] });
    r.run(T0 + 1, C + 78 + 40);
    expect(r.dealt(1, 2).length).toBe(1);
    expect(r.dealt(1, 3).length).toBe(1);
    expect(r.results.filter((x) => x.r.outcome === "captured").length).toBe(1);
    expect(r.hp(3)).toBe(HP - 2000);
  });

  test("interruption: armorBreak in startup cancels (use spent, no capture); plain stun in startup is ignored by armor", () => {
    const a = makeRig(3);
    a.awaken();
    put(a, 3, 6, -2);
    a.step(T0, { press: [{ slot: 2 }] });
    a.run(T0 + 1, T0 + 5);
    a.step(T0 + 6, { extra: [a.strike(3, 1)] });
    expect(a.cs.get(1)!.action).toBe("Windup"); // armor: no stun
    expect(a.hp(1)).toBe(HP - 300);
    a.run(T0 + 7, C);
    expect(a.cs.get(2)!.action).toBe("Captured");

    const b = makeRig(3);
    b.awaken();
    put(b, 3, 6, -2);
    b.step(T0, { press: [{ slot: 2 }] });
    b.run(T0 + 1, T0 + 5);
    b.step(T0 + 6, { extra: [b.strike(3, 1, { armorBreak: true })] });
    expect(b.cs.get(1)!.action).toBe("Stunned");
    b.run(T0 + 7, C + 100);
    expect(b.cs.get(2)!.action).toBe("Idle");
    expect(b.hp(2)).toBe(HP);
    expect(b.cs.get(1)!.awakenedUsedMask & 2).toBe(2);
  });

  test("interruption mid sequence by armorBreak: capture released, no 69 and no area", () => {
    const r = makeRig(3);
    r.awaken();
    put(r, 3, 2, -1.5);
    // the caster is cinematic-shielded from third parties, so break it with the victim's own armorBreak instead
    r.step(T0, { press: [{ slot: 2 }] });
    r.run(T0 + 1, C + 10);
    r.runner.cancel(1);
    expect(r.cs.captures.size).toBe(0);
    expect(r.releases.at(-1)!.rel.cause).toBe("cancelled");
    r.run(C + 11, C + 100);
    expect(r.hp(2)).toBe(HP);
    expect(r.hp(3)).toBe(HP);
  });

  test("death of the captor before the impact: victim released, no 69, no area", () => {
    const r = makeRig(3);
    r.awaken();
    put(r, 3, 2, -1.5);
    r.step(T0, { press: [{ slot: 2 }] });
    r.run(T0 + 1, C + 40);
    r.cs.kill(1, C + 41);
    expect(r.cs.get(2)!.action).toBe("Idle");
    r.run(C + 41, C + 120);
    expect(r.hp(2)).toBe(HP);
    expect(r.hp(3)).toBe(HP);
    expect(r.cs.captures.size).toBe(0);
  });

  test("death of the victim before the impact: no 69, no area, captor recovers for 18 ticks", () => {
    const r = makeRig(3);
    r.awaken();
    put(r, 3, 2, -1.5);
    r.step(T0, { press: [{ slot: 2 }] });
    r.run(T0 + 1, C + 40);
    r.cs.kill(2, C + 41);
    expect(r.cs.get(1)!.action).toBe("Recovery");
    expect(r.cs.get(1)!.actionEndTick).toBe(C + 41 + CAPTOR_RELEASE_RECOVERY);
    r.run(C + 41, C + 120);
    expect(r.hp(3)).toBe(HP);
    expect(r.dealt(1, 3).length).toBe(0);
  });

  test("lethal impact: the 69 clamps at the victim's HP, one KO, the area still lands, no negative HP", () => {
    const r = makeRig(3);
    r.awaken();
    put(r, 3, 2, -1.5);
    r.cs.get(2)!.hp100 = 5000;
    r.step(T0, { press: [{ slot: 2 }] });
    r.run(T0 + 1, C + 100);
    expect(r.hp(2)).toBe(0);
    expect(r.cs.get(2)!.koCount).toBe(1);
    expect(r.hp(3)).toBe(HP - 2000);
    expect(r.cs.captures.size).toBe(0);
  });

  test("expiry: the form expiring mid capture does not cancel the cast, the 69 or the area; nothing new starts", () => {
    const r = makeRig(3);
    const aw = new AwakeningSystem(r.host);
    r.awaken();
    put(r, 3, 2, -1.5);
    const f = r.cs.get(1)!;
    f.formEndTick = C + 30;
    r.step(T0, { press: [{ slot: 2 }] });
    for (let t = T0 + 1; t <= C + 78 + 40; t++) { aw.update(t); r.step(t); }
    expect(f.form).toBe("Base");
    expect(r.dealt(1, 2)).toEqual([[C + 72, 6900]]);
    expect(r.hp(3)).toBe(HP - 2000);
    expect(r.cs.captures.size).toBe(0);
    r.step(C + 200, { press: [{ slot: 2 }] });
    expect(r.outcomes.at(-1)!.o).toMatchObject({ kind: "started", moveId: "td.b2" }); // base move, never the awakened one
  });

  test("cleanup: a disconnect of the victim removes the capture at once", () => {
    const r = makeRig(2);
    r.awaken();
    r.step(T0, { press: [{ slot: 2 }] });
    r.run(T0 + 1, C + 10);
    r.cs.remove(2);
    expect(r.cs.captures.size).toBe(0);
    r.run(C + 11, C + 100);
    expect(r.cs.get(1)!.action).toBe("Idle");
  });
});

describe("td.a3 Split Tide (splitTide)", () => {
  const A = T0 + 16; // activeStart; second probe at A+17; activeEnd A+18

  test("hit: 12 HP stun 30 at activeStart, then 26 HP R72 F10 U4 at +17, 38 in all, recovery 24", () => {
    const r = makeRig(2);
    r.awaken();
    r.step(T0, { press: [{ slot: 3 }] });
    started(r, "td.a3");
    r.run(T0 + 1, A - 1);
    expect(r.hp(2)).toBe(HP);
    r.step(A);
    expect(r.hp(2)).toBe(HP - 1200);
    const v = r.cs.get(2)!;
    expect(v.action).toBe("Stunned");
    expect(v.actionEndTick - v.actionStartTick).toBe(30);
    expect(r.cs.captures.size).toBe(0); // no capture
    r.run(A + 1, A + 16);
    r.step(A + 17);
    expect(r.dealt(1, 2)).toEqual([[A, 1200], [A + 17, 2600]]);
    expect(r.hp(2)).toBe(HP - 3800);
    expect(r.cs.get(2)!.action).toBe("Ragdolled");
    expect(r.cs.get(2)!.actionEndTick - r.cs.get(2)!.actionStartTick).toBe(72);
    const cands = r.results.filter((x) => x.r.outcome === "hit").map((x) => x.r.candidate);
    expect(cands[0]!.launch).toEqual({ forward: 0, up: 0 });
    expect(cands[1]!.launch ?? { forward: 10, up: 4 }).toEqual({ forward: 10, up: 4 });
    r.step(A + 18);
    expect(r.cs.get(1)!.action).toBe("Recovery");
    r.run(A + 19, A + 18 + 23);
    expect(r.cs.get(1)!.action).toBe("Recovery");
    r.step(A + 18 + 24);
    expect(r.cs.get(1)!.action).toBe("Idle");
  });

  test("armor from commit through the last active tick, not in recovery", () => {
    const r = makeRig(3);
    r.awaken();
    put(r, 3, 6, -2);
    r.step(T0, { press: [{ slot: 3 }] });
    expect(r.cs.get(1)!.armored).toBe(true);
    for (let t = T0 + 1; t <= A + 17; t++) { r.step(t); expect(r.cs.get(1)!.armored, `tick ${t}`).toBe(true); }
    r.step(A + 18);
    expect(r.cs.get(1)!.armored).toBe(false);
    r.step(A + 19, { extra: [r.strike(3, 1)] });
    expect(r.cs.get(1)!.action).toBe("Stunned");
  });

  test("miss: both probes miss, recovery follows, cooldown 840 from the press", () => {
    const r = makeRig(2);
    r.awaken();
    r.poses.get(2)!.z = -8;
    r.step(T0, { press: [{ slot: 3 }] });
    r.run(T0 + 1, A + 17);
    expect(r.results.length).toBe(0);
    r.step(A + 18);
    expect(r.cs.get(1)!.action).toBe("Recovery");
    r.step(T0 + 839, { press: [{ slot: 3 }] });
    expect(r.outcomes.at(-1)!.o).toEqual({ kind: "rejected", reason: "COOLDOWN" });
    r.step(T0 + 840, { press: [{ slot: 3 }] });
    started(r, "td.a3");
  });

  test("first probe missed: the second is still valid and deals 26", () => {
    const r = makeRig(2);
    r.awaken();
    r.poses.get(2)!.z = -8;
    r.step(T0, { press: [{ slot: 3 }] });
    r.run(T0 + 1, A + 16);
    r.poses.get(2)!.z = -2;
    r.step(A + 17);
    expect(r.dealt(1, 2)).toEqual([[A + 17, 2600]]);
    expect(r.hp(2)).toBe(HP - 2600);
  });

  test("second probe missed after the first hit: only 12 lands", () => {
    const r = makeRig(2);
    r.awaken();
    r.step(T0, { press: [{ slot: 3 }] });
    r.run(T0 + 1, A);
    r.poses.get(2)!.z = -8;
    r.run(A + 1, A + 30);
    expect(r.dealt(1, 2)).toEqual([[A, 1200]]);
  });

  test("block: U ignores a frontal guard on both hits", () => {
    const r = makeRig(2);
    r.awaken();
    r.run(T0 - 10, T0 - 1, () => ({ guard: [2] }));
    r.step(T0, { press: [{ slot: 3 }], guard: [2] });
    r.run(T0 + 1, A + 17, () => ({ guard: [2] }));
    expect(r.outs().includes("blocked")).toBe(false);
    expect(r.hp(2)).toBe(HP - 3800);
  });

  test("counter: a counter consumed by the first hit leaves the second valid (26); counterable, no recursion", () => {
    const r = makeRig(2);
    r.awaken();
    r.cs.get(2)!.counterOpenUntil = T0 + 200;
    r.step(T0, { press: [{ slot: 3 }] });
    r.run(T0 + 1, A + 17);
    expect(r.outs()[0]).toBe("countered");
    expect(r.cs.get(2)!.counterOpenUntil).toBe(0);
    expect(r.dealt(1, 2)).toEqual([[A + 17, 2600]]);
  });

  test("duplicate hit: one hit per probe offset, two in the whole cast; single target only", () => {
    const r = makeRig(3);
    r.awaken();
    r.step(T0, { press: [{ slot: 3 }] });
    r.run(T0 + 1, A + 60);
    expect(r.dealt(1, 2).length).toBe(2);
    expect(r.dealt(1, 3).length).toBe(0); // the cast keeps its one target
    expect(r.results.filter((x) => x.r.candidate.attackerId === 1).length).toBe(2);
  });

  test("interruption in startup by armorBreak cancels the cast: no hit at all", () => {
    const r = makeRig(3);
    r.awaken();
    put(r, 3, 6, -2);
    r.step(T0, { press: [{ slot: 3 }] });
    r.run(T0 + 1, T0 + 4);
    r.step(T0 + 5, { extra: [r.strike(3, 1)] });
    expect(r.cs.get(1)!.action).toBe("Windup"); // plain hits are armored through startup
    r.step(T0 + 6, { extra: [r.strike(3, 1, { armorBreak: true })] });
    expect(r.cs.get(1)!.action).toBe("Stunned");
    r.run(T0 + 7, A + 40);
    expect(r.hp(2)).toBe(HP);
  });

  test("a first hit interrupted by armorBreak prevents the second", () => {
    const r = makeRig(3);
    r.awaken();
    put(r, 3, 6, -2);
    r.step(T0, { press: [{ slot: 3 }] });
    r.run(T0 + 1, A);
    expect(r.hp(2)).toBe(HP - 1200);
    r.step(A + 5, { extra: [r.strike(3, 1, { armorBreak: true })] });
    expect(r.cs.get(1)!.action).toBe("Stunned");
    r.run(A + 6, A + 40);
    expect(r.dealt(1, 2)).toEqual([[A, 1200]]);
  });

  test("a plain hit between the probes is armored: no stun, both probes land", () => {
    const r = makeRig(3);
    r.awaken();
    put(r, 3, 6, -2);
    r.step(T0, { press: [{ slot: 3 }] });
    r.run(T0 + 1, A + 5);
    r.step(A + 6, { extra: [r.strike(3, 1, { damage100: 400 }), r.strike(3, 1, { damage100: 100, reaction: { kind: "ragdoll", ticks: 60 } })] });
    expect(r.hp(1)).toBe(HP - 500);
    expect(r.cs.get(1)!.action).toBe("Active");
    r.run(A + 7, A + 17);
    expect(r.hp(2)).toBe(HP - 3800);
  });

  test("death of the caster between the probes: the second never lands", () => {
    const r = makeRig(2);
    r.awaken();
    r.step(T0, { press: [{ slot: 3 }] });
    r.run(T0 + 1, A + 3);
    r.cs.kill(1, A + 4);
    r.run(A + 4, A + 40);
    expect(r.dealt(1, 2)).toEqual([[A, 1200]]);
    expect(r.runner.castOf(1)).toBeUndefined();
  });

  test("death of the victim between the probes: the second probe finds nobody, no negative HP", () => {
    const r = makeRig(2);
    r.awaken();
    r.cs.get(2)!.hp100 = 1500;
    r.step(T0, { press: [{ slot: 3 }] });
    r.run(T0 + 1, A);
    expect(r.hp(2)).toBe(300);
    r.cs.kill(2, A + 5);
    r.run(A + 5, A + 40);
    expect(r.hp(2)).toBe(0);
    expect(r.dealt(1, 2)).toEqual([[A, 1200]]);
    expect(r.cs.get(2)!.koCount).toBe(1);
  });

  test("lethal second hit clamps at the remaining HP", () => {
    const r = makeRig(2);
    r.awaken();
    r.cs.get(2)!.hp100 = 2000;
    r.step(T0, { press: [{ slot: 3 }] });
    r.run(T0 + 1, A + 20);
    expect(r.hp(2)).toBe(0);
    expect(r.cs.get(2)!.koCount).toBe(1);
  });

  test("expiry: the form expiring between the probes still lets the second land; no new awakened cast afterwards", () => {
    const r = makeRig(2);
    const aw = new AwakeningSystem(r.host);
    r.awaken();
    const f = r.cs.get(1)!;
    f.formEndTick = A + 8;
    r.step(T0, { press: [{ slot: 3 }] });
    for (let t = T0 + 1; t <= A + 40; t++) { aw.update(t); r.step(t); }
    expect(f.form).toBe("Base");
    expect(r.dealt(1, 2)).toEqual([[A, 1200], [A + 17, 2600]]);
    r.step(T0 + 900, { press: [{ slot: 3 }] });
    expect(r.outcomes.at(-1)!.o).toMatchObject({ kind: "started", moveId: "td.b3" }); // base slot 3
  });

  test("static occlusion prevents both hits", () => {
    const r = makeRig(2);
    r.awaken();
    r.setOccluded(true);
    r.step(T0, { press: [{ slot: 3 }] });
    r.run(T0 + 1, A + 40);
    expect(r.results.length).toBe(0);
  });
});

describe("td.a4 Riptide Pursuit (riptidePursuit)", () => {
  const A = T0 + 12; // activeStart

  test("close branch: a target within 2 m at commit is captured at activeStart, [8,22] at +0,+36, release +37 R72 F8 U5", () => {
    const r = makeRig(2);
    r.awaken();
    r.step(T0, { press: [{ slot: 4 }] });
    started(r, "td.a4");
    expect(r.cs.get(1)!.armored).toBe(false); // armor only after the capture
    r.run(T0 + 1, A - 1);
    expect(r.cs.get(1)!.armored).toBe(false);
    r.step(A);
    expect(r.cs.get(2)!.action).toBe("Captured");
    expect(r.cs.get(1)!.armored).toBe(true);
    expect(r.moves.length).toBe(0); // no dash in the close branch
    r.run(A + 1, A + 35);
    r.step(A + 36);
    expect(r.dealt(1, 2)).toEqual([[A, 800], [A + 36, 2200]]);
    expect(r.hp(2)).toBe(HP - 3000);
    r.step(A + 37);
    const v = r.cs.get(2)!;
    expect(v.action).toBe("Ragdolled");
    expect(v.actionEndTick - v.actionStartTick).toBe(72);
    expect(r.launches.map((l) => [l.id, l.vx + 0, l.vy, l.vz, l.tick])).toEqual([[2, 0, 5, -8, A + 37]]);
    expect(r.releases.map((x) => [x.tick, x.rel.cause])).toEqual([[A + 37, "final"]]);
    expect(r.cs.get(1)!.armored).toBe(false);
    r.run(A + 38, A + 37 + 29);
    expect(r.cs.get(1)!.action).toBe("Recovery");
    r.step(A + 37 + 30);
    expect(r.cs.get(1)!.action).toBe("Idle");
  });

  test("ranged branch: dash 0.3 m per tick, capture stops the dash, capture hit deals nothing, 27 at +36, release +37", () => {
    const r = makeRig(2);
    r.awaken();
    put(r, 2, 0, -5);
    r.step(T0, { press: [{ slot: 4 }] });
    r.run(T0 + 1, A - 1);
    expect(r.moves.length).toBe(0); // startup: no travel
    r.run(A, A + 12);
    expect(r.cs.get(2)!.action).toBe("Idle");
    expect(r.moves.length).toBe(13);
    r.step(A + 13); // 14th step reaches z = -4.2 and touches the victim capsule (0.6 + 0.35 reach)
    const C = A + 13;
    expect(r.cs.get(2)!.action).toBe("Captured");
    expect(r.moves.length).toBe(14);
    expect(r.poses.get(1)!.z).toBeCloseTo(-4.2, 6);
    expect(r.hp(2)).toBe(HP); // the ranged capture hit deals nothing
    r.run(C + 1, C + 35);
    expect(r.moves.length).toBe(14); // the dash ended with the capture
    r.step(C + 36);
    expect(r.dealt(1, 2)).toEqual([[C + 36, 2700]]);
    r.step(C + 37);
    expect(r.cs.get(2)!.action).toBe("Ragdolled");
    expect(r.releases.map((x) => [x.tick, x.rel.cause])).toEqual([[C + 37, "final"]]);
  });

  test("ranged reach: 9 m of travel plus the sweep radius; a target at 9.9 m is captured on the last tick, 10 m is a miss", () => {
    const near = makeRig(2);
    near.awaken();
    put(near, 2, 0, -9.9);
    near.step(T0, { press: [{ slot: 4 }] });
    near.run(T0 + 1, A + 29);
    expect(near.cs.get(2)!.action).toBe("Captured");
    expect(near.moves.length).toBe(30);

    const far = makeRig(2);
    far.awaken();
    put(far, 2, 0, -10);
    far.step(T0, { press: [{ slot: 4 }] });
    far.run(T0 + 1, A + 29);
    expect(far.cs.get(2)!.action).toBe("Idle");
    expect(far.moves.length).toBe(30);
    expect(far.poses.get(1)!.z).toBeCloseTo(-9, 6);
    far.step(A + 30);
    expect(far.cs.get(1)!.action).toBe("Recovery");
    expect(far.moves.length).toBe(30); // no travel in recovery
    expect(far.results.length).toBe(0);
  });

  test("the branch is fixed at commit: a target that leaves 2 m is not chased, one that arrives later does not switch to close", () => {
    const left = makeRig(2);
    left.awaken();
    left.step(T0, { press: [{ slot: 4 }] });
    put(left, 2, 0, -4);
    left.run(T0 + 1, A + 29);
    expect(left.moves.length).toBe(0); // still the close branch: no dash
    expect(left.cs.get(2)!.action).toBe("Idle");
    expect(left.results.length).toBe(0);

    const came = makeRig(2);
    came.awaken();
    put(came, 2, 0, -5);
    came.step(T0, { press: [{ slot: 4 }] });
    put(came, 2, 0, -0.8);
    came.run(T0 + 1, A + 5);
    expect(came.moves.length).toBeGreaterThan(0); // ranged: it dashes
    expect(came.cs.get(2)!.action).toBe("Captured");
    expect(came.hp(2)).toBe(HP); // ranged capture: 0 at the capture hit
    came.run(A + 6, A + 6 + 40);
    expect(came.dealt(1, 2).map((x) => x[1])).toEqual([2700]);
  });

  test("a wall stops the dash for good; the dash never resumes", () => {
    let blockedAfter = 0;
    const r = makeRig(2, {
      moveTogether: (ids, dx, dz) => {
        const p = r.poses.get(ids[0]!)!;
        const allowed = Math.max(0, p.z - -2) / 0.3 >= 1 ? 1 : Math.max(0, (p.z + 2)) / 0.3; // wall plane at z = -2
        const k = Math.max(0, Math.min(1, allowed));
        if (k < 1) blockedAfter += 1;
        p.x += dx * k; p.z += dz * k;
        return { dx: dx * k, dz: dz * k };
      },
    });
    r.awaken();
    put(r, 2, 0, -8);
    r.step(T0, { press: [{ slot: 4 }] });
    r.run(T0 + 1, A + 29);
    expect(r.poses.get(1)!.z).toBeCloseTo(-2, 6);
    expect(blockedAfter).toBe(1); // the first short step ends the dash; later ticks do not ask again
    expect(r.cs.get(2)!.action).toBe("Idle");
  });

  test("miss: recovery begins at the end of the active window, cooldown 570 from the press, no later capture", () => {
    const r = makeRig(2);
    r.awaken();
    put(r, 2, 0, -20);
    r.step(T0, { press: [{ slot: 4 }] });
    r.run(T0 + 1, A + 29);
    expect(r.cs.get(1)!.action).toBe("Active");
    r.step(A + 30);
    expect(r.cs.get(1)!.action).toBe("Recovery");
    put(r, 2, r.poses.get(1)!.x, r.poses.get(1)!.z - 0.5);
    r.run(A + 31, A + 59);
    expect(r.cs.get(2)!.action).toBe("Idle");
    expect(r.cs.get(1)!.action).toBe("Recovery");
    r.step(A + 60);
    expect(r.cs.get(1)!.action).toBe("Idle");
    r.step(T0 + 569, { press: [{ slot: 4 }] });
    expect(r.outcomes.at(-1)!.o).toEqual({ kind: "rejected", reason: "COOLDOWN" });
    r.step(T0 + 570, { press: [{ slot: 4 }] });
    started(r, "td.a4");
  });

  test("block: U ignores a frontal guard (close and ranged)", () => {
    for (const z of [-1.5, -5]) {
      const r = makeRig(2);
      r.awaken();
      put(r, 2, 0, z);
      r.run(T0 - 10, T0 - 1, () => ({ guard: [2] }));
      r.step(T0, { press: [{ slot: 4 }], guard: [2] });
      r.run(T0 + 1, A + 16, () => ({ guard: [2] }));
      expect(r.cs.get(2)!.action, `z ${z}`).toBe("Captured");
      expect(r.outs().includes("blocked")).toBe(false);
    }
  });

  test("counter: the counterable initial capture is intercepted (close branch): nothing captured, no damage", () => {
    const r = makeRig(2);
    r.awaken();
    r.cs.get(2)!.counterOpenUntil = T0 + 200;
    r.step(T0, { press: [{ slot: 4 }] });
    r.run(T0 + 1, A + 40);
    expect(r.outs()[0]).toBe("countered");
    expect(r.outs().slice(1).every((o) => o === "duplicate")).toBe(true);
    expect(r.cs.get(2)!.counterOpenUntil).toBe(0);
    expect(r.hp(2)).toBe(HP);
    expect(r.cs.captures.size).toBe(0);
  });

  test("duplicate hit: one capture and exactly the scheduled damage events for the whole cast", () => {
    const r = makeRig(3);
    r.awaken();
    r.step(T0, { press: [{ slot: 4 }] });
    r.run(T0 + 1, A + 100);
    expect(r.results.filter((x) => x.r.outcome === "captured").length).toBe(1);
    expect(r.dealt(1, 2).length).toBe(2);
    expect(r.dealt(1, 3).length).toBe(0);
    expect(r.cs.get(3)!.action).toBe("Idle");
  });

  test("two victims overlapping the sweep: only the nearest is captured", () => {
    const r = makeRig(3);
    r.awaken();
    put(r, 2, 0, -5);
    put(r, 3, 0.2, -5.1);
    r.step(T0, { press: [{ slot: 4 }] });
    r.run(T0 + 1, A + 30);
    expect(r.cs.captures.size).toBe(1);
    expect(r.cs.captures.captureOn(2)).toBeDefined();
    expect(r.cs.captures.captureOn(3)).toBeUndefined();
  });

  test("static occlusion prevents the capture in both branches", () => {
    for (const z of [-1.5, -5]) {
      const r = makeRig(2);
      r.awaken();
      put(r, 2, 0, z);
      r.setOccluded(true);
      r.step(T0, { press: [{ slot: 4 }] });
      r.run(T0 + 1, A + 40);
      expect(r.results.length, `z ${z}`).toBe(0);
    }
  });

  test("interruption in startup (stun) cancels: no dash, no capture", () => {
    const r = makeRig(3);
    r.awaken();
    put(r, 2, 0, -5);
    put(r, 3, 6, -2);
    r.step(T0, { press: [{ slot: 4 }] });
    r.run(T0 + 1, T0 + 5);
    r.step(T0 + 6, { extra: [r.strike(3, 1)] });
    expect(r.cs.get(1)!.action).toBe("Stunned");
    r.run(T0 + 7, A + 40);
    expect(r.moves.length).toBe(0);
    expect(r.cs.get(2)!.action).toBe("Idle");
  });

  test("interruption during the dash (no armor yet) stops it and nothing is captured later", () => {
    const r = makeRig(3);
    r.awaken();
    put(r, 2, 0, -8);
    put(r, 3, 6, -2);
    r.step(T0, { press: [{ slot: 4 }] });
    r.run(T0 + 1, A + 4);
    const dashed = r.moves.length;
    r.step(A + 5, { extra: [r.strike(3, 1)] });
    expect(r.cs.get(1)!.action).toBe("Stunned");
    r.run(A + 6, A + 40);
    expect(r.moves.length).toBe(dashed + 1); // the stun tick still moved once (movement precedes resolution), then never again
    expect(r.cs.get(2)!.action).toBe("Idle");
  });

  test("interruption mid capture: armor ignores stun; armorBreak releases the victim and stops the 22", () => {
    const a = makeRig(3);
    a.awaken();
    put(a, 3, 6, -2);
    a.step(T0, { press: [{ slot: 4 }] });
    a.run(T0 + 1, A + 9);
    a.step(A + 10, { extra: [a.strike(3, 1, { damage100: 700 })] });
    expect(a.cs.get(1)!.action).toBe("Active");
    a.run(A + 11, A + 36);
    expect(a.dealt(1, 2).length).toBe(2);

    const b = makeRig(3);
    b.awaken();
    put(b, 3, 6, -2);
    b.step(T0, { press: [{ slot: 4 }] });
    b.run(T0 + 1, A + 9);
    b.step(A + 10, { extra: [b.strike(3, 1, { armorBreak: true })] });
    expect(b.cs.get(1)!.action).toBe("Stunned");
    expect(b.cs.get(2)!.action).toBe("Idle");
    expect(b.cs.captures.size).toBe(0);
    expect(b.releases.at(-1)!.rel.cause).toBe("cancelled");
    b.run(A + 11, A + 80);
    expect(b.dealt(1, 2)).toEqual([[A, 800]]);
  });

  test("death of the captor mid capture and of the victim mid capture", () => {
    const c = makeRig(2);
    c.awaken();
    c.step(T0, { press: [{ slot: 4 }] });
    c.run(T0 + 1, A + 10);
    c.cs.kill(1, A + 11);
    expect(c.cs.get(2)!.action).toBe("Idle");
    c.run(A + 11, A + 80);
    expect(c.dealt(1, 2)).toEqual([[A, 800]]);
    expect(c.cs.captures.size).toBe(0);

    const v = makeRig(2);
    v.awaken();
    v.step(T0, { press: [{ slot: 4 }] });
    v.run(T0 + 1, A + 10);
    v.cs.kill(2, A + 11);
    expect(v.cs.get(1)!.action).toBe("Recovery");
    expect(v.cs.get(1)!.actionEndTick).toBe(A + 11 + CAPTOR_RELEASE_RECOVERY);
    v.run(A + 11, A + 80);
    expect(v.dealt(1, 2)).toEqual([[A, 800]]);
    expect(v.cs.captures.size).toBe(0);
  });

  test("lethal 22 or 27: one KO, no negative HP", () => {
    for (const z of [-1.5, -5]) {
      const r = makeRig(2);
      r.awaken();
      put(r, 2, 0, z);
      r.cs.get(2)!.hp100 = 1000;
      r.step(T0, { press: [{ slot: 4 }] });
      r.run(T0 + 1, A + 80);
      expect(r.hp(2), `z ${z}`).toBe(0);
      expect(r.cs.get(2)!.koCount).toBe(1);
      expect(r.cs.captures.size).toBe(0);
    }
  });

  test("expiry: the form expiring mid capture never cancels the cast; no second awakened cast starts", () => {
    const r = makeRig(2);
    const aw = new AwakeningSystem(r.host);
    r.awaken();
    const f = r.cs.get(1)!;
    f.formEndTick = A + 20;
    r.step(T0, { press: [{ slot: 4 }] });
    for (let t = T0 + 1; t <= A + 37 + 40; t++) { aw.update(t); r.step(t); }
    expect(f.form).toBe("Base");
    expect(r.dealt(1, 2)).toEqual([[A, 800], [A + 36, 2200]]);
    expect(r.cs.captures.size).toBe(0);
    expect(f.armored).toBe(false);
    r.step(T0 + 600, { press: [{ slot: 4 }] });
    expect(r.outcomes.at(-1)!.o).toMatchObject({ kind: "started", moveId: "td.b4" });
  });

  test("cleanup: a disconnect of the victim removes the capture at once", () => {
    const r = makeRig(2);
    r.awaken();
    r.step(T0, { press: [{ slot: 4 }] });
    r.run(T0 + 1, A + 10);
    r.cs.remove(2);
    expect(r.cs.captures.size).toBe(0);
    r.run(A + 11, A + 80);
    expect(r.cs.get(1)!.action).toBe("Idle");
  });
});

describe("segmentDistance helper", () => {
  test("parallel, crossing, endpoint and degenerate segments", () => {
    expect(segmentDistance([0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0])).toBeCloseTo(1, 9);
    expect(segmentDistance([-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0])).toBeCloseTo(0, 9);
    expect(segmentDistance([0, 0, 0], [1, 0, 0], [3, 0, 0], [4, 0, 0])).toBeCloseTo(2, 9);
    expect(segmentDistance([0, 0, 0], [0, 0, 0], [3, 4, 0], [3, 4, 0])).toBeCloseTo(5, 9);
    expect(segmentDistance([0, 0, 0], [0, 0, 0], [0, -1, 0], [0, 1, 0])).toBeCloseTo(0, 9);
  });
});
