import { describe, expect, test } from "vitest";
import { SV_DEFS } from "../../packages/shared/src/config/kits/sv.js";
import { ALL_HANDLERS, buildKitRegistry } from "../../apps/server/src/kits/index.js";
import { lethalCounterRemaining } from "../../apps/server/src/kits/sv/lethalCounter.js";
import { BEAST_STILLPOINT } from "../../packages/shared/src/config/beast.js";
import { COMBAT } from "../../packages/shared/src/config/combat.js";
import { CAPTOR_RELEASE_RECOVERY, applyReaction } from "../../apps/server/src/sim/ActionMachine.js";
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
  for (let i = 1; i <= n; i++) cs.add(i, i, 0, i === 1 ? "sv" : "td").protectedUntilTick = 0;
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
    expect(ids).toEqual(["sv.a1", "sv.a2", "sv.a3", "sv.a4"]);
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
    b.cs.get(1)!.kitId = "td"; // kit change consumes the awakening and everything attached to it
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

describe("sv.a1 beast shockwave (D)", () => {
  const B = BEAST_STILLPOINT;
  const beastRig = (n = 3) => { const r = makeRig(n); r.awaken(); r.cs.get(1)!.beast = true; return r; };
  const hitsOn = (r: ReturnType<typeof makeRig>, t: number) => r.dealt(1, t);

  test("hits a target inside 9 m for doubled damage exactly once, ragdoll 60, launch F8 U8; no status is armed", () => {
    const r = beastRig(2);
    r.poses.get(2)!.z = -8;
    r.step(T0, { press: [{ slot: 1 }] });
    expect(r.outcomes[0]!.o).toMatchObject({ kind: "started", moveId: "sv.a1" });
    const f = r.cs.get(1)!;
    expect(f.lethalCounterUntil).toBe(0);
    expect(lethalCounterRemaining(r.runner, 1, T0)).toBe(0);
    r.run(T0 + 1, T0 + 12 + 30 + 5);
    expect(hitsOn(r, 2)).toEqual([[T0, B.damage100 * 2]]);
    expect(r.hp(2)).toBe(HP - 5000);
    const hit = r.results.find((x) => x.r.candidate.targetId === 2)!.r.candidate;
    expect([hit.launch, hit.reaction]).toEqual([{ forward: 8, up: 8 }, { kind: "ragdoll", ticks: 60 }]);
  });

  test("misses a target beyond 9 m", () => {
    const r = beastRig(2);
    r.poses.get(2)!.z = -9.5;
    r.step(T0, { press: [{ slot: 1 }] });
    r.run(T0 + 1, T0 + 50);
    expect(hitsOn(r, 2)).toEqual([]);
    expect(r.hp(2)).toBe(HP);
  });

  test("a duplicate tick never rehits", () => {
    const r = beastRig(2);
    r.step(T0, { press: [{ slot: 1 }] });
    r.step(T0);
    r.step(T0 + 1);
    expect(hitsOn(r, 2).length).toBe(1);
  });

  test("caster death during the wave deals no further hit", () => {
    const r = beastRig(2);
    r.step(T0, { press: [{ slot: 1 }] });
    r.cs.get(1)!.hp100 = 0;
    r.cs.get(1)!.action = "Dead";
    r.run(T0 + 1, T0 + 50);
    expect(hitsOn(r, 2).length).toBe(1);
  });

  test("an interrupted caster (stun before activeStart is impossible: startup 0) deals the hit at commit only", () => {
    const r = beastRig(2);
    r.step(T0, { press: [{ slot: 1 }], extra: [r.strike(2, 1, { counterable: false })] });
    r.run(T0 + 1, T0 + 30);
    expect(hitsOn(r, 2).length).toBeLessThanOrEqual(1);
  });

  test("cooldown ends at commit + 12 + 30 + 240", () => {
    const r = beastRig(2);
    r.step(T0, { press: [{ slot: 1 }] });
    expect(r.cs.get(1)!.cooldowns.get("sv.a1")).toBe(T0 + B.activeTicks + B.recoveryTicks + B.restTicks);
  });

  test("non-beast sv.a1 still arms the counter and hits nobody", () => {
    const r = makeRig(2);
    r.awaken();
    r.step(T0, { press: [{ slot: 1 }] });
    r.run(T0 + 1, T0 + 30);
    expect(r.cs.get(1)!.lethalCounterUntil).toBe(T0 + 600);
    expect(hitsOn(r, 2)).toEqual([]);
  });
});

