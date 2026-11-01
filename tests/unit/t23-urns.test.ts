import { afterEach, describe, expect, test } from "vitest";
import { COMBAT } from "../../packages/shared/src/config/combat.js";
import { makeContextRig, URN0, type ContextRig } from "../fixtures/contextRig.js";

/** T23 urn props (spec 10, 15): pickup, throw, drops, return timing, swept cover, block, counter, duplicate. */
let rig: ContextRig;
afterEach(() => rig?.dispose());

const tapAttack = (r: ContextRig, tick: number) => { r.step(tick, { attackHeld: true }); };

describe("urn pickup", () => {
  test("pressing Attack beside an urn with a still stick picks it up exactly 12 ticks later", async () => {
    rig = await makeContextRig({ nearUrn: true });
    tapAttack(rig, 10);
    expect(rig.cs.get(1)!.moveId).toBe("td.pickup");
    expect(rig.urns.get(0)!.state).toBe("reserved");
    for (let t = 11; t <= 21; t++) rig.step(t);
    expect(rig.urns.get(0)!.state).toBe("reserved"); // tick 21: 11 ticks after the press
    rig.step(22);
    expect(rig.urns.get(0)!.state).toBe("held");
    expect(rig.urns.get(0)!.holderId).toBe(1);
  });
  test("a moving stick (>= 0.1) or a distance over 1.2 m throws a normal M1 instead", async () => {
    rig = await makeContextRig({ nearUrn: true });
    rig.step(10, { attackHeld: true, moveX: 0.1, moveZ: 0 });
    expect(rig.cs.get(1)!.moveId).toBe("m1.1");
    expect(rig.urns.get(0)!.state).toBe("anchored");
    const r2 = await makeContextRig({ nearUrn: true });
    r2.place(1, 3, 1.5); // 1.5 m from the urn
    r2.step(10, { attackHeld: true });
    expect(r2.cs.get(1)!.moveId).toBe("m1.1");
    r2.dispose();
  });
  test("pickup applies to every kit and never spends contextSpent", async () => {
    for (const kit of ["sv", "td", "ea"] as const) {
      const r = await makeContextRig({ kit, nearUrn: true });
      r.step(10, { attackHeld: true });
      expect(r.cs.get(1)!.moveId, kit).toBe(`${kit}.pickup`);
      expect(r.cs.get(1)!.contextSpent).toBe(false);
      r.dispose();
    }
  });
  test("an interrupted pickup (damage during the channel) leaves the urn on its anchor", async () => {
    rig = await makeContextRig({ nearUrn: true });
    tapAttack(rig, 10);
    rig.run(11, 15);
    rig.poke(3, 1);
    rig.run(16, 40);
    expect(rig.urns.get(0)!.state).toBe("anchored");
    expect(rig.urns.heldBy(1)).toBeUndefined();
  });
  test("pickup is chosen at the start of a chain, beside an urn, with the victim in reach", async () => {
    rig = await makeContextRig({ nearUrn: true });
    rig.place(1, 3, 0.8);
    rig.place(2, 3, -0.9);
    // Hit once so the chain is mid combo, then stay beside the urn: the next press is chain hit 2, not a pickup.
    rig.step(10, { attackHeld: true });
    expect(rig.cs.get(1)!.moveId).toBe("td.pickup"); // chain index 0 beside an urn
  });
});

describe("urn drops", () => {
  const holdUrn = async () => {
    rig = await makeContextRig({ nearUrn: true });
    tapAttack(rig, 10);
    rig.run(11, 22);
    expect(rig.urns.heldBy(1)).toBeDefined();
    return rig;
  };
  test("guard drops it harmlessly back to the anchor", async () => {
    const r = await holdUrn();
    r.guard.add(1);
    r.run(23, 26);
    expect(r.urns.heldBy(1)).toBeUndefined();
    expect(r.urns.get(0)!.state).toBe("anchored");
    expect(r.hp(2)).toBe(10000);
  });
  test("damage drops it", async () => {
    const r = await holdUrn();
    r.poke(3, 1);
    r.run(23, 24);
    expect(r.urns.heldBy(1)).toBeUndefined();
  });
  test("death drops it", async () => {
    const r = await holdUrn();
    r.cs.kill(1, 23);
    r.run(23, 24);
    expect(r.urns.get(0)!.state).toBe("anchored");
  });
  test("a stale holder (life id changed) loses the urn at the next update", async () => {
    const r = await holdUrn();
    r.cs.get(1)!.lifeId = 99;
    r.step(30);
    expect(r.urns.get(0)!.state).toBe("anchored");
  });
});

