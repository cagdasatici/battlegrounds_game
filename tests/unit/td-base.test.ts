import { describe, expect, test } from "vitest";
import { TD_DEFS } from "../../packages/shared/src/config/kits/td.js";
import { ALL_HANDLERS, buildKitRegistry } from "../../apps/server/src/kits/index.js";
import { COMBAT } from "../../packages/shared/src/config/combat.js";
import { CAPTOR_RELEASE_RECOVERY, applyReaction } from "../../apps/server/src/sim/ActionMachine.js";
import { CombatSystem } from "../../apps/server/src/sim/Combat.js";
import {
  AbilityRunner, type AbilityHandler, type AbilityHost, type AbilityPose, type ProjectileProvider, type ReflectRequest,
  type SkillOutcome,
} from "../../apps/server/src/sim/AbilityRunner.js";
import { P1_ELEVATED_SLAM, createDragSlam } from "../../apps/server/src/kits/td/dragSlam.js";
import { NEUTRAL_MOVE } from "../../packages/shared/src/movement.js";
import { World } from "../../apps/server/src/sim/World.js";
import { MovementSystem } from "../../apps/server/src/sim/Movement.js";
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
function makeRig(n = 3, hostOpts: {
  moveTogether?: AbilityHost["moveTogether"]; surfaceHeight?: AbilityHost["surfaceHeight"]; projectiles?: ProjectileProvider;
  handlers?: readonly AbilityHandler[];
} = {}) {
  const cs = new CombatSystem();
  const poses = new Map<number, AbilityPose>();
  for (let i = 1; i <= n; i++) cs.add(i, i, 0, "td").protectedUntilTick = 0;
  // 1: Tide captor at the origin facing -Z. 2: victim 1.5 m ahead facing the captor. 3: second Tide fighter on the
  // far side of the victim facing +Z (also in reach of the victim, out of reach of 1).
  poses.set(1, { x: 0, y: 1, z: 0, facingYaw: 0, grounded: true });
  poses.set(2, { x: 0, y: 1, z: -1.5, facingYaw: Math.PI, grounded: true });
  poses.set(3, { x: 0.3, y: 1, z: -3, facingYaw: Math.PI, grounded: true });
  if (n >= 4) poses.set(4, { x: 6, y: 1, z: -1.6, facingYaw: Math.PI, grounded: true }); // bystander, far away
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
    ...(hostOpts.projectiles ? { projectileReflector: hostOpts.projectiles } : {}),
  };
  const runner = new AbilityRunner(reg, hostOpts.handlers ?? ALL_HANDLERS, host);
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
    expect(TD_DEFS.map((d) => d.id)).toEqual(["td.b1", "td.b2", "td.b3", "td.b4"]);
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

