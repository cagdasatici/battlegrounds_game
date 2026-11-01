import type { CombatEvent } from "@eb/shared/protocol";
import { TD_DEFS } from "@eb/shared/config/kits/index";
import type { EffectsPool } from "../../scene/EffectsPool.js";
import { LOW_QUALITY_CAP, makeKitFx, onHit as onHitWith, recipeParticles, scanPlayers as scanWith, type ActiveStyle, type Pos, type Recipe } from "./common.js";

export { LOW_QUALITY_CAP, recipeParticles };
export type { ActiveStyle };
export { playActive, playImpact, playWindup } from "./common.js";

/**
 * Tide Duelist ability effects (FX4-td). Water language: ribbon arcs, spirals and rising droplets. Windup telegraphs key
 * on the replicated action Windup + moveId, active effects on Active, impacts on a bus `hit` with the moveId. All
 * particles come from the FX1 pool and expire by themselves. Presentation only; nothing reads or feeds the simulation.
 */

export type TdRecipe = Recipe;

const AQUA = 0x37c8ff, DEEP = 0x1f6fff, FOAM = 0xd8f6ff;
const r = (decalRadius: number, glow: boolean, style: ActiveStyle, count: number, color: number, reach: number, impact: number): TdRecipe => ({
  windup: { decalRadius, color: AQUA, glow },
  active: { style, count, color, life: 0.4, reach },
  impact: { count: impact, color: FOAM, life: 0.3, speed: 4 },
});

/** One recipe per shipped td.* ability. Total particles per recipe stay under LOW_QUALITY_CAP (the low pool holds 200). */
export const TD_RECIPES: Readonly<Record<string, TdRecipe>> = {
  "td.b1": r(1.2, false, "ribbon", 24, AQUA, 2.4, 8),
  "td.b2": r(1.1, false, "spiral", 28, DEEP, 2.2, 10),
  "td.b3": r(1.1, true, "arc", 20, AQUA, 2.2, 12),
  "td.b4": r(2, false, "ring", 24, FOAM, 4, 12),
  "td.a1": r(1.3, false, "ribbon", 30, DEEP, 2.5, 8),
  "td.a2": r(2, false, "spiral", 36, DEEP, 4, 20),
  "td.a3": r(1.5, false, "arc", 28, AQUA, 3, 14),
  "td.a4": r(1, true, "ribbon", 30, AQUA, 9, 12),
};

export const recipeFor = (moveId: string | undefined): TdRecipe | undefined => (moveId ? TD_RECIPES[moveId] : undefined);

/** Ground decal radius from the ability definition's shape; used by tests to keep recipes honest. */
export function shapeRadius(moveId: string): number | undefined {
  const s = TD_DEFS.find((d) => d.id === moveId)?.shape;
  if (!s) return undefined;
  return s.kind === "sphere" ? s.r : s.kind === "box" ? s.w / 2 : s.radius;
}

export function scanPlayers(fx: EffectsPool, players: Map<string, unknown>, seen: Map<string, string>): void {
  scanWith(fx, players, seen, recipeFor);
}

export function onHit(fx: EffectsPool, e: CombatEvent, chest: (id: string) => Pos | undefined): void {
  onHitWith(fx, e, chest, recipeFor);
}

export const TdFx = makeKitFx(recipeFor);
