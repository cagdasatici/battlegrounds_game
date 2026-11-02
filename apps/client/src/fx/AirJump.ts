import type { CombatBus } from "../app/CombatBus.js";
import type { EffectsPool } from "../scene/EffectsPool.js";
import { THEME, elementOf, scaled, sparkBurst, type Pt } from "./Impact.js";
import type { PresentationDeps } from "./index.js";

/**
 * DJ01 double jump presentation. Driven only by the replicated `airJumpUsed` flag (server authority): a false to true edge
 * on a fighter plays a quick flip on its rig and an element-tinted ring burst under its feet. Pooled glow primitives only,
 * counts scaled by the quality tier, nothing outlives the disposer. Presentation only.
 */

/** Seconds the rig flip lasts. */
export const AIR_JUMP_FLIP_S = 0.38;

/** Pure edge detector: ids whose flag went false to true since the last call. `prev` is updated and pruned in place. */
export function newAirJumps(players: Map<string, unknown>, prev: Map<string, boolean>): string[] {
  const fired: string[] = [];
  for (const [id, v] of players) {
    const used = (v as { airJumpUsed?: boolean }).airJumpUsed === true;
    if (used && prev.get(id) === false) fired.push(id);
    prev.set(id, used);
  }
  for (const id of [...prev.keys()]) if (!players.has(id)) prev.delete(id);
  return fired;
}

/** Ring burst under the feet: two expanding rings, a flash and a few sparks. */
export function playAirJumpBurst(fx: EffectsPool, kitId: string | undefined, feet: Pt): void {
  const theme = THEME[elementOf(kitId)];
  const g = fx.glow;
  g.ring({ x: feet.x, y: feet.y + 0.05, z: feet.z, color: theme.accent, radius: 1.5, from: 0.25, life: 0.3 });
  g.ring({ x: feet.x, y: feet.y + 0.07, z: feet.z, color: theme.core, radius: 0.95, from: 0.15, life: 0.22, delay: 0.04 });
  g.flash({ x: feet.x, y: feet.y + 0.15, z: feet.z, color: theme.accent, size: 0.8, grow: 1.4, life: 0.18 });
  sparkBurst(fx, { x: feet.x, y: feet.y + 0.1, z: feet.z }, theme.spark, scaled(fx, 8, 3), 3, 0.25, { width: 0.04, length: 0.35, gravity: 4 });
}

export const AirJumpFx = {
  attach(_bus: CombatBus, deps: PresentationDeps): () => void {
    const effects = deps.effects;
    if (!effects) return () => {};
    const prev = new Map<string, boolean>();
    let raf = 0, alive = true;
    const frame = (): void => {
      if (!alive) return;
      const players = deps.players();
      for (const id of newAirJumps(players, prev)) {
        const p = players.get(id) as { x: number; y: number; z: number; kitId?: string };
        const chest = { x: p.x / 100, y: p.y / 100, z: p.z / 100 };
        deps.fighters?.(id)?.tuck(AIR_JUMP_FLIP_S);
        playAirJumpBurst(effects, p.kitId, { x: chest.x, y: chest.y - 0.9, z: chest.z });
      }
      raf = requestAnimationFrame(frame);
    };
    if (typeof requestAnimationFrame === "function") raf = requestAnimationFrame(frame);
    return () => {
      alive = false;
      if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(raf);
      prev.clear();
    };
  },
};