describe("td.b2 Undertow Spiral (dragSlam)", () => {
  const c = T0 + 14; // activeStart: capture tick
  test("definition: damage [5,14] at [0,48], release R72 F3 U8, blockable, three target states", () => {
    const d = def("td.b2");
    expect(d.hitOffsets).toEqual([0, 48]);
    expect(d.damage100).toEqual([500, 1400]);
    expect(d.ragdollTicks).toBe(72);
    expect(d.launch).toEqual({ forward: 3, up: 8 });
    expect(d.block).toBe("B");
    expect(d.targetStates).toEqual(["standing", "air", "ragdoll"]);
  });

  test("hit: 5 at capture, 14 at +48, 3 m over 36 equal steps at +1..+36, release at +49", () => {
    const r = makeRig(2);
    r.step(T0, { press: [{ slot: 2 }] });
    r.run(T0 + 1, c - 1);
    r.step(c);
    expect(r.cs.get(2)!.action).toBe("Captured");
    expect(r.cs.get(1)!.armored).toBe(true);
    r.run(c + 1, c + 48);
    expect(r.dealt(1, 2)).toEqual([[c, 500], [c + 48, 1400]]);
    expect(r.hp(2)).toBe(HP - 1900);
    expect(r.moves.length).toBe(36);
    expect(r.moves.every((m) => m.ids.join() === "1,2" && Math.abs(m.dx) < 1e-12 && Math.abs(m.dz + 3 / 36) < 1e-12)).toBe(true);
    expect(r.moves.reduce((s, m) => s + m.dz, 0)).toBeCloseTo(-3, 9);
    expect(r.poses.get(1)!.z).toBeCloseTo(-3, 9);
    expect(r.poses.get(2)!.z).toBeCloseTo(-4.5, 9);
    expect(r.cs.get(2)!.action).toBe("Captured");
    r.step(c + 49);
    const v = r.cs.get(2)!;
    expect(v.action).toBe("Ragdolled");
    expect(v.actionEndTick - v.actionStartTick).toBe(72);
    expect(r.launches.map((l) => [l.id, l.vx + 0, l.vy, l.vz, l.tick])).toEqual([[2, 0, 8, -3, c + 49]]);
    expect(r.cs.captures.size).toBe(0);
    expect(r.cs.get(1)!.armored).toBe(false);
    r.run(c + 50, c + 49 + 23);
    expect(r.cs.get(1)!.action).toBe("Recovery");
    r.step(c + 49 + 24);
    expect(r.cs.get(1)!.action).toBe("Idle");
  });

  test("miss: probe window then recovery, cooldown spent; a later victim cannot attach", () => {
    const r = makeRig(2);
    r.poses.get(2)!.z = -5;
    r.step(T0, { press: [{ slot: 2 }] });
    r.run(T0 + 1, c + 4);
    r.poses.get(2)!.z = -1.5;
    r.run(c + 5, c + 30);
    expect(r.cs.get(2)!.action).toBe("Idle");
    expect(r.results.length).toBe(0);
    expect(r.moves.length).toBe(0);
    r.step(T0 + 14 + 5 + 24, { press: [{ slot: 2 }] });
    expect(r.outcomes.at(-1)!.o).toEqual({ kind: "rejected", reason: "COOLDOWN" });
  });

  test("block: a frontal guard blocks the B probe (blockstun, no capture); from behind it is captured", () => {
    const r = makeRig(2);
    r.run(T0 - 10, T0 - 1, () => ({ guard: [2] }));
    r.step(T0, { press: [{ slot: 2 }], guard: [2] });
    r.run(T0 + 1, c + 8, () => ({ guard: [2] }));
    expect(r.results.map((x) => x.r.outcome)[0]).toBe("blocked");
    expect(r.results.slice(1).every((x) => x.r.outcome === "duplicate")).toBe(true); // one probe hit across the window
    expect(r.hp(2)).toBe(HP);
    expect(r.cs.get(2)!.action).not.toBe("Captured");
    expect(r.cs.get(2)!.blockstunUntil).toBe(c + COMBAT.guard.blockstun);
    expect(r.moves.length).toBe(0);
    const b = makeRig(2);
    b.poses.get(2)!.facingYaw = 0; // facing away from the captor
    b.run(T0 - 10, T0 - 1, () => ({ guard: [2] }));
    b.step(T0, { press: [{ slot: 2 }], guard: [2] });
    b.run(T0 + 1, c, () => ({ guard: [2] }));
    expect(b.cs.get(2)!.action).toBe("Captured");
  });

  test("counter: a counterable initial hit is intercepted before any capture", () => {
    const r = makeRig(2);
    r.cs.get(2)!.counterOpenUntil = T0 + 100;
    r.step(T0, { press: [{ slot: 2 }] });
    r.run(T0 + 1, c + 10);
    expect(r.results[0]!.r.outcome).toBe("countered");
    expect(r.hp(2)).toBe(HP);
    expect(r.cs.captures.size).toBe(0);
    expect(r.moves.length).toBe(0);
  });

  test("duplicate hit: exactly two damage events and one capture over the whole cast", () => {
    const r = makeRig(2);
    r.step(T0, { press: [{ slot: 2 }] });
    r.run(T0 + 1, c + 90);
    expect(r.dealt(1, 2).length).toBe(2);
    expect(r.results.filter((x) => x.r.outcome === "captured").length).toBe(1);
  });

  test("airborne and grounded ragdoll targets are both capturable; static occlusion is not", () => {
    for (const [ragdoll, grounded] of [[true, false], [true, true], [false, false]] as const) {
      const r = makeRig(2);
      if (ragdoll) applyReaction(r.cs.get(2)!, T0 - 5, { kind: "ragdoll", ticks: 300 }, !grounded);
      r.poses.get(2)!.grounded = grounded;
      r.step(T0, { press: [{ slot: 2 }] });
      r.run(T0 + 1, c + 2);
      expect(r.cs.get(2)!.action).toBe("Captured");
    }
    const o = makeRig(2);
    o.setOccluded(true);
    o.step(T0, { press: [{ slot: 2 }] });
    o.run(T0 + 1, c + 10);
    expect(o.results.length).toBe(0);
  });

  test("interruption: startup stun cancels; mid sequence armor ignores stun; armorBreak releases and stops motion", () => {
    const a = makeRig(3);
    a.poses.get(3)!.z = 5;
    a.step(T0, { press: [{ slot: 2 }] });
    a.run(T0 + 1, T0 + 5);
    a.step(T0 + 6, { extra: [a.strike(3, 1)] });
    a.run(T0 + 7, c + 60);
    expect(a.cs.get(2)!.action).toBe("Idle");
    expect(a.hp(2)).toBe(HP);
    expect(a.moves.length).toBe(0);

    const b = makeRig(3);
    b.poses.get(3)!.z = 5;
    b.step(T0, { press: [{ slot: 2 }] });
    b.run(T0 + 1, c + 9);
    b.step(c + 10, { extra: [b.strike(3, 1, { damage100: 400 }), b.strike(3, 1, { damage100: 100, reaction: { kind: "ragdoll", ticks: 60 } })] });
    expect(b.hp(1)).toBe(HP - 500);
    b.run(c + 11, c + 49);
    expect(b.hp(2)).toBe(HP - 1900);
    expect(b.moves.length).toBe(36);

    const d = makeRig(3);
    d.poses.get(3)!.z = 5;
    d.step(T0, { press: [{ slot: 2 }] });
    d.run(T0 + 1, c + 9);
    d.step(c + 10, { extra: [d.strike(3, 1, { armorBreak: true })] });
    expect(d.cs.get(1)!.action).toBe("Stunned");
    expect(d.cs.get(2)!.action).toBe("Idle");
    const movesAtBreak = d.moves.length;
    d.run(c + 11, c + 80);
    expect(d.moves.length).toBe(movesAtBreak);
    expect(d.hp(2)).toBe(HP - 500);
    expect(d.cs.captures.size).toBe(0);
  });

  test("death of the captor and of the victim mid sequence", () => {
    const a = makeRig(2);
    a.step(T0, { press: [{ slot: 2 }] });
    a.run(T0 + 1, c + 20);
    a.cs.kill(1, c + 21);
    a.run(c + 21, c + 80);
    expect(a.cs.get(2)!.action).toBe("Idle");
    expect(a.hp(2)).toBe(HP - 500);

    const b = makeRig(3);
    b.poses.get(3)!.z = 5;
    b.step(T0, { press: [{ slot: 2 }] });
    b.run(T0 + 1, c + 20);
    b.cs.get(2)!.hp100 = 50;
    b.step(c + 21, { extra: [b.strike(3, 2, { damage100: 900 })] });
    expect(b.cs.get(2)!.action).toBe("Dead");
    expect(b.cs.get(1)!.action).toBe("Recovery");
    expect(b.cs.get(1)!.actionEndTick).toBe(c + 21 + CAPTOR_RELEASE_RECOVERY);
    const n = b.moves.length;
    b.run(c + 22, c + 80);
    expect(b.moves.length).toBe(n); // no more motion after the victim died
    expect(b.dealt(1, 2).length).toBe(1);
  });

  test("capture arbitration, removal and cooldown 1200", () => {
    const r = makeRig(3);
    r.step(T0, { press: [{ slot: 2, who: 1 }, { slot: 2, who: 3 }] });
    r.run(T0 + 1, c + 60);
    expect(r.results.filter((x) => x.r.outcome === "captured").map((x) => x.r.candidate.attackerId)).toEqual([1]);
    expect(r.results.filter((x) => x.r.outcome === "captureLost").map((x) => x.r.candidate.attackerId)).toEqual([3]);
    expect(r.dealt(3, 2)).toEqual([]);
    expect(r.moves.every((m) => m.ids.includes(1) && !m.ids.includes(3))).toBe(true);

    const b = makeRig(2);
    b.step(T0, { press: [{ slot: 2 }] });
    b.run(T0 + 1, c + 10);
    b.runner.remove(1);
    b.cs.remove(1, c + 11);
    expect(b.cs.get(2)!.action).toBe("Idle");
    expect(b.cs.captures.size).toBe(0);

    const e = makeRig(2);
    e.step(T0, { press: [{ slot: 2 }] });
    e.run(T0 + 1, c + 60);
    e.step(T0 + 1199, { press: [{ slot: 2 }] });
    expect(e.outcomes.at(-1)!.o).toEqual({ kind: "rejected", reason: "COOLDOWN" });
    e.step(T0 + 1200, { press: [{ slot: 2 }] });
    expect(e.outcomes.at(-1)!.o).toMatchObject({ kind: "started", moveId: "td.b2" });
  });

  test("a wall stops the motion but not the remaining damage schedule or the release", () => {
    let calls = 0;
    const r = makeRig(2, { moveTogether: (ids, dx, dz) => { calls++; if (calls <= 5) { for (const i of ids) { const p = r.poses.get(i)!; p.x += dx; p.z += dz; } return { dx, dz }; } return { dx: 0, dz: 0 }; } });
    r.step(T0, { press: [{ slot: 2 }] });
    r.run(T0 + 1, c + 48);
    expect(calls).toBe(6); // five free steps, one blocked step, then no more attempts
    expect(r.dealt(1, 2)).toEqual([[c, 500], [c + 48, 1400]]);
    r.step(c + 49);
    expect(r.cs.get(2)!.action).toBe("Ragdolled");
    expect(r.cs.captures.size).toBe(0);
  });

  test("P1 elevated branch is OFF by default; when enabled, final damage 24 once only if started >= 2 m up and landed before +48", () => {
    expect(P1_ELEVATED_SLAM).toBe(false);
    const withFlag = [...ALL_HANDLERS.filter((h) => h.name !== "dragSlam"), createDragSlam({ elevatedBranch: true })];
    const run = (flag: boolean, startY: number, landAt: number | null) => {
      const r = makeRig(2, { surfaceHeight: () => 0, ...(flag ? { handlers: withFlag } : {}) });
      for (const i of [1, 2]) { r.poses.get(i)!.y = startY; r.poses.get(i)!.grounded = false; }
      r.step(T0, { press: [{ slot: 2 }] });
      r.run(T0 + 1, c);
      r.run(c + 1, c + 49, (t) => { if (landAt !== null && t === c + landAt) r.poses.get(1)!.grounded = true; return undefined; });
      return r;
    };
    const high = 0.9 + 2.5;
    expect(run(true, high, 20).dealt(1, 2)).toEqual([[c, 500], [c + 48, 2400]]);
    expect(run(true, high, 47).dealt(1, 2).at(-1)).toEqual([c + 48, 2400]); // lands on +47: still before +48
    expect(run(true, high, 48).dealt(1, 2).at(-1)).toEqual([c + 48, 1400]); // lands on +48: not before
    expect(run(true, high, null).dealt(1, 2).at(-1)).toEqual([c + 48, 1400]); // never lands
    expect(run(true, 0.9 + 1.9, 20).dealt(1, 2).at(-1)).toEqual([c + 48, 1400]); // started under 2 m
    expect(run(false, high, 20).dealt(1, 2).at(-1)).toEqual([c + 48, 1400]); // flag off (the shipped P0 setting)
    expect(run(true, high, 20).dealt(1, 2).filter(([, d]) => d === 2400).length).toBe(1);
  });
});

