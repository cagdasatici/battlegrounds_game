import { expect, test } from "vitest";
import { PointerRouter } from "../../apps/client/src/input/PointerRouter.js";
import { IntentSampler } from "../../apps/client/src/input/IntentSampler.js";
import { computeLayout } from "../../apps/client/src/input/ControlLayout.js";
import { initialMoveState, integrateMovement, MOVE_DT } from "../../packages/shared/src/movement.js";
const layout = () => computeLayout({ x0: 0, y0: 0, W: 1024, H: 768 });
test("Quick Use off: deferred ordinary skill is released once and cancel never casts; charge still starts on down", () => {
  const r = new PointerRouter(layout(), { isChargeSlot: s => s === 3 }); r.quickUse = false;
  r.keyHold("skill1", true); expect(r.takeEdges()).toEqual([]);
  r.keyHold("skill1", false); expect(r.takeEdges()).toEqual([{ kind: "skillDown", slot: 1 }, { kind: "skillUp", slot: 1 }]);
  r.keyHold("skill2", true); r.releaseAll(); expect(r.takeEdges()).toEqual([]);
  r.keyHold("skill3", true); expect(r.takeEdges()).toEqual([{ kind: "skillDown", slot: 3 }]);
  r.keyHold("skill3", false); expect(r.takeEdges()).toEqual([{ kind: "skillUp", slot: 3 }]);
});
test("auto run has six-tick activation, hysteresis and neutral reset; double forward works when off", () => {
  const r = new PointerRouter(layout()), s = new IntentSampler(r, 1); r.autoRun = true; r.setKeyboardMove(0, 1);
  for (let i = 1; i < 6; i++) expect(s.sample(i)?.runHeld).toBe(false);
  expect(s.sample(6)?.runHeld).toBe(true); r.setKeyboardMove(0, .8); expect(s.sample(7)?.runHeld).toBe(true);
  r.setKeyboardMove(0, .7); expect(s.sample(8)?.runHeld).toBe(false);
  s.neutral(9); r.autoRun = false; r.setKeyboardMove(0, 1); expect(s.sample(10)?.runHeld).toBe(false);
  r.setKeyboardMove(0, 0); s.sample(11); r.setKeyboardMove(0, 1); expect(s.sample(12)?.runHeld).toBe(true);
  r.keyHold("block", true); expect(s.sample(13)?.runHeld).toBe(false);
});
test("facing intent is optional, rate limited to 720 deg/s and never changes translation", () => {
  const s = initialMoveState(0); s.grounded = true;
  const step = integrateMovement(s, { moveX: 0, moveZ: 0, guard: false, run: false, jumpPressed: false, aimYaw: Math.PI }, 1);
  expect(Math.abs(s.facingYaw)).toBeCloseTo(4 * Math.PI * MOVE_DT); expect(step.dx).toBe(0); expect(step.dz).toBe(0);
  const r = new PointerRouter(layout()); r.facingLock = true; r.yaw = 1.2;
  expect(new IntentSampler(r, 1).sample(1)).toMatchObject({ facingLock: true, yaw: 1.2 });
});

test("Aim toggles notify saved preferences without releasing another held input; a new epoch clears run gestures", () => {
  const seen: boolean[] = [], r = new PointerRouter(layout(), { onFacingLockChange: on => seen.push(on) });
  const s = new IntentSampler(r, 1); r.keyHold("block", true); r.keyHold("facing", true);
  expect(seen).toEqual([true]); expect(r.held("block")).toBe(true); r.keyHold("facing", false); r.keyHold("block", false);
  r.setKeyboardMove(0, 1); s.sample(100); r.setKeyboardMove(0, 0); s.sample(101);
  s.setEpoch(2); r.setKeyboardMove(0, 1); expect(s.sample(1)?.runHeld).toBe(false);
});
