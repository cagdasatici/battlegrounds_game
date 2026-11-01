import type { KitId } from "../../packages/shared/src/protocol.js";
import { describe, expect, test } from "vitest";
import { buildAbilityRegistry, defineAbility, type AbilitySpec } from "../../packages/shared/src/abilities.js";
import { meterFraction, meterRequired100 } from "../../packages/shared/src/awakening.js";
import { applyReaction, enterCaptured } from "../../apps/server/src/sim/ActionMachine.js";
import { CombatSystem } from "../../apps/server/src/sim/Combat.js";
import { AbilityRunner, MELEE_HANDLER, type AbilityHost, type AbilityPose } from "../../apps/server/src/sim/AbilityRunner.js";
import { AwakeningSystem } from "../../apps/server/src/sim/Awakening.js";
import type { HitCandidate, HitResult } from "../../apps/server/src/sim/HitResolver.js";

const T0 = 1000;
const base = (id: string, o: Partial<AbilitySpec> = {}): AbilitySpec => ({
  id, label: "Test", handler: "melee", startup: 4, active: 2, recovery: 6, cooldown: 0, damage100: [1000], range: 2, block: "B", ...o,
});

/** Entity 1 (kit sv unless told) at the origin facing -Z; targets 2, 3, 4, 5 around it, all unprotected. */
function rig(kit = "sv", targets = 1, specs: AbilitySpec[] = [base("sv.b1"), base("td.b1"), base("td.a1", { recovery: 200, active: 100 })]) {
  const cs = new CombatSystem();
  const poses = new Map<number, AbilityPose>();
  for (let i = 1; i <= 1 + targets; i++) cs.add(i, i, 0, i === 1 ? (kit as KitId) : "sv").protectedUntilTick = 0;
  poses.set(1, { x: 0, y: 1, z: 0, facingYaw: 0, grounded: true });
  for (let i = 2; i <= 1 + targets; i++) poses.set(i, { x: 0, y: 1, z: -1.5 - (i - 2) * 0.1, facingYaw: Math.PI, grounded: true });
  let occluded = false;
  const host: AbilityHost = { combat: cs, pose: (id) => poses.get(id), blocked: () => occluded };
  const registry = buildAbilityRegistry(specs.map(defineAbility), new Set(["melee"]));
  const runner = new AbilityRunner(registry, [MELEE_HANDLER], host);
  const aw = new AwakeningSystem(host);
  const results: { tick: number; r: HitResult }[] = [];
  const step = (tick: number, extra: HitCandidate[] = []) => {
    cs.expire(tick, (id) => poses.get(id)!.grounded);
    aw.update(tick);
    const cands = [...runner.collect(tick), ...aw.collect(tick), ...extra];
    const res = cs.resolve(tick, cands, (id) => poses.get(id));
    runner.afterResolve(tick, res);
    aw.gain(res);
    for (const r of res) results.push({ tick, r });
    return res;
  };
  const cast = (tick: number, slot: 1 | 2 | 3 | 4 = 1) => runner.skillDown(cs.get(1)!, tick, slot, 1);
  return { cs, poses, runner, aw, results, step, cast, setOccluded: (v: boolean) => { occluded = v; } };
}

const strike = (attackerId: number, targetId: number, damage100: number, o: Partial<HitCandidate> = {}, gen = 0): HitCandidate => ({
  attackerId, attackerGeneration: gen, castCounter: 99, hitIndex: 0, toi: 0, targetId, moveId: "x.hit", originX: 0, originZ: 0,
  block: "U", counterable: false, armorBreak: false, damage100, reaction: { kind: "none" }, maxHitsPerTarget: 1, ...o,
});

describe("meter thresholds", () => {
  test("sv 20000, others 35000; HUD fraction is threshold normalised", () => {
    expect(meterRequired100("sv")).toBe(20000);
    expect(meterRequired100("td")).toBe(35000);
    expect(meterFraction("sv", 10000)).toBe(0.5);
    expect(meterFraction("td", 35000)).toBe(1);
    expect(meterFraction("td", 99999)).toBe(1);
  });
});

