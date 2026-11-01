/**
 * Adaptive quality controller (T30, spec section 24, decision 0031). Pure and clock free: time is the sum of the frame
 * intervals it is fed, so tests replay exact traces. It only picks a render tier; simulation rate and hit detection are
 * never touched. The player's quality setting is the ceiling; the floor is "low".
 */
import type { Quality } from "../scene/GameScene.js";

export const WINDOW_FRAMES = 120;
export const DROP_P90_MS = 28;
export const RAISE_P90_MS = 18;
export const DROP_WINDOWS = 2;
export const RAISE_HOLD_MS = 30_000;
export const MIN_CHANGE_GAP_MS = 15_000;
/** A frame interval this long means the tab was hidden or the device stalled; the window restarts instead of counting it. */
export const STALL_MS = 1000;

const ORDER: readonly Quality[] = ["low", "medium", "high"];

export function percentile90(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.ceil(0.9 * s.length) - 1] as number;
}

export class AdaptiveQuality {
  private cap: Quality;
  private cur: Quality;
  private frames: number[] = [];
  private badWindows = 0;
  private goodMs = 0;
  private sinceChangeMs = MIN_CHANGE_GAP_MS; // first change is allowed immediately

  constructor(ceiling: Quality) { this.cap = ceiling; this.cur = ceiling; }

  get level(): Quality { return this.cur; }
  get ceiling(): Quality { return this.cap; }

  /** The player picked a setting (or the renderer is software only): it becomes both ceiling and current tier. */
  setCeiling(q: Quality): void {
    this.cap = q;
    this.cur = q;
    this.restart(true);
  }

  /** Feeds one frame interval in ms. Returns the new tier when it changed, otherwise null. */
  push(frameMs: number): Quality | null {
    if (!(frameMs >= 0)) return null;
    if (frameMs >= STALL_MS) { this.restart(false); return null; }
    this.sinceChangeMs += frameMs;
    this.frames.push(frameMs);
    if (this.frames.length < WINDOW_FRAMES) return null;
    const p90 = percentile90(this.frames);
    const windowMs = this.frames.reduce((a, b) => a + b, 0);
    this.frames = [];
    this.badWindows = p90 > DROP_P90_MS ? this.badWindows + 1 : 0;
    this.goodMs = p90 < RAISE_P90_MS ? this.goodMs + windowMs : 0;
    if (this.sinceChangeMs < MIN_CHANGE_GAP_MS) return null;
    const i = ORDER.indexOf(this.cur);
    if (this.badWindows >= DROP_WINDOWS && i > 0) return this.change(ORDER[i - 1] as Quality);
    if (this.goodMs >= RAISE_HOLD_MS && i < ORDER.indexOf(this.cap)) return this.change(ORDER[i + 1] as Quality);
    return null;
  }

  private change(q: Quality): Quality {
    this.cur = q;
    this.restart(false);
    return q;
  }

  private restart(allowImmediate: boolean): void {
    this.frames = [];
    this.badWindows = 0;
    this.goodMs = 0;
    this.sinceChangeMs = allowImmediate ? MIN_CHANGE_GAP_MS : 0;
  }
}