describe("td.b2 with the real collision world (swept movement)", () => {
  const setup = async (cap: [number, number, number], vic: [number, number, number]) => {
    const world = await World.create();
    const sys = new MovementSystem(world);
    sys.add(1, cap); sys.add(2, vic);
    for (let t = 1; t <= 40; t++) sys.step(t, () => NEUTRAL_MOVE);
    let ref: ReturnType<typeof makeRig> | null = null;
    const sync = () => {
      for (const i of [1, 2]) {
        const p = sys.position(i)!, q = ref!.poses.get(i)!;
        ref!.poses.set(i, { x: p[0], y: p[1], z: p[2], facingYaw: q.facingYaw, grounded: sys.get(i)!.state.grounded });
      }
    };
    const r = makeRig(2, { moveTogether: (ids, dx, dz) => { const m = sys.moveTogether(ids, dx, dz); sync(); return m; } });
    ref = r;
    r.poses.get(2)!.facingYaw = Math.PI;
    sync();
    const tick = (t: number, press?: boolean) => { sys.step(t, () => NEUTRAL_MOVE); sync(); r.step(t, press ? { press: [{ slot: 2 }] } : undefined); };
    return { world, sys, r, tick, done: () => { sys.dispose(); world.dispose(); } };
  };

  test("free ground: the pair travels 3 m forward and stays 1.5 m apart", async () => {
    const s = await setup([0, 0.92, 8], [0, 0.92, 6.5]);
    try {
      const z0 = s.sys.position(2)![2];
      s.tick(1000, true);
      for (let t = 1001; t <= 1070; t++) s.tick(t);
      expect(s.r.moves.length).toBe(0); // the real host path does not use the fake host recorder
      expect(z0 - s.sys.position(2)![2]).toBeGreaterThan(2.97);
      expect(z0 - s.sys.position(2)![2]).toBeLessThan(3.03);
      expect(s.sys.position(1)![2] - s.sys.position(2)![2]).toBeGreaterThan(1.47);
      expect(s.sys.position(1)![2] - s.sys.position(2)![2]).toBeLessThan(1.53);
      expect(s.r.hp(2)).toBe(HP - 1900);
    } finally { s.done(); }
  });

  test("acceptance: crossing a wall never drags the victim through it (wall.0 spans z -0.3..0.3)", async () => {
    const s = await setup([-10, 0.92, 2.5], [-10, 0.92, 1.0]);
    try {
      s.tick(1000, true);
      let minZ = Infinity;
      for (let t = 1001; t <= 1070; t++) {
        s.tick(t);
        const p = s.sys.position(2)!;
        minZ = Math.min(minZ, p[2]);
        expect(s.world.capsuleOverlaps(p, COMBAT.capsule.radius - 0.01, COMBAT.capsule.halfHeight).filter((id) => id.startsWith("wall"))).toEqual([]);
      }
      expect(minZ).toBeGreaterThan(0.3 + COMBAT.capsule.radius - 0.03); // never inside or beyond the wall
      expect(1.0 - minZ).toBeLessThan(0.5); // the motion stopped at the wall, far short of 3 m
      expect(1.0 - minZ).toBeGreaterThan(0.2); // ... after moving up to it (not blocked from the start)
      expect(s.r.dealt(1, 2).map(([, d]) => d)).toEqual([500, 1400]); // the damage schedule still ran
      expect(s.r.cs.get(2)!.action).toBe("Ragdolled"); // released at +49 as scheduled
      expect(s.r.cs.captures.size).toBe(0);
    } finally { s.done(); }
  });
});

