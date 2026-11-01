import { describe, expect, test } from "vitest";
import { SV_DEFS } from "../../packages/shared/src/config/kits/sv.js";
import { ALL_HANDLERS, buildKitRegistry } from "../../apps/server/src/kits/index.js";
import { lethalCounterRemaining } from "../../apps/server/src/kits/sv/lethalCounter.js";
import { COMBAT } from "../../packages/shared/src/config/combat.js";
import { CAPTOR_RELEASE_RECOVERY } from "../../apps/server/src/sim/ActionMachine.js";
import { CombatSystem } from "../../apps/server/src/sim/Combat.js";
import { AbilityRunner, type AbilityHost, type AbilityPose, type SkillOutcome } from "../../apps/server/src/sim/AbilityRunner.js";
import { AwakeningSystem } from "../../apps/server/src/sim/Awakening.js";
import type { HitCandidate, HitResult } from "../../apps/server/src/sim/HitResolver.js";
import type { Release } from "../../apps/server/src/sim/CaptureRegistry.js";

/**
 * Stone Vanguard awakened moves (T15): sv.a1 Stillpoint Reversal, sv.a2 Skybreak, sv.a3 Horizon Break,
 * sv.a4 Orbit Collapse. Driven tick by tick in the room's order (expiry, buffered intent, input, collision query,
 * serial resolution, handler results) against a fake host, so every boundary is an exact integer tick.
 */
const T0 = 1000;
const HP = COMBAT.hp100Max;

const reg = buildKitRegistry();
const def = (id: string) => reg.byId(id)!;

function makeRig(n = 3) {
  const cs = new CombatSystem();
  const poses = new Map<number, AbilityPose>();
  for (let i = 1; i <= n; i++) cs.add(i, i, 0).protectedUntilTick = 0;
  // 1: Stone Vanguard at the origin facing -Z. 2: target 1.5 m ahead. 3: second target 3 m ahead and slightly right.
  // 4: far bystander. Other poses are set per test.
  poses.set(1, { x: 0, y: 1, z: 0, facingYaw: 0, grounded: true });
  poses.set(2, { x: 0, y: 1, z: -1.5, facingYaw: Math.PI, grounded: true });
  if (n >= 3) poses.set(3, { x: 0.3, y: 1, z: -3, facingYaw: Math.PI, grounded: true });
  for (let i = 4; i <= n; i++) poses.set(i, { x: 5 + i, y: 1, z: -2, facingYaw: Math.PI, grounded: true });
  let wallZ: number | null = null; // a wall plane at z = wallZ blocks any segment that crosses it
  let occluded = false;
  const launches: { id: number; vx: number; vy: number; vz: number; tick: number }[] = [];
  const releases: { rel: Release; tick: number }[] = [];
  cs.onRelease = (rel, tick) => { releases.push({ rel, tick }); };
  let curTick = T0;
  const host: AbilityHost = {
    combat: cs, pose: (id) => poses.get(id),
    blocked: (a, b) => occluded || (wallZ !== null && (a[2] - wallZ) * (b[2] - wallZ) < 0),
    launch: (id, vx, vy, vz) => { launches.push({ id, vx, vy, vz, tick: curTick }); },
  };
  const runner = new AbilityRunner(reg, ALL_HANDLERS, host);
  for (let i = 1; i <= n; i++) runner.setKit(i, i === 1 ? "sv" : "td");
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
  const of = (outcome: HitResult["outcome"], t?: number) => results.filter((x) => x.r.outcome === outcome && (t === undefined || x.tick === t));
  return {
    cs, poses, runner, host, results, outcomes, launches, releases, strike, step, run, hp, dealt, awaken, of,
    setWallZ: (z: number | null) => { wallZ = z; }, setOccluded: (v: boolean) => { occluded = v; },
  };
}

describe("sv awakened definitions match the spec 15 table", () => {
  test("slotted awakened moves carry the exact table numbers", () => {
    const ids = SV_DEFS.filter((d) => d.form === "Awakened").map((d) => d.id);
    expect(ids).toEqual(["sv.a1", "sv.a2"]);
    const a1 = def("sv.a1");
    expect([a1.slot, a1.form, a1.startup, a1.active, a1.recovery, a1.block, a1.counterable, a1.oncePerForm, a1.consumesForm])
      .toEqual([1, "Awakened", 0, 600, 18, "U", false, true, true]);
    expect(a1.hitOffsets).toEqual([60]);
    expect(a1.damage100).toEqual([10000]);
    expect(Number.isFinite(a1.damage100[0]!)).toBe(true); // lethal cap is 100 HP, never Infinity
  });
});

