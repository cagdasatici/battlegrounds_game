/**
 * GR05: one gameplay input gate. Any active reason suppresses gameplay intent while UI navigation and
 * Escape stay usable. Subscribers hear only the open -> closed transition, so entering the gated state
 * releases holds once; leaving it never restores a hold (a fresh press is required).
 */
export type GateReason =
  | "menu" | "settings" | "moves" | "fighter" | "sparring" | "orientation" | "connection" | "graphics" | "round";

export class InputGate {
  private readonly reasons = new Set<GateReason>();
  private readonly subs = new Set<() => void>();

  get closed(): boolean { return this.reasons.size > 0; }
  has(reason: GateReason): boolean { return this.reasons.has(reason); }
  get active(): readonly GateReason[] { return [...this.reasons]; }

  set(reason: GateReason, on: boolean): void {
    if (on === this.reasons.has(reason)) return;
    const wasClosed = this.closed;
    if (on) this.reasons.add(reason); else this.reasons.delete(reason);
    if (!wasClosed && this.closed) for (const f of [...this.subs]) f();
  }

  /** Called whenever the gate goes from open to closed. Returns the unsubscribe function. */
  onClose(fn: () => void): () => void {
    this.subs.add(fn);
    return () => { this.subs.delete(fn); };
  }

  dispose(): void { this.subs.clear(); this.reasons.clear(); }
}
