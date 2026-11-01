import { COMBAT } from "@eb/shared/config/combat";
import { isAlive, isInvulnerable, isProtected } from "../../sim/ActionMachine.js";
import type { AbilityHandler, CastContext } from "../../sim/AbilityRunner.js";
import type { HitResult } from "../../sim/HitResolver.js";
import { makeSequenceHandler } from "../td/sequence.js";

/**
 * sv.a4 Orbit Collapse (spec 15, cinematicGrab), built on the shared capture sequence (td/sequence.ts). All
 * numbers are D.
 *
 * - Probe: at every active tick (activeStart .. activeEnd - 1) the nearest ELIGIBLE victim inside the 3 m grab box is
 *   captured, ties by lowest entity id. Ineligible fighters (protected, invulnerable, shielded by another cinematic
 *   capture, captured, dead) are skipped so they never block a farther valid victim. One victim per cast.
 * - Capture is cinematic: both participants are shielded from third parties (CaptureRegistry.shieldsFrom). No
 *   capsule is moved: the sequence is anchored where the capture happened.
 * - Damage 100 HP (lethal cap) at capture + 90, noncounterable, U; release at capture + 96 with R90 F6 U10; the
 *   36 tick recovery then follows. The capture hit itself deals no damage (hitOffsets [0, 90], damage [0, 100 HP]).
 * - A miss goes straight to recovery at the end of the active window (no capture extension); a later victim can
 *   never be attached from recovery.
 * - The caster heals to full when the scheduled damage lands (a lethal hit counts). The cosmetic shockwave has no
 *   damage. Victim death or departure releases the captor into 18 ticks of recovery (Combat.applyReleases); caster
 *   death or interruption releases the victim (sequence onEnd). Nothing orphaned remains.
 */
export const GRAB_RELEASE_OFFSET = 96;
export const GRAB_DAMAGE_INDEX = 1;

const base = makeSequenceHandler({
  name: "cinematicGrab",
  cinematic: true,
  releaseOffset: GRAB_RELEASE_OFFSET,
  eligible: (target, _pose, c: CastContext) =>
    isAlive(target) && !isProtected(target, c.tick) && !isInvulnerable(target, c.tick)
    && !c.host.combat.captures.shieldsFrom(target.entityId, c.fighter.entityId),
});

export const CINEMATIC_GRAB: AbilityHandler = {
  ...base,
  onResults(c, results: readonly HitResult[]) {
    base.onResults?.(c, results);
    if (c.cast.data.healed === true || !isAlive(c.fighter)) return;
    for (const r of results) {
      if (r.candidate.hitIndex !== GRAB_DAMAGE_INDEX || r.outcome !== "hit" || r.damage100 <= 0) continue;
      c.cast.data.healed = true;
      c.fighter.hp100 = COMBAT.hp100Max;
      return;
    }
  },
};
