import { isM1Move } from "./M1.js";

/** GR15a: server-confirmed practice drills. Pure state machine; the room feeds it resolved hit summaries only. */
export type DrillState = "idle" | "running" | "success";
export type DrillId = "hit";

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

  /** Success only for one confirmed M1 hit with damage on the dummy by the player. Completes once. */
  observe(tick: number, hits: readonly ResolvedHitSummary[], playerId: number, dummyId: number): boolean {
    if (this.state !== "running" || this.drillId !== "hit") return false;
    const ok = hits.some((h) => h.outcome === "hit" && h.damage100 > 0 && h.attackerId === playerId
      && h.targetId === dummyId && isM1Move(h.moveId));
    if (!ok) return false;
    this.state = "success"; this.successTick = tick;
    return true;
  }
}
