import { describe, expect, test } from "vitest";
import { TUTORIAL_STEPS } from "../../packages/shared/src/protocol.js";
import { tutorialView, SKILL_NAMES } from "../../apps/client/src/ui/PracticeFormat.js";

describe("tutorial view (display of server confirmed state only)", () => {
  test("rows follow the replicated step: done, current, todo", () => {
    const v = tutorialView(2, 0);
    expect(v.rows.map((r) => r.status)).toEqual(["done", "done", "current", "todo", "todo", "todo", "todo"]);
    expect(v.rows).toHaveLength(TUTORIAL_STEPS.length);
    expect(v.done).toBe(false);
    expect(v.hint).toMatch(/strike/i);
  });
  test("the skills row shows progress from the skill bits", () => {
    const v = tutorialView(5, 0b0101);
    expect(v.rows[5]).toMatchObject({ status: "current", detail: "2 of 4" });
    expect(SKILL_NAMES).toHaveLength(4);
  });
  test("finished tutorial and out-of-range values are clamped", () => {
    expect(tutorialView(7, 15)).toMatchObject({ done: true });
    expect(tutorialView(99, 255).rows.every((r) => r.status === "done")).toBe(true);
    expect(tutorialView(-3, 0).rows[0]!.status).toBe("current");
  });
});
