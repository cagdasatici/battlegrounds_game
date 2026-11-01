import { expect, test } from "vitest";
import { emptyEvents, frameStats, missingEvents, nearestRank, runRecord } from "../browser/harness/quality-metrics.js";

test("nearest rank picks the ceil(p*n)th sorted value", () => {
  const v = Array.from({ length: 20 }, (_, i) => 20 - i); // 1..20 unsorted
  expect(nearestRank(v, 95)).toBe(19);
  expect(nearestRank(v, 50)).toBe(10);
  expect(nearestRank(v, 100)).toBe(20);
  expect(nearestRank([7], 95)).toBe(7);
});

test("a slow interval raises p95 and the below-30 run, and breaks on a fast frame", () => {
  const fast = (n: number) => Array.from({ length: n }, () => ({ dtMs: 16 }));
  const s = frameStats([...fast(90), { dtMs: 50 }, { dtMs: 60 }, ...fast(8)]);
  expect(s.sampleCount).toBe(100);
  expect(s.maxConsecutiveBelow30Seconds).toBeCloseTo(0.11, 6);
  expect(s.frameP95Ms).toBe(16);
  const t = frameStats([...fast(80), ...Array.from({ length: 20 }, () => ({ dtMs: 40 }))]);
  expect(t.frameP95Ms).toBe(40);
  expect(t.medianFps).toBeCloseTo(62.5, 6);
});

test("an empty run reports null metrics with a reason, not zero", () => {
  const s = frameStats([]);
  expect(s.medianFps).toBeNull();
  expect(s.frameP95Ms).toBeNull();
  expect(s.unavailable.length).toBe(1);
  const r = runRecord({ buildSha: "x", workload: "w", device: "d", os: "o", browser: "b", renderer: "r", tier: "low", viewport: [1024, 768], evidence: [] },
    s, { maxDrawCalls: null, maxVisibleTriangles: null, events: emptyEvents() });
  expect(r.medianFps).toBeNull();
  expect(r.unavailable.join()).toContain("maxDrawCalls");
});

test("hidden, setup and teardown samples are excluded and their duration reported", () => {
  const s = frameStats([{ dtMs: 2000, excluded: "setup" }, { dtMs: 500, excluded: "hidden" }, { dtMs: 16 }, { dtMs: 16 }, { dtMs: 300, excluded: "teardown" }]);
  expect(s.sampleCount).toBe(2);
  expect(s.omittedSeconds).toEqual({ setup: 2, hidden: 0.5, teardown: 0.3 });
  expect(s.maxConsecutiveBelow30Seconds).toBe(0);
});

test("a workload missing any of the six events is invalid", () => {
  expect(missingEvents({ overlapAwakening: 1, hit: 3, block: 1, dash: 2, reflection: 0, ko: 1 })).toEqual(["reflection"]);
  expect(missingEvents(emptyEvents()).length).toBe(6);
});
