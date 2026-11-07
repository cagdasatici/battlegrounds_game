import { describe, expect, test } from "vitest";
import { Scene } from "../../apps/client/node_modules/three/build/three.module.js";
import { BeastView, beastBanner, type LoopBeast } from "../../apps/client/src/scene/BeastView.js";
import { BEAST } from "../../packages/shared/src/config/beast.js";

const rec = (o: Partial<LoopBeast> = {}): LoopBeast => ({
  phase: "alive", x: 2400, y: 90, z: -1800, facingYaw: 0, hp100: 30000, hpMax100: 60000, action: "Idle", moveId: "",
  actionStartTick: 0, actionEndTick: 0, phaseEndTick: 0, scale100: 550, walking: false, ...o,
});

describe("beast banner (HUD text from replicated state)", () => {
  test("warning counts down whole seconds, alive shows HP fraction, defeated says so, none shows nothing", () => {
    expect(beastBanner(undefined, 0)).toBeNull();
    expect(beastBanner(rec({ phase: "none" }), 0)).toBeNull();
    expect(beastBanner(rec({ phase: "warning", phaseEndTick: 300 }), 0)).toEqual({ text: "Something huge is coming in 5", frac: null });
    expect(beastBanner(rec({ phase: "warning", phaseEndTick: 300 }), 299)?.text).toContain("in 1");
    expect(beastBanner(rec(), 0)).toEqual({ text: "The Beast", frac: 0.5 });
    expect(beastBanner(rec({ hp100: 70000 }), 0)?.frac).toBe(1);
    expect(beastBanner(rec({ phase: "defeated" }), 0)?.text).toMatch(/down/);
  });
});

describe("BeastView", () => {
  test("hidden until the server says alive; placed at the replicated pose; 5.5x body", () => {
    const scene = new Scene();
    const v = new BeastView(scene);
    v.sync(undefined, 0);
    expect(v.snapshot().visible).toBe(false);
    v.sync(rec(), 10);
    v.update(1);
    const s = v.snapshot();
    expect(s.visible).toBe(true);
    expect(s.x).toBeCloseTo(24, 5);
    expect(s.z).toBeCloseTo(-18, 5);
    expect(s.y).toBeCloseTo(0, 5); // capsule centre 0.9 m above the ground
    expect(s.scale).toBeCloseTo(BEAST.scale, 5);
    v.dispose();
  });

  test("the warning shows a ground marker only; a windup shows the matching ground telegraph", () => {
    const v = new BeastView(new Scene());
    v.sync(rec({ phase: "warning", phaseEndTick: 100 }), 0);
    expect(v.snapshot()).toMatchObject({ visible: false, telegraph: "marker" });
    v.sync(rec({ action: "Windup", moveId: "beast.swipe", actionStartTick: 0, actionEndTick: 42 }), 10);
    expect(v.snapshot().telegraph).toBe("swipe");
    v.sync(rec({ action: "Windup", moveId: "beast.slam", actionStartTick: 0, actionEndTick: 66 }), 10);
    expect(v.snapshot().telegraph).toBe("slam");
    v.sync(rec({ action: "Active", moveId: "beast.slam" }), 70);
    expect(v.snapshot().telegraph).toBe("");
    v.dispose();
  });

  test("the body is hidden while the camera is inside it and returns when the camera leaves", () => {
    const v = new BeastView(new Scene());
    v.sync(rec(), 10); v.update(1);
    v.setViewer({ x: 24, y: 4, z: -18 });
    v.update(0.01);
    expect(v.snapshot().visible).toBe(false);
    v.setViewer({ x: 24, y: 4, z: 10 });
    v.update(0.01);
    expect(v.snapshot().visible).toBe(true);
    v.dispose();
  });

  test("defeat eventually hides it; clear and dispose are idempotent", () => {
    const scene = new Scene();
    const v = new BeastView(scene);
    v.sync(rec({ phase: "defeated", action: "Dead", phaseEndTick: BEAST.defeatedTicks }), 0);
    v.update(1);
    expect(v.snapshot().visible).toBe(true);
    v.sync(rec({ phase: "defeated", action: "Dead", phaseEndTick: BEAST.defeatedTicks }), BEAST.defeatedTicks);
    expect(v.snapshot().visible).toBe(false);
    v.clear(); v.clear();
    v.dispose(); v.dispose();
    expect(scene.children).toHaveLength(0);
  });
});