describe("sv.a1 Stillpoint Reversal (lethalCounter)", () => {
  test("commit spends the form at once, frees the caster and opens a private 600 tick status that is not an action", () => {
    const r = makeRig(2);
    r.awaken();
    r.step(T0, { press: [{ slot: 1 }] });
    expect(r.outcomes[0]!.o).toMatchObject({ kind: "started", moveId: "sv.a1" });
    const f = r.cs.get(1)!;
    expect(f.form).toBe("Base");
    expect(f.awakenedUsedMask & 1).toBe(1);
    expect(f.action).toBe("Idle");
    expect(f.cast).toBeNull();
    expect(r.runner.castOf(1)).toBeUndefined();
    expect(f.lethalCounterUntil).toBe(T0 + 600);
    expect(lethalCounterRemaining(r.runner, 1, T0)).toBe(600);
    expect(lethalCounterRemaining(r.runner, 2, T0)).toBe(0); // private to the owner
    expect(r.hp(1)).toBe(HP);
  });

  test("a second press after the form is spent uses the base move, and base actions never end the status", () => {
    const r = makeRig(2);
    r.awaken();
    r.step(T0, { press: [{ slot: 1 }] });
    r.step(T0 + 5, { press: [{ slot: 1 }] });
    expect(r.outcomes[1]!.o).toMatchObject({ kind: "started", moveId: "sv.b1" });
    expect(r.cs.get(1)!.action).toBe("Windup");
    expect(r.cs.get(1)!.lethalCounterUntil).toBe(T0 + 600);
    r.run(T0 + 6, T0 + 80);
    expect(r.cs.get(1)!.lethalCounterUntil).toBe(T0 + 600);
    expect(lethalCounterRemaining(r.runner, 1, T0 + 80)).toBe(520);
    // Fault Strike really hit: base actions work during the status.
    expect(r.dealt(1, 2).length).toBeGreaterThan(0);
  });

  test("trigger: the hit is consumed, the attacker is captured cinematically, damage lands at trigger+60, release at +72, heal to 100", () => {
    const r = makeRig(3);
    r.awaken();
    r.cs.get(1)!.hp100 = 4000;
    r.step(T0, { press: [{ slot: 1 }] });
    r.run(T0 + 1, T0 + 9);
    const trig = T0 + 10;
    const res = r.step(trig, { extra: [r.strike(2, 1)] });
    expect(res.map((x) => x.outcome)).toEqual(["countered"]);
    expect(r.hp(1)).toBe(4000); // the countered hit dealt nothing
    const a = r.cs.get(1)!, v = r.cs.get(2)!;
    expect(v.action).toBe("Captured");
    expect(a.action).toBe("Active");
    expect(a.moveId).toBe("sv.a1");
    expect(a.lethalCounterUntil).toBe(0);
    expect(lethalCounterRemaining(r.runner, 1, trig)).toBe(0);
    expect(r.cs.captures.captureOn(2)).toMatchObject({ captorId: 1, cinematic: true, moveId: "sv.a1" });
    // Cinematic capture shields both participants from a third party (3 -> 1 and 3 -> 2).
    r.step(trig + 1, { extra: [r.strike(3, 1, { counterable: false }), r.strike(3, 2, { counterable: false })] });
    expect(r.of("shielded").length).toBe(2);
    r.run(trig + 2, trig + 59);
    expect(r.hp(2)).toBe(HP);
    expect(r.hp(1)).toBe(4000);
    r.step(trig + 60);
    expect(r.dealt(1, 2)).toEqual([[trig + 60, HP]]); // 100 HP, lethal
    const hit = r.results.find((x) => x.tick === trig + 60 && x.r.candidate.moveId === "sv.a1")!.r;
    expect(hit.candidate.counterable).toBe(false);
    expect(hit.candidate.block).toBe("U");
    expect(hit.killed).toBe(true);
    expect(r.hp(1)).toBe(HP); // healed to 100 HP on successful damage
    expect(r.cs.get(2)!.action).toBe("Dead");
    expect(r.cs.captures.size).toBe(0);
  });

  test("a victim that dies at +60 gives the captor exactly 18 ticks of recovery from that tick", () => {
    const r = makeRig(2);
    r.awaken();
    r.step(T0, { press: [{ slot: 1 }] });
    r.step(T0 + 2, { extra: [r.strike(2, 1)] });
    const kill = T0 + 2 + 60;
    r.run(T0 + 3, kill);
    expect(r.cs.get(1)!.action).toBe("Recovery");
    expect(r.cs.get(1)!.actionEndTick).toBe(kill + CAPTOR_RELEASE_RECOVERY);
    r.run(kill + 1, kill + CAPTOR_RELEASE_RECOVERY);
    expect(r.cs.get(1)!.action).toBe("Idle");
    expect(r.runner.castOf(1)).toBeUndefined();
    expect(r.cs.captures.size).toBe(0);
  });

  test("when the damage cannot land the victim is still released at +72 and the 18 tick recovery follows; no heal", () => {
    const r = makeRig(2);
    r.awaken();
    r.cs.get(1)!.hp100 = 4000;
    r.step(T0, { press: [{ slot: 1 }] });
    const trig = T0 + 3;
    r.step(trig, { extra: [r.strike(2, 1)] });
    r.run(trig + 1, trig + 59);
    r.cs.get(2)!.protectedUntilTick = trig + 1000; // fixture: damage is refused at +60
    r.step(trig + 60);
    expect(r.of("protected", trig + 60).length).toBe(1);
    expect(r.hp(2)).toBe(HP);
    expect(r.hp(1)).toBe(4000); // no damage, no heal
    r.run(trig + 61, trig + 71);
    expect(r.cs.get(2)!.action).toBe("Captured");
    r.step(trig + 72);
    expect(r.cs.get(2)!.action).toBe("Idle");
    expect(r.releases.map((x) => [x.rel.cause, x.tick])).toEqual([["final", trig + 72]]);
    expect(r.cs.get(1)!.action).toBe("Recovery");
    r.run(trig + 73, trig + 89);
    expect(r.cs.get(1)!.action).toBe("Recovery");
    r.step(trig + 90);
    expect(r.cs.get(1)!.action).toBe("Idle"); // 72 + 18
  });

  test("the status ends at tick 600 exclusive: a counterable hit at +599 triggers, at +600 it damages normally", () => {
    const early = makeRig(2);
    early.awaken();
    early.step(T0, { press: [{ slot: 1 }] });
    early.run(T0 + 1, T0 + 598);
    early.step(T0 + 599, { extra: [early.strike(2, 1)] });
    expect(early.of("countered", T0 + 599).length).toBe(1);
    expect(early.cs.get(2)!.action).toBe("Captured");

    const late = makeRig(2);
    late.awaken();
    late.step(T0, { press: [{ slot: 1 }] });
    late.run(T0 + 1, T0 + 599);
    late.step(T0 + 600, { extra: [late.strike(2, 1)] });
    expect(late.of("countered").length).toBe(0);
    expect(late.hp(1)).toBe(HP - 300);
    expect(late.cs.get(1)!.lethalCounterUntil).toBe(0);
    expect(lethalCounterRemaining(late.runner, 1, T0 + 600)).toBe(0);
    expect(late.cs.get(1)!.action).toBe("Stunned");
    expect(late.cs.captures.size).toBe(0);
    expect(late.hp(2)).toBe(HP); // no trigger: no damage, no heal
  });

  test("reach: an attacker at exactly 40 m triggers, one just beyond is absorbed and ends the status (no damage, no recovery)", () => {
    const edge = makeRig(2);
    edge.awaken();
    edge.poses.set(2, { x: 0, y: 1, z: -40, facingYaw: 0, grounded: true });
    edge.step(T0, { press: [{ slot: 1 }] });
    edge.step(T0 + 1, { extra: [edge.strike(2, 1)] });
    expect(edge.cs.get(2)!.action).toBe("Captured");

    const far = makeRig(2);
    far.awaken();
    far.cs.get(1)!.hp100 = 5000;
    far.poses.set(2, { x: 0, y: 1, z: -40.01, facingYaw: 0, grounded: true });
    far.step(T0, { press: [{ slot: 1 }] });
    far.step(T0 + 1, { extra: [far.strike(2, 1)] });
    expect(far.of("countered").length).toBe(1);
    expect(far.cs.get(2)!.action).toBe("Idle");
    expect(far.cs.get(1)!.action).toBe("Idle"); // absorbed: no stun, no recovery
    expect(far.hp(1)).toBe(5000);
    expect(far.cs.get(1)!.lethalCounterUntil).toBe(0);
    expect(far.cs.captures.size).toBe(0);
    far.run(T0 + 2, T0 + 200);
    expect(far.hp(2)).toBe(HP); // nothing ever answers
    // The status is gone: the next counterable hit damages normally.
    far.step(T0 + 201, { extra: [far.strike(2, 1)] });
    expect(far.hp(1)).toBe(4700);
  });

  test("a solid wall between the pair absorbs the hit instead of capturing", () => {
    const r = makeRig(2);
    r.awaken();
    r.step(T0, { press: [{ slot: 1 }] });
    r.setOccluded(true);
    r.step(T0 + 1, { extra: [r.strike(2, 1)] });
    expect(r.of("countered").length).toBe(1);
    expect(r.cs.get(2)!.action).toBe("Idle");
    expect(r.cs.captures.size).toBe(0);
    expect(r.cs.get(1)!.lethalCounterUntil).toBe(0);
    r.run(T0 + 2, T0 + 100);
    expect(r.hp(2)).toBe(HP);
  });

  test("a noncounterable hit damages normally (and cancels nothing); the status stays open", () => {
    const r = makeRig(2);
    r.awaken();
    r.step(T0, { press: [{ slot: 1 }] });
    r.step(T0 + 1, { extra: [r.strike(2, 1, { counterable: false, reaction: { kind: "none" } })] });
    expect(r.hp(1)).toBe(HP - 300);
    expect(r.of("countered").length).toBe(0);
    expect(r.cs.get(1)!.lethalCounterUntil).toBe(T0 + 600);
    expect(lethalCounterRemaining(r.runner, 1, T0 + 1)).toBe(599);
  });

  test("a noncounterable lethal hit kills the caster and the status dies with it (no leak, no response)", () => {
    const r = makeRig(2);
    r.awaken();
    r.cs.get(1)!.hp100 = 200;
    r.step(T0, { press: [{ slot: 1 }] });
    r.step(T0 + 1, { extra: [r.strike(2, 1, { counterable: false })] });
    expect(r.cs.get(1)!.action).toBe("Dead");
    expect(r.cs.get(1)!.lethalCounterUntil).toBe(0);
    r.step(T0 + 2);
    expect(lethalCounterRemaining(r.runner, 1, T0 + 2)).toBe(0);
    r.run(T0 + 3, T0 + 100);
    expect(r.hp(2)).toBe(HP);
    expect(r.cs.captures.size).toBe(0);
    // Respawn does not resurrect it.
    r.cs.respawn(1, T0 + 101, 9);
    r.runner.reset(1);
    r.step(T0 + 102, { extra: [r.strike(2, 1)] });
    expect(r.of("countered").length).toBe(0);
  });

  test("respawn and kit change drop the status", () => {
    const a = makeRig(2);
    a.awaken();
    a.step(T0, { press: [{ slot: 1 }] });
    a.cs.kill(1, T0 + 1);
    a.cs.respawn(1, T0 + 2, 7);
    expect(a.cs.get(1)!.lethalCounterUntil).toBe(0);
    a.run(T0 + 3, T0 + 4);
    expect(lethalCounterRemaining(a.runner, 1, T0 + 4)).toBe(0);

    const b = makeRig(2);
    b.awaken();
    b.step(T0, { press: [{ slot: 1 }] });
    b.runner.setKit(1, "td"); // kit change consumes the awakening and everything attached to it
    b.step(T0 + 1, { extra: [b.strike(2, 1)] });
    expect(b.of("countered").length).toBe(0);
    expect(b.hp(1)).toBe(HP - 300);
    expect(b.cs.get(1)!.lethalCounterUntil).toBe(0);
  });

  test("duplicate hit: the same counterable hit twice in one tick triggers once", () => {
    const r = makeRig(2);
    r.awaken();
    r.step(T0, { press: [{ slot: 1 }] });
    const s = r.strike(2, 1);
    const res = r.step(T0 + 1, { extra: [s, { ...s }] });
    expect(res.map((x) => x.outcome)).toEqual(["countered", "duplicate"]);
    expect(r.hp(1)).toBe(HP);
    expect(r.cs.captures.size).toBe(1);
  });

  test("a base cast in progress is cancelled by the trigger; both actions are replaced", () => {
    const r = makeRig(3);
    r.awaken();
    r.step(T0, { press: [{ slot: 1 }] });
    r.step(T0 + 2, { press: [{ slot: 2 }] }); // sv.b2 Gravel Flurry, in startup
    expect(r.runner.castOf(1)?.def.id).toBe("sv.b2");
    // The attacker is mid-cast too (td.b1 style probe stand-in: a real melee cast of entity 2).
    r.cs.get(2)!.hp100 = HP;
    r.step(T0 + 4, { extra: [r.strike(2, 1)] });
    expect(r.cs.get(1)!.moveId).toBe("sv.a1");
    expect(r.runner.castOf(1)?.def.id).toBe("sv.a1");
    r.run(T0 + 5, T0 + 100);
    expect(r.dealt(1, 2).length).toBe(1); // only the response hit; the cancelled flurry never dealt damage
  });

  test("death of the caster mid-response: no orphan capture, no damage, the victim leaves Captured", () => {
    const r = makeRig(2);
    r.awaken();
    r.step(T0, { press: [{ slot: 1 }] });
    r.step(T0 + 1, { extra: [r.strike(2, 1)] });
    r.run(T0 + 2, T0 + 30);
    r.cs.kill(1, T0 + 31); // fixture: void rule kill
    expect(r.cs.captures.size).toBe(0);
    expect(r.cs.get(2)!.action).toBe("Idle");
    r.run(T0 + 32, T0 + 120);
    expect(r.hp(2)).toBe(HP);
    expect(r.runner.castOf(1)).toBeUndefined();
  });

  test("death of the victim mid-response (void kill, not damage): captor recovery 18 and no damage afterwards", () => {
    const r = makeRig(2);
    r.awaken();
    r.cs.get(1)!.hp100 = 4000;
    r.step(T0, { press: [{ slot: 1 }] });
    r.step(T0 + 1, { extra: [r.strike(2, 1)] });
    r.run(T0 + 2, T0 + 20);
    r.cs.kill(2, T0 + 21);
    expect(r.cs.captures.size).toBe(0);
    expect(r.cs.get(1)!.action).toBe("Recovery");
    expect(r.cs.get(1)!.actionEndTick).toBe(T0 + 21 + CAPTOR_RELEASE_RECOVERY);
    r.run(T0 + 22, T0 + 120);
    expect(r.cs.get(1)!.action).toBe("Idle");
    expect(r.hp(1)).toBe(4000); // no hit landed, so no heal
  });

  test("interruption: the 18 tick recovery after the release is vulnerable and a stun cancels it", () => {
    const r = makeRig(3);
    r.awaken();
    r.step(T0, { press: [{ slot: 1 }] });
    const trig = T0 + 1;
    r.step(trig, { extra: [r.strike(2, 1)] });
    r.run(trig + 1, trig + 59);
    r.cs.get(2)!.protectedUntilTick = trig + 1000;
    r.run(trig + 60, trig + 72);
    expect(r.cs.get(1)!.action).toBe("Recovery");
    r.step(trig + 75, { extra: [r.strike(3, 1, { counterable: false })] });
    expect(r.cs.get(1)!.action).toBe("Stunned");
    expect(r.hp(1)).toBe(HP - 300);
    r.step(trig + 76); // the runner retires the stale cast on the next query
    expect(r.runner.castOf(1)).toBeUndefined();
  });

  test("the response is a hit the victim can never answer: a counter stance on the victim does not intercept it", () => {
    const r = makeRig(2);
    r.awaken();
    r.step(T0, { press: [{ slot: 1 }] });
    r.step(T0 + 1, { extra: [r.strike(2, 1)] });
    r.run(T0 + 2, T0 + 20);
    r.cs.get(2)!.counterOpenUntil = T0 + 500; // fixture: an open counter stance on the victim
    r.run(T0 + 21, T0 + 61);
    expect(r.dealt(1, 2)).toEqual([[T0 + 61, HP]]);
    expect(r.of("countered", T0 + 61).length).toBe(0);
  });
});

