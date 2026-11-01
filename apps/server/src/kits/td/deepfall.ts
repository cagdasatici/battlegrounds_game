import { COMBAT } from "@eb/shared/config/combat";
import { isAlive } from "../../sim/ActionMachine.js";
import { buildCandidate, type AbilityHandler, type CastContext } from "../../sim/AbilityRunner.js";
import type { HitCandidate } from "../../sim/HitResolver.js";
import { holdsCapture, seqOf } from "./sequence.js";
import { makeAwakenedSequence } from "./awakened.js";

/**
 * td.a2 Deepfall (spec 15, awakened slot 2, once per form). Startup armor (definition), then a cinematic capture
 * that shields both participants from third parties. The capture hit deals nothing; 69 HP lands at capture + 72 and
 * the victim is released at +78 with R90 F4 U12. On the final impact (capture + 72, while this cast still holds the
 * capture) other fighters within 4 m of the victim, in 3D and in static line of sight of the impact, take 20 HP
 * (U, noncounterable, R60 F6 U4), at most 3 of them so the cast touches 4 fighters at most. The original victim and
 * the caster never take area damage. A miss spends the use (framework oncePerForm at commit). Area targets are
 * nearest first with the lowest entity id as tie break.
 */
export const DEEPFALL_RELEASE_OFFSET = 78;
export const DEEPFALL_IMPACT_OFFSET = 72;
export const DEEPFALL_AREA_RADIUS = 4;
export const DEEPFALL_AREA_DAMAGE100 = 2000;
export const DEEPFALL_AREA_RAGDOLL_TICKS = 60;
/**
 * The area hits use hit index 0 on purpose: the resolver orders by hit index, so they resolve before the 69 HP final hit
 * (index 1) of the same tick. A lethal final hit then ends the captor's cast (stale generation) without taking the area
 * with it, and the order never depends on entity ids.
 */
export const DEEPFALL_AREA_HIT_INDEX = 0;
export const DEEPFALL_AREA_LAUNCH = { forward: 6, up: 4 } as const;

const base = makeAwakenedSequence({ name: "deepfall", cinematic: true, releaseOffset: DEEPFALL_RELEASE_OFFSET });

function areaCandidates(c: CastContext): HitCandidate[] {
  const st = seqOf(c);
  if (st.victimId === null || st.released || !holdsCapture(c, st)) return [];
  if (c.tick - st.captureTick !== DEEPFALL_IMPACT_OFFSET) return [];
  const vp = c.host.pose(st.victimId);
  if (!vp) return [];
  const near: { id: number; d: number }[] = [];
  for (const t of c.host.combat.all()) {
    if (t.entityId === c.fighter.entityId || t.entityId === st.victimId || !isAlive(t)) continue;
    const tp = c.host.pose(t.entityId);
    if (!tp) continue;
    if (c.host.blocked([vp.x, vp.y, vp.z], [tp.x, tp.y, tp.z])) continue;
    const dy = Math.max(0, Math.abs(tp.y - vp.y) - COMBAT.capsule.halfHeight);
    const d = Math.hypot(Math.hypot(tp.x - vp.x, tp.z - vp.z), dy);
    if (d <= DEEPFALL_AREA_RADIUS + COMBAT.capsule.radius) near.push({ id: t.entityId, d });
  }
  near.sort((a, b) => a.d - b.d || a.id - b.id);
  return near.slice(0, c.cast.def.maxTargets - 1).map((n) => ({
    ...buildCandidate(c, n.id, DEEPFALL_AREA_HIT_INDEX, vp.x, vp.z),
    damage100: DEEPFALL_AREA_DAMAGE100, counterable: false, block: "U", armorBreak: false,
    reaction: { kind: "ragdoll", ticks: DEEPFALL_AREA_RAGDOLL_TICKS }, launch: { ...DEEPFALL_AREA_LAUNCH },
    maxHitsPerTarget: 1,
  }));
}

export const DEEPFALL: AbilityHandler = {
  ...base,
  candidates(c) { return [...base.candidates!(c), ...areaCandidates(c)]; },
};
