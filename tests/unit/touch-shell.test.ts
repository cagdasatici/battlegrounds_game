import { describe, expect, test } from "vitest";
import { parseInputPacket } from "../../packages/shared/src/index.js";
import { computeLayout, hitTest, validateLayout, MIN_TARGET_PX } from "../../apps/client/src/input/ControlLayout.js";
import { PointerRouter, attachPointerRouter, PITCH_MIN } from "../../apps/client/src/input/PointerRouter.js";
import { IntentSampler } from "../../apps/client/src/input/IntentSampler.js";
import { hudModel } from "../../apps/client/src/ui/Hud.js";

const L1024 = computeLayout({ x0: 0, y0: 0, W: 1024, H: 768 });
const c = (id: keyof typeof L1024.controls, l = L1024) => l.controls[id];
const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(0.001);

describe("ControlLayout fixture (section 7)", () => {
  test("1024x768 centres match the reproducible fixture", () => {
    expect(L1024.s).toBe(1);
    const exp: [keyof typeof L1024.controls, number, number][] = [
      ["attack", 932, 578], ["jump", 948, 688], ["dash", 844, 658], ["block", 842, 563],
      ["skill1", 899.88, 395.81], ["skill2", 815.58, 434.23], ["skill3", 760.47, 508.70], ["skill4", 748.38, 600.55],
    ];
    for (const [id, x, y] of exp) { expect(Math.abs(c(id).cx - x)).toBeLessThan(0.1); expect(Math.abs(c(id).cy - y)).toBeLessThan(0.1); }
  });
  test("D01 simulated: 1024x768, 1180x820 and inset/compact viewports have no issues", () => {
    const rects = [
      { x0: 0, y0: 0, W: 1024, H: 768 }, { x0: 0, y0: 0, W: 1180, H: 820 },
      { x0: 0, y0: 24, W: 1180, H: 776 }, // simulated status bar + home indicator inset
      { x0: 0, y0: 0, W: 1366, H: 1024 }, { x0: 0, y0: 0, W: 800, H: 600 }, { x0: 0, y0: 0, W: 700, H: 420 },
    ];
    for (const r of rects) {
      const l = computeLayout(r);
      expect(validateLayout(l), JSON.stringify(r)).toEqual([]);
      for (const ctl of Object.values(l.controls)) if (ctl.interactive) {
        expect(ctl.hw).toBeGreaterThanOrEqual(MIN_TARGET_PX);
        expect(ctl.hh).toBeGreaterThanOrEqual(MIN_TARGET_PX);
      }
    }
  });
  test("scale clamps and small windows are flagged", () => {
    expect(computeLayout({ x0: 0, y0: 0, W: 600, H: 400 }).s).toBe(0.78);
    expect(computeLayout({ x0: 0, y0: 0, W: 699, H: 600 }).tooSmall).toBe(true);
    expect(computeLayout({ x0: 0, y0: 0, W: 900, H: 419 }).tooSmall).toBe(true);
    expect(computeLayout({ x0: 0, y0: 0, W: 3000, H: 3000 }).s).toBe(1.25);
  });
  test("validator detects overlap and outside", () => {
    const l = computeLayout({ x0: 0, y0: 0, W: 1024, H: 768 });
    l.controls.block.cx = l.controls.attack.cx;
    l.controls.menu.cx = -10;
    const kinds = validateLayout(l).map((i) => i.kind);
    expect(kinds).toContain("overlap");
    expect(kinds).toContain("outside");
  });
  test("hit test precedence: button, joystick, else camera", () => {
    expect(hitTest(L1024, 932, 578)).toBe("attack");
    expect(hitTest(L1024, 104, 656)).toBe("joystick");
    expect(hitTest(L1024, 512, 300)).toBeNull();
    expect(hitTest(L1024, 512, 32)).toBeNull(); // health bar is display only
  });
});

const mk = (hooks = {}) => { const r = new PointerRouter(L1024, hooks); return { r, s: new IntentSampler(r, 1) }; };
const J = c("joystick");

