import { COMBAT } from "@eb/shared/config/combat";
import type { Fighter } from "./ActionMachine.js";
import type { HitCandidate } from "./HitResolver.js";
import { m1Overlaps, type M1Pose } from "./M1.js";

const D = COMBAT.dash.forward; // ticks 18, hitTicks 3, damage 4, stunTicks 24

/**
 * Forward dash attack (spec 11): the last `hitTicks` ticks of a forward dash carry the M1 sized hitbox.
 *
 * Tunneling: at 22 m/s the dash moves 22 / 60 = 0.37 m per tick, far less than the 1.8 m box depth, so a
 * per tick overlap test against the current server poses cannot skip over a target.
 * Deduplication across the 3 ticks is the HitLedger (maxHitsPerTarget 1 for this castCounter);
 * CombatSystem.pruneLedger keeps the entry while `f.dash` is set.
 * `m1Overlaps` uses facingYaw, which equals the dash direction for a forward dash (the only kind that hits).
 */
export function dashCandidates(tick: number, fighters: readonly Fighter[], poseOf: (id: number) => M1Pose | undefined,
  occluded: (a: M1Pose, t: M1Pose) => boolean = () => false): HitCandidate[] {
  const out: HitCandidate[] = [];
  for (const a of fighters) {
    if (a.action !== "Dash" || a.dash?.kind !== "forward") continue;
    if (tick < a.actionStartTick + D.ticks - D.hitTicks || tick >= a.actionEndTick) continue;
    const ap = poseOf(a.entityId);
    if (!ap) continue;
    for (const t of fighters) {
      if (t.entityId === a.entityId || t.action === "Dead") continue;
      const tp = poseOf(t.entityId);
      if (!tp || !m1Overlaps(ap, tp, null) || occluded(ap, tp)) continue;
      out.push({
        attackerId: a.entityId, attackerGeneration: a.generation, castCounter: a.castCounter, hitIndex: 0, toi: 0,
        targetId: t.entityId, moveId: "dash.forward", originX: ap.x, originZ: ap.z, block: "B", counterable: true,
        armorBreak: false, damage100: D.damage * 100, reaction: { kind: "stun", ticks: D.stunTicks }, maxHitsPerTarget: 1,
      });
    }
  }
  return out;
}
