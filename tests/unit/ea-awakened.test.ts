import { describe, expect, test } from "vitest";
import { EA_DEFS } from "../../packages/shared/src/config/kits/ea.js";
import { COMBAT } from "../../packages/shared/src/config/combat.js";
import { ALL_HANDLERS, buildKitRegistry } from "../../apps/server/src/kits/index.js";
import { ACTIVATIONS, AwakeningSystem } from "../../apps/server/src/sim/Awakening.js";
import { CombatSystem } from "../../apps/server/src/sim/Combat.js";
import { AbilityRunner, type AbilityHost, type AbilityPose, type SkillOutcome } from "../../apps/server/src/sim/AbilityRunner.js";
import type { HitCandidate, HitResult } from "../../apps/server/src/sim/HitResolver.js";

/**
 * Ember Artificer awakening (T21): ea.activate Stellar Furnace and ea.a1 Arc Descent, ea.a2 Comet Lock, ea.a3 Furnace Ray,
 * ea.a4 Solar Vent. Driven tick by tick in the room's order (expiry, awakening update, buffered intent, input, collision
 * query, serial resolution, handler results, meter) against a fake host, so every boundary is an exact integer tick.
 * Rules and D values: docs/decisions/0022-t21-artificer-awakening-rules.md.
 */
const T0 = 1000;
const HP = COMBAT.hp100Max;

const reg = buildKitRegistry();
const def = (id: string) => reg.byId(id)!;

