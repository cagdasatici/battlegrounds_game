import { COMBAT } from "@eb/shared/config/combat";
import type { KitId } from "@eb/shared/protocol";
import {
  CAPTOR_RELEASE_RECOVERY, createFighter, enterRecovery, expire, isAlive, kill, leaveCaptured, requestDash,
  respawn, updateGuard, type Accept, type Fighter,
} from "./ActionMachine.js";
import { CaptureRegistry, type Release, type ReleaseCause } from "./CaptureRegistry.js";
import { HitLedger, resolveHits, type HitCandidate, type HitResult, type Pose } from "./HitResolver.js";

/**
 * Room-level combat state: fighters, the capture registry and the hit ledger. Driven only by the room's
 * FixedClock tick; owns no scheduler. Every capture and ledger entry is removed on release, expiry,
 * cancellation, death, departure or dispose.
 */
export class CombatSystem {
  private readonly fighters = new Map<number, Fighter>();
  readonly captures = new CaptureRegistry();
  readonly ledger = new HitLedger();
  /** Optional observer of every capture release (the room publishes CombatEvent "release"). */
  onRelease: ((rel: Release, tick: number) => void) | null = null;

  /** Optional observer of every applied heal (the pipeline publishes CombatEvent "heal", T22). */
  onHeal: ((f: Fighter, applied100: number, moveId: string, tick: number) => void) | null = null;

  /**
   * The only way HP is restored (T22). Heals a living fighter, clamps at full HP and reports the HP actually restored.
   * A dead fighter, a non positive amount or a full HP fighter heals nothing and emits nothing.
   */
  heal(f: Fighter, amount100: number, moveId: string, tick: number): number {
    if (!isAlive(f) || amount100 <= 0) return 0;
    const applied = Math.min(COMBAT.hp100Max, f.hp100 + amount100) - f.hp100;
    if (applied <= 0) return 0;
    f.hp100 += applied;
    this.onHeal?.(f, applied, moveId, tick);
    return applied;
  }

  add(entityId: number, lifeId: number, tick: number, kitId: KitId): Fighter {
    this.remove(entityId, tick);
    const f = createFighter(entityId, lifeId, tick, kitId);
    this.fighters.set(entityId, f);
    return f;
  }

  /** Departure: release every capture involving the entity before forgetting it. */
  remove(entityId: number, tick: number): void {
    if (!this.fighters.has(entityId)) return;
    const rel = this.captures.releaseEntity(entityId);
    this.fighters.delete(entityId);
    this.applyReleases(rel, tick);
    this.ledger.prune((a) => this.fighters.has(a));
  }

  get(entityId: number): Fighter | undefined { return this.fighters.get(entityId); }
  get size(): number { return this.fighters.size; }
  /** Fighters in stable entity order (deterministic query order). */
  all(): Fighter[] { return this.ids().map((id) => this.fighters.get(id)!); }

  /** HP zero or void rule. Cancels casts and captures; one KO per life. */
  kill(entityId: number, tick: number): boolean {
    const f = this.fighters.get(entityId);
    if (!f || !kill(f, tick)) return false;
    this.applyReleases(this.captures.releaseEntity(entityId), tick);
    return true;
  }

  respawn(entityId: number, tick: number, lifeId: number): void {
    const f = this.fighters.get(entityId);
    if (!f) return;
    this.applyReleases(this.captures.releaseEntity(entityId), tick);
    respawn(f, tick, lifeId);
  }

  /** Expiry phase of a tick: capture deadlines, stale captures, then action timers. */
  expire(tick: number, groundedOf: (id: number) => boolean): void {
    this.applyReleases(this.captures.expire(tick), tick);
    this.releaseStale(tick);
    for (const id of this.ids()) expire(this.fighters.get(id)!, tick, groundedOf(id));
    this.pruneLedger();
  }