describe("PointerRouter ownership (section 8)", () => {
  test("five simultaneous independent pointers: move, camera, attack, jump, skill", () => {
    const { r, s } = mk();
    r.down({ pointerId: 1, x: J.cx, y: J.cy });
    r.move({ pointerId: 1, x: J.cx, y: J.cy - 56 });
    r.down({ pointerId: 2, x: 500, y: 300 });
    r.move({ pointerId: 2, x: 600, y: 300 });
    r.down({ pointerId: 3, x: 932, y: 578 });
    r.down({ pointerId: 4, x: 948, y: 688 });
    r.down({ pointerId: 5, x: c("skill1").cx, y: c("skill1").cy });
    expect(r.activePointers).toBe(5);
    const p = s.sample(10)!;
    expect(r.moveZ).toBeCloseTo(1); // router stays camera relative; packet is world space (T08)
    expect(Math.hypot(p.moveX, p.moveZ)).toBeCloseTo(1);
    near(p.yaw, -100 * 0.003);
    expect(p).toMatchObject({ attackHeld: true, jumpHeld: true, chargeHeldSlot: 1 });
    expect(p.edges.map((e) => e.kind)).toEqual(["jump", "skillDown"]);
    // Releasing the camera does not stop movement or attack
    r.up(2);
    const q = s.sample(11)!;
    expect(Math.hypot(q.moveX, q.moveZ)).toBeCloseTo(1);
    expect(q.attackHeld).toBe(true);
    expect(q.edges).toEqual([]);
  });
  test("moving a captured pointer over another button does not activate it", () => {
    const { r, s } = mk();
    r.down({ pointerId: 1, x: c("skill1").cx, y: c("skill1").cy });
    r.move({ pointerId: 1, x: 932, y: 578 });
    r.up(1); // release outside its button
    const p = s.sample(1)!;
    expect(p.attackHeld).toBe(false);
    expect(p.edges.map((e) => e.kind)).toEqual(["skillDown", "skillUp"]);
  });
  test("first pointer wins a hold control; extra pointer cannot release it", () => {
    const { r, s } = mk();
    r.down({ pointerId: 1, x: 842, y: 563 });
    r.down({ pointerId: 2, x: 842, y: 563 });
    expect(r.ownerOf(2)).toBe("ignored");
    r.up(2);
    expect(s.sample(1)!.blockHeld).toBe(true);
    r.up(1);
    expect(s.sample(2)!.blockHeld).toBe(false);
  });
  test("guard suppresses attack; jump hold does not repeat edges; duplicate down ignored", () => {
    const { r, s } = mk();
    r.down({ pointerId: 1, x: 932, y: 578 });
    r.down({ pointerId: 2, x: 842, y: 563 });
    r.down({ pointerId: 3, x: 948, y: 688 });
    expect(r.down({ pointerId: 3, x: 948, y: 688 })).toBe(false);
    const a = s.sample(1)!;
    expect(a).toMatchObject({ attackHeld: false, blockHeld: true, jumpHeld: true });
    expect(a.edges.length).toBe(1);
    expect(s.sample(2)!.edges.length).toBe(0);
  });
  test("joystick dead zone, cap and camera pitch clamp", () => {
    const { r } = mk();
    r.down({ pointerId: 1, x: J.cx + 5, y: J.cy });
    expect(r.moveX).toBe(0);
    r.move({ pointerId: 1, x: J.cx + 33, y: J.cy });
    near(r.moveX, 0.5);
    r.move({ pointerId: 1, x: J.cx + 300, y: J.cy });
    near(r.moveX, 1);
    r.down({ pointerId: 2, x: 500, y: 300 });
    r.move({ pointerId: 2, x: 500, y: 100000 });
    expect(r.pitch).toBe(PITCH_MIN);
  });
  test("cancel releases without skillUp; awakening only when meter full; facing toggles", () => {
    let full = false;
    const { r, s } = mk({ awakeningReady: () => full });
    r.down({ pointerId: 1, x: c("skill2").cx, y: c("skill2").cy });
    r.cancel(1);
    r.down({ pointerId: 2, x: c("awaken").cx, y: c("awaken").cy });
    r.up(2);
    full = true;
    r.down({ pointerId: 3, x: c("awaken").cx, y: c("awaken").cy });
    r.down({ pointerId: 4, x: 946, y: 482 });
    const p = s.sample(1)!;
    expect(p.edges.map((e) => e.kind)).toEqual(["awaken"]); // GR05: a skillDown cancelled before sampling never casts
    expect(p.chargeHeldSlot).toBe(0);
    expect(r.facingLock).toBe(true);
  });
  test("menu, releaseAll and layout change give neutral intent and no inherited pointer", () => {
    let neutral = 0;
    const { r, s } = mk({ onNeutral: () => neutral++ });
    r.down({ pointerId: 1, x: J.cx, y: J.cy - 40 });
    r.move({ pointerId: 1, x: J.cx, y: J.cy - 40 });
    r.down({ pointerId: 2, x: 842, y: 563 });
    r.down({ pointerId: 3, x: 32, y: 32 }); // menu opening
    expect(r.activePointers).toBe(0);
    expect(neutral).toBe(1);
    expect(s.sample(1)).toMatchObject({ moveX: 0, moveZ: 0, blockHeld: false });
    r.down({ pointerId: 4, x: 842, y: 563 });
    r.setLayout(computeLayout({ x0: 0, y0: 0, W: 600, H: 400 }));
    expect(r.activePointers).toBe(0);
    expect(r.down({ pointerId: 5, x: 100, y: 100 })).toBe(false); // too small: inputs disabled
    const n = s.neutral(2)!;
    expect(n.edges).toEqual([]);
  });
});