describe("damage based meter", () => {
  test("gains exactly the HP removed (hundredths) from a real hit", () => {
    const r = rig();
    r.cast(T0);
    for (let t = T0; t < T0 + 12; t++) r.step(t);
    expect(r.cs.get(2)!.hp100).toBe(9000);
    expect(r.cs.get(1)!.meter100).toBe(1000);
  });

  test("overkill is not counted: only the HP actually removed", () => {
    const r = rig();
    r.cs.get(2)!.hp100 = 300;
    r.cast(T0);
    for (let t = T0; t < T0 + 12; t++) r.step(t);
    expect(r.cs.get(2)!.hp100).toBe(0);
    expect(r.cs.get(1)!.meter100).toBe(300);
  });

  test("blocked and countered hits build no meter", () => {
    const b = rig();
    b.cs.updateGuard(2, T0 - 10, true, true);
    b.cs.updateGuard(2, T0 - 5, true, true);
    b.cast(T0);
    for (let t = T0; t < T0 + 12; t++) { b.cs.updateGuard(2, t, true, true); b.step(t); }
    expect(b.results.some((x) => x.r.outcome === "blocked")).toBe(true);
    expect(b.cs.get(1)!.meter100).toBe(0);
    const c = rig();
    c.cs.get(2)!.counterOpenUntil = T0 + 100;
    c.cast(T0);
    for (let t = T0; t < T0 + 12; t++) c.step(t);
    expect(c.results.some((x) => x.r.outcome === "countered")).toBe(true);
    expect(c.cs.get(1)!.meter100).toBe(0);
  });

  test("self damage and practice damage build no meter", () => {
    const r = rig();
    r.step(T0, [strike(1, 1, 500, {}, r.cs.get(1)!.generation)]);
    expect(r.cs.get(1)!.meter100).toBe(0);
    r.aw.meterEnabled = false;
    r.step(T0 + 1, [strike(1, 2, 500, {}, r.cs.get(1)!.generation)]);
    expect(r.cs.get(1)!.meter100).toBe(0);
    expect(r.cs.get(2)!.hp100).toBe(9500);
  });

  test("meter caps at the threshold and is not gained while Awakened", () => {
    const r = rig();
    const f = r.cs.get(1)!;
    f.meter100 = 19500;
    r.step(T0, [strike(1, 2, 3000, {}, f.generation)]);
    expect(f.meter100).toBe(20000);
    f.form = "Awakened";
    f.meter100 = 0;
    r.step(T0 + 1, [strike(1, 2, 3000, {}, f.generation)]);
    expect(f.meter100).toBe(0);
  });

  test("a stale attacker (interrupted earlier in the tick) gains nothing", () => {
    const r = rig();
    const f = r.cs.get(1)!;
    const gen = f.generation;
    applyReaction(f, T0, { kind: "stun", ticks: 20 }, false);
    r.step(T0, [strike(1, 2, 500, {}, gen)]);
    expect(f.meter100).toBe(0);
  });
});

