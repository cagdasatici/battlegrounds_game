import { describe, expect, test } from "vitest";
import { COMBAT } from "../../packages/shared/src/config/combat.js";
import {
  CAPTOR_RELEASE_RECOVERY, RAGDOLL_GET_UP_TICKS, applyReaction, beginCast, classifyDash, expire, type Fighter,
} from "../../apps/server/src/sim/ActionMachine.js";
import { CombatSystem } from "../../apps/server/src/sim/Combat.js";
import { isFrontal, type HitCandidate, type Pose } from "../../apps/server/src/sim/HitResolver.js";

const T0 = 1000; // well past spawn protection after unprotect()

function setup(n = 3): { cs: CombatSystem; f: Fighter[]; poses: Map<number, Pose> } {
  const cs = new CombatSystem();
  const f: Fighter[] = [];
  const poses = new Map<number, Pose>();
  for (let i = 1; i <= n; i++) {
    const x = cs.add(i, i, 0);
    x.protectedUntilTick = 0;
    f.push(x);
    poses.set(i, { x: 0, z: 0, facingYaw: 0, grounded: true });
  }
  return { cs, f, poses };
}

const hit = (o: Partial<HitCandidate> & { attackerId: number; targetId: number }, cs: CombatSystem): HitCandidate => ({
  attackerGeneration: cs.get(o.attackerId)!.generation, castCounter: cs.get(o.attackerId)!.castCounter, hitIndex: 0, toi: 0,
  moveId: "test.hit", originX: 0, originZ: -1, block: "B", counterable: true, armorBreak: false, damage100: 300,
  reaction: { kind: "stun", ticks: 24 }, maxHitsPerTarget: 1, ...o,
});
/** Impact origin at `deg` degrees from the target's forward (-Z) on a unit circle. */
const at = (deg: number) => ({ originX: Math.sin((deg * Math.PI) / 180), originZ: -Math.cos((deg * Math.PI) / 180) });

function guardUp(cs: CombatSystem, id: number, tick: number): number {
  cs.updateGuard(id, tick, true, true);
  return tick + COMBAT.guard.startup; // guard is live from here
}

describe("A04 guard cone", () => {
  test("B blocks at 59 and 60 degrees, hits at 61; U always bypasses", () => {
    for (const [deg, block, expected] of [[59, "B", "blocked"], [60, "B", "blocked"], [61, "B", "hit"],
      [0, "U", "hit"], [59, "U", "hit"], [60, "U", "hit"]] as const) {
      const { cs, poses } = setup(2);
      const t = guardUp(cs, 2, T0);
      const [r] = cs.resolve(t, [hit({ attackerId: 1, targetId: 2, block, ...at(deg) }, cs)], (id) => poses.get(id));
      expect(r!.outcome, `${deg} ${block}`).toBe(expected);
      if (expected === "blocked") {
        expect(cs.get(2)!.hp100).toBe(10000); // zero chip
        expect(cs.get(2)!.action).toBe("Guard");
        expect(cs.get(2)!.blockstunUntil).toBe(t + COMBAT.guard.blockstun);
      } else expect(cs.get(2)!.hp100).toBe(9700);
    }
  });
  test("pure cone check matches spec; zero length vector is frontal; mirror side symmetric", () => {
    expect(isFrontal(0, 0, 0, 0, 0)).toBe(true);
    expect(isFrontal(0, 0, 0, -at(60).originX, at(60).originZ)).toBe(true);
    expect(isFrontal(0, 0, 0, -at(61).originX, at(61).originZ)).toBe(false);
    expect(isFrontal(0, 0, 0, 0, 1)).toBe(false); // behind
  });
  test("guard is not live during its 3 startup ticks and needs ground; release has 3 tick recovery", () => {
    const { cs, poses } = setup(2);
    cs.updateGuard(2, T0, true, true);
    const [r] = cs.resolve(T0 + 2, [hit({ attackerId: 1, targetId: 2 }, cs)], (id) => poses.get(id));
    expect(r!.outcome).toBe("hit");
    const b = setup(2);
    b.cs.updateGuard(2, T0, true, false);
    expect(b.cs.get(2)!.action).toBe("Idle");
    b.cs.updateGuard(2, T0, true, true);
    b.cs.updateGuard(2, T0 + 10, false, true);
    expect(b.cs.get(2)!.action).toBe("Recovery");
    b.cs.expire(T0 + 12, () => true);
    expect(b.cs.get(2)!.action).toBe("Recovery");
    b.cs.expire(T0 + 13, () => true);
    expect(b.cs.get(2)!.action).toBe("Idle");
  });
  test("blockstun holds guard after release until it ends", () => {
    const { cs, poses } = setup(2);
    const t = guardUp(cs, 2, T0);
    cs.resolve(t, [hit({ attackerId: 1, targetId: 2 }, cs)], (id) => poses.get(id));
    cs.updateGuard(2, t + 1, false, true);
    expect(cs.get(2)!.action).toBe("Guard");
    cs.updateGuard(2, t + 6, false, true);
    expect(cs.get(2)!.action).toBe("Recovery");
  });
});

