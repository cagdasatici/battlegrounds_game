import type { CombatEvent } from "@eb/shared/protocol";
import { TD_DEFS } from "@eb/shared/config/kits/index";
import type { EffectsPool } from "../../scene/EffectsPool.js";
import { LOW_QUALITY_CAP, makeKitFx, playImpact, onHit as onHitWith, recipeParticles, scanPlayers as scanWith, type ActiveStyle, type Pos, type Recipe } from "./common.js";

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

/**
 * QV04 Undertow Spiral (td.b2). The drag ribbon exists only after a confirmed first `hit` (capture, +0): a narrow cyan
 * leading edge and a darker curved ribbon travel the server's 3 m / 36 tick drag (0.6 s) away from the caster, starting at
 * the victim. The second `hit` (+48) is the slam and uses the recipe's generic splash. A miss or block emits no `hit`, so
 * nothing victim-bound is drawn. Presentation only: duration is particle life, never a damage or movement timer.
 */
export const UNDERTOW = { dragM: 3, dragSec: 0.6, edge: 6, ribbon: 14, slamGapTicks: 60 } as const;
const EDGE = 0xa8f0ff, SHEET = 0x123f9c;
const firstHitTick = new Map<string, number>(); // actor id -> tick of the capture hit; removed by the slam or when stale
export function playUndertowHit(fx: EffectsPool, e: CombatEvent, at: Pos, actorAt: Pos | undefined): void {
  const prev = firstHitTick.get(e.actorId);
  if (prev !== undefined && e.tick - prev > 0 && e.tick - prev <= UNDERTOW.slamGapTicks) {
    firstHitTick.delete(e.actorId);
    playImpact(fx, TD_RECIPES["td.b2"]!, at);
    return;
  }
  if (firstHitTick.size >= 32) firstHitTick.clear(); // bounded; only drops a pending slam distinction
  firstHitTick.set(e.actorId, e.tick);
  if (!actorAt) return;
  let dx = at.x - actorAt.x, dz = at.z - actorAt.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-3) return;
  dx /= len; dz /= len;
  const px = -dz, pz = dx, speed = UNDERTOW.dragM / UNDERTOW.dragSec;
  for (let i = 0; i < UNDERTOW.edge; i++) { // leading edge: narrow, bright, fast
    const l = (i - (UNDERTOW.edge - 1) / 2) * 0.05;
    fx.spawn({ x: at.x + px * l, y: at.y, z: at.z + pz * l, vx: dx * speed, vy: 0, vz: dz * speed, life: UNDERTOW.dragSec, size: 0.12, color: EDGE });
  }
  for (let i = 0; i < UNDERTOW.ribbon; i++) { // darker curved sheet trailing the edge, bowed to one side
    const k = i / (UNDERTOW.ribbon - 1), back = k * 0.9, bow = Math.sin(k * Math.PI) * 0.45;
    fx.spawn({ x: at.x - dx * back + px * bow, y: at.y - 0.1 + 0.15 * Math.sin(k * Math.PI), z: at.z - dz * back + pz * bow, vx: dx * speed, vy: 0, vz: dz * speed, life: UNDERTOW.dragSec, size: 0.22, color: SHEET });
  }
}

/** One recipe per shipped td.* ability. Total particles per recipe stay under LOW_QUALITY_CAP (the low pool holds 200). */
export const TD_RECIPES: Readonly<Record<string, TdRecipe>> = {
  "td.b1": r(1.2, false, "ribbon", 24, AQUA, 2.4, 8),
  "td.b2": { ...r(1.1, false, "spiral", 28, DEEP, 2.2, 10), playHit: playUndertowHit, hitCount: UNDERTOW.edge + UNDERTOW.ribbon },
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
