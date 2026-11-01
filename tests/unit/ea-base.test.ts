import { afterEach, describe, expect, test } from "vitest";
import { EA_DEFS } from "../../packages/shared/src/config/kits/ea.js";
import { applyReaction } from "../../apps/server/src/sim/ActionMachine.js";
import { islandMap, makeEaRig, T0, GROUND_Y, type EaRig } from "../fixtures/eaRig.js";
import { flatMap, makeRig, type Rig } from "../fixtures/projectileRig.js";

/**
 * Ember Artificer base abilities (T20): ea.b1 Cinder Array, ea.b2 Vent Rush, ea.b3 Ember Orb, ea.b4 Furnace Drop.
 * ea.b1, ea.b2 and ea.b4 run on the real Rapier world and MovementSystem (tests/fixtures/eaRig.ts); ea.b3 reuses the T19
 * rig. Every boundary is an exact integer tick. Each ability has miss, block, counter, duplicate hit, interruption, death,
 * expiry, recast, air branch and charge release rows (the last two where the spec card defines them).
 */
const HP = 10000;
let rig: EaRig | null = null;
afterEach(() => { rig?.dispose(); rig = null; });
const make = async (o?: Parameters<typeof makeEaRig>[0]) => { rig = await makeEaRig(o); rig.warm(); return rig; };