describe("A05 dash buckets", () => {
  test("only the first of two forward requests one tick apart; side shares a bucket independent of forward", () => {
    const { cs } = setup(1);
    expect(cs.requestDash(1, T0, 0, 0, 0)).toMatchObject({ ok: true }); // stationary defaults forward
    expect(cs.get(1)!.moveId).toBe("dash.forward");
    expect(cs.requestDash(1, T0 + 1, 0, 0, 0)).toEqual({ ok: false, reason: "STATE" });
    let t = T0 + COMBAT.dash.forward.ticks;
    cs.expire(t, () => true);
    expect(cs.get(1)!.action).toBe("Idle");
    expect(cs.requestDash(1, t, 0, 0, -1)).toEqual({ ok: false, reason: "COOLDOWN" }); // forward still cooling
    expect(cs.requestDash(1, t, 0, -1, 0)).toMatchObject({ ok: true }); // left: independent of forward
    expect(cs.get(1)!.moveId).toBe("dash.side");
    t += COMBAT.dash.side.ticks;
    cs.expire(t, () => true);
    expect(cs.requestDash(1, t, 0, 1, 0)).toEqual({ ok: false, reason: "COOLDOWN" }); // right shares side bucket
    expect(cs.requestDash(1, t, 0, 0, 1)).toMatchObject({ ok: true }); // back has its own bucket
    t += COMBAT.dash.back.ticks;
    cs.expire(t, () => true);
    const sideReady = T0 + COMBAT.dash.forward.ticks + COMBAT.dash.side.cooldown;
    expect(cs.requestDash(1, sideReady - 1, 0, 1, 0)).toEqual({ ok: false, reason: "COOLDOWN" });
    expect(cs.requestDash(1, sideReady, 0, 1, 0)).toMatchObject({ ok: true });
  });
  test("classification uses larger forward/right component relative to facing; ties choose forward/back", () => {
    expect(classifyDash(0, 0.7, -0.7).kind).toBe("forward"); // tie
    expect(classifyDash(0, 0.8, -0.6).kind).toBe("side");
    expect(classifyDash(0, 0.6, 0.8).kind).toBe("back");
    expect(classifyDash(Math.PI / 2, -1, 0).kind).toBe("forward"); // yaw 90 deg faces -X
    const d = classifyDash(0, 0.6, -0.8);
    expect(Math.hypot(d.dirX, d.dirZ)).toBeCloseTo(1, 12); // keeps diagonal direction
    expect(d.dirX).toBeCloseTo(0.6, 12);
  });
  test("dash is rejected while stunned, guarding, captured or dead; respawn resets cooldowns", () => {
    const { cs, f } = setup(1);
    applyReaction(f[0]!, T0, { kind: "stun", ticks: 24 }, false);
    expect(cs.requestDash(1, T0, 0, 0, 0)).toEqual({ ok: false, reason: "STATE" });
    cs.expire(T0 + 24, () => true);
    cs.updateGuard(1, T0 + 24, true, true);
    expect(cs.requestDash(1, T0 + 25, 0, 0, 0)).toEqual({ ok: false, reason: "STATE" });
    cs.updateGuard(1, T0 + 26, false, true); cs.expire(T0 + 29, () => true);
    expect(cs.requestDash(1, T0 + 29, 0, 0, 0)).toMatchObject({ ok: true });
    cs.kill(1, T0 + 30);
    expect(cs.requestDash(1, T0 + 31, 0, 0, 0)).toEqual({ ok: false, reason: "STATE" });
    cs.respawn(1, T0 + 300, 9);
    expect(cs.get(1)!.cooldowns.size).toBe(0);
  });
});

