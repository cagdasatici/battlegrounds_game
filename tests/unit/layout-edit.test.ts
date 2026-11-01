import { describe, expect, test } from "vitest";
import { computeLayout, validateLayout, MIN_TARGET_PX } from "../../apps/client/src/input/ControlLayout.js";
import {
  applyProfile, editControl, resetControl, resolveLayout, viewportClass,
} from "../../apps/client/src/input/LayoutEdit.js";
import { defaultProfile, type LayoutProfile } from "../../apps/client/src/app/SettingsStore.js";

const SAFE = { x0: 0, y0: 0, W: 1024, H: 768 };
const base = computeLayout(SAFE);
const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(0.001);

describe("viewport class", () => {
  test("wide at 900 and above, compact below", () => {
    expect(viewportClass(1024)).toBe("wide");
    expect(viewportClass(900)).toBe("wide");
    expect(viewportClass(899)).toBe("compact");
  });
});

describe("applyProfile", () => {
  test("empty profile and right hand reproduces the section 7 fixture", () => {
    const l = applyProfile(base, defaultProfile(), "right");
    near(l.controls.attack.cx, 932); near(l.controls.attack.cy, 578);
    near(l.controls.skill1.cx, 377);
    expect(l.opacity).toBe(0.9);
  });
  test("left hand mirrors the side clusters but not the centre strip", () => {
    const l = applyProfile(base, defaultProfile(), "left");
    near(l.controls.attack.cx, 1024 - 932);
    near(l.controls.joystick.cx, 1024 - 104);
    near(l.controls.skill1.cx, 377);
    near(l.controls.awaken.cx, 512);
    expect(validateLayout(l)).toEqual([]);
  });
  test("normalized position and size are applied; hit target keeps the 48 px floor", () => {
    const p: LayoutProfile = { opacity: 0.5, controls: { jump: { nx: 0.8, ny: 0.5, size: 0.85 }, menu: { nx: 0.05, ny: 0.2, size: 0.85 } } };
    const l = applyProfile(base, p, "right");
    near(l.controls.jump.cx, 0.8 * 1024); near(l.controls.jump.cy, 0.5 * 768);
    near(l.controls.jump.vw, 68 * 0.85);
    expect(l.controls.menu.hw).toBeGreaterThanOrEqual(MIN_TARGET_PX);
    expect(l.opacity).toBe(0.5);
  });
  test("safe rect origin offsets are honoured", () => {
    const b = computeLayout({ x0: 20, y0: 24, W: 1000, H: 700 });
    const l = applyProfile(b, { opacity: 0.9, controls: { jump: { nx: 0.5, ny: 0.5, size: 1 } } }, "right");
    near(l.controls.jump.cx, 20 + 500); near(l.controls.jump.cy, 24 + 350);
  });
});

describe("editControl rejects unsafe edits", () => {
  test("a move that overlaps another control is rejected with the pair named", () => {
    const r = editControl(base, defaultProfile(), "right", "jump", { nx: 932 / 1024, ny: 578 / 768, size: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.some((i) => i.kind === "overlap" && i.ids.includes("jump") && i.ids.includes("attack"))).toBe(true);
  });
  test("a move off the safe rectangle is rejected", () => {
    const r = editControl(base, defaultProfile(), "right", "attack", { nx: 1, ny: 0.5, size: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.some((i) => i.kind === "outside")).toBe(true);
  });
  test("a size that makes neighbours collide is rejected", () => {
    const r = editControl(base, defaultProfile(), "right", "skill2", { nx: 467 / 1024, ny: 704 / 768, size: 1.3 });
    expect(r.ok).toBe(false);
  });
  test("size outside 0.85 to 1.30 is rejected before layout is considered", () => {
    expect(editControl(base, defaultProfile(), "right", "attack", { nx: 0.5, ny: 0.3, size: 1.31 }).ok).toBe(false);
    expect(editControl(base, defaultProfile(), "right", "attack", { nx: 0.5, ny: 0.3, size: 0.84 }).ok).toBe(false);
    expect(editControl(base, defaultProfile(), "right", "health", { nx: 0.5, ny: 0.3, size: 1 }).ok).toBe(false);
  });
  test("a safe move is accepted, leaves the input profile untouched, and validates", () => {
    const p = defaultProfile();
    const r = editControl(base, p, "right", "facing", { nx: 0.5, ny: 0.3, size: 1.1 });
    expect(r.ok).toBe(true);
    expect(p.controls).toEqual({});
    if (r.ok) {
      expect(r.profile.controls.facing).toEqual({ nx: 0.5, ny: 0.3, size: 1.1 });
      expect(validateLayout(applyProfile(base, r.profile, "right"))).toEqual([]);
    }
  });
  test("resetControl removes one edit", () => {
    const r = editControl(base, defaultProfile(), "right", "facing", { nx: 0.5, ny: 0.3, size: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(resetControl(r.profile, "facing").controls).toEqual({});
  });
});

describe("resolveLayout falls back to defaults", () => {
  test("a stored profile that is unsafe at this viewport falls back and reports it", () => {
    // Valid at 1024x768 but off-rect for a taller control once safe-rect shrinks is hard to forge; use a forged overlap.
    const bad: LayoutProfile = { opacity: 0.7, controls: { jump: { nx: 932 / 1024, ny: 578 / 768, size: 1 } } };
    const r = resolveLayout(base, bad, "right");
    expect(r.fellBack).toBe(true);
    near(r.layout.controls.jump.cx, 948);
    expect(validateLayout(r.layout)).toEqual([]);
    expect(r.layout.opacity).toBe(0.7);
  });
  test("a good profile does not fall back", () => {
    const good: LayoutProfile = { opacity: 0.6, controls: { facing: { nx: 0.5, ny: 0.3, size: 1 } } };
    const r = resolveLayout(base, good, "right");
    expect(r.fellBack).toBe(false);
    near(r.layout.controls.facing.cx, 512);
  });
  test("rotation: normalized positions are re-validated at the new size, default fallback keeps layout valid", () => {
    const p: LayoutProfile = { opacity: 0.9, controls: { facing: { nx: 0.5, ny: 0.5, size: 1 } } };
    for (const safe of [{ x0: 0, y0: 0, W: 1180, H: 820 }, { x0: 0, y0: 0, W: 800, H: 600 }, { x0: 0, y0: 0, W: 700, H: 420 }]) {
      const r = resolveLayout(computeLayout(safe), p, "right");
      expect(validateLayout(r.layout)).toEqual([]);
    }
  });
});
