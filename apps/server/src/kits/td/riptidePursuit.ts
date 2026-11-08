import { COMBAT } from "@eb/shared/config/combat";
import { isAlive } from "../../sim/ActionMachine.js";
import {
  buildCandidate, forwardOf, type AbilityHandler, type AbilityPose, type CastContext,
} from "../../sim/AbilityRunner.js";
import type { HitCandidate } from "../../sim/HitResolver.js";
import { makeAwakenedSequence, awakenedEligible } from "./awakened.js";
import { releaseVictim, scheduledCandidate, seqOf, type SeqState } from "./sequence.js";

/**
 * td.a4 Riptide Pursuit (spec 15 and 16, awakened slot 4). All numbers are D.
 *
 * - The branch is fixed at commit: close when a probe-eligible fighter (alive, not captured, supported target state,
 *   in static line of sight) is within 2 m (horizontal centre distance, plus the vertical gap beyond the capsule) of
 *   the caster at the commit tick, otherwise ranged. It never changes afterwards.
 * - Close: no travel. During the active window the same 2 m test captures the nearest eligible fighter once.
 *   Damage [8, 22] at capture + [0, 36].
 * - Ranged: from activeStart the caster dashes 0.3 m per tick (18 m/s) for the 30 active ticks, so 9 m at most, along
 *   the commit-time aim, through the host's swept collision. A wall (displacement below the step) ends the dash. Each
 *   tick a sphere of radius 0.6 m at capsule centre + 0.2 m Y is swept from the previous to the new centre and
 *   captures the nearest eligible fighter whose capsule it touches (spec 16). The capture ends the dash. The capture
 *   hit deals nothing; 27 HP lands at capture + 36.
 * - Release at capture + 37 with R72 F8 U5. A miss goes to recovery at the end of the active window. Caster armor
 *   only after the capture (shared capture sequence). The initial capture is counterable.
 * - P1 chain (T24, behind `P1_RIPTIDE_CHAIN`, spec 15): only the close branch. When the first victim is released alive,
 *   the nearest probe-eligible fighter other than that victim within 6 m (3D centre distance) is chosen; the caster
 *   sweeps toward it for 12 ticks (0.5 m per tick, direction fixed at release, through `host.moveTogether`; a wall
 *   ends the dash; same capsule/sphere sweep test as the ranged branch). The sweep captures the nearest eligible
 *   fighter that is not the first victim (a life is never recaptured). The chain capture is counterable and deals
 *   nothing; 31 HP lands at capture + 30 (noncounterable), release at capture + 31 with the same release as the
 *   first. Armor again only while holding the chain capture. A sweep miss goes to recovery. At most two distinct
 *   targets per cast; the cast never exceeds 150 ticks (worst case 121); the cooldown is not touched.
 */
export const P1_RIPTIDE_CHAIN = true;
export const CHAIN_RANGE_M = 6;
export const CHAIN_SWEEP_TICKS = 12;
export const CHAIN_STEP_M = CHAIN_RANGE_M / CHAIN_SWEEP_TICKS;
export const CHAIN_DAMAGE100 = 3100;
export const CHAIN_DAMAGE_OFFSET = 30;
export const CHAIN_RELEASE_OFFSET = 31;
export const CHAIN_CAST_CAP_TICKS = 150;
const CHAIN_CAPTURE_INDEX = 2;
const CHAIN_DAMAGE_INDEX = 3;

export const RIPTIDE_CLOSE_RANGE_M = 2;
export const RIPTIDE_STEP_M = 0.3;
export const RIPTIDE_SWEEP_RADIUS_M = 0.6;
export const RIPTIDE_SWEEP_CENTRE_Y = 0.2;
export const RIPTIDE_RANGED_DAMAGE100 = 2700;

interface Seg { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number }
interface Chain {
  ux: number; uz: number; sweepStart: number; sweepEnd: number; stopped: boolean; seg: Seg | null;
  firstVictim: number; victimId: number | null; victimLife: number; captureTick: number; released: boolean;
}
interface RiptideExtra { close: boolean; stopped: boolean; seg: Seg | null; chain: Chain | null }
const extraOf = (st: SeqState): RiptideExtra => st.extra as unknown as RiptideExtra;