describe("A06 evasive", () => {
  test("rejected at ragdoll age 11, accepted at 12; landing bonus cleared; invulnerable first 8 ticks", () => {
    const { cs, f, poses } = setup(2);
    applyReaction(f[0]!, T0, { kind: "ragdoll", ticks: 72 }, true);
    expect(f[0]!.landingBonus).toBe(true);
    expect(cs.requestDash(1, T0 + 11, 0, 0, 0)).toEqual({ ok: false, reason: "STATE" });
    expect(cs.requestDash(1, T0 + 12, 0, 0, 0)).toMatchObject({ ok: true });
    expect(f[0]!.action).toBe("Dash");
    expect(f[0]!.moveId).toBe("evasive");
    expect(f[0]!.landingBonus).toBe(false);
    expect(f[0]!.dash!.dirX).toBeCloseTo(1, 12); // stationary evasive uses facing right
    const [r1] = cs.resolve(T0 + 19, [hit({ attackerId: 2, targetId: 1 }, cs)], (id) => poses.get(id));
    expect(r1!.outcome).toBe("invulnerable");
    const [r2] = cs.resolve(T0 + 20, [hit({ attackerId: 2, targetId: 1, castCounter: 5 }, cs)], (id) => poses.get(id));
    expect(r2!.outcome).toBe("hit");
  });
  test("evasive on cooldown is rejected even at legal ragdoll age", () => {
    const { cs, f } = setup(1);
    applyReaction(f[0]!, T0, { kind: "ragdoll", ticks: 72 }, false);
    expect(cs.requestDash(1, T0 + 12, 0, 0, 0)).toMatchObject({ ok: true });
    cs.expire(T0 + 24, () => true);
    applyReaction(f[0]!, T0 + 30, { kind: "ragdoll", ticks: 72 }, false);
    expect(cs.requestDash(1, T0 + 60, 0, 0, 0)).toEqual({ ok: false, reason: "COOLDOWN" });
    expect(cs.requestDash(1, T0 + 12 + COMBAT.evasive.cooldown - 1, 0, 0, 0)).toEqual({ ok: false, reason: "COOLDOWN" });
  });
  test("ragdoll expiry: airborne remains ragdolled; grounded gets 12 tick recovery then Idle", () => {
    const { cs, f } = setup(1);
    applyReaction(f[0]!, T0, { kind: "ragdoll", ticks: 72 }, true);
    cs.expire(T0 + 72, () => false);
    expect(f[0]!.action).toBe("Ragdolled");
    cs.expire(T0 + 80, () => true);
    expect(f[0]!.action).toBe("Recovery");
    cs.expire(T0 + 80 + RAGDOLL_GET_UP_TICKS - 1, () => true);
    expect(f[0]!.action).toBe("Recovery");
    cs.expire(T0 + 80 + RAGDOLL_GET_UP_TICKS, () => true);
    expect(f[0]!.action).toBe("Idle");
  });
});

