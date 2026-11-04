import type { AbilityDef } from "@eb/shared/abilities";
import { isM1Move } from "./M1.js";
import { shapeOverlaps, type AbilityPose } from "./AbilityRunner.js";
import { WAVE_SHAPE } from "../kits/sv/faultStrike.js";

/** GR15a: server-confirmed practice drills. Pure state machine; the room feeds it resolved hit summaries only. */
export type DrillState = "idle" | "running" | "success" | "failed";
export type DrillId = "hit" | "block" | "evade";
/** GR15b: the lesson dummy throws one ordinary first M1 every period, after a preparation delay. Integer ticks. */
export const BLOCK_DRILL = { prepTicks: 120, periodTicks: 180 } as const;

/** GR15c: one Stone Vanguard sv.b1 cast at preparation tick + 120. Existing ability data; nothing is overridden. */
export const EVADE_DRILL = { prepTicks: 120, moveId: "sv.b1" } as const;

/**
 * Both applicable sv.b1 footprints through the ability's own geometric helper: the direct box (any target state) and the
 * 8 m wave box (standing or airborne targets only). Same function the handler queries with; never screen pixels.
 */
export function inFaultStrikeFootprint(def: Pick<AbilityDef, "shape" | "range">, aimYaw: number, attacker: AbilityPose, target: AbilityPose, ragdolled: boolean): boolean {
  if (shapeOverlaps(def.shape, def.range, attacker, aimYaw, target)) return true;
  return !ragdolled && shapeOverlaps(WAVE_SHAPE, WAVE_SHAPE.d, attacker, aimYaw, target);
}

/** One trial of the evade lesson. A retry builds a new object, so cast identity is never reused. */
export interface EvadeTrial {
  phase: "wait" | "live" | "void" | "done";
  castCounter: number; activeStart: number; activeEnd: number;
  startedInside: boolean; outsideAtActive: boolean | null; touched: boolean;
}
const freshTrial = (): EvadeTrial => ({ phase: "wait", castCounter: 0, activeStart: 0, activeEnd: 0, startedInside: false, outsideAtActive: null, touched: false });

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
  trial: EvadeTrial | null = null;

  /** Idle only; a duplicate start while a lesson exists changes nothing. */
  start(drill: DrillId, tick: number): boolean {
    if (this.state !== "idle") return false;
    this.drillId = drill; this.state = "running"; this.startTick = tick; this.successTick = 0;
    this.trial = drill === "evade" ? freshTrial() : null;
    return true;
  }

  /** Running, success or failed only: restarts the same lesson. */
  retry(tick: number): boolean {
    if (this.state === "idle" || this.drillId === "") return false;
    this.state = "running"; this.startTick = tick; this.successTick = 0;
    this.trial = this.drillId === "evade" ? freshTrial() : null;
    return true;
  }

  exit(): boolean {
    if (this.state === "idle") return false;
    this.drillId = ""; this.state = "idle"; this.startTick = 0; this.successTick = 0; this.trial = null;
    return true;
  }

  /** GR15c: true exactly on the preparation-end tick of a waiting evade trial. */
  evadeCastDue(tick: number): boolean {
    return this.state === "running" && this.drillId === "evade" && this.trial?.phase === "wait" && tick === this.startTick + EVADE_DRILL.prepTicks;
  }

  /** Binds the dummy's cast (identity + windows) once its windup began. `startedInside` is false for protected or out-of-footprint starts. */
  evadeBind(cast: { castCounter: number; activeStart: number; activeEnd: number }, startedInside: boolean): boolean {
    const t = this.trial;
    if (this.state !== "running" || !t || t.phase !== "wait") return false;
    t.phase = "live"; t.castCounter = cast.castCounter; t.activeStart = cast.activeStart; t.activeEnd = cast.activeEnd;
    t.startedInside = startedInside;
    return true;
  }

  /** Death, leave, kit change or a refused cast: no further result for this trial (state stays running; Retry/Exit remain). */
  evadeVoid(): void {
    if (this.trial && (this.trial.phase === "wait" || this.trial.phase === "live")) this.trial.phase = "void";
  }

  /** Any resolved result of this cast on the player inside its active window (hit, blocked, counter, capture, protected...). */
  evadeNote(tick: number, hits: readonly ResolvedHitSummary[], playerId: number, dummyId: number): void {
    const t = this.trial;
    if (!t || t.phase !== "live" || tick < t.activeStart || tick >= t.activeEnd) return;
    if (hits.some((h) => h.attackerId === dummyId && h.targetId === playerId && h.moveId === EVADE_DRILL.moveId)) t.touched = true;
  }

  /**
   * Per tick after the pipeline. `outsideNow`: player outside every applicable footprint right now. `clean`: player unprotected
   * and not invulnerable. Success only at the last active tick of the bound cast; any touch fails at once.
   */
  evadeStep(tick: number, outsideNow: boolean, clean: boolean): "success" | "failed" | null {
    const t = this.trial;
    if (this.state !== "running" || !t || t.phase !== "live" || tick < t.activeStart) return null;
    if (t.outsideAtActive === null) t.outsideAtActive = outsideNow;
    if (!clean) t.touched = true;
    const failed = t.touched || !t.startedInside || !t.outsideAtActive;
    if (failed) { t.phase = "done"; this.state = "failed"; return "failed"; }
    if (tick < t.activeEnd - 1) return null;
    t.phase = "done"; this.state = "success"; this.successTick = tick;
    return "success";
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
