import { describe, expect, test } from "vitest";
import { computeLayout } from "../../apps/client/src/input/ControlLayout.js";
import { InputGate } from "../../apps/client/src/input/InputGate.js";
import { PointerRouter } from "../../apps/client/src/input/PointerRouter.js";
import { KeyboardRouter, attachKeyboardRouter } from "../../apps/client/src/input/KeyboardRouter.js";
import { IntentSampler } from "../../apps/client/src/input/IntentSampler.js";

const L = computeLayout({ x0: 0, y0: 0, W: 1024, H: 768 });
const mk = () => {
  const gate = new InputGate();
  let closes = 0;
  gate.onClose(() => { closes++; });
  const r = new PointerRouter(L, { gate, awakeningReady: () => true });
  gate.onClose(() => { r.releaseAll(); r.takeEdges(); });
  return { gate, r, k: new KeyboardRouter(r), closes: () => closes };
};
const center = (id: "skill2" | "joystick") => { const c = L.controls[id]; return { pointerId: 7, x: c.cx, y: c.cy }; };

describe("InputGate", () => {
  test("close notification fires only on open to closed; reasons stack and survive layout changes", () => {
    const { gate, r, closes } = mk();
    gate.set("connection", true); gate.set("orientation", true); gate.set("orientation", true);
    expect(closes()).toBe(1);
    r.setLayout(L); // resize
    expect(gate.closed).toBe(true);
    gate.set("orientation", false);
    expect(gate.closed).toBe(true);
    gate.set("connection", false);
    expect(gate.closed).toBe(false);
  });
  test("W held then menu then D produces no motion; closing gives none until a fresh W", () => {
    const { gate, r, k } = mk();
    k.keyDown("KeyW");
    expect(r.moveZ).toBe(1);
    gate.set("menu", true);
    expect([r.moveX, r.moveZ]).toEqual([0, 0]);
    k.keyDown("KeyD");
    expect([r.moveX, r.moveZ]).toEqual([0, 0]);
    gate.set("menu", false);
    k.keyDown("KeyW", true); // OS repeat of the old hold must not restore it
    expect([r.moveX, r.moveZ]).toEqual([0, 0]);
    k.keyUp("KeyW");
    k.keyDown("KeyW");
    expect(r.moveZ).toBe(1);
  });
  test("key 2 with an overlay open produces no cast edge", () => {
    const { gate, r, k } = mk();
    gate.set("settings", true);
    k.keyDown("Digit2"); k.keyUp("Digit2"); k.keyDown("Space"); k.mouseButton(0, true);
    expect(r.takeEdges()).toEqual([]);
    expect(r.held("attack")).toBe(false);
    expect(new IntentSampler(r, 1).sample(1)!.chargeHeldSlot).toBe(0);
  });
  test("Escape still reaches the menu control while gated", () => {
    let menus = 0;
    const gate = new InputGate();
    const r = new PointerRouter(L, { gate, onMenu: () => { menus++; } });
    const k = new KeyboardRouter(r);
    gate.set("moves", true);
    k.keyDown("Escape");
    expect(menus).toBe(1);
  });
  test("touch skillDown then cancel before sampling produces no late cast; pointers are ignored while gated", () => {
    const { gate, r } = mk();
    expect(r.down(center("skill2"))).toBe(true);
    r.cancel(7);
    expect(r.takeEdges()).toEqual([]);
    gate.set("menu", true);
    expect(r.down(center("skill2"))).toBe(false);
    expect(r.takeEdges()).toEqual([]);
  });
  test("held charge cancelled by the gate sends neutral and no release edge", () => {
    const { gate, r, k } = mk();
    const s = new IntentSampler(r, 1);
    k.keyDown("Digit3");
    expect(s.sample(1)!.chargeHeldSlot).toBe(3);
    gate.set("graphics", true);
    const edges = r.takeEdges();
    expect(edges).toEqual([]);
    const n = s.neutral(2)!;
    expect(n.chargeHeldSlot).toBe(0);
    expect(n.edges).toEqual([]);
    k.keyUp("Digit3");
    expect(r.takeEdges()).toEqual([]);
  });
  test("typing into a text field never plays", () => {
    const { r } = mk();
    const win = new EventTarget(), surface = new EventTarget();
    const off = attachKeyboardRouter(r, win, surface);
    const e = new Event("keydown", { cancelable: true }) as Event & { code: string };
    e.code = "KeyW";
    const ta = Object.assign(new EventTarget(), { tagName: "TEXTAREA" });
    Object.defineProperty(e, "target", { value: ta });
    win.dispatchEvent(e);
    expect(r.moveZ).toBe(0);
    off();
  });
  test("five independent pointers still work while open", () => {
    const { r } = mk();
    expect(r.down(center("joystick"))).toBe(true);
    expect(r.down({ pointerId: 8, x: L.controls.skill2.cx, y: L.controls.skill2.cy })).toBe(true);
    expect(r.activePointers).toBe(2);
  });
});