describe("A08 capture arbitration", () => {
  const cap = (attackerId: number, cs: CombatSystem, o: Partial<HitCandidate> = {}) =>
    hit({ attackerId, targetId: 3, block: "U", damage100: 400, capture: { cinematic: false, maxTicks: 90 }, ...o }, cs);
  test("two attackers same tick: stable order picks one regardless of submission order; loser deals nothing", () => {
    for (const order of [[1, 2], [2, 1]]) {
      const { cs, poses } = setup(3);
      const rs = cs.resolve(T0, order.map((a) => cap(a, cs)), (id) => poses.get(id));
      const byA = new Map(rs.map((r) => [r.candidate.attackerId, r]));
      expect(byA.get(1)!.outcome).toBe("captured");
      expect(byA.get(2)!.outcome).toBe("captureLost");
      expect(byA.get(2)!.damage100).toBe(0);
      expect(cs.get(3)!.hp100).toBe(9600); // exactly one capture's damage
      expect(cs.captures.captureOn(3)!.captorId).toBe(1);
      expect(cs.ledger.count(2, cs.get(2)!.castCounter, 3, 3)).toBe(0);
      expect(cs.invariantViolations()).toEqual([]);
    }
  });
  test("earlier time of impact wins over lower entity id", () => {
    const { cs, poses } = setup(3);
    cs.resolve(T0, [cap(1, cs, { toi: 0.5 }), cap(2, cs, { toi: 0.25 })], (id) => poses.get(id));
    expect(cs.captures.captureOn(3)!.captorId).toBe(2);
  });
  test("default capture: immune to third party capture, not to ordinary third party damage", () => {
    const { cs, poses } = setup(3);
    cs.resolve(T0, [cap(1, cs)], (id) => poses.get(id));
    const [lost] = cs.resolve(T0 + 1, [cap(2, cs, { castCounter: 7 })], (id) => poses.get(id));
    expect(lost!.outcome).toBe("captureLost");
    const [dmg] = cs.resolve(T0 + 2, [hit({ attackerId: 2, targetId: 3, castCounter: 8 }, cs)], (id) => poses.get(id));
    expect(dmg!.outcome).toBe("hit");
    expect(cs.get(3)!.action).toBe("Captured"); // no reaction while captured
  });
  test("cinematic capture shields both participants from third parties; owner damage still lands", () => {
    const { cs, poses } = setup(3);
    cs.resolve(T0, [cap(1, cs, { capture: { cinematic: true, maxTicks: 96 } })], (id) => poses.get(id));
    const rs = cs.resolve(T0 + 1, [hit({ attackerId: 2, targetId: 3, castCounter: 8 }, cs),
      hit({ attackerId: 2, targetId: 1, castCounter: 8, hitIndex: 1 }, cs),
      hit({ attackerId: 1, targetId: 3, block: "U", hitIndex: 1, maxHitsPerTarget: 2 }, cs)], (id) => poses.get(id));
    expect(rs.map((r) => [r.candidate.attackerId, r.candidate.targetId, r.outcome])).toEqual([
      [1, 3, "hit"], [2, 3, "shielded"], [2, 1, "shielded"]]); // sorted: attacker 1 first
  });
});

