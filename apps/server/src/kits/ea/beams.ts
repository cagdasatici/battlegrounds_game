import { buildCandidate, dueHitIndices, forwardOf, queryTargets, DEFAULT_BEAM_ORIGIN, type AbilityHandler, type CastContext } from "../../sim/AbilityRunner.js";
import type { HitCandidate } from "../../sim/HitResolver.js";
import { beamLengthOf } from "../sv/longBeam.js";

/**
 * ea.a3 Furnace Ray and ea.a4 Solar Vent (spec 15, awakened slots 3 and 4). All numbers are D (decision 0022).
 *
 * Both are pulsed beams. At each scheduled pulse (activeStart + hitOffsets[i]) the beam is re-clipped at the first solid
 * obstacle along the current aim (the aim turns by turnRate, framework), and every eligible target in the clipped beam
 * (forward of the caster, inside the clipped length, not occluded) takes one pulse, nearest first, at most def.maxTargets
 * distinct targets for the whole cast. Each pulse hit index equals its schedule index, so the per target cap is the pulse
 * count (7 x 5 = 35 HP, 10 x 7 = 70 HP). Interruption, death or capture end the cast, which voids every later pulse.
 * The caster's vertical velocity is held at zero from commit through the last active tick; movement is zero.
 *
 * - Furnace Ray: 5 HP, B with chip 1, stun 18, push 1 m/s along the beam, armor from the first confirmed damage (definition).
 * - Solar Vent: 7 HP when the target is within 10 m of the caster (3 HP farther), U, stun 24, push 2 m/s, no armor.
 */
export const SOLAR_NEAR_RANGE_M = 10;
export const SOLAR_NEAR_DAMAGE100 = 700;
export const SOLAR_FAR_DAMAGE100 = 300;
export const RAY_CHIP100 = 100;

function pulses(c: CastContext, tune: (cand: HitCandidate, dist: number) => void): HitCandidate[] {
  const due = dueHitIndices(c.cast, c.tick);
  if (due.length === 0) return [];
  const ap = c.host.pose(c.fighter.entityId);
  if (!ap) return [];
  const len = beamLengthOf(c);
  const [fx, fz] = forwardOf(c.cast.aimYaw);
  const ox = ap.x + fx * DEFAULT_BEAM_ORIGIN.forward, oz = ap.z + fz * DEFAULT_BEAM_ORIGIN.forward;
  const ids = queryTargets(c, {
    maxLength: len,
    filter: (_t, tp) => (tp.x - ap.x) * fx + (tp.z - ap.z) * fz >= 0 && (tp.x - ox) * fx + (tp.z - oz) * fz <= len,
  });
  const out: HitCandidate[] = [];
  for (const i of due) {
    for (const id of ids) {
      const tp = c.host.pose(id)!;
      const cand = buildCandidate(c, id, i, ap.x, ap.z);
      tune(cand, Math.hypot(tp.x - ap.x, tp.z - ap.z));
      out.push(cand);
    }
  }
  return out;
}

const holdVertical = (c: CastContext): boolean => c.tick < c.cast.activeEnd;

export const FURNACE_RAY: AbilityHandler = {
  name: "furnaceRay",
  candidates: (c) => pulses(c, (cand) => { cand.chip100 = RAY_CHIP100; }),
  freezeVertical: holdVertical,
};

export const SOLAR_VENT: AbilityHandler = {
  name: "solarVent",
  candidates: (c) => pulses(c, (cand, dist) => { cand.damage100 = dist <= SOLAR_NEAR_RANGE_M ? SOLAR_NEAR_DAMAGE100 : SOLAR_FAR_DAMAGE100; }),
  freezeVertical: holdVertical,
};
