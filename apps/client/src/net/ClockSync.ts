/**
 * Server clock estimate (spec section 22): ping midpoint, median of the last 8 offsets, corrections
 * clamped to 5 ms per frame unless reconnecting. Wall time only; never schedules gameplay.
 */
import { TICK_RATE, type PongMessage } from "@eb/shared/protocol";

export const CLOCK = { samples: 8, maxCorrectionMsPerFrame: 5 } as const;

export class ClockSync {
  private offsets: number[] = [];
  private pending = new Map<number, number>();
  private nonce = 0;
  /** Applied offset: serverMs ~= localMs + offsetMs. */
  offsetMs = 0;
  private anchor: { serverMs: number; serverTick: number } | null = null;
  private snapNext = true;

  /** Returns the ping payload to send; caller sends it on the ping channel. */
  makePing(localMs: number): { nonce: number; clientMs: number } {
    this.nonce = (this.nonce + 1) >>> 0;
    this.pending.set(this.nonce, localMs);
    if (this.pending.size > 16) this.pending.delete(this.pending.keys().next().value as number);
    return { nonce: this.nonce, clientMs: localMs };
  }

  /** Records a pong. Unknown or duplicate nonces are ignored. */
  onPong(p: PongMessage, localMs: number): boolean {
    const sent = this.pending.get(p.nonce);
    if (sent === undefined || !Number.isFinite(p.serverMs) || localMs < sent) return false;
    this.pending.delete(p.nonce);
    const mid = (sent + localMs) / 2;
    this.offsets.push(p.serverMs - mid);
    if (this.offsets.length > CLOCK.samples) this.offsets.shift();
    this.anchor = { serverMs: p.serverMs, serverTick: p.serverTick }; // server stamp is taken at the RTT midpoint
    return true;
  }

  get targetOffsetMs(): number {
    if (this.offsets.length === 0) return this.offsetMs;
    const s = [...this.offsets].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
  }

  /** Call once per render frame. Moves the applied offset at most 5 ms toward the median. */
  frame(): void {
    const t = this.targetOffsetMs;
    if (this.snapNext && this.offsets.length > 0) { this.offsetMs = t; this.snapNext = false; return; }
    const d = t - this.offsetMs;
    const k = CLOCK.maxCorrectionMsPerFrame;
    this.offsetMs += Math.max(-k, Math.min(k, d));
  }

  /** Reconnect: drop samples; the next estimate is applied without clamping. */
  reset(): void {
    this.offsets = []; this.pending.clear(); this.anchor = null; this.snapNext = true;
  }

  serverMs(localMs: number): number { return localMs + this.offsetMs; }

  /** Estimated fractional server tick at local time, or null before the first pong. */
  serverTick(localMs: number): number | null {
    if (!this.anchor) return null;
    return this.anchor.serverTick + ((this.serverMs(localMs) - this.anchor.serverMs) * TICK_RATE) / 1000;
  }
}