describe("hit resolution matrix", () => {
  test("miss: no candidate leaves state unchanged; duplicate hit in the same cast is dropped", () => {
    const { cs, poses } = setup(2);
    expect(cs.resolve(T0, [], (id) => poses.get(id))).toEqual([]);
    expect(cs.get(2)!.hp100).toBe(10000);
    const c = hit({ attackerId: 1, targetId: 2, reaction: { kind: "none" } }, cs);
    const rs = cs.resolve(T0, [c, { ...c }], (id) => poses.get(id));
    expect(rs.map((r) => r.outcome)).toEqual(["hit", "duplicate"]);
    expect(cs.resolve(T0 + 1, [c], (id) => poses.get(id))[0]!.outcome).toBe("duplicate");
    expect(cs.get(2)!.hp100).toBe(9700);
  });
  test("counter consumes a counterable hit during its open interval; noncounterable passes", () => {
    const { cs, f, poses } = setup(2);
    f[1]!.counterOpenUntil = T0 + 10;
    expect(cs.resolve(T0 + 9, [hit({ attackerId: 1, targetId: 2, counterable: false }, cs)], (id) => poses.get(id))[0]!.outcome).toBe("hit");
    cs.expire(T0 + 40, () => true);
    const a = setup(2);
    a.f[1]!.counterOpenUntil = T0 + 10;
    expect(a.cs.resolve(T0 + 9, [hit({ attackerId: 1, targetId: 2 }, a.cs)], (id) => a.poses.get(id))[0]!.outcome).toBe("countered");
    expect(a.cs.get(2)!.hp100).toBe(10000);
    const b = setup(2);
    b.f[1]!.counterOpenUntil = T0 + 10;
    expect(b.cs.resolve(T0 + 10, [hit({ attackerId: 1, targetId: 2 }, b.cs)], (id) => b.poses.get(id))[0]!.outcome).toBe("hit"); // exclusive deadline
  });
  test("interruption: an attacker hit earlier in the tick loses its later hit; cast generation invalidated", () => {
    const { cs, f, poses } = setup(2);
    expect(beginCast(f[1]!, T0 - 8, "sv.b1", 8, 3, 10, 600)).toMatchObject({ ok: true });
    cs.expire(T0, () => true);
    expect(f[1]!.action).toBe("Active");
    const late = hit({ attackerId: 2, targetId: 1, toi: 0.9 }, cs);
    const rs = cs.resolve(T0, [late, hit({ attackerId: 1, targetId: 2, toi: 0.1 }, cs)], (id) => poses.get(id));
    expect(rs.map((r) => r.outcome)).toEqual(["hit", "staleAttacker"]);
    expect(f[1]!.action).toBe("Stunned");
    expect(f[1]!.cast).toBeNull();
    expect(f[1]!.cooldowns.get("sv.b1")).toBe(T0 - 8 + 600); // cooldown retained after interruption
  });
  test("armor takes damage but ignores stun unless armorBreak; protection blocks dealing and receiving", () => {
    const { cs, f, poses } = setup(2);
    f[1]!.armored = true;
    cs.resolve(T0, [hit({ attackerId: 1, targetId: 2 }, cs)], (id) => poses.get(id));
    expect(f[1]!.hp100).toBe(9700); expect(f[1]!.action).toBe("Idle");
    cs.resolve(T0, [hit({ attackerId: 1, targetId: 2, castCounter: 2, armorBreak: true }, cs)], (id) => poses.get(id));
    expect(f[1]!.action).toBe("Stunned");
    const p = setup(2);
    p.f[0]!.protectedUntilTick = T0 + 1;
    expect(p.cs.resolve(T0, [hit({ attackerId: 1, targetId: 2 }, p.cs)], (id) => p.poses.get(id))[0]!.outcome).toBe("protected");
    expect(p.cs.resolve(T0, [hit({ attackerId: 2, targetId: 1 }, p.cs)], (id) => p.poses.get(id))[0]!.outcome).toBe("protected");
    // Forward dash is offensive: it cancels the dasher's protection.
    p.cs.requestDash(1, T0, 0, 0, 0);
    expect(p.f[0]!.protectedUntilTick).toBe(T0);
  });
  test("death: lethal hit plus another hit the same tick gives one KO and no negative HP", () => {
    const { cs, f, poses } = setup(3);
    f[2]!.hp100 = 250;
    const rs = cs.resolve(T0, [hit({ attackerId: 1, targetId: 3 }, cs), hit({ attackerId: 2, targetId: 3 }, cs)], (id) => poses.get(id));
    expect(rs.map((r) => [r.outcome, r.damage100, r.killed])).toEqual([["hit", 250, true], ["deadTarget", 0, false]]);
    expect(f[2]!.hp100).toBe(0); expect(f[2]!.koCount).toBe(1); expect(f[2]!.action).toBe("Dead");
    expect(cs.kill(3, T0 + 1)).toBe(false);
    expect(cs.invariantViolations()).toEqual([]);
  });
  test("cast phases use exclusive integer deadlines: Windup -> Active -> Recovery -> Idle", () => {
    const { f } = setup(1);
    beginCast(f[0]!, 100, "sv.b2", 8, 3, 10, 60);
    const seen: string[] = [];
    for (let t = 100; t <= 122; t++) { expire(f[0]!, t, true); seen.push(f[0]!.action); }
    expect(seen.indexOf("Active")).toBe(8);
    expect(seen.indexOf("Recovery")).toBe(11);
    expect(seen.indexOf("Idle")).toBe(21);
    expect(beginCast(f[0]!, 122, "sv.b2", 8, 3, 10, 60)).toEqual({ ok: false, reason: "COOLDOWN" });
  });
});

