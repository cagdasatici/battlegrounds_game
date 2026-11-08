import { BEAST_STILLPOINT } from "@eb/shared/config/beast";
import { COMBAT } from "@eb/shared/config/combat";
import { isAlive, releaseToIdle, type Fighter } from "../../sim/ActionMachine.js";
import { buildCandidate, queryTargets, type AbilityHandler, type AbilityHost, type AbilityRunner, type CastContext } from "../../sim/AbilityRunner.js";
import type { HitCandidate, HitResult } from "../../sim/HitResolver.js";
import { captureNow, holdsCapture, releaseVictim, scheduledCandidate, seqOf } from "../td/sequence.js";

/**
 * sv.a1 Stillpoint Reversal (spec 15, lethalCounter). All numbers are D.
 *
 * Commit (startup 0): the form is spent by the framework (consumesForm), the original cast ends at once and the
 * caster is Idle again. What stays open for def.active = 600 ticks is a PRIVATE status owned by this handler (a
 * per runner map plus Fighter.lethalCounterUntil, which the hit resolver reads). It is not a Fighter.action, so
 * every base action works during it and none of them ends it. The status ends on: a countered hit (trigger or
 * absorb), expiry at commit + 600 (exclusive), death, respawn, kit change, or the owner leaving. It is validated
 * every tick (globalCollect), so no path can leak it.
 *
 * Trigger: the resolver consumes the first counterable hit while the status is open and reports "countered".
 * If the attacker is alive, within 40 m (3D) and no static wall lies between the pair, both actions are cancelled
 * and the attacker is captured (cinematic: both participants are shielded from third parties). The response is a
 * detached cast: Active for 72 ticks, then 18 ticks recovery. Damage is 100 HP (lethal cap, never Infinity) at
 * trigger + 60, noncounterable, U; the victim is released at trigger + 72 without a reaction. A successful damage
 * tick heals the caster to 100 HP. Otherwise (too far, wall in between, attacker already captured, capture lost)
 * the hit is absorbed and the status simply ends: no damage, no heal, no recovery (D: base actions were allowed).
 * A noncounterable hit is never intercepted: it damages normally, and if it kills, the status dies with the caster.
 *
 * Beast form (D): the waiting counter is replaced by an immediate shockwave. No status and no lethalCounterUntil are
 * set; the caster is a detached cast (Active 12, Recovery 30). At activeStart every target within 9 m (3D-free sphere
 * query, standing, air or ragdoll, no wall between) takes BEAST_STILLPOINT.damage100 (doubled by beastFormDamage100),
 * ragdoll 60 and launch F8 U8, noncounterable, U block. The reload is commit + 12 + 30 + 240 ticks.
 */
export const LETHAL_COUNTER_REACH_M = 40;
export const RESPONSE_DAMAGE_OFFSET = 60;
export const RESPONSE_RELEASE_OFFSET = 72;
const KEY = "sv.lethalCounter";

interface Status { lifeId: number; startTick: number; endTick: number }
const statusesOf = (runner: AbilityRunner): Map<number, Status> => runner.scratch(KEY, () => new Map<number, Status>());

/** Remaining ticks of the owner's private status (0 when none). The local UI reads this for the owner only. */
export function lethalCounterRemaining(runner: AbilityRunner, entityId: number, tick: number): number {
  const st = statusesOf(runner).get(entityId);
  return st ? Math.max(0, st.endTick - tick) : 0;
}

const dist3 = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

function trigger(tick: number, host: AbilityHost, runner: AbilityRunner, caster: Fighter, cand: HitCandidate): void {
  const def = runner.registry.byId("sv.a1");
  const attacker = host.combat.get(cand.attackerId);
  const cp = host.pose(caster.entityId), ap = host.pose(cand.attackerId);
  const caps = host.combat.captures;
  const reachable = !!def && !!attacker && !!cp && !!ap && isAlive(attacker) && isAlive(caster)
    && attacker.entityId !== caster.entityId
    && dist3(cp, ap) <= LETHAL_COUNTER_REACH_M
    && !host.blocked([cp.x, cp.y, cp.z], [ap.x, ap.y, ap.z])
    && !caps.isCaptured(attacker.entityId) && !caps.isCaptured(caster.entityId);
  if (!reachable || !def || !attacker) return; // absorbed: the resolver already consumed the hit, the status is gone
  // Cancel both actions. The attacker's own capture (if it was a captor) ends with its action.
  const own = caps.victimOf(attacker.entityId);
  if (own) host.combat.release(own.victimId, tick, "cancelled");
  runner.cancel(caster.entityId);
  releaseToIdle(caster, tick);
  const cast = runner.beginDetachedCast(caster, tick, def, RESPONSE_RELEASE_OFFSET, def.recovery, { resp: true });
  if (!cast) return;
  const ctx: CastContext = { tick, fighter: caster, cast, host, runner };
  const st = seqOf(ctx);
  if (!captureNow(ctx, attacker, tick, RESPONSE_RELEASE_OFFSET + 1, true)) {
    runner.cancel(caster.entityId);
    releaseToIdle(caster, tick);
    return;
  }
  st.victimId = attacker.entityId;
  st.victimLife = attacker.lifeId;
  st.captureTick = tick;
}

