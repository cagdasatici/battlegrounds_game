import { ARENA } from "@eb/shared/config/arena";
import { forwardOf, type AbilityHandler } from "../../sim/AbilityRunner.js";
import { makeSequenceHandler, type SeqState } from "./sequence.js";

/** P1 elevated branch (spec 15): OFF in P0. Flip only together with the P1 acceptance tests. */
export const P1_ELEVATED_SLAM = false;
/** D values from the spec 15 dragSlam card. */
export const DRAG_DISTANCE_M = 3;
export const DRAG_TICKS = 36;
export const ELEVATED_MIN_HEIGHT_M = 2;
export const ELEVATED_FINAL_DAMAGE100 = 2400;

interface SlamExtra { elevated: boolean; landed: boolean; stopped: boolean }
const extraOf = (st: SeqState): SlamExtra => st.extra as unknown as SlamExtra;

/**
 * td.b2 Undertow Spiral (dragSlam). On capture: caster armor; damage 5 at +0 and 14 at +48; the pair moves
 * forward 3 m over 36 ticks (ticks +1 .. +36, equal steps) through the host's swept collision, so a wall stops
 * the motion for good but never the remaining damage schedule; release at +49 with R72 F3 U8.
 * Elevated branch (P1, behind `elevatedBranch`): cast started >= 2 m above the surface and the caster lands
 * before +48 -> final damage 24 instead of 14, once.
 */
export function createDragSlam(opts: { elevatedBranch: boolean }): AbilityHandler {
  return makeSequenceHandler({
    name: "dragSlam",
    onCommit(c, st) {
      const p = c.host.pose(c.fighter.entityId);
      const ground = p ? c.host.surfaceHeight?.(p.x, p.z) ?? null : null;
      const elevated = !!p && ground !== null && p.y - ARENA.capsule.centreAboveSurface - ground >= ELEVATED_MIN_HEIGHT_M;
      st.extra = { elevated, landed: false, stopped: false } satisfies SlamExtra;
    },
    damageOf(c, st, index) {
      const d = c.cast.def;
      const last = index === d.damage100.length - 1;
      if (opts.elevatedBranch && last && extraOf(st).elevated && extraOf(st).landed) return ELEVATED_FINAL_DAMAGE100;
      return d.damage100[index]!;
    },
    onSequenceTick(c, st, rel) {
      const x = extraOf(st);
      const last = c.cast.def.hitOffsets[c.cast.def.hitOffsets.length - 1]!;
      if (rel > 0 && rel < last && !x.landed) {
        const p = c.host.pose(c.fighter.entityId);
        if (p?.grounded) x.landed = true;
      }
      if (rel < 1 || rel > DRAG_TICKS || x.stopped || st.victimId === null || !c.host.moveTogether) return;
      const [fx, fz] = forwardOf(c.cast.aimYaw);
      const step = DRAG_DISTANCE_M / DRAG_TICKS;
      const moved = c.host.moveTogether([c.fighter.entityId, st.victimId], fx * step, fz * step);
      if (Math.hypot(moved.dx, moved.dz) < step * 0.999) x.stopped = true; // wall: motion ends, schedule continues
    },
  });
}

export const DRAG_SLAM = createDragSlam({ elevatedBranch: P1_ELEVATED_SLAM });
