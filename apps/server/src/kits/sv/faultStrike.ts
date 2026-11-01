import type { Shape } from "@eb/shared/abilities";
import { buildCandidate, queryTargets, type AbilityHandler, type CastContext } from "../../sim/AbilityRunner.js";
import type { HitCandidate, HitResult } from "../../sim/HitResolver.js";

/**
 * sv.b1 Fault Strike (spec 15). Mutually exclusive damage branch per target:
 *   direct (def): 20 HP, R72 F14 U4, U, query window = active ticks, deduplicated per target;
 *   wave (activeStart tick only): box 2x2x8, 10 HP, R36 F6 U1, B, standing/air targets not directly struck;
 *   landing bonus (direct victims only): +10 HP on the first new ground contact after >=1 airborne tick, 120 tick
 *   expiry, handled by LandingBonusBook so it outlives the cast. Never 20+10+10 on one target.
 * Maximum 4 targets across direct and wave. Hit indices: 0 direct, 1 wave, 100 landing.
 */
export const WAVE_SHAPE = { kind: "box", w: 2, h: 2, d: 8 } as const satisfies Shape;
export const WAVE_DAMAGE100 = 1000;
export const WAVE_RAGDOLL_TICKS = 36;
export const WAVE_LAUNCH = { forward: 6, up: 1 } as const;
export const LANDING_DAMAGE100 = 1000;
export const LANDING_EXPIRY_TICKS = 120;
const WAVE_INDEX = 1;

function candidates(c: CastContext): HitCandidate[] {
  const ap = c.host.pose(c.fighter.entityId);
  if (!ap || c.tick < c.cast.activeStart || c.tick >= c.cast.activeEnd) return [];
  const ledger = c.host.combat.ledger;
  const out: HitCandidate[] = [];
  const direct = queryTargets(c);
  for (const id of direct) out.push(buildCandidate(c, id, 0, ap.x, ap.z));
  if (c.tick === c.cast.activeStart) {
    const room = c.cast.def.maxTargets - ledger.targetsHit(c.fighter.entityId, c.cast.castCounter) - direct.length;
    if (room > 0) {
      const wave = queryTargets(c, { shape: WAVE_SHAPE, range: WAVE_SHAPE.d, targetStates: ["standing", "air"] })
        .filter((id) => !direct.includes(id)).slice(0, room);
      for (const id of wave) {
        out.push({
          ...buildCandidate(c, id, WAVE_INDEX, ap.x, ap.z), block: "B", damage100: WAVE_DAMAGE100,
          reaction: { kind: "ragdoll", ticks: WAVE_RAGDOLL_TICKS }, launch: { ...WAVE_LAUNCH },
        });
      }
    }
  }
  return out;
}

function onResults(c: CastContext, results: readonly HitResult[]): void {
  for (const r of results) {
    const k = r.candidate;
    if (r.outcome !== "hit" || r.killed || k.hitIndex !== 0) continue; // only a direct hit that dealt damage
    const victim = c.host.combat.get(k.targetId);
    if (!victim) continue;
    c.runner.landing.attach(victim, {
      attackerId: k.attackerId, attackerLifeId: c.fighter.lifeId, victimId: k.targetId, victimLifeId: victim.lifeId,
      castCounter: k.castCounter, moveId: k.moveId, damage100: LANDING_DAMAGE100, expireTick: c.tick + LANDING_EXPIRY_TICKS,
    });
  }
}

export const FAULT_STRIKE: AbilityHandler = { name: "faultStrike", candidates, onResults };
