import { describe, expect, test } from "vitest";
import { TD_DEFS } from "../../packages/shared/src/config/kits/td.js";
import { ALL_HANDLERS, buildKitRegistry } from "../../apps/server/src/kits/index.js";
import { COMBAT } from "../../packages/shared/src/config/combat.js";
import { CAPTOR_RELEASE_RECOVERY, applyReaction } from "../../apps/server/src/sim/ActionMachine.js";
import { CombatSystem } from "../../apps/server/src/sim/Combat.js";
import {
  AbilityRunner, type AbilityHost, type AbilityPose, type ProjectileProvider, type ReflectRequest, type SkillOutcome,
} from "../../apps/server/src/sim/AbilityRunner.js";
import type { HitCandidate, HitResult } from "../../apps/server/src/sim/HitResolver.js";
import type { Release } from "../../apps/server/src/sim/CaptureRegistry.js";

/**
 * Tide Duelist base abilities (T13): td.b1 Current Bind, td.b2 Undertow Spiral, td.b3 Tidal Cast,
 * td.b4 Mirror Current. Driven tick by tick in the room's order (expiry, buffered intent, input, collision
 * query, serial resolution, handler results) against a fake host, so every boundary is an exact integer tick.
 */
const T0 = 1000;
const HP = COMBAT.hp100Max;

const reg = buildKitRegistry();
const def = (id: string) => reg.byId(id)!;

interface Rig extends ReturnType<typeof makeRig> {}
function makeRig(n = 3, hostOpts: { moveTogether?: AbilityHost["moveTogether"]; surfaceHeight?: AbilityHost["surfaceHeight"]; projectiles?: ProjectileProvider } = {}) {
  const cs = new CombatSystem();
  const poses = new Map<number, AbilityPose>();
  for (let i = 1; i <= n; i++) cs.add(i, i, 0).protectedUntilTick = 0;
  // 1: Tide captor at the origin facing -Z. 2: victim 1.5 m ahead facing the captor. 3: second Tide fighter on the
  // far side of the victim facing +Z (also in reach of the victim, out of reach of 1).
  poses.set(1, { x: 0, y: 1, z: 0, facingYaw: 0, grounded: true });
  poses.set(2, { x: 0, y: 1, z: -1.5, facingYaw: Math.PI, grounded: true });
  poses.set(3, { x: 0.3, y: 1, z: -3, facingYaw: Math.PI, grounded: true });
  if (n >= 4) poses.set(4, { x: 0.6, y: 1, z: -1.6, facingYaw: Math.PI, grounded: true });
  let occluded = false;
  const walls = new Set<number>();
  const launches: { id: number; vx: number; vy: number; vz: number; tick: number }[] = [];
  const moves: { ids: number[]; dx: number; dz: number }[] = [];
  const releases: { rel: Release; tick: number }[] = [];
  cs.onRelease = (rel, tick) => { releases.push({ rel, tick }); };
  let curTick = T0;
  const host: AbilityHost = {
    combat: cs, pose: (id) => poses.get(id), blocked: () => occluded,
    launch: (id, vx, vy, vz) => { launches.push({ id, vx, vy, vz, tick: curTick }); },
    wallContact: (id, tick) => walls.has(id) && tick >= 0,
    ...(hostOpts.moveTogether ? { moveTogether: hostOpts.moveTogether } : {
      moveTogether: (ids, dx, dz) => { moves.push({ ids: [...ids], dx, dz }); for (const i of ids) { const p = poses.get(i)!; p.x += dx; p.z += dz; } return { dx, dz }; },
    }),
    ...(hostOpts.surfaceHeight ? { surfaceHeight: hostOpts.surfaceHeight } : {}),
    ...(hostOpts.projectiles ? { projectiles: hostOpts.projectiles } : {}),
  };
  const runner = new AbilityRunner(reg, ALL_HANDLERS, host);
  for (let i = 1; i <= n; i++) runner.setKit(i, "td");
  const results: { tick: number; r: HitResult }[] = [];
  const outcomes: { tick: number; who: number; o: SkillOutcome }[] = [];
  let strikeSeq = 100;
  /** A third party ordinary hit (stun by default) not tied to any ability cast. */
  const strike = (a: number, t: number, o: Partial<HitCandidate> = {}): HitCandidate => ({
    attackerId: a, attackerGeneration: cs.get(a)!.generation, castCounter: ++strikeSeq, hitIndex: 0, toi: 0, targetId: t,
    moveId: "test.strike", originX: poses.get(a)?.x ?? 0, originZ: poses.get(a)?.z ?? 0, block: "U", counterable: true,
    armorBreak: false, damage100: 300, reaction: { kind: "stun", ticks: 24 }, maxHitsPerTarget: 1, ...o,
  });
  interface StepOpts { press?: { who?: number; slot: 1 | 2 | 3 | 4 }[]; extra?: HitCandidate[]; guard?: number[] }
  /** One tick in spec 12 order: expiry, buffered intent, skill edges, collision query, resolution, handler results. */
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
  /** Steps [from, to] inclusive. `opts(t)` supplies per tick options. */
  const run = (from: number, to: number, opts?: (t: number) => StepOpts | undefined): void => {
    for (let t = from; t <= to; t++) step(t, opts?.(t));
  };
  const hp = (id: number): number => cs.get(id)!.hp100;
  /** Damage events (tick -> damage100) dealt by `a` to `t` that took effect, in order. */
  const dealt = (a: number, t: number) => results.filter((x) => x.r.candidate.attackerId === a && x.r.candidate.targetId === t && x.r.damage100 > 0 && (x.r.outcome === "hit" || x.r.outcome === "captured"))
    .map((x) => [x.tick, x.r.damage100] as const);
  return { cs, poses, runner, host, results, outcomes, launches, moves, releases, strike, step, run, hp, dealt, walls, setOccluded: (v: boolean) => { occluded = v; } };
}

