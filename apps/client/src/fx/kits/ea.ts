import { EA_DEFS } from "@eb/shared/config/kits/index";
import type { EffectsPool } from "../../scene/EffectsPool.js";
import type { CombatEvent } from "@eb/shared/protocol";
import { decalRadiusFor, makeKitFx, onHit as onHitWith, scanPlayers as scanWith, type ActiveStyle, type Pos, type Recipe } from "./common.js";

/**
 * Ember Artificer ability effects (FX4-ea). Heat language: expanding rings, rising heat particles and ember streams.
 * Windup telegraphs key on the replicated action Windup + moveId, active effects on Active, impacts on a bus `hit` with
 * the moveId. Presentation only; all particles come from the FX1 pool and expire by themselves.
 */

export type EaRecipe = Recipe;

const EMBER = 0xff7a1a, GOLD = 0xffc04d, RED = 0xff3d00;
const r = (id: string, glow: boolean, style: ActiveStyle, count: number, color: number, reach: number, impact: number): EaRecipe => ({
  windup: { decalRadius: decalRadiusFor(EA_DEFS, id), color: EMBER, glow },
  active: { style, count, color, life: 0.5, reach },
  impact: { count: impact, color: GOLD, life: 0.35, speed: 3.5 },
});

/** One recipe per shipped ea.* ability. Total particles per recipe stay under LOW_QUALITY_CAP (the low pool holds 200). */
export const EA_RECIPES: Readonly<Record<string, EaRecipe>> = {
  "ea.b1": r("ea.b1", true, "ribbon", 30, EMBER, 8, 8),
  "ea.b2": r("ea.b2", false, "heat", 28, RED, 3, 10),
  "ea.b3": r("ea.b3", true, "ribbon", 16, GOLD, 6, 12),
  "ea.b4": r("ea.b4", false, "heat", 36, EMBER, 4, 16),
  "ea.a1": r("ea.a1", false, "spiral", 32, RED, 3, 12),
  "ea.a2": r("ea.a2", true, "ring", 28, GOLD, 4, 12),
  "ea.a3": r("ea.a3", true, "ribbon", 48, RED, 24, 14),
  "ea.a4": r("ea.a4", true, "heat", 48, GOLD, 12, 20),
};

export const recipeFor = (moveId: string | undefined): EaRecipe | undefined => (moveId ? EA_RECIPES[moveId] : undefined);

export function scanPlayers(fx: EffectsPool, players: Map<string, unknown>, seen: Map<string, string>): void {
  scanWith(fx, players, seen, recipeFor);
}

export function onHit(fx: EffectsPool, e: CombatEvent, chest: (id: string) => Pos | undefined): void {
  onHitWith(fx, e, chest, recipeFor);
}

export const EaFx = makeKitFx(recipeFor);
