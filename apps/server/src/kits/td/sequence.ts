import { applyReaction, enterCaptured, isAlive, type Fighter } from "../../sim/ActionMachine.js";
import {
  buildCandidate, forwardOf, queryTargets,
  type AbilityHandler, type AbilityPose, type CastContext, type EndReason,
} from "../../sim/AbilityRunner.js";
import type { HitCandidate, HitResult } from "../../sim/HitResolver.js";

/**
 * Shared capture sequence for the Tide Duelist capture moves (spec 15, section 16 normalization).
 *
 * Phases of one cast: probe (the active window; at most one capture, only inside the window) -> sequence
 * (scheduled hits at captureTick + hitOffsets[i]) -> release at captureTick + lastOffset + 1 -> recovery.
 * A miss goes straight to recovery at the end of the probe window and can never capture later. All timing is
 * integer ticks driven by the room clock; nothing here schedules anything on its own.
 */
export interface SeqState {
  /** First tick after the probe window (activeStart + def.active). */
  probeEnd: number;
  victimId: number | null;
  victimLife: number;
  captureTick: number;
  released: boolean;
  /** Handler private extras (b2 motion, elevated branch). */
  extra: Record<string, unknown>;
}

export interface SequenceSpec {
  name: string;
  /** Extra target eligibility (e.g. no grounded ragdoll). */
  eligible?(target: Fighter, pose: AbilityPose): boolean;
  /** Damage in hundredths for scheduled hit `index` (default: def.damage100). */
  damageOf?(c: CastContext, st: SeqState, index: number): number;
  onCommit?(c: CastContext, st: SeqState): void;
  onCaptured?(c: CastContext, st: SeqState): void;
  /** Runs every tick of the sequence after the release check (movement, tracking). */
  onSequenceTick?(c: CastContext, st: SeqState, rel: number): void;
  onReleased?(c: CastContext, st: SeqState, victim: Fighter): void;
}

export const releaseOffsetOf = (c: CastContext): number => c.cast.def.hitOffsets[c.cast.def.hitOffsets.length - 1]! + 1;

export function seqOf(c: CastContext): SeqState {
  let st = c.cast.data.seq as SeqState | undefined;
  if (!st) {
    st = { probeEnd: c.cast.activeStart + c.cast.def.active, victimId: null, victimLife: 0, captureTick: -1, released: false, extra: {} };
    c.cast.data.seq = st;
  }
  return st;
}

/** True while this cast still owns the capture on its victim. */
export function holdsCapture(c: CastContext, st: SeqState): boolean {
  if (st.victimId === null) return false;
  const cap = c.host.combat.captures.captureOn(st.victimId);
  return !!cap && cap.captorId === c.fighter.entityId && cap.castCounter === c.cast.castCounter;
}

/**
 * Releases the victim at the end of the sequence and applies the release reaction (ragdoll) and launch from
 * the definition. Returns the victim if it was released alive.
 */
export function releaseVictim(c: CastContext, victimId: number, victimLife: number): Fighter | null {
  const d = c.cast.def;
  const host = c.host;
  host.combat.release(victimId, c.tick, "final");
  const v = host.combat.get(victimId);
  if (!v || !isAlive(v) || v.lifeId !== victimLife) return null;
  const vp = host.pose(victimId);
  if (d.ragdollTicks > 0) applyReaction(v, c.tick, { kind: "ragdoll", ticks: d.ragdollTicks }, vp ? !vp.grounded : false);
  const [fx, fz] = forwardOf(c.cast.aimYaw);
  host.launch?.(victimId, fx * d.launch.forward, d.launch.up, fz * d.launch.forward);
  return v;
}

/** Scheduled (noncounterable) hit on the captured victim. */
export function scheduledCandidate(c: CastContext, victimId: number, index: number, damage100: number): HitCandidate | null {
  const ap = c.host.pose(c.fighter.entityId);
  if (!ap) return null;
  const cand = buildCandidate(c, victimId, index, ap.x, ap.z);
  cand.counterable = false; // spec 13: local counter responses and later sequence hits are noncounterable
  cand.reaction = { kind: "none" };
  cand.damage100 = damage100;
  return cand;
}

