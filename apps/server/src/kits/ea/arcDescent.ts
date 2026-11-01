import { COMBAT } from "@eb/shared/config/combat";
import { isAlive } from "../../sim/ActionMachine.js";
import { buildCandidate, forwardOf, type AbilityHandler, type AbilityPose, type CastContext } from "../../sim/AbilityRunner.js";
import type { HitCandidate } from "../../sim/HitResolver.js";
import { awakenedEligible, makeAwakenedSequence } from "../td/awakened.js";
import { seqOf, type SeqState } from "../td/sequence.js";
import { segmentDistance } from "../td/riptidePursuit.js";
import { areaTargets } from "./area.js";

/**
 * ea.a1 Arc Descent (spec 15, awakened slot 1). All numbers are D (decision 0022).
 *
 * - Startup armor (definition). From activeStart the caster advances 0.4 m per tick (24 m/s) along the commit aim through
 *   the host's swept collision for the 18 active ticks (7.2 m); a wall ends the advance. Each tick a sphere of radius 0.6 m
 *   at capsule centre + 0.2 m is swept along the step and captures the nearest eligible fighter it touches (reach 8 m
 *   with the sweep radius and capsule). The initial hit is counterable and U.
 * - Capture: cinematic protection for both fighters, 15 HP at the capture, 25 HP at +36, release +42 R84 F5 U8.
 *   A captured victim that dies leaves no miss branch.
 * - Miss (no capture by the end of the active window): a 30 tick vulnerable blast windup (no armor) follows, then a
 *   radius 5 blast, 20 HP, U, noncounterable, R60 F5 U5, at most 4 targets. Recovery follows the blast.
 * - Interrupted windup (a hit that stuns, ragdolls or captures the caster before the blast): one smaller blast, radius 2,
 *   13 HP, U, noncounterable, R36 F3 U3, on the next tick, then the cast is cancelled. A killed caster emits none.
 */
export const ARC_STEP_M = 0.4;
export const ARC_SWEEP_RADIUS_M = 0.6;
export const ARC_SWEEP_CENTRE_Y = 0.2;
export const ARC_RELEASE_OFFSET = 42;
export const ARC_MISS_WINDUP_TICKS = 30;
export const ARC_BLAST_RADIUS_M = 5;
export const ARC_BLAST_DAMAGE100 = 2000;
export const ARC_BLAST_RAGDOLL_TICKS = 60;
export const ARC_BLAST_LAUNCH = { forward: 5, up: 5 } as const;
export const ARC_SMALL_RADIUS_M = 2;
export const ARC_SMALL_DAMAGE100 = 1300;
export const ARC_SMALL_RAGDOLL_TICKS = 36;
export const ARC_SMALL_LAUNCH = { forward: 3, up: 3 } as const;
const BLAST_INDEX = 2;
const SMALL_INDEX = 3;

interface Seg { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number }
interface ArcExtra { stopped: boolean; seg: Seg | null; captureSeen: boolean; blastTick: number; windup: boolean }
const extraOf = (st: SeqState): ArcExtra => st.extra as unknown as ArcExtra;

/** Interrupted windup blasts queued by onIncoming. They outlive the cancelled cast, so they live in the runner scratch. */
interface Pending { attackerId: number; lifeId: number; castCounter: number; tick: number; x: number; y: number; z: number }
const pendingOf = (c: { runner: { scratch<T>(k: string, init: () => T): T } }): Pending[] =>
  c.runner.scratch<Pending[]>("ea.a1.pending", () => []);

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
  name: "arcDescent",
  cinematic: true,
  releaseOffset: ARC_RELEASE_OFFSET,
  onCommit(_c, st) { st.extra = { stopped: false, seg: null, captureSeen: false, blastTick: -1, windup: false } satisfies ArcExtra; },
});

/** The advance runs before candidates: step along the aim and remember the swept segment for the probe. */
function dashStep(c: CastContext): void {
  const st = seqOf(c);
  const x = extraOf(st);
  x.seg = null;
  if (st.victimId !== null || x.captureSeen || c.tick < c.cast.activeStart || c.tick >= st.probeEnd) return;
  const ap = c.host.pose(c.fighter.entityId);
  if (!ap) return;
  const y = ap.y + ARC_SWEEP_CENTRE_Y;
  let nx = ap.x, nz = ap.z;
  if (!x.stopped && c.host.moveTogether) {
    const [fx, fz] = forwardOf(c.cast.aimYaw);
    const moved = c.host.moveTogether([c.fighter.entityId], fx * ARC_STEP_M, fz * ARC_STEP_M);
    if (Math.hypot(moved.dx, moved.dz) < ARC_STEP_M * 0.999) x.stopped = true;
    const np = c.host.pose(c.fighter.entityId);
    if (np) { nx = np.x; nz = np.z; }
  }
  x.seg = { x0: ap.x, y0: y, z0: ap.z, x1: nx, y1: y, z1: nz };
}

