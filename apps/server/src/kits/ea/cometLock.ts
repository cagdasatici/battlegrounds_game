import { COMBAT } from "@eb/shared/config/combat";
import { isAlive } from "../../sim/ActionMachine.js";
import { buildCandidate, forwardOf, type AbilityHandler, type AbilityPose, type CastContext } from "../../sim/AbilityRunner.js";
import type { HitCandidate } from "../../sim/HitResolver.js";
import { awakenedEligible, makeAwakenedSequence } from "../td/awakened.js";
import { holdsCapture, seqOf, type SeqState } from "../td/sequence.js";
import { segmentDistance } from "../td/riptidePursuit.js";
import { areaTargets } from "./area.js";

/**
 * ea.a2 Comet Lock (spec 15, awakened slot 2). All numbers are D (decision 0022).
 *
 * - Startup is vulnerable. From activeStart the caster dashes 40 m/s (2/3 m per tick) along the commit aim for the 24
 *   active ticks (16 m) through the host's swept collision; a wall ends the dash. The caster is invulnerable from
 *   activeStart through the dash and, after a capture, through the release tick ("dash and capture invulnerable").
 *   An invulnerable target is never eligible (noncounterable does not mean it hits invulnerable targets).
 * - The probe sweeps a 0.6 m sphere along each step and captures the nearest eligible fighter of any state. The
 *   branch (standing or ragdoll) is read when the capture candidate is built and never again.
 * - The capture hit deals nothing. At capture + 54 the victim takes 50 HP (standing or air) or 30 HP (ragdoll branch);
 *   in the same tick other fighters within 4 m of the victim (3D, line of sight, at most 3) take 20 HP, B, chip 5,
 *   R72 F5 U6. The victim is excluded from the splash and the caster never takes it. Release at +60 R90 F3 U8.
 * - A miss goes straight to vulnerable recovery. Every hit is noncounterable.
 */
export const COMET_STEP_M = 40 / 60;
export const COMET_SWEEP_RADIUS_M = 0.6;
export const COMET_SWEEP_CENTRE_Y = 0.2;
export const COMET_RELEASE_OFFSET = 60;
export const COMET_DAMAGE_OFFSET = 54;
export const COMET_STANDING_DAMAGE100 = 5000;
export const COMET_RAGDOLL_DAMAGE100 = 3000;
export const COMET_SPLASH_RADIUS_M = 4;
export const COMET_SPLASH_DAMAGE100 = 2000;
export const COMET_SPLASH_CHIP100 = 500;
export const COMET_SPLASH_RAGDOLL_TICKS = 72;
export const COMET_SPLASH_LAUNCH = { forward: 5, up: 6 } as const;
/** Splash uses hit index 0 so it resolves before the victim's damage hit of the same tick (as Deepfall). */
const SPLASH_INDEX = 0;

interface Seg { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number }
interface CometExtra { stopped: boolean; seg: Seg | null; branches: Record<number, "standing" | "ragdoll">; branch: "standing" | "ragdoll" }
const extraOf = (st: SeqState): CometExtra => st.extra as unknown as CometExtra;

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

const base = makeAwakenedSequence({
  name: "cometLock",
  releaseOffset: COMET_RELEASE_OFFSET,
  onCommit(_c, st) { st.extra = { stopped: false, seg: null, branches: {}, branch: "standing" } satisfies CometExtra; },
  damageOf(_c, st, index) {
    if (index === 0) return 0;
    return extraOf(st).branch === "ragdoll" ? COMET_RAGDOLL_DAMAGE100 : COMET_STANDING_DAMAGE100;
  },
  onCaptured(c, st) {
    // Branch fixed at capture; the caster stays invulnerable until the release tick.
    const x = extraOf(st);
    x.branch = x.branches[st.victimId!] ?? "standing";
    c.fighter.invulnerableUntil = Math.max(c.fighter.invulnerableUntil, st.captureTick + COMET_RELEASE_OFFSET + 1);
  },
});

