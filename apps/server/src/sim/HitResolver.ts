import { COMBAT } from "@eb/shared/config/combat";
import {
  applyBlockstun, applyReaction, enterCaptured, isAlive, isGuarding, isInvulnerable, isProtected,
  type Fighter, type Reaction,
} from "./ActionMachine.js";
import type { CaptureRegistry } from "./CaptureRegistry.js";

/**
 * Deterministic serial hit resolution for one tick (spec section 13). Candidates are produced by move
 * handlers from server poses at the current tick (no rewind, no client claims). They are sorted by time of
 * impact, attacker entity ID, cast counter and hit index and applied serially. Within one candidate:
 * protection, invulnerability, capture shield, counter, guard, then damage and reaction (spec 12).
 */
export interface HitCandidate {
  attackerId: number;
  /** Attacker action generation captured when the hit phase was scheduled. */
  attackerGeneration: number;
  castCounter: number;
  hitIndex: number;
  /** Time of impact within the tick, 0..1. */
  toi: number;
  targetId: number;
  moveId: string;
  /** World-space impact origin, used for the guard cone. */
  originX: number;
  originZ: number;
  block: "B" | "U";
  counterable: boolean;
  armorBreak: boolean;
  damage100: number;
  reaction: Reaction;
  maxHitsPerTarget: number;
  /**
   * Present only for projectile hits (T19). A counter stance intercepts projectiles only when reflectable
   * (spec 13/15); melee candidates leave this unset.
   */
  projectile?: { id: number; reflectable: boolean };
  /** Present for capture commits. A losing capture deals nothing. */
  capture?: { cinematic: boolean; maxTicks: number };
}

export type HitOutcome =
  | "hit" | "blocked" | "countered" | "invulnerable" | "protected" | "shielded"
  | "captured" | "captureLost" | "duplicate" | "staleAttacker" | "deadTarget" | "self";

export interface HitResult { candidate: HitCandidate; outcome: HitOutcome; damage100: number; killed: boolean }

export interface Pose { x: number; z: number; facingYaw: number; grounded: boolean }

export interface HitContext {
  fighter(id: number): Fighter | undefined;
  pose(id: number): Pose | undefined;
  captures: CaptureRegistry;
  ledger: HitLedger;
  /** Called once when a hit reduces HP to zero; must kill the fighter and clean up its captures. */
  onLethal(victimId: number, tick: number): void;
}

const GUARD_COS = Math.cos(((COMBAT.guard.coneDeg / 2) * Math.PI) / 180);
/** D: tolerance so exactly 60 degrees counts as frontal despite float rounding (spec 13 uses >=). */
const GUARD_EPS = 1e-9;

/** dot(target.forward, towardImpact) >= cos(60 deg) on the flattened vector; zero length is frontal. */
export function isFrontal(targetX: number, targetZ: number, facingYaw: number, originX: number, originZ: number): boolean {
  const dx = originX - targetX, dz = originZ - targetZ;
  const len = Math.hypot(dx, dz);
  if (!(len > 1e-9)) return true;
  const fx = -Math.sin(facingYaw), fz = -Math.cos(facingYaw);
  return (fx * dx + fz * dz) / len >= GUARD_COS - GUARD_EPS;
}

export function compareCandidates(a: HitCandidate, b: HitCandidate): number {
  return a.toi - b.toi || a.attackerId - b.attackerId || a.castCounter - b.castCounter || a.hitIndex - b.hitIndex
    || a.targetId - b.targetId;
}

/** Per cast, per victim life hit counts. Entries are removed when the cast ends (see prune). */
export class HitLedger {
  private readonly casts = new Map<string, Map<string, number>>();
  private static castKey(attackerId: number, castCounter: number): string { return `${attackerId}:${castCounter}`; }

  count(attackerId: number, castCounter: number, targetId: number, lifeId: number): number {
    return this.casts.get(HitLedger.castKey(attackerId, castCounter))?.get(`${targetId}:${lifeId}`) ?? 0;
  }
  record(attackerId: number, castCounter: number, targetId: number, lifeId: number): void {
    const k = HitLedger.castKey(attackerId, castCounter);
    let m = this.casts.get(k);
    if (!m) { m = new Map(); this.casts.set(k, m); }
    const t = `${targetId}:${lifeId}`;
    m.set(t, (m.get(t) ?? 0) + 1);
  }
  /** Distinct (target, life) pairs already hit by this cast. */
  targetsHit(attackerId: number, castCounter: number): number {
    return this.casts.get(HitLedger.castKey(attackerId, castCounter))?.size ?? 0;
  }
  /** Drops every cast for which `live` is false (ended, cancelled or attacker gone). */
  prune(live: (attackerId: number, castCounter: number) => boolean): void {
    for (const k of [...this.casts.keys()]) {
      const [a, c] = k.split(":").map(Number) as [number, number];
      if (!live(a, c)) this.casts.delete(k);
    }
  }
  get size(): number { return this.casts.size; }
  clear(): void { this.casts.clear(); }
}