describe("no orphan captures", () => {
  const capture = (cs: CombatSystem, poses: Map<number, Pose>, a = 1, v = 2, maxTicks = 90) =>
    cs.resolve(T0, [hit({ attackerId: a, targetId: v, block: "U", damage100: 0, capture: { cinematic: false, maxTicks } }, cs)], (id) => poses.get(id));
  test("victim death releases captor into 18 ticks recovery", () => {
    const { cs, f, poses } = setup(2);
    capture(cs, poses);
    cs.kill(2, T0 + 5);
    expect(cs.captures.size).toBe(0);
    expect(f[0]!.action).toBe("Recovery");
    expect(f[0]!.actionEndTick).toBe(T0 + 5 + CAPTOR_RELEASE_RECOVERY);
    expect(cs.invariantViolations()).toEqual([]);
  });
  test("victim departure and captor departure both clean up", () => {
    const a = setup(2);
    capture(a.cs, a.poses);
    a.cs.remove(2, T0 + 1);
    expect(a.cs.captures.size).toBe(0);
    expect(a.f[0]!.action).toBe("Recovery");
    const b = setup(2);
    capture(b.cs, b.poses);
    b.cs.remove(1, T0 + 1);
    expect(b.cs.captures.size).toBe(0);
    expect(b.f[1]!.action).toBe("Idle");
    expect(b.cs.invariantViolations()).toEqual([]);
  });
  test("captor death frees the victim; captor interrupted by a third party loses the capture the same tick", () => {
    const a = setup(2);
    capture(a.cs, a.poses);
    a.cs.kill(1, T0 + 1);
    expect(a.f[1]!.action).toBe("Idle");
    expect(a.cs.invariantViolations()).toEqual([]);
    const b = setup(3);
    capture(b.cs, b.poses);
    b.cs.resolve(T0 + 2, [hit({ attackerId: 3, targetId: 1 }, b.cs)], (id) => b.poses.get(id));
    expect(b.cs.captures.size).toBe(0);
    expect(b.f[1]!.action).toBe("Idle");
    expect(b.cs.invariantViolations()).toEqual([]);
  });
  test("expiry releases at the exclusive deadline; final release; dispose clears", () => {
    const { cs, f, poses } = setup(3);
    capture(cs, poses, 1, 2, 10);
    cs.expire(T0 + 9, () => true);
    expect(cs.captures.size).toBe(1);
    cs.expire(T0 + 10, () => true);
    expect(cs.captures.size).toBe(0);
    expect(f[1]!.action).toBe("Idle");
    capture(cs, poses, 1, 3, 90);
    expect(cs.releaseFinal(3, T0 + 3)!.cause).toBe("final");
    expect(cs.releaseFinal(3, T0 + 3)).toBeNull();
    capture(cs, poses, 1, 2, 90);
    cs.dispose();
    expect(cs.captures.size).toBe(0); expect(cs.ledger.size).toBe(0); expect(cs.size).toBe(0);
  });
  test("deterministic random fuzz keeps every invariant each tick", () => {
    let seed = 12345;
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return Math.floor(seed / 65536) % n; };
    const { cs, poses } = setup(4);
    let life = 10;
    const seen = new Set<string>();
    for (let t = T0; t < T0 + 4000; t++) {
      cs.expire(t, (id) => (id + t) % 5 !== 0);
      const cands: HitCandidate[] = [];
      for (let k = 0; k < rnd(4); k++) {
        const a = 1 + rnd(4), v = 1 + rnd(4);
        if (!cs.get(a) || !cs.get(v)) continue;
        const f = cs.get(a)!;
        if (f.action === "Idle" && rnd(3) === 0) beginCast(f, t, `m${rnd(3)}`, 0, 5, 5, 0);
        cands.push(hit({ attackerId: a, targetId: v, toi: rnd(4) / 4, hitIndex: rnd(3), damage100: rnd(900), block: rnd(2) ? "B" : "U",
          reaction: rnd(2) ? { kind: "stun", ticks: 1 + rnd(30) } : { kind: "ragdoll", ticks: 1 + rnd(80) },
          capture: rnd(3) === 0 ? { cinematic: rnd(2) === 0, maxTicks: 1 + rnd(120) } : undefined }, cs));
      }
      for (const r of cs.resolve(t, cands, (id) => poses.get(id))) seen.add(r.outcome);
      const op = rnd(60);
      const id = 1 + rnd(4);
      if (op === 0) cs.kill(id, t);
      else if (op === 1) cs.remove(id, t);
      else if (op === 2 && !cs.get(id)) { const nf = cs.add(id, ++life, t); nf.protectedUntilTick = 0; }
      else if (op === 3 && cs.get(id)?.action === "Dead") { cs.respawn(id, t, ++life); cs.get(id)!.protectedUntilTick = 0; }
      else if (op === 4) cs.requestDash(id, t, 0, rnd(3) - 1, rnd(3) - 1);
      else if (op >= 6 && op < 30) cs.updateGuard(id, t, op < 20, true);
      else if (op === 5) { const c = cs.captures.all()[0]; if (c) cs.releaseFinal(c.victimId, t); }
      expect(cs.invariantViolations(), `tick ${t}`).toEqual([]);
    }
    for (const o of ["hit", "blocked", "captured", "captureLost", "duplicate", "staleAttacker", "deadTarget"]) expect(seen, o).toContain(o);
  });
});
