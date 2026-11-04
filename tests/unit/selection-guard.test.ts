import { describe, expect, test } from "vitest";
import { isEditableTarget } from "../../apps/client/src/app/SelectionGuard.js";

const fake = (match: boolean): EventTarget => ({ closest: () => (match ? ({} as Element) : null) }) as unknown as EventTarget;

describe("FB01 isEditableTarget", () => {
  test("editable ancestors allowed", () => expect(isEditableTarget(fake(true))).toBe(true));
  test("buttons and canvas are not editable", () => expect(isEditableTarget(fake(false))).toBe(false));
  test("null and non-elements are not editable", () => {
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget({} as EventTarget)).toBe(false);
  });
});
