import { describe, expect, test } from "vitest";
import type { Scene } from "three";
import { SV_DEFS } from "../../packages/shared/src/config/kits/index.js";
import { EffectsPool, POOL_CAPACITY } from "../../apps/client/src/scene/EffectsPool.js";
import { FighterView } from "../../apps/client/src/scene/FighterView.js";
import { makeToonRamp } from "../../apps/client/src/scene/FighterModel.js";
import { LOW_QUALITY_CAP, decalRadiusFor, recipeParticles } from "../../apps/client/src/fx/kits/common.js";
import { FAULT_FOOTPRINT, FAULT_LAYERS, SV_RECIPES, onHit, playFaultStrike, recipeFor, scanPlayers } from "../../apps/client/src/fx/kits/sv.js";
import type { CombatEvent } from "../../packages/shared/src/protocol.js";

const Scene = function (): Scene { const g = new FighterView("td", makeToonRamp()).group; g.clear(); return g as unknown as Scene; } as unknown as new () => Scene;
const pool = (): EffectsPool => { const p = new EffectsPool(); p.configure(new Scene(), "low"); return p; };
const first = Object.keys(SV_RECIPES)[0]!;

describe("FX4-sv recipes", () => {
  test("every shipped sv ability has a recipe and no extras", () => {
    expect(Object.keys(SV_RECIPES).sort()).toEqual(SV_DEFS.map((d) => d.id).sort());
    expect(recipeFor("td.b1")).toBeUndefined();
  });
  test("each recipe fits the low-quality cap and the low pool", () => {
    for (const t of Object.values(SV_RECIPES)) {
      expect(recipeParticles(t)).toBeLessThanOrEqual(LOW_QUALITY_CAP);
      expect(LOW_QUALITY_CAP).toBeLessThanOrEqual(POOL_CAPACITY.low);
    }
  });
  test("windup decal is sized from the ability shape", () => {
    for (const d of SV_DEFS) expect(SV_RECIPES[d.id]!.windup.decalRadius).toBe(decalRadiusFor(SV_DEFS, d.id));
  });
  test("windup fires once per action start, active once more, and everything expires", () => {
    const fx = pool(), seen = new Map<string, string>();
    const players = new Map<string, unknown>([["1", { x: 0, y: 0, z: 0, action: "Windup", moveId: first, actionStartTick: 5 }]]);
    scanPlayers(fx, players, seen);
    const afterWindup = fx.activeCount;
    expect(afterWindup).toBeGreaterThan(0);
    scanPlayers(fx, players, seen);
    expect(fx.activeCount).toBe(afterWindup);
    players.set("1", { x: 0, y: 0, z: 0, action: "Active", moveId: first, actionStartTick: 15 });
    scanPlayers(fx, players, seen);
    expect(fx.activeCount).toBeGreaterThan(afterWindup);
    fx.update(2);
    expect(fx.activeCount).toBe(0);
  });
  test("impact only on a sv hit and ignores other kinds", () => {
    const fx = pool();
    const ev = (o: Partial<CombatEvent>): CombatEvent => ({ eventId: "e", tick: 1, kind: "hit", actorId: "1", targetId: "2", lifeId: 1, position: { x: 1, y: 1, z: 1 }, ...o });
    onHit(fx, ev({ moveId: first }), () => undefined);
    const n = fx.activeCount;
    expect(n).toBe(SV_RECIPES[first]!.impact.count);
    onHit(fx, ev({ moveId: "td.b1" }), () => undefined);
    onHit(fx, ev({ kind: "block", moveId: first }), () => undefined);
    expect(fx.activeCount).toBe(n);
  });
  test("a vanished player drops its trigger state", () => {
    const fx = pool(), seen = new Map<string, string>();
    scanPlayers(fx, new Map([["1", { x: 0, y: 0, z: 0, action: "Windup", moveId: first }]]), seen);
    expect(seen.size).toBe(1);
    scanPlayers(fx, new Map(), seen);
    expect(seen.size).toBe(0);
  });
});

