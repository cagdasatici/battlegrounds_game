import { buildCandidate, dueHitIndices, queryTargets, type AbilityHandler, type CastContext } from "../../sim/AbilityRunner.js";
import type { HitCandidate } from "../../sim/HitResolver.js";

/**
 * sv.b4 Rising Pillar (spec 15). Default scheduled query on the definition shape (2 m box, yaw only):
 * supports standing, airborne and ragdolled targets; hit R84 F1 U11 (definition); a target captured by another
 * attacker is ineligible (spec 15), so the query passes excludeCaptured.
 *
 * - No extra landing damage: this handler never attaches a LandingBonusBook entry.
 * - Aerial use relies only on the authoritative capsule poses (attacker y vs target y); the pitch of the client
 *   camera is never an input to the server query.
 * - Animation playback speed is client presentation. The active tick comes from the definition ticks and the
 *   launch velocity from def.launch, so neither can depend on animation timing.
 */
function candidates(c: CastContext): HitCandidate[] {
  const ap = c.host.pose(c.fighter.entityId);
  if (!ap) return [];
  const out: HitCandidate[] = [];
  for (const i of dueHitIndices(c.cast, c.tick)) {
    for (const id of queryTargets(c, { excludeCaptured: true })) out.push(buildCandidate(c, id, i, ap.x, ap.z));
  }
  return out;
}

export const LAUNCHER: AbilityHandler = { name: "launcher", candidates };