describe("td.b3 Tidal Cast (throwCapture)", () => {
  const c = T0 + 12; // activeStart: capture tick
  const rel = c + 19; // release tick
  const BONUS = 300;
  /** Throws victim 2 (airborne so the ragdoll lasts) and returns after the release tick. */
  const thrown = (n = 4, airborne = true) => {
    const r = makeRig(n);
    r.poses.get(2)!.grounded = !airborne;
    r.step(T0, { press: [{ slot: 3 }] });
    r.run(T0 + 1, rel);
    return r;
  };

  test("definition: capture without damage, 9 at +18, release R60 F10 U2, U, all three target states", () => {
    const d = def("td.b3");
    expect(d.hitOffsets).toEqual([0, 18]);
    expect(d.damage100).toEqual([0, 900]);
    expect(d.ragdollTicks).toBe(60);
    expect(d.launch).toEqual({ forward: 10, up: 2 });
    expect(d.block).toBe("U");
    expect(d.targetStates).toEqual(["standing", "air", "ragdoll"]);
  });

  test("hit: capture at activeStart, 9 HP at +18, release at +19 (R60 F10 U2), armor only during the capture", () => {
    const r = makeRig(2);
    r.step(T0, { press: [{ slot: 3 }] });
    r.run(T0 + 1, c - 1);
    r.step(c);
    expect(r.results[0]!.r.outcome).toBe("captured");
    expect(r.results[0]!.r.damage100).toBe(0);
    expect(r.cs.get(2)!.action).toBe("Captured");
    expect(r.cs.get(1)!.armored).toBe(true);
    r.run(c + 1, c + 18);
    expect(r.dealt(1, 2)).toEqual([[c + 18, 900]]);
    expect(r.cs.get(2)!.action).toBe("Captured");
    r.step(rel);
    const v = r.cs.get(2)!;
    expect(v.action).toBe("Ragdolled");
    expect(v.actionEndTick - v.actionStartTick).toBe(60);
    expect(r.hp(2)).toBe(HP - 900);
    expect(r.launches.map((l) => [l.id, l.vx + 0, l.vy, l.vz, l.tick])).toEqual([[2, 0, 2, -10, rel]]);
    expect(r.releases.map((x) => [x.tick, x.rel.cause])).toEqual([[rel, "final"]]);
    expect(r.cs.get(1)!.armored).toBe(false);
    r.run(rel + 1, rel + 17);
    expect(r.cs.get(1)!.action).toBe("Recovery");
    r.step(rel + 18);
    expect(r.cs.get(1)!.action).toBe("Idle");
  });

  test("capture supports standing, air and ragdoll (grounded or airborne) targets", () => {
    for (const [ragdoll, grounded] of [[false, true], [false, false], [true, false], [true, true]] as const) {
      const r = makeRig(2);
      if (ragdoll) applyReaction(r.cs.get(2)!, T0 - 5, { kind: "ragdoll", ticks: 300 }, !grounded);
      r.poses.get(2)!.grounded = grounded;
      r.step(T0, { press: [{ slot: 3 }] });
      r.run(T0 + 1, c + 2);
      expect(r.cs.get(2)!.action).toBe("Captured");
    }
  });

  test("miss and acceptance: nothing attaches after the probe window; cooldown 900 spent", () => {
    const r = makeRig(2);
    r.poses.get(2)!.z = -5;
    r.step(T0, { press: [{ slot: 3 }] });
    r.run(T0 + 1, c + 3);
    r.poses.get(2)!.z = -1.5;
    r.run(c + 4, c + 60);
    expect(r.cs.get(2)!.action).toBe("Idle");
    expect(r.results.length).toBe(0);
    r.step(T0 + 899, { press: [{ slot: 3 }] });
    expect(r.outcomes.at(-1)!.o).toEqual({ kind: "rejected", reason: "COOLDOWN" });
    r.step(T0 + 900, { press: [{ slot: 3 }] });
    expect(r.outcomes.at(-1)!.o).toMatchObject({ kind: "started", moveId: "td.b3" });
  });

  test("guard bypass (U), counter of the initial hit, static occlusion, duplicate hit", () => {
    const g = makeRig(2);
    g.run(T0 - 10, T0 - 1, () => ({ guard: [2] }));
    g.step(T0, { press: [{ slot: 3 }], guard: [2] });
    g.run(T0 + 1, c + 2, () => ({ guard: [2] }));
    expect(g.cs.get(2)!.action).toBe("Captured");
    expect(g.results.some((x) => x.r.outcome === "blocked")).toBe(false);

    const k = makeRig(2);
    k.cs.get(2)!.counterOpenUntil = T0 + 100;
    k.step(T0, { press: [{ slot: 3 }] });
    k.run(T0 + 1, c + 30);
    expect(k.results[0]!.r.outcome).toBe("countered");
    expect(k.results.slice(1).every((x) => x.r.outcome === "duplicate")).toBe(true);
    expect(k.hp(2)).toBe(HP);
    expect(k.cs.captures.size).toBe(0);

    const o = makeRig(2);
    o.setOccluded(true);
    o.step(T0, { press: [{ slot: 3 }] });
    o.run(T0 + 1, c + 30);
    expect(o.results.length).toBe(0);

    const d = makeRig(2);
    d.step(T0, { press: [{ slot: 3 }] });
    d.run(T0 + 1, rel + 60);
    expect(d.dealt(1, 2)).toEqual([[c + 18, 900]]);
    expect(d.results.filter((x) => x.r.outcome === "captured").length).toBe(1);
  });

  test("interruption: startup stun cancels; mid capture armor ignores stun; armorBreak releases without the 9", () => {
    const a = makeRig(3);
    a.poses.get(3)!.z = 5;
    a.step(T0, { press: [{ slot: 3 }] });
    a.run(T0 + 1, T0 + 4);
    a.step(T0 + 5, { extra: [a.strike(3, 1)] });
    a.run(T0 + 6, c + 40);
    expect(a.cs.get(2)!.action).toBe("Idle");
    expect(a.hp(2)).toBe(HP);

    const b = makeRig(3);
    b.poses.get(3)!.z = 5;
    b.step(T0, { press: [{ slot: 3 }] });
    b.run(T0 + 1, c + 4);
    b.step(c + 5, { extra: [b.strike(3, 1, { damage100: 200 }), b.strike(3, 1, { damage100: 100, reaction: { kind: "ragdoll", ticks: 60 } })] });
    expect(b.hp(1)).toBe(HP - 300);
    b.run(c + 6, rel);
    expect(b.hp(2)).toBe(HP - 900);
    expect(b.cs.get(2)!.action).toBe("Ragdolled");

    const d = makeRig(3);
    d.poses.get(3)!.z = 5;
    d.step(T0, { press: [{ slot: 3 }] });
    d.run(T0 + 1, c + 4);
    d.step(c + 5, { extra: [d.strike(3, 1, { armorBreak: true })] });
    expect(d.cs.get(1)!.action).toBe("Stunned");
    expect(d.cs.get(2)!.action).toBe("Idle");
    d.run(c + 6, rel + 80);
    expect(d.hp(2)).toBe(HP);
    expect(d.launches.length).toBe(0);
    expect(d.cs.captures.size).toBe(0);
  });

  test("death of the captor and of the victim", () => {
    const a = makeRig(2);
    a.step(T0, { press: [{ slot: 3 }] });
    a.run(T0 + 1, c + 10);
    a.cs.kill(1, c + 11);
    a.run(c + 11, rel + 5);
    expect(a.cs.get(2)!.action).toBe("Idle");
    expect(a.hp(2)).toBe(HP);

    const b = makeRig(3);
    b.poses.get(3)!.z = 5;
    b.step(T0, { press: [{ slot: 3 }] });
    b.run(T0 + 1, c + 10);
    b.cs.get(2)!.hp100 = 50;
    b.step(c + 11, { extra: [b.strike(3, 2, { damage100: 900 })] });
    expect(b.cs.get(2)!.action).toBe("Dead");
    expect(b.cs.get(1)!.action).toBe("Recovery");
    expect(b.cs.get(1)!.actionEndTick).toBe(c + 11 + CAPTOR_RELEASE_RECOVERY);
    b.run(c + 12, rel + 100);
    expect(b.launches.length).toBe(0);
    expect(b.runner.scratch<unknown[]>("td.thrown", () => []).length).toBe(0);
  });

  test("capture arbitration and removal", () => {
    const r = makeRig(3);
    r.step(T0, { press: [{ slot: 3, who: 1 }, { slot: 3, who: 3 }] });
    r.run(T0 + 1, rel + 5);
    expect(r.results.filter((x) => x.r.outcome === "captured").map((x) => x.r.candidate.attackerId)).toEqual([1]);
    expect(r.results.filter((x) => x.r.outcome === "captureLost").map((x) => x.r.candidate.attackerId)).toEqual([3]);
    expect(r.dealt(3, 2)).toEqual([]);

    const b = makeRig(2);
    b.step(T0, { press: [{ slot: 3 }] });
    b.run(T0 + 1, c + 5);
    b.cs.remove(2, c + 6);
    expect(b.cs.get(1)!.actionEndTick).toBe(c + 6 + CAPTOR_RELEASE_RECOVERY);
    expect(b.cs.captures.size).toBe(0);
    b.run(c + 6, rel + 50);
  });

  test("collision bonus 3: a wall after the release deals it once; continuous contact and a second wall never repeat it", () => {
    const r = thrown();
    expect(r.hp(2)).toBe(HP - 900);
    r.walls.add(2);
    r.run(rel + 1, rel + 6); // sustained wall contact (and, in the real world, two nearby walls)
    r.walls.delete(2);
    r.run(rel + 7, rel + 8); // a floor-only stretch: wallContact is false
    r.walls.add(2); // a second wall
    r.run(rel + 9, rel + 12);
    expect(r.dealt(1, 2).filter(([, d]) => d === BONUS)).toEqual([[rel + 1, BONUS]]);
    expect(r.hp(2)).toBe(HP - 900 - BONUS);
    const b = r.results.find((x) => x.r.candidate.hitIndex === 90)!;
    expect(b.r.candidate).toMatchObject({ attackerId: 1, targetId: 2, moveId: "td.b3", counterable: false });
  });

  test("acceptance: two nearby walls in the same tick cannot multiply the 3 damage bonus", () => {
    const r = thrown();
    r.walls.add(2); // two wall contacts reported together still make one contact flag per body and tick
    r.step(rel + 1);
    r.step(rel + 2);
    expect(r.hp(2)).toBe(HP - 900 - BONUS);
    expect(r.results.filter((x) => x.r.candidate.hitIndex === 90).length).toBe(1);
  });

  test("no bonus on the floor, none while still captured, none on the release tick", () => {
    const f = thrown();
    f.run(rel + 1, rel + 30); // walls never set: floor contact only
    expect(f.hp(2)).toBe(HP - 900);
    const r = makeRig(4);
    r.poses.get(2)!.grounded = false;
    r.walls.add(2); // touching a wall for the whole cast, including capture and the release tick
    r.step(T0, { press: [{ slot: 3 }] });
    r.run(T0 + 1, rel);
    expect(r.hp(2)).toBe(HP - 900);
    r.step(rel + 1);
    expect(r.hp(2)).toBe(HP - 900 - BONUS);
  });

  test("marker lasts 90 ticks: wall at release+89 counts, release+90 does not", () => {
    for (const [at, expectBonus] of [[89, true], [90, false]] as const) {
      const r = thrown();
      r.run(rel + 1, rel + at - 1);
      r.walls.add(2);
      r.step(rel + at);
      expect(r.hp(2)).toBe(expectBonus ? HP - 900 - BONUS : HP - 900);
    }
  });

  test("a thrown body that lands, is hit again or dies loses the marker", () => {
    const landed = thrown(4, false); // grounded: ragdoll ends after 60 ticks
    landed.run(rel + 1, rel + 70);
    landed.walls.add(2);
    landed.step(rel + 71);
    expect(landed.hp(2)).toBe(HP - 900);

    const hit = thrown();
    hit.step(rel + 2, { extra: [hit.strike(3, 2, { damage100: 100 })] });
    hit.walls.add(2);
    hit.run(rel + 3, rel + 8);
    expect(hit.hp(2)).toBe(HP - 900 - 100);

    const dead = thrown();
    dead.cs.kill(2, rel + 1);
    dead.walls.add(2);
    dead.run(rel + 2, rel + 8);
    expect(dead.results.filter((x) => x.r.candidate.hitIndex === 90).length).toBe(0);

    const captorGone = thrown();
    captorGone.cs.kill(1, rel + 1);
    captorGone.walls.add(2);
    captorGone.run(rel + 2, rel + 8);
    expect(captorGone.hp(2)).toBe(HP - 900);
  });

  test("thrown victim hits one other living player for 5 (B, stun 18, noncounterable) and takes the bonus once", () => {
    const r = thrown();
    r.poses.get(4)!.x = 0.5; r.poses.get(4)!.z = -1.5; // in contact with the thrown body
    r.cs.get(4)!.counterOpenUntil = rel + 100; // an open counter cannot intercept it
    r.step(rel + 3);
    const ofThrow = r.results.filter((x) => x.tick === rel + 3);
    expect(ofThrow.map((x) => [x.r.candidate.attackerId, x.r.candidate.targetId, x.r.outcome, x.r.damage100])).toEqual([[1, 2, "hit", 300], [2, 4, "hit", 500]]);
    expect(r.hp(4)).toBe(HP - 500);
    expect(r.hp(2)).toBe(HP - 900 - BONUS);
    expect(r.cs.get(4)!.action).toBe("Stunned");
    expect(r.cs.get(4)!.actionEndTick - r.cs.get(4)!.actionStartTick).toBe(18);
    // Marker spent: further player contact and a later wall deal nothing more.
    r.poses.get(3)!.x = 0.4; r.poses.get(3)!.z = -1.5;
    r.walls.add(2);
    r.run(rel + 4, rel + 30);
    expect(r.hp(4)).toBe(HP - 500);
    expect(r.hp(3)).toBe(HP);
    expect(r.hp(2)).toBe(HP - 900 - BONUS);
    expect(r.runner.scratch<unknown[]>("td.thrown", () => []).length).toBe(0);
  });

  test("a thrown-body player hit is blockable; the first player collision also costs the thrown victim 3", () => {
    const r = thrown();
    r.poses.get(4)!.facingYaw = Math.PI / 2; // faces -X, toward the thrown body once it stands next to it
    r.run(rel + 1, rel + 4, () => ({ guard: [4] })); // guard is up (3 tick startup) before the contact
    r.poses.get(4)!.x = 0.5; r.poses.get(4)!.z = -1.5;
    r.run(rel + 5, rel + 9, () => ({ guard: [4] }));
    const mine = r.results.filter((x) => x.r.candidate.attackerId === 2);
    expect(mine.map((x) => x.r.outcome)).toEqual(["blocked"]);
    expect(r.hp(4)).toBe(HP);
    expect(r.hp(2)).toBe(HP - 900 - BONUS);
  });

  test("the captor and dead players are never collision targets; player first then wall gives the bonus once", () => {
    const a = thrown();
    a.poses.get(1)!.x = 0.4; a.poses.get(1)!.z = -1.5;
    a.run(rel + 1, rel + 5);
    expect(a.hp(1)).toBe(HP);
    expect(a.hp(2)).toBe(HP - 900);
    a.cs.kill(4, rel + 6);
    a.poses.get(4)!.x = 0.4; a.poses.get(4)!.z = -1.5;
    a.run(rel + 6, rel + 10);
    expect(a.cs.get(4)!.hp100).toBe(0);
    expect(a.results.filter((x) => x.r.candidate.attackerId === 2).length).toBe(0);

    const b = thrown();
    b.poses.get(3)!.x = 0.5; b.poses.get(3)!.z = -1.5;
    b.step(rel + 1);
    b.walls.add(2);
    b.run(rel + 2, rel + 10);
    expect(b.hp(2)).toBe(HP - 900 - BONUS);
    expect(b.results.filter((x) => x.r.candidate.hitIndex === 90).length).toBe(1);
  });

  test("real world: MovementSystem reports wall contact for a wall but never for the floor", async () => {
    const world = await World.create();
    const sys = new MovementSystem(world);
    try {
      sys.add(1, [10, 0.92, -3]); // walks into wall.1 (z -0.3..0.3)
      sys.add(2, [0, 0.92, 8]); // stays on open floor
      let wallTick = -1;
      for (let t = 1; t <= 200; t++) {
        sys.step(t, (id) => (id === 1 ? { ...NEUTRAL_MOVE, moveZ: 1 } : NEUTRAL_MOVE));
        if (wallTick < 0 && sys.get(1)!.wallHitTick === t) wallTick = t;
      }
      expect(wallTick).toBeGreaterThan(0);
      expect(sys.get(1)!.wallHitTick).toBe(200); // still pressing into it
      expect(sys.get(2)!.wallHitTick).toBe(-1); // floor contact is not a wall
    } finally { sys.dispose(); world.dispose(); }
  });

  test("two clients see the same result", () => {
    const run = () => { const r = thrown(); r.poses.get(4)!.x = 0.5; r.poses.get(4)!.z = -1.5; r.run(rel + 1, rel + 20); return JSON.stringify([1, 2, 4].map((i) => [r.hp(i), r.cs.get(i)!.action, r.cs.get(i)!.actionEndTick])); };
    expect(run()).toBe(run());
  });
});

