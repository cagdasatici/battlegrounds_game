import { describe, expect, test } from "vitest";
import { Scene } from "../../apps/client/node_modules/three/build/three.module.js";
import { BeastView, beastBanner, type LoopBeast } from "../../apps/client/src/scene/BeastView.js";
import { BEAST } from "../../packages/shared/src/config/beast.js";
import { BEAST_MODEL_HEIGHT, buildBeastModel } from "../../apps/client/src/scene/BeastModel.js";
import { Box3, Vector3 } from "../../apps/client/node_modules/three/build/three.module.js";

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

describe("BeastModel", () => {
  test("stays inside a draw-call budget, is normalised to its rest height, and animates every pose without error", () => {
    const m = buildBeastModel();
    let meshes = 0, instanced = 0;
    m.group.traverse((o) => { if ((o as { isMesh?: boolean }).isMesh) { meshes++; if ((o as { isInstancedMesh?: boolean }).isInstancedMesh) instanced++; } });
    expect(meshes).toBeLessThanOrEqual(70); // BEAST02: merged per joint; one beast costs well under a hundred draws
    expect(instanced).toBeGreaterThan(0);   // fur tufts are instanced
    const h = new Box3().setFromObject(m.group).getSize(new Vector3()).y;
    expect(h).toBeCloseTo(BEAST_MODEL_HEIGHT, 1);
    for (const [action, moveId] of [["Idle", ""], ["Windup", "beast.swipe"], ["Windup", "beast.slam"], ["Active", "beast.swipe"], ["Active", "beast.slam"], ["Recovery", ""], ["Stunned", ""], ["Dead", ""]] as const) {
      for (const prog of [0, 0.5, 1]) expect(() => m.pose({ clock: 1.3, walking: action === "Idle", action, moveId, prog, defeat: action === "Dead" ? prog : 0 })).not.toThrow();
    }
    m.dispose();
  });
});

import { CraterViews } from "../../apps/client/src/scene/CraterViews.js";
import { TransformBurst } from "../../apps/client/src/scene/TransformBurst.js";
import { Group } from "../../apps/client/node_modules/three/build/three.module.js";
import { CRATER } from "../../packages/shared/src/config/beast.js";

describe("CraterViews", () => {
  test("creates a view per replicated crater, shrinks as it heals, removes it when the server drops it", () => {
    const scene = new Scene();
    const c = new CraterViews(scene);
    const rec = { id: 1, x: 1000, z: -500, radius100: 450, startTick: 0 };
    c.sync([rec], 0);
    expect(c.snapshot()).toEqual([{ id: 1, x: 10, z: -5, radius: 4.5, visible: true }]);
    c.sync([rec], CRATER.healTicks);
    expect(c.snapshot()[0]!.visible).toBe(false);
    c.sync([], CRATER.healTicks);
    expect(c.snapshot()).toHaveLength(0);
    c.sync([rec], 0); c.clear(); c.clear();
    c.dispose(); c.dispose();
    expect(scene.children).toHaveLength(0);
  });
});

describe("TransformBurst", () => {
  test("plays about a second then goes inactive; dispose is idempotent", () => {
    const g = new Group();
    const b = new TransformBurst(g);
    expect(b.active).toBe(false);
    b.trigger(8, 3);
    expect(b.active).toBe(true);
    for (let i = 0; i < 70; i++) b.update(1 / 60);
    expect(b.active).toBe(false);
    b.dispose(); b.dispose();
    expect(g.children).toHaveLength(0);
  });
});