export const LETHAL_COUNTER: AbilityHandler = {
  name: "lethalCounter",
  onCommit(c) {
    const f = c.fighter;
    if (f.beast) {
      c.runner.cancel(f.entityId);
      releaseToIdle(f, c.tick);
      f.cooldowns.delete(c.cast.def.id); // the framework stored the 600 tick reload; beginDetachedCast would refuse it
      const cast = c.runner.beginDetachedCast(f, c.tick, c.cast.def, BEAST_STILLPOINT.activeTicks, BEAST_STILLPOINT.recoveryTicks, { beastWave: true });
      // beginCast stores cooldown 0 for a detached cast, so the reload is set after it.
      f.cooldowns.set(c.cast.def.id, c.tick + BEAST_STILLPOINT.activeTicks + BEAST_STILLPOINT.recoveryTicks + BEAST_STILLPOINT.restTicks);
      void cast;
      return;
    }
    const end = c.tick + c.cast.def.active;
    statusesOf(c.runner).set(f.entityId, { lifeId: f.lifeId, startTick: c.tick, endTick: end });
    f.lethalCounterUntil = end;
    c.runner.cancel(f.entityId); // the commit cast never occupies the action state
    releaseToIdle(f, c.tick);
  },
  globalCollect({ tick, host, runner }) {
    const m = statusesOf(runner);
    for (const [id, st] of [...m]) {
      const f = host.combat.get(id);
      const live = !!f && isAlive(f) && f.lifeId === st.lifeId && runner.kitOf(id) === "sv"
        && tick < st.endTick && f.lethalCounterUntil === st.endTick;
      if (live) continue;
      m.delete(id);
      if (f && f.lethalCounterUntil === st.endTick) f.lethalCounterUntil = 0;
    }
    return [];
  },
  globalResults({ tick, host, runner }, results: readonly HitResult[]) {
    const m = statusesOf(runner);
    for (const r of results) {
      if (r.outcome !== "countered") continue;
      const st = m.get(r.candidate.targetId);
      const f = host.combat.get(r.candidate.targetId);
      if (!st || !f) continue;
      m.delete(r.candidate.targetId); // one hit ends the status, trigger or absorb
      f.lethalCounterUntil = 0;
      if (f.lifeId === st.lifeId) trigger(tick, host, runner, f, r.candidate);
    }
  },
  candidates(c): HitCandidate[] {
    if (c.cast.data.beastWave === true) {
      const ap = c.host.pose(c.fighter.entityId);
      if (!ap || c.tick !== c.cast.activeStart) return [];
      // def.maxTargets is 1 (the response hits one attacker); the wave is an AoE, so lift the cap for this query only.
      const wide: CastContext = { ...c, cast: { ...c.cast, def: { ...c.cast.def, maxTargets: 16 } } };
      const ids = queryTargets(wide, { shape: { kind: "sphere", r: BEAST_STILLPOINT.radius }, range: 0, targetStates: ["standing", "air", "ragdoll"] });
      return ids.map((id) => {
        const cand = buildCandidate(c, id, 0, ap.x, ap.z);
        cand.damage100 = BEAST_STILLPOINT.damage100;
        cand.reaction = { kind: "ragdoll", ticks: BEAST_STILLPOINT.ragdollTicks };
        cand.launch = { forward: BEAST_STILLPOINT.launch.forward, up: BEAST_STILLPOINT.launch.up };
        cand.block = "U";
        cand.counterable = false;
        return cand;
      });
    }
    if (c.cast.data.resp !== true) return [];
    const st = seqOf(c);
    if (st.victimId === null || st.released || !holdsCapture(c, st)) return [];
    if (c.tick - st.captureTick !== c.cast.def.hitOffsets[0]) return [];
    const cand = scheduledCandidate(c, st.victimId, 0, c.cast.def.damage100[0]!);
    return cand ? [cand] : [];
  },
  onTick(c) {
    if (c.cast.data.resp !== true) return;
    const st = seqOf(c);
    if (st.victimId === null || st.released || !holdsCapture(c, st)) return;
    if (c.tick - st.captureTick >= RESPONSE_RELEASE_OFFSET) {
      st.released = true;
      releaseVictim(c, st.victimId, st.victimLife);
    }
  },
  onResults(c, results: readonly HitResult[]) {
    if (c.cast.data.resp !== true || c.cast.data.healed === true) return;
    for (const r of results) {
      if (r.candidate.hitIndex !== 0 || r.outcome !== "hit" || r.damage100 <= 0) continue;
      c.cast.data.healed = true;
      c.host.combat.heal(c.fighter, COMBAT.hp100Max, c.cast.def.id, c.tick);
      return;
    }
  },
  onEnd(c) {
    if (c.cast.data.resp !== true) return;
    const st = c.cast.data.seq as ReturnType<typeof seqOf> | undefined;
    if (st && st.victimId !== null && !st.released && holdsCapture(c, st)) c.host.combat.release(st.victimId, c.tick, "cancelled");
  },
};