/** Squared distance between segments p1-q1 and p2-q2 (closest point pair, clamped). */
export function segmentDistance(p1: readonly number[], q1: readonly number[], p2: readonly number[], q2: readonly number[]): number {
  const d1 = [q1[0]! - p1[0]!, q1[1]! - p1[1]!, q1[2]! - p1[2]!];
  const d2 = [q2[0]! - p2[0]!, q2[1]! - p2[1]!, q2[2]! - p2[2]!];
  const r = [p1[0]! - p2[0]!, p1[1]! - p2[1]!, p1[2]! - p2[2]!];
  const dot = (a: number[], b: number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
  const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
  const clamp = (v: number): number => Math.max(0, Math.min(1, v));
  let s: number, t: number;
  if (a <= 1e-12 && e <= 1e-12) { s = 0; t = 0; }
  else if (a <= 1e-12) { s = 0; t = clamp(f / e); }
  else {
    const cc = dot(d1, r);
    if (e <= 1e-12) { t = 0; s = clamp(-cc / a); }
    else {
      const b = dot(d1, d2), den = a * e - b * b;
      s = den > 1e-12 ? clamp((b * f - cc * e) / den) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp(-cc / a); }
      else if (t > 1) { t = 1; s = clamp((b - cc) / a); }
    }
  }
  const c1 = [p1[0]! + d1[0]! * s, p1[1]! + d1[1]! * s, p1[2]! + d1[2]! * s];
  const c2 = [p2[0]! + d2[0]! * t, p2[1]! + d2[1]! * t, p2[2]! + d2[2]! * t];
  return Math.hypot(c1[0]! - c2[0]!, c1[1]! - c2[1]!, c1[2]! - c2[2]!);
}

/** Probe eligible fighters (the shared awakened filter, not captured, supported state, line of sight) nearest first. */
function eligibleOthers(c: CastContext, ap: AbilityPose): { id: number; pose: AbilityPose; dist: number }[] {
  const out: { id: number; pose: AbilityPose; dist: number }[] = [];
  for (const t of c.host.combat.all()) {
    if (t.entityId === c.fighter.entityId || !isAlive(t)) continue;
    if (c.host.combat.captures.isCaptured(t.entityId)) continue;
    const tp = c.host.pose(t.entityId);
    if (!tp || !awakenedEligible(t, tp, c)) continue;
    if (c.host.blocked([ap.x, ap.y, ap.z], [tp.x, tp.y, tp.z])) continue;
    out.push({ id: t.entityId, pose: tp, dist: Math.hypot(tp.x - ap.x, tp.z - ap.z) });
  }
  return out.sort((a, b) => a.dist - b.dist || a.id - b.id);
}

const closeReach = (ap: AbilityPose, tp: AbilityPose): boolean =>
  Math.hypot(Math.hypot(tp.x - ap.x, tp.z - ap.z), Math.max(0, (tp.y - ap.y) - COMBAT.capsule.halfHeight)) <= RIPTIDE_CLOSE_RANGE_M;

const base = makeAwakenedSequence({
  name: "riptidePursuit",
  cinematic: false,
  onCommit(c, st) {
    const ap = c.host.pose(c.fighter.entityId);
    const close = !!ap && eligibleOthers(c, ap).some((o) => closeReach(ap, o.pose));
    st.extra = { close, stopped: false, seg: null, chain: null } satisfies RiptideExtra;
  },
  damageOf(_c, st, index) {
    const x = extraOf(st);
    if (index === 0) return x.close ? 800 : 0;
    return x.close ? 2200 : RIPTIDE_RANGED_DAMAGE100;
  },
  onReleased(c, st) { if (P1_RIPTIDE_CHAIN && extraOf(st).close) startChain(c, st); },
});