describe("td.b4 Mirror Current (counter)", () => {
  /** Caster 1 at the origin, attacker 3 1.5 m ahead facing it, bystander 2 far away. */
  const cRig = (hostOpts: Parameters<typeof makeRig>[1] = {}) => {
    const r = makeRig(3, hostOpts);
    r.poses.get(2)!.x = 8; r.poses.get(2)!.z = 0;
    r.poses.get(3)!.x = 0; r.poses.get(3)!.z = -1.5; r.poses.get(3)!.facingYaw = Math.PI;
    return r;
  };
  const OPEN = (r: Rig) => r.cs.get(1)!.counterOpenUntil;
  const t = T0 + 11; // trigger tick in the real td.b1 scenario below

  test("definition: window 60, startup 0, response [6,16] at [12,30], release R60 F8 U3, noncounterable response", () => {
    const d = def("td.b4");
    expect([d.startup, d.active, d.recovery, d.cooldown]).toEqual([0, 60, 30, 1020]);
    expect(d.hitOffsets).toEqual([12, 30]);
    expect(d.damage100).toEqual([600, 1600]);
    expect(d.ragdollTicks).toBe(60);
    expect(d.launch).toEqual({ forward: 8, up: 3 });
    expect(d.block).toBe("U");
    expect(d.counterable).toBe(false);
  });

  test("window is [commit, commit+60): counters at +0 and +59, not at +60; no armor in recovery", () => {
    const a = cRig();
    a.step(T0, { press: [{ slot: 4 }], extra: [a.strike(3, 1)] });
    expect(a.results[0]!.r.outcome).toBe("countered"); // the commit tick itself is inside the window
    expect(OPEN(a)).toBe(0); // the counter consumed the window

    const b = cRig();
    b.step(T0, { press: [{ slot: 4 }] });
    expect(OPEN(b)).toBe(T0 + 60);
    b.run(T0 + 1, T0 + 58);
    b.step(T0 + 59, { extra: [b.strike(3, 1)] });
    expect(b.results.at(-1)!.r.outcome).toBe("countered");

    const c = cRig();
    c.step(T0, { press: [{ slot: 4 }] });
    c.run(T0 + 1, T0 + 59);
    c.step(T0 + 60, { extra: [c.strike(3, 1)] });
    expect(c.results.at(-1)!.r.outcome).toBe("hit");
    expect(c.cs.get(1)!.action).toBe("Stunned"); // recovery: no armor, no counter
    expect(c.hp(3)).toBe(HP);
  });

  test("hit: a real td.b1 into the stance is countered; attacker captured, 6 at +12 and 16 at +30, release at +31", () => {
    const r = cRig();
    r.step(T0, { press: [{ slot: 4 }] });
    r.step(T0 + 1, { press: [{ slot: 1, who: 3 }] });
    r.run(T0 + 2, t - 1);
    expect(r.cs.get(3)!.action).toBe("Windup");
    r.step(t);
    expect(r.results.map((x) => [x.tick, x.r.candidate.attackerId, x.r.outcome])).toEqual([[t, 3, "countered"]]);
    expect(r.hp(1)).toBe(HP);
    expect(r.cs.get(3)!.action).toBe("Captured");
    expect(r.cs.captures.captureOn(3)!.captorId).toBe(1);
    expect(r.cs.get(1)!.armored).toBe(true);
    r.run(t + 1, t + 30);
    expect(r.dealt(1, 3)).toEqual([[t + 12, 600], [t + 30, 1600]]);
    expect(r.hp(3)).toBe(HP - 2200);
    expect(r.hp(1)).toBe(HP);
    expect(r.cs.get(3)!.action).toBe("Captured");
    r.step(t + 31);
    const v = r.cs.get(3)!;
    expect(v.action).toBe("Ragdolled");
    expect(v.actionEndTick - v.actionStartTick).toBe(60);
    expect(r.launches.map((l) => [l.id, l.vx + 0, l.vy, l.vz, l.tick])).toEqual([[3, 0, 3, -8, t + 31]]);
    expect(r.cs.captures.size).toBe(0);
    expect(r.cs.get(1)!.armored).toBe(false);
    r.run(t + 32, t + 31 + 29);
    expect(r.cs.get(1)!.action).toBe("Recovery");
    r.step(t + 31 + 30);
    expect(r.cs.get(1)!.action).toBe("Idle");
    // The attacker's own b1 never captured anything and its remaining schedule is gone.
    expect(r.dealt(3, 1)).toEqual([]);
  });

  test("response hits are noncounterable and U; a counter never recurses", () => {
    const r = cRig();
    r.step(T0, { press: [{ slot: 4 }] });
    r.step(T0 + 5, { extra: [r.strike(3, 1)] });
    r.cs.get(3)!.counterOpenUntil = T0 + 500; // even if the captured attacker had a counter open
    r.run(T0 + 6, T0 + 5 + 30);
    const resp = r.results.filter((x) => x.r.candidate.attackerId === 1);
    expect(resp.map((x) => x.r.outcome)).toEqual(["hit", "hit"]);
    expect(resp.every((x) => x.r.candidate.counterable === false && x.r.candidate.block === "U")).toBe(true);
    expect(r.results.filter((x) => x.r.outcome === "countered").length).toBe(1);
    expect(r.hp(3)).toBe(HP - 2200);
  });

  test("attacker beyond 4 m (or without line of sight) is absorbed: stance ends, no response damage", () => {
    for (const [dist, occluded, captured] of [[3.99, false, true], [4.01, false, false], [2, true, false]] as const) {
      const r = cRig();
      r.poses.get(3)!.z = -dist;
      r.step(T0, { press: [{ slot: 4 }] });
      r.run(T0 + 1, T0 + 9);
      r.setOccluded(occluded);
      r.step(T0 + 10, { extra: [r.strike(3, 1)] });
      expect(r.results.at(-1)!.r.outcome).toBe("countered");
      expect(r.hp(1)).toBe(HP);
      if (captured) { expect(r.cs.get(3)!.action).toBe("Captured"); continue; }
      expect(r.cs.get(3)!.action).toBe("Idle");
      expect(r.cs.captures.size).toBe(0);
      expect(OPEN(r)).toBe(0);
      r.step(T0 + 11);
      expect(r.cs.get(1)!.action).toBe("Recovery"); // stance ended
      expect(r.cs.get(1)!.armored).toBe(false);
      r.run(T0 + 12, T0 + 60);
      expect(r.hp(3)).toBe(HP);
      expect(r.dealt(1, 3)).toEqual([]);
      expect(r.cs.get(1)!.action).toBe("Idle"); // trigger + 1 + 30 recovery
    }
  });

  test("reflectable projectile: shared reflection rule, stance ends, no automatic melee response; pending real T19", () => {
    const calls: ReflectRequest[] = [];
    const r = cRig({ projectiles: { reflect: (q) => { calls.push(q); return true; } } });
    r.step(T0, { press: [{ slot: 4 }] });
    r.run(T0 + 1, T0 + 9);
    r.step(T0 + 10, { extra: [r.strike(3, 1, { projectile: { id: 7, reflectable: true }, damage100: 1500 })] });
    expect(r.results.at(-1)!.r.outcome).toBe("countered");
    expect(calls).toEqual([{ projectileId: 7, reflectorId: 1, tick: T0 + 10 }]);
    expect(r.hp(1)).toBe(HP);
    expect(r.cs.captures.size).toBe(0);
    expect(OPEN(r)).toBe(0);
    r.run(T0 + 11, T0 + 70);
    expect(r.dealt(1, 3)).toEqual([]);
    // Without a provider the stance still ends cleanly (T19 supplies the real reflection).
    const n = cRig();
    n.step(T0, { press: [{ slot: 4 }] });
    n.step(T0 + 10, { extra: [n.strike(3, 1, { projectile: { id: 8, reflectable: true } })] });
    expect(OPEN(n)).toBe(0);
    n.run(T0 + 11, T0 + 60);
    expect(n.hp(3)).toBe(HP);
  });

  test("a non reflectable projectile is not countered: armor takes the damage, the stance stays open", () => {
    const calls: ReflectRequest[] = [];
    const r = cRig({ projectiles: { reflect: (q) => { calls.push(q); return true; } } });
    r.step(T0, { press: [{ slot: 4 }] });
    r.step(T0 + 10, { extra: [r.strike(3, 1, { projectile: { id: 9, reflectable: false }, damage100: 500 })] });
    expect(r.results.at(-1)!.r.outcome).toBe("hit");
    expect(r.hp(1)).toBe(HP - 500);
    expect(r.cs.get(1)!.action).toBe("Active"); // armor ignored the stun
    expect(OPEN(r)).toBe(T0 + 60);
    expect(calls).toEqual([]);
    r.step(T0 + 11, { extra: [r.strike(3, 1)] });
    expect(r.results.at(-1)!.r.outcome).toBe("countered"); // the stance still counters melee
  });

  test("whiff: the window closes at +60 and the 30 tick recovery is fully vulnerable; cooldown 1020 from the press", () => {
    const r = cRig();
    r.step(T0, { press: [{ slot: 4 }] });
    r.run(T0 + 1, T0 + 59);
    expect(r.cs.get(1)!.action).toBe("Active");
    expect(r.cs.get(1)!.armored).toBe(true);
    r.step(T0 + 60);
    expect(r.cs.get(1)!.action).toBe("Recovery");
    expect(r.cs.get(1)!.armored).toBe(false);
    r.run(T0 + 61, T0 + 89);
    expect(r.cs.get(1)!.action).toBe("Recovery");
    r.step(T0 + 90);
    expect(r.cs.get(1)!.action).toBe("Idle");
    expect(r.results.length).toBe(0);
    r.step(T0 + 1019, { press: [{ slot: 4 }] });
    expect(r.outcomes.at(-1)!.o).toEqual({ kind: "rejected", reason: "COOLDOWN" });
    r.step(T0 + 1020, { press: [{ slot: 4 }] });
    expect(r.outcomes.at(-1)!.o).toMatchObject({ kind: "started", moveId: "td.b4" });
  });

  test("armor, not invulnerability: damage lands, stun does not; armorBreak interrupts and clears the window", () => {
    const a = cRig();
    a.step(T0, { press: [{ slot: 4 }] });
    a.step(T0 + 10, { extra: [a.strike(3, 1, { counterable: false, damage100: 700 })] });
    expect(a.hp(1)).toBe(HP - 700);
    expect(a.cs.get(1)!.action).toBe("Active");
    expect(OPEN(a)).toBe(T0 + 60);

    const b = cRig();
    b.step(T0, { press: [{ slot: 4 }] });
    b.step(T0 + 10, { extra: [b.strike(3, 1, { counterable: false, armorBreak: true }), b.strike(3, 1)] });
    expect(b.cs.get(1)!.action).toBe("Stunned");
    expect(OPEN(b)).toBe(0);
    expect(b.results.map((x) => x.r.outcome)).toEqual(["hit", "hit"]); // the second hit is not countered: the stance is gone
    expect(b.cs.captures.size).toBe(0);
    b.run(T0 + 11, T0 + 40);
    expect(b.runner.castOf(1)).toBeUndefined();
  });

  test("no held button prolongs the window and the stance is never buffered", () => {
    const r = cRig();
    r.step(T0, { press: [{ slot: 4 }] });
    for (let k = 1; k <= 59; k++) r.step(T0 + k, { press: [{ slot: 4 }] }); // mashing the button
    expect(r.outcomes.slice(1).every((x) => x.o.kind === "rejected" && x.o.reason === "STATE")).toBe(true);
    expect(r.runner.bufferedCount).toBe(0);
    expect(OPEN(r)).toBe(T0 + 60);
    r.step(T0 + 60);
    expect(r.cs.get(1)!.action).toBe("Recovery");
    r.step(T0 + 61, { press: [{ slot: 4 }] });
    expect(r.outcomes.at(-1)!.o).toEqual({ kind: "rejected", reason: "STATE" }); // not buffered through recovery
    r.run(T0 + 62, T0 + 100);
    expect(r.cs.get(1)!.action).toBe("Idle");
    expect(r.runner.bufferedCount).toBe(0);
  });

  test("duplicate hit: two phases of one swing in the same tick are countered once", () => {
    const r = cRig();
    r.step(T0, { press: [{ slot: 4 }] });
    r.step(T0 + 5, { extra: [r.strike(3, 1, { castCounter: 777, hitIndex: 0 }), r.strike(3, 1, { castCounter: 777, hitIndex: 1 })] });
    expect(r.results.map((x) => x.r.outcome)).toEqual(["countered", "duplicate"]);
    expect(r.hp(1)).toBe(HP);
    expect(r.cs.captures.size).toBe(1);
    r.run(T0 + 6, T0 + 60);
    expect(r.hp(3)).toBe(HP - 2200);
    expect(r.results.filter((x) => x.r.outcome === "countered").length).toBe(1);
  });

  test("interruption of the response: armor ignores stun, armorBreak releases and stops the damage", () => {
    const a = cRig();
    a.step(T0, { press: [{ slot: 4 }] });
    a.step(T0 + 5, { extra: [a.strike(3, 1)] });
    a.step(T0 + 6, { extra: [a.strike(2, 1, { damage100: 100 })] });
    expect(a.cs.get(1)!.action).toBe("Active");
    a.run(T0 + 7, T0 + 36);
    expect(a.hp(3)).toBe(HP - 2200);

    const b = cRig();
    b.step(T0, { press: [{ slot: 4 }] });
    b.step(T0 + 5, { extra: [b.strike(3, 1)] });
    b.run(T0 + 6, T0 + 16);
    b.step(T0 + 17, { extra: [b.strike(2, 1, { armorBreak: true })] }); // trigger + 12: same tick as the first response hit
    expect(b.cs.get(1)!.action).toBe("Stunned");
    expect(b.cs.get(3)!.action).toBe("Idle");
    expect(b.cs.captures.size).toBe(0);
    b.run(T0 + 18, T0 + 60);
    expect(b.dealt(1, 3)).toEqual([[T0 + 17, 600]]); // attacker id 1 resolves first on the shared tick; the +30 hit never comes
    expect(b.hp(3)).toBe(HP - 600);
  });

  test("death of the caster and of the attacker during the response", () => {
    const a = cRig();
    a.step(T0, { press: [{ slot: 4 }] });
    a.step(T0 + 5, { extra: [a.strike(3, 1)] });
    a.run(T0 + 6, T0 + 15);
    a.cs.kill(1, T0 + 16);
    a.run(T0 + 16, T0 + 60);
    expect(a.cs.get(3)!.action).toBe("Idle");
    expect(a.cs.captures.size).toBe(0);
    expect(a.hp(3)).toBe(HP);

    const b = cRig();
    b.step(T0, { press: [{ slot: 4 }] });
    b.step(T0 + 5, { extra: [b.strike(3, 1)] });
    b.run(T0 + 6, T0 + 15);
    b.cs.get(3)!.hp100 = 50;
    b.step(T0 + 16, { extra: [b.strike(2, 3, { damage100: 300 })] });
    expect(b.cs.get(3)!.action).toBe("Dead");
    expect(b.cs.get(1)!.action).toBe("Recovery");
    expect(b.cs.get(1)!.actionEndTick).toBe(T0 + 16 + CAPTOR_RELEASE_RECOVERY);
    b.run(T0 + 17, T0 + 70);
    expect(b.dealt(1, 3).length).toBe(0);
    expect(b.cs.captures.size).toBe(0);
  });

  test("disconnect: removing the caster or the attacker releases the capture", () => {
    const a = cRig();
    a.step(T0, { press: [{ slot: 4 }] });
    a.step(T0 + 5, { extra: [a.strike(3, 1)] });
    a.run(T0 + 6, T0 + 10);
    a.runner.remove(1);
    a.cs.remove(1, T0 + 11);
    expect(a.cs.get(3)!.action).toBe("Idle");
    expect(a.cs.captures.size).toBe(0);
    const b = cRig();
    b.step(T0, { press: [{ slot: 4 }] });
    b.step(T0 + 5, { extra: [b.strike(3, 1)] });
    b.run(T0 + 6, T0 + 10);
    b.cs.remove(3, T0 + 11);
    expect(b.cs.get(1)!.actionEndTick).toBe(T0 + 11 + CAPTOR_RELEASE_RECOVERY);
    expect(b.cs.captures.size).toBe(0);
    b.run(T0 + 11, T0 + 50);
  });

  test("arbitration: two stances countering the same attacker on the same tick leave one capture owner", () => {
    const r = cRig();
    r.poses.get(2)!.x = 0.3; r.poses.get(2)!.z = 0; // second caster beside the first, attacker in reach of both
    r.step(T0, { press: [{ slot: 4, who: 1 }, { slot: 4, who: 2 }] });
    r.step(T0 + 5, { extra: [r.strike(3, 1), r.strike(3, 2)] });
    expect(r.results.filter((x) => x.r.outcome === "countered").length).toBe(2);
    expect(r.cs.captures.size).toBe(1);
    expect(r.cs.captures.captureOn(3)!.captorId).toBe(1);
    expect(r.cs.get(2)!.counterOpenUntil).toBe(0);
    r.step(T0 + 6);
    expect(r.cs.get(2)!.action).toBe("Recovery"); // the loser was absorbed: stance ended
    r.run(T0 + 7, T0 + 60);
    expect(r.dealt(2, 3)).toEqual([]);
    expect(r.hp(3)).toBe(HP - 2200);
  });

  test("cancel is idempotent: the window and any capture are cleared", () => {
    const r = cRig();
    r.step(T0, { press: [{ slot: 4 }] });
    r.step(T0 + 5, { extra: [r.strike(3, 1)] });
    r.runner.cancel(1);
    r.runner.cancel(1);
    expect(OPEN(r)).toBe(0);
    expect(r.cs.captures.size).toBe(0);
    expect(r.cs.get(3)!.action).toBe("Idle");
  });

  test("two clients see the same result", () => {
    const run = () => { const r = cRig(); r.step(T0, { press: [{ slot: 4 }] }); r.step(T0 + 5, { extra: [r.strike(3, 1)] }); r.run(T0 + 6, T0 + 60); return JSON.stringify([1, 3].map((i) => [r.hp(i), r.cs.get(i)!.action, r.cs.get(i)!.actionEndTick, [...r.cs.get(i)!.cooldowns]])); };
    expect(run()).toBe(run());
  });
});