describe("QV03 Fault Strike signature", () => {
  type P = { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; size: number; color: number };
  const capture = (yaw: number, surface: (x: number, z: number, y: number) => number | null = (_x, _z, y) => y - 0.9): P[] => {
    const out: P[] = [];
    playFaultStrike({ spawn: (p: P) => { out.push(p); return true; } } as unknown as EffectsPool, { x: 5, y: 0.9, z: -3 }, yaw, surface);
    return out;
  };
  const toLocal = (p: { x: number; z: number }, yaw: number): { f: number; l: number } => {
    const dx = -Math.sin(yaw), dz = -Math.cos(yaw); // forwardOf convention checked below
    return { f: (p.x - 5) * dx + (p.z + 3) * dz, l: (p.x - 5) * -dz + (p.z + 3) * dx };
  };
  test("three distinct layers fit the recipe budget and the low pool", () => {
    const ps = capture(0.7);
    expect(ps.length).toBe(FAULT_LAYERS.crack + FAULT_LAYERS.chips + FAULT_LAYERS.settle);
    expect(ps.length).toBeLessThanOrEqual(SV_RECIPES["sv.b1"]!.active.count);
    expect(recipeParticles(SV_RECIPES["sv.b1"]!)).toBeLessThanOrEqual(LOW_QUALITY_CAP);
    const colors = new Set(ps.map((p) => p.color));
    expect(colors.size).toBe(3);
    const life = (c: number) => ps.filter((p) => p.color === c).map((p) => p.life);
    const [crack, chip, frag] = [...colors].map((c) => Math.max(...life(c)));
    expect(crack!).toBeLessThan(chip!);
    expect(chip!).toBeLessThan(frag!);
  });
  test("every fragment and chip end point stays inside the wave footprint, on all headings", () => {
    for (const yaw of [0, 0.7, 2, -2.4, Math.PI]) {
      const fwdSign = Math.abs(toLocal({ x: 5 + -Math.sin(yaw), z: -3 + -Math.cos(yaw) }, yaw).f - 1) < 1e-9 ? 1 : -1;
      for (const p of capture(yaw)) {
        const t = p.vx === 0 && p.vz === 0 ? 0 : p.life;
        const end = toLocal({ x: p.x + p.vx * t, z: p.z + p.vz * t }, yaw);
        const f = end.f * fwdSign;
        expect(f).toBeGreaterThanOrEqual(FAULT_FOOTPRINT.impactAt - 1e-6);
        expect(f).toBeLessThanOrEqual(FAULT_FOOTPRINT.forward + 1e-6);
        expect(Math.abs(end.l)).toBeLessThanOrEqual(FAULT_FOOTPRINT.halfWidth);
      }
    }
  });
  test("chips split to both sides of the heading", () => {
    const sides = new Set(capture(0).filter((p) => p.vx !== 0).map((p) => Math.sign(p.vx)));
    expect(sides.size).toBe(2);
  });
  test("nothing spawns when the impact point has no surface (void)", () => {
    expect(capture(0, () => null).length).toBe(0);
    // Void only beyond the impact: chips and crack remain, the unsupported fragments are skipped.
    const partial = capture(0, (_x, z, y) => (z < -3 - 5 ? null : y - 0.9));
    expect(partial.length).toBeLessThan(FAULT_LAYERS.crack + FAULT_LAYERS.chips + FAULT_LAYERS.settle);
    expect(partial.length).toBeGreaterThanOrEqual(FAULT_LAYERS.crack + FAULT_LAYERS.chips);
  });
  test("sv.b1 Active uses it, other moves keep the generic style, and the pool drains", () => {
    const fx = pool(), seen = new Map<string, string>();
    scanPlayers(fx, new Map<string, unknown>([["1", { x: 0, y: 90, z: 0, action: "Active", moveId: "sv.b1", actionStartTick: 9 }]]), seen);
    expect(fx.activeCount).toBe(FAULT_LAYERS.crack + FAULT_LAYERS.chips + FAULT_LAYERS.settle);
    fx.update(2);
    expect(fx.activeCount).toBe(0);
    expect(SV_RECIPES["sv.b2"]!.playActive).toBeUndefined();
  });
});
