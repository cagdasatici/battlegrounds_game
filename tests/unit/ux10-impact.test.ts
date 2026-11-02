import { describe, expect, test } from "vitest";
import type { Scene } from "three";
import { EffectsPool } from "../../apps/client/src/scene/EffectsPool.js";
import { DENSITY, GLOW_BUDGET, SOFT_SCALE } from "../../apps/client/src/scene/GlowLayer.js";
import { FighterView } from "../../apps/client/src/scene/FighterView.js";
import { makeToonRamp } from "../../apps/client/src/scene/FighterModel.js";
import { playHit, type HitFxIo } from "../../apps/client/src/fx/HitFx.js";
import { impactPower, shakeFor, elementOf, elementOfMove, THEME } from "../../apps/client/src/fx/Impact.js";
import type { CombatEvent } from "../../packages/shared/src/protocol.js";

const Scene = function (): Scene { const g = new FighterView("sv", makeToonRamp()).group; g.clear(); return g as unknown as Scene; } as unknown as new () => Scene;
const TIERS = ["low", "medium", "high"] as const;
const drain = (fx: EffectsPool, sec = 3): void => { for (let i = 0; i < sec / 0.05; i++) fx.update(0.05); };
const ev = (over: Partial<CombatEvent>): CombatEvent => ({ eventId: "e", tick: 1, kind: "hit", actorId: "1", targetId: "2", lifeId: 1, position: { x: 1, y: 1, z: 1 }, ...over });

function rig(tier: (typeof TIERS)[number], opts: { reduced?: boolean; local?: string } = {}) {
  const fx = new EffectsPool(), scene = new Scene();
  fx.configure(scene, tier);
  const shakes: Array<{ a: number; ms: number }> = [];
  const io: HitFxIo = {
    effects: fx, fighterOf: () => undefined,
    chestOf: (id) => (id === "1" ? { x: -1, y: 1, z: 1 } : { x: 1, y: 1, z: 1 }),
    shake: (a, ms) => { shakes.push({ a, ms }); }, flashLevel: () => 0.3, localId: () => opts.local ?? "2",
    kitOf: (id) => (id === "1" ? "td" : "sv"), reducedMotion: () => opts.reduced === true,
  };
  return { fx, scene, io, shakes };
}

describe("UX10a shared impact language", () => {
  test("every hit spawns flash, sparks, ground shockwave and a point light (where the tier allows)", () => {
    for (const tier of TIERS) {
      const { fx, io } = rig(tier);
      playHit(ev({ damage100: 1200, hitClass: "heavy" }), io);
      const s = fx.glow.stats();
      expect(s.flashes).toBeGreaterThanOrEqual(2);
      expect(s.rings).toBeGreaterThanOrEqual(2);
      expect(s.streaks).toBeGreaterThanOrEqual(5);
      expect(s.lights).toBe(Math.min(1, GLOW_BUDGET[tier].lights));
      fx.dispose();
    }
  });
  test("power and shake scale with damage; a finisher and a KO are heavier still", () => {
    const light = impactPower(400, false, false, false), heavy = impactPower(2000, true, false, false);
    const fin = impactPower(1000, true, true, false), ko = impactPower(1000, false, false, true);
    expect(heavy).toBeGreaterThan(light);
    expect(fin).toBeGreaterThan(impactPower(1000, true, false, false));
    expect(ko).toBeGreaterThan(heavy);
    expect(shakeFor(ko).amplitude).toBeGreaterThan(shakeFor(heavy).amplitude);
    expect(shakeFor(heavy).amplitude).toBeGreaterThan(shakeFor(light).amplitude);
    expect(shakeFor(99).amplitude).toBeLessThanOrEqual(0.7);
  });
  test("local camera shake follows damage and only fires when the local player is involved", () => {
    const a = rig("high"), b = rig("high"), c = rig("high", { local: "9" });
    playHit(ev({ damage100: 300 }), a.io);
    playHit(ev({ damage100: 2500, hitClass: "heavy" }), b.io);
    playHit(ev({ damage100: 2500, hitClass: "heavy" }), c.io);
    expect(b.shakes[0]!.a).toBeGreaterThan(a.shakes[0]!.a);
    expect(c.shakes).toEqual([]);
  });
  test("KO is a bigger blast than a heavy hit", () => {
    const h = rig("high"), k = rig("high");
    playHit(ev({ damage100: 2000, hitClass: "heavy" }), h.io);
    playHit(ev({ kind: "ko" }), k.io);
    expect(k.fx.glow.stats().rings).toBeGreaterThan(h.fx.glow.stats().rings);
    expect(k.fx.glow.stats().streaks).toBeGreaterThan(h.fx.glow.stats().streaks);
    expect(k.shakes[0]!.a).toBeGreaterThan(0.4);
  });
  test("block reads as a shield ripple: three vertical rings, cyan, no ground shockwave on top", () => {
    const { fx, io } = rig("high");
    playHit(ev({ kind: "block" }), io);
    expect(fx.glow.stats().rings).toBe(3);
    expect(fx.glow.stats().flashes).toBe(1);
  });
  test("Reduced Motion: no shake, no point light, dimmer glow", () => {
    const { fx, io, shakes } = rig("high", { reduced: true });
    playHit(ev({ damage100: 2500, hitClass: "heavy" }), io);
    expect(shakes).toEqual([]);
    expect(fx.glow.stats().lights).toBe(0);
    expect(fx.glow.isSoft).toBe(true);
    expect(SOFT_SCALE).toBeLessThan(0.6);
  });
  test("element tint comes from the move, else from the attacker's kit", () => {
    expect(elementOfMove("td.b2")).toBe("water");
    expect(elementOfMove("m1.4")).toBe("neutral");
    expect(elementOf("ea")).toBe("ember");
    expect(THEME.stone.accent).not.toBe(THEME.water.accent);
  });
});