/** At the end of the active window with no capture: enter the vulnerable blast windup (re-enter Active, like td.a4's chain). */
function missCheck(c: CastContext): void {
  const st = seqOf(c);
  const x = extraOf(st);
  if (c.tick !== st.probeEnd || st.victimId !== null || x.captureSeen || x.windup) return;
  x.windup = true;
  x.blastTick = c.tick + ARC_MISS_WINDUP_TICKS;
  c.fighter.action = "Active";
  c.runner.retimeCast(c.fighter, c.cast, c.tick, x.blastTick + 1, x.blastTick + 1 + c.cast.def.recovery);
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
    <= ARC_SWEEP_RADIUS_M + COMBAT.capsule.radius);
  if (!best) return [];
  const cand = buildCandidate(c, best.id, 0, ap.x, ap.z);
  cand.reaction = { kind: "none" };
  cand.maxHitsPerTarget = 1;
  cand.capture = { cinematic: true, maxTicks: ARC_RELEASE_OFFSET + 1 };
  return [cand];
}

function blastCandidates(c: CastContext): HitCandidate[] {
  const x = extraOf(seqOf(c));
  if (!x.windup || c.tick !== x.blastTick) return [];
  const ap = c.host.pose(c.fighter.entityId);
  if (!ap) return [];
  return areaTargets(c.host, ap, ARC_BLAST_RADIUS_M, c.cast.def.maxTargets, [c.fighter.entityId]).map((id, i) => ({
    ...buildCandidate(c, id, BLAST_INDEX * 10 + i, ap.x, ap.z),
    damage100: ARC_BLAST_DAMAGE100, counterable: false, block: "U" as const, armorBreak: false,
    reaction: { kind: "ragdoll" as const, ticks: ARC_BLAST_RAGDOLL_TICKS }, launch: { ...ARC_BLAST_LAUNCH }, maxHitsPerTarget: 2,
  }));
}

export const ARC_DESCENT: AbilityHandler = {
  ...base,
  onTick(c) { base.onTick?.(c); dashStep(c); missCheck(c); },
  candidates(c) {
    const st = seqOf(c);
    const first = st.victimId === null ? probe(c) : base.candidates!(c);
    return [...first, ...blastCandidates(c)];
  },
  onResults(c, results) {
    base.onResults?.(c, results);
    // A capture that killed its victim still counts: no miss branch after a captured victim dies (spec 15).
    if (results.some((r) => r.candidate.hitIndex === 0 && r.outcome === "captured")) extraOf(seqOf(c)).captureSeen = true;
  },
  /** Interrupted windup: queue one smaller blast before the cast is cancelled. Death emits none. */
  onIncoming(c, results) {
    const x = extraOf(seqOf(c));
    if (!x.windup || c.tick >= x.blastTick || !isAlive(c.fighter)) return;
    const hit = results.some((r) => (r.outcome === "hit" || r.outcome === "captured") && !r.killed);
    const a = c.fighter.action;
    if (!hit || (a !== "Stunned" && a !== "Ragdolled" && a !== "Captured")) return;
    const ap = c.host.pose(c.fighter.entityId);
    if (!ap) return;
    x.windup = false; // the windup is over; the full blast can never fire
    pendingOf(c).push({ attackerId: c.fighter.entityId, lifeId: c.fighter.lifeId, castCounter: c.cast.castCounter, tick: c.tick + 1, x: ap.x, y: ap.y, z: ap.z });
  },
  globalCollect(c) {
    const list = pendingOf(c);
    if (list.length === 0) return [];
    const out: HitCandidate[] = [];
    for (let k = list.length - 1; k >= 0; k--) {
      const p = list[k]!;
      if (c.tick < p.tick) continue;
      list.splice(k, 1);
      const f = c.host.combat.get(p.attackerId);
      if (c.tick !== p.tick || !f || !isAlive(f) || f.lifeId !== p.lifeId) continue;
      areaTargets(c.host, p, ARC_SMALL_RADIUS_M, 4, [p.attackerId]).forEach((id, i) => {
        out.push({
          attackerId: p.attackerId, attackerGeneration: f.generation, castCounter: p.castCounter, hitIndex: SMALL_INDEX * 10 + i, toi: 0,
          targetId: id, moveId: "ea.a1", originX: p.x, originZ: p.z, block: "U", counterable: false, armorBreak: false,
          damage100: ARC_SMALL_DAMAGE100, reaction: { kind: "ragdoll", ticks: ARC_SMALL_RAGDOLL_TICKS }, maxHitsPerTarget: 2,
          launch: { ...ARC_SMALL_LAUNCH },
        });
      });
    }
    return out;
  },
};