/** Chain start at the first release: pick the second distinct target and extend the cast through the sweep window. */
function startChain(c: CastContext, st: SeqState): void {
  const ap = c.host.pose(c.fighter.entityId);
  if (!ap || !isAlive(c.fighter)) return;
  const cand = eligibleOthers(c, ap).filter((o) => o.id !== st.victimId
    && Math.hypot(o.dist, Math.max(0, (o.pose.y - ap.y) - COMBAT.capsule.halfHeight)) <= CHAIN_RANGE_M)[0];
  if (!cand) return;
  const dx = cand.pose.x - ap.x, dz = cand.pose.z - ap.z;
  const len = Math.hypot(dx, dz);
  const [fx, fz] = forwardOf(c.cast.aimYaw);
  const sweepEnd = c.tick + 1 + CHAIN_SWEEP_TICKS;
  const endTick = sweepEnd + CHAIN_RELEASE_OFFSET + c.cast.def.recovery;
  if (endTick - c.cast.startTick > CHAIN_CAST_CAP_TICKS) return; // never reached with the shipped numbers
  const f = c.fighter;
  // The first release already moved the caster into Recovery (expiry runs before the handler step): re-enter Active.
  f.action = "Active";
  c.runner.retimeCast(f, c.cast, c.tick, sweepEnd, sweepEnd + c.cast.def.recovery);
  extraOf(st).chain = {
    ux: len > 1e-9 ? dx / len : fx, uz: len > 1e-9 ? dz / len : fz, sweepStart: c.tick + 1, sweepEnd, stopped: false, seg: null,
    firstVictim: st.victimId!, victimId: null, victimLife: 0, captureTick: -1, released: false,
  };
}

function chainOf(c: CastContext): Chain | null { return extraOf(seqOf(c)).chain; }

function chainHeld(c: CastContext, ch: Chain): boolean {
  if (ch.victimId === null) return false;
  const cap = c.host.combat.captures.captureOn(ch.victimId);
  return !!cap && cap.captorId === c.fighter.entityId && cap.castCounter === c.cast.castCounter;
}

function chainTick(c: CastContext): void {
  const ch = chainOf(c);
  if (!ch) return;
  ch.seg = null;
  if (ch.victimId !== null) {
    if (ch.released || !chainHeld(c, ch)) return;
    if (c.tick - ch.captureTick >= CHAIN_RELEASE_OFFSET) { ch.released = true; releaseVictim(c, ch.victimId, ch.victimLife); }
    return;
  }
  if (c.tick < ch.sweepStart || c.tick >= ch.sweepEnd) return;
  const ap = c.host.pose(c.fighter.entityId);
  if (!ap) return;
  const y = ap.y + RIPTIDE_SWEEP_CENTRE_Y;
  let nx = ap.x, nz = ap.z;
  if (!ch.stopped && c.host.moveTogether) {
    const moved = c.host.moveTogether([c.fighter.entityId], ch.ux * CHAIN_STEP_M, ch.uz * CHAIN_STEP_M);
    if (Math.hypot(moved.dx, moved.dz) < CHAIN_STEP_M * 0.999) ch.stopped = true;
    const np = c.host.pose(c.fighter.entityId);
    nx = np ? np.x : ap.x + moved.dx; nz = np ? np.z : ap.z + moved.dz;
  }
  ch.seg = { x0: ap.x, y0: y, z0: ap.z, x1: nx, y1: y, z1: nz };
}

function chainCandidates(c: CastContext, ch: Chain): HitCandidate[] {
  const ap = c.host.pose(c.fighter.entityId);
  if (!ap) return [];
  if (ch.victimId !== null) {
    if (ch.released || !chainHeld(c, ch) || c.tick - ch.captureTick !== CHAIN_DAMAGE_OFFSET) return [];
    const cand = scheduledCandidate(c, ch.victimId, CHAIN_DAMAGE_INDEX, CHAIN_DAMAGE100);
    return cand ? [cand] : [];
  }
  const s = ch.seg;
  if (!s || c.tick >= ch.sweepEnd) return [];
  const best = eligibleOthers(c, ap).filter((o) => o.id !== ch.firstVictim && segmentDistance([s.x0, s.y0, s.z0], [s.x1, s.y1, s.z1],
    [o.pose.x, o.pose.y - COMBAT.capsule.halfHeight, o.pose.z], [o.pose.x, o.pose.y + COMBAT.capsule.halfHeight, o.pose.z])
    <= RIPTIDE_SWEEP_RADIUS_M + COMBAT.capsule.radius)[0];
  if (!best) return [];
  const cand = buildCandidate(c, best.id, CHAIN_CAPTURE_INDEX, ap.x, ap.z);
  cand.reaction = { kind: "none" };
  cand.damage100 = 0;
  cand.maxHitsPerTarget = 1;
  cand.capture = { cinematic: false, maxTicks: CHAIN_RELEASE_OFFSET + 1 };
  return [cand];
}

