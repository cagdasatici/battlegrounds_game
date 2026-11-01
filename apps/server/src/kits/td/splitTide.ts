import { buildCandidate, dueHitIndices, queryTargets, type AbilityHandler, type CastContext } from "../../sim/AbilityRunner.js";
import type { HitCandidate } from "../../sim/HitResolver.js";

/**
 * td.a3 Split Tide (spec 15, awakened slot 3). Two probes at activeStart + [0, 17] on the definition box. The first
 * deals 12 HP with stun 30 (no ragdoll, no launch), the second 26 HP with R72 F10 U4. Both are counterable, U (guard
 * bypass), no armorBreak and no capture. The same victim can take both (38). A missed first probe leaves the second
 * valid (26). Armor lasts from commit through the last active tick (definition armor startup extended by
 * `armorUntil = activeEnd`). A first hit that is interrupted (armorBreak, death, stun without armor) ends the cast,
 * so the later probe never fires: every phase is tied to the cast and action generation.
 */
export const SPLIT_TIDE_FIRST_STUN_TICKS = 30;
export const SPLIT_TIDE_SECOND_RAGDOLL_TICKS = 72;

function onCommit(c: CastContext): void {
  c.cast.armorUntil = c.cast.activeEnd;
}

function candidates(c: CastContext): HitCandidate[] {
  const ap = c.host.pose(c.fighter.entityId);
  if (!ap) return [];
  const out: HitCandidate[] = [];
  for (const i of dueHitIndices(c.cast, c.tick)) {
    for (const id of queryTargets(c)) {
      const cand = buildCandidate(c, id, i, ap.x, ap.z);
      if (i === 0) {
        cand.reaction = { kind: "stun", ticks: SPLIT_TIDE_FIRST_STUN_TICKS };
        cand.launch = { forward: 0, up: 0 };
      } else {
        cand.reaction = { kind: "ragdoll", ticks: SPLIT_TIDE_SECOND_RAGDOLL_TICKS };
      }
      out.push(cand);
    }
  }
  return out;
}

export const SPLIT_TIDE: AbilityHandler = { name: "splitTide", onCommit, candidates };