describe("awakened damage never feeds the next meter (D)", () => {
  test("a resolved sv.a2 or sv.a1 hit adds no meter although the form is already Base", () => {
    const cs = new CombatSystem();
    cs.add(1, 1, 0); cs.add(2, 2, 0);
    const host = { combat: cs, pose: () => ({ x: 0, y: 1, z: 0, facingYaw: 0, grounded: true }) };
    const aw = new AwakeningSystem(host);
    aw.setKit(1, "sv");
    const cand = (moveId: string): HitResult => ({
      candidate: { attackerId: 1, attackerGeneration: 0, castCounter: 1, hitIndex: 0, toi: 0, targetId: 2, moveId, originX: 0, originZ: 0,
        block: "U", counterable: false, armorBreak: true, damage100: 1000, reaction: { kind: "none" }, maxHitsPerTarget: 1 },
      outcome: "hit", damage100: 1000, killed: false,
    });
    aw.gain([cand("sv.a1"), cand("sv.a2")]);
    expect(cs.get(1)!.meter100).toBe(0);
    aw.gain([cand("sv.b2")]);
    expect(cs.get(1)!.meter100).toBe(1000);
  });
});

/** Places target `id` `fwd` m in front of entity 1 and `side` m to its right. */
const put = (r: ReturnType<typeof makeRig>, id: number, fwd: number, side = 0, y = 1): void => {
  r.poses.set(id, { x: side, y, z: -fwd, facingYaw: Math.PI, grounded: true });
};

