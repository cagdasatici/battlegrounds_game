import { forwardOf } from "@eb/shared/math";
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
/**
 * QV03 Fault Strike (sv.b1). Contact and settling are separate layers inside the legal footprint (handler wave box 2 m wide
 * by 8 m long ahead of the caster; direct strike 3 m ahead): a bright, fast, short-lived crack at the 3 m impact, two rows
 * of chips that split forward and left/right along the wave box, then dark low fragments that lie along the footprint and
 * outlast the chips. The generic windup ring is the grounded warning. Particle counts: 6 + 8 + 12 = 26.
 */
export const FAULT_FOOTPRINT = { forward: 8, halfWidth: 1, impactAt: 3 } as const;
const CRACK = 0xfff1c9, CHIP = 0xe8d9b8, FRAG = 0x4a3d2e;
export const FAULT_LAYERS = { crack: 6, chips: 8, settle: 12 } as const;
export function playFaultStrike(fx: EffectsPool, at: Pos, yaw: number, surface: (x: number, z: number, y: number) => number | null): void {
  const [dx, dz] = forwardOf(yaw), px = -dz, pz = dx; // forward and right (perpendicular)
  const pt = (f: number, l: number): { x: number; z: number } => ({ x: at.x + dx * f + px * l, z: at.z + dz * f + pz * l });
  const impact = pt(FAULT_FOOTPRINT.impactAt, 0);
  if (surface(impact.x, impact.z, at.y) === null) return; // impact over the void: nothing to crack
  // Contact: short bright crack flash at the impact point.
  for (let i = 0; i < FAULT_LAYERS.crack; i++) {
    const s = i % 2 ? 1 : -1, c = pt(FAULT_FOOTPRINT.impactAt, s * 0.25 * (1 + (i >> 1) * 0.8)), y = surface(c.x, c.z, at.y);
    if (y === null) continue;
    fx.spawn({ x: c.x, y: y + 0.12, z: c.z, vx: 0, vy: 0.4, vz: 0, life: 0.38, size: 0.9, color: CRACK });
  }
  // Split: chips leave the impact in two diverging rows; end points stay inside the wave box (lateral <= 0.9 at 8 m).
  const fwd = FAULT_FOOTPRINT.forward - FAULT_FOOTPRINT.impactAt, life = 0.4;
  for (let i = 0; i < FAULT_LAYERS.chips; i++) {
    const s = i % 2 ? 1 : -1, k = (i >> 1) / 3, f = fwd * (0.55 + 0.45 * k) / life, l = s * (0.15 + 0.2 * k) * 1.0 / life;
    const c = pt(FAULT_FOOTPRINT.impactAt, 0);
    fx.spawn({ x: c.x, y: at.y + 0.3, z: c.z, vx: dx * f + px * l, vy: 1.2, vz: dz * f + pz * l, life, size: 0.2, color: CHIP, gravity: 6 });
  }
  // Settling: dark fragments rest on the ground along the footprint and outlast the chips.
  for (let i = 0; i < FAULT_LAYERS.settle; i++) {
    const f = FAULT_FOOTPRINT.impactAt + ((i + 0.5) / FAULT_LAYERS.settle) * fwd, l = (i % 2 ? 1 : -1) * 0.7 * ((i % 3) / 2 + 0.2) * FAULT_FOOTPRINT.halfWidth;
    const c = pt(f, l), y = surface(c.x, c.z, at.y);
    if (y === null) continue;
    fx.spawn({ x: c.x, y: y + 0.06, z: c.z, vx: 0, vy: 0, vz: 0, life: 1.1, size: 0.28, color: FRAG });
  }
}

export const SV_RECIPES: Readonly<Record<string, SvRecipe>> = {
  "sv.b1": { ...r("sv.b1", false, "fracture", 26, SLATE, 3, 10), playActive: playFaultStrike },
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