describe("UX10 glow layer budgets and cleanup", () => {
  test("light counts per tier are Low 0, Medium 2, High 4 and the lights exist in the scene", () => {
    expect(TIERS.map((t) => GLOW_BUDGET[t].lights)).toEqual([0, 2, 4]);
    for (const tier of TIERS) {
      const { fx, scene } = rig(tier);
      expect(fx.glow.lightCount).toBe(GLOW_BUDGET[tier].lights);
      expect(scene.children.filter((c) => c.name.startsWith("fx.light.")).length).toBe(GLOW_BUDGET[tier].lights);
      fx.dispose();
    }
  });
  test("particle density and slot budgets grow with the tier", () => {
    expect(DENSITY.low).toBeLessThan(DENSITY.medium); expect(DENSITY.medium).toBeLessThan(DENSITY.high);
    expect(GLOW_BUDGET.low.streaks).toBeLessThan(GLOW_BUDGET.medium.streaks);
    expect(GLOW_BUDGET.medium.streaks).toBeLessThan(GLOW_BUDGET.high.streaks);
    const counts = TIERS.map((t) => { const { fx, io } = rig(t); playHit(ev({ damage100: 2000, hitClass: "heavy" }), io); return fx.glow.stats().streaks; });
    expect(counts[0]!).toBeLessThan(counts[1]!); expect(counts[1]!).toBeLessThanOrEqual(counts[2]!);
  });
  test("slots are pooled: hammering hits never exceeds the budget or adds scene objects", () => {
    for (const tier of TIERS) {
      const { fx, io, scene } = rig(tier);
      const objects = scene.children.length;
      for (let i = 0; i < 200; i++) playHit(ev({ damage100: 2500, hitClass: "heavy", eventId: `e${i}` }), io);
      const s = fx.glow.stats(), b = GLOW_BUDGET[tier];
      expect(s.flashes).toBeLessThanOrEqual(b.flashes); expect(s.rings).toBeLessThanOrEqual(b.rings);
      expect(s.streaks).toBeLessThanOrEqual(b.streaks); expect(s.lights).toBeLessThanOrEqual(b.lights);
      expect(scene.children.length).toBe(objects);
      fx.dispose();
    }
  });
  test("everything expires by itself and idle meshes are hidden (no draw calls)", () => {
    const { fx, io, scene } = rig("high");
    playHit(ev({ kind: "ko" }), io);
    expect(fx.glow.activeCount).toBeGreaterThan(0);
    expect(scene.children.some((c) => c.name === "fx.glow.streak" && c.visible)).toBe(true);
    drain(fx);
    expect(fx.glow.activeCount).toBe(0);
    expect(fx.glow.stats().lights).toBe(0);
    expect(scene.children.filter((c) => c.name.startsWith("fx.glow.") && c.visible)).toEqual([]);
  });
  test("owner cleanup removes an interrupted actor's charge effects and nothing else", () => {
    const { fx } = rig("high");
    fx.glow.flash({ x: 0, y: 1, z: 0, color: 0xffffff, size: 1, life: 2, owner: "a" });
    fx.glow.ring({ x: 0, y: 0, z: 0, color: 0xffffff, radius: 1, life: 2, owner: "a" });
    fx.glow.flash({ x: 0, y: 1, z: 0, color: 0xffffff, size: 1, life: 2, owner: "b" });
    fx.glow.flash({ x: 0, y: 1, z: 0, color: 0xffffff, size: 1, life: 2 });
    expect(fx.glow.clearOwner("a")).toBe(2);
    expect(fx.glow.stats().flashes).toBe(2);
    fx.dispose();
  });
  test("room leave: dispose removes every glow mesh and light from the scene and stops spawning", () => {
    const { fx, scene } = rig("high");
    fx.glow.flash({ x: 0, y: 1, z: 0, color: 0xffffff, size: 1, life: 2 });
    fx.dispose();
    expect(scene.children.length).toBe(0);
    expect(fx.glow.flash({ x: 0, y: 1, z: 0, color: 0xffffff, size: 1, life: 2 })).toBe(false);
  });
  test("a tier change swaps the layer without leaking objects", () => {
    const scene = new Scene(), fx = new EffectsPool();
    fx.configure(scene, "high"); fx.configure(scene, "low"); fx.configure(scene, "medium");
    expect(scene.children.length).toBe(1 + 3 + GLOW_BUDGET.medium.lights);
    fx.dispose();
    expect(scene.children.length).toBe(0);
  });
});