describe("Stone Vanguard activation (sv.activate)", () => {
  test("rejects below full meter; never touches state", () => {
    const r = rig();
    r.cs.get(1)!.meter100 = 19999;
    expect(r.aw.request(r.cs.get(1)!, T0)).toEqual({ kind: "rejected", reason: "METER" });
    expect(r.cs.get(1)!.action).toBe("Idle");
  });

  test("30 tick activation with armor, no invulnerability, then form Awakened, meter 0, bits reset, no timer, no heal", () => {
    const r = rig();
    const f = r.cs.get(1)!;
    f.meter100 = 20000; f.awakenedUsedMask = 0b1010; f.contextSpent = true; f.hp100 = 6000;
    const o = r.aw.request(f, T0);
    expect(o).toMatchObject({ kind: "started", moveId: "sv.activate" });
    expect(f.action).toBe("Awakening");
    expect(f.armored).toBe(true);
    for (let t = T0; t < T0 + 30; t++) {
      r.step(t);
      expect(f.action, `+${t - T0}`).toBe("Awakening");
      expect(f.form).toBe("Base");
      expect(f.invulnerableUntil).toBe(0);
    }
    r.step(T0 + 30);
    expect(f.action).toBe("Idle");
    expect(f.form).toBe("Awakened");
    expect(f.meter100).toBe(0);
    expect(f.awakenedUsedMask).toBe(0);
    expect(f.contextSpent).toBe(false);
    expect(f.formEndTick).toBe(0);
    expect(f.hp100).toBe(6000);
    expect(f.armored).toBe(false);
    for (let t = T0 + 31; t < T0 + 5000; t += 250) r.step(t);
    expect(f.form).toBe("Awakened"); // no time expiry
  });

  test("meter is not gained during activation or while Awakened", () => {
    const r = rig();
    const f = r.cs.get(1)!;
    f.meter100 = 20000;
    r.aw.request(f, T0);
    r.step(T0 + 5, [strike(1, 2, 500, {}, f.generation)]);
    expect(f.meter100).toBe(20000);
  });

  test("requires grounded, unprotected, Idle and Base; kits without an activation are INVALID; never buffered", () => {
    const r = rig();
    const f = r.cs.get(1)!;
    f.meter100 = 20000;
    r.poses.get(1)!.grounded = false;
    expect(r.aw.request(f, T0)).toEqual({ kind: "rejected", reason: "STATE" });
    r.poses.get(1)!.grounded = true;
    f.protectedUntilTick = T0 + 10;
    expect(r.aw.request(f, T0)).toEqual({ kind: "rejected", reason: "STATE" });
    f.protectedUntilTick = 0;
    r.cast(T0, 1);
    expect(r.aw.request(f, T0 + 1)).toEqual({ kind: "rejected", reason: "STATE" }); // mid cast
    expect(r.runner.bufferedCount).toBe(0);
    for (let t = T0 + 1; t < T0 + 20; t++) r.step(t);
    expect(r.aw.activeCount).toBe(0);
    f.kitId = "zz" as never;
    expect(r.aw.request(f, T0 + 20)).toEqual({ kind: "rejected", reason: "INVALID" });
    f.kitId = "sv";
    f.form = "Awakened";
    expect(r.aw.request(f, T0 + 20)).toEqual({ kind: "rejected", reason: "FORM" });
  });

  test("an accepted activation ends spawn protection", () => {
    const r = rig();
    const f = r.cs.get(1)!;
    f.meter100 = 20000;
    f.protectedUntilTick = T0; // already over at T0 (exclusive)
    expect(r.aw.request(f, T0).kind).toBe("started");
    expect(f.protectedUntilTick).toBeLessThanOrEqual(T0);
  });

  test("non-armorBreak hits damage but do not interrupt; armorBreak interrupts and keeps the meter", () => {
    for (const armorBreak of [false, true]) {
      const r = rig();
      const f = r.cs.get(1)!;
      f.meter100 = 20000;
      r.aw.request(f, T0);
      r.step(T0 + 3, [strike(2, 1, 400, { armorBreak, reaction: { kind: "stun", ticks: 24 } }, r.cs.get(2)!.generation)]);
      expect(f.hp100).toBe(9600);
      if (armorBreak) {
        r.step(T0 + 4);
        expect(f.action).toBe("Stunned");
        expect(f.form).toBe("Base");
        expect(f.meter100).toBe(20000);
        expect(f.armored).toBe(false);
        expect(r.aw.activeCount).toBe(0);
        for (let t = T0 + 5; t < T0 + 40; t++) r.step(t);
        expect(f.form).toBe("Base");
      } else {
        expect(f.action).toBe("Awakening");
        for (let t = T0 + 4; t <= T0 + 30; t++) r.step(t);
        expect(f.form).toBe("Awakened");
      }
    }
  });

  test("capture during activation cancels it and keeps the meter", () => {
    const r = rig();
    const f = r.cs.get(1)!;
    f.meter100 = 20000;
    r.aw.request(f, T0);
    enterCaptured(f, T0 + 2, "td.b1");
    r.step(T0 + 3);
    expect(f.form).toBe("Base");
    expect(f.meter100).toBe(20000);
    expect(r.aw.activeCount).toBe(0);
  });

  test("death during activation drops it: single KO, meter 0, no form", () => {
    const r = rig();
    const f = r.cs.get(1)!;
    f.meter100 = 20000;
    r.aw.request(f, T0);
    r.cs.kill(1, T0 + 5);
    r.aw.reset(1);
    for (let t = T0 + 5; t < T0 + 50; t++) r.step(t);
    expect(f.form).toBe("Base");
    expect(f.meter100).toBe(0);
    expect(f.koCount).toBe(1);
    expect(r.aw.activeCount).toBe(0);
  });

  test("death consumes the form and resets meter; respawn starts Base with zero meter", () => {
    const r = rig();
    const f = r.cs.get(1)!;
    f.form = "Awakened"; f.meter100 = 12345; f.awakenedUsedMask = 3; f.formEndTick = T0 + 99;
    r.cs.kill(1, T0);
    expect([f.form, f.meter100, f.awakenedUsedMask, f.formEndTick]).toEqual(["Base", 0, 0, 0]);
    r.cs.respawn(1, T0 + 180, 9);
    expect([f.form, f.meter100, f.contextSpent]).toEqual(["Base", 0, false]);
  });
});