describe("sv.a2 Skybreak (groundWave)", () => {
  test("definition: 90/6/45, box 20 x 8 x 24, max 4, 100 HP, U, armorBreak, noncounterable, R120 F4 U20, one use", () => {
    const d = def("sv.a2");
    expect([d.slot, d.form, d.startup, d.active, d.recovery, d.block, d.counterable, d.armorBreak, d.maxTargets, d.maxHitsPerTarget])
      .toEqual([2, "Awakened", 90, 6, 45, "U", false, true, 4, 1]);
    expect(d.shape).toEqual({ kind: "box", w: 20, h: 8, d: 24 });
    expect(d.damage100).toEqual([10000]);
    expect([d.ragdollTicks, d.launch]).toEqual([120, { forward: 4, up: 20 }]);
    expect([d.oncePerForm, d.consumesForm]).toEqual([true, true]);
  });

  test("hit lands at activeStart exactly: 100 HP, R120, launch F4 U20, caster heals 60 once and the form is spent at commit", () => {
    const r = makeRig(3);
    r.awaken();
    r.cs.get(1)!.hp100 = 3000;
    r.step(T0, { press: [{ slot: 2 }] });
    expect(r.outcomes[0]!.o).toMatchObject({ kind: "started", moveId: "sv.a2" });
    expect(r.cs.get(1)!.form).toBe("Base"); // spent at commit
    expect(r.cs.get(1)!.action).toBe("Windup");
    r.run(T0 + 1, T0 + 89);
    expect(r.dealt(1, 2)).toEqual([]);
    expect(r.hp(1)).toBe(3000);
    r.cs.get(2)!.hp100 = 7000; // 100 HP is lethal for everyone: the dealt damage is clamped to the remaining HP
    const res = r.step(T0 + 90);
    expect(res.filter((x) => x.outcome === "hit").length).toBe(2);
    expect(r.dealt(1, 2)).toEqual([[T0 + 90, 7000]]); // clamped to the remaining HP
    expect(r.dealt(1, 3)).toEqual([[T0 + 90, HP]]);
    expect(r.hp(1)).toBe(3000 + 6000); // heal 60 once, not per target
    r.run(T0 + 91, T0 + 140);
    expect(r.hp(1)).toBe(9000);
  });

  test("the hit carries R120 and launch F4 U20 (a full bar dies to the 100 HP cap)", () => {
    const r = makeRig(2);
    r.awaken();
    r.step(T0, { press: [{ slot: 2 }] });
    r.run(T0 + 1, T0 + 89);
    // 100 HP is lethal for every victim, so no survivor exists: the reaction is checked on the candidate and definition.
    const res = r.step(T0 + 90);
    const cand = res[0]!.candidate;
    expect(cand.reaction).toEqual({ kind: "ragdoll", ticks: 120 });
    expect(r.runner.registry.byId("sv.a2")!.launch).toEqual({ forward: 4, up: 20 });
    expect(res[0]!.killed).toBe(true);
    expect(r.hp(2)).toBe(0);
  });

  test("invulnerable from commit through the last active tick; the first recovery tick is vulnerable", () => {
    const r = makeRig(3);
    r.awaken();
    r.cs.get(2)!.hp100 = HP;
    put(r, 2, 40); // out of the volume so nothing but the test strikes matter
    put(r, 3, 40, 3);
    r.step(T0, { press: [{ slot: 2 }], extra: [r.strike(3, 1, { counterable: false })] });
    expect(r.of("invulnerable", T0).length).toBe(1);
    for (const t of [T0 + 1, T0 + 50, T0 + 89, T0 + 90, T0 + 95]) {
      r.step(t, { extra: [r.strike(3, 1, { counterable: false, armorBreak: true })] });
      expect(r.of("invulnerable", t).length).toBe(1);
    }
    expect(r.hp(1)).toBe(HP);
    expect(r.cs.get(1)!.action).not.toBe("Stunned");
    expect(r.cs.get(1)!.invulnerableUntil).toBe(T0 + 96);
    r.step(T0 + 96, { extra: [r.strike(3, 1, { counterable: false, armorBreak: true })] });
    expect(r.of("hit", T0 + 96).length).toBe(1);
    expect(r.hp(1)).toBe(HP - 300);
    expect(r.cs.get(1)!.action).toBe("Stunned"); // recovery is vulnerable and interruptible
  });

  test("cannot be interrupted or captured while invulnerable", () => {
    const r = makeRig(3);
    r.awaken();
    r.step(T0, { press: [{ slot: 2 }] });
    const capture = r.strike(2, 1, { capture: { cinematic: false, maxTicks: 50 }, counterable: false });
    r.step(T0 + 20, { extra: [capture] });
    expect(r.of("invulnerable", T0 + 20).length).toBe(1);
    expect(r.cs.get(1)!.action).toBe("Windup");
    expect(r.cs.captures.size).toBe(0);
  });

  test("grounded only: an airborne press is rejected with STATE and the form is kept", () => {
    const r = makeRig(2);
    r.awaken();
    r.poses.get(1)!.grounded = false;
    r.step(T0, { press: [{ slot: 2 }] });
    expect(r.outcomes[0]!.o).toEqual({ kind: "rejected", reason: "STATE" });
    expect(r.cs.get(1)!.form).toBe("Awakened");
    expect(r.cs.get(1)!.awakenedUsedMask).toBe(0);
  });

  test("miss: nothing is hit, no heal, the form is still spent, recovery 45 ends the cast", () => {
    const r = makeRig(2);
    r.awaken();
    r.cs.get(1)!.hp100 = 5000;
    put(r, 2, 24.6); // beyond 24 m + capsule radius
    r.step(T0, { press: [{ slot: 2 }] });
    r.run(T0 + 1, T0 + 90 + 6 + 44);
    expect(r.results.filter((x) => x.r.candidate.moveId === "sv.a2").length).toBe(0);
    expect(r.hp(1)).toBe(5000);
    expect(r.cs.get(1)!.form).toBe("Base");
    expect(r.cs.get(1)!.action).toBe("Recovery");
    r.step(T0 + 90 + 6 + 45);
    expect(r.cs.get(1)!.action).toBe("Idle");
    // The next awakened press resolves to the base move: one use only.
    r.cs.get(1)!.form = "Base";
    r.step(T0 + 150, { press: [{ slot: 2 }] });
    expect(r.outcomes[r.outcomes.length - 1]!.o).toMatchObject({ kind: "started", moveId: "sv.b2" });
  });

  test("volume bounds: 24 m deep, 10 m to each side, 4 m up and down, nothing behind the caster", () => {
    const hit = (fwd: number, side: number, y = 1): boolean => {
      const r = makeRig(2);
      r.awaken();
      put(r, 2, fwd, side, y);
      r.step(T0, { press: [{ slot: 2 }] });
      r.run(T0 + 1, T0 + 90);
      return r.dealt(1, 2).length === 1;
    };
    expect(hit(24, 0)).toBe(true);
    expect(hit(24.5, 0)).toBe(false);
    expect(hit(5, 10)).toBe(true);
    expect(hit(5, -10)).toBe(true);
    expect(hit(5, 10.5)).toBe(false);
    expect(hit(5, 0, 1 + 4.2)).toBe(true); // capsule overlaps the 8 m high box
    expect(hit(5, 0, 1 + 5.5)).toBe(false);
    expect(hit(-3, 0)).toBe(false);
  });

  test("max 4 targets, nearest first, tie by lowest entity id; the fifth is untouched", () => {
    const r = makeRig(6);
    r.awaken();
    put(r, 2, 10); put(r, 3, 4); put(r, 4, 8); put(r, 5, 4, 1); put(r, 6, 20);
    r.step(T0, { press: [{ slot: 2 }] });
    r.run(T0 + 1, T0 + 90);
    const hit = r.results.filter((x) => x.r.outcome === "hit").map((x) => x.r.candidate.targetId).sort((a, b) => a - b);
    expect(hit).toEqual([2, 3, 4, 5]); // 6 is the farthest
    expect(r.hp(6)).toBe(HP);
    // Tie: equal distance, the lower id wins the last slot.
    const t = makeRig(6);
    t.awaken();
    put(t, 2, 5); put(t, 3, 6); put(t, 4, 7); put(t, 6, 8, 0); put(t, 5, 8, 0);
    t.poses.get(5)!.x = 0.0; t.poses.get(6)!.x = 0.0;
    t.step(T0, { press: [{ slot: 2 }] });
    t.run(T0 + 1, T0 + 90);
    expect(t.dealt(1, 5).length).toBe(1);
    expect(t.dealt(1, 6).length).toBe(0);
  });

  test("a victim behind a solid wall is untouched, one in front of it is hit", () => {
    const r = makeRig(3);
    r.awaken();
    put(r, 2, 6); put(r, 3, 12);
    r.setWallZ(-9);
    r.step(T0, { press: [{ slot: 2 }] });
    r.run(T0 + 1, T0 + 90);
    expect(r.dealt(1, 2).length).toBe(1);
    expect(r.dealt(1, 3).length).toBe(0);
    expect(r.hp(3)).toBe(HP);
  });

  test("block and counter are irrelevant: a guarding victim and an open counter stance both take the full hit", () => {
    const r = makeRig(3);
    r.awaken();
    put(r, 2, 3); put(r, 3, 6);
    r.cs.get(3)!.counterOpenUntil = T0 + 500;
    r.step(T0, { press: [{ slot: 2 }], guard: [2] });
    r.run(T0 + 1, T0 + 89, () => ({ guard: [2] }));
    expect(r.cs.get(2)!.action).toBe("Guard");
    r.step(T0 + 90, { guard: [2] });
    expect(r.of("blocked").length).toBe(0);
    expect(r.of("countered").length).toBe(0);
    expect(r.dealt(1, 2)).toEqual([[T0 + 90, HP]]);
    expect(r.dealt(1, 3)).toEqual([[T0 + 90, HP]]);
  });

  test("duplicate hit: a second copy of the same hit cannot damage or heal again (the 100 HP cap leaves no survivor, so it meets a dead target)", () => {
    const r = makeRig(2);
    r.awaken();
    r.cs.get(1)!.hp100 = 2000;
    r.step(T0, { press: [{ slot: 2 }] });
    r.run(T0 + 1, T0 + 89);
    const cands = r.runner.collect(T0 + 90);
    const res = r.cs.resolve(T0 + 90, [...cands, { ...cands[0]! }], (id) => { const q = r.poses.get(id); return q && { x: q.x, z: q.z, facingYaw: q.facingYaw, grounded: q.grounded }; });
    r.runner.afterResolve(T0 + 90, res);
    expect(res.map((x) => x.outcome)).toEqual(["hit", "deadTarget"]);
    expect(res.filter((x) => x.damage100 > 0).length).toBe(1);
    // Later window ticks never query again: no second hit and no second heal.
    r.run(T0 + 91, T0 + 100);
    expect(r.hp(1)).toBe(8000); // one heal of 60 HP, not two
  });

  test("a victim that cannot be damaged (dash invulnerability, spawn protection) gives no heal; a lethal hit does", () => {
    const r = makeRig(3);
    r.awaken();
    r.cs.get(1)!.hp100 = 5000;
    put(r, 2, 3); put(r, 3, 5);
    r.cs.get(2)!.invulnerableUntil = T0 + 500;
    r.cs.get(3)!.protectedUntilTick = T0 + 500;
    r.step(T0, { press: [{ slot: 2 }] });
    r.run(T0 + 1, T0 + 100);
    expect(r.hp(1)).toBe(5000);
    expect(r.hp(2)).toBe(HP);
    expect(r.hp(3)).toBe(HP);
    const k = makeRig(2);
    k.awaken();
    k.cs.get(1)!.hp100 = 2000;
    k.cs.get(2)!.hp100 = 50; // lethal hit: clamped to the remaining 0.5 HP, still a successful damage
    k.step(T0, { press: [{ slot: 2 }] });
    k.run(T0 + 1, T0 + 90);
    expect(k.dealt(1, 2)).toEqual([[T0 + 90, 50]]);
    expect(k.hp(2)).toBe(0);
    expect(k.hp(1)).toBe(8000);
  });

  test("death of the caster during startup: no damage, no leftover cast", () => {
    const r = makeRig(2);
    r.awaken();
    r.step(T0, { press: [{ slot: 2 }] });
    r.run(T0 + 1, T0 + 40);
    r.cs.kill(1, T0 + 41);
    r.run(T0 + 42, T0 + 120);
    expect(r.hp(2)).toBe(HP);
    expect(r.runner.castOf(1)).toBeUndefined();
  });
});

// @@END