function makeRig(n = 3, hostOpts: { moveTogether?: AbilityHost["moveTogether"] } = {}) {
  const cs = new CombatSystem();
  const poses = new Map<number, AbilityPose>();
  for (let i = 1; i <= n; i++) cs.add(i, i, 0, i === 1 ? "ea" : "sv").protectedUntilTick = 0;
  // 1: Ember Artificer at the origin facing -Z. 2: victim 1.5 m ahead. 3: 3 m ahead. 4 and up: far bystanders, placed per test.
  poses.set(1, { x: 0, y: 1, z: 0, facingYaw: 0, grounded: true });
  poses.set(2, { x: 0, y: 1, z: -1.5, facingYaw: Math.PI, grounded: true });
  if (n >= 3) poses.set(3, { x: 0.3, y: 1, z: -3, facingYaw: Math.PI, grounded: true });
  for (let i = 4; i <= n; i++) poses.set(i, { x: 30 + i, y: 1, z: -2, facingYaw: Math.PI, grounded: true });
  let wallZ: number | null = null;
  let occluded = false;
  const launches: { id: number; vx: number; vy: number; vz: number; tick: number }[] = [];
  let curTick = T0;
  const host: AbilityHost = {
    combat: cs, pose: (id) => poses.get(id),
    blocked: (a, b) => occluded || (wallZ !== null && (a[2] - wallZ) * (b[2] - wallZ) < 0),
    launch: (id, vx, vy, vz) => { launches.push({ id, vx, vy, vz, tick: curTick }); },
    moveTogether: hostOpts.moveTogether ?? ((ids, dx, dz) => {
      for (const i of ids) { const p = poses.get(i)!; p.x += dx; p.z += dz; }
      return { dx, dz };
    }),
  };
  const runner = new AbilityRunner(reg, ALL_HANDLERS, host);
  const aw = new AwakeningSystem(host);
  const results: { tick: number; r: HitResult }[] = [];
  const outcomes: { tick: number; who: number; o: SkillOutcome }[] = [];
  let strikeSeq = 100;
  /** A third party ordinary hit (counterable stun by default) not tied to any ability cast. */
  const strike = (a: number, t: number, o: Partial<HitCandidate> = {}): HitCandidate => ({
    attackerId: a, attackerGeneration: cs.get(a)!.generation, castCounter: ++strikeSeq, hitIndex: 0, toi: 0, targetId: t,
    moveId: "test.strike", originX: poses.get(a)?.x ?? 0, originZ: poses.get(a)?.z ?? 0, block: "U", counterable: true,
    armorBreak: false, damage100: 300, reaction: { kind: "stun", ticks: 24 }, maxHitsPerTarget: 1, ...o,
  });
  interface StepOpts { press?: { who?: number; slot: 1 | 2 | 3 | 4 }[]; extra?: HitCandidate[]; guard?: number[]; awaken?: boolean }
  const step = (tick: number, o: StepOpts = {}): HitResult[] => {
    curTick = tick;
    cs.expire(tick, (id) => poses.get(id)?.grounded ?? true);
    aw.update(tick);
    for (let i = 1; i <= n; i++) {
      const f = cs.get(i);
      if (!f) continue;
      const b = runner.consumeBuffer(f, tick);
      if (b) outcomes.push({ tick, who: i, o: b.outcome });
    }
    if (o.awaken) aw.request(cs.get(1)!, tick);
    for (const p of o.press ?? []) {
      const f = cs.get(p.who ?? 1);
      if (f) outcomes.push({ tick, who: p.who ?? 1, o: runner.skillDown(f, tick, p.slot, 1) });
    }
    for (const id of o.guard ?? []) cs.updateGuard(id, tick, true, true);
    const cands = [...runner.collect(tick), ...aw.collect(tick), ...(o.extra ?? [])];
    const res = cs.resolve(tick, cands, (id) => { const q = poses.get(id); return q && { x: q.x, z: q.z, facingYaw: q.facingYaw, grounded: q.grounded }; });
    runner.afterResolve(tick, res);
    aw.gain(res);
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
  return {
    cs, poses, runner, aw, host, results, outcomes, launches, strike, step, run, hp, dealt, awaken,
    setWallZ: (z: number | null) => { wallZ = z; }, setOccluded: (v: boolean) => { occluded = v; },
  };
}
type Rig = ReturnType<typeof makeRig>;
const put = (r: Rig, id: number, x: number, z: number, y = 1): void => { r.poses.set(id, { x, y, z, facingYaw: Math.PI, grounded: true }); };
const started = (r: Rig, moveId: string): void => { expect(r.outcomes.at(-1)!.o).toMatchObject({ kind: "started", moveId }); };
const tickOf = (r: Rig, outcome: string, idx = 0): number => r.results.filter((x) => x.r.outcome === outcome)[idx]?.tick ?? -1;

describe("ea awakened definitions match the spec 15 table", () => {
  test("slotted awakened moves carry the exact table numbers", () => {
    expect(EA_DEFS.filter((d) => d.form === "Awakened").map((d) => d.id)).toEqual(["ea.a1", "ea.a2", "ea.a3", "ea.a4"]);
    const table: Record<string, [number, number, number, number, number, string, string, boolean]> = {
      // startup, active, recovery, cooldown, total damage100 (hit branch), block, handler, oncePerForm
      "ea.a1": [30, 18, 30, 900, 4000, "U", "arcDescent", false],
      "ea.a2": [20, 24, 36, 1200, 5000, "U", "cometLock", false],
      "ea.a3": [30, 90, 30, 1500, 3500, "B", "furnaceRay", false],
      "ea.a4": [72, 180, 48, 0, 7000, "U", "solarVent", true],
    };
    for (const id of Object.keys(table)) {
      const d = def(id);
      expect([d.startup, d.active, d.recovery, d.cooldown, d.damage100.reduce((a, b) => a + b, 0), d.block, d.handler, d.oncePerForm]).toEqual(table[id]);
      expect([d.form, d.consumesForm, d.slot]).toEqual(["Awakened", false, Number(id.slice(-1))]);
    }
    expect(def("ea.a3").hitOffsets).toEqual([0, 15, 30, 45, 60, 75, 89]);
    expect(def("ea.a4").hitOffsets).toEqual([0, 20, 40, 60, 80, 100, 120, 140, 160, 179]);
    expect([def("ea.a1").armor, def("ea.a1").counterable, def("ea.a2").counterable, def("ea.a3").armor, def("ea.a4").armor]).toEqual(["startup", true, false, "onHit", "none"]);
    expect([def("ea.a3").turnRate, def("ea.a3").moveScale, def("ea.a4").turnRate]).toEqual([30, 0, 15]);
    expect([def("ea.a3").shape, def("ea.a4").shape]).toEqual([{ kind: "beam", length: 24, radius: 1 }, { kind: "beam", length: 36, radius: 3 }]);
    expect(ACTIVATIONS.ea).toMatchObject({ ticks: 90, formTicks: 2820, healAtCompletion100: 4000, invulnerable: null });
    expect(ACTIVATIONS.ea!.burst).toMatchObject({ atTicks: [0, 72], damage100: 1600, radius: 5, maxTargets: 4 });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("ea.activate Stellar Furnace", () => {
  const eaRig = (targets = 2) => { const r = makeRig(1 + targets); r.cs.get(1)!.meter100 = 35000; return r; };

  test("90 ticks, armor throughout, no invulnerability; completion at +90 sets Awakened, meter 0, bits reset, form until +90+2820", () => {
    const r = eaRig(1);
    const f = r.cs.get(1)!;
    f.awakenedUsedMask = 0b1010;
    expect(r.aw.request(f, T0)).toMatchObject({ kind: "started", moveId: "ea.activate" });
    expect(f.armored).toBe(true);
    r.step(T0 + 1);
    // armor ignores a plain stun but the damage lands (no invulnerability)
    r.step(T0 + 10, { extra: [r.strike(2, 1)] });
    expect(f.hp100).toBe(HP - 300);
    expect(f.action).toBe("Awakening");
    r.run(T0 + 11, T0 + 89);
    expect(f.form).toBe("Base");
    expect(f.armored).toBe(true);
    r.step(T0 + 90);
    expect([f.form, f.meter100, f.awakenedUsedMask, f.armored]).toEqual(["Awakened", 0, 0, false]);
    expect(f.formEndTick).toBe(T0 + 90 + 2820);
  });

  test("pulses at +0 and +72: 16 HP each, U, noncounterable, R60 F4 U3, radius 5, max 4 targets nearest first; no meter for the caster", () => {
    const r = eaRig(5);
    for (let i = 2; i <= 6; i++) r.cs.get(i)!.counterOpenUntil = T0 + 500; // counters cannot intercept a noncounterable pulse
    const f = r.cs.get(1)!;
    put(r, 4, 0, -2); put(r, 5, 0, -2.5); put(r, 6, 0, -4);
    r.cs.updateGuard(2, T0, true, true);
    r.aw.request(f, T0);
    r.step(T0, {});
    const hurt = [2, 3, 4, 5, 6].filter((i) => r.cs.get(i)!.hp100 === HP - 1600);
    expect(hurt).toEqual([2, 3, 4, 5]);
    expect(r.cs.get(6)!.hp100).toBe(HP);
    for (const i of hurt) expect(r.cs.get(i)!.action).toBe("Ragdolled");
    expect(r.cs.get(2)!.actionEndTick - r.cs.get(2)!.actionStartTick).toBe(60);
    r.step(T0 + 1);
    expect(r.cs.get(2)!.hp100).toBe(HP - 1600); // one hit per pulse
    // victims stand up again before the second pulse
    for (const i of [2, 3, 4, 5, 6]) { const v = r.cs.get(i)!; v.action = "Idle"; v.actionEndTick = 0; v.hp100 = HP; }
    r.run(T0 + 2, T0 + 71);
    expect(r.cs.get(2)!.hp100).toBe(HP);
    r.step(T0 + 72);
    expect(r.cs.get(2)!.hp100).toBe(HP - 1600);
    expect([2, 3, 4, 5, 6].map((i) => r.cs.get(i)!.hp100)).toEqual([HP - 1600, HP - 1600, HP - 1600, HP - 1600, HP]);
    expect(f.meter100).toBe(35000); // no meter from the activation
  });

  test("pulse U ignores a frontal guard; both pulses can hit the same target (two in the whole cast)", () => {
    const r = eaRig(1);
    r.aw.request(r.cs.get(1)!, T0);
    r.cs.updateGuard(2, T0, true, true);
    r.step(T0);
    expect(r.hp(2)).toBe(HP - 1600);
    expect(r.results.at(-1)!.r.outcome).toBe("hit");
    const v = r.cs.get(2)!;
    v.action = "Idle"; v.actionEndTick = 0;
    r.run(T0 + 1, T0 + 72);
    expect(r.hp(2)).toBe(HP - 3200);
    r.run(T0 + 73, T0 + 90);
    expect(r.hp(2)).toBe(HP - 3200);
    expect(r.results.filter((x) => x.r.candidate.moveId === "ea.activate").length).toBe(2);
  });

  test("miss: a target outside 5 m, a wall between, and the dead take nothing", () => {
    const r = eaRig(3);
    put(r, 2, 0, -5.4);
    r.setOccluded(false);
    r.cs.kill(4, T0 - 5);
    r.aw.request(r.cs.get(1)!, T0);
    r.step(T0);
    expect([r.hp(2), r.hp(3)]).toEqual([HP, HP - 1600]);
    const w = eaRig(1);
    w.setOccluded(true);
    w.aw.request(w.cs.get(1)!, T0);
    w.step(T0);
    expect(w.hp(2)).toBe(HP);
  });

  test("heal 40 HP once at completion, capped at 100", () => {
    const r = eaRig(1);
    const f = r.cs.get(1)!;
    f.hp100 = 5000;
    r.aw.request(f, T0);
    r.run(T0, T0 + 89);
    expect(f.hp100).toBe(5000);
    r.step(T0 + 90);
    expect(f.hp100).toBe(9000);
    r.step(T0 + 91);
    expect(f.hp100).toBe(9000);
    const g = eaRig(1);
    g.cs.get(1)!.hp100 = 9500;
    g.aw.request(g.cs.get(1)!, T0);
    g.run(T0, T0 + 90);
    expect(g.cs.get(1)!.hp100).toBe(HP);
  });

  test("interruption: armorBreak or capture cancels, meter and Base form are kept, the second pulse never fires", () => {
    const r = eaRig(1);
    const f = r.cs.get(1)!;
    r.aw.request(f, T0);
    r.run(T0, T0 + 20);
    r.step(T0 + 21, { extra: [r.strike(2, 1, { armorBreak: true, counterable: false })] });
    expect(f.action).toBe("Stunned");
    r.step(T0 + 22);
    expect(f.armored).toBe(false);
    r.run(T0 + 23, T0 + 120);
    expect([f.form, f.meter100]).toEqual(["Base", 35000]);
    expect(r.aw.activeCount).toBe(0);
    expect(r.results.filter((x) => x.r.candidate.moveId === "ea.activate").length).toBe(1);
  });

  test("death mid activation clears it and the second pulse never fires; no heal", () => {
    const r = eaRig(1);
    const f = r.cs.get(1)!;
    r.aw.request(f, T0);
    r.run(T0, T0 + 30);
    r.cs.kill(1, T0 + 31);
    r.aw.reset(1);
    r.run(T0 + 32, T0 + 100);
    expect(r.aw.activeCount).toBe(0);
    expect(f.form).toBe("Base");
    expect(r.results.filter((x) => x.r.candidate.moveId === "ea.activate").length).toBe(1);
  });

  test("requires full meter, grounded, Idle and Base (METER, STATE, FORM); never buffered", () => {
    const r = makeRig(1);
    const f = r.cs.get(1)!;
    expect(r.aw.request(f, T0)).toEqual({ kind: "rejected", reason: "METER" });
    f.meter100 = 34999;
    expect(r.aw.request(f, T0)).toEqual({ kind: "rejected", reason: "METER" });
    f.meter100 = 35000;
    r.poses.get(1)!.grounded = false;
    expect(r.aw.request(f, T0)).toEqual({ kind: "rejected", reason: "STATE" });
    r.poses.get(1)!.grounded = true;
    f.form = "Awakened";
    expect(r.aw.request(f, T0)).toEqual({ kind: "rejected", reason: "FORM" });
    f.form = "Base";
    expect(r.aw.request(f, T0).kind).toBe("started");
    expect(r.aw.request(f, T0 + 1)).toEqual({ kind: "rejected", reason: "STATE" });
  });

  test("form expiry: Awakened returns to Base exactly at completion + 2820; new awakened casts cannot start", () => {
    const r = eaRig(1);
    const f = r.cs.get(1)!;
    r.aw.request(f, T0);
    r.run(T0, T0 + 90);
    expect(f.form).toBe("Awakened");
    r.step(T0 + 90 + 2819);
    expect(f.form).toBe("Awakened");
    r.step(T0 + 90 + 2820);
    expect(f.form).toBe("Base");
    expect(f.formEndTick).toBe(0);
    // slot 1 now resolves to the Base move
    expect(r.runner.skillDown(f, T0 + 90 + 2821, 1, 5)).toMatchObject({ kind: "started", moveId: "ea.b1" });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("ea.a1 Arc Descent", () => {
  const AS = T0 + 30; // activeStart
  const PE = AS + 18; // probe end

  test("hit: advances 0.4 m per tick, cinematic capture, 15 HP at capture, 25 HP at +36, release +42 R84 F5 U8, cooldown 900", () => {
    const r = makeRig(2);
    r.awaken();
    r.step(T0, { press: [{ slot: 1 }] });
    started(r, "ea.a1");
    expect(r.cs.get(1)!.cooldowns.get("ea.a1")).toBe(T0 + 900);
    r.run(T0 + 1, AS - 1);
    expect(r.poses.get(1)!.z).toBe(0); // no advance before activeStart
    expect(r.cs.get(1)!.armored).toBe(true);
    r.step(AS);
    expect(r.poses.get(1)!.z).toBeCloseTo(-0.4, 6);
    expect(r.cs.get(1)!.armored).toBe(false);
    r.run(AS + 1, AS + 1);
    const C = tickOf(r, "captured");
    expect(C).toBe(AS + 1);
    expect(r.cs.get(2)!.action).toBe("Captured");
    expect(r.hp(2)).toBe(HP - 1500);
    r.run(C + 1, C + 35);
    expect(r.hp(2)).toBe(HP - 1500);
    r.step(C + 36);
    expect(r.hp(2)).toBe(HP - 4000);
    expect(r.dealt(1, 2)).toEqual([[C, 1500], [C + 36, 2500]]);
    r.run(C + 37, C + 41);
    expect(r.cs.get(2)!.action).toBe("Captured");
    r.step(C + 42);
    expect(r.cs.get(2)!.action).toBe("Ragdolled");
    expect(r.cs.get(2)!.actionEndTick - r.cs.get(2)!.actionStartTick).toBe(84);
    expect(r.launches.at(-1)).toMatchObject({ id: 2, tick: C + 42, vy: 8 });
    expect(Math.hypot(r.launches.at(-1)!.vx, r.launches.at(-1)!.vz)).toBeCloseTo(5, 6);
    expect(r.cs.captures.size).toBe(0);
    r.run(C + 43, C + 200);
    expect(r.cs.get(1)!.action).toBe("Idle");
    expect(r.hp(2)).toBe(HP - 4000);
    expect(r.outcomes.length).toBe(1);
  });

  test("cinematic: a third party cannot damage the captured victim or the caster during the sequence", () => {
    const r = makeRig(3);
    r.awaken();
    r.step(T0, { press: [{ slot: 1 }] });
    r.run(T0 + 1, AS + 1);
    r.step(AS + 5, { extra: [r.strike(3, 2), r.strike(3, 1)] });
    expect(r.results.filter((x) => x.tick === AS + 5).map((x) => x.r.outcome)).toEqual(["shielded", "shielded"]);
    expect(r.hp(2)).toBe(HP - 1500);
  });

  test("startup armor: a plain hit in startup is taken without stun; the cast proceeds", () => {
    const r = makeRig(2);
    r.awaken();
    put(r, 2, 0, -9);
    r.step(T0, { press: [{ slot: 1 }] });
    r.step(T0 + 10, { extra: [r.strike(2, 1)] });
    expect(r.hp(1)).toBe(HP - 300);
    expect(r.cs.get(1)!.action).toBe("Windup");
    r.run(T0 + 11, AS + 1);
    expect(r.cs.get(1)!.action).toBe("Active");
  });

  test("capture supports standing, air and ragdoll targets", () => {
    for (const mode of ["air", "ragdoll"] as const) {
      const r = makeRig(2);
      r.awaken();
      if (mode === "air") r.poses.get(2)!.grounded = false;
      else { r.cs.get(2)!.action = "Ragdolled"; r.cs.get(2)!.actionEndTick = T0 + 500; r.cs.get(2)!.actionStartTick = T0 - 1; }
      r.step(T0, { press: [{ slot: 1 }] });
      r.run(T0 + 1, AS + 1);
      expect(r.results.some((x) => x.r.outcome === "captured"), mode).toBe(true);
    }
  });

  test("reach: swept 7.2 m plus sweep and capsule radii; 8.1 m is captured on the last active tick, 8.3 m is a miss", () => {
    const near = makeRig(2);
    near.awaken();
    put(near, 2, 0, -8.1);
    near.step(T0, { press: [{ slot: 1 }] });
    near.run(T0 + 1, PE);
    expect(tickOf(near, "captured")).toBe(PE - 1);
    const far = makeRig(2);
    far.awaken();
    put(far, 2, 0, -8.3);
    far.step(T0, { press: [{ slot: 1 }] });
    far.run(T0 + 1, PE);
    expect(tickOf(far, "captured")).toBe(-1);
  });

  test("a wall stops the advance for good", () => {
    let calls = 0;
    const r = makeRig(2, { moveTogether: (ids, dx, dz) => { calls++; const full = calls <= 2; const k = full ? 1 : 0; for (const i of ids) { const p = r.poses.get(i)!; p.x += dx * k; p.z += dz * k; } return { dx: dx * k, dz: dz * k }; } });
    r.awaken();
    put(r, 2, 0, -9);
    r.step(T0, { press: [{ slot: 1 }] });
    r.run(T0 + 1, PE);
    expect(r.poses.get(1)!.z).toBeCloseTo(-0.8, 6);
  });

  test("miss: 30 tick vulnerable windup (no armor), then radius 5 blast 20 HP U noncounterable R60 F5 U5, max 4; recovery follows the blast", () => {
    const r = makeRig(6);
    r.awaken();
    for (let i = 2; i <= 6; i++) { r.cs.get(i)!.counterOpenUntil = T0 + 900; put(r, i, 0.1 * i, -30 - i); }
    r.step(T0, { press: [{ slot: 1 }] });
    r.run(T0 + 1, PE - 1);
    expect(r.cs.get(1)!.action).toBe("Active");
    // after the advance (7.2 m) the caster stands at z = -7.2; put victims within 5 m of that point
    const cz = r.poses.get(1)!.z;
    expect(cz).toBeCloseTo(-7.2, 6);
    // victims placed after the sweep: 5 candidates, 4 allowed, nearest four
    const zs = [-8.5, -9.5, -10.5, -11.5, -12.1];
    zs.forEach((z, k) => put(r, 2 + k, 0, z));
    r.cs.get(6)!.counterOpenUntil = T0 + 900;
    r.step(PE);
    expect(r.cs.get(1)!.action).toBe("Active"); // windup: vulnerable Active, no armor
    expect(r.cs.get(1)!.armored).toBe(false);
    expect(r.runner.castOf(1)!.endTick).toBe(PE + 30 + 1 + 30);
    r.run(PE + 1, PE + 29);
    expect([2, 3, 4, 5, 6].map((i) => r.hp(i))).toEqual([HP, HP, HP, HP, HP]);
    r.step(PE + 30);
    expect([2, 3, 4, 5].map((i) => r.hp(i))).toEqual([HP - 2000, HP - 2000, HP - 2000, HP - 2000]);
    expect(r.hp(6)).toBe(HP);
    for (const i of [2, 3, 4, 5]) expect(r.cs.get(i)!.action).toBe("Ragdolled");
    expect(r.cs.get(2)!.actionEndTick - r.cs.get(2)!.actionStartTick).toBe(60);
    expect(r.cs.get(1)!.action).toBe("Active"); // the blast tick is the last windup tick
    r.step(PE + 31);
    expect(r.cs.get(1)!.action).toBe("Recovery");
    r.run(PE + 32, PE + 61);
    expect(r.cs.get(1)!.action).toBe("Idle");
    expect(r.results.filter((x) => x.r.candidate.moveId === "ea.a1" && x.r.damage100 > 0).length).toBe(4);
    expect(r.cs.get(1)!.cooldowns.get("ea.a1")).toBe(T0 + 900);
  });

  test("miss with nobody in range: no damage, the cast still ends after the windup and recovery", () => {
    const r = makeRig(2);
    r.awaken();
    put(r, 2, 40, 40);
    r.step(T0, { press: [{ slot: 1 }] });
    r.run(T0 + 1, PE + 30 + 31);
    expect(r.hp(2)).toBe(HP);
    expect(r.cs.get(1)!.action).toBe("Idle");
    expect(r.runner.castOf(1)).toBeUndefined();
  });

  test("blast block and counter: the blast is U and noncounterable, so neither a guard nor an open counter stops it", () => {
    const r = makeRig(2);
    r.awaken();
    put(r, 2, 0, -9);
    r.cs.get(2)!.counterOpenUntil = T0 + 900;
    r.step(T0, { press: [{ slot: 1 }] });
    r.run(T0 + 1, PE + 29);
    r.step(PE + 30, { guard: [2] });
    expect(r.hp(2)).toBe(HP - 2000);
  });

  test("counter: the counterable initial hit is intercepted, nothing is captured, the miss branch follows", () => {
    const r = makeRig(2);
    r.awaken();
    r.cs.get(2)!.counterOpenUntil = T0 + 900;
    r.step(T0, { press: [{ slot: 1 }] });
    r.run(T0 + 1, AS + 3);
    expect(r.results.some((x) => x.r.outcome === "countered")).toBe(true);
    expect(r.results.some((x) => x.r.outcome === "captured")).toBe(false);
    expect(r.cs.captures.size).toBe(0);
    r.run(AS + 4, PE);
    expect(r.cs.get(1)!.action).toBe("Active"); // the miss branch follows: vulnerable windup
    put(r, 2, 0, r.poses.get(1)!.z - 2);
    r.run(PE + 1, PE + 30);
    expect(r.hp(2)).toBe(HP - 2000); // the blast is noncounterable and reaches the victim
  });

  test("duplicate hit: a repeated capture or blast candidate for the same victim deals nothing", () => {
    const r = makeRig(2);
    r.awaken();
    r.step(T0, { press: [{ slot: 1 }] });
    r.run(T0 + 1, AS);
    const first = r.step(AS + 1);
    const cap = first.find((x) => x.outcome === "captured")!;
    r.step(AS + 2, { extra: [{ ...cap.candidate }] });
    expect(r.results.at(-1)!.r.outcome).toBe("duplicate");
    expect(r.dealt(1, 2).length).toBe(1);
  });

  test("interruption during the advance (no armor in active) cancels: nothing captured, no windup blast; cooldown spent", () => {
    const r = makeRig(2);
    r.awaken();
    put(r, 2, 0, -9);
    r.step(T0, { press: [{ slot: 1 }] });
    r.run(T0 + 1, AS + 2);
    r.step(AS + 3, { extra: [r.strike(2, 1)] });
    expect(r.cs.get(1)!.action).toBe("Stunned");
    r.run(AS + 4, PE + 80);
    expect(r.hp(2)).toBe(HP);
    expect(r.runner.castOf(1)).toBeUndefined();
    expect(r.cs.get(1)!.cooldowns.get("ea.a1")).toBe(T0 + 900);
  });

  test("interruption in startup by armorBreak cancels the cast; a plain stun is ignored by armor", () => {
    const r = makeRig(2);
    r.awaken();
    put(r, 2, 0, -2);
    r.step(T0, { press: [{ slot: 1 }] });
    r.step(T0 + 5, { extra: [r.strike(2, 1, { armorBreak: true, counterable: false })] });
    expect(r.cs.get(1)!.action).toBe("Stunned");
    r.run(T0 + 6, PE + 40);
    expect(r.results.some((x) => x.r.outcome === "captured")).toBe(false);
    expect(r.runner.castOf(1)).toBeUndefined();
  });

  test("interrupted windup: one smaller blast (radius 2, 13 HP) on the next tick, then the cast is cancelled; the full blast never fires", () => {
    const r = makeRig(3);
    r.awaken();
    put(r, 2, 40, 40);
    put(r, 3, 40, 40);
    r.step(T0, { press: [{ slot: 1 }] });
    r.run(T0 + 1, PE + 9);
    put(r, 2, 0, -8.5); // 1.3 m from the caster at -7.2
    put(r, 3, 0, -10.5); // 3.3 m: outside radius 2 (+0.35)
    r.step(PE + 10, { extra: [r.strike(3, 1)] });
    expect(r.cs.get(1)!.action).toBe("Stunned");
    r.step(PE + 11);
    expect(r.hp(2)).toBe(HP - 1300);
    expect(r.hp(3)).toBe(HP);
    expect(r.cs.get(2)!.action).toBe("Ragdolled");
    expect(r.cs.get(2)!.actionEndTick - r.cs.get(2)!.actionStartTick).toBe(36);
    r.run(PE + 12, PE + 80);
    expect(r.hp(2)).toBe(HP - 1300);
    expect(r.hp(3)).toBe(HP);
    expect(r.results.filter((x) => x.r.candidate.moveId === "ea.a1" && x.r.damage100 > 0).length).toBe(1);
  });

  test("a smaller blast is U and noncounterable and emitted once even if the caster is hit again", () => {
    const r = makeRig(3);
    r.awaken();
    put(r, 2, 40, 40);
    put(r, 3, 40, 41);
    r.step(T0, { press: [{ slot: 1 }] });
    r.run(T0 + 1, PE + 9);
    put(r, 2, 0, -8.5);
    r.cs.get(2)!.counterOpenUntil = T0 + 900;
    r.step(PE + 10, { extra: [r.strike(3, 1)] });
    r.step(PE + 11, { extra: [r.strike(3, 1, { castCounter: 777 })], guard: [2] });
    expect(r.hp(2)).toBe(HP - 1300);
    r.run(PE + 12, PE + 40);
    expect(r.hp(2)).toBe(HP - 1300);
  });

  test("a killed caster in the windup emits no blast at all", () => {
    const r = makeRig(3);
    r.awaken();
    put(r, 2, 40, 40);
    put(r, 3, 40, 41);
    r.step(T0, { press: [{ slot: 1 }] });
    r.run(T0 + 1, PE + 9);
    put(r, 2, 0, -8.5);
    r.cs.get(1)!.hp100 = 200;
    r.step(PE + 10, { extra: [r.strike(3, 1)] });
    expect(r.cs.get(1)!.hp100).toBe(0);
    r.run(PE + 11, PE + 90);
    expect(r.hp(2)).toBe(HP);
    expect(r.results.filter((x) => x.r.candidate.moveId === "ea.a1").length).toBe(0);
  });

  test("a captured victim that dies leaves no miss branch (lethal capture and lethal second hit)", () => {
    const a = makeRig(2);
    a.awaken();
    a.cs.get(2)!.hp100 = 1500;
    a.step(T0, { press: [{ slot: 1 }] });
    a.run(T0 + 1, PE + 70);
    expect(a.hp(2)).toBe(0);
    expect(a.results.filter((x) => x.r.candidate.moveId === "ea.a1" && x.r.damage100 > 0).length).toBe(1);
    expect(a.runner.castOf(1)).toBeUndefined();
    const b = makeRig(2);
    b.awaken();
    b.cs.get(2)!.hp100 = 3000;
    b.step(T0, { press: [{ slot: 1 }] });
    b.run(T0 + 1, PE + 120);
    expect(b.hp(2)).toBe(0);
    expect(b.dealt(1, 2).map((x) => x[1])).toEqual([1500, 1500]); // second hit clamps at the remaining HP
    expect(b.cs.captures.size).toBe(0);
    expect(b.results.some((x) => x.r.candidate.hitIndex >= 20)).toBe(false);
  });

  test("death of the caster mid capture releases the victim and stops the damage", () => {
    const r = makeRig(2);
    r.awaken();
    r.step(T0, { press: [{ slot: 1 }] });
    r.run(T0 + 1, AS + 1);
    r.cs.kill(1, AS + 10);
    r.run(AS + 11, AS + 80);
    expect(r.hp(2)).toBe(HP - 1500);
    expect(r.cs.captures.size).toBe(0);
    expect(r.cs.get(2)!.action).not.toBe("Captured");
  });

  test("expiry: the form expiring mid capture never cancels the cast; the second hit and release still happen; no new awakened cast", () => {
    const r = makeRig(2);
    r.awaken();
    r.cs.get(1)!.formEndTick = AS + 10;
    r.step(T0, { press: [{ slot: 1 }] });
    r.run(T0 + 1, AS + 10);
    expect(r.cs.get(1)!.form).toBe("Base");
    expect(r.cs.get(2)!.action).toBe("Captured");
    r.run(AS + 11, AS + 60);
    expect(r.hp(2)).toBe(HP - 4000);
    expect(r.cs.get(2)!.action).toBe("Ragdolled");
    r.cs.get(1)!.cooldowns.clear();
    r.run(AS + 61, AS + 120);
    expect(r.runner.skillDown(r.cs.get(1)!, AS + 121, 1, 9)).toMatchObject({ kind: "started", moveId: "ea.b1" });
  });

  test("static occlusion prevents the capture", () => {
    const r = makeRig(2);
    r.awaken();
    r.setOccluded(true);
    r.step(T0, { press: [{ slot: 1 }] });
    r.run(T0 + 1, PE);
    expect(r.results.some((x) => x.r.outcome === "captured")).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("ea.a2 Comet Lock", () => {
  const AS = T0 + 20;
  const PE = AS + 24;

  test("hit: dash 2/3 m per tick, caster invulnerable through the dash and capture, 0 at capture, 50 HP at +54, release +60 R90 F3 U8, cooldown 1200", () => {
    const r = makeRig(2);
    r.awaken();
    put(r, 2, 0, -6);
    r.step(T0, { press: [{ slot: 2 }] });
    started(r, "ea.a2");
    expect(r.cs.get(1)!.cooldowns.get("ea.a2")).toBe(T0 + 1200);
    r.run(T0 + 1, AS - 1);
    expect(r.poses.get(1)!.z).toBe(0);
    expect(r.cs.get(1)!.invulnerableUntil).toBeLessThanOrEqual(T0);
    r.step(AS);
    expect(r.poses.get(1)!.z).toBeCloseTo(-40 / 60, 6);
    const C = (() => { for (let t = AS + 1; t <= PE; t++) { r.step(t); if (r.results.some((x) => x.r.outcome === "captured")) return t; } return -1; })();
    expect(C).toBe(AS + 7); // the 8th step (AS..AS+7) of 0.667 m brings the sweep within 0.6 + 0.35 of a target at 6 m
    expect(r.hp(2)).toBe(HP); // the capture hit deals nothing
    expect(r.cs.get(2)!.action).toBe("Captured");
    // caster invulnerable through the capture
    r.step(C + 5, { extra: [r.strike(2, 1)] });
    expect(r.results.at(-1)!.r.outcome).toMatch(/invulnerable|shielded/);
    r.run(C + 6, C + 53);
    expect(r.hp(2)).toBe(HP);
    r.step(C + 54);
    expect(r.hp(2)).toBe(HP - 5000);
    r.run(C + 55, C + 59);
    expect(r.cs.get(2)!.action).toBe("Captured");
    r.step(C + 60);
    expect(r.cs.get(2)!.action).toBe("Ragdolled");
    expect(r.cs.get(2)!.actionEndTick - r.cs.get(2)!.actionStartTick).toBe(90);
    expect(r.launches.at(-1)).toMatchObject({ id: 2, vy: 8 });
    expect(Math.hypot(r.launches.at(-1)!.vx, r.launches.at(-1)!.vz)).toBeCloseTo(3, 6);
    r.step(C + 61, { extra: [r.strike(2, 1)] });
    r.run(C + 62, C + 200);
    expect(r.cs.get(1)!.action).toBe("Idle");
    expect(r.cs.captures.size).toBe(0);
  });

  test("startup is vulnerable; the dash is invulnerable; a miss goes to vulnerable recovery", () => {
    const r = makeRig(2);
    r.awaken();
    put(r, 2, 40, 40);
    r.step(T0, { press: [{ slot: 2 }] });
    r.run(T0 + 1, AS - 1);
    r.step(AS - 1 + 1, { extra: [r.strike(2, 1, { counterable: false })] });
    expect(r.results.at(-1)!.r.outcome).toBe("invulnerable");
    r.run(AS + 1, PE - 1);
    r.step(PE, { extra: [r.strike(2, 1, { counterable: false })] });
    expect(r.results.at(-1)!.r.outcome).toBe("hit");
    expect(r.cs.get(1)!.action).toBe("Stunned");
  });

  test("branch is fixed at capture: a ragdolled target takes 30, a standing or airborne one 50; later state changes do not matter", () => {
    const rag = makeRig(2);
    rag.awaken();
    put(rag, 2, 0, -3);
    const v = rag.cs.get(2)!;
    v.action = "Ragdolled"; v.actionStartTick = T0 - 1; v.actionEndTick = T0 + 400;
    rag.step(T0, { press: [{ slot: 2 }] });
    rag.run(T0 + 1, PE);
    const C = tickOf(rag, "captured");
    expect(C).toBeGreaterThan(0);
    rag.run(PE + 1, C + 54);
    expect(rag.hp(2)).toBe(HP - 3000);
    const air = makeRig(2);
    air.awaken();
    put(air, 2, 0, -3);
    air.poses.get(2)!.grounded = false;
    air.step(T0, { press: [{ slot: 2 }] });
    air.run(T0 + 1, PE);
    const C2 = tickOf(air, "captured");
    air.poses.get(2)!.grounded = true; // lands mid capture: the branch stays
    air.run(PE + 1, C2 + 54);
    expect(air.hp(2)).toBe(HP - 5000);
  });

  test("splash at +54: others within 4 m take 20 HP, R72 F5 U6, nearest first, max 3 others; victim, caster and the far are excluded", () => {
    const r = makeRig(7);
    r.awaken();
    put(r, 2, 0, -3);
    put(r, 3, 2, -3); put(r, 4, -3, -3); put(r, 5, 0, -5.5); put(r, 6, 0, -6.5); put(r, 7, 9, -3);
    r.step(T0, { press: [{ slot: 2 }] });
    r.run(T0 + 1, PE);
    const C = tickOf(r, "captured");
    r.run(PE + 1, C + 53);
    r.step(C + 54);
    expect(r.hp(2)).toBe(HP - 5000);
    expect(r.hp(1)).toBe(HP);
    expect([3, 4, 5].map((i) => r.hp(i))).toEqual([HP - 2000, HP - 2000, HP - 2000]);
    expect([6, 7].map((i) => r.hp(i))).toEqual([HP, HP]); // fourth nearest is beyond the cap of 3 others; 9 m is out of range
    for (const i of [3, 4, 5]) {
      expect(r.cs.get(i)!.action).toBe("Ragdolled");
      expect(r.cs.get(i)!.actionEndTick - r.cs.get(i)!.actionStartTick).toBe(72);
    }
    expect(r.results.filter((x) => x.tick === C + 54 && x.r.candidate.targetId !== 2).length).toBe(3);
    r.run(C + 55, C + 80);
    expect([3, 4, 5].map((i) => r.hp(i))).toEqual([HP - 2000, HP - 2000, HP - 2000]); // once
  });

  test("splash block: a frontal guard turns the 20 HP into chip 5 HP and no ragdoll; a wall between impact and target stops it", () => {
    const r = makeRig(4);
    r.awaken();
    put(r, 2, 0, -3);
    put(r, 3, 0, -6); // faces +Z (toward the impact)
    put(r, 4, 3, -3);
    r.step(T0, { press: [{ slot: 2 }] });
    r.run(T0 + 1, PE);
    const C = tickOf(r, "captured");
    r.run(PE + 1, C + 30);
    r.run(C + 31, C + 54, () => ({ guard: [3] }));
    expect(r.results.find((x) => x.tick === C + 54 && x.r.candidate.targetId === 3)!.r.outcome).toBe("blocked");
    expect(r.hp(3)).toBe(HP - 500);
    expect(r.cs.get(3)!.action).not.toBe("Ragdolled");
    expect(r.hp(4)).toBe(HP - 2000);
    const w = makeRig(3);
    w.awaken();
    put(w, 2, 0, -3);
    put(w, 3, 2, -3);
    w.step(T0, { press: [{ slot: 2 }] });
    w.run(T0 + 1, PE);
    const C2 = tickOf(w, "captured");
    w.run(PE + 1, C2 + 53);
    w.setOccluded(true);
    w.step(C2 + 54);
    expect(w.hp(3)).toBe(HP);
  });

  test("noncounterable: an open counter on the victim does not intercept the capture", () => {
    const r = makeRig(2);
    r.awaken();
    put(r, 2, 0, -3);
    r.cs.get(2)!.counterOpenUntil = T0 + 900;
    r.step(T0, { press: [{ slot: 2 }] });
    r.run(T0 + 1, PE);
    expect(r.results.some((x) => x.r.outcome === "captured")).toBe(true);
    expect(r.results.some((x) => x.r.outcome === "countered")).toBe(false);
  });

  test("an invulnerable or protected target is never captured (noncounterable does not hit invulnerable targets)", () => {
    const r = makeRig(2);
    r.awaken();
    put(r, 2, 0, -3);
    r.cs.get(2)!.invulnerableUntil = T0 + 900;
    r.step(T0, { press: [{ slot: 2 }] });
    r.run(T0 + 1, PE + 10);
    expect(r.results.some((x) => x.r.outcome === "captured")).toBe(false);
    expect(r.hp(2)).toBe(HP);
    expect(r.cs.get(1)!.action).not.toBe("Captured");
  });

  test("a wall stops the dash and a wall between caster and target prevents the capture", () => {
    const w = makeRig(2);
    w.awaken();
    put(w, 2, 0, -6);
    w.setOccluded(true);
    w.step(T0, { press: [{ slot: 2 }] });
    w.run(T0 + 1, PE + 5);
    expect(w.results.some((x) => x.r.outcome === "captured")).toBe(false);
    let calls = 0;
    const r = makeRig(2, { moveTogether: (ids, dx, dz) => { calls++; const k = calls <= 2 ? 1 : 0; for (const i of ids) { const p = r.poses.get(i)!; p.x += dx * k; p.z += dz * k; } return { dx: dx * k, dz: dz * k }; } });
    r.awaken();
    put(r, 2, 0, -9);
    r.step(T0, { press: [{ slot: 2 }] });
    r.run(T0 + 1, PE);
    expect(r.poses.get(1)!.z).toBeCloseTo(-4 / 3, 6);
    expect(r.results.some((x) => x.r.outcome === "captured")).toBe(false);
  });

  test("duplicate hit: one capture and exactly one damage hit for the whole cast", () => {
    const r = makeRig(2);
    r.awaken();
    put(r, 2, 0, -3);
    r.step(T0, { press: [{ slot: 2 }] });
    r.run(T0 + 1, PE);
    const C = tickOf(r, "captured");
    r.run(PE + 1, C + 54);
    const dmg = r.results.find((x) => x.tick === C + 54 && x.r.candidate.targetId === 2)!;
    r.step(C + 55, { extra: [{ ...dmg.r.candidate }] });
    expect(r.results.at(-1)!.r.outcome).toBe("duplicate");
    expect(r.dealt(1, 2)).toEqual([[C + 54, 5000]]);
  });

  test("interruption in startup (stun) cancels; the cooldown is spent and nothing happens", () => {
    const r = makeRig(2);
    r.awaken();
    put(r, 2, 0, -3);
    r.step(T0, { press: [{ slot: 2 }] });
    r.step(T0 + 5, { extra: [r.strike(2, 1)] });
    expect(r.cs.get(1)!.action).toBe("Stunned");
    r.run(T0 + 6, PE + 80);
    expect(r.results.some((x) => x.r.outcome === "captured")).toBe(false);
    expect(r.cs.get(1)!.cooldowns.get("ea.a2")).toBe(T0 + 1200);
    expect(r.runner.castOf(1)).toBeUndefined();
  });

  test("death of the captor mid capture releases the victim; death of the victim stops the damage", () => {
    const c = makeRig(2);
    c.awaken();
    put(c, 2, 0, -3);
    c.step(T0, { press: [{ slot: 2 }] });
    c.run(T0 + 1, PE);
    const C = tickOf(c, "captured");
    c.cs.kill(1, C + 10);
    c.run(C + 11, C + 90);
    expect(c.hp(2)).toBe(HP);
    expect(c.cs.captures.size).toBe(0);
    const v = makeRig(2);
    v.awaken();
    put(v, 2, 0, -3);
    v.step(T0, { press: [{ slot: 2 }] });
    v.run(T0 + 1, PE);
    const C2 = tickOf(v, "captured");
    v.cs.kill(2, C2 + 10);
    v.run(C2 + 11, C2 + 90);
    expect(v.dealt(1, 2)).toEqual([]);
    expect(v.cs.captures.size).toBe(0);
  });

  test("lethal damage clamps at the remaining HP: one KO, no negative HP", () => {
    const r = makeRig(2);
    r.awaken();
    put(r, 2, 0, -3);
    r.cs.get(2)!.hp100 = 2000;
    r.step(T0, { press: [{ slot: 2 }] });
    r.run(T0 + 1, PE + 120);
    expect(r.hp(2)).toBe(0);
    expect(r.dealt(1, 2).map((x) => x[1])).toEqual([2000]);
    expect(r.cs.captures.size).toBe(0);
  });

  test("expiry: the form expiring mid capture never cancels the cast; damage and release happen; no new awakened cast starts", () => {
    const r = makeRig(2);
    r.awaken();
    put(r, 2, 0, -3);
    r.cs.get(1)!.formEndTick = AS + 20;
    r.step(T0, { press: [{ slot: 2 }] });
    r.run(T0 + 1, AS + 30);
    expect(r.cs.get(1)!.form).toBe("Base");
    expect(r.cs.get(2)!.action).toBe("Captured");
    r.run(AS + 31, AS + 100);
    expect(r.hp(2)).toBe(HP - 5000);
    expect(r.cs.get(2)!.action).toBe("Ragdolled");
    r.cs.get(1)!.cooldowns.clear();
    r.run(AS + 101, AS + 140);
    expect(r.runner.skillDown(r.cs.get(1)!, AS + 141, 2, 4)).toMatchObject({ kind: "started", moveId: "ea.b2" });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("ea.a3 Furnace Ray", () => {
  const AS = T0 + 30;
  const OFFS = [0, 15, 30, 45, 60, 75, 89];

  test("hit: seven pulses at activeStart + offsets, 5 HP each (35), stun 18, push 1 m/s, chip 1, cooldown 1500", () => {
    const r = makeRig(2);
    r.awaken();
    put(r, 2, 0, -5);
    r.step(T0, { press: [{ slot: 3 }] });
    started(r, "ea.a3");
    expect(r.cs.get(1)!.cooldowns.get("ea.a3")).toBe(T0 + 1500);
    r.run(T0 + 1, AS - 1);
    expect(r.hp(2)).toBe(HP);
    r.step(AS);
    expect(r.hp(2)).toBe(HP - 500);
    expect(r.cs.get(2)!.action).toBe("Stunned");
    expect(r.cs.get(2)!.actionEndTick - r.cs.get(2)!.actionStartTick).toBe(18);
    expect(r.launches.length).toBe(0); // launches are applied by the room from ability launches(); the definition carries them
    r.run(AS + 1, AS + 100);
    expect(r.dealt(1, 2)).toEqual(OFFS.map((o) => [AS + o, 500] as const));
    expect(r.hp(2)).toBe(HP - 3500);
    expect(def("ea.a3").launch).toEqual({ forward: 1, up: 0 });
    r.run(AS + 101, AS + 140);
    expect(r.cs.get(1)!.action).toBe("Idle");
  });

  test("armor begins the tick after the first confirmed damage and lasts through the last active tick; movement zero", () => {
    const r = makeRig(2);
    r.awaken();
    put(r, 2, 0, -5);
    r.step(T0, { press: [{ slot: 3 }] });
    r.run(T0 + 1, AS - 1);
    expect(r.cs.get(1)!.armored).toBe(false);
    r.step(AS);
    r.step(AS + 1);
    expect(r.cs.get(1)!.armored).toBe(true);
    r.step(AS + 5, { extra: [r.strike(2, 1)] });
    expect(r.cs.get(1)!.action).toBe("Active"); // armor ignores the stun
    expect(r.hp(1)).toBe(HP - 300);
    expect(r.runner.moveScaleOf(1)).toBe(0);
    expect(r.runner.freezesVertical(1, AS + 5)).toBe(true);
    r.run(AS + 6, AS + 89);
    expect(r.cs.get(1)!.armored).toBe(true);
    r.step(AS + 90);
    expect(r.cs.get(1)!.armored).toBe(false);
    expect(r.runner.freezesVertical(1, AS + 90)).toBe(false);
  });

  test("miss: no pulse and no armor; nothing behind the caster, beyond 24 m or outside radius 1 is hit", () => {
    const r = makeRig(4);
    r.awaken();
    put(r, 2, 0, 5); // behind
    put(r, 3, 0, -25.5); // beyond 24 m (+ radius)
    put(r, 4, 3, -5); // outside the lateral radius
    r.step(T0, { press: [{ slot: 3 }] });
    r.run(T0 + 1, AS + 100);
    expect([r.hp(2), r.hp(3), r.hp(4)]).toEqual([HP, HP, HP]);
    expect(r.cs.get(1)!.armored).toBe(false);
  });

  test("block: B is stopped by a frontal guard (chip 1 HP per pulse, no stun); a guard from behind does not block", () => {
    const r = makeRig(2);
    r.awaken();
    put(r, 2, 0, -5);
    r.cs.updateGuard(2, T0, true, true);
    r.step(T0, { press: [{ slot: 3 }] });
    r.run(T0 + 1, AS - 1, () => ({ guard: [2] }));
    r.run(AS, AS + 89, () => ({ guard: [2] }));
    expect(r.results.filter((x) => x.r.outcome === "blocked").length).toBeGreaterThan(0);
    expect(r.hp(2)).toBeGreaterThan(HP - 3500);
    expect(r.results.filter((x) => x.r.outcome === "blocked").every((x) => x.r.damage100 === 100)).toBe(true);
  });

  test("counter: the counterable pulse is intercepted (no damage that pulse)", () => {
    const r = makeRig(2);
    r.awaken();
    put(r, 2, 0, -5);
    r.cs.get(2)!.counterOpenUntil = AS + 1;
    r.step(T0, { press: [{ slot: 3 }] });
    r.run(T0 + 1, AS);
    expect(r.results.at(-1)!.r.outcome).toBe("countered");
    expect(r.hp(2)).toBe(HP);
    r.run(AS + 1, AS + 20);
    expect(r.hp(2)).toBe(HP - 500); // the second pulse (+15) is not countered by a spent stance
  });

  test("duplicate hit: after seven pulses a further pulse candidate deals nothing; the 35 HP cap is exact", () => {
    const r = makeRig(2);
    r.awaken();
    put(r, 2, 0, -5);
    r.step(T0, { press: [{ slot: 3 }] });
    r.run(T0 + 1, AS - 1);
    const last = r.step(AS).find((x) => x.outcome === "hit")!;
    r.run(AS + 1, AS + 89);
    expect(r.hp(2)).toBe(HP - 3500);
    r.step(AS + 89, { extra: [{ ...last.candidate, hitIndex: 3 }] });
    expect(r.results.at(-1)!.r.outcome).toBe("duplicate");
    expect(r.hp(2)).toBe(HP - 3500);
  });

  test("max 4 targets, nearest first, and a fifth never joins later", () => {
    const r = makeRig(7);
    r.awaken();
    for (let i = 2; i <= 7; i++) put(r, i, 0, -3 - i);
    r.cs.get(7)!.hp100 = HP;
    r.step(T0, { press: [{ slot: 3 }] });
    r.run(T0 + 1, AS + 100);
    expect([2, 3, 4, 5].every((i) => r.hp(i) === HP - 3500)).toBe(true);
    expect([6, 7].every((i) => r.hp(i) === HP)).toBe(true);
  });

  test("cover clips the beam: a target behind a wall is not hit", () => {
    const r = makeRig(3);
    r.awaken();
    put(r, 2, 0, -5);
    put(r, 3, 0, -12);
    r.setWallZ(-8);
    r.step(T0, { press: [{ slot: 3 }] });
    r.run(T0 + 1, AS + 100);
    expect(r.hp(2)).toBe(HP - 3500);
    expect(r.hp(3)).toBe(HP);
  });

  test("aim turns at most 30 degrees per second: yaw after 60 ticks of a 90 degree request is 30 degrees", () => {
    const r = makeRig(2);
    r.awaken();
    put(r, 2, 40, 40);
    (r.host as { requestedYaw?: (id: number) => number | undefined }).requestedYaw = () => Math.PI / 2;
    r.step(T0, { press: [{ slot: 3 }] });
    r.run(T0 + 1, T0 + 60);
    const yaw = r.runner.castOf(1)!.aimYaw;
    expect(yaw).toBeCloseTo((30 * Math.PI) / 180 * (60 - 0) / 60, 1);
  });

  test("interruption by armorBreak clears the pending pulses; the cooldown is spent", () => {
    const r = makeRig(2);
    r.awaken();
    put(r, 2, 0, -5);
    r.step(T0, { press: [{ slot: 3 }] });
    r.run(T0 + 1, AS + 20);
    expect(r.hp(2)).toBe(HP - 1000);
    r.step(AS + 21, { extra: [r.strike(2, 1, { armorBreak: true, counterable: false })] });
    expect(r.cs.get(1)!.action).toBe("Stunned");
    r.run(AS + 22, AS + 120);
    expect(r.hp(2)).toBe(HP - 1000);
    expect(r.runner.castOf(1)).toBeUndefined();
    expect(r.cs.get(1)!.cooldowns.get("ea.a3")).toBe(T0 + 1500);
  });

  test("interruption in startup (stun, no armor yet) cancels: no pulse", () => {
    const r = makeRig(2);
    r.awaken();
    put(r, 2, 0, -5);
    r.step(T0, { press: [{ slot: 3 }] });
    r.step(T0 + 10, { extra: [r.strike(2, 1)] });
    r.run(T0 + 11, AS + 100);
    expect(r.hp(2)).toBe(HP);
  });

  test("death of the caster mid beam stops the pulses; death of the target stops its pulses; lethal pulse clamps", () => {
    const r = makeRig(2);
    r.awaken();
    put(r, 2, 0, -5);
    r.step(T0, { press: [{ slot: 3 }] });
    r.run(T0 + 1, AS + 20);
    r.cs.kill(1, AS + 21);
    r.run(AS + 22, AS + 120);
    expect(r.hp(2)).toBe(HP - 1000);
    const v = makeRig(2);
    v.awaken();
    put(v, 2, 0, -5);
    v.cs.get(2)!.hp100 = 700;
    v.step(T0, { press: [{ slot: 3 }] });
    v.run(T0 + 1, AS + 100);
    expect(v.hp(2)).toBe(0);
    expect(v.dealt(1, 2).map((x) => x[1])).toEqual([500, 200]);
  });

  test("expiry: the form expiring mid beam does not cancel the committed cast; no new awakened cast starts", () => {
    const r = makeRig(2);
    r.awaken();
    put(r, 2, 0, -5);
    r.cs.get(1)!.formEndTick = AS + 20;
    r.step(T0, { press: [{ slot: 3 }] });
    r.run(T0 + 1, AS + 100);
    expect(r.cs.get(1)!.form).toBe("Base");
    expect(r.hp(2)).toBe(HP - 3500);
    r.cs.get(1)!.cooldowns.clear();
    r.run(AS + 101, AS + 140);
    expect(r.runner.skillDown(r.cs.get(1)!, AS + 141, 3, 4)).toMatchObject({ kind: "started", moveId: "ea.b3" });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("ea.a4 Solar Vent", () => {
  const AS = T0 + 72;
  const OFFS = [0, 20, 40, 60, 80, 100, 120, 140, 160, 179];

  test("hit: ten pulses, 7 HP within 10 m (70 total), stun 24, U, no armor, once per form", () => {
    const r = makeRig(2);
    r.awaken();
    put(r, 2, 0, -6);
    r.step(T0, { press: [{ slot: 4 }] });
    started(r, "ea.a4");
    expect(r.cs.get(1)!.awakenedUsedMask & 0b1000).toBe(0b1000);
    r.run(T0 + 1, AS - 1);
    expect(r.hp(2)).toBe(HP);
    r.step(AS);
    expect(r.hp(2)).toBe(HP - 700);
    expect(r.cs.get(2)!.action).toBe("Stunned");
    expect(r.cs.get(2)!.actionEndTick - r.cs.get(2)!.actionStartTick).toBe(24);
    expect(r.cs.get(1)!.armored).toBe(false);
    r.run(AS + 1, AS + 190);
    expect(r.dealt(1, 2)).toEqual(OFFS.map((o) => [AS + o, 700] as const));
    expect(r.hp(2)).toBe(HP - 7000);
    expect(def("ea.a4").launch).toEqual({ forward: 2, up: 0 });
    // once per form: a second press is rejected even after recovery
    r.run(AS + 191, AS + 260);
    expect(r.runner.skillDown(r.cs.get(1)!, AS + 261, 4, 8)).toEqual({ kind: "rejected", reason: "FORM" });
  });

  test("far pulses deal 3 HP (beyond 10 m); the cap is 70 per target", () => {
    const r = makeRig(3);
    r.awaken();
    put(r, 2, 0, -10.2);
    put(r, 3, 0, -9.9);
    r.step(T0, { press: [{ slot: 4 }] });
    r.run(T0 + 1, AS + 190);
    expect(r.hp(2)).toBe(HP - 3000);
    expect(r.hp(3)).toBe(HP - 7000);
  });

  test("a target that moves from far to near changes damage per pulse, never above the cap", () => {
    const r = makeRig(2);
    r.awaken();
    put(r, 2, 0, -20);
    r.step(T0, { press: [{ slot: 4 }] });
    r.run(T0 + 1, AS + 190, (t) => { if (t === AS + 70) put(r, 2, 0, -5); return undefined; });
    expect(r.dealt(1, 2).map((x) => x[1])).toEqual([300, 300, 300, 300, 700, 700, 700, 700, 700, 700]);
    expect(r.hp(2)).toBe(HP - 1200 - 4200);
  });

  test("miss spends the use: no pulse hits, the bit stays set and a second cast is rejected", () => {
    const r = makeRig(2);
    r.awaken();
    put(r, 2, 40, 40);
    r.step(T0, { press: [{ slot: 4 }] });
    r.run(T0 + 1, AS + 300);
    expect(r.hp(2)).toBe(HP);
    expect(r.cs.get(1)!.awakenedUsedMask & 0b1000).toBe(0b1000);
    expect(r.runner.skillDown(r.cs.get(1)!, AS + 301, 4, 3)).toEqual({ kind: "rejected", reason: "FORM" });
  });

  test("interruption spends the use too: a stun in startup cancels the cast and the bit stays set", () => {
    const r = makeRig(2);
    r.awaken();
    put(r, 2, 0, -6);
    r.step(T0, { press: [{ slot: 4 }] });
    r.step(T0 + 10, { extra: [r.strike(2, 1)] });
    r.run(T0 + 11, AS + 200);
    expect(r.hp(2)).toBe(HP);
    expect(r.cs.get(1)!.awakenedUsedMask & 0b1000).toBe(0b1000);
    expect(r.runner.castOf(1)).toBeUndefined();
  });

  test("interruption mid beam (no armor): the next pulse never fires", () => {
    const r = makeRig(2);
    r.awaken();
    put(r, 2, 0, -6);
    r.step(T0, { press: [{ slot: 4 }] });
    r.run(T0 + 1, AS + 30);
    expect(r.hp(2)).toBe(HP - 1400);
    r.step(AS + 31, { extra: [r.strike(2, 1)] });
    expect(r.cs.get(1)!.action).toBe("Stunned");
    r.run(AS + 32, AS + 190);
    expect(r.hp(2)).toBe(HP - 1400);
  });

  test("counter: the counterable pulse is intercepted by an open counter; U ignores a guard", () => {
    const r = makeRig(2);
    r.awaken();
    put(r, 2, 0, -6);
    r.cs.get(2)!.counterOpenUntil = AS + 1;
    r.step(T0, { press: [{ slot: 4 }] });
    r.run(T0 + 1, AS);
    expect(r.results.at(-1)!.r.outcome).toBe("countered");
    expect(r.hp(2)).toBe(HP);
    const g = makeRig(2);
    g.awaken();
    put(g, 2, 0, -6);
    g.step(T0, { press: [{ slot: 4 }] });
    g.run(T0 + 1, AS - 1);
    g.step(AS, { guard: [2] });
    expect(g.hp(2)).toBe(HP - 700);
    expect(g.results.at(-1)!.r.outcome).toBe("hit");
  });

  test("duplicate hit: a repeated pulse index deals nothing", () => {
    const r = makeRig(2);
    r.awaken();
    put(r, 2, 0, -6);
    r.step(T0, { press: [{ slot: 4 }] });
    r.run(T0 + 1, AS - 1);
    const first = r.step(AS).find((x) => x.outcome === "hit")!;
    r.step(AS + 1, { extra: [{ ...first.candidate, maxHitsPerTarget: 1 }] });
    expect(r.results.at(-1)!.r.outcome).toBe("duplicate");
    expect(r.hp(2)).toBe(HP - 700);
  });

  test("cover truncates the beam: a target behind a wall takes nothing", () => {
    const r = makeRig(3);
    r.awaken();
    put(r, 2, 0, -6);
    put(r, 3, 0, -20);
    r.setWallZ(-10);
    r.step(T0, { press: [{ slot: 4 }] });
    r.run(T0 + 1, AS + 190);
    expect(r.hp(2)).toBe(HP - 7000);
    expect(r.hp(3)).toBe(HP);
  });

  test("turnRate 15 degrees per second; vertical velocity held; movement zero", () => {
    const r = makeRig(2);
    r.awaken();
    put(r, 2, 40, 40);
    (r.host as { requestedYaw?: (id: number) => number | undefined }).requestedYaw = () => Math.PI;
    r.step(T0, { press: [{ slot: 4 }] });
    r.run(T0 + 1, T0 + 120);
    expect(r.runner.castOf(1)!.aimYaw).toBeCloseTo((15 * Math.PI) / 180 * 2, 1);
    expect(r.runner.moveScaleOf(1)).toBe(0);
    expect(r.runner.freezesVertical(1, T0 + 120)).toBe(true);
  });

  test("death of the caster stops the pulses; a lethal pulse clamps with one KO", () => {
    const r = makeRig(2);
    r.awaken();
    put(r, 2, 0, -6);
    r.step(T0, { press: [{ slot: 4 }] });
    r.run(T0 + 1, AS + 50);
    r.cs.kill(1, AS + 51);
    r.run(AS + 52, AS + 190);
    expect(r.hp(2)).toBe(HP - 2100);
    const v = makeRig(2);
    v.awaken();
    put(v, 2, 0, -6);
    v.cs.get(2)!.hp100 = 900;
    v.step(T0, { press: [{ slot: 4 }] });
    v.run(T0 + 1, AS + 190);
    expect(v.hp(2)).toBe(0);
    expect(v.dealt(1, 2).map((x) => x[1])).toEqual([700, 200]);
  });

  test("expiry: the form expiring mid beam does not cancel the cast; afterwards slot 4 is the Base move", () => {
    const r = makeRig(2);
    r.awaken();
    put(r, 2, 0, -6);
    r.cs.get(1)!.formEndTick = AS + 30;
    r.step(T0, { press: [{ slot: 4 }] });
    r.run(T0 + 1, AS + 190);
    expect(r.cs.get(1)!.form).toBe("Base");
    expect(r.hp(2)).toBe(HP - 7000);
    r.cs.get(1)!.cooldowns.clear();
    r.run(AS + 191, AS + 260);
    expect(r.runner.skillDown(r.cs.get(1)!, AS + 261, 4, 6)).toMatchObject({ kind: "started", moveId: "ea.b4" });
  });

  test("a new awakening resets the used bit (once per form)", () => {
    const r = makeRig(2);
    r.awaken();
    r.cs.get(1)!.awakenedUsedMask = 0b1000;
    const f = r.cs.get(1)!;
    f.form = "Base";
    f.meter100 = 35000;
    r.aw.request(f, T0);
    r.run(T0, T0 + 90);
    expect(f.awakenedUsedMask).toBe(0);
    expect(f.form).toBe("Awakened");
  });
});

describe("cleanup", () => {
  test("cancel is idempotent and leaves no cast, capture, armor or pending blast", () => {
    const r = makeRig(2);
    r.awaken();
    r.step(T0, { press: [{ slot: 1 }] });
    r.run(T0 + 1, T0 + 40);
    r.runner.cancel(1);
    r.runner.cancel(1);
    r.runner.dispose();
    r.aw.dispose();
    expect(r.runner.activeCount).toBe(0);
    expect(r.cs.get(1)!.armored).toBe(false);
  });
});