  requestDash(entityId: number, tick: number, facingYaw: number, moveX: number, moveZ: number): Accept {
    const f = this.fighters.get(entityId);
    if (!f) return { ok: false, reason: "STATE" };
    const r = requestDash(f, tick, facingYaw, moveX, moveZ);
    if (r.ok) this.releaseStale(tick);
    return r;
  }

  updateGuard(entityId: number, tick: number, blockHeld: boolean, grounded: boolean): void {
    const f = this.fighters.get(entityId);
    if (f) updateGuard(f, tick, blockHeld, grounded);
  }

  resolve(tick: number, candidates: readonly HitCandidate[], poseOf: (id: number) => Pose | undefined,
    occupantOf?: (id: number) => number | undefined): HitResult[] {
    const out = resolveHits(tick, candidates, {
      fighter: (id) => this.fighters.get(id), pose: poseOf, ...(occupantOf ? { occupantOf } : {}), captures: this.captures, ledger: this.ledger,
      onLethal: (id, t) => { this.kill(id, t); },
    });
    this.releaseStale(tick); // captors interrupted this tick lose their victim immediately
    return out;
  }

  /** Releases a capture on the handler's final hit (default capture lifetime). */
  releaseFinal(victimId: number, tick: number): Release | null {
    return this.release(victimId, tick, "final");
  }

  /** Releases a capture for any cause and runs the shared release side effects. */
  release(victimId: number, tick: number, cause: ReleaseCause): Release | null {
    const r = this.captures.release(victimId, cause);
    if (r) this.applyReleases([r], tick);
    return r;
  }

  /** Invariant check: returns human-readable violations (empty when consistent). */
  invariantViolations(): string[] {
    const v: string[] = [];
    for (const c of this.captures.all()) {
      const victim = this.fighters.get(c.victimId), captor = this.fighters.get(c.captorId);
      if (!victim || !captor) v.push(`orphan capture ${c.captorId}->${c.victimId}: missing fighter`);
      else {
        if (!isAlive(victim) || !isAlive(captor)) v.push(`capture ${c.captorId}->${c.victimId} involves dead fighter`);
        if (victim.action !== "Captured") v.push(`capture ${c.captorId}->${c.victimId}: victim not Captured`);
        if (captor.generation !== c.captorGeneration) v.push(`capture ${c.captorId}->${c.victimId}: stale captor cast`);
      }
    }
    for (const f of this.fighters.values()) {
      if (f.action === "Captured" && !this.captures.isCaptured(f.entityId)) v.push(`fighter ${f.entityId} Captured without captor`);
      if (f.hp100 < 0 || f.hp100 > 10000 || !Number.isInteger(f.hp100)) v.push(`fighter ${f.entityId} hp ${f.hp100}`);
      if (f.koCount > 1) v.push(`fighter ${f.entityId} has ${f.koCount} KOs this life`);
    }
    return v;
  }

  dispose(): void {
    this.captures.clear();
    this.ledger.clear();
    this.fighters.clear();
  }

  private ids(): number[] { return [...this.fighters.keys()].sort((a, b) => a - b); }

  private releaseStale(tick: number): void {
    this.applyReleases(this.captures.releaseStale((id) => this.fighters.get(id)?.generation), tick);
  }

  private pruneLedger(): void {
    this.ledger.prune((a, c) => {
      const f = this.fighters.get(a);
      return !!f && isAlive(f) && f.castCounter === c && (f.cast !== null || f.dash !== null);
    });
  }

  private applyReleases(rel: Release[], tick: number): void {
    for (const { capture: c, cause } of rel) {
      const victim = this.fighters.get(c.victimId);
      if (victim) leaveCaptured(victim, tick);
      const captor = this.fighters.get(c.captorId);
      this.onRelease?.({ capture: c, cause }, tick);
      // A victim death or departure releases its captor immediately into 18 ticks recovery (spec 12).
      if (cause === "victimGone" && captor && isAlive(captor) && captor.generation === c.captorGeneration) {
        enterRecovery(captor, tick, CAPTOR_RELEASE_RECOVERY);
      }
    }
  }
}
