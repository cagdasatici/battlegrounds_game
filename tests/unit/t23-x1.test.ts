import { afterEach, describe, expect, test } from "vitest";
import { ALL_ABILITY_DEFS } from "../../packages/shared/src/config/kits/index.js";
import { makeContextRig, type ContextRig } from "../fixtures/contextRig.js";
import { awaken, by, toFourth } from "../fixtures/contextHelpers.js";

/** T23.1 sv.x1 Echo Tap (spec 15). */
let rig: ContextRig;
afterEach(() => rig?.dispose());

describe("Vanguard contextual attacks", () => {
  test("definition: sv.x1 takes no slot, 24 HP, R84 F14 U6", () => {
    const d = ALL_ABILITY_DEFS.find((a) => a.id === "sv.x1")!;
    expect([d.input, d.slot, d.damage100, d.ragdollTicks, d.launch, d.startup, d.active, d.recovery]).toEqual(["context", null, [2400], 84, { forward: 14, up: 6 }, 12, 4, 30]);
  });
  test("sv.x1 Echo Tap: grounded fourth M1 with jump held, 24 HP, R84, spends the shared bit, form and slot bits untouched", async () => {
    rig = await makeContextRig({ kit: "sv", victimKit: "td" });
    awaken(rig);
    const t = toFourth(rig, { jumpHeld: true });
    expect(rig.casts[rig.casts.length - 1]!.moveId).toBe("sv.x1");
    expect(rig.cs.get(1)!.contextSpent).toBe(true);
    rig.run(t + 1, t + 60);
    expect(by(rig, "sv.x1", "hit").map((x) => x.r.damage100)).toEqual([2400]);
    expect(rig.cs.get(2)!.action).toBe("Ragdolled");
    const f = rig.cs.get(1)!;
    expect(f.form).toBe("Awakened");
    expect(f.awakenedUsedMask).toBe(0);
  });
  test("one shared use bit: after sv.x1 the next fourth hit is the plain uppercut", async () => {
    rig = await makeContextRig({ kit: "sv", victimKit: "td" });
    awaken(rig);
    const t = toFourth(rig, { jumpHeld: true });
    rig.run(t + 1, t + 80);
    const t2 = rig.holdUntil(t + 81, (id) => id.startsWith("m1.4") || id.startsWith("sv.x"), { jumpHeld: true }, 400);
    expect(t2).toBeGreaterThan(0);
    expect(rig.casts[rig.casts.length - 1]!.moveId).toBe("m1.4.uppercut");
  });
  test("a missed Echo Tap still spends the bit", async () => {
    rig = await makeContextRig({ kit: "sv", victimKit: "td" });
    awaken(rig);
    rig.place(2, 30, 30);
    const t = toFourth(rig, { jumpHeld: true });
    expect(rig.casts[rig.casts.length - 1]!.moveId).toBe("sv.x1");
    rig.run(t + 1, t + 60);
    expect(rig.hp(2)).toBe(10000);
    expect(rig.cs.get(1)!.contextSpent).toBe(true);
  });
  test("without jump held, the awakened fourth hit is the finisher and the bit stays unspent", async () => {
    rig = await makeContextRig({ kit: "sv", victimKit: "td" });
    awaken(rig);
    toFourth(rig);
    expect(rig.casts[rig.casts.length - 1]!.moveId).toBe("m1.4.finisher");
    expect(rig.cs.get(1)!.contextSpent).toBe(false);
  });
  test("Base form Vanguard never gets sv.x1", async () => {
    rig = await makeContextRig({ kit: "sv", victimKit: "td" });
    toFourth(rig, { jumpHeld: true });
    expect(rig.casts[rig.casts.length - 1]!.moveId).toBe("m1.4.uppercut");
  });
});
