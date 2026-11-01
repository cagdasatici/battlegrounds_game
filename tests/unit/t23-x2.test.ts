import { afterEach, describe, expect, test } from "vitest";
import { ALL_ABILITY_DEFS } from "../../packages/shared/src/config/kits/index.js";
import { makeContextRig, type ContextRig } from "../fixtures/contextRig.js";
import { awaken, by, toFourth } from "../fixtures/contextHelpers.js";

/** T23.2 sv.x2 Gale Rebuff (spec 15). */
let rig: ContextRig;
afterEach(() => rig?.dispose());

describe("Vanguard contextual attacks", () => {
  test("definition: sv.x2 takes no slot, 40 HP at +48, R90 F18 U3, startup 12, recovery 24", () => {
    const d = ALL_ABILITY_DEFS.find((a) => a.id === "sv.x2")!;
    expect([d.input, d.slot, d.damage100, d.hitOffsets, d.ragdollTicks, d.launch, d.startup, d.recovery]).toEqual(["context", null, [0, 4000], [0, 48], 90, { forward: 18, up: 3 }, 12, 24]);
  });
  test("sv.x2 Gale Rebuff replaces the wall attack and beats sv.x1: capture, 40 HP at +48, release +49 with R90", async () => {
    rig = await makeContextRig({ kit: "sv", victimKit: "td" });
    awaken(rig);
    rig.atWall();
    const t = toFourth(rig, { jumpHeld: true });
    expect(rig.casts[rig.casts.length - 1]!.moveId).toBe("sv.x2");
    expect(rig.cs.get(1)!.contextSpent).toBe(true);
    rig.run(t + 1, t + 140);
    const cap = by(rig, "sv.x2", "captured");
    expect(cap.length).toBe(1);
    const c = cap[0]!.tick;
    expect(by(rig, "sv.x2", "hit").map((x) => [x.tick - c, x.r.damage100])).toEqual([[48, 4000]]);
    const v = rig.cs.get(2)!;
    expect(v.action).toBe("Ragdolled");
    expect(v.actionStartTick).toBe(c + 49);
    expect(rig.resultsOf("sv.wall").length).toBe(0); // the shared wall attack is not used
    expect(rig.cs.get(1)!.cooldowns.get("sv.wall")).toBeUndefined();
  });
  test("sv.x2 is cinematic: a third party cannot damage the captured victim, and the capture hit is counterable", async () => {
    rig = await makeContextRig({ kit: "sv", victimKit: "td" });
    awaken(rig);
    rig.atWall();
    const t = toFourth(rig);
    rig.run(t + 1, t + 20);
    const before = rig.hp(2);
    rig.poke(3, 2);
    rig.run(t + 21, t + 22);
    expect(rig.hp(2)).toBe(before);
    expect(rig.resultsOf("test.poke").some((x) => x.r.outcome === "shielded")).toBe(true);
  });
  test("after sv.x2 the bit is spent: a second wall fourth hit uses the generic wall attack", async () => {
    rig = await makeContextRig({ kit: "sv", victimKit: "td" });
    awaken(rig);
    rig.atWall();
    const t = toFourth(rig);
    rig.run(t + 1, t + 140);
    rig.cs.get(2)!.hp100 = 10000;
    rig.cs.get(2)!.action = "Idle";
    rig.place(2, -10, 0.8);
    rig.holdUntil(t + 141, (id) => id.endsWith(".wall") || id.startsWith("m1.4"), {}, 400);
    expect(rig.casts[rig.casts.length - 1]!.moveId).toBe("sv.wall");
  });
});