describe("IntentSampler uses the shared strict validator", () => {
  test("every packet parses, edge ids unique, edges capped at 6 per packet", () => {
    const { r, s } = mk();
    for (let i = 0; i < 8; i++) { r.down({ pointerId: i, x: 844, y: 658 }); r.up(i); }
    const a = s.sample(1)!, b = s.sample(2)!;
    expect(parseInputPacket(a)).not.toBeNull();
    expect(a.edges.length).toBe(6);
    expect(b.edges.length).toBe(2);
    const ids = [...a.edges, ...b.edges].map((e) => e.id);
    expect(new Set(ids).size).toBe(8);
    expect(b.seq).toBe(a.seq + 1);
    s.setEpoch(2);
    expect(s.sample(3)!.epoch).toBe(2);
  });
});

describe("DOM binding with a real EventTarget", () => {
  const ev = (type: string, o: Record<string, number> = {}) => Object.assign(new Event(type, { cancelable: true }), o);
  test("captures, releases on blur/visibility, cleanup removes listeners", () => {
    const surface = Object.assign(new EventTarget(), {
      style: { touchAction: "auto" }, caps: [] as number[], rel: [] as number[],
      setPointerCapture(id: number) { this.caps.push(id); }, releasePointerCapture(id: number) { this.rel.push(id); },
    });
    const win = new EventTarget();
    const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
    const r = new PointerRouter(L1024);
    const off = attachPointerRouter(r, surface, win, doc);
    expect(surface.style.touchAction).toBe("none");
    surface.dispatchEvent(ev("pointerdown", { pointerId: 7, clientX: 842, clientY: 563 }));
    expect(surface.caps).toEqual([7]);
    expect(r.held("block")).toBe(true);
    win.dispatchEvent(ev("blur"));
    expect(r.held("block")).toBe(false);
    surface.dispatchEvent(ev("pointerdown", { pointerId: 8, clientX: 932, clientY: 578 }));
    doc.visibilityState = "hidden";
    doc.dispatchEvent(ev("visibilitychange"));
    expect(r.held("attack")).toBe(false);
    surface.dispatchEvent(ev("pointerdown", { pointerId: 9, clientX: 932, clientY: 578 }));
    surface.dispatchEvent(ev("lostpointercapture", { pointerId: 9 }));
    expect(r.held("attack")).toBe(false);
    surface.dispatchEvent(ev("pointerdown", { pointerId: 10, clientX: 932, clientY: 578 }));
    off();
    expect(surface.rel).toContain(10);
    expect(r.activePointers).toBe(0);
    expect(surface.style.touchAction).toBe("auto");
    surface.dispatchEvent(ev("pointerdown", { pointerId: 11, clientX: 932, clientY: 578 }));
    expect(r.activePointers).toBe(0);
  });
});

describe("Hud model", () => {
  test("boxes follow layout; rotate/enlarge panels; awaken ready only at full meter", () => {
    const st = { name: "Arel", hp: 72.4, maxHp: 100, meter: 0.5, facingLock: false, portrait: false };
    const m = hudModel(L1024, st);
    const atk = m.boxes.find((b) => b.id === "attack")!;
    expect(atk).toMatchObject({ left: 894, top: 540, width: 76, round: true });
    expect(m).toMatchObject({ panel: null, hpText: "72 / 100", meterPct: 50, awakenReady: false });
    expect(hudModel(L1024, { ...st, portrait: true }).panel).toBe("rotate");
    expect(hudModel(computeLayout({ x0: 0, y0: 0, W: 600, H: 400 }), { ...st, meter: 1 })).toMatchObject({ panel: "enlarge", awakenReady: true });
  });
});
