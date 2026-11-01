import { isAlive } from "../../sim/ActionMachine.js";
import {
  buildCandidate, forwardOf, queryTargets, type AbilityHandler, type CastContext,
} from "../../sim/AbilityRunner.js";
import type { HitCandidate } from "../../sim/HitResolver.js";

/**
 * ea.b2 Vent Rush (spec 15). All numbers are D.
 *
 *  - Travel: from activeStart the caster moves 20 m/s (one third of a metre per tick, 24 ticks = 8 m) along the commit
 *    aim through the host's swept collision. A wall (displacement below the step) ends the travel. No movement
 *    happens before activeStart.
 *  - Recast: a second press (input "recast") is accepted once 6 active ticks have elapsed (tick >= activeStart + 6)
 *    and ends the travel on that tick; a press before that, after the travel ended or during recovery is ignored
 *    (STATE reject).
 *  - Air branch (caster airborne at activeStart): the commit time aim elevation (negative camera pitch, clamped to
 *    +-45 degrees) tilts the travel: horizontal step cos(e), vertical velocity 20 sin(e) m/s. The first grounded tick
 *    after the first travel tick (floor contact) ends the travel. A grounded cast travels level.
 *  - Rear blast: at activeStart the targets inside the rear sphere (r 2, centre 1.5 m behind) are reserved. 10 HP, U,
 *    R36 F4 U2, applied at travel end only to reserved targets that the front blast did not touch.
 *  - Front blast at travel end: sphere r 2.5 centred 1.5 m ahead of the final position; 15 HP (24 HP on a ragdolled
 *    target), B, chip 6, R72 F10 U3. A target is in at most one phase (front first; maxHitsPerTarget 1), so duplicated
 *    phases never add damage or meter.
 *  - An early end retimes the cast: active ends the next tick and the 24 tick recovery follows. Interruption, death
 *    or capture cancel the cast before the blast, so no damage lands.
 */
export const VENT_SPEED_MPS = 20;
export const VENT_STEP_M = VENT_SPEED_MPS / 60;
export const VENT_MIN_ACTIVE_FOR_RECAST = 6;
export const VENT_PITCH_LIMIT = Math.PI / 4;
export const FRONT_SHAPE = { kind: "sphere", r: 2.5 } as const;
export const FRONT_CENTRE_M = 1.5;
export const REAR_SHAPE = { kind: "sphere", r: 2 } as const;
export const REAR_CENTRE_M = -1.5;
export const FRONT_STANDING100 = 1500;
export const FRONT_RAGDOLL100 = 2400;
export const FRONT_CHIP100 = 600;
export const REAR_DAMAGE100 = 1000;
export const REAR_RAGDOLL_TICKS = 36;
export const REAR_LAUNCH = { forward: 4, up: 2 } as const;
const FRONT_INDEX = 0;
const REAR_INDEX = 1;

interface VentData {
  elev: number; air: boolean; ended: boolean; blastTick: number; recastTick: number;
  rear: number[]; rearX: number; rearZ: number;
}
const dataOf = (c: CastContext): VentData => c.cast.data as unknown as VentData;

function onCommit(c: CastContext): void {
  const pitch = c.host.aimPitch?.(c.fighter.entityId) ?? 0;
  // Camera pitch is positive when looking down; the aim elevation is its negative.
  const elev = Number.isFinite(pitch) ? Math.max(-VENT_PITCH_LIMIT, Math.min(VENT_PITCH_LIMIT, -pitch)) : 0;
  Object.assign(c.cast.data, { elev, air: false, ended: false, blastTick: -1, recastTick: -1, rear: [], rearX: 0, rearZ: 0 } satisfies VentData);
}

function endTravel(c: CastContext, tick: number): void {
  const d = dataOf(c);
  d.ended = true;
  d.blastTick = tick;
  if (tick + 1 < c.cast.activeEnd) c.runner.retimeCast(c.fighter, c.cast, tick, tick + 1, tick + 1 + c.cast.def.recovery);
}

function onTick(c: CastContext): void {
  const d = dataOf(c);
  if (c.tick < c.cast.activeStart || d.ended) return;
  const id = c.fighter.entityId;
  const ap = c.host.pose(id);
  if (!ap) return;
  const [fx, fz] = forwardOf(c.cast.aimYaw);
  if (c.tick === c.cast.activeStart) {
    d.air = !ap.grounded;
    d.rearX = ap.x + fx * REAR_CENTRE_M; d.rearZ = ap.z + fz * REAR_CENTRE_M;
    d.rear = queryTargets(c, { shape: REAR_SHAPE, range: REAR_CENTRE_M, targetStates: ["standing", "air", "ragdoll"] });
  }
  if (d.recastTick >= 0) { endTravel(c, c.tick); if (d.air && !ap.grounded) c.host.launch?.(id, 0, 0, 0); return; }
  if (d.air && c.tick > c.cast.activeStart && ap.grounded) { endTravel(c, c.tick); return; }
  const e = d.air ? d.elev : 0;
  const h = VENT_STEP_M * Math.cos(e);
  const moved = c.host.moveTogether?.([id], fx * h, fz * h) ?? { dx: 0, dz: 0 };
  let stop = Math.hypot(moved.dx, moved.dz) < h * 0.999;
  if (d.air) c.host.launch?.(id, 0, VENT_SPEED_MPS * Math.sin(e), 0);
  if (c.tick >= c.cast.activeEnd - 1) stop = true;
  if (stop) { endTravel(c, c.tick); if (d.air) c.host.launch?.(id, 0, 0, 0); }
}

function candidates(c: CastContext): HitCandidate[] {
  const d = dataOf(c);
  if (!d.ended || c.tick !== d.blastTick) return [];
  const ap = c.host.pose(c.fighter.entityId);
  if (!ap) return [];
  const out: HitCandidate[] = [];
  const front = queryTargets(c, { shape: FRONT_SHAPE, range: FRONT_CENTRE_M, targetStates: ["standing", "air", "ragdoll"] });
  for (const id of front) {
    const victim = c.host.combat.get(id)!;
    const k = buildCandidate(c, id, FRONT_INDEX, ap.x, ap.z);
    k.damage100 = victim.action === "Ragdolled" ? FRONT_RAGDOLL100 : FRONT_STANDING100;
    k.chip100 = FRONT_CHIP100;
    out.push(k);
  }
  let left = c.cast.def.maxTargets - c.host.combat.ledger.targetsHit(c.fighter.entityId, c.cast.castCounter) - front.length;
  for (const id of d.rear) {
    if (left <= 0) break;
    const victim = c.host.combat.get(id);
    if (!victim || !isAlive(victim) || front.includes(id)) continue;
    const k = buildCandidate(c, id, REAR_INDEX, d.rearX, d.rearZ);
    k.damage100 = REAR_DAMAGE100; k.block = "U";
    k.reaction = { kind: "ragdoll", ticks: REAR_RAGDOLL_TICKS }; k.launch = { ...REAR_LAUNCH };
    out.push(k);
    left -= 1;
  }
  return out;
}

export const VENT_RUSH: AbilityHandler = {
  name: "ventRush",
  onCommit,
  onTick,
  candidates,
  onRecast(c) {
    const d = dataOf(c);
    if (d.ended || d.recastTick >= 0) return false;
    if (c.tick < c.cast.activeStart + VENT_MIN_ACTIVE_FOR_RECAST || c.tick >= c.cast.activeEnd) return false;
    d.recastTick = c.tick;
    return true;
  },
};
