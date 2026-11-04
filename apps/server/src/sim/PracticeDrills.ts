import { isM1Move } from "./M1.js";

/** GR15a: server-confirmed practice drills. Pure state machine; the room feeds it resolved hit summaries only. */
export type DrillState = "idle" | "running" | "success";
export type DrillId = "hit" | "block";
/** GR15b: the lesson dummy throws one ordinary first M1 every period, after a preparation delay. Integer ticks. */
export const BLOCK_DRILL = { prepTicks: 120, periodTicks: 180 } as const;

/** Immutable summary of one resolved hit candidate (no client claim, no mutable pipeline object). */
export interface ResolvedHitSummary {
  readonly attackerId: number;
  readonly targetId: number;
  readonly moveId: string;
  readonly outcome: string;
  readonly damage100: number;
}

export class DrillTracker {
  drillId: DrillId | "" = "";
  state: DrillState = "idle";
  startTick = 0;
  successTick = 0;

  /** Idle only; a duplicate start while a lesson exists changes nothing. */
  start(drill: DrillId, tick: number): boolean {
    if (this.state !== "idle") return false;
    this.drillId = drill; this.state = "running"; this.startTick = tick; this.successTick = 0;
    return true;
  }

  /** Running or success only: restarts the same lesson. */
  retry(tick: number): boolean {
    if (this.state === "idle" || this.drillId === "") return false;
    this.state = "running"; this.startTick = tick; this.successTick = 0;
    return true;
  }

  exit(): boolean {
    if (this.state === "idle") return false;
    this.drillId = ""; this.state = "idle"; this.startTick = 0; this.successTick = 0;
    return true;
  }

  /** GR15b: true on a tick when the lesson dummy must press attack for exactly one tick. Never fires outside a running block lesson. */
  attackDue(tick: number): boolean {
    if (this.state !== "running" || this.drillId !== "block") return false;
    const t = tick - this.startTick - BLOCK_DRILL.prepTicks;
    return t >= 0 && t % BLOCK_DRILL.periodTicks === 0;
  }

  /**
   * hit: one confirmed M1 hit with damage on the dummy by the player.
   * block (GR15b): one server `blocked` M1 result with the player as target and the dummy as actor.
   * Counters, captures, misses, unguarded hits and bot results never count. Completes once.
   */
  observe(tick: number, hits: readonly ResolvedHitSummary[], playerId: number, dummyId: number): boolean {
    if (this.state !== "running") return false;
    let ok = false;
    if (this.drillId === "hit") {
      ok = hits.some((h) => h.outcome === "hit" && h.damage100 > 0 && h.attackerId === playerId
        && h.targetId === dummyId && isM1Move(h.moveId));
    } else if (this.drillId === "block") {
      ok = hits.some((h) => h.outcome === "blocked" && h.attackerId === dummyId
        && h.targetId === playerId && isM1Move(h.moveId));
    }
    if (!ok) return false;
    this.state = "success"; this.successTick = tick;
    return true;
  }
}