describe("R02 captured victims stay hit-eligible for third parties (real handlers)", () => {
  test("td.b1 captures B; C casts sv.b2 on B: B takes the flurry, capture continues, release at +43", () => {
    const r = makeRig(3);
    r.cs.get(3)!.kitId = "sv";
    r.step(T0, { press: [{ slot: 1 }] });
    r.run(T0 + 1, T0 + 9);
    const c = T0 + 10;
    r.step(c);
    expect(r.cs.get(2)!.action).toBe("Captured");
    r.step(c + 1, { press: [{ who: 3, slot: 2 }] }); // sv.b2 startup 10: first flurry hit at c + 11
    r.run(c + 2, c + 10);
    expect(r.dealt(3, 2)).toEqual([]);
    r.run(c + 11, c + 12);
    expect(r.dealt(3, 2)[0]).toEqual([c + 11, 200]);
    expect(r.cs.get(2)!.action).toBe("Captured");
    r.run(c + 13, c + 42);
    expect(r.cs.get(2)!.action).toBe("Captured");
    expect(r.dealt(3, 2).length).toBeGreaterThan(1);
    r.step(c + 43);
    expect(r.cs.get(2)!.action).toBe("Ragdolled");
    expect(r.cs.captures.size).toBe(0);
  });

  test("sv.a4 captures B (cinematic); C casts sv.b2: B takes 0 (shielded)", () => {
    const r = makeRig(3);
    r.cs.get(1)!.kitId = "sv";
    r.cs.get(3)!.kitId = "sv";
    const f = r.cs.get(1)!; f.form = "Awakened"; f.awakenedUsedMask = 0;
    r.step(T0, { press: [{ slot: 4 }] });
    r.run(T0 + 1, T0 + 24);
    expect(r.cs.get(2)!.action).toBe("Captured");
    const before = r.hp(2);
    r.step(T0 + 25, { press: [{ who: 3, slot: 2 }] });
    r.run(T0 + 26, T0 + 45);
    expect(r.dealt(3, 2)).toEqual([]);
    expect(r.results.some((x) => x.r.candidate.attackerId === 3 && x.r.candidate.targetId === 2 && x.r.outcome === "shielded")).toBe(true);
    expect(r.hp(2)).toBe(before);
  });

  test("sv.b4 against a captured target: no hit, cooldown still spent", () => {
    const r = makeRig(3);
    r.cs.get(3)!.kitId = "sv";
    r.step(T0, { press: [{ slot: 1 }] });
    r.run(T0 + 1, T0 + 10);
    expect(r.cs.get(2)!.action).toBe("Captured");
    r.step(T0 + 11, { press: [{ who: 3, slot: 4 }] });
    r.run(T0 + 12, T0 + 40);
    expect(r.results.filter((x) => x.r.candidate.attackerId === 3)).toEqual([]);
    expect(r.cs.get(3)!.cooldowns.get("sv.b4") ?? 0).toBeGreaterThan(T0 + 40);
  });
});

export type { Rig, ReflectRequest };