describe("Tide Duelist activation (td.activate, Ocean Surge)", () => {
  const tdRig = (targets = 1) => { const r = rig("td", targets); r.cs.get(1)!.meter100 = 35000; return r; };

  test("60 ticks; invulnerable exactly ticks 48 to 59; completion at +60", () => {
    const r = tdRig();
    const f = r.cs.get(1)!;
    expect(r.aw.request(f, T0).kind).toBe("started");
    const hitAt = (rel: number, expectLands: boolean) => {
      const hp = f.hp100;
      r.step(T0 + rel, [strike(2, 1, 100, {}, r.cs.get(2)!.generation)]);
      expect(f.hp100 < hp, `+${rel}`).toBe(expectLands);
    };
    for (let rel = 0; rel < 47; rel++) r.step(T0 + rel);
    hitAt(47, true);
    r.cs.get(2)!.protectedUntilTick = 0;
    r.step(T0 + 48);
    for (const rel of [49, 55, 59]) hitAt(rel, false);
    expect(f.form).toBe("Base");
    r.step(T0 + 60);
    expect(f.form).toBe("Awakened");
    hitAt(61, true);
  });

  test("burst at +48: 20 HP, U, armorBreak ragdoll, noncounterable, max 4 targets, nearest first; caster gains no meter", () => {
    const r = tdRig(5);
    for (let i = 2; i <= 6; i++) r.cs.get(i)!.counterOpenUntil = T0 + 500; // counters cannot intercept a noncounterable burst
    const f = r.cs.get(1)!;
    r.poses.get(6)!.z = -3; // farthest of five
    r.aw.request(f, T0);
    for (let rel = 0; rel < 48; rel++) r.step(T0 + rel);
    expect(r.cs.get(2)!.hp100).toBe(10000);
    r.step(T0 + 48);
    const hurt = [2, 3, 4, 5, 6].filter((i) => r.cs.get(i)!.hp100 === 8000);
    expect(hurt).toEqual([2, 3, 4, 5]);
    expect(r.cs.get(6)!.hp100).toBe(10000);
    for (const i of hurt) expect(r.cs.get(i)!.action).toBe("Ragdolled");
    expect(f.meter100).toBe(35000); // unchanged: no meter during activation
    const hits = r.results.filter((x) => x.r.outcome === "hit");
    expect(hits.length).toBe(4);
    r.step(T0 + 49); // exclusive single tick: no second burst
    expect(r.cs.get(2)!.hp100).toBe(8000);
  });

  test("R05: a wall between Ocean Surge and a target inside 5 m: no damage", () => {
    const r = tdRig(1);
    r.setOccluded(true);
    r.aw.request(r.cs.get(1)!, T0, "td");
    for (let rel = 0; rel <= 48; rel++) r.step(T0 + rel);
    expect(r.cs.get(2)!.hp100).toBe(10000);
    expect(r.results.filter((x) => x.r.candidate.moveId === "td.activate").length).toBe(0);
  });

  test("burst reaches targets only inside 5 m and ignores the dead", () => {
    const r = tdRig(2);
    r.poses.get(2)!.z = -5.3; // edge is 5 m radius + 0.35 capsule radius = 5.35
    r.poses.get(3)!.z = -5.4;
    r.aw.request(r.cs.get(1)!, T0);
    for (let rel = 0; rel <= 48; rel++) r.step(T0 + rel);
    expect(r.cs.get(2)!.hp100).toBe(8000);
    expect(r.cs.get(3)!.hp100).toBe(10000);
  });

  test("heal 40 HP once at completion, capped at 100; form lasts exactly 2940 ticks from completion", () => {
    const r = tdRig();
    const f = r.cs.get(1)!;
    f.hp100 = 5000;
    r.aw.request(f, T0);
    for (let rel = 0; rel < 60; rel++) r.step(T0 + rel);
    expect(f.hp100).toBe(5000);
    r.step(T0 + 60);
    expect(f.hp100).toBe(9000);
    expect(f.formEndTick).toBe(T0 + 60 + 2940);
    r.step(T0 + 61);
    expect(f.hp100).toBe(9000); // once
    r.step(T0 + 60 + 2939);
    expect(f.form).toBe("Awakened");
    r.step(T0 + 60 + 2940);
    expect(f.form).toBe("Base");
    expect(f.formEndTick).toBe(0);
    const g = tdRig();
    g.cs.get(1)!.hp100 = 9000;
    g.aw.request(g.cs.get(1)!, T0);
    for (let rel = 0; rel <= 60; rel++) g.step(T0 + rel);
    expect(g.cs.get(1)!.hp100).toBe(10000);
  });

  test("a new awakening resets only awakened use bits, not base cooldowns", () => {
    const r = tdRig();
    const f = r.cs.get(1)!;
    f.cooldowns.set("td.b1", T0 + 9999);
    f.awakenedUsedMask = 0b100;
    r.aw.request(f, T0);
    for (let rel = 0; rel <= 60; rel++) r.step(T0 + rel);
    expect(f.awakenedUsedMask).toBe(0);
    expect(f.cooldowns.get("td.b1")).toBe(T0 + 9999);
  });
});