export function makeSequenceHandler(spec: SequenceSpec): AbilityHandler {
  return {
    name: spec.name,
    onCommit(c) {
      const st = seqOf(c);
      spec.onCommit?.(c, st);
    },
    candidates(c) {
      const st = seqOf(c);
      const d = c.cast.def;
      const ap = c.host.pose(c.fighter.entityId);
      if (!ap) return [];
      if (st.victimId === null) {
        // Probe: only inside the original active window. After it, nothing can attach (recovery is inert).
        if (c.tick < c.cast.activeStart || c.tick >= st.probeEnd) return [];
        const out: HitCandidate[] = [];
        for (const id of queryTargets(c, spec.eligible ? { filter: spec.eligible } : {})) {
          const cand = buildCandidate(c, id, 0, ap.x, ap.z);
          cand.reaction = { kind: "none" };
          cand.damage100 = spec.damageOf?.(c, st, 0) ?? d.damage100[0]!;
          cand.maxHitsPerTarget = 1; // the probe is one hit across the whole window
          // Safety deadline sits one tick after the handler release so the release (not expiry) ends it.
          cand.capture = { cinematic: false, maxTicks: releaseOffsetOf(c) + 1 };
          out.push(cand);
        }
        return out;
      }
      if (st.released || !holdsCapture(c, st)) return [];
      const rel = c.tick - st.captureTick;
      const out: HitCandidate[] = [];
      d.hitOffsets.forEach((off, i) => {
        if (i === 0 || off !== rel) return;
        const cand = scheduledCandidate(c, st.victimId!, i, spec.damageOf?.(c, st, i) ?? d.damage100[i]!);
        if (cand) out.push(cand);
      });
      return out;
    },
    onResults(c, results: readonly HitResult[]) {
      const st = seqOf(c);
      if (st.victimId !== null) return;
      for (const r of results) {
        if (r.candidate.hitIndex !== 0 || r.outcome !== "captured" || r.killed) continue;
        const victim = c.host.combat.get(r.candidate.targetId);
        if (!victim) continue;
        st.victimId = victim.entityId;
        st.victimLife = victim.lifeId;
        st.captureTick = c.tick;
        const releaseTick = c.tick + releaseOffsetOf(c);
        // A successful hit extends the active window through the last scheduled offset, then recovery follows.
        c.runner.extendCast(c.fighter, c.cast, releaseTick, releaseTick + c.cast.def.recovery);
        c.cast.armorUntil = releaseTick; // caster armor during the capture only
        c.fighter.armored = true;
        spec.onCaptured?.(c, st);
        break;
      }
    },
    onTick(c) {
      const st = seqOf(c);
      if (st.victimId === null || st.released) return;
      if (!holdsCapture(c, st)) return;
      const rel = c.tick - st.captureTick;
      if (rel >= releaseOffsetOf(c)) {
        st.released = true;
        const v = releaseVictim(c, st.victimId, st.victimLife);
        if (v) spec.onReleased?.(c, st, v);
        return;
      }
      spec.onSequenceTick?.(c, st, rel);
    },
    onEnd(c, _why: EndReason) {
      const st = c.cast.data.seq as SeqState | undefined;
      if (!st || st.victimId === null || st.released) return;
      // Cancelled or died without a normal release: no orphan capture may remain.
      if (holdsCapture(c, st)) c.host.combat.release(st.victimId, c.tick, "cancelled");
    },
  };
}

/** Direct capture used by the counter response (the incoming hit was consumed, so there is no candidate). */
export function captureNow(c: CastContext, victim: Fighter, tick: number, maxTicks: number): boolean {
  const me = c.fighter;
  if (!isAlive(me) || !isAlive(victim) || victim.action === "Captured" || me.action === "Captured") return false;
  const won = c.host.combat.captures.tryCapture({
    victimId: victim.entityId, captorId: me.entityId, captorGeneration: me.generation, castCounter: c.cast.castCounter,
    moveId: c.cast.def.id, cinematic: false, startTick: tick, endTick: tick + maxTicks,
  });
  if (!won) return false;
  enterCaptured(victim, tick, c.cast.def.id);
  return true;
}
