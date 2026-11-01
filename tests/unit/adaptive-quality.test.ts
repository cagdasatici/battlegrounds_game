import { describe, expect, it } from "vitest";
import { AdaptiveQuality, MIN_CHANGE_GAP_MS, STALL_MS, WINDOW_FRAMES, percentile90 } from "../../apps/client/src/app/AdaptiveQuality.js";
import type { Quality } from "../../apps/client/src/scene/GameScene.js";

/** Feeds `ms` frames until `totalMs` has elapsed; returns every tier change in order. */
function run(a: AdaptiveQuality, ms: number, totalMs: number): Quality[] {
  const out: Quality[] = [];
  for (let t = 0; t < totalMs; t += ms) { const c = a.push(ms); if (c) out.push(c); }
  return out;
}

describe("T30 AdaptiveQuality", () => {
  it("percentile90 picks the 90th percentile sample", () => {
    expect(percentile90(Array.from({ length: 10 }, (_, i) => i + 1))).toBe(9);
    expect(percentile90([])).toBe(0);
  });

  it("drops one level only after two consecutive slow windows", () => {
    const a = new AdaptiveQuality("high");
    for (let i = 0; i < WINDOW_FRAMES; i++) expect(a.push(40)).toBeNull(); // first window: no change yet
    for (let i = 0; i < WINDOW_FRAMES - 1; i++) a.push(40);
    expect(a.push(40)).toBe("medium");
  });

  it("a good window between slow ones resets the count", () => {
    const a = new AdaptiveQuality("high");
    run(a, 40, WINDOW_FRAMES * 40);
    run(a, 10, WINDOW_FRAMES * 10);
    expect(run(a, 40, WINDOW_FRAMES * 40)).toEqual([]);
    expect(a.level).toBe("high");
  });

  it("enforces 15 s between changes and never goes below low", () => {
    const a = new AdaptiveQuality("high");
    const changes = run(a, 40, 120_000);
    expect(changes).toEqual(["medium", "low"]);
    expect(a.level).toBe("low");
    // 120 frames * 40 ms = 4.8 s per window: the second drop cannot land before 15 s after the first.
    const b = new AdaptiveQuality("high");
    let t = 0, first = -1, second = -1;
    for (; t < 60_000; t += 40) { const c = b.push(40); if (c === "medium") first = t; if (c === "low") { second = t; break; } }
    expect(second - first).toBeGreaterThanOrEqual(MIN_CHANGE_GAP_MS);
  });

  it("raises one level after 30 s under 18 ms, never above the ceiling", () => {
    const a = new AdaptiveQuality("high");
    run(a, 40, 20_000); // down to medium or low
    const low = a.level;
    expect(low).not.toBe("high");
    const ups = run(a, 10, 200_000);
    expect(ups).toEqual(low === "low" ? ["medium", "high"] : ["high"]);
    expect(run(a, 10, 100_000)).toEqual([]);
    const c = new AdaptiveQuality("medium");
    expect(run(c, 10, 100_000)).toEqual([]);
  });

  it("frames between 18 and 28 ms hold the tier", () => {
    const a = new AdaptiveQuality("medium");
    expect(run(a, 22, 120_000)).toEqual([]);
  });

  it("a stall (hidden tab) restarts the window instead of counting as slow", () => {
    const a = new AdaptiveQuality("high");
    for (let i = 0; i < 10; i++) { run(a, 16, 100 * 16); expect(a.push(STALL_MS + 5)).toBeNull(); }
    expect(a.level).toBe("high");
  });

  it("setCeiling resets to the chosen tier, and ignores bad input", () => {
    const a = new AdaptiveQuality("high");
    run(a, 40, 20_000);
    a.setCeiling("high");
    expect(a.level).toBe("high");
    expect(a.push(Number.NaN)).toBeNull();
    expect(a.push(-5)).toBeNull();
    a.setCeiling("low");
    expect(run(a, 10, 200_000)).toEqual([]);
    expect(a.level).toBe("low");
  });
});