export function resolveHits(tick: number, candidates: readonly HitCandidate[], ctx: HitContext): HitResult[] {
  const sorted = [...candidates].sort(compareCandidates);
  const out: HitResult[] = [];
  const res = (candidate: HitCandidate, outcome: HitOutcome, damage100 = 0, killed = false): void => {
    out.push({ candidate, outcome, damage100, killed });
  };
  for (const c of sorted) {
    const atk = ctx.fighter(c.attackerId);
    const tgt = ctx.fighter(c.targetId);
    if (c.attackerId === c.targetId) { res(c, "self"); continue; }
    // Later attacks from a player killed or interrupted earlier in the same tick are invalid.
    if (!atk || !isAlive(atk) || atk.generation !== c.attackerGeneration) { res(c, "staleAttacker"); continue; }
    if (!tgt || !isAlive(tgt)) { res(c, "deadTarget"); continue; }
    if (ctx.ledger.count(c.attackerId, c.castCounter, c.targetId, tgt.lifeId) >= c.maxHitsPerTarget) { res(c, "duplicate"); continue; }
    if (isProtected(atk, tick) || isProtected(tgt, tick)) { res(c, "protected"); continue; }
    if (isInvulnerable(tgt, tick)) { res(c, "invulnerable"); continue; }
    if (ctx.captures.shieldsFrom(c.targetId, c.attackerId)) { res(c, "shielded"); continue; }
    if (c.counterable && tick < tgt.counterOpenUntil && (!c.projectile || c.projectile.reflectable)) {
      ctx.ledger.record(c.attackerId, c.castCounter, c.targetId, tgt.lifeId);
      tgt.counterOpenUntil = 0; // the counter consumes the incoming hit; response is T13 handler work
      res(c, "countered");
      continue;
    }
    const tp = ctx.pose(c.targetId);
    if (c.block === "B" && isGuarding(tgt, tick) && tp && isFrontal(tp.x, tp.z, tp.facingYaw, c.originX, c.originZ)) {
      ctx.ledger.record(c.attackerId, c.castCounter, c.targetId, tgt.lifeId);
      applyBlockstun(tgt, tick);
      res(c, "blocked");
      continue;
    }
    if (c.capture) {
      const won = ctx.captures.tryCapture({
        victimId: c.targetId, captorId: c.attackerId, captorGeneration: atk.generation, castCounter: c.castCounter,
        moveId: c.moveId, cinematic: c.capture.cinematic, startTick: tick, endTick: tick + c.capture.maxTicks,
      });
      if (!won) { res(c, "captureLost"); continue; }
      ctx.ledger.record(c.attackerId, c.castCounter, c.targetId, tgt.lifeId);
      enterCaptured(tgt, tick, c.moveId);
      const dmg = applyDamage(tgt, c.damage100);
      const killed = tgt.hp100 === 0;
      if (killed) ctx.onLethal(c.targetId, tick);
      res(c, "captured", dmg, killed);
      continue;
    }
    ctx.ledger.record(c.attackerId, c.castCounter, c.targetId, tgt.lifeId);
    const dmg = applyDamage(tgt, c.damage100);
    if (tgt.hp100 === 0) { ctx.onLethal(c.targetId, tick); res(c, "hit", dmg, true); continue; }
    // Armor ignores stun/ragdoll from attacks without armorBreak but still takes damage.
    // A captured victim stays captured; third-party damage does not apply a reaction.
    if ((!tgt.armored || c.armorBreak) && tgt.action !== "Captured") applyReaction(tgt, tick, c.reaction, !(tp?.grounded ?? true));
    res(c, "hit", dmg, false);
  }
  return out;
}

/** Integer hundredths; clamped to remaining HP. Returns HP actually removed. */
function applyDamage(f: Fighter, damage100: number): number {
  const d = Math.max(0, Math.min(f.hp100, Math.trunc(damage100)));
  f.hp100 -= d;
  return d;
}
