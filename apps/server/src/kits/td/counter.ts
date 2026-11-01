import { isAlive } from "../../sim/ActionMachine.js";
import type { AbilityHandler, CastContext } from "../../sim/AbilityRunner.js";
import type { HitCandidate, HitResult } from "../../sim/HitResolver.js";
import { captureNow, holdsCapture, releaseVictim, scheduledCandidate, type SeqState } from "./sequence.js";

/** D value from the spec 15 counter card: the response only reaches attackers within this 3D distance. */
export const COUNTER_REACH_M = 4;

interface CounterState {
  phase: "open" | "responding" | "ended";
  /** Reuses the sequence bookkeeping so holdsCapture/releaseVictim apply unchanged. */
  seq: SeqState;
}

function stateOf(c: CastContext): CounterState {
  let st = c.cast.data.counter as CounterState | undefined;
  if (!st) {
    st = { phase: "open", seq: { probeEnd: 0, victimId: null, victimLife: 0, captureTick: -1, released: false, extra: {} } };
    c.cast.data.counter = st;
  }
  return st;
}

/** Ends the stance now (absorbed hit, reflected projectile): no response, armor off, recovery follows. */
function endStance(c: CastContext, st: CounterState): void {
  st.phase = "ended";
  c.fighter.counterOpenUntil = 0;
  c.cast.armorUntil = c.tick; // armor ends with the stance; recovery is fully vulnerable
  c.fighter.armored = false;
  c.runner.retimeCast(c.fighter, c.cast, c.tick, c.tick + 1, c.tick + 1 + c.cast.def.recovery);
}

const lastOffset = (c: CastContext): number => c.cast.def.hitOffsets[c.cast.def.hitOffsets.length - 1]!;

/**
 * td.b4 Mirror Current (counter). The window [commit, commit+60) is the fighter's counterOpenUntil; the hit
 * resolver consumes a counterable melee (or reflectable projectile) hit inside it and reports "countered".
 * This handler reads that result on the target side (onIncoming):
 *  - melee attacker within 4 m with line of sight: capture it, deal [6,16] at trigger+[12,30], release at
 *    trigger+31 with R60 F8 U3; the response hits are noncounterable, so a counter never recurses;
 *  - melee attacker beyond 4 m or without line of sight: the hit is absorbed, the stance ends, no response;
 *  - reflectable projectile: the shared reflection rule runs through the optional projectile provider, the
 *    stance ends and no melee response follows.
 * Armor (not invulnerability) covers the stance window and the response. No held button extends the window and
 * the stance is never buffered. A whiff leaves the full recovery vulnerable.
 */
export const COUNTER: AbilityHandler = {
  name: "counter",
  bufferable: false,
  onCommit(c) {
    stateOf(c);
    c.fighter.counterOpenUntil = c.tick + c.cast.def.active;
    c.cast.armorUntil = c.tick + c.cast.def.active;
  },
  onIncoming(c, results: readonly HitResult[]) {
    const st = stateOf(c);
    if (st.phase !== "open") return;
    const me = c.fighter.entityId;
    for (const r of results) {
      if (r.outcome !== "countered" || r.candidate.targetId !== me) continue;
      const cand = r.candidate;
      if (cand.projectile) {
        c.host.projectiles?.reflect({ projectileId: cand.projectile.id, reflectorId: me, tick: c.tick });
        endStance(c, st);
        return;
      }
      const attacker = c.host.combat.get(cand.attackerId);
      const ap = c.host.pose(cand.attackerId);
      const cp = c.host.pose(me);
      const reachable = !!attacker && !!ap && !!cp && isAlive(attacker)
        && Math.hypot(ap.x - cp.x, ap.y - cp.y, ap.z - cp.z) <= COUNTER_REACH_M
        && !c.host.blocked([cp.x, cp.y, cp.z], [ap.x, ap.y, ap.z]);
      if (!attacker || !reachable || !captureNow(c, attacker, c.tick, lastOffset(c) + 2)) {
        endStance(c, st);
        return;
      }
      st.phase = "responding";
      st.seq.victimId = attacker.entityId;
      st.seq.victimLife = attacker.lifeId;
      st.seq.captureTick = c.tick; // the trigger tick
      const releaseTick = c.tick + lastOffset(c) + 1;
      c.runner.retimeCast(c.fighter, c.cast, c.tick, releaseTick, releaseTick + c.cast.def.recovery);
      c.cast.armorUntil = releaseTick;
      c.fighter.armored = true;
      return;
    }
  },
  onTick(c) {
    const st = stateOf(c);
    if (st.phase !== "responding" || st.seq.released || st.seq.victimId === null) return;
    if (!holdsCapture(c, st.seq)) return;
    if (c.tick - st.seq.captureTick >= lastOffset(c) + 1) {
      st.seq.released = true;
      releaseVictim(c, st.seq.victimId, st.seq.victimLife);
    }
  },
  candidates(c): HitCandidate[] {
    const st = stateOf(c);
    if (st.phase !== "responding" || st.seq.released || !holdsCapture(c, st.seq)) return [];
    const rel = c.tick - st.seq.captureTick;
    const d = c.cast.def;
    const out: HitCandidate[] = [];
    d.hitOffsets.forEach((off, i) => {
      if (off !== rel) return;
      const cand = scheduledCandidate(c, st.seq.victimId!, i, d.damage100[i]!);
      if (cand) out.push(cand);
    });
    return out;
  },
  onEnd(c) {
    const st = c.cast.data.counter as CounterState | undefined;
    c.fighter.counterOpenUntil = 0;
    if (st && st.seq.victimId !== null && !st.seq.released && holdsCapture(c, st.seq)) {
      c.host.combat.release(st.seq.victimId, c.tick, "cancelled");
    }
  },
};
