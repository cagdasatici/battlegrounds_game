import {
  buildCandidate, dueHitIndices, queryTargets, type AbilityHandler, type CastContext,
} from "../../sim/AbilityRunner.js";
import type { HitCandidate } from "../../sim/HitResolver.js";

/**
 * ea.b1 Cinder Array (spec 15). Six scheduled hits at activeStart + [0,8,16,24,32,39], B, max 3 targets, moveScale 0.2,
 * turnRate 90 deg/s (definition). All numbers are D.
 *
 *  - The damage branch of a target is snapshotted at the first candidate produced for that victim life and never
 *    re-read: standing or airborne targets take [2,2,2,2,3,10], ragdolled targets [1,1,1,1,2,7].
 *  - Intermediate hits stun 12 (definition); a victim that is already Ragdolled keeps its ragdoll (reaction none).
 *    The final hit is R72 F3 U9.
 *  - An airborne caster is held at zero vertical velocity through the active ticks (freezeVertical).
 *  - Interruption, death or capture ends the cast through the framework, which voids every later hit.
 */
export const RAGDOLL_DAMAGE100: readonly number[] = [100, 100, 100, 100, 200, 700];
export const FINAL_RAGDOLL_TICKS = 72;
export const FINAL_LAUNCH = { forward: 3, up: 9 } as const;

type Branch = "standing" | "ragdoll";

function candidates(c: CastContext): HitCandidate[] {
  const ap = c.host.pose(c.fighter.entityId);
  if (!ap) return [];
  const d = c.cast.def;
  const last = d.hitOffsets.length - 1;
  const branches = (c.cast.data.branches ??= new Map<string, Branch>()) as Map<string, Branch>;
  const out: HitCandidate[] = [];
  for (const i of dueHitIndices(c.cast, c.tick)) {
    for (const id of queryTargets(c)) {
      const victim = c.host.combat.get(id)!;
      const key = `${id}:${victim.lifeId}`;
      let branch = branches.get(key);
      if (!branch) { branch = victim.action === "Ragdolled" ? "ragdoll" : "standing"; branches.set(key, branch); }
      const k = buildCandidate(c, id, i, ap.x, ap.z);
      if (branch === "ragdoll") k.damage100 = RAGDOLL_DAMAGE100[i]!;
      if (i === last) { k.reaction = { kind: "ragdoll", ticks: FINAL_RAGDOLL_TICKS }; k.launch = { ...FINAL_LAUNCH }; }
      else if (victim.action === "Ragdolled") k.reaction = { kind: "none" };
      out.push(k);
    }
  }
  return out;
}

export const CINDER_ARRAY: AbilityHandler = {
  name: "cinderArray",
  candidates,
  freezeVertical: (c) => c.tick >= c.cast.activeStart && c.tick < c.cast.activeEnd,
};
