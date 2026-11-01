import { describe, expect, test } from "vitest";
import { TutorialTracker, type TutorialSample } from "../../apps/server/src/sim/Tutorial.js";

const base: TutorialSample = { x: 0, z: 0, facingYaw: 0, action: "Idle", moveId: "", form: "Base", slotOfMove: null };
const at = (o: Partial<TutorialSample>): TutorialSample => ({ ...base, ...o });

/** Tracker advanced to the attack step (move and turn done). */
const atAttack = (): TutorialTracker => {
  const t = new TutorialTracker();
  t.observe(at({ x: 0 }));
  t.observe(at({ x: 5 }));
  t.observe(at({ x: 5, facingYaw: 2 }));
  return t;
};

describe("TutorialTracker (server confirmed steps, T18d)", () => {
  test("steps complete only in order and only from observed state", () => {
    const t = new TutorialTracker();
    expect(t.step).toBe(0);
    t.observe(at({ action: "Dash" }));
    for (let i = 0; i < 40; i++) t.observe(at({ action: "Guard" }));
    expect(t.step).toBe(0);
    t.observe(at({ x: 1 }));
    expect(t.step).toBe(0);
    expect(t.observe(at({ x: 3.1 }))?.completed).toBe("move");
    expect(t.step).toBe(1);
  });
  test("turn needs 90 degrees from the step start, wrapped", () => {
    const t = new TutorialTracker();
    t.observe(at({ x: 0 }));
    t.observe(at({ x: 4 })); // move done; the turn anchor is this pose (yaw 0)
    expect(t.step).toBe(1);
    t.observe(at({ x: 4, facingYaw: 1.0 }));
    expect(t.step).toBe(1);
    t.observe(at({ x: 4, facingYaw: -3.0 })); // shortest turn from 0 is 3.0 rad
    expect(t.step).toBe(2);
  });
  test("attack needs two distinct M1 starts; guard needs 30 consecutive ticks; dash needs the Dash action", () => {
    const t = atAttack();
    expect(t.step).toBe(2);
    t.observe(at({ moveId: "m1.1" }));
    t.observe(at({ moveId: "m1.1" }));
    expect(t.step).toBe(2);
    t.observe(at({ moveId: "m1.2" }));
    expect(t.step).toBe(3);
    for (let i = 0; i < 29; i++) t.observe(at({ action: "Guard" }));
    t.observe(at({ action: "Idle" }));
    for (let i = 0; i < 29; i++) t.observe(at({ action: "Guard" }));
    expect(t.step).toBe(3);
    t.observe(at({ action: "Guard" }));
    expect(t.step).toBe(4);
    expect(t.observe(at({ action: "Dash" }))?.completed).toBe("dash");
    expect(t.step).toBe(5);
  });
  test("skills need all four slots; awaken needs the Awakened form and finishes the tutorial", () => {
    const t = atAttack();
    t.observe(at({ moveId: "m1.1" })); t.observe(at({ moveId: "m1.2" }));
    for (let i = 0; i < 30; i++) t.observe(at({ action: "Guard" }));
    t.observe(at({ action: "Dash" }));
    expect(t.step).toBe(5);
    for (const slot of [1, 2, 3] as const) t.observe(at({ moveId: `x.${slot}`, slotOfMove: slot }));
    t.observe(at({ moveId: "x.1", slotOfMove: 1 }));
    expect(t.step).toBe(5);
    expect(t.skillMask).toBe(0b0111);
    expect(t.observe(at({ moveId: "x.4", slotOfMove: 4 }))?.next).toBe("awaken");
    expect(t.step).toBe(6);
    t.observe(at({ action: "Awakening", form: "Base" }));
    expect(t.step).toBe(6);
    expect(t.observe(at({ form: "Awakened" }))?.completed).toBe("awaken");
    expect(t.step).toBe(7);
    expect(t.done).toBe(true);
    expect(t.observe(at({ form: "Awakened" }))).toBeNull();
  });
});
