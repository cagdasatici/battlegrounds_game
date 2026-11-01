/**
 * Single-owner capture bookkeeping (spec sections 12 and 13). Pure, tick driven. A victim has at most one
 * captor; a captor's capture is tied to the cast generation that created it so a cancelled cast can never
 * keep or exploit a capture. Every capture is removed by release(), by expiry, or by entity removal.
 */
export interface Capture {
  victimId: number;
  captorId: number;
  captorGeneration: number;
  castCounter: number;
  moveId: string;
  cinematic: boolean;
  startTick: number;
  /** Exclusive safety deadline; handlers normally release on their final hit before this. */
  endTick: number;
}

export type ReleaseCause = "final" | "expired" | "victimGone" | "captorGone" | "cancelled";
export interface Release { capture: Capture; cause: ReleaseCause }

export class CaptureRegistry {
  private readonly byVictim = new Map<number, Capture>();

  /** Reserves the victim for the first valid candidate; returns null if already captured. */
  tryCapture(c: Capture): Capture | null {
    if (c.victimId === c.captorId) return null;
    if (this.byVictim.has(c.victimId)) return null;
    // A fighter that is itself captured cannot capture, and a captor cannot be captured mid-capture here.
    if (this.byVictim.has(c.captorId)) return null;
    this.byVictim.set(c.victimId, { ...c });
    return this.byVictim.get(c.victimId)!;
  }

  victimOf(captorId: number): Capture | undefined {
    for (const c of this.byVictim.values()) if (c.captorId === captorId) return c;
    return undefined;
  }
  captureOn(victimId: number): Capture | undefined { return this.byVictim.get(victimId); }
  isCaptured(victimId: number): boolean { return this.byVictim.has(victimId); }

  /** True if `attackerId` must not damage `victimId` because of a third-party cinematic capture. */
  shieldsFrom(victimId: number, attackerId: number): boolean {
    const onVictim = this.byVictim.get(victimId);
    if (onVictim && onVictim.cinematic && onVictim.captorId !== attackerId) return true;
    const asCaptor = this.victimOf(victimId);
    return !!asCaptor && asCaptor.cinematic && asCaptor.victimId !== attackerId;
  }

  release(victimId: number, cause: ReleaseCause): Release | null {
    const c = this.byVictim.get(victimId);
    if (!c) return null;
    this.byVictim.delete(victimId);
    return { capture: c, cause };
  }

  /** Releases every capture involving the entity (death, departure). */
  releaseEntity(entityId: number): Release[] {
    const out: Release[] = [];
    for (const c of [...this.byVictim.values()]) {
      if (c.victimId === entityId) out.push(this.release(c.victimId, "victimGone")!);
      else if (c.captorId === entityId) out.push(this.release(c.victimId, "captorGone")!);
    }
    return out;
  }

  /** Releases captures whose captor cast generation is stale (cast cancelled or replaced). */
  releaseStale(generationOf: (captorId: number) => number | undefined): Release[] {
    const out: Release[] = [];
    for (const c of [...this.byVictim.values()]) {
      if (generationOf(c.captorId) !== c.captorGeneration) out.push(this.release(c.victimId, "cancelled")!);
    }
    return out;
  }

  expire(tick: number): Release[] {
    const out: Release[] = [];
    for (const c of [...this.byVictim.values()]) if (tick >= c.endTick) out.push(this.release(c.victimId, "expired")!);
    return out;
  }

  get size(): number { return this.byVictim.size; }
  all(): Capture[] { return [...this.byVictim.values()]; }
  clear(): void { this.byVictim.clear(); }
}
