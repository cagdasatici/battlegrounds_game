import { COMBAT } from "@eb/shared/config/combat";
import { isAlive, type Fighter } from "../../sim/ActionMachine.js";
import type { AbilityHandler, AbilityHost, AbilityPose } from "../../sim/AbilityRunner.js";
import type { HitCandidate } from "../../sim/HitResolver.js";
import { makeSequenceHandler } from "./sequence.js";

/** D values from the spec 15 throwCapture card. */
export const COLLISION_BONUS_DAMAGE100 = 300;
export const THROWN_PLAYER_DAMAGE100 = 500;
export const THROWN_PLAYER_STUN_TICKS = 18;
/** The collision marker lives this many ticks after the release tick (valid on release+1 .. release+89). */
export const COLLISION_MARKER_TICKS = 90;
const BONUS_HIT_INDEX = 90;
const MOVE_ID = "td.b3";
const STORE = "td.thrown";

/** One thrown body. At most one collision bonus and one player hit per throw, never twice. */
interface Thrown {
  victimId: number;
  victimLife: number;
  /** Victim action generation right after the release reaction; any later action change ends the marker. */
  generation: number;
  captorId: number;
  startTick: number;
  until: number;
  bonusLeft: boolean;
  playerHitLeft: boolean;
}

const CAP_R = COMBAT.capsule.radius;
const CAP_HALF = COMBAT.capsule.halfHeight;

/** Capsule vs capsule contact between two bodies (vertical capsules). */
function touching(a: AbilityPose, b: AbilityPose): boolean {
  const gap = Math.max(0, Math.abs(a.y - b.y) - 2 * CAP_HALF);
  return Math.hypot(Math.hypot(a.x - b.x, a.z - b.z), gap) <= 2 * CAP_R;
}

function collisionCandidates(tick: number, host: AbilityHost, list: Thrown[]): HitCandidate[] {
  const out: HitCandidate[] = [];
  const thrownIds = new Set(list.map((m) => m.victimId));
  const keep: Thrown[] = [];
  for (const m of list) {
    const v = host.combat.get(m.victimId);
    const cap = host.combat.get(m.captorId);
    if (!v || !cap || !isAlive(v) || !isAlive(cap) || v.lifeId !== m.victimLife || v.generation !== m.generation
      || v.action !== "Ragdolled" || tick >= m.until) continue; // marker over: hit again, evaded, landed, dead or expired
    if (tick <= m.startTick) { keep.push(m); continue; } // nothing on the release tick itself
    const vp = host.pose(m.victimId);
    const wall = m.bonusLeft && !!host.wallContact?.(m.victimId, tick);
    let other: Fighter | null = null;
    if (m.playerHitLeft && vp) {
      // The nearest other living player in contact. Not the captor, and not another thrown body (no chains).
      let best = Infinity;
      for (const f of host.combat.all()) {
        if (f.entityId === m.victimId || f.entityId === m.captorId || !isAlive(f) || thrownIds.has(f.entityId)) continue;
        const fp = host.pose(f.entityId);
        if (!fp || !touching(vp, fp)) continue;
        const d = Math.hypot(fp.x - vp.x, fp.z - vp.z);
        if (d < best) { best = d; other = f; }
      }
    }
    if ((wall || other) && m.bonusLeft) {
      // The first wall or player collision deals the bonus to the thrown victim and clears the marker.
      m.bonusLeft = false;
      const cp = host.pose(m.captorId) ?? vp;
      out.push({
        attackerId: m.captorId, attackerGeneration: cap.generation, castCounter: cap.castCounter, hitIndex: BONUS_HIT_INDEX, toi: 0,
        targetId: m.victimId, moveId: MOVE_ID, originX: cp?.x ?? 0, originZ: cp?.z ?? 0, block: "U", counterable: false,
        armorBreak: false, damage100: COLLISION_BONUS_DAMAGE100, reaction: { kind: "none" }, maxHitsPerTarget: 99,
      });
    }
    if (other && vp) {
      m.playerHitLeft = false;
      out.push({
        attackerId: m.victimId, attackerGeneration: v.generation, castCounter: v.castCounter, hitIndex: 0, toi: 0,
        targetId: other.entityId, moveId: MOVE_ID, originX: vp.x, originZ: vp.z, block: "B",
        counterable: false, // a thrown body hit can neither be countered nor start another thrown collision
        armorBreak: false, damage100: THROWN_PLAYER_DAMAGE100, reaction: { kind: "stun", ticks: THROWN_PLAYER_STUN_TICKS },
        maxHitsPerTarget: 1,
      });
    }
    if (m.bonusLeft || m.playerHitLeft) keep.push(m);
  }
  list.length = 0;
  list.push(...keep);
  return out;
}

const base = makeSequenceHandler({
  name: "throwCapture",
  onReleased(c, st, victim) {
    const list = c.runner.scratch<Thrown[]>(STORE, () => []);
    const at = list.findIndex((m) => m.victimId === victim.entityId);
    if (at >= 0) list.splice(at, 1);
    list.push({
      victimId: victim.entityId, victimLife: st.victimLife, generation: victim.generation, captorId: c.fighter.entityId,
      startTick: c.tick, until: c.tick + COLLISION_MARKER_TICKS, bonusLeft: true, playerHitLeft: true,
    });
  },
});

/**
 * td.b3 Tidal Cast (throwCapture). Capture (all three target states), 9 damage at +18, release at +19 with
 * R60 F10 U2. Afterwards a collision marker lives for 90 ticks: the first wall (never the floor) or other player
 * contact deals a 3 bonus to the thrown victim exactly once; the thrown victim can hit one other living player
 * for 5 (B, stun 18, noncounterable). Caster armor only during the capture.
 */
export const THROW_CAPTURE: AbilityHandler = {
  ...base,
  globalCollect({ tick, host, runner }) {
    const list = runner.scratch<Thrown[]>(STORE, () => []);
    return list.length === 0 ? [] : collisionCandidates(tick, host, list);
  },
};