describe("td definitions match the spec 15 table", () => {
  test("slotted base moves carry the exact table numbers", () => {
    expect(TD_DEFS.map((d) => d.id)).toEqual(["td.b1"]);
    const table: Record<string, [number, number, number, number, number, number, string, string]> = {
      "td.b1": [10, 5, 18, 1020, 2400, 2.4, "U", "captureBarrage"],
      "td.b2": [14, 5, 24, 1200, 1900, 2.2, "B", "dragSlam"],
      "td.b3": [12, 4, 18, 900, 900, 2.2, "U", "throwCapture"],
      "td.b4": [0, 60, 30, 1020, 2200, 4, "U", "counter"],
    };
    for (const d of TD_DEFS) {
      expect([d.startup, d.active, d.recovery, d.cooldown, d.damage100.reduce((a, b) => a + b, 0), d.range, d.block, d.handler]).toEqual(table[d.id]);
    }
  });
});

describe("td.b1 Current Bind (captureBarrage)", () => {
  test("definition: schedule [4,4,4,4,8] at [0,10,20,30,42], release R60 F7 U3", () => {
    const d = def("td.b1");
    expect(d.hitOffsets).toEqual([0, 10, 20, 30, 42]);
    expect(d.damage100).toEqual([400, 400, 400, 400, 800]);
    expect(d.ragdollTicks).toBe(60);
    expect(d.launch).toEqual({ forward: 7, up: 3 });
    expect(d.targetStates).toContain("air");
  });

  test("hit: capture at activeStart, 24 HP total at exact ticks, release at +43 with ragdoll and launch", () => {
    const r = makeRig(2);
    r.step(T0, { press: [{ slot: 1 }] });
    expect(r.outcomes[0]!.o).toMatchObject({ kind: "started", moveId: "td.b1" });
    r.run(T0 + 1, T0 + 9);
    expect(r.cs.get(1)!.action).toBe("Windup");
    expect(r.hp(2)).toBe(HP);
    const c = T0 + 10; // activeStart: capture tick
    r.step(c);
    expect(r.cs.get(2)!.action).toBe("Captured");
    expect(r.cs.get(1)!.armored).toBe(true);
    r.run(c + 1, c + 42);
    expect(r.dealt(1, 2)).toEqual([[c, 400], [c + 10, 400], [c + 20, 400], [c + 30, 400], [c + 42, 800]]);
    expect(r.hp(2)).toBe(HP - 2400);
    expect(r.cs.get(2)!.action).toBe("Captured"); // still held through c+42
    expect(r.cs.captures.size).toBe(1);
    r.step(c + 43);
    const v = r.cs.get(2)!;
    expect(v.action).toBe("Ragdolled");
    expect(v.actionEndTick - v.actionStartTick).toBe(60);
    expect(r.cs.captures.size).toBe(0);
    expect(r.launches.map((l) => [l.id, l.vx + 0, l.vy, l.vz, l.tick])).toEqual([[2, 0, 3, -7, c + 43]]); // forward is -Z at yaw 0
    expect(r.releases.map((x) => [x.tick, x.rel.cause])).toEqual([[c + 43, "final"]]);
    // Captor: armor ends at release, recovery of 18 ticks after the sequence.
    expect(r.cs.get(1)!.armored).toBe(false);
    r.run(c + 44, c + 43 + 17);
    expect(r.cs.get(1)!.action).toBe("Recovery");
    r.step(c + 43 + 18);
    expect(r.cs.get(1)!.action).toBe("Idle");
    expect(r.hp(2)).toBe(HP - 2400);
  });

  test("miss: no capture, recovery starts at the end of the probe window, cooldown is spent", () => {
    const r = makeRig(2);
    r.poses.get(2)!.z = -5;
    r.step(T0, { press: [{ slot: 1 }] });
    r.run(T0 + 1, T0 + 14);
    expect(r.cs.get(1)!.action).toBe("Active");
    r.step(T0 + 15);
    expect(r.cs.get(1)!.action).toBe("Recovery");
    expect(r.runner.castOf(1)!.activeEnd).toBe(T0 + 15);
    expect(r.cs.get(2)!.action).toBe("Idle");
    r.run(T0 + 16, T0 + 32);
    expect(r.cs.get(1)!.action).toBe("Recovery");
    r.step(T0 + 33);
    expect(r.cs.get(1)!.action).toBe("Idle");
    r.step(T0 + 34, { press: [{ slot: 1 }] });
    expect(r.outcomes.at(-1)!.o).toEqual({ kind: "rejected", reason: "COOLDOWN" });
    expect(r.results.length).toBe(0);
  });

  test("acceptance: a missed initial probe cannot attach a later victim during recovery", () => {
    const r = makeRig(2);
    r.poses.get(2)!.z = -5;
    r.step(T0, { press: [{ slot: 1 }] });
    r.run(T0 + 1, T0 + 14);
    r.poses.get(2)!.z = -1.5; // steps into reach after the 5 tick probe window
    r.run(T0 + 15, T0 + 33);
    expect(r.cs.get(2)!.action).toBe("Idle");
    expect(r.hp(2)).toBe(HP);
    expect(r.results.length).toBe(0);
    expect(r.cs.captures.size).toBe(0);
  });

  test("probe window is [activeStart, activeStart+5): the last tick still captures", () => {
    const r = makeRig(2);
    r.poses.get(2)!.z = -5;
    r.step(T0, { press: [{ slot: 1 }] });
    r.run(T0 + 1, T0 + 13);
    r.poses.get(2)!.z = -1.5;
    r.step(T0 + 14);
    expect(r.cs.get(2)!.action).toBe("Captured");
    // The window extends only because of the hit: capture + 43 + 18 recovery.
    expect(r.runner.castOf(1)!.endTick).toBe(T0 + 14 + 43 + 18);
  });

  test("guard bypass: U ignores a frontal guard", () => {
    const r = makeRig(2);
    r.run(T0 - 10, T0 - 1, () => ({ guard: [2] }));
    r.step(T0, { press: [{ slot: 1 }], guard: [2] });
    r.run(T0 + 1, T0 + 10, () => ({ guard: [2] }));
    expect(r.cs.get(2)!.action).toBe("Captured");
    expect(r.results.some((x) => x.r.outcome === "blocked")).toBe(false);
  });

  test("counter: a counterable initial hit is intercepted, nothing is captured, no duplicate counter", () => {
    const r = makeRig(2);
    r.cs.get(2)!.counterOpenUntil = T0 + 100;
    r.step(T0, { press: [{ slot: 1 }] });
    r.run(T0 + 1, T0 + 14);
    const outs = r.results.map((x) => x.r.outcome);
    expect(outs[0]).toBe("countered");
    expect(outs.slice(1).every((o) => o === "duplicate")).toBe(true);
    expect(r.cs.get(2)!.counterOpenUntil).toBe(0);
    expect(r.hp(2)).toBe(HP);
    expect(r.cs.captures.size).toBe(0);
    expect(r.cs.get(1)!.armored).toBe(false);
  });

  test("duplicate hit: five damage events in a whole cast, one capture, probe is inert afterwards", () => {
    const r = makeRig(2);
    r.step(T0, { press: [{ slot: 1 }] });
    r.run(T0 + 1, T0 + 80);
    expect(r.dealt(1, 2).length).toBe(5);
    expect(r.results.filter((x) => x.r.outcome === "captured").length).toBe(1);
    expect(r.hp(2)).toBe(HP - 2400);
  });

  test("airborne ragdoll is capturable, grounded ragdoll is not; air and standing are", () => {
    for (const [ragdoll, grounded, expectCapture] of [[true, false, true], [true, true, false], [false, false, true], [false, true, true]] as const) {
      const r = makeRig(2);
      const v = r.cs.get(2)!;
      if (ragdoll) applyReaction(v, T0 - 5, { kind: "ragdoll", ticks: 200 }, !grounded);
      r.poses.get(2)!.grounded = grounded;
      r.step(T0, { press: [{ slot: 1 }] });
      r.run(T0 + 1, T0 + 12);
      expect(r.cs.get(2)!.action === "Captured").toBe(expectCapture);
    }
  });

  test("static occlusion prevents the capture", () => {
    const r = makeRig(2);
    r.setOccluded(true);
    r.step(T0, { press: [{ slot: 1 }] });
    r.run(T0 + 1, T0 + 20);
    expect(r.cs.get(2)!.action).toBe("Idle");
    expect(r.results.length).toBe(0);
  });

  test("third party ordinary damage reaches the captured victim without breaking the capture", () => {
    const r = makeRig(3);
    r.poses.get(3)!.z = 5; // out of the way, no probing
    r.step(T0, { press: [{ slot: 1 }] });
    r.run(T0 + 1, T0 + 14);
    expect(r.cs.get(2)!.action).toBe("Captured");
    r.step(T0 + 20, { extra: [r.strike(3, 2, { damage100: 500 })] });
    expect(r.hp(2)).toBe(HP - 400 - 400 - 500); // capture hit, +10 hit, third party
    expect(r.cs.get(2)!.action).toBe("Captured");
    r.run(T0 + 21, T0 + 53);
    expect(r.hp(2)).toBe(HP - 2400 - 500);
    expect(r.cs.get(2)!.action).toBe("Ragdolled");
  });

  test("interruption in startup (stun) cancels the cast: no capture, no damage", () => {
    const r = makeRig(3);
    r.poses.get(3)!.z = 5;
    r.step(T0, { press: [{ slot: 1 }] });
    r.run(T0 + 1, T0 + 4);
    r.step(T0 + 5, { extra: [r.strike(3, 1)] });
    expect(r.cs.get(1)!.action).toBe("Stunned");
    r.run(T0 + 6, T0 + 40);
    expect(r.cs.get(2)!.action).toBe("Idle");
    expect(r.hp(2)).toBe(HP);
    expect(r.runner.castOf(1)).toBeUndefined();
  });

  test("interruption mid sequence: armor ignores stun and ragdoll (no armorBreak) but still takes damage", () => {
    const r = makeRig(3);
    r.poses.get(3)!.z = 5;
    r.step(T0, { press: [{ slot: 1 }] });
    r.run(T0 + 1, T0 + 14);
    r.step(T0 + 15, { extra: [r.strike(3, 1, { damage100: 700 }), r.strike(3, 1, { damage100: 100, reaction: { kind: "ragdoll", ticks: 60 } })] });
    expect(r.hp(1)).toBe(HP - 800);
    expect(r.cs.get(1)!.action).toBe("Active");
    r.run(T0 + 16, T0 + 53);
    expect(r.hp(2)).toBe(HP - 2400);
  });

  test("interruption mid sequence by armorBreak: capture is released, remaining damage never lands", () => {
    const r = makeRig(3);
    r.poses.get(3)!.z = 5;
    r.step(T0, { press: [{ slot: 1 }] });
    r.run(T0 + 1, T0 + 24);
    expect(r.hp(2)).toBe(HP - 800); // capture hit and the +10 hit
    r.step(T0 + 25, { extra: [r.strike(3, 1, { armorBreak: true })] });
    expect(r.cs.get(1)!.action).toBe("Stunned");
    expect(r.cs.get(2)!.action).toBe("Idle");
    expect(r.cs.captures.size).toBe(0);
    expect(r.releases.at(-1)!.rel.cause).toBe("cancelled");
    r.run(T0 + 26, T0 + 80);
    expect(r.hp(2)).toBe(HP - 800);
  });

  test("death of the captor mid sequence releases the victim and stops the damage", () => {
    const r = makeRig(2);
    r.step(T0, { press: [{ slot: 1 }] });
    r.run(T0 + 1, T0 + 25);
    r.cs.kill(1, T0 + 26);
    expect(r.cs.get(2)!.action).toBe("Idle");
    r.run(T0 + 26, T0 + 80);
    expect(r.hp(2)).toBe(HP - 800);
    expect(r.cs.captures.size).toBe(0);
    expect(r.runner.castOf(1)).toBeUndefined();
  });

  test("death of the victim mid sequence stops the damage, releases, and the captor recovers for 18 ticks", () => {
    const r = makeRig(3);
    r.poses.get(3)!.z = 5;
    r.step(T0, { press: [{ slot: 1 }] });
    r.run(T0 + 1, T0 + 24);
    r.cs.get(2)!.hp100 = 100;
    r.step(T0 + 25, { extra: [r.strike(3, 2, { damage100: 5000 })] });
    expect(r.cs.get(2)!.action).toBe("Dead");
    expect(r.hp(2)).toBe(0);
    expect(r.cs.get(2)!.koCount).toBe(1);
    const c = r.cs.get(1)!;
    expect(c.action).toBe("Recovery");
    expect(c.actionEndTick).toBe(T0 + 25 + CAPTOR_RELEASE_RECOVERY);
    r.run(T0 + 26, T0 + 70);
    expect(r.dealt(1, 2).length).toBe(2); // capture hit and the +10 hit only; later hits are stale
    expect(r.cs.captures.size).toBe(0);
    expect(r.cs.get(1)!.action).toBe("Idle");
  });

  test("lethal final hit: one KO, no negative HP, no orphan capture", () => {
    const r = makeRig(2);
    r.step(T0, { press: [{ slot: 1 }] });
    r.run(T0 + 1, T0 + 51);
    r.cs.get(2)!.hp100 = 300;
    r.run(T0 + 52, T0 + 70);
    expect(r.cs.get(2)!.action).toBe("Dead");
    expect(r.hp(2)).toBe(0);
    expect(r.cs.get(2)!.koCount).toBe(1);
    expect(r.cs.captures.size).toBe(0);
    expect(r.cs.get(1)!.action === "Recovery" || r.cs.get(1)!.action === "Idle").toBe(true);
  });

  test("capture arbitration: two Current Binds on one victim, same tick -> one owner, loser deals nothing", () => {
    const r = makeRig(3);
    r.step(T0, { press: [{ slot: 1, who: 1 }, { slot: 1, who: 3 }] });
    r.run(T0 + 1, T0 + 10);
    const caps = r.results.filter((x) => x.r.outcome === "captured");
    const lost = r.results.filter((x) => x.r.outcome === "captureLost");
    expect(caps.map((x) => x.r.candidate.attackerId)).toEqual([1]);
    expect(lost.map((x) => x.r.candidate.attackerId)).toEqual([3]);
    expect(r.cs.captures.captureOn(2)!.captorId).toBe(1);
    r.run(T0 + 11, T0 + 80);
    expect(r.dealt(3, 2)).toEqual([]);
    expect(r.hp(2)).toBe(HP - 2400);
    expect(r.cs.captures.size).toBe(0);
    expect(r.cs.get(3)!.action === "Idle" || r.cs.get(3)!.action === "Recovery").toBe(true);
  });

  test("a captured victim is immune to a second capture later in the sequence", () => {
    const r = makeRig(3);
    r.step(T0, { press: [{ slot: 1, who: 1 }] });
    r.run(T0 + 1, T0 + 15);
    r.step(T0 + 16, { press: [{ slot: 1, who: 3 }] });
    r.run(T0 + 17, T0 + 40);
    expect(r.cs.captures.captureOn(2)?.captorId).toBe(1);
    expect(r.results.some((x) => x.r.candidate.attackerId === 3 && x.r.outcome === "captured")).toBe(false);
  });

  test("disconnect: removing the captor or the victim releases the capture immediately", () => {
    const a = makeRig(2);
    a.step(T0, { press: [{ slot: 1 }] });
    a.run(T0 + 1, T0 + 20);
    a.runner.remove(1);
    a.cs.remove(1, T0 + 21);
    expect(a.cs.get(2)!.action).toBe("Idle");
    expect(a.cs.captures.size).toBe(0);
    expect(a.cs.invariantViolations()).toEqual([]);

    const b = makeRig(2);
    b.step(T0, { press: [{ slot: 1 }] });
    b.run(T0 + 1, T0 + 20);
    b.cs.remove(2, T0 + 21);
    expect(b.cs.captures.size).toBe(0);
    expect(b.cs.get(1)!.action).toBe("Recovery");
    expect(b.cs.get(1)!.actionEndTick).toBe(T0 + 21 + CAPTOR_RELEASE_RECOVERY);
    b.run(T0 + 21, T0 + 60);
    expect(b.cs.invariantViolations()).toEqual([]);
  });

  test("cancel is idempotent and leaves no orphan capture", () => {
    const r = makeRig(2);
    r.step(T0, { press: [{ slot: 1 }] });
    r.run(T0 + 1, T0 + 20);
    r.runner.cancel(1);
    r.runner.cancel(1);
    expect(r.cs.captures.size).toBe(0);
    expect(r.cs.get(2)!.action).toBe("Idle");
    expect(r.cs.get(1)!.armored).toBe(false);
  });

  test("cooldown 1020 ticks from the accepted press, and expiry boundary", () => {
    const r = makeRig(2);
    r.step(T0, { press: [{ slot: 1 }] });
    r.run(T0 + 1, T0 + 100);
    r.cs.get(2)!.hp100 = HP;
    r.step(T0 + 1019, { press: [{ slot: 1 }] });
    expect(r.outcomes.at(-1)!.o).toEqual({ kind: "rejected", reason: "COOLDOWN" });
    r.step(T0 + 1020, { press: [{ slot: 1 }] });
    expect(r.outcomes.at(-1)!.o).toMatchObject({ kind: "started", moveId: "td.b1" });
  });

  test("two clients see the same result: replaying the identical input yields identical state", () => {
    const snap = (r: ReturnType<typeof makeRig>) => JSON.stringify([...[1, 2].map((i) => { const f = r.cs.get(i)!; return [f.hp100, f.action, f.actionStartTick, f.actionEndTick, [...f.cooldowns]]; }), r.dealt(1, 2)]);
    const a = makeRig(2), b = makeRig(2);
    for (const r of [a, b]) { r.step(T0, { press: [{ slot: 1 }] }); r.run(T0 + 1, T0 + 70); }
    expect(snap(a)).toBe(snap(b));
  });
});

export type { Rig, ReflectRequest };