describe("awakened damage never feeds the next meter (D)", () => {
  test("a resolved sv.a2 or sv.a1 hit adds no meter although the form is already Base", () => {
    const cs = new CombatSystem();
    cs.add(1, 1, 0, "sv"); cs.add(2, 2, 0, "sv");
    const host = { combat: cs, pose: () => ({ x: 0, y: 1, z: 0, facingYaw: 0, grounded: true }) };
    const aw = new AwakeningSystem(host);
    const cand = (moveId: string): HitResult => ({
      candidate: { attackerId: 1, attackerGeneration: 0, castCounter: 1, hitIndex: 0, toi: 0, targetId: 2, moveId, originX: 0, originZ: 0,
        block: "U", counterable: false, armorBreak: true, damage100: 1000, reaction: { kind: "none" }, maxHitsPerTarget: 1 },
      outcome: "hit", damage100: 1000, killed: false,
    });
    aw.gain([cand("sv.a1"), cand("sv.a2")]);
    expect(cs.get(1)!.meter100).toBe(0);
    aw.gain([cand("sv.b2")]);
    expect(cs.get(1)!.meter100).toBe(2500); // FB04: normal hit 1000 x 2.5
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

  test("volume bounds: 24 m deep, 10 m to each side, 2 m below to 6 m above (box centred 2 m up), nothing behind the caster", () => {
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
    expect(hit(5, 0, 1 + 5.5)).toBe(true); // R05: box centred 2 m above the caster, so it spans -2 to +6 m
    expect(hit(5, 0, 1 + 7)).toBe(false);
    expect(hit(5, 0, 1 - 3)).toBe(true); // owner rule: same level or lower always connects
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

describe("sv.a3 Horizon Break (longBeam)", () => {
  const cast3 = (r: ReturnType<typeof makeRig>): void => { r.step(T0, { press: [{ slot: 3 }] }); r.run(T0 + 1, T0 + 72); };

  test("definition: 72/6/42, beam 32 m radius 3, max 4, U, armorBreak, noncounterable, R90 F22 U5, one use", () => {
    const d = def("sv.a3");
    expect([d.slot, d.form, d.startup, d.active, d.recovery, d.block, d.counterable, d.armorBreak, d.maxTargets, d.maxHitsPerTarget])
      .toEqual([3, "Awakened", 72, 6, 42, "U", false, true, 4, 1]);
    expect(d.shape).toEqual({ kind: "beam", length: 32, radius: 3 });
    expect([d.ragdollTicks, d.launch, d.oncePerForm, d.consumesForm]).toEqual([90, { forward: 22, up: 5 }, true, true]);
  });

  test("near (<= 8 m) takes 100 HP, far takes 60 HP with R90 F22 U5; near heals to full", () => {
    const r = makeRig(3);
    r.awaken();
    r.cs.get(1)!.hp100 = 2000;
    put(r, 2, 8.6); // exactly 8 m from the beam origin (0.6 m ahead of the caster): near
    put(r, 3, 8.61); // just beyond: far
    r.step(T0, { press: [{ slot: 3 }] });
    expect(r.cs.get(1)!.form).toBe("Base");
    r.run(T0 + 1, T0 + 71);
    expect(r.hp(1)).toBe(2000);
    const res = r.step(T0 + 72);
    expect(r.dealt(1, 2)).toEqual([[T0 + 72, HP]]);
    expect(r.dealt(1, 3)).toEqual([[T0 + 72, 6000]]);
    expect(r.hp(3)).toBe(4000);
    expect(r.hp(1)).toBe(HP); // a near target took damage: heal to full
    const far = res.find((x) => x.candidate.targetId === 3)!;
    expect(far.candidate.reaction).toEqual({ kind: "ragdoll", ticks: 90 });
    expect(r.cs.get(3)!.action).toBe("Ragdolled");
    expect(r.cs.get(3)!.actionEndTick).toBe(T0 + 72 + 90);
    const l = r.runner.launches(T0 + 72, res);
    expect(l.length).toBe(1);
    expect(l[0]).toMatchObject({ targetId: 3, vy: 5 });
    expect(l[0]!.vx).toBeCloseTo(0, 9);
    expect(l[0]!.vz).toBeCloseTo(-22, 9);
  });

  test("far hits only heal 30 HP once, however many far targets take damage", () => {
    const r = makeRig(4);
    r.awaken();
    r.cs.get(1)!.hp100 = 2000;
    put(r, 2, 12); put(r, 3, 20); put(r, 4, 28);
    cast3(r);
    expect(r.dealt(1, 2).length + r.dealt(1, 3).length + r.dealt(1, 4).length).toBe(3);
    expect(r.hp(1)).toBe(2000 + 3000);
    r.run(T0 + 73, T0 + 120);
    expect(r.hp(1)).toBe(5000);
  });

  test("far heal is capped at 100 HP and a near plus far beam heals to full, not 30 + full", () => {
    const a = makeRig(2);
    a.awaken();
    a.cs.get(1)!.hp100 = 9000;
    put(a, 2, 15);
    cast3(a);
    expect(a.hp(1)).toBe(HP);
    const b = makeRig(3);
    b.awaken();
    b.cs.get(1)!.hp100 = 1000;
    put(b, 2, 3); put(b, 3, 15);
    cast3(b);
    expect(b.hp(1)).toBe(HP);
  });

  test("lethal clamps: a near target with 0.5 HP loses 0.5 HP, a far target with 20 HP loses 20 HP; both count as damage", () => {
    const r = makeRig(3);
    r.awaken();
    r.cs.get(1)!.hp100 = 2000;
    put(r, 2, 4); put(r, 3, 20);
    r.cs.get(2)!.hp100 = 50;
    r.cs.get(3)!.hp100 = 2000;
    cast3(r);
    expect(r.dealt(1, 2)).toEqual([[T0 + 72, 50]]);
    expect(r.dealt(1, 3)).toEqual([[T0 + 72, 2000]]);
    expect(r.hp(2)).toBe(0);
    expect(r.hp(3)).toBe(0);
    const only = makeRig(2);
    only.awaken();
    only.cs.get(1)!.hp100 = 2000;
    put(only, 2, 20);
    only.cs.get(2)!.hp100 = 2000;
    cast3(only);
    expect(only.hp(1)).toBe(5000); // a lethal far hit still heals 30
  });

  test("beam range from the beam origin: 32.6 m hits, 32.8 m does not; radius 3 plus the capsule; nothing behind the caster", () => {
    const hit = (fwd: number, side: number): boolean => {
      const r = makeRig(2);
      r.awaken();
      put(r, 2, fwd, side);
      cast3(r);
      return r.dealt(1, 2).length === 1;
    };
    expect(hit(32.6, 0)).toBe(true);
    expect(hit(32.8, 0)).toBe(false);
    expect(hit(10, 3.3)).toBe(true);
    expect(hit(10, 3.5)).toBe(false);
    expect(hit(-1, 0)).toBe(false);
  });

  test("truncated at the first solid obstacle: victims beyond the wall are untouched, those before it are hit", () => {
    const r = makeRig(4);
    r.awaken();
    put(r, 2, 9); put(r, 3, 11); put(r, 4, 25);
    r.setWallZ(-10);
    cast3(r);
    expect(r.dealt(1, 2).length).toBe(1);
    expect(r.dealt(1, 3).length).toBe(0);
    expect(r.dealt(1, 4).length).toBe(0);
    expect(r.hp(3)).toBe(HP);
    expect(r.hp(4)).toBe(HP);
  });

  test("a wall right in front of the caster leaves a beam length of about zero", () => {
    const r = makeRig(2);
    r.awaken();
    put(r, 2, 2);
    r.setWallZ(-0.5);
    cast3(r);
    expect(r.dealt(1, 2).length).toBe(0);
    expect(r.hp(1)).toBe(HP);
  });

  test("invulnerable from commit through tick +77; tick +78 (first recovery tick) is vulnerable", () => {
    const r = makeRig(3);
    r.awaken();
    put(r, 2, 40); put(r, 3, 40, 3);
    r.step(T0, { press: [{ slot: 3 }] });
    expect(r.cs.get(1)!.invulnerableUntil).toBe(T0 + 78);
    for (const t of [T0 + 1, T0 + 60, T0 + 71, T0 + 72, T0 + 77]) {
      r.step(t, { extra: [r.strike(3, 1, { counterable: false, armorBreak: true })] });
      expect(r.of("invulnerable", t).length).toBe(1);
    }
    expect(r.hp(1)).toBe(HP);
    expect(r.cs.get(1)!.action).not.toBe("Stunned");
    r.step(T0 + 78, { extra: [r.strike(3, 1, { counterable: false, armorBreak: true })] });
    expect(r.of("hit", T0 + 78).length).toBe(1);
    expect(r.cs.get(1)!.action).toBe("Stunned");
  });

  test("grounded only, and a miss still spends the form with the full 42 tick recovery", () => {
    const air = makeRig(2);
    air.awaken();
    air.poses.get(1)!.grounded = false;
    air.step(T0, { press: [{ slot: 3 }] });
    expect(air.outcomes[0]!.o).toEqual({ kind: "rejected", reason: "STATE" });
    expect(air.cs.get(1)!.form).toBe("Awakened");

    const r = makeRig(2);
    r.awaken();
    r.cs.get(1)!.hp100 = 4000;
    put(r, 2, 33);
    r.step(T0, { press: [{ slot: 3 }] });
    r.run(T0 + 1, T0 + 72 + 6 + 41);
    expect(r.cs.get(1)!.action).toBe("Recovery");
    expect(r.hp(1)).toBe(4000);
    expect(r.cs.get(1)!.form).toBe("Base");
    r.step(T0 + 72 + 6 + 42);
    expect(r.cs.get(1)!.action).toBe("Idle");
    r.step(T0 + 200, { press: [{ slot: 3 }] });
    expect(r.outcomes[r.outcomes.length - 1]!.o).toMatchObject({ kind: "started", moveId: "sv.b3" }); // one use only
  });

  test("max 4 targets, nearest first, tie by id", () => {
    const r = makeRig(6);
    r.awaken();
    put(r, 2, 6); put(r, 3, 12); put(r, 4, 18); put(r, 5, 24); put(r, 6, 30);
    cast3(r);
    expect([2, 3, 4, 5, 6].map((i) => r.dealt(1, i).length)).toEqual([1, 1, 1, 1, 0]);
    const t = makeRig(5);
    t.awaken();
    put(t, 2, 5); put(t, 3, 6); put(t, 4, 12); put(t, 5, 12);
    t.poses.get(3)!.x = 0; // distinct distances 5, 6, 12, 12
    cast3(t);
    expect([2, 3, 4, 5].map((i) => t.dealt(1, i).length)).toEqual([1, 1, 1, 1]);
    const u = makeRig(6);
    u.awaken();
    put(u, 2, 5); put(u, 3, 6); put(u, 4, 7); put(u, 5, 12); put(u, 6, 12);
    cast3(u);
    expect(u.dealt(1, 5).length).toBe(1); // equal distance 12: the lower id takes the last slot
    expect(u.dealt(1, 6).length).toBe(0);
  });

  test("block and counter are irrelevant", () => {
    const r = makeRig(3);
    r.awaken();
    put(r, 2, 4); put(r, 3, 15);
    r.cs.get(3)!.counterOpenUntil = T0 + 500;
    r.step(T0, { press: [{ slot: 3 }], guard: [2] });
    r.run(T0 + 1, T0 + 72, () => ({ guard: [2] }));
    expect(r.of("blocked").length).toBe(0);
    expect(r.of("countered").length).toBe(0);
    expect(r.dealt(1, 2).length).toBe(1);
    expect(r.dealt(1, 3)).toEqual([[T0 + 72, 6000]]);
  });

  test("duplicate hit on a surviving far target is refused and the beam queries only once", () => {
    const r = makeRig(2);
    r.awaken();
    r.cs.get(1)!.hp100 = 2000;
    put(r, 2, 20);
    r.step(T0, { press: [{ slot: 3 }] });
    r.run(T0 + 1, T0 + 71);
    const cands = r.runner.collect(T0 + 72);
    const res = r.cs.resolve(T0 + 72, [...cands, { ...cands[0]! }], (id) => { const q = r.poses.get(id); return q && { x: q.x, z: q.z, facingYaw: q.facingYaw, grounded: q.grounded }; });
    r.runner.afterResolve(T0 + 72, res);
    expect(res.map((x) => x.outcome)).toEqual(["hit", "duplicate"]);
    expect(r.hp(2)).toBe(HP - 6000);
    r.run(T0 + 73, T0 + 77);
    expect(r.hp(2)).toBe(HP - 6000);
    expect(r.hp(1)).toBe(5000);
  });

  test("a target that cannot take damage gives no heal; death of the caster in startup cancels everything", () => {
    const r = makeRig(2);
    r.awaken();
    r.cs.get(1)!.hp100 = 3000;
    put(r, 2, 4);
    r.cs.get(2)!.invulnerableUntil = T0 + 500;
    cast3(r);
    expect(r.hp(2)).toBe(HP);
    expect(r.hp(1)).toBe(3000);

    const d = makeRig(2);
    d.awaken();
    put(d, 2, 4);
    d.step(T0, { press: [{ slot: 3 }] });
    d.run(T0 + 1, T0 + 30);
    d.cs.kill(1, T0 + 31);
    d.run(T0 + 32, T0 + 100);
    expect(d.hp(2)).toBe(HP);
    expect(d.runner.castOf(1)).toBeUndefined();
  });
});

describe("sv.a4 Orbit Collapse (cinematicGrab)", () => {
  const AS = T0 + 24; // activeStart

  test("definition: 24/6/36, capture range 3 m, schedule [0, 90], release R90 F6 U10, U, armorBreak, noncounterable, one use", () => {
    const d = def("sv.a4");
    expect([d.slot, d.form, d.startup, d.active, d.recovery, d.range, d.block, d.counterable, d.armorBreak])
      .toEqual([4, "Awakened", 24, 6, 36, 3, "U", false, true]);
    expect(d.hitOffsets).toEqual([0, 90]);
    expect(d.damage100).toEqual([0, 10000]);
    expect([d.ragdollTicks, d.launch, d.oncePerForm, d.consumesForm]).toEqual([90, { forward: 6, up: 10 }, true, true]);
  });

  test("capture at the first active tick: cinematic, both shielded from third parties, no capsule moved, no damage yet", () => {
    const r = makeRig(3);
    r.awaken();
    put(r, 3, 6);
    r.step(T0, { press: [{ slot: 4 }] });
    expect(r.cs.get(1)!.form).toBe("Base");
    r.run(T0 + 1, AS - 1);
    expect(r.cs.get(2)!.action).not.toBe("Captured");
    const before = JSON.stringify([...r.poses.entries()]);
    const res = r.step(AS);
    expect(res.map((x) => [x.outcome, x.damage100])).toEqual([["captured", 0]]);
    expect(r.cs.get(2)!.action).toBe("Captured");
    expect(r.cs.captures.captureOn(2)).toMatchObject({ captorId: 1, cinematic: true, moveId: "sv.a4" });
    r.step(AS + 1, { extra: [r.strike(3, 1, { counterable: false }), r.strike(3, 2, { counterable: false })] });
    expect(r.of("shielded").length).toBe(2); // captor and victim are both protected from the third party
    expect(JSON.stringify([...r.poses.entries()])).toBe(before); // no capsule moved
    expect(r.hp(1)).toBe(HP);
    expect(r.hp(2)).toBe(HP);
  });

  test("100 HP lands exactly 90 ticks after the capture, the caster heals to full, a lethal victim gives the captor 18 ticks", () => {
    const r = makeRig(2);
    r.awaken();
    r.cs.get(1)!.hp100 = 3000;
    r.step(T0, { press: [{ slot: 4 }] });
    r.run(T0 + 1, AS + 89);
    expect(r.hp(2)).toBe(HP);
    expect(r.hp(1)).toBe(3000);
    const res = r.step(AS + 90);
    expect(r.dealt(1, 2)).toEqual([[AS + 90, HP]]);
    expect(res[0]!.candidate).toMatchObject({ counterable: false, block: "U", armorBreak: true, hitIndex: 1 });
    expect(res[0]!.killed).toBe(true);
    expect(r.hp(1)).toBe(HP);
    expect(r.cs.captures.size).toBe(0);
    expect(r.cs.get(1)!.action).toBe("Recovery");
    expect(r.cs.get(1)!.actionEndTick).toBe(AS + 90 + CAPTOR_RELEASE_RECOVERY);
    expect(r.cs.invariantViolations()).toEqual([]);
  });

  test("when the damage cannot land the victim is released at +96 with R90 F6 U10, then exactly 36 ticks of recovery", () => {
    const r = makeRig(2);
    r.awaken();
    r.cs.get(1)!.hp100 = 3000;
    r.step(T0, { press: [{ slot: 4 }] });
    r.run(T0 + 1, AS + 89);
    r.cs.get(2)!.invulnerableUntil = AS + 1000; // fixture: damage is refused
    r.run(AS + 90, AS + 95);
    expect(r.hp(2)).toBe(HP);
    expect(r.hp(1)).toBe(3000); // no damage, no heal
    expect(r.cs.get(2)!.action).toBe("Captured");
    expect(r.cs.get(1)!.action).toBe("Active");
    r.step(AS + 96);
    expect(r.cs.get(2)!.action).toBe("Ragdolled");
    expect(r.cs.get(2)!.actionEndTick).toBe(AS + 96 + 90);
    expect(r.launches).toEqual([{ id: 2, vx: expect.closeTo(0, 9), vy: 10, vz: expect.closeTo(-6, 9), tick: AS + 96 }]);
    expect(r.releases.map((x) => [x.rel.cause, x.tick])).toEqual([["final", AS + 96]]);
    expect(r.cs.get(1)!.action).toBe("Recovery");
    r.run(AS + 97, AS + 96 + 35);
    expect(r.cs.get(1)!.action).toBe("Recovery");
    r.step(AS + 96 + 36);
    expect(r.cs.get(1)!.action).toBe("Idle");
    expect(r.cs.captures.size).toBe(0);
  });

  test("miss: straight to the listed 36 tick recovery, no extension, a victim stepping in during recovery is not captured, form spent", () => {
    const r = makeRig(2);
    r.awaken();
    put(r, 2, 8);
    r.step(T0, { press: [{ slot: 4 }] });
    r.run(T0 + 1, T0 + 29);
    expect(r.cs.get(1)!.action).toBe("Active");
    r.step(T0 + 30);
    expect(r.cs.get(1)!.action).toBe("Recovery");
    expect(r.cs.get(1)!.actionEndTick).toBe(T0 + 66);
    put(r, 2, 1.5);
    r.run(T0 + 31, T0 + 65);
    expect(r.cs.captures.size).toBe(0);
    expect(r.cs.get(2)!.action).toBe("Idle");
    r.step(T0 + 66);
    expect(r.cs.get(1)!.action).toBe("Idle");
    expect(r.cs.get(1)!.form).toBe("Base");
    expect(r.hp(1)).toBe(HP);
    r.step(T0 + 70, { press: [{ slot: 4 }] });
    expect(r.outcomes[r.outcomes.length - 1]!.o).toMatchObject({ kind: "started", moveId: "sv.b4" }); // one use only
  });

  test("probe window: a victim entering at the last active tick is captured, one entering a tick later is not", () => {
    const last = makeRig(2);
    last.awaken();
    put(last, 2, 9);
    last.step(T0, { press: [{ slot: 4 }] });
    last.run(T0 + 1, T0 + 28);
    put(last, 2, 1.5);
    last.step(T0 + 29);
    expect(last.cs.get(2)!.action).toBe("Captured");
    const late = makeRig(2);
    late.awaken();
    put(late, 2, 9);
    late.step(T0, { press: [{ slot: 4 }] });
    late.run(T0 + 1, T0 + 29);
    put(late, 2, 1.5);
    late.step(T0 + 30);
    expect(late.cs.get(2)!.action).toBe("Idle");
  });

  test("grab range: 3.3 m is inside (3 m plus the capsule), 3.4 m is not; behind the caster is not", () => {
    const grab = (fwd: number): boolean => {
      const r = makeRig(2);
      r.awaken();
      put(r, 2, fwd);
      r.step(T0, { press: [{ slot: 4 }] });
      r.run(T0 + 1, AS);
      return r.cs.get(2)!.action === "Captured";
    };
    expect(grab(3.3)).toBe(true);
    expect(grab(3.4)).toBe(false);
    expect(grab(-1.5)).toBe(false);
  });

  test("nearest eligible victim wins, ties go to the lowest entity id, exactly one is captured", () => {
    const near = makeRig(3);
    near.awaken();
    put(near, 2, 2.5); put(near, 3, 1.2);
    near.step(T0, { press: [{ slot: 4 }] });
    near.run(T0 + 1, AS);
    expect(near.cs.get(3)!.action).toBe("Captured");
    expect(near.cs.get(2)!.action).toBe("Idle");
    expect(near.cs.captures.size).toBe(1);

    const tie = makeRig(3);
    tie.awaken();
    tie.poses.set(2, { x: 0.5, y: 1, z: -1.5, facingYaw: Math.PI, grounded: true });
    tie.poses.set(3, { x: -0.5, y: 1, z: -1.5, facingYaw: Math.PI, grounded: true });
    tie.step(T0, { press: [{ slot: 4 }] });
    tie.run(T0 + 1, AS);
    expect(tie.cs.get(2)!.action).toBe("Captured");
    expect(tie.cs.get(3)!.action).toBe("Idle");
  });

  test("an ineligible nearest victim (invulnerable, protected) never blocks a farther valid one", () => {
    const r = makeRig(4);
    r.awaken();
    put(r, 2, 1.0); put(r, 3, 1.5); put(r, 4, 2.2);
    r.cs.get(2)!.invulnerableUntil = T0 + 1000;
    r.cs.get(3)!.protectedUntilTick = T0 + 1000;
    r.step(T0, { press: [{ slot: 4 }] });
    r.run(T0 + 1, AS);
    expect(r.cs.get(4)!.action).toBe("Captured");
    expect(r.cs.captures.captureOn(4)!.captorId).toBe(1);
  });

  test("a victim behind a solid wall is not captured", () => {
    const r = makeRig(2);
    r.awaken();
    r.setOccluded(true);
    r.step(T0, { press: [{ slot: 4 }] });
    r.run(T0 + 1, T0 + 40);
    expect(r.cs.captures.size).toBe(0);
    expect(r.cs.get(2)!.action).toBe("Idle");
  });

  test("block and counter are irrelevant: a guarding victim and an open counter stance are captured", () => {
    const g = makeRig(2);
    g.awaken();
    g.step(T0, { press: [{ slot: 4 }], guard: [2] });
    g.run(T0 + 1, AS, () => ({ guard: [2] }));
    expect(g.of("blocked").length).toBe(0);
    expect(g.cs.get(2)!.action).toBe("Captured");
    const c = makeRig(2);
    c.awaken();
    c.cs.get(2)!.counterOpenUntil = T0 + 500;
    c.step(T0, { press: [{ slot: 4 }] });
    c.run(T0 + 1, AS);
    expect(c.of("countered").length).toBe(0);
    expect(c.cs.get(2)!.action).toBe("Captured");
  });

  test("duplicate hit: a second copy of the capture in the same tick is refused", () => {
    const r = makeRig(2);
    r.awaken();
    r.step(T0, { press: [{ slot: 4 }] });
    r.run(T0 + 1, AS - 1);
    const cands = r.runner.collect(AS);
    expect(cands.length).toBe(1);
    const res = r.cs.resolve(AS, [...cands, { ...cands[0]! }], (id) => { const q = r.poses.get(id); return q && { x: q.x, z: q.z, facingYaw: q.facingYaw, grounded: q.grounded }; });
    r.runner.afterResolve(AS, res);
    expect(res.map((x) => x.outcome)).toEqual(["captured", "duplicate"]);
    expect(r.cs.captures.size).toBe(1);
  });

  test("interruption: a victim that leaves mid-capture gives the captor exactly 18 ticks of recovery and no damage follows", () => {
    const r = makeRig(2);
    r.awaken();
    r.cs.get(1)!.hp100 = 4000;
    r.step(T0, { press: [{ slot: 4 }] });
    r.run(T0 + 1, AS + 10);
    r.cs.remove(2, AS + 11);
    expect(r.cs.captures.size).toBe(0);
    expect(r.cs.get(1)!.action).toBe("Recovery");
    expect(r.cs.get(1)!.actionEndTick).toBe(AS + 11 + CAPTOR_RELEASE_RECOVERY);
    r.run(AS + 12, AS + 200);
    expect(r.cs.get(1)!.action).toBe("Idle");
    expect(r.hp(1)).toBe(4000);
    expect(r.releases.map((x) => x.rel.cause)).toEqual(["victimGone"]);
  });

  test("death of the victim mid-capture (void kill): no orphan capture, captor recovery 18, no damage", () => {
    const r = makeRig(2);
    r.awaken();
    r.step(T0, { press: [{ slot: 4 }] });
    r.run(T0 + 1, AS + 20);
    r.cs.kill(2, AS + 21);
    expect(r.cs.captures.size).toBe(0);
    expect(r.cs.get(1)!.actionEndTick).toBe(AS + 21 + CAPTOR_RELEASE_RECOVERY);
    r.run(AS + 22, AS + 150);
    expect(r.dealt(1, 2)).toEqual([]);
    expect(r.runner.castOf(1)).toBeUndefined();
  });

  test("death of the caster mid-capture: the victim is released, nothing is left behind, no damage", () => {
    const r = makeRig(2);
    r.awaken();
    r.step(T0, { press: [{ slot: 4 }] });
    r.run(T0 + 1, AS + 20);
    r.cs.kill(1, AS + 21);
    expect(r.cs.captures.size).toBe(0);
    expect(r.cs.get(2)!.action).toBe("Idle");
    r.run(AS + 22, AS + 150);
    expect(r.hp(2)).toBe(HP);
    expect(r.runner.castOf(1)).toBeUndefined();
    expect(r.releases.map((x) => x.rel.cause)).toEqual(["captorGone"]);
  });

  test("interruption of the caster mid-capture (action replaced) releases the victim at once", () => {
    const r = makeRig(2);
    r.awaken();
    r.step(T0, { press: [{ slot: 4 }] });
    r.run(T0 + 1, AS + 10);
    applyReaction(r.cs.get(1)!, AS + 11, { kind: "stun", ticks: 20 }, false); // fixture: an effect the shield cannot stop (void rule)
    r.run(AS + 11, AS + 12);
    expect(r.cs.captures.size).toBe(0);
    expect(r.cs.get(2)!.action).toBe("Idle");
    r.run(AS + 13, AS + 150);
    expect(r.hp(2)).toBe(HP);
  });

  test("A14 form state changes while the awakened capture is active: the cast finishes, nothing new starts, protections released", () => {
    const r = makeRig(2);
    const aw = new AwakeningSystem(r.host);
    r.awaken();
    r.step(T0, { press: [{ slot: 4 }] });
    r.run(T0 + 1, AS + 5);
    const f = r.cs.get(1)!;
    expect(f.form).toBe("Base"); // changed at commit; the committed cast keeps running
    expect(r.cs.captures.size).toBe(1);
    f.form = "Awakened"; f.formEndTick = AS + 20; // fixture: a timed form that expires mid capture
    aw.update(AS + 10);
    expect(f.form).toBe("Awakened");
    aw.update(AS + 20);
    expect(f.form).toBe("Base");
    expect(r.runner.castOf(1)?.def.id).toBe("sv.a4");
    expect(r.cs.captures.size).toBe(1);
    f.awakenedUsedMask = 0b1000;
    f.form = "Awakened"; // a second awakened press mid capture must not start a new awakened cast
    r.step(AS + 30, { press: [{ slot: 4 }] });
    expect(r.outcomes[r.outcomes.length - 1]!.o).toEqual({ kind: "buffered" });
    r.cs.get(2)!.invulnerableUntil = AS + 1000; // victim survives to the release
    f.form = "Base";
    r.run(AS + 31, AS + 96 + 36 + 10);
    expect(r.runner.castOf(1)?.def.id).not.toBe("sv.a4");
    expect(r.cs.captures.size).toBe(0);
    expect(f.armored).toBe(false);
    expect(r.cs.get(2)!.action).not.toBe("Captured");
    expect(r.cs.invariantViolations()).toEqual([]);
  });
});

// @@END

describe("R05 shape anchors follow spec 16", () => {
  test("Skybreak hits a target 5.5 m above the caster and one 3 m below (downward is never out of reach)", () => {
    const hit = (y: number): boolean => {
      const r = makeRig(2);
      r.awaken();
      put(r, 2, 5, 0, y);
      r.step(T0, { press: [{ slot: 2 }] });
      r.run(T0 + 1, T0 + 90);
      return r.dealt(1, 2).length === 1;
    };
    expect(hit(1 + 5.5)).toBe(true);
    expect(hit(1 - 3)).toBe(true); // owner rule: targets below are never out of reach
  });

  test("Horizon Break splits near and far at 8 m from the beam origin, not from the caster centre", () => {
    const r = makeRig(3);
    r.awaken();
    put(r, 2, 8.4); // 7.8 m from the origin: near, although more than 8 m is not reached from the centre
    put(r, 3, 8.8); // 8.2 m from the origin: far
    r.step(T0, { press: [{ slot: 3 }] });
    r.run(T0 + 1, T0 + 72);
    expect(r.dealt(1, 2)).toEqual([[T0 + 72, HP]]);
    expect(r.dealt(1, 3)).toEqual([[T0 + 72, 6000]]);
  });
});
