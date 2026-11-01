import { COMBAT } from "@eb/shared/config/combat";
import { isAlive } from "../../sim/ActionMachine.js";
import { buildCandidate, queryTargets, type AbilityHandler, type CastContext } from "../../sim/AbilityRunner.js";
import type { HitCandidate, HitResult } from "../../sim/HitResolver.js";

/**
 * sv.a2 Skybreak (spec 15, groundWave). All numbers are D.
 *
 * - Grounded only (requiresGrounded). The cast is invulnerable from commit through the LAST active tick
 *   (Fighter.invulnerableUntil = activeEnd, exclusive), so recovery is vulnerable. An invulnerable cast cannot be
 *   interrupted: the resolver refuses every hit and capture on the caster.
 * - The volume (box 20 wide, 8 high, 24 deep, forward of the commit-time aim) is queried once, at activeStart. It
 *   excludes victims behind a solid wall (queryTargets checks host.blocked on the pair), takes at most 4 targets,
 *   nearest first with the lowest entity id as tie break, and hits each target once: 100 HP, U, armorBreak,
 *   noncounterable, R120 F4 U20 (definition).
 * - The caster heals 60 HP once if any target takes damage (a lethal hit counts). A miss heals nothing; the form is
 *   spent at commit either way (framework consumesForm).
 */
export const SKYBREAK_HEAL100 = 6000;

/** Invulnerable from commit through the last active tick; shared with sv.a3 Horizon Break. */
export function grantCastInvulnerability(c: CastContext): void {
  c.fighter.invulnerableUntil = Math.max(c.fighter.invulnerableUntil, c.cast.activeEnd);
}

/** Heals `amount100` (capped at 100 HP) once per cast, keyed by `flag`. Returns true when it healed. */
export function healOnce(c: CastContext, flag: string, amount100: number): boolean {
  if (c.cast.data[flag] === true || !isAlive(c.fighter)) return false;
  c.cast.data[flag] = true;
  c.host.combat.heal(c.fighter, amount100, c.cast.def.id, c.tick);
  return true;
}

export const tookDamage = (r: HitResult): boolean => r.outcome === "hit" && r.damage100 > 0;

/** Spec 16: Skybreak's box is centred 2 m above the caster centre. */
export const SKYBREAK_BOX_CENTRE_Y = 2;

function candidates(c: CastContext): HitCandidate[] {
  const ap = c.host.pose(c.fighter.entityId);
  if (!ap || c.tick !== c.cast.activeStart) return [];
  return queryTargets(c, { boxCentreY: SKYBREAK_BOX_CENTRE_Y }).map((id) => buildCandidate(c, id, 0, ap.x, ap.z));
}

function onResults(c: CastContext, results: readonly HitResult[]): void {
  if (results.some(tookDamage)) healOnce(c, "healed", SKYBREAK_HEAL100);
}

export const GROUND_WAVE: AbilityHandler = {
  name: "groundWave",
  requiresGrounded: true,
  onCommit: grantCastInvulnerability,
  candidates,
  onResults,
};
