import { SV_DEFS } from "@eb/shared/config/kits/index";
import type { EffectsPool } from "../../scene/EffectsPool.js";
import type { CombatEvent } from "@eb/shared/protocol";
import { decalRadiusFor, makeKitFx, onHit as onHitWith, scanPlayers as scanWith, type ActiveStyle, type Pos, type Recipe } from "./common.js";

/**
 * Stone Vanguard ability effects (FX4-sv). Stone language: fans of thrown chips and circular fractures in the ground.
 * Windup telegraphs key on the replicated action Windup + moveId, active effects on Active, impacts on a bus `hit` with
 * the moveId. Presentation only; all particles come from the FX1 pool and expire by themselves.
 */

export type SvRecipe = Recipe;

const OCHRE = 0xc9a56a, SLATE = 0x6b5a45, DUST = 0xe8d9b8;
const r = (id: string, glow: boolean, style: ActiveStyle, count: number, color: number, reach: number, impact: number): SvRecipe => ({
  windup: { decalRadius: decalRadiusFor(SV_DEFS, id), color: OCHRE, glow },
  active: { style, count, color, life: 0.5, reach },
  impact: { count: impact, color: DUST, life: 0.35, speed: 3.5 },
});

/** One recipe per shipped sv.* ability. Total particles per recipe stay under LOW_QUALITY_CAP (the low pool holds 200). */
export const SV_RECIPES: Readonly<Record<string, SvRecipe>> = {
  "sv.b1": r("sv.b1", false, "fracture", 24, SLATE, 3, 10),
  "sv.b2": r("sv.b2", true, "fan", 30, OCHRE, 6, 8),
  "sv.b3": r("sv.b3", false, "fan", 20, DUST, 4, 10),
  "sv.b4": r("sv.b4", false, "fracture", 32, SLATE, 2.5, 14),
  "sv.a1": r("sv.a1", false, "ring", 24, DUST, 3, 12),
  "sv.a2": r("sv.a2", false, "fracture", 56, SLATE, 10, 20),
  "sv.a3": r("sv.a3", true, "fan", 50, OCHRE, 32, 20),
  "sv.a4": r("sv.a4", false, "fracture", 40, SLATE, 4, 16),
  "sv.x1": r("sv.x1", false, "fan", 16, OCHRE, 2.5, 8),
  "sv.x2": r("sv.x2", false, "fan", 20, DUST, 3, 8),
  "sv.x3": r("sv.x3", true, "fracture", 24, SLATE, 4, 14),
};

export const recipeFor = (moveId: string | undefined): SvRecipe | undefined => (moveId ? SV_RECIPES[moveId] : undefined);

export function scanPlayers(fx: EffectsPool, players: Map<string, unknown>, seen: Map<string, string>): void {
  scanWith(fx, players, seen, recipeFor);
}

export function onHit(fx: EffectsPool, e: CombatEvent, chest: (id: string) => Pos | undefined): void {
  onHitWith(fx, e, chest, recipeFor);
}

export const SvFx = makeKitFx(recipeFor);