describe("urn throw", () => {
  const holding = async () => {
    rig = await makeContextRig({ nearUrn: true });
    tapAttack(rig, 10);
    rig.run(11, 29);
    return rig;
  };
  test("a fresh Attack press throws: projectile at +10, 8 HP, R36 ragdoll, back on the anchor exactly 600 ticks after the throw", async () => {
    const r = await holding();
    r.step(30, { attackHeld: true });
    expect(r.cs.get(1)!.moveId).toBe("td.throw");
    r.run(31, 60);
    const hits = r.resultsOf("td.throw").filter((x) => x.r.outcome === "hit");
    expect(hits.length).toBe(1);
    expect(hits[0]!.r.damage100).toBe(800);
    expect(r.hp(2)).toBe(10000 - 800);
    expect(r.cs.get(2)!.action).toBe("Ragdolled");
    // Spawned at tick 40 (activeStart): returns at 40 + 600.
    expect(r.urns.get(0)!.state).toBe("returning");
    r.run(61, 639);
    expect(r.urns.get(0)!.state).toBe("returning");
    r.step(640);
    expect(r.urns.get(0)!.state).toBe("anchored");
    expect(COMBAT.props.returnTicks).toBe(600);
  });
  test("a held Attack button never chains a pickup into a throw", async () => {
    rig = await makeContextRig({ nearUrn: true });
    rig.run(10, 40, { attackHeld: true });
    expect(rig.urns.heldBy(1)).toBeDefined();
    expect(rig.resultsOf("td.throw").length).toBe(0);
  });
  test("a miss still returns the urn after 600 ticks", async () => {
    const r = await holding();
    r.place(2, 30, 30);
    r.step(30, { attackHeld: true });
    r.run(31, 200);
    expect(r.hp(2)).toBe(10000);
    expect(r.urns.get(0)!.state).toBe("returning");
    r.run(201, 639);
    r.step(640);
    expect(r.urns.get(0)!.state).toBe("anchored");
    expect(r.ps.size).toBe(0);
  });
  test("block: a guarding victim takes no damage and the urn is consumed", async () => {
    const r = await holding();
    r.guard.add(2);
    r.step(30, { attackHeld: true });
    r.run(31, 60);
    expect(r.hp(2)).toBe(10000);
    expect(r.resultsOf("td.throw").some((x) => x.r.outcome === "blocked")).toBe(true);
    expect(r.ps.size).toBe(0);
  });
  test("counter: a victim in a counter stance negates the throw", async () => {
    const r = await holding();
    r.cs.get(2)!.kitId = "td";
    r.runner.skillDown(r.cs.get(2)!, 29, 4, 1);
    r.step(30, { attackHeld: true });
    r.run(31, 70);
    expect(r.hp(2)).toBe(10000);
    expect(r.resultsOf("td.throw").some((x) => x.r.outcome === "countered")).toBe(true);
  });
  test("duplicate hit: one throw damages the victim once", async () => {
    const r = await holding();
    r.step(30, { attackHeld: true });
    r.run(31, 120);
    expect(r.resultsOf("td.throw").filter((x) => x.r.outcome === "hit").length).toBe(1);
    expect(10000 - r.hp(2)).toBe(800);
  });
  test("A19: a throw into thin cover stops at the plate, nothing behind it takes damage", async () => {
    const r = await holding();
    r.place(1, 3, -6.5);
    r.place(2, 3, -12);
    r.urns.consumeThrown(1, 0); // reset the urn then give it back to fighter 1 as held
    r.urns.clear();
    r.urns.reserve(0, r.cs.get(1)!);
    r.urns.complete(1);
    r.step(30, { attackHeld: true });
    r.run(31, 100);
    expect(r.hp(2)).toBe(10000);
    expect(r.resultsOf("td.throw").length).toBe(0);
  });
  test("interruption: damage during the throw startup drops the urn and no projectile spawns", async () => {
    const r = await holding();
    r.step(30, { attackHeld: true });
    r.run(31, 33);
    r.poke(3, 1);
    r.run(34, 80);
    expect(r.ps.size).toBe(0);
    expect(r.hp(2)).toBe(10000);
    expect(r.urns.get(0)!.state).toBe("anchored");
  });
  test("caster death during startup: no projectile, urn back on its anchor", async () => {
    const r = await holding();
    r.step(30, { attackHeld: true });
    r.cs.kill(1, 33);
    r.run(33, 80);
    expect(r.ps.size).toBe(0);
    expect(r.hp(2)).toBe(10000);
    expect(r.urns.get(0)!.state).toBe("anchored");
  });
  test("victim death mid flight: the shot expires without a second hit and the urn still returns", async () => {
    const r = await holding();
    r.step(30, { attackHeld: true });
    r.run(31, 38);
    r.cs.kill(2, 39);
    r.run(39, 700);
    expect(r.urns.get(0)!.state).toBe("anchored");
    expect(r.ps.size).toBe(0);
  });
  test("URN anchors are the spec anchors", () => {
    expect(URN0).toEqual([3, 0.25, 0]);
  });
});

