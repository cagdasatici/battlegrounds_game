import type { CombatEvent } from "@eb/shared/protocol";

export type CombatListener = (e: CombatEvent) => void;
/** Subscribe function shaped like Room.onMessage: returns an unsubscribe. */
export type CombatSource = (handler: (e: CombatEvent) => void) => () => void;

const RING = 512;

/**
 * Single subscription point for server combat events. Deduplicates by eventId (ring of the last 512),
 * drops events whose lifeId is older than the subject's current life, then fans out to listeners.
 * Presentation only: nothing here feeds the simulation.
 */
export class CombatBus {
  private readonly seen = new Set<string>();
  private readonly ring: string[] = [];
  private readonly listeners = new Set<CombatListener>();
  private unsub: (() => void) | null;

  /** lifeOf(entityId) returns the entity's current life id, or undefined if unknown. */
  constructor(source: CombatSource, private readonly lifeOf: (entityId: string) => number | undefined) {
    this.unsub = source((e) => { this.dispatch(e); });
  }

  on(l: CombatListener): () => void {
    this.listeners.add(l);
    return () => { this.listeners.delete(l); };
  }

  dispose(): void {
    this.unsub?.();
    this.unsub = null;
    this.listeners.clear();
    this.seen.clear();
    this.ring.length = 0;
  }

  private dispatch(e: CombatEvent): void {
    if (this.unsub === null || this.seen.has(e.eventId)) return;
    this.seen.add(e.eventId);
    this.ring.push(e.eventId);
    if (this.ring.length > RING) this.seen.delete(this.ring.shift()!);
    const cur = this.lifeOf(e.targetId ?? e.actorId);
    if (cur !== undefined && e.lifeId < cur) return;
    for (const l of [...this.listeners]) l(e);
  }
}
