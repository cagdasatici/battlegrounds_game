import { describe, expect, test } from "vitest";
import type { Scene } from "three";
import { EffectsPool, POOL_CAPACITY } from "../../apps/client/src/scene/EffectsPool.js";
import { DENSITY, GLOW_BUDGET } from "../../apps/client/src/scene/GlowLayer.js";
import { FighterView } from "../../apps/client/src/scene/FighterView.js";
import { makeToonRamp } from "../../apps/client/src/scene/FighterModel.js";
import { playHit, type HitFxIo } from "../../apps/client/src/fx/HitFx.js";
import { SIGNATURES, playFinisherImpact, playSignatureActive, playSignatureImpact, playSignatureWindup } from "../../apps/client/src/fx/Signatures.js";
import type { CombatEvent } from "../../packages/shared/src/protocol.js";

const Scene = function (): Scene { const g = new FighterView("sv", makeToonRamp()).group; g.clear(); return g as unknown as Scene; } as unknown as new () => Scene;
const TIERS = ["low", "medium", "high"] as const;
const MOVES = Object.keys(SIGNATURES);
const ACTORS = ["1", "2", "3", "4"] as const;
const KIT = { "1": "sv", "2": "td", "3": "ea", "4": "sv" } as const;
const POS = { "1": { x: -1.5, y: 1, z: 0 }, "2": { x: 1.5, y: 1, z: 0 }, "3": { x: -1.5, y: 1, z: 3 }, "4": { x: 1.5, y: 1, z: 3 } } as const;

function busyRig(tier: (typeof TIERS)[number]) {
  const fx = new EffectsPool(), scene = new Scene();
  fx.configure(scene, tier);
  const io: HitFxIo = {
    effects: fx, fighterOf: () => undefined, chestOf: (id) => POS[id as keyof typeof POS], shake: () => {}, flashLevel: () => 0.3,
    localId: () => "1", kitOf: (id) => KIT[id as keyof typeof KIT], reducedMotion: () => false,
  };
  return { fx, scene, io };
}
/** Four fighters trading every ability, hit, block and KO on overlapping frames for `frames` render frames. */
function brawl(rig: ReturnType<typeof busyRig>, frames: number, observe: () => void): void {
  let n = 0;
  for (let f = 0; f < frames; f++) {
    for (const a of ACTORS) {
      const move = MOVES[(f + Number(a) * 5) % MOVES.length]!, at = POS[a], victim = ACTORS[(Number(a) % 4)]!;
      if (f % 4 === 0) {
        playSignatureWindup(rig.fx, move, at, 0, 0, a);
        playSignatureActive(rig.fx, move, at, 0, 0);
        playSignatureImpact(rig.fx, move, POS[victim], 0, 1.5);
        const kind = f % 12 === 0 ? "block" : f % 20 === 0 ? "ko" : "hit";
        playHit({ eventId: `e${n++}`, tick: f, kind, actorId: a, targetId: victim, lifeId: 1, moveId: move, damage100: 1800, hitClass: "heavy", position: { x: POS[victim].x, y: 1.2, z: POS[victim].z } } as CombatEvent, rig.io);
        if (f % 8 === 0) playFinisherImpact(rig.fx, KIT[a], POS[victim], 0, { x: 1, z: 0 }, 1.2);
      }
    }
    rig.fx.update(1 / 60);
    observe();
  }
}

describe("UX10c quality tiers and budgets", () => {
  test("tier tables: lights 0/2/4, density and slot budgets strictly grow, pool capacity unchanged by this work", () => {
    expect(TIERS.map((t) => GLOW_BUDGET[t].lights)).toEqual([0, 2, 4]);
    expect(DENSITY.low).toBeLessThan(DENSITY.medium); expect(DENSITY.medium).toBeLessThan(DENSITY.high);
    for (const k of ["flashes", "rings", "streaks"] as const) { expect(GLOW_BUDGET.low[k]).toBeLessThan(GLOW_BUDGET.medium[k]); expect(GLOW_BUDGET.medium[k]).toBeLessThan(GLOW_BUDGET.high[k]); }
    expect(POOL_CAPACITY).toEqual({ low: 200, medium: 600, high: 1000 });
  });
  test("busy four-fighter brawl: every counter stays inside the tier budget on every frame", () => {
    for (const t of TIERS) {
      const rig = busyRig(t), b = GLOW_BUDGET[t];
      let peakStreaks = 0, peakLights = 0, peakPool = 0;
      brawl(rig, 600, () => {
        const s = rig.fx.glow.stats();
        expect(s.flashes).toBeLessThanOrEqual(b.flashes); expect(s.rings).toBeLessThanOrEqual(b.rings);
        expect(s.streaks).toBeLessThanOrEqual(b.streaks); expect(s.lights).toBeLessThanOrEqual(b.lights);
        expect(rig.fx.activeCount).toBeLessThanOrEqual(POOL_CAPACITY[t]);
        peakStreaks = Math.max(peakStreaks, s.streaks); peakLights = Math.max(peakLights, s.lights); peakPool = Math.max(peakPool, rig.fx.activeCount);
      });
      expect(peakStreaks).toBeGreaterThan(b.streaks * 0.5); // the scene really is busy, not trivially empty
      if (b.lights > 0) expect(peakLights).toBe(b.lights); else expect(peakLights).toBe(0);
      rig.fx.dispose();
    }
  });
  test("no per-hit allocation: scene objects, geometries and instance buffers are the same after 600 busy frames", () => {
    const rig = busyRig("high");
    const names = (): string[] => rig.scene.children.map((c) => c.name).sort();
    const before = names();
    const meshes = rig.scene.children.filter((c) => c.name.startsWith("fx.glow.")) as unknown as Array<{ geometry: unknown; instanceMatrix: { array: unknown }; count: number }>;
    const ids = meshes.map((m) => [m.geometry, m.instanceMatrix.array, m.count]);
    brawl(rig, 600, () => {});
    expect(names()).toEqual(before);
    meshes.forEach((m, i) => { expect(m.geometry).toBe(ids[i]![0]); expect(m.instanceMatrix.array).toBe(ids[i]![1]); expect(m.count).toBe(ids[i]![2]); });
    rig.fx.dispose();
  });
  test("lower tiers spend fewer effect slots on the same fight, and everything drains afterwards", () => {
    const peaks = TIERS.map((t) => {
      const rig = busyRig(t);
      let peak = 0;
      brawl(rig, 240, () => { peak = Math.max(peak, rig.fx.glow.activeCount); });
      for (let i = 0; i < 200; i++) rig.fx.update(0.05);
      expect(rig.fx.glow.activeCount).toBe(0); expect(rig.fx.activeCount).toBe(0); expect(rig.fx.glow.stats().lights).toBe(0);
      rig.fx.dispose();
      return peak;
    });
    expect(peaks[0]!).toBeLessThan(peaks[1]!); expect(peaks[1]!).toBeLessThanOrEqual(peaks[2]!);
  });
  test("tier change mid-fight swaps budgets cleanly: old effects are dropped, no stale lights or meshes remain", () => {
    const rig = busyRig("high");
    brawl(rig, 60, () => {});
    rig.fx.configure(rig.scene, "low");
    expect(rig.fx.glow.activeCount).toBe(0);
    expect(rig.scene.children.filter((c) => c.name.startsWith("fx.light.")).length).toBe(0);
    expect(rig.fx.glow.lightCount).toBe(0);
    brawl(rig, 60, () => {});
    expect(rig.fx.glow.stats().lights).toBe(0);
    rig.fx.dispose();
    expect(rig.scene.children.length).toBe(0);
  });
});
