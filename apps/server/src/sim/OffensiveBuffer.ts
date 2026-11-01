import { COMBAT } from "@eb/shared/config/combat";

/**
 * The single offensive input buffer (spec 12): one offensive edge per entity, kept for COMBAT.bufferTicks.
 * The most recent edge replaces the older one; on a same tick tie the lower action number wins
 * (skill slots 1..4 rank above M1). Shared by M1System and AbilityRunner (one instance per room).
 */
export type Buffered =
  | { kind: "m1"; tick: number }
  | { kind: "skill"; slot: 1 | 2 | 3 | 4; edgeId: number; tick: number };

/** Lower number = higher priority (spec 12): skill slot 1..4 rank 2..5, M1 rank 7. */
const rank = (b: Buffered): number => (b.kind === "skill" ? 1 + b.slot : 7);

export class OffensiveBuffer {
  private readonly byEntity = new Map<number, Buffered>();
  private rejected: { entityId: number; edgeId: number }[] = [];

  /**
   * Stores `next`. Returns the skill edge that lost (the replaced older edge, or `next` itself when it lost a
   * same tick tie), or null. Older replaced skill edges are also queued for `drainRejected`.
   */
  set(entityId: number, next: Buffered): Buffered | null {
    const cur = this.byEntity.get(entityId);
    if (cur && cur.tick === next.tick && rank(cur) <= rank(next)) return next.kind === "skill" ? next : null;
    this.byEntity.set(entityId, next);
    if (cur && cur.kind === "skill") {
      this.rejected.push({ entityId, edgeId: cur.edgeId });
      return cur;
    }
    return null;
  }

  /** Removes and returns the entry if still inside the window, else drops it and returns null. */
  take(entityId: number, tick: number, window: number = COMBAT.bufferTicks): Buffered | null {
    const b = this.byEntity.get(entityId);
    if (!b) return null;
    this.byEntity.delete(entityId);
    return tick - b.tick > window ? null : b;
  }

  peek(entityId: number): Buffered | undefined { return this.byEntity.get(entityId); }
  drop(entityId: number): void { this.byEntity.delete(entityId); }
  get size(): number { return this.byEntity.size; }

  /** Skill edges replaced by a newer edge: the room answers each with rejected / STATE. */
  drainRejected(): { entityId: number; edgeId: number }[] {
    const r = this.rejected;
    this.rejected = [];
    return r;
  }

  clear(): void { this.byEntity.clear(); this.rejected = []; }
}
