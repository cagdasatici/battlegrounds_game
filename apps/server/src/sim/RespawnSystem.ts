import { COMBAT } from "@eb/shared/config/combat";
import type { Anchor } from "@eb/shared/config/arena";
import type { KitId } from "@eb/shared/protocol";
import { killRewardFor } from "@eb/shared/config/passives";

/** D: an anchor is rejected when an occupied capsule is closer than this (spec section 10). */
export const SPAWN_CLEARANCE_M = 2;
/** D: radius around an active hostile hit origin inside which an anchor is rejected. */
export const HOSTILE_REGION_RADIUS_M = 2;
/** Spec section 10: when no anchor qualifies, retry for 60 ticks, then take the farthest. */
export const SPAWN_RETRY_TICKS = 60;

export interface Pt { x: number; z: number }
export interface Region extends Pt { r: number }
export interface SpawnChoice { anchor: Anchor; valid: boolean }

const dist = (a: Pt, p: readonly number[]): number => Math.hypot(a.x - p[0]!, a.z - p[2]!);

/** Distance from an anchor to the nearest living enemy; Infinity when there is none. */
function nearest(anchor: Anchor, enemies: readonly Pt[]): number {
  let d = Infinity;
  for (const e of enemies) d = Math.min(d, dist(e, anchor.position));
  return d;
}

/**
 * Deterministic spawn choice (spec section 10). Valid anchors are at least 2 m from every occupied capsule and
 * outside every active hostile hit region; the valid anchor farthest from the nearest living enemy wins and ties go
 * to the lowest anchor id. When nothing is valid the result has valid=false and names the farthest anchor overall
 * (same tie rule) so the caller can use it after the retry window.
 */
export function pickSpawn(anchors: readonly Anchor[], occupied: readonly Pt[], regions: readonly Region[], enemies: readonly Pt[]): SpawnChoice {
  const sorted = [...anchors].sort((a, b) => a.id - b.id);
  const best = (list: readonly Anchor[]): Anchor | undefined => {
    let pick: Anchor | undefined, bestD = -1;
    for (const a of list) {
      const d = Math.round(nearest(a, enemies) * 100) / 100; // centimetre ties: float noise must not decide
      if (d > bestD) { pick = a; bestD = d; }
    }
    return pick;
  };
  const ok = sorted.filter((a) =>
    occupied.every((o) => dist(o, a.position) >= SPAWN_CLEARANCE_M)
    && regions.every((r) => dist(r, a.position) >= r.r));
  const valid = best(ok);
  if (valid) return { anchor: valid, valid: true };
  return { anchor: best(sorted)!, valid: false };
}

/** Duelist finisher passive (spec section 15): heal in hundredths by the lethal move. Zero for everything else. */
export function finisherHeal100(kit: KitId, moveId: string | undefined): number {
  const r = killRewardFor(kit, moveId);
  return r?.kind === "heal" ? r.amount100 : 0;
}

interface DamageEntry { attacker: number; tick: number; damage100: number }
export interface KoScore { scorer: number | undefined; assists: number[] }

/**
 * Per room death bookkeeping: damage attribution per victim life, combat timers, KO scoring and respawn deadlines.
 * Pure integer-tick state; no timers. The tick pipeline drives it.
 */
export class RespawnSystem {
  private readonly ledger = new Map<number, DamageEntry[]>();
  private readonly lastCombat = new Map<number, number>();
  private readonly pending = new Map<number, number>(); // victim -> tick at which the countdown ends
  private readonly rewarded = new Set<number>(); // victim life ids whose passive was paid

  /** Actual HP removed from another fighter. Starts both fighters' combat timers. */
  recordDamage(attacker: number, victim: number, tick: number, damage100: number): void {
    if (attacker === victim || damage100 <= 0) return;
    let list = this.ledger.get(victim);
    if (!list) this.ledger.set(victim, list = []);
    list.push({ attacker, tick, damage100 });
    this.lastCombat.set(attacker, tick);
    this.lastCombat.set(victim, tick);
    this.trim(list, tick);
  }

  /** Starts only the victim's combat timer: damage from a departed owner that nobody may be credited for (GR02). */
  touchCombat(victim: number, tick: number): void { this.lastCombat.set(victim, tick); }

  /** A life begins: the quiet timer starts at spawn, so a fresh spawn cannot switch kit at once (D). */
  startLife(id: number, tick: number): void { this.lastCombat.set(id, tick); }

  /** True until 480 ticks have passed since spawn or since the last damage dealt or taken (spec section 6). */
  inCombat(id: number, tick: number): boolean {
    const t = this.lastCombat.get(id);
    return t !== undefined && tick - t < COMBAT.assistWindowTicks;
  }

  /**
   * Scores one KO and ends the victim life's attribution. killer is the lethal hitter, or undefined for a ring-out:
   * then the most recent hostile attacker inside the window scores (same tick ties keep resolver order), else nobody.
   * Assists go to every other attacker with at least 20 HP inside the window, only when someone scores.
   */
  resolveKo(victim: number, tick: number, killer: number | undefined): KoScore {
    const list = this.ledger.get(victim) ?? [];
    this.trim(list, tick);
    let scorer = killer;
    if (scorer === undefined) {
      let latest = -1;
      for (const e of list) if (e.tick > latest) { latest = e.tick; scorer = e.attacker; }
    }
    const assists: number[] = [];
    if (scorer !== undefined) {
      const sums = new Map<number, number>();
      for (const e of list) if (e.attacker !== scorer) sums.set(e.attacker, (sums.get(e.attacker) ?? 0) + e.damage100);
      for (const [a, s] of sums) if (s >= COMBAT.assistMinDamage * 100) assists.push(a);
      assists.sort((a, b) => a - b);
    }
    this.ledger.delete(victim);
    return { scorer, assists };
  }

  /** True once per victim life: the finisher passive may be paid. */
  claimReward(victimLifeId: number): boolean {
    if (this.rewarded.has(victimLifeId)) return false;
    this.rewarded.add(victimLifeId);
    return true;
  }

  schedule(victim: number, deathTick: number): void { this.pending.set(victim, deathTick + COMBAT.respawnTicks); }
  isPending(id: number): boolean { return this.pending.has(id); }
  /** Victims whose countdown has ended, in entity order. */
  due(tick: number): number[] { return [...this.pending].filter(([, t]) => tick >= t).map(([id]) => id).sort((a, b) => a - b); }
  /** True once the 60 tick retry window after the deadline is over. */
  fallbackReached(id: number, tick: number): boolean { return tick >= (this.pending.get(id) ?? Infinity) + SPAWN_RETRY_TICKS; }
  /** Respawn countdown end tick, if dead. */
  deadlineOf(id: number): number | undefined { return this.pending.get(id); }
  /** The victim is alive again: a fresh life with an empty ledger and the quiet timer restarted. */
  complete(id: number, tick: number): void { this.pending.delete(id); this.ledger.delete(id); this.lastCombat.set(id, tick); }

  /** Departure or dispose. */
  forget(id: number): void {
    this.pending.delete(id); this.ledger.delete(id); this.lastCombat.delete(id);
    for (const list of this.ledger.values()) { for (let i = list.length - 1; i >= 0; i--) if (list[i]!.attacker === id) list.splice(i, 1); }
  }
  clear(): void { this.ledger.clear(); this.lastCombat.clear(); this.pending.clear(); this.rewarded.clear(); }

  private trim(list: DamageEntry[], tick: number): void {
    for (let i = list.length - 1; i >= 0; i--) if (tick - list[i]!.tick > COMBAT.assistWindowTicks) list.splice(i, 1);
  }
}