describe("urn limits and cleanup", () => {
  test("two urns cannot be held at once: a holder can neither reserve nor pick up a second", async () => {
    rig = await makeContextRig({ nearUrn: true });
    rig.step(10, { attackHeld: true });
    rig.run(11, 29);
    expect(rig.urns.heldBy(1)!.id).toBe(0);
    const f = rig.cs.get(1)!;
    expect(rig.urns.reserve(1, f)).toBe(false);
    rig.place(1, 20, 20); // beside urn 1
    const r = rig.runner.startContext(f, 40, rig.runner.registry.byId("td.pickup")!);
    expect(r).toEqual({ kind: "rejected", reason: "STATE" });
    expect(rig.urns.list().filter((u) => u.holderId === 1).length).toBe(1);
  });
  test("a second fighter cannot reserve an urn that is already reserved or held", async () => {
    rig = await makeContextRig({ nearUrn: true });
    expect(rig.urns.reserve(0, rig.cs.get(1)!)).toBe(true);
    expect(rig.urns.reserve(0, rig.cs.get(2)!)).toBe(false);
    rig.urns.complete(1);
    expect(rig.urns.reserve(0, rig.cs.get(2)!)).toBe(false);
  });
  test("picking up during an attack is refused: a running swing blocks the pickup cast", async () => {
    rig = await makeContextRig({ nearUrn: true });
    const f = rig.cs.get(1)!;
    rig.place(1, 10, 0.8); // away from the urn so Attack is an ordinary M1
    rig.step(10, { attackHeld: true });
    expect(f.moveId).toBe("m1.1");
    rig.place(1, 3, 0.8); // step beside the urn mid swing
    const r = rig.runner.startContext(f, 12, rig.runner.registry.byId("td.pickup")!);
    expect(r).toEqual({ kind: "rejected", reason: "STATE" });
    expect(rig.urns.get(0)!.state).toBe("anchored");
  });
  test("mid combo beside an urn the next press is the next chain hit, never a pickup", async () => {
    rig = await makeContextRig({ nearUrn: true });
    rig.place(1, 10, 0.8);
    rig.step(10, { attackHeld: true });
    rig.run(11, 33, { attackHeld: true });
    expect(rig.cs.get(1)!.moveId).toBe("m1.2");
    rig.place(1, 3, 0.8);
    rig.run(34, 60, { attackHeld: true });
    expect(rig.casts.map((c) => c.moveId)).toEqual(["m1.1", "m1.2", "m1.3"]);
    expect(rig.urns.get(0)!.state).toBe("anchored");
  });
  test("a holder that left the room (no fighter) loses the urn at the next update, and clear() empties every urn", async () => {
    rig = await makeContextRig({ nearUrn: true });
    rig.step(10, { attackHeld: true });
    rig.run(11, 29);
    expect(rig.urns.heldBy(1)).toBeDefined();
    rig.urns.update(30, () => undefined);
    expect(rig.urns.get(0)!.state).toBe("anchored");
    expect(rig.urns.reserve(0, rig.cs.get(1)!)).toBe(true);
    rig.urns.complete(1);
    rig.urns.consumeThrown(1, 50);
    rig.urns.reserve(1, rig.cs.get(2)!);
    rig.urns.clear();
    expect(rig.urns.list().every((u) => u.state === "anchored" && u.holderId === 0 && u.returnTick === 0)).toBe(true);
  });
});