/** Dash step before candidates; grants the dash invulnerability from activeStart. */
function dashStep(c: CastContext): void {
  const st = seqOf(c);
  const x = extraOf(st);
  x.seg = null;
  if (c.tick < c.cast.activeStart || c.tick >= st.probeEnd) return;
  if (c.tick === c.cast.activeStart) c.fighter.invulnerableUntil = Math.max(c.fighter.invulnerableUntil, st.probeEnd);
  if (st.victimId !== null) return;
  const ap = c.host.pose(c.fighter.entityId);
  if (!ap) return;
  const y = ap.y + COMET_SWEEP_CENTRE_Y;
  let nx = ap.x, nz = ap.z;
  if (!x.stopped && c.host.moveTogether) {
    const [fx, fz] = forwardOf(c.cast.aimYaw);
    const moved = c.host.moveTogether([c.fighter.entityId], fx * COMET_STEP_M, fz * COMET_STEP_M);
    if (Math.hypot(moved.dx, moved.dz) < COMET_STEP_M * 0.999) x.stopped = true;
    const np = c.host.pose(c.fighter.entityId);
    if (np) { nx = np.x; nz = np.z; }
  }
  x.seg = { x0: ap.x, y0: y, z0: ap.z, x1: nx, y1: y, z1: nz };
}

function probe(c: CastContext): HitCandidate[] {
  const st = seqOf(c);
  const x = extraOf(st);
  if (c.tick < c.cast.activeStart || c.tick >= st.probeEnd || !x.seg) return [];
  const ap = c.host.pose(c.fighter.entityId);
  if (!ap) return [];
  const s = x.seg;
  const best = eligibleOthers(c, ap).find((o) => segmentDistance([s.x0, s.y0, s.z0], [s.x1, s.y1, s.z1],
    [o.pose.x, o.pose.y - COMBAT.capsule.halfHeight, o.pose.z], [o.pose.x, o.pose.y + COMBAT.capsule.halfHeight, o.pose.z])
    <= COMET_SWEEP_RADIUS_M + COMBAT.capsule.radius);
  if (!best) return [];
  const victim = c.host.combat.get(best.id)!;
  x.branches[best.id] = victim.action === "Ragdolled" ? "ragdoll" : "standing"; // read before the capture changes the state
  const cand = buildCandidate(c, best.id, 0, ap.x, ap.z);
  cand.reaction = { kind: "none" };
  cand.damage100 = 0;
  cand.maxHitsPerTarget = 1;
  cand.capture = { cinematic: false, maxTicks: COMET_RELEASE_OFFSET + 1 };
  return [cand];
}

function splashCandidates(c: CastContext): HitCandidate[] {
  const st = seqOf(c);
  if (st.victimId === null || st.released || !holdsCapture(c, st) || c.tick - st.captureTick !== COMET_DAMAGE_OFFSET) return [];
  const vp = c.host.pose(st.victimId);
  if (!vp) return [];
  return areaTargets(c.host, vp, COMET_SPLASH_RADIUS_M, c.cast.def.maxTargets - 1, [c.fighter.entityId, st.victimId]).map((id) => ({
    ...buildCandidate(c, id, SPLASH_INDEX, vp.x, vp.z),
    damage100: COMET_SPLASH_DAMAGE100, chip100: COMET_SPLASH_CHIP100, counterable: false, block: "B" as const, armorBreak: false,
    reaction: { kind: "ragdoll" as const, ticks: COMET_SPLASH_RAGDOLL_TICKS }, launch: { ...COMET_SPLASH_LAUNCH }, maxHitsPerTarget: 1,
  }));
}

export const COMET_LOCK: AbilityHandler = {
  ...base,
  onTick(c) { base.onTick?.(c); dashStep(c); },
  candidates(c) {
    const st = seqOf(c);
    return st.victimId === null ? probe(c) : [...base.candidates!(c), ...splashCandidates(c)];
  },
};
