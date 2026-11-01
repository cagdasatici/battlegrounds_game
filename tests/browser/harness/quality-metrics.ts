// Q01: pure frame-statistics and run-record helpers for the quality captures. No DOM, no Playwright; unit tested.

export type ExcludeReason = "setup" | "hidden" | "teardown";
export interface FrameSample { dtMs: number; excluded?: ExcludeReason }
export interface EventCounts { overlapAwakening: number; hit: number; block: number; dash: number; reflection: number; ko: number }
export interface FrameStats {
  sampleCount: number; durationSeconds: number; medianFps: number | null; frameP95Ms: number | null;
  maxConsecutiveBelow30Seconds: number | null; omittedSeconds: Record<ExcludeReason, number>; unavailable: string[];
}
export interface RunRecord extends Omit<FrameStats, "omittedSeconds" | "unavailable"> {
  buildSha: string; workload: string; device: string; os: string; browser: string; renderer: string; tier: string;
  viewport: [number, number]; maxDrawCalls: number | null; maxVisibleTriangles: number | null;
  heapSteadyMB: number | null; heapGrowth10JoinsMB: number | null; events: EventCounts; evidence: string[]; unavailable: string[];
}

export const BELOW_30_FPS_MS = 1000 / 30;

/** Nearest-rank percentile (p in (0,100]) of an unsorted list; null when empty. */
export function nearestRank(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1]!;
}

/** Frame statistics from raw intervals; only explicitly excluded intervals are dropped, and their duration is reported. */
export function frameStats(samples: readonly FrameSample[]): FrameStats {
  const omittedSeconds: Record<ExcludeReason, number> = { setup: 0, hidden: 0, teardown: 0 };
  const dts: number[] = [];
  let run = 0, worst = 0;
  for (const s of samples) {
    if (s.excluded) { omittedSeconds[s.excluded] += s.dtMs / 1000; continue; }
    dts.push(s.dtMs);
    if (s.dtMs > BELOW_30_FPS_MS) { run += s.dtMs; worst = Math.max(worst, run); } else run = 0;
  }
  if (dts.length === 0) {
    return { sampleCount: 0, durationSeconds: 0, medianFps: null, frameP95Ms: null, maxConsecutiveBelow30Seconds: null, omittedSeconds, unavailable: ["no included frame intervals"] };
  }
  const medianDt = nearestRank(dts, 50)!;
  return {
    sampleCount: dts.length, durationSeconds: dts.reduce((a, b) => a + b, 0) / 1000,
    medianFps: 1000 / medianDt, frameP95Ms: nearestRank(dts, 95), maxConsecutiveBelow30Seconds: worst / 1000,
    omittedSeconds, unavailable: [],
  };
}

export const emptyEvents = (): EventCounts => ({ overlapAwakening: 0, hit: 0, block: 0, dash: 0, reflection: 0, ko: 0 });

/** A workload is valid only when every one of the six events was observed. Returns the missing names. */
export function missingEvents(e: EventCounts): string[] {
  return (Object.keys(e) as (keyof EventCounts)[]).filter((k) => e[k] < 1);
}

export function runRecord(meta: Pick<RunRecord, "buildSha" | "workload" | "device" | "os" | "browser" | "renderer" | "tier" | "viewport" | "evidence">,
  stats: FrameStats, extra: { maxDrawCalls: number | null; maxVisibleTriangles: number | null; events: EventCounts; unavailable?: string[] }): RunRecord {
  const { omittedSeconds: _omitted, unavailable: statUnavailable, ...rest } = stats;
  const unavailable = [...statUnavailable, ...(extra.unavailable ?? [])];
  if (extra.maxDrawCalls === null) unavailable.push("maxDrawCalls: no renderer.info sample");
  unavailable.push("heapSteadyMB: not measured by Q01", "heapGrowth10JoinsMB: not measured by Q01");
  return { ...meta, ...rest, maxDrawCalls: extra.maxDrawCalls, maxVisibleTriangles: extra.maxVisibleTriangles, heapSteadyMB: null, heapGrowth10JoinsMB: null, events: extra.events, unavailable };
}
