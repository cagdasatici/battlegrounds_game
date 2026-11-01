import { COMBAT } from "@eb/shared/config/combat";
import { buildCandidate, forwardOf, queryTargets, type AbilityHandler, type CastContext } from "../../sim/AbilityRunner.js";
import type { HitCandidate, HitResult } from "../../sim/HitResolver.js";
import { grantCastInvulnerability, healOnce, tookDamage } from "./groundWave.js";

/**
 * sv.a3 Horizon Break (spec 15, longBeam). All numbers are D.
 *
 * - Grounded only; same invulnerability window as Skybreak (commit through the last active tick).
 * - The beam (length 32, radius 3) runs forward from the caster at the commit-time aim. It is queried once, at
 *   activeStart, and truncated at the first solid obstacle: the obstruction distance is found by bisecting
 *   host.blocked along the forward ray (monotone: a longer segment stays blocked once it crosses a wall), so no new
 *   host raycast is needed. Targets must satisfy 0 <= forward distance <= truncated length (no damage behind the
 *   caster, beyond 32 m or beyond the obstruction) and must not be occluded themselves (queryTargets).
 * - Targets with horizontal distance <= 8 m take 100 HP, farther ones 60 HP; at most 4, nearest first, ties by id;
 *   one hit per target; R90 F22 U5 (definition), U, armorBreak, noncounterable.
 * - Heal: to full if any NEAR target takes damage, otherwise 30 HP once if any far target takes damage.
 */
export const NEAR_RANGE_M = 8;
export const NEAR_DAMAGE100 = 10000;
export const FAR_DAMAGE100 = 6000;
export const FAR_HEAL100 = 3000;
const BISECT_STEPS = 18;

/** Distance from the caster along its aim to the first solid obstacle, or the full beam length when clear. */
export function beamLengthOf(c: CastContext): number {
  const ap = c.host.pose(c.fighter.entityId);
  const max = c.cast.def.shape.kind === "beam" ? c.cast.def.shape.length : c.cast.def.range;
  if (!ap) return 0;
  const [fx, fz] = forwardOf(c.cast.aimYaw);
  const o: [number, number, number] = [ap.x, ap.y, ap.z];
  const at = (d: number): [number, number, number] => [ap.x + fx * d, ap.y, ap.z + fz * d];
  if (!c.host.blocked(o, at(max))) return max;
  let lo = 0, hi = max;
  for (let i = 0; i < BISECT_STEPS; i++) {
    const mid = (lo + hi) / 2;
    if (c.host.blocked(o, at(mid))) hi = mid; else lo = mid;
  }
  return lo;
}

function candidates(c: CastContext): HitCandidate[] {
  const ap = c.host.pose(c.fighter.entityId);
  if (!ap || c.tick !== c.cast.activeStart) return [];
  const len = beamLengthOf(c);
  const [fx, fz] = forwardOf(c.cast.aimYaw);
  const ids = queryTargets(c, {
    maxLength: len,
    filter: (_t, tp) => { const fwd = (tp.x - ap.x) * fx + (tp.z - ap.z) * fz; return fwd >= 0 && fwd <= len; },
  });
  const near: number[] = [];
  const out = ids.map((id) => {
    const tp = c.host.pose(id)!;
    const isNear = Math.hypot(tp.x - ap.x, tp.z - ap.z) <= NEAR_RANGE_M;
    if (isNear) near.push(id);
    return { ...buildCandidate(c, id, 0, ap.x, ap.z), damage100: isNear ? NEAR_DAMAGE100 : FAR_DAMAGE100 };
  });
  c.cast.data.nearIds = near;
  return out;
}

function onResults(c: CastContext, results: readonly HitResult[]): void {
  const near = (c.cast.data.nearIds as number[] | undefined) ?? [];
  const damaged = results.filter(tookDamage);
  if (damaged.some((r) => near.includes(r.candidate.targetId))) healOnce(c, "healedNear", COMBAT.hp100Max);
  else if (damaged.length > 0) healOnce(c, "healedFar", FAR_HEAL100);
}

export const LONG_BEAM: AbilityHandler = {
  name: "longBeam",
  requiresGrounded: true,
  onCommit: grantCastInvulnerability,
  candidates,
  onResults,
};
