/** Token bucket on a caller supplied clock (ms). */
export class TokenBucket {
  private tokens: number;
  private last: number;
  constructor(private readonly perSecond: number, private readonly burst: number, nowMs: number) {
    this.tokens = burst;
    this.last = nowMs;
  }
  take(nowMs: number, n = 1): boolean {
    this.tokens = Math.min(this.burst, this.tokens + ((nowMs - this.last) / 1000) * this.perSecond);
    this.last = nowMs;
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
}
