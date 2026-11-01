import { TICK_RATE } from "@eb/shared/protocol";

export const STEP_MS = 1000 / TICK_RATE;
export const MAX_CATCHUP_STEPS = 5;
export const MAX_ELAPSED_MS = 250;

/** Fixed 60 Hz accumulator (spec section 21). Callers cannot supply their own dt. */
export class FixedClock {
  tick = 0;
  overloads = 0;
  private acc = 0;
  private overloadTimes: number[] = [];

  /** Advances by elapsed wall time; invokes `step(tick)` once per logical tick; returns steps run. */
  advance(elapsedMs: number, step: (tick: number) => void, wallNowMs = 0): number {
    this.acc += Math.min(Math.max(0, elapsedMs), MAX_ELAPSED_MS);
    let steps = 0;
    while (this.acc >= STEP_MS && steps < MAX_CATCHUP_STEPS) {
      this.tick += 1;
      step(this.tick);
      this.acc -= STEP_MS;
      steps += 1;
    }
    if (this.acc >= STEP_MS) {
      this.overloads += 1;
      this.overloadTimes.push(wallNowMs);
      this.acc = Math.min(this.acc, STEP_MS);
    }
    return steps;
  }

  /** True when more than 3 overloads were seen within the last 10 s (alert + stop accepting players). */
  isOverloaded(wallNowMs: number): boolean {
    this.overloadTimes = this.overloadTimes.filter((t) => wallNowMs - t <= 10_000);
    return this.overloadTimes.length > 3;
  }
}
