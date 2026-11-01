import { COMBAT } from "@eb/shared/config/combat";
import { isAlive } from "../../sim/ActionMachine.js";
import type { AbilityHost } from "../../sim/AbilityRunner.js";

/**
 * Area helper for the Ember Artificer awakened blasts (T21, decision 0022). Targets are alive fighters other than
 * `exclude`, within `radius` (3D, capsule aware) of a centre, in static line of sight of it, nearest first with the
 * lowest entity id as tie break, at most `max`.
 */
export function areaTargets(
  host: AbilityHost, centre: { x: number; y: number; z: number }, radius: number, max: number, exclude: readonly number[],
): number[] {
  const near: { id: number; d: number }[] = [];
  for (const t of host.combat.all()) {
    if (exclude.includes(t.entityId) || !isAlive(t)) continue;
    const tp = host.pose(t.entityId);
    if (!tp) continue;
    if (host.blocked([centre.x, centre.y, centre.z], [tp.x, tp.y, tp.z])) continue;
    const dy = Math.max(0, Math.abs(tp.y - centre.y) - COMBAT.capsule.halfHeight);
    const d = Math.hypot(Math.hypot(tp.x - centre.x, tp.z - centre.z), dy);
    if (d <= radius + COMBAT.capsule.radius) near.push({ id: t.entityId, d });
  }
  near.sort((a, b) => a.d - b.d || a.id - b.id);
  return near.slice(0, max).map((n) => n.id);
}
