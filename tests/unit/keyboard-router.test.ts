import { describe, expect, test } from "vitest";
import { computeLayout } from "../../apps/client/src/input/ControlLayout.js";
import { PointerRouter } from "../../apps/client/src/input/PointerRouter.js";
import { KeyboardRouter, attachKeyboardRouter } from "../../apps/client/src/input/KeyboardRouter.js";
import { IntentSampler } from "../../apps/client/src/input/IntentSampler.js";

const L = computeLayout({ x0: 0, y0: 0, W: 1024, H: 768 });
const mk = () => {
  let menu = 0;
  const r = new PointerRouter(L, { onMenu: () => { menu++; }, awakeningReady: () => true });
  return { r, k: new KeyboardRouter(r), menus: () => menu };
};

describe("KeyboardRouter (spec section 11 keys)", () => {
  test("WASD drives the stick in camera space, opposite keys cancel, diagonal is normalized", () => {
    const { r, k } = mk();
    k.keyDown("KeyW");
    expect([r.moveX, r.moveZ]).toEqual([0, 1]);
    k.keyDown("KeyD");
    expect(Math.hypot(r.moveX, r.moveZ)).toBeCloseTo(1, 6);
    expect(r.moveX).toBeGreaterThan(0);
    k.keyDown("KeyS");
    expect([r.moveX, r.moveZ]).toEqual([1, 0]);
    k.keyUp("KeyD"); k.keyUp("KeyW"); k.keyUp("KeyS");
    expect([r.moveX, r.moveZ]).toEqual([0, 0]);
  });
  test("F guard and mouse attack are holds; Space/Q/G and 1-4 raise edges; skill release raises skillUp", () => {
    const { r, k } = mk();
    k.keyDown("KeyF");
    expect(r.held("block")).toBe(true);
    k.keyUp("KeyF");
    expect(r.held("block")).toBe(false);
    k.mouseButton(0, true);
    expect(r.held("attack")).toBe(true);
    k.mouseButton(0, false);
    expect(r.held("attack")).toBe(false);
    k.keyDown("Space"); k.keyDown("KeyQ"); k.keyDown("KeyG"); k.keyDown("Digit3");
    expect(r.hasEdges).toBe(true);
    k.keyUp("Digit3");
    expect(r.takeEdges()).toEqual([
      { kind: "jump" }, { kind: "dash" }, { kind: "awaken" }, { kind: "skillDown", slot: 3 }, { kind: "skillUp", slot: 3 },
    ]);
  });
  test("key repeat does not repeat edges; Shift toggles facing lock; Esc opens the menu and releases everything", () => {
    const { r, k, menus } = mk();
    k.keyDown("Space"); k.keyDown("Space"); k.keyDown("Space");
    expect(r.takeEdges()).toEqual([{ kind: "jump" }]);
    k.keyDown("ShiftLeft"); k.keyUp("ShiftLeft");
    expect(r.facingLock).toBe(true);
    k.keyDown("KeyF"); k.keyDown("KeyW");
    k.keyDown("Escape");
    expect(menus()).toBe(1);
    expect(r.held("block")).toBe(false);
    expect([r.moveX, r.moveZ]).toEqual([0, 0]);
  });
  test("unknown keys are ignored and sampler output validates with no damage fields", () => {
    const { r, k } = mk();
    k.keyDown("KeyZ"); k.keyDown("KeyW"); k.keyDown("Digit1");
    const p = new IntentSampler(r, 1).sample(5)!;
    expect(p).not.toBeNull();
    expect(Object.keys(p).sort()).toEqual(
      ["attackHeld", "blockHeld", "chargeHeldSlot", "edges", "epoch", "facingLock", "jumpHeld", "moveX", "moveZ", "pitch", "runHeld", "sampleTick", "seq", "v", "yaw"],
    );
    expect(p.chargeHeldSlot).toBe(1);
  });
  test("attach binds listeners and cleanup removes all of them; blur releases", () => {
    const { r } = mk();
    const win = new EventTarget(), surface = new EventTarget();
    let adds = 0, removes = 0;
    for (const t of [win, surface]) {
      const a = t.addEventListener.bind(t), rm = t.removeEventListener.bind(t);
      t.addEventListener = ((...x: Parameters<typeof a>) => { adds++; a(...x); }) as typeof a;
      t.removeEventListener = ((...x: Parameters<typeof rm>) => { removes++; rm(...x); }) as typeof rm;
    }
    const off = attachKeyboardRouter(r, win, surface);
    const key = (type: string, code: string) => {
      const e = new Event(type, { cancelable: true }) as Event & { code: string };
      e.code = code;
      win.dispatchEvent(e);
    };
    key("keydown", "KeyW"); key("keydown", "KeyF");
    expect(r.moveZ).toBe(1);
    expect(r.held("block")).toBe(true);
    win.dispatchEvent(new Event("blur"));
    expect(r.held("block")).toBe(false);
    expect(r.moveZ).toBe(0);
    key("keydown", "KeyF");
    off();
    expect(r.held("block")).toBe(false);
    expect(removes).toBe(adds);
    key("keydown", "KeyF");
    expect(r.held("block")).toBe(false);
  });
  test("GR05: OS repeat never re-adds a released hold and plain keyDown(repeat) is inert", () => {
    const { r, k } = mk();
    k.keyDown("KeyW");
    r.releaseAll();
    k.keyDown("KeyW", true);
    expect([r.moveX, r.moveZ]).toEqual([0, 0]);
    k.keyDown("KeyW");
    expect(r.moveZ).toBe(1);
  });

  test("GR06: Space emits one jump edge and holds jumpHeld until keyup; repeat adds nothing; a second press is a new edge", () => {
    const { r, k } = mk();
    k.keyDown("Space");
    k.keyDown("Space", true); k.keyDown("Space");
    expect(r.held("jump")).toBe(true);
    expect(r.takeEdges()).toEqual([{ kind: "jump" }]);
    k.keyUp("Space");
    expect(r.held("jump")).toBe(false);
    k.keyDown("Space");
    expect(r.takeEdges()).toEqual([{ kind: "jump" }]);
    k.keyDown("KeyQ"); k.keyDown("KeyG");
    expect(r.held("dash")).toBe(false);
    expect(r.held("awaken")).toBe(false);
  });
  test("GR06: blur/menu cancels a held Space and a later keyup is inert", () => {
    const { r, k } = mk();
    k.keyDown("Space");
    k.releaseAll();
    expect(r.held("jump")).toBe(false);
    k.keyUp("Space");
    k.keyDown("Space"); k.keyDown("Escape");
    expect(r.held("jump")).toBe(false);
  });
});
