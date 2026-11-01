import type { CombatEvent } from "@eb/shared/protocol";

export type CombatListener = (e: CombatEvent) => void;
/** Subscribes a handler to the room's combatEvent messages and returns the unsubscribe function. */
export type CombatSubscribe = (handler: CombatListener) => () => void;

export const COMBAT_BUS_RING = 512;

/**
 * Presentation event bus (decision 0021). Subscribes once to the server combatEvent stream, drops duplicate eventIds
 * (ring of the last 512) and events from a previous life of their subject, then fans out to listeners.
 * Presentation only: nothing here may feed back into simulation.
 */
export class CombatBus {
  private readonly listeners = new Set<CombatListener>();
  private readonly seen = new Set<string>();
  private readonly ring: string[] = [];
  private unsubscribe: (() => void) | null;

  /** currentLife(entityId) is the replicated lifeId of that fighter, or undefined when unknown (never drops then). */
  constructor(subscribe: CombatSubscribe, private readonly currentLife: (entityId: string) => number | undefined) {
    this.unsubscribe = subscribe((e) => { this.dispatch(e); });
  }

  on(l: CombatListener): () => void {
    this.listeners.add(l);
    return () => { this.listeners.delete(l); };
  }

  dispatch(e: CombatEvent): void {
    if (this.unsubscribe === null) return;
    if (this.seen.has(e.eventId)) return;
    this.seen.add(e.eventId);
    this.ring.push(e.eventId);
    if (this.ring.length > COMBAT_BUS_RING) this.seen.delete(this.ring.shift() as string);
    const subject = e.targetId ?? e.actorId;
    const life = this.currentLife(subject);
    if (life !== undefined && e.lifeId < life) return;
    for (const l of [...this.listeners]) l(e);
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.listeners.clear();
    this.seen.clear();
    this.ring.length = 0;
  }
}
