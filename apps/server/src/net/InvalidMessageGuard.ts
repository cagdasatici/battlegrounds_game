/**
 * Counts invalid messages per client in a sliding window (T29, spec 24: disconnect after 10 invalid messages in 10 s).
 * Only the category is recorded, never the payload. Wall-clock ms are passed in so tests control time.
 */
export const INVALID_LIMIT = 10;
export const INVALID_WINDOW_MS = 10_000;

export class InvalidMessageGuard {
  private stamps: number[] = [];
  /** Records one invalid message; returns true when the client should be disconnected. */
  record(nowMs: number): boolean {
    const cutoff = nowMs - INVALID_WINDOW_MS;
    this.stamps = this.stamps.filter((t) => t > cutoff);
    this.stamps.push(nowMs);
    return this.stamps.length >= INVALID_LIMIT;
  }
}
