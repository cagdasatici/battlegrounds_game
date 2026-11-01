import { meleeCandidates, type AbilityHandler, type CastContext } from "../../sim/AbilityRunner.js";
import type { HitCandidate } from "../../sim/HitResolver.js";

/**
 * sv.b2 Gravel Flurry (spec 15). The default scheduler queries each tick group once per target
 * (hitOffsets [0,8,16,24,32,39], damage 2,2,2,2,2,5 HP, max 15 per target, max 3 targets). This handler
 * overrides the per-hit reaction only:
 *   - intermediate hits: stun 12 (definition); a target that is already Ragdolled keeps its ragdoll (D: reaction
 *     none, damage only) so the flurry supports ragdolled targets without shortening their ragdoll;
 *   - final hit (last scheduled index): R60 F7 U2.
 * No capture, no armor. A third party hit or any stun cancels the generation, which voids the remaining hits.
 */
export const FINAL_RAGDOLL_TICKS = 60;
export const FINAL_LAUNCH = { forward: 7, up: 2 } as const;

function candidates(c: CastContext): HitCandidate[] {
  const last = c.cast.def.hitOffsets.length - 1;
  return meleeCandidates(c).map((k) => {
    if (k.hitIndex === last) return { ...k, reaction: { kind: "ragdoll", ticks: FINAL_RAGDOLL_TICKS }, launch: { ...FINAL_LAUNCH } };
    const v = c.host.combat.get(k.targetId);
    return v?.action === "Ragdolled" ? { ...k, reaction: { kind: "none" } } : k;
  });
}

export const BARRAGE: AbilityHandler = { name: "barrage", candidates };
