/**
 * Local locomotion prediction (spec section 22). Uses the same pure shared integrateMovement and
 * applyCorrection as the server at fixed 60 Hz ticks. Never predicts damage, capture, KO, meter or
 * counters. Collision correction is injected (the Rapier character controller over the shared static
 * map in the game scene; simple fakes in tests). Collision always uses the corrected pose, never the
 * smoothed mesh offset.
 */
import { COMBAT } from "@eb/shared/config/combat";
import type { Action } from "@eb/shared/schema";
import {
  NEUTRAL_MOVE, applyCorrection, initialMoveState, integrateMovement, type MoveIntent, type MoveState,
} from "@eb/shared/movement";

export const PREDICTION = {
  historyTicks: 120,
  maxReplayTicks: 12,
  smallErrorM: 0.1,
  snapErrorM: 2,
  smallEaseFrames: 6,
  mediumEaseMs: 100,
} as const;

export interface P3 { x: number; y: number; z: number }

/** Moves a capsule centred at `pos` by `desired`; returns the achieved translation and contact flags. */
export type Collide = (pos: P3, desired: P3) => { corrected: P3; grounded: boolean; wallHit: boolean };

interface Entry {
  tick: number;
  intent: MoveIntent;
  /** Tick of the input sample that produced this held intent (lease anchor). */
  sampleTick: number;
  state: MoveState;
  pos: P3;
}

export interface OwnerSnapshot {
  serverTick: number;
  /**
   * Owner `ackInputTick` (R08): the client sampleTick of the last input the server accepted. When present it is the
   * replay anchor; history is keyed by client sample ticks, not by server ticks.
   */
  ackInputTick?: number;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  facingYaw: number;
  action: Action;
}

/** Actions under which locomotion prediction is suspended until a newer permitting action. */
const SUSPEND: ReadonlySet<Action> = new Set<Action>(["Stunned", "Ragdolled", "Captured", "Dead"]);

export type Correction = "none" | "small" | "medium" | "snap" | "suspended";

const cloneState = (s: MoveState): MoveState => ({ ...s });

export class Prediction {
  state: MoveState;
  /** Corrected simulation pose; the only pose used for collision. */
  pos: P3;
  suspended = false;
  private history: Entry[] = [];
  private visual: P3 = { x: 0, y: 0, z: 0 };
  private easeTotalMs = 0;
  private easeLeftMs = 0;
  private easeStart: P3 = { x: 0, y: 0, z: 0 };

  constructor(private readonly collide: Collide, pos: P3, facingYaw = 0) {
    this.pos = { ...pos };
    this.state = initialMoveState(facingYaw);
  }

  /** Server neutralizes held intent when no fresh packet arrived within the input lease (15 ticks). */
  static leased(intent: MoveIntent, sampleTick: number, tick: number): MoveIntent {
    return tick - sampleTick > COMBAT.inputLeaseTicks ? NEUTRAL_MOVE : intent;
  }

  private simulate(state: MoveState, pos: P3, intent: MoveIntent, tick: number): P3 {
    const d = integrateMovement(state, intent, tick);
    const desired = { x: d.dx, y: d.dy, z: d.dz };
    const r = this.collide(pos, desired);
    applyCorrection(state, { dx: d.dx, dy: d.dy, dz: d.dz }, r.corrected, r.grounded, r.wallHit);
    return { x: pos.x + r.corrected.x, y: pos.y + r.corrected.y, z: pos.z + r.corrected.z };
  }

  /**
   * Advances one estimated server tick with the held intent from the sample taken at `sampleTick`.
   * A jump edge is consumed only on the tick it was sampled.
   */
  step(tick: number, intent: MoveIntent, sampleTick: number): void {
    const held = { ...intent, jumpPressed: intent.jumpPressed && tick === sampleTick };
    if (!this.suspended) this.pos = this.simulate(this.state, this.pos, Prediction.leased(held, sampleTick, tick), tick);
    this.history.push({ tick, intent: held, sampleTick, state: cloneState(this.state), pos: { ...this.pos } });
    if (this.history.length > PREDICTION.historyTicks) this.history.shift();
  }

  get bufferedTicks(): number { return this.history.length; }

  clear(): void { this.history = []; this.visual = { x: 0, y: 0, z: 0 }; this.easeLeftMs = 0; }

  /**
   * Reconciles with an authoritative owner snapshot. `forceSnap` is set for capture, teleport, death or
   * respawn events. Returns the correction class applied.
   */
  reconcile(snap: OwnerSnapshot, forceSnap = false): Correction {
    const before = { ...this.pos };
    const anchor = snap.ackInputTick ?? snap.serverTick;
    const base = this.history.find((e) => e.tick === anchor);
    const s: MoveState = base ? cloneState(base.state) : cloneState(this.state);
    s.vx = snap.vx; s.vy = snap.vy; s.vz = snap.vz; s.facingYaw = snap.facingYaw;
    let pos: P3 = { x: snap.x, y: snap.y, z: snap.z };
    // Discard everything the server has already simulated.
    this.history = this.history.filter((e) => e.tick > anchor);

    if (SUSPEND.has(snap.action) || forceSnap) {
      this.suspended = SUSPEND.has(snap.action);
      this.state = s; this.pos = pos; this.clear();
      return this.suspended ? "suspended" : "snap";
    }
    this.suspended = false;

    const replay = this.history.slice(0, PREDICTION.maxReplayTicks);
    this.history = [];
    for (const e of replay) {
      pos = this.simulate(s, pos, Prediction.leased(e.intent, e.sampleTick, e.tick), e.tick);
      this.history.push({ ...e, state: cloneState(s), pos: { ...pos } });
    }
    this.state = s;
    this.pos = pos;

    const err = Math.hypot(before.x - pos.x, before.y - pos.y, before.z - pos.z);
    if (err > PREDICTION.snapErrorM) { this.clear(); return "snap"; }
    if (err < 1e-6) return "none";
    // Keep the mesh where it was and ease it toward the corrected pose.
    const cur = this.visualOffset();
    this.easeStart = { x: before.x - pos.x + cur.x, y: before.y - pos.y + cur.y, z: before.z - pos.z + cur.z };
    this.visual = { ...this.easeStart };
    this.easeTotalMs = err <= PREDICTION.smallErrorM ? (PREDICTION.smallEaseFrames * 1000) / 60 : PREDICTION.mediumEaseMs;
    this.easeLeftMs = this.easeTotalMs;
    return err <= PREDICTION.smallErrorM ? "small" : "medium";
  }

  /** Render frame: decays the visual offset. Returns the mesh position (presentation only). */
  meshPosition(dtMs: number): P3 {
    if (this.easeLeftMs > 0) {
      this.easeLeftMs = Math.max(0, this.easeLeftMs - (Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0));
      const k = this.easeLeftMs / this.easeTotalMs;
      this.visual = { x: this.easeStart.x * k, y: this.easeStart.y * k, z: this.easeStart.z * k };
    } else this.visual = { x: 0, y: 0, z: 0 };
    return { x: this.pos.x + this.visual.x, y: this.pos.y + this.visual.y, z: this.pos.z + this.visual.z };
  }

  visualOffset(): P3 { return { ...this.visual }; }
}
