import { forwardOf } from "@eb/shared/math";
import { EA_DEFS } from "@eb/shared/config/kits/index";
import type { EffectsPool } from "../../scene/EffectsPool.js";
import type { CombatEvent } from "@eb/shared/protocol";
import { decalRadiusFor, makeKitFx, type SustainCtx, onHit as onHitWith, scanPlayers as scanWith, type ActiveStyle, type Pos, type Recipe } from "./common.js";

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

/**
 * QV05 Furnace Ray (ea.a3). While the replicated action is Active, a thin bright core inside a tapering orange sheath is
 * redrawn every EMIT_TICKS along the current aim, ending at the first cover (the client's cover query, same as the
 * warning). It stops the frame the replicated action leaves Active (interruption, death) or the server tick reaches the
 * active end; leftover particles live at most BEAM_LIFE seconds. A brighter flare marks each pulse tick
 * (activeStart + hitOffsets[i], the server's schedule). Presentation only: no damage, no timers, just particle life.
 */
const RAY = EA_DEFS.find((d) => d.id === "ea.a3")!;
const RAY_LEN = RAY.shape.kind === "beam" ? RAY.shape.length : 24;
export const FURNACE = { emitTicks: 4, life: 0.12, core: 12, sheath: 12, flare: 8, flareLife: 0.25, originForward: 0.6, originUp: 0.4, pulses: RAY.hitOffsets, length: RAY_LEN } as const;
const CORE = 0xfff1b0, SHEATH = 0xff7a1a;
export function playFurnaceRay(fx: EffectsPool, c: SustainCtx): void {
  const [dx, dz] = forwardOf(c.yaw);
  const ox = c.at.x + dx * FURNACE.originForward, oz = c.at.z + dz * FURNACE.originForward, oy = c.at.y + 1;
  const len = c.cover ? Math.min(FURNACE.length, c.cover(ox, oy - 1 + FURNACE.originUp, oz, dx, dz, FURNACE.length)) : FURNACE.length;
  if (len <= 0) return;
  const px = -dz, pz = dx;
  const due = FURNACE.pulses.findIndex((o, i) => i > c.state.lastPulse && c.startTick + o <= c.tick);
  if (due >= 0) { // flare for the newest pulse due; the pulse index is remembered so each fires once
    let last = due;
    for (let i = due; i < FURNACE.pulses.length && c.startTick + FURNACE.pulses[i]! <= c.tick; i++) last = i;
    c.state.lastPulse = last;
    for (let i = 0; i < FURNACE.flare; i++) {
      const d = ((i + 0.5) / FURNACE.flare) * len;
      fx.spawn({ x: ox + dx * d, y: oy, z: oz + dz * d, vx: 0, vy: 0.8, vz: 0, life: FURNACE.flareLife, size: 0.6, color: GOLD });
    }
  }
  if (c.state.lastEmit >= 0 && c.tick - c.state.lastEmit < FURNACE.emitTicks) return;
  c.state.lastEmit = c.tick;
  for (let i = 0; i < FURNACE.core; i++) {
    const d = (((i + 0.5) / FURNACE.core) ** 1.5) * len;
    fx.spawn({ x: ox + dx * d, y: oy, z: oz + dz * d, vx: 0, vy: 0, vz: 0, life: FURNACE.life, size: 0.5, color: CORE });
  }
  for (let i = 0; i < FURNACE.sheath; i++) {
    const k = (i + 0.5) / FURNACE.sheath, d = (k ** 1.5) * len, half = 0.8 * (1 - k) + 0.12, side = i % 2 === 0 ? half : -half; // tapers with distance
    fx.spawn({ x: ox + dx * d + px * side, y: oy, z: oz + dz * d + pz * side, vx: 0, vy: 0, vz: 0, life: FURNACE.life, size: 0.75, color: SHEATH });
  }
}

/** One recipe per shipped ea.* ability. Total particles per recipe stay under LOW_QUALITY_CAP (the low pool holds 200). */
export const EA_RECIPES: Readonly<Record<string, EaRecipe>> = {
  "ea.b1": r("ea.b1", true, "ribbon", 30, EMBER, 8, 8),
  "ea.b2": r("ea.b2", false, "heat", 28, RED, 3, 10),
  "ea.b3": r("ea.b3", true, "ribbon", 16, GOLD, 6, 12),
  "ea.b4": r("ea.b4", false, "heat", 36, EMBER, 4, 16),
  "ea.a1": r("ea.a1", false, "spiral", 32, RED, 3, 12),
  "ea.a2": r("ea.a2", true, "ring", 28, GOLD, 4, 12),
  "ea.a3": { ...r("ea.a3", true, "ribbon", 6, RED, 4, 14), sustain: playFurnaceRay, sustainPeak: (FURNACE.core + FURNACE.sheath) * 2 + FURNACE.flare },
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
