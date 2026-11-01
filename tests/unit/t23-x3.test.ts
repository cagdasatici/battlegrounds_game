import { afterEach, describe, expect, test } from "vitest";
import { ALL_ABILITY_DEFS } from "../../packages/shared/src/config/kits/index.js";
import { makeContextRig, type ContextRig } from "../fixtures/contextRig.js";
import { awaken, by } from "../fixtures/contextHelpers.js";

/** T23.3 sv.x3 Meteor Cast (spec 15). */
let rig: ContextRig;
afterEach(() => rig?.dispose());

describe("Vanguard contextual attacks", () => {
  test("definition: sv.x3 takes no slot, 15 HP, speed 28, radius 0.4, life 120, U, R60 F10 U3", () => {
    const d = ALL_ABILITY_DEFS.find((a) => a.id === "sv.x3")!;
    expect([d.input, d.slot, d.damage100, d.block, d.ragdollTicks, d.launch, d.startup, d.recovery]).toEqual(["context", null, [1500], "U", 60, { forward: 10, up: 3 }, 10, 24]);
    expect([d.projectile!.speed, d.projectile!.radius, d.projectile!.lifeTicks]).toEqual([28, 0.4, 120]);
  });
  test("sv.x3 Meteor Cast: holding an urn, Attack throws 15 HP at 28 m/s that bypasses guard and spends the bit", async () => {
    rig = await makeContextRig({ kit: "sv", victimKit: "td", nearUrn: true });
    awaken(rig);
    rig.step(10, { attackHeld: true });
    rig.run(11, 29);
    expect(rig.urns.heldBy(1)).toBeDefined();
    expect(rig.cs.get(1)!.contextSpent).toBe(false); // pickup never spends it
    rig.guard.add(2);
    rig.step(30, { attackHeld: true });
    expect(rig.cs.get(1)!.moveId).toBe("sv.x3");
    expect(rig.cs.get(1)!.contextSpent).toBe(true);
    rig.run(31, 80);
    expect(by(rig, "sv.x3", "hit").map((x) => x.r.damage100)).toEqual([1500]);
    expect(rig.hp(2)).toBe(10000 - 1500);
    expect(rig.cs.get(1)!.form).toBe("Awakened");
  });
  test("after the bit is spent a held urn throws the ordinary sv.throw", async () => {
    rig = await makeContextRig({ kit: "sv", victimKit: "td", nearUrn: true });
    awaken(rig);
    rig.cs.get(1)!.contextSpent = true;
    rig.step(10, { attackHeld: true });
    rig.run(11, 29);
    rig.step(30, { attackHeld: true });
    expect(rig.cs.get(1)!.moveId).toBe("sv.throw");
  });
  test("priority: a held urn outranks a wall target and the uppercut gesture", async () => {
    rig = await makeContextRig({ kit: "sv", victimKit: "td", nearUrn: true });
    awaken(rig);
    rig.step(10, { attackHeld: true });
    rig.run(11, 29);
    rig.atWall();
    rig.step(30, { attackHeld: true, jumpHeld: true });
    expect(rig.cs.get(1)!.moveId).toBe("sv.x3");
  });
  test("contextSpent resets with a new awakening and on death", async () => {
    rig = await makeContextRig({ kit: "sv", victimKit: "td" });
    awaken(rig);
    rig.cs.get(1)!.contextSpent = true;
    rig.cs.kill(1, 5);
    rig.cs.respawn(1, 400, 77);
    expect(rig.cs.get(1)!.contextSpent).toBe(false);
  });
});
