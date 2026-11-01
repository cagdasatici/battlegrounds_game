import { isAlive, isInvulnerable, isProtected, type Fighter } from "../../sim/ActionMachine.js";
import type { AbilityHandler, AbilityPose, CastContext } from "../../sim/AbilityRunner.js";
import { makeSequenceHandler, seqOf, type SequenceSpec } from "./sequence.js";

/**
 * Shared parts of the Tide Duelist awakened moves (T16, spec 15). All numbers are D.
 *
 * A capture probe skips fighters the resolver would refuse anyway (protected, invulnerable, shielded by another
 * cinematic capture) so they never block a farther valid victim, and a probe tick offers only the nearest valid
 * victim: one cast captures at most one victim even when two overlap in the same tick.
 */
export const awakenedEligible = (target: Fighter, _pose: AbilityPose, c: CastContext): boolean =>
  isAlive(target) && !isProtected(target, c.tick) && !isInvulnerable(target, c.tick)
  && !c.host.combat.captures.shieldsFrom(target.entityId, c.fighter.entityId);

/** A sequence handler whose probe offers one victim per tick. */
export function makeAwakenedSequence(spec: SequenceSpec): AbilityHandler {
  const base = makeSequenceHandler({ ...spec, eligible: spec.eligible ?? awakenedEligible });
  return {
    ...base,
    candidates(c) {
      const out = base.candidates!(c);
      return seqOf(c).victimId === null ? out.slice(0, 1) : out;
    },
  };
}