/** Runs before candidates each tick: the ranged dash step and its sweep segment. */
function dashStep(c: CastContext): void {
  const st = seqOf(c);
  const x = extraOf(st);
  x.seg = null;
  if (st.victimId !== null || x.close || c.tick < c.cast.activeStart || c.tick >= st.probeEnd) return;
  const ap = c.host.pose(c.fighter.entityId);
  if (!ap) return;
  const y = ap.y + RIPTIDE_SWEEP_CENTRE_Y;
  let nx = ap.x, nz = ap.z;
  if (!x.stopped && c.host.moveTogether) {
    const [fx, fz] = forwardOf(c.cast.aimYaw);
    const moved = c.host.moveTogether([c.fighter.entityId], fx * RIPTIDE_STEP_M, fz * RIPTIDE_STEP_M);
    if (Math.hypot(moved.dx, moved.dz) < RIPTIDE_STEP_M * 0.999) x.stopped = true; // wall: the dash ends for good
    nx = ap.x + moved.dx; nz = ap.z + moved.dz;
    const np = c.host.pose(c.fighter.entityId);
    if (np) { nx = np.x; nz = np.z; }
  }
  x.seg = { x0: ap.x, y0: y, z0: ap.z, x1: nx, y1: y, z1: nz };
}

function probe(c: CastContext): HitCandidate[] {
  const st = seqOf(c);
  const x = extraOf(st);
  if (c.tick < c.cast.activeStart || c.tick >= st.probeEnd) return [];
  const ap = c.host.pose(c.fighter.entityId);
  if (!ap) return [];
  const hits = eligibleOthers(c, ap).filter((o) => {
    if (x.close) return closeReach(ap, o.pose);
    const s = x.seg;
    if (!s) return false;
    const d = segmentDistance([s.x0, s.y0, s.z0], [s.x1, s.y1, s.z1],
      [o.pose.x, o.pose.y - COMBAT.capsule.halfHeight, o.pose.z], [o.pose.x, o.pose.y + COMBAT.capsule.halfHeight, o.pose.z]);
    return d <= RIPTIDE_SWEEP_RADIUS_M + COMBAT.capsule.radius;
  });
  const best = hits[0];
  if (!best) return [];
  const cand = buildCandidate(c, best.id, 0, ap.x, ap.z);
  cand.reaction = { kind: "none" };
  cand.damage100 = x.close ? 800 : 0;
  cand.maxHitsPerTarget = 1;
  cand.capture = { cinematic: false, maxTicks: c.cast.def.hitOffsets[c.cast.def.hitOffsets.length - 1]! + 2 };
  return [cand];
}

export const RIPTIDE_PURSUIT: AbilityHandler = {
  ...base,
  onTick(c) { base.onTick?.(c); dashStep(c); chainTick(c); },
  candidates(c) {
    const first = seqOf(c).victimId === null ? probe(c) : base.candidates!(c);
    const ch = chainOf(c);
    return ch ? [...first, ...chainCandidates(c, ch)] : first;
  },
  onResults(c, results) {
    base.onResults?.(c, results);
    const ch = chainOf(c);
    if (!ch || ch.victimId !== null) return;
    for (const r of results) {
      if (r.candidate.hitIndex !== CHAIN_CAPTURE_INDEX || r.outcome !== "captured" || r.killed) continue;
      const victim = c.host.combat.get(r.candidate.targetId);
      if (!victim) continue;
      ch.victimId = victim.entityId; ch.victimLife = victim.lifeId; ch.captureTick = c.tick;
      const releaseTick = c.tick + CHAIN_RELEASE_OFFSET;
      c.runner.extendCast(c.fighter, c.cast, releaseTick, releaseTick + c.cast.def.recovery);
      c.cast.armorUntil = releaseTick;
      c.fighter.armored = true;
      break;
    }
  },
  onEnd(c, why) {
    base.onEnd?.(c, why);
    const ch = c.cast.data.seq ? chainOf(c) : null;
    if (ch && ch.victimId !== null && !ch.released && chainHeld(c, ch)) c.host.combat.release(ch.victimId, c.tick, "cancelled");
  },
};