describe("ea definitions match the spec 15 table", () => {
  test("four slotted base moves carry the exact numbers", () => {
    expect(EA_DEFS.filter((d) => d.form === "Base").map((d) => d.id)).toEqual(["ea.b1", "ea.b2", "ea.b3", "ea.b4"]);
    const table: Record<string, [number, number, number, number, number, number, string, string]> = {
      "ea.b1": [10, 40, 24, 900, 2100, 2.5, "B", "cinderArray"],
      "ea.b2": [10, 24, 24, 1020, 2500, 1.5, "B", "ventRush"],
      "ea.b3": [6, 1, 24, 1500, 1500, 40, "B", "chargeProjectile"],
      "ea.b4": [18, 48, 30, 1020, 2000, 0, "B", "furnaceDrop"],
    };
    for (const d of EA_DEFS.filter((x) => x.form === "Base")) {
      expect([d.startup, d.active, d.recovery, d.cooldown, d.damage100.reduce((a, b) => a + b, 0), d.range, d.block, d.handler])
        .toEqual(table[d.id]);
      expect([d.form, d.slot]).toEqual(["Base", Number(d.id.slice(-1))]);
    }
    const [b1, b2, b3, b4] = EA_DEFS;
    expect([b1!.hitOffsets, b1!.moveScale, b1!.turnRate, b1!.maxTargets, b1!.input]).toEqual([[0, 8, 16, 24, 32, 39], 0.2, 90, 3, "press"]);
    expect([b2!.input, b2!.shape, b2!.maxHitsPerTarget, b2!.launch, b2!.ragdollTicks]).toEqual(["recast", { kind: "sphere", r: 2.5 }, 1, { forward: 10, up: 3 }, 72]);
    expect([b3!.input, b3!.moveScale, b3!.turnRate, b3!.projectile?.fullDamage100, b3!.projectile?.chip100]).toEqual(["holdRelease", 0.15, 120, 2500, 500]);
    expect([b4!.shape, b4!.ragdollTicks, b4!.launch]).toEqual([{ kind: "sphere", r: 4 }, 84, { forward: 4, up: 10 }]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("ea.b1 Cinder Array", () => {
  const AS = T0 + 10; // activeStart
  const OFFS = [0, 8, 16, 24, 32, 39];

  test("hit: six hits at exact ticks, 2/2/2/2/3/10 HP (21 total), intermediate stun 12, final R72 with launch F3 U9", async () => {
    const r = await make();
    r.step(T0, { press: [{ slot: 1 }] });
    expect(r.outcomes[0]!.o).toMatchObject({ kind: "started", moveId: "ea.b1" });
    expect(r.cs.get(1)!.cooldowns.get("ea.b1")).toBe(T0 + 900);
    r.run(T0 + 1, AS - 1);
    expect(r.hp(2)).toBe(HP);
    expect(r.cs.get(1)!.action).toBe("Windup");
    r.step(AS);
    expect(r.hp(2)).toBe(HP - 200);
    expect(r.cs.get(2)!.action).toBe("Stunned");
    expect(r.cs.get(2)!.actionEndTick).toBe(AS + 12);
    r.run(AS + 1, AS + 45);
    expect(r.dealt(1, 2)).toEqual(OFFS.map((o, i) => [AS + o, [200, 200, 200, 200, 300, 1000][i]!] as const));
    expect(r.hp(2)).toBe(HP - 2100);
    expect(r.cs.get(2)!.action).toBe("Ragdolled");
    expect(r.cs.get(2)!.actionEndTick).toBe(AS + 39 + 72);
    const lastLaunch = r.results.find((x) => x.tick === AS + 39)!.r;
    expect(lastLaunch.candidate.launch).toEqual({ forward: 3, up: 9 });
    expect(r.mv.get(2)!.state.vy).toBeGreaterThan(0); // launched
    // The cast ends at activeEnd + recovery and the fighter returns to Idle.
    r.run(AS + 46, T0 + 10 + 40 + 24);
    expect(r.runner.castOf(1)).toBeUndefined();
    expect(r.cs.get(1)!.action).toBe("Idle");
  });

  test("ragdoll branch: a target already ragdolled at the first hit takes 1/1/1/1/2/7 (13) and keeps its ragdoll", async () => {
    const r = await make();
    applyReaction(r.cs.get(2)!, T0 - 1, { kind: "ragdoll", ticks: 300 }, false);
    r.step(T0, { press: [{ slot: 1 }] });
    r.run(T0 + 1, AS + 45);
    expect(r.dealt(1, 2).map((x) => x[1])).toEqual([100, 100, 100, 100, 200, 700]);
    expect(r.hp(2)).toBe(HP - 1300);
    expect(r.cs.get(2)!.ragdollStartTick).toBeGreaterThan(0);
    expect(r.cs.get(2)!.action).toBe("Ragdolled");
  });

  test("the branch is snapshotted at the first hit, not re-read per tick (both directions)", async () => {
    const r = await make();
    r.step(T0, { press: [{ slot: 1 }] });
    r.run(T0 + 1, AS + 1);
    applyReaction(r.cs.get(2)!, AS + 2, { kind: "ragdoll", ticks: 300 }, false); // ragdolled after the first hit
    r.run(AS + 2, AS + 45);
    expect(r.dealt(1, 2).map((x) => x[1])).toEqual([200, 200, 200, 200, 300, 1000]);
    r.dispose();
    const q = await make();
    applyReaction(q.cs.get(2)!, T0 - 1, { kind: "ragdoll", ticks: 40 }, false); // ragdoll ends mid cast
    q.step(T0, { press: [{ slot: 1 }] });
    q.run(T0 + 1, AS + 45);
    expect(q.dealt(1, 2).map((x) => x[1])).toEqual([100, 100, 100, 100, 200, 700]);
  });

  test("miss: a target outside 2.5 m takes nothing; the cast still spends the cooldown and ends on schedule", async () => {
    const r = await make();
    r.place(2, 0, GROUND_Y, -5);
    r.step(T0, { press: [{ slot: 1 }] });
    r.run(T0 + 1, T0 + 74);
    expect(r.results).toHaveLength(0);
    expect(r.hp(2)).toBe(HP);
    expect(r.cs.get(1)!.action).toBe("Idle");
    expect(r.runner.castOf(1)).toBeUndefined();
    expect(r.cs.get(1)!.cooldowns.get("ea.b1")).toBe(T0 + 900);
  });

  test("max 3 targets, nearest first, the fourth in reach is never hit", async () => {
    const r = await make({ n: 5 });
    r.place(2, 0, GROUND_Y, -1.2); r.place(3, 0.8, GROUND_Y, -1.5); r.place(4, -0.8, GROUND_Y, -1.8); r.place(5, 0, GROUND_Y, -2.4);
    r.step(T0, { press: [{ slot: 1 }] });
    r.run(T0 + 1, AS + 45);
    expect(r.dealt(1, 2)).toHaveLength(6);
    expect(r.dealt(1, 3)).toHaveLength(6);
    expect(r.dealt(1, 4)).toHaveLength(6);
    expect(r.dealt(1, 5)).toHaveLength(0);
  });

  test("block: a frontal guard blocks every hit (B, no chip, blockstun), HP stays full", async () => {
    const r = await make();
    r.run(T0 - 6, T0 - 1, () => ({ guard: [2] }));
    r.step(T0, { press: [{ slot: 1 }], guard: [2] });
    r.run(T0 + 1, AS + 45, () => ({ guard: [2] }));
    const o = r.outcomesOf(2);
    expect(o.filter((x) => x === "blocked")).toHaveLength(6);
    expect(o.includes("hit")).toBe(false);
    expect(r.hp(2)).toBe(HP);
  });

  test("counter: Mirror Current open at the first hit counters it; no damage lands on the countering target", async () => {
    const r = await make();
    r.step(T0 + 8, { press: [{ who: 2, slot: 4 }] }); // stance opens before activeStart and stays open for 60 ticks
    r.step(T0 + 9);
    r.step(T0, { press: [{ slot: 1 }] });
    r.run(T0 + 1, AS - 1);
    expect(r.cs.get(2)!.counterOpenUntil).toBeGreaterThan(AS);
    r.step(AS);
    expect(r.outcomesOf(2)[0]).toBe("countered");
    expect(r.hp(2)).toBe(HP);
    expect(r.cs.get(2)!.counterOpenUntil).toBe(0);
  });

  test("duplicate hit: exactly six hits per target; a seventh candidate of the same cast is a duplicate with no damage", async () => {
    const r = await make();
    r.step(T0, { press: [{ slot: 1 }] });
    r.run(T0 + 1, AS + 40);
    expect(r.dealt(1, 2)).toHaveLength(6);
    const cc = r.cs.get(1)!.castCounter;
    const extra = r.strike(1, 2, { attackerGeneration: r.cs.get(1)!.generation, castCounter: cc, hitIndex: 5, moveId: "ea.b1", maxHitsPerTarget: 6, damage100: 999, counterable: true });
    const before = r.hp(2);
    const res = r.step(AS + 41, { extra: [extra] });
    expect(res.find((x) => x.candidate === extra)!.outcome).toBe("duplicate");
    expect(r.hp(2)).toBe(before);
  });

  test("interruption: a stun on the caster after two hits voids the remaining four", async () => {
    const r = await make();
    r.step(T0, { press: [{ slot: 1 }] });
    r.run(T0 + 1, AS + 11);
    r.step(AS + 12, { extra: [r.strike(3, 1)] });
    expect(r.cs.get(1)!.action).toBe("Stunned");
    r.run(AS + 13, AS + 60);
    expect(r.dealt(1, 2).map((x) => x[0])).toEqual([AS, AS + 8]);
    expect(r.hp(2)).toBe(HP - 400);
    expect(r.runner.castOf(1)).toBeUndefined();
  });

  test("death: a caster killed mid array deals nothing further; a victim killed by a hit is one KO and takes no later hits", async () => {
    const r = await make();
    r.step(T0, { press: [{ slot: 1 }] });
    r.run(T0 + 1, AS + 8);
    r.cs.kill(1, AS + 9);
    r.run(AS + 9, AS + 60);
    expect(r.dealt(1, 2).map((x) => x[0])).toEqual([AS, AS + 8]);
    expect(r.runner.castOf(1)).toBeUndefined();
    r.dispose();
    const q = await make();
    q.cs.get(2)!.hp100 = 350;
    q.step(T0, { press: [{ slot: 1 }] });
    q.run(T0 + 1, AS + 45);
    expect(q.results.filter((x) => x.r.killed)).toHaveLength(1);
    expect(q.hp(2)).toBe(0);
    expect(q.cs.get(2)!.koCount).toBe(1);
    expect(q.dealt(1, 2).reduce((a, b) => a + b[1], 0)).toBe(350);
  });

  test("expiry and cooldown: the cast ends at tick 74, the cooldown holds until 900, then it can be cast again", async () => {
    const r = await make();
    r.place(2, 0, GROUND_Y, -6);
    r.step(T0, { press: [{ slot: 1 }] });
    r.run(T0 + 1, T0 + 73);
    expect(r.cs.get(1)!.action).toBe("Recovery");
    r.step(T0 + 74);
    expect(r.cs.get(1)!.action).toBe("Idle");
    r.step(T0 + 75, { press: [{ slot: 1 }] });
    expect(r.outcomes.at(-1)!.o).toEqual({ kind: "rejected", reason: "COOLDOWN" });
    r.step(T0 + 900, { press: [{ slot: 1 }] });
    expect(r.outcomes.at(-1)!.o).toMatchObject({ kind: "started", moveId: "ea.b1" });
  });

  test("recast: a second press during the cast is buffered by the framework, never a restart or a second array", async () => {
    const r = await make();
    r.step(T0, { press: [{ slot: 1 }] });
    r.step(T0 + 3, { press: [{ slot: 1 }] });
    expect(r.outcomes.at(-1)!.o.kind).toBe("buffered");
    r.run(T0 + 4, AS + 45);
    expect(r.dealt(1, 2)).toHaveLength(6); // one array only
    expect(r.cs.get(1)!.cooldowns.get("ea.b1")).toBe(T0 + 900);
  });

  test("air branch: an airborne caster is held at constant height through the active ticks and falls again afterwards; air targets use the standing table", async () => {
    const r = await make();
    r.place(1, 0, 1.9, 0);
    r.place(2, 0, 1.4, -1.5);
    r.step(T0, { press: [{ slot: 1 }] });
    expect(r.runner.freezesVertical(1, T0)).toBe(false);
    r.run(T0 + 1, AS - 1);
    expect(r.cs.get(1)!.action).toBe("Windup");
    expect(r.mv.get(1)!.state.grounded).toBe(false);
    expect(r.runner.freezesVertical(1, AS)).toBe(true);
    expect(r.runner.freezesVertical(1, AS + 39)).toBe(true);
    expect(r.runner.freezesVertical(1, AS + 40)).toBe(false);
    r.step(AS);
    const y0 = r.pos(1)[1];
    r.run(AS + 1, AS + 39);
    expect(Math.abs(r.pos(1)[1] - y0)).toBeLessThan(1e-6);
    expect(r.dealt(1, 2).length).toBeGreaterThanOrEqual(1);
    expect(r.dealt(1, 2)[0]![1]).toBe(200); // airborne victim: standing table
    r.run(AS + 40, AS + 52);
    expect(r.pos(1)[1]).toBeLessThan(y0 - 0.1);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("ea.b2 Vent Rush", () => {
  const AS = T0 + 10;
  const END = AS + 23; // last travel tick: front blast at travel end

  test("travel: nothing moves before activeStart, then 1/3 m per tick for 24 ticks (8 m), blast at travel end", async () => {
    const r = await make();
    r.place(2, 0, GROUND_Y, -9.5);
    r.step(T0, { press: [{ slot: 2 }] });
    r.run(T0 + 1, AS - 1);
    expect(r.pos(1)[2]).toBeCloseTo(0, 6);
    r.step(AS);
    expect(r.pos(1)[2]).toBeCloseTo(-1 / 3, 2);
    r.step(AS + 1);
    expect(r.pos(1)[2]).toBeCloseTo(-2 / 3, 2);
    r.run(AS + 2, END - 1);
    expect(r.hp(2)).toBe(HP);
    r.step(END);
    expect(r.pos(1)[2]).toBeCloseTo(-8, 1);
    expect(r.dealt(1, 2)).toEqual([[END, 1500]]);
    expect(r.cs.get(2)!.action).toBe("Ragdolled");
    expect(r.cs.get(2)!.actionEndTick).toBe(END + 72);
    expect(r.mv.get(2)!.state.vy).toBeGreaterThan(0); // launched by the definition F10 U3
    r.run(END + 1, END + 24);
    expect(r.cs.get(1)!.action).toBe("Recovery");
    r.step(END + 25);
    expect(r.cs.get(1)!.action).toBe("Idle");
    expect(r.runner.castOf(1)).toBeUndefined();
  });

  test("a ragdolled victim takes 24 HP from the front blast", async () => {
    const r = await make();
    r.place(2, 0, GROUND_Y, -9.5);
    applyReaction(r.cs.get(2)!, T0 - 1, { kind: "ragdoll", ticks: 400 }, false);
    r.step(T0, { press: [{ slot: 2 }] });
    r.run(T0 + 1, END);
    expect(r.dealt(1, 2)).toEqual([[END, 2400]]);
  });

  test("rear blast: a target within 2 m behind at activeStart is reserved and takes 10 HP U (R36) at travel end", async () => {
    const r = await make();
    r.place(2, 0, GROUND_Y, 1.2);
    r.step(T0, { press: [{ slot: 2 }] });
    r.run(T0 + 1, END - 1);
    expect(r.hp(2)).toBe(HP); // nothing before travel end
    r.step(END);
    expect(r.dealt(1, 2)).toEqual([[END, 1000]]);
    expect(r.results[0]!.r.candidate.block).toBe("U");
    expect(r.results[0]!.r.candidate.reaction).toEqual({ kind: "ragdoll", ticks: 36 });
    expect(r.cs.get(2)!.actionEndTick).toBe(END + 36);
  });

  test("a target in both phases takes only the front phase: 15 HP, never 25", async () => {
    const r = await make();
    r.place(2, 0, GROUND_Y, -0.75);
    r.step(T0, { press: [{ slot: 2 }] });
    r.run(T0 + 1, AS + 5);
    r.step(AS + 6, { press: [{ slot: 2 }] }); // recast ends the travel after 2 m
    expect(r.outcomes.at(-1)!.o.kind).toBe("started");
    r.run(AS + 7, AS + 20);
    expect(r.dealt(1, 2)).toEqual([[AS + 6, 1500]]);
    expect(r.results.filter((x) => x.r.candidate.targetId === 2)).toHaveLength(1);
  });

  test("recast: ignored before 6 active ticks (STATE), accepted at the 7th, which ends travel at 2 m and retimes the cast", async () => {
    const r = await make();
    r.place(2, 0, GROUND_Y, -3.6);
    r.step(T0, { press: [{ slot: 2 }] });
    r.step(T0 + 3, { press: [{ slot: 2 }] }); // still in startup
    expect(r.outcomes.at(-1)!.o).toEqual({ kind: "rejected", reason: "STATE" });
    r.run(T0 + 4, AS + 4);
    r.step(AS + 5, { press: [{ slot: 2 }] }); // 5 active ticks have passed: too early
    expect(r.outcomes.at(-1)!.o).toEqual({ kind: "rejected", reason: "STATE" });
    const zBefore = r.pos(1)[2];
    expect(zBefore).toBeCloseTo(-(6 / 3), 1); // ticks AS..AS+4 moved 5 steps, AS+5 moves the 6th
    r.step(AS + 6, { press: [{ slot: 2 }] });
    expect(r.outcomes.at(-1)!.o).toMatchObject({ kind: "started", moveId: "ea.b2" });
    expect(r.pos(1)[2]).toBeCloseTo(-2, 1); // six steps in total
    expect(r.dealt(1, 2)).toEqual([[AS + 6, 1500]]);
    expect(r.runner.castOf(1)!.activeEnd).toBe(AS + 7);
    expect(r.runner.castOf(1)!.endTick).toBe(AS + 7 + 24);
    r.step(AS + 7);
    expect(r.cs.get(1)!.action).toBe("Recovery");
    const z = r.pos(1)[2];
    r.run(AS + 8, AS + 12);
    expect(r.pos(1)[2]).toBeCloseTo(z, 3); // no more travel
    r.step(AS + 8, { press: [{ slot: 2 }] }); // a press in recovery is ignored too
    expect(r.outcomes.at(-1)!.o).toEqual({ kind: "rejected", reason: "STATE" });
    r.run(AS + 13, AS + 40);
    expect(r.cs.get(1)!.action).toBe("Idle");
    expect(r.dealt(1, 2)).toHaveLength(1);
  });

  test("wall stop: travel ends at the wall, the blast fires that tick and the cast retimes early", async () => {
    const r = await make({ extra: [{ id: "w", role: "obstacle", shape: "cuboid", centre: [0, 1.5, -4], halfExtents: [0.5, 1.5, 0.1] }] });
    r.place(2, 1.2, GROUND_Y, -3.0);
    r.step(T0, { press: [{ slot: 2 }] });
    r.run(T0 + 1, AS + 23);
    const z = r.pos(1)[2];
    expect(z).toBeGreaterThan(-3.9);
    expect(z).toBeLessThan(-3.0);
    const blast = r.results.find((x) => x.r.damage100 > 0)!;
    expect(blast.tick).toBeLessThan(AS + 23);
    expect(blast.r.damage100).toBe(1500);
    expect(r.runner.castOf(1)!.activeEnd).toBe(blast.tick + 1);
  });

  test("miss: with nobody in either sphere the travel completes with no damage and no event", async () => {
    const r = await make();
    r.place(2, 0, GROUND_Y, -14);
    r.step(T0, { press: [{ slot: 2 }] });
    r.run(T0 + 1, END + 30);
    expect(r.results).toHaveLength(0);
    expect(r.cs.get(1)!.cooldowns.get("ea.b2")).toBe(T0 + 1020);
    expect(r.cs.get(1)!.action).toBe("Idle");
  });

  test("block: a frontal guard blocks the front blast with chip 6 and blockstun; the rear blast bypasses a guard", async () => {
    const r = await make();
    r.place(2, 0, GROUND_Y, -9.5);
    r.place(3, 0, GROUND_Y, 1.2, 0);
    r.run(T0 - 6, T0 - 1, () => ({ guard: [2, 3] }));
    r.step(T0, { press: [{ slot: 2 }], guard: [2, 3] });
    r.run(T0 + 1, END, () => ({ guard: [2, 3] }));
    expect(r.outcomesOf(2)).toEqual(["blocked"]);
    expect(r.hp(2)).toBe(HP - 600);
    expect(r.outcomesOf(3)).toEqual(["hit"]); // rear is U (victim 3 faces +Z... away from the caster)
    expect(r.hp(3)).toBe(HP - 1000);
  });

  test("counter: Mirror Current open at the travel end counters the front blast", async () => {
    const r = await make();
    r.place(2, 0, GROUND_Y, -9.5);
    r.step(T0, { press: [{ slot: 2 }] });
    r.run(T0 + 1, END - 5);
    r.step(END - 4, { press: [{ who: 2, slot: 4 }] });
    r.run(END - 3, END);
    expect(r.outcomesOf(2)).toEqual(["countered"]);
    expect(r.hp(2)).toBe(HP);
  });

  test("duplicate hit: a target is in one phase only; a repeated front candidate is a duplicate and adds no damage", async () => {
    const r = await make();
    r.place(2, 0, GROUND_Y, -9.5);
    r.step(T0, { press: [{ slot: 2 }] });
    r.run(T0 + 1, END);
    const cc = r.cs.get(1)!.castCounter;
    const dup = r.strike(1, 2, { attackerGeneration: r.cs.get(1)!.generation, castCounter: cc, hitIndex: 1, moveId: "ea.b2", damage100: 1000, counterable: true });
    const res = r.step(END + 1, { extra: [dup] });
    expect(res.find((x) => x.candidate === dup)!.outcome).toBe("duplicate");
    expect(r.hp(2)).toBe(HP - 1500);
  });

  test("interruption: a stun mid travel stops the travel and voids both blasts", async () => {
    const r = await make();
    r.place(2, 0, GROUND_Y, -9.5);
    r.place(3, 0, GROUND_Y, 1.2, 0);
    r.step(T0, { press: [{ slot: 2 }] });
    r.run(T0 + 1, AS + 9);
    r.step(AS + 10, { extra: [r.strike(3, 1)] });
    const z = r.pos(1)[2];
    r.run(AS + 11, AS + 40);
    expect(r.pos(1)[2]).toBeGreaterThan(z - 0.05 - 0.4); // at most the residual knockback, no more rush steps
    expect(r.results.filter((x) => x.r.candidate.moveId === "ea.b2")).toHaveLength(0);
    expect(r.hp(2)).toBe(HP);
    expect(r.hp(3)).toBe(HP);
  });

  test("death: a caster killed mid travel deals nothing; a victim killed by the blast is one KO", async () => {
    const r = await make();
    r.place(2, 0, GROUND_Y, -9.5);
    r.step(T0, { press: [{ slot: 2 }] });
    r.run(T0 + 1, AS + 9);
    r.cs.kill(1, AS + 10);
    r.run(AS + 10, AS + 40);
    expect(r.results).toHaveLength(0);
    r.dispose();
    const q = await make();
    q.place(2, 0, GROUND_Y, -9.5);
    q.cs.get(2)!.hp100 = 900;
    q.step(T0, { press: [{ slot: 2 }] });
    q.run(T0 + 1, END + 5);
    expect(q.results.filter((x) => x.r.killed)).toHaveLength(1);
    expect(q.hp(2)).toBe(0);
  });

  test("expiry: the cast ends at the natural travel end plus 24 recovery ticks; the cooldown is 1020", async () => {
    const r = await make();
    r.place(2, 0, GROUND_Y, -14);
    r.step(T0, { press: [{ slot: 2 }] });
    r.run(T0 + 1, AS + 24 + 23);
    expect(r.cs.get(1)!.action).toBe("Recovery");
    r.step(AS + 24 + 24);
    expect(r.cs.get(1)!.action).toBe("Idle");
    expect(r.runner.castOf(1)).toBeUndefined();
    r.step(T0 + 100, { press: [{ slot: 2 }] });
    expect(r.outcomes.at(-1)!.o).toEqual({ kind: "rejected", reason: "COOLDOWN" });
  });

  test("air branch: an airborne caster tilts the rush by the commit aim elevation, clamped to 45 degrees", async () => {
    const r = await make();
    r.place(1, 0, 6, 0);
    r.pitch.value = -0.5; // looking up 0.5 rad
    r.step(T0, { press: [{ slot: 2 }] });
    r.pitch.value = 1; // later camera motion is not re-read
    r.run(T0 + 1, AS - 1);
    const p0 = r.pos(1);
    r.step(AS);
    const p1 = r.pos(1);
    expect(p1[2] - p0[2]).toBeCloseTo(-(1 / 3) * Math.cos(0.5), 2);
    expect(r.calls.launch.some((l) => l.tick === AS && Math.abs(l.vy - 20 * Math.sin(0.5)) < 1e-9)).toBe(true);
    r.run(AS + 1, END);
    expect(r.pos(1)[1]).toBeGreaterThan(p0[1] + 2); // rose along the aim
    r.dispose();
    const c = await make();
    c.place(1, 0, 6, 0);
    c.pitch.value = -1.4; // 80 degrees up is clamped to 45
    c.step(T0, { press: [{ slot: 2 }] });
    expect(c.calls.launch.length).toBe(0);
    c.run(T0 + 1, AS);
    expect(c.calls.launch.some((l) => l.tick === AS && Math.abs(l.vy - 20 * Math.sin(Math.PI / 4)) < 1e-9)).toBe(true);
  });

  test("air branch: a downward rush ends on floor contact before the 24 ticks run out", async () => {
    const r = await make();
    r.place(1, 0, 3, 0);
    r.place(2, 0, GROUND_Y, -6);
    r.pitch.value = 0.8;
    r.step(T0, { press: [{ slot: 2 }] });
    r.run(T0 + 1, AS + 23);
    expect(r.mv.get(1)!.state.grounded).toBe(true);
    expect(r.runner.castOf(1)!.activeEnd).toBeLessThan(AS + 24);
    expect(r.pos(1)[2]).toBeGreaterThan(-8); // travel stopped short of 8 m
  });

  test("a grounded cast ignores the aim pitch and travels level", async () => {
    const r = await make();
    r.pitch.value = -0.7;
    const y0 = r.pos(1)[1];
    r.step(T0, { press: [{ slot: 2 }] });
    r.run(T0 + 1, AS + 10);
    expect(Math.abs(r.pos(1)[1] - y0)).toBeLessThan(0.02); // level (floor snap jitter only)
    expect(r.calls.launch).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("ea.b4 Furnace Drop", () => {
  const AS = T0 + 18;

  test("grounded cast: rises through startup, descends toward the point 8 m ahead, lands inside the window and detonates: 20 HP R84", async () => {
    const r = await make();
    r.place(2, 0, GROUND_Y, -9);
    r.step(T0, { press: [{ slot: 4 }] });
    expect(r.cs.get(1)!.cooldowns.get("ea.b4")).toBe(T0 + 1020);
    r.run(T0 + 1, AS - 1);
    const rise = r.pos(1)[1] - GROUND_Y;
    expect(rise).toBeGreaterThan(2.4);
    expect(rise).toBeLessThan(3.2);
    expect(r.pos(1)[2]).toBeCloseTo(0, 3); // no horizontal travel while rising
    expect(r.hp(2)).toBe(HP);
    r.run(AS, AS + 47);
    const hit = r.results.find((x) => x.r.damage100 > 0)!;
    expect(hit.tick).toBeGreaterThan(AS + 10);
    expect(hit.tick).toBeLessThan(AS + 48);
    expect(r.dealt(1, 2)).toEqual([[hit.tick, 2000]]);
    expect(r.mv.get(1)!.state.grounded).toBe(true);
    expect(Math.abs(r.pos(1)[2] + 8)).toBeLessThan(0.7);
    expect(r.cs.get(2)!.action).toBe("Ragdolled");
    expect(r.cs.get(2)!.actionEndTick).toBe(hit.tick + 84);
    expect(hit.r.candidate.launch).toBeUndefined(); // definition launch F4 U10
    expect(r.runner.castOf(1)!.activeEnd).toBe(hit.tick + 1);
    r.run(AS + 48, hit.tick + 1 + 30 + 2);
    expect(r.cs.get(1)!.action).toBe("Idle");
  });

  test("radius: a victim 3 m from the landing is hit and one 5.5 m away is not; at most 4 targets, nearest first", async () => {
    const r = await make({ n: 8 });
    r.place(2, 3.0, GROUND_Y, -8);
    r.place(3, -5.5, GROUND_Y, -8);
    r.step(T0, { press: [{ slot: 4 }] });
    r.run(T0 + 1, AS + 47);
    expect(r.dealt(1, 2)).toHaveLength(1);
    expect(r.dealt(1, 3)).toHaveLength(0);
    r.dispose();
    const q = await make({ n: 8 });
    for (let i = 2; i <= 6; i++) q.place(i, 0.3 * i, GROUND_Y, -7.5 - 0.2 * i);
    q.place(7, 6, GROUND_Y, -8);
    q.step(T0, { press: [{ slot: 4 }] });
    q.run(T0 + 1, AS + 47);
    const hit = [2, 3, 4, 5, 6].filter((i) => q.dealt(1, i).length === 1);
    expect(hit).toHaveLength(4);
    expect(q.dealt(1, 7)).toHaveLength(0);
  });

  test("a wall in the way shortens the aim point: the drop lands before the wall", async () => {
    const r = await make({ extra: [{ id: "w", role: "obstacle", shape: "cuboid", centre: [0, 3, -3.5], halfExtents: [4, 3, 0.1] }] });
    r.place(2, 1.0, GROUND_Y, -1.0);
    r.step(T0, { press: [{ slot: 4 }] });
    r.run(T0 + 1, AS + 47);
    expect(r.pos(1)[2]).toBeGreaterThan(-3.4);
    expect(r.dealt(1, 2)).toHaveLength(1);
  });

  test("miss: with nobody in reach the impact deals no damage and the cast completes", async () => {
    const r = await make();
    r.place(2, 15, GROUND_Y, 15);
    r.step(T0, { press: [{ slot: 4 }] });
    r.run(T0 + 1, AS + 47);
    expect(r.results).toHaveLength(0);
    expect(r.mv.get(1)!.state.grounded).toBe(true);
    r.run(AS + 48, AS + 48 + 40);
    expect(r.cs.get(1)!.action).toBe("Idle");
  });

  test("block: a frontal guard blocks the impact (B) with chip 4 and blockstun", async () => {
    const r = await make();
    r.place(2, 0, GROUND_Y, -9); // faces +Z, toward the landing caster
    r.run(T0 - 6, T0 - 1, () => ({ guard: [2] }));
    r.step(T0, { press: [{ slot: 4 }], guard: [2] });
    r.run(T0 + 1, AS + 47, () => ({ guard: [2] }));
    expect(r.outcomesOf(2)).toEqual(["blocked"]);
    expect(r.hp(2)).toBe(HP - 400);
    expect(r.cs.get(2)!.blockstunUntil).toBeGreaterThan(0);
  });

  test("counter: Mirror Current open at the impact counters it", async () => {
    const r = await make();
    r.place(2, 0, GROUND_Y, -9);
    r.step(T0, { press: [{ slot: 4 }] });
    r.run(T0 + 1, AS + 9);
    r.step(AS + 10, { press: [{ who: 2, slot: 4 }] });
    r.run(AS + 11, AS + 47);
    expect(r.outcomesOf(2)).toContain("countered");
    expect(r.hp(2)).toBe(HP);
  });

  test("duplicate hit: one impact per cast; a second candidate for the same victim is a duplicate", async () => {
    const r = await make();
    r.place(2, 0, GROUND_Y, -9);
    r.step(T0, { press: [{ slot: 4 }] });
    r.run(T0 + 1, AS + 47);
    expect(r.dealt(1, 2)).toHaveLength(1);
    const cc = r.cs.get(1)!.castCounter;
    const dup = r.strike(1, 2, { attackerGeneration: r.cs.get(1)!.generation, castCounter: cc, moveId: "ea.b4", damage100: 2000, counterable: true });
    const res = r.step(AS + 48, { extra: [dup] });
    expect(res.find((x) => x.candidate === dup)!.outcome).toBe("duplicate");
    expect(r.hp(2)).toBe(HP - 2000);
  });

  test("interruption: a stun during the rise cancels the drop; gravity returns and no damage lands", async () => {
    const r = await make();
    r.place(2, 0, GROUND_Y, -1.5);
    r.step(T0, { press: [{ slot: 4 }] });
    r.run(T0 + 1, T0 + 7);
    r.step(T0 + 8, { extra: [r.strike(3, 1)] });
    expect(r.cs.get(1)!.action).toBe("Stunned");
    const launchesAtCancel = r.calls.launch.length;
    r.run(T0 + 9, AS + 60);
    expect(r.calls.launch.length).toBe(launchesAtCancel); // the handler wrote nothing after the cancel
    expect(r.results.filter((x) => x.r.candidate.moveId === "ea.b4")).toHaveLength(0);
    expect(r.hp(2)).toBe(HP);
    expect(r.mv.get(1)!.state.grounded).toBe(true); // fell back by normal gravity
  });

  test("interruption during the descent also cancels the impact", async () => {
    const r = await make();
    r.place(2, 0, GROUND_Y, -9);
    r.step(T0, { press: [{ slot: 4 }] });
    r.run(T0 + 1, AS + 4);
    r.step(AS + 5, { extra: [r.strike(3, 1)] });
    r.run(AS + 6, AS + 60);
    expect(r.results.filter((x) => x.r.candidate.moveId === "ea.b4")).toHaveLength(0);
    expect(r.hp(2)).toBe(HP);
  });

  test("death: a caster killed in the air deals nothing; a victim killed by the impact is one KO", async () => {
    const r = await make();
    r.place(2, 0, GROUND_Y, -9);
    r.step(T0, { press: [{ slot: 4 }] });
    r.run(T0 + 1, AS + 3);
    r.cs.kill(1, AS + 4);
    r.run(AS + 4, AS + 60);
    expect(r.results).toHaveLength(0);
    r.dispose();
    const q = await make();
    q.place(2, 0, GROUND_Y, -9);
    q.cs.get(2)!.hp100 = 1500;
    q.step(T0, { press: [{ slot: 4 }] });
    q.run(T0 + 1, AS + 47);
    expect(q.results.filter((x) => x.r.killed)).toHaveLength(1);
    expect(q.hp(2)).toBe(0);
  });

  test("expiry: with no floor under the descent the cast expires into a normal fall without an explosion", async () => {
    const r = await make({ map: islandMap() });
    r.place(1, 0, GROUND_Y, 2, Math.PI); // faces +Z, toward the edge of the 6 m island
    r.place(2, 0, GROUND_Y, 1.5, 0);
    r.step(T0, { press: [{ slot: 4 }] });
    r.run(T0 + 1, AS + 47);
    expect(r.results).toHaveLength(0);
    expect(r.mv.get(1)!.state.grounded).toBe(false);
    expect(r.pos(1)[1]).toBeLessThan(0);
    const last = r.calls.launch.at(-1)!;
    expect(last.tick).toBeLessThanOrEqual(AS + 47); // no velocity writes after the window
    const vy = r.mv.get(1)!.state.vy;
    r.run(AS + 48, AS + 52);
    expect(r.mv.get(1)!.state.vy).toBeLessThan(vy); // plain gravity
    expect(r.cs.get(1)!.action).toBe("Recovery");
  });

  test("recast: a second press during the cast is buffered, never a second drop", async () => {
    const r = await make();
    r.place(2, 15, GROUND_Y, 15);
    r.step(T0, { press: [{ slot: 4 }] });
    r.step(T0 + 4, { press: [{ slot: 4 }] });
    expect(r.outcomes.at(-1)!.o.kind).toBe("buffered");
    r.run(T0 + 5, AS + 47);
    expect(r.cs.get(1)!.cooldowns.get("ea.b4")).toBe(T0 + 1020);
  });

  test("air branch: an aerial start follows the same rise and the same 48 tick cap; from a lower height it lands and detonates", async () => {
    const r = await make();
    r.place(1, 0, 6, 0);
    r.place(2, 0, GROUND_Y, -9);
    r.step(T0, { press: [{ slot: 4 }] });
    r.run(T0 + 1, AS + 47);
    const hit = r.results.find((x) => x.r.damage100 > 0)!;
    expect(hit).toBeDefined();
    expect(hit.tick).toBeLessThan(AS + 48);
    r.dispose();
    const high = await make();
    high.place(1, 0, 40, 0);
    high.place(2, 0, GROUND_Y, -9);
    high.step(T0, { press: [{ slot: 4 }] });
    high.run(T0 + 1, AS + 47);
    expect(high.results).toHaveLength(0); // cap reached in the air: no explosion
    expect(high.mv.get(1)!.state.grounded).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("ea.b3 Ember Orb on the shipped definition", () => {
  const T = 100;
  let pr: Rig | null = null;
  afterEach(() => { pr?.dispose(); pr = null; });
  const mk = async (o?: Parameters<typeof makeRig>[0]) => (pr = await makeRig(o));
  /** Presses slot 3 at T holding it, releases after `held` ticks, runs until `until`. */
  const cast = (r: Rig, held: number, until: number, guard: readonly number[] = []) => {
    r.input.heldSlot = 3;
    r.step(T, { press: [{ id: 1, slot: 3 }], guard });
    for (let t = T + 1; t < T + held; t++) r.step(t, { guard });
    r.input.heldSlot = 0;
    for (let t = T + held; t <= until; t++) r.step(t, { guard });
  };

  test("charge release: 179 held ticks is a partial 15, 180 is a full 25 that bypasses the guard", async () => {
    const a = await mk();
    cast(a, 179, T + 179 + 6 + 40);
    expect(a.hp(2)).toBe(HP - 1500);
    a.dispose();
    const b = await mk();
    cast(b, 180, T + 180 + 6 + 40, [2]);
    expect(b.hp(2)).toBe(HP - 2500);
    expect(b.results.some((x) => x.r.outcome === "blocked")).toBe(false);
  });

  test("miss and expiry: with nobody on the lane the orb flies out and is removed without damage", async () => {
    const r = await mk();
    r.poses.set(2, { x: 30, y: r.GROUND_Y, z: 0, facingYaw: 0, grounded: true });
    cast(r, 30, T + 30 + 6 + 130);
    expect(r.hp(2)).toBe(HP);
    expect(r.ps.size).toBe(0);
    expect(r.spawnedAt).toHaveLength(1);
  });

  test("block: a partial orb on a frontal guard is blocked with chip 5", async () => {
    const r = await mk();
    cast(r, 60, T + 60 + 6 + 40, [2]);
    expect(r.results.some((x) => x.r.outcome === "blocked")).toBe(true);
    expect(r.hp(2)).toBe(HP - 500);
  });

  test("counter: a Duelist Mirror Current reflects the orb and the original owner takes it", async () => {
    const r = await mk();
    r.input.heldSlot = 3;
    r.step(T, { press: [{ id: 1, slot: 3 }] });
    for (let t = T + 1; t < T + 40; t++) r.step(t);
    r.input.heldSlot = 0;
    r.step(T + 40, { press: [{ id: 2, slot: 4 }] });
    for (let t = T + 41; t <= T + 200; t++) r.step(t);
    expect(r.hp(2)).toBe(HP);
    expect(r.hp(1)).toBeLessThan(HP);
  });

  test("duplicate: one orb damages a target once even with splash overlap", async () => {
    const r = await mk();
    cast(r, 30, T + 30 + 6 + 40);
    expect(r.hitsOn(2)).toHaveLength(1);
    expect(r.hp(2)).toBe(HP - 1500);
  });

  test("interruption: a stun during the charge fires nothing and keeps the cooldown", async () => {
    const r = await mk();
    r.input.heldSlot = 3;
    r.step(T, { press: [{ id: 1, slot: 3 }] });
    r.run(T + 1, T + 19);
    applyReaction(r.cs.get(1)!, T + 20, { kind: "stun", ticks: 30 }, false);
    r.input.heldSlot = 0;
    r.run(T + 20, T + 200);
    expect(r.spawnedAt).toEqual([]);
    expect(r.hp(2)).toBe(HP);
    expect(r.cs.get(1)!.cooldowns.get("ea.b3")).toBe(T + 1500);
  });

  test("death: an owner dying while charging fires nothing", async () => {
    const r = await mk();
    r.input.heldSlot = 3;
    r.step(T, { press: [{ id: 1, slot: 3 }] });
    r.run(T + 1, T + 19);
    r.cs.kill(1, T + 20);
    r.input.heldSlot = 0;
    r.run(T + 20, T + 200);
    expect(r.spawnedAt).toEqual([]);
    expect(r.hp(2)).toBe(HP);
  });

  test("recast: a second press while charging is ignored with a STATE reject (hold moves are not recast moves)", async () => {
    const r = await mk();
    r.input.heldSlot = 3;
    r.step(T, { press: [{ id: 1, slot: 3 }] });
    const o = r.runner.skillDown(r.cs.get(1)!, T + 5, 3, 99);
    expect(o.kind).not.toBe("started");
    r.run(T + 6, T + 8);
    expect(r.runner.chargeStartOf(1)).toBe(T);
  });

  test("air branch: an airborne caster is frozen in height while charging and the orb still spawns", async () => {
    const r = await mk();
    r.poses.get(1)!.grounded = false;
    r.input.heldSlot = 3;
    r.step(T, { press: [{ id: 1, slot: 3 }] });
    expect(r.runner.freezesVertical(1, T + 10)).toBe(true);
    r.input.heldSlot = 0;
    r.run(T + 1, T + 6 + 40);
    expect(r.spawnedAt).toHaveLength(1);
    expect(r.runner.freezesVertical(1, T + 200)).toBe(false);
  });

  test("a flat map helper is available for thin cover runs (A19 stays on the T19 rows)", () => {
    expect(flatMap(true).colliders.length).toBeGreaterThan(flatMap(false).colliders.length);
  });
});