describe("A14 form expires while a capture is active", () => {
  test("the committed awakened cast finishes, the capture ends normally, no new awakened cast starts, nothing is left protected", () => {
    const r = rig("td", 1);
    const f = r.cs.get(1)!, v = r.cs.get(2)!;
    f.form = "Awakened";
    f.formEndTick = T0 + 20;
    expect(r.cast(T0, 1)).toMatchObject({ kind: "started", moveId: "td.a1" });
    r.step(T0);
    const cap = r.cs.captures.tryCapture({
      victimId: 2, captorId: 1, captorGeneration: f.generation, castCounter: f.castCounter, moveId: "td.a1",
      cinematic: true, startTick: T0 + 4, endTick: T0 + 80,
    });
    expect(cap).not.toBeNull();
    enterCaptured(v, T0 + 4, "td.a1");
    f.invulnerableUntil = T0 + 40;
    for (let t = T0 + 1; t < T0 + 20; t++) r.step(t);
    r.step(T0 + 20); // form expires here
    expect(f.form).toBe("Base");
    expect(f.cast?.moveId).toBe("td.a1"); // committed cast is still running
    expect(r.runner.castOf(1)?.def.id).toBe("td.a1");
    expect(r.cs.captures.isCaptured(2)).toBe(true); // capture untouched by the expiry
    // New awakened cast cannot start: slot 1 resolves to the base move once the current cast allows it.
    f.cooldowns.clear();
    const o = r.runner.skillDown(f, T0 + 21, 1, 7);
    expect(o).toEqual({ kind: "buffered" });
    r.cs.releaseFinal(2, T0 + 60);
    for (let t = T0 + 21; t < T0 + 400; t++) r.step(t);
    expect(r.runner.castOf(1)?.def.id).not.toBe("td.a1");
    expect(f.form).toBe("Base");
    expect(r.cs.captures.size).toBe(0);
    expect(f.armored).toBe(false);
    expect(f.invulnerableUntil).toBeLessThanOrEqual(T0 + 400);
    expect(v.action).not.toBe("Captured");
    expect(r.cs.invariantViolations()).toEqual([]);
  });
});

describe("cleanup", () => {
  test("remove and dispose leave no activation or kit state", () => {
    const r = rig();
    r.cs.get(1)!.meter100 = 20000;
    r.aw.request(r.cs.get(1)!, T0);
    expect(r.aw.activeCount).toBe(1);
    r.aw.remove(1);
    expect(r.aw.activeCount).toBe(0);
    r.aw.dispose();
    expect(r.aw.activeCount).toBe(0);
  });
});
