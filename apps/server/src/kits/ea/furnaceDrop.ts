import { COMBAT } from "@eb/shared/config/combat";
import {
  buildCandidate, forwardOf, queryTargets, type AbilityHandler, type CastContext,
} from "../../sim/AbilityRunner.js";
import type { HitCandidate } from "../../sim/HitResolver.js";

/**
 * ea.b4 Furnace Drop (spec 15). All numbers are D.
 *
 *  - Rise: through the 18 startup ticks the host sets vertical velocity +10 m/s every tick (3 m, any start state).
 *  - Aim: at activeStart a descent point is fixed up to 8 m ahead along the commit aim (a straight sweep shortens it
 *    at the first wall) at standing height above the floor under that point (host.surfaceHeight; 12 m below the caster
 *    when there is no floor). The heading is never re-read, and the pitch is at least 11.5 degrees down.
 *  - Descent: 18 m/s toward that point. Horizontal motion goes through the host's swept collision (a wall stops it, the
 *    caster keeps falling); vertical velocity is set every tick. The first tick in which the caster is grounded inside
 *    the 48 active ticks is the impact: sphere r 4 around the caster, 20 HP, B, chip 4, R84 F4 U10 (max 4 targets, line
 *    of sight by the shared query). The cast then retimes to end its active window and run the 30 tick recovery.
 *  - No ground contact inside the window: the cast simply expires into a normal fall, with no explosion.
 *  - Interruption, death or capture end the cast through the framework: no damage. The handler never changes gravity
 *    and only writes velocity while the cast is live, so gravity applies again from the next tick on.
 *  - If the rise is blocked by a ceiling and the caster is still grounded at activeStart, that is a ground contact
 *    and the impact happens at activeStart.
 */
export const RISE_MPS = 10;
export const DESCENT_MPS = 18;
export const AIM_RANGE_M = 8;
export const MIN_DESCENT_SIN = 0.2;
export const NO_FLOOR_DROP_M = 12;
export const IMPACT_CHIP100 = 400;
const CAPSULE_CENTRE_ABOVE_FLOOR = COMBAT.capsule.halfHeight + COMBAT.capsule.radius;

interface DropData {
  phase: "rise" | "descend" | "done"; hx: number; hz: number; vy: number; hLen: number; remaining: number; hStop: boolean;
  impactTick: number;
}
const dataOf = (c: CastContext): DropData => c.cast.data as unknown as DropData;

function onCommit(c: CastContext): void {
  Object.assign(c.cast.data, { phase: "rise", hx: 0, hz: 0, vy: 0, hLen: 0, remaining: 0, hStop: false, impactTick: -1 } satisfies DropData);
}

function fixAim(c: CastContext, d: DropData): void {
  const ap = c.host.pose(c.fighter.entityId);
  if (!ap) return;
  const [fx, fz] = forwardOf(c.cast.aimYaw);
  const t = c.host.sweepSphere?.([ap.x, ap.y, ap.z], [ap.x + fx * AIM_RANGE_M, ap.y, ap.z + fz * AIM_RANGE_M], COMBAT.capsule.radius) ?? null;
  const dist = AIM_RANGE_M * (t ?? 1);
  const tx = ap.x + fx * dist, tz = ap.z + fz * dist;
  const floor = c.host.surfaceHeight?.(tx, tz) ?? null;
  const ty = floor === null ? ap.y - NO_FLOOR_DROP_M : floor + CAPSULE_CENTRE_ABOVE_FLOOR;
  let ux = tx - ap.x, uy = ty - ap.y, uz = tz - ap.z;
  const len = Math.hypot(ux, uy, uz);
  if (!(len > 1e-6)) { ux = 0; uy = -1; uz = 0; } else { ux /= len; uy /= len; uz /= len; }
  if (uy > -MIN_DESCENT_SIN) {
    const hl = Math.hypot(ux, uz);
    const k = hl > 1e-9 ? Math.sqrt(1 - MIN_DESCENT_SIN * MIN_DESCENT_SIN) / hl : 0;
    ux *= k; uz *= k; uy = -MIN_DESCENT_SIN;
  }
  d.hx = ux * DESCENT_MPS / 60; d.hz = uz * DESCENT_MPS / 60; d.hLen = Math.hypot(d.hx, d.hz);
  d.vy = uy * DESCENT_MPS; d.remaining = dist; d.hStop = false; d.phase = "descend";
}

function onTick(c: CastContext): void {
  const d = dataOf(c);
  const id = c.fighter.entityId;
  if (d.phase === "done") return;
  if (c.tick < c.cast.activeStart) { c.host.launch?.(id, 0, RISE_MPS, 0); return; }
  const ap = c.host.pose(id);
  if (!ap) return;
  if (d.phase === "rise") fixAim(c, d);
  if (ap.grounded) {
    d.phase = "done"; d.impactTick = c.tick;
    if (c.tick + 1 < c.cast.activeEnd) c.runner.retimeCast(c.fighter, c.cast, c.tick, c.tick + 1, c.tick + 1 + c.cast.def.recovery);
    return;
  }
  if (!d.hStop && d.remaining > 1e-6 && d.hLen > 1e-9) {
    const s = Math.min(d.hLen, d.remaining);
    const moved = c.host.moveTogether?.([id], d.hx * s / d.hLen, d.hz * s / d.hLen) ?? { dx: 0, dz: 0 };
    const m = Math.hypot(moved.dx, moved.dz);
    if (m < s * 0.999) d.hStop = true;
    d.remaining -= m;
  }
  c.host.launch?.(id, 0, d.vy, 0);
  if (c.tick >= c.cast.activeEnd - 1) d.phase = "done"; // expired into a normal fall, no explosion
}

function candidates(c: CastContext): HitCandidate[] {
  const d = dataOf(c);
  if (d.impactTick !== c.tick) return [];
  const ap = c.host.pose(c.fighter.entityId);
  if (!ap) return [];
  return queryTargets(c).map((id) => {
    const k = buildCandidate(c, id, 0, ap.x, ap.z);
    k.chip100 = IMPACT_CHIP100;
    return k;
  });
}

export const FURNACE_DROP: AbilityHandler = { name: "furnaceDrop", onCommit, onTick, candidates };
