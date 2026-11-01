import { TUTORIAL_STEPS, type TutorialStep } from "@eb/shared/protocol";

/** What the practice room reads from the simulation each tick. Never anything the client claims. */
export interface TutorialSample {
  x: number; z: number; facingYaw: number;
  action: string; moveId: string; form: string;
  /** Slot (1..4) of the base move being cast, or null. */
  slotOfMove: 1 | 2 | 3 | 4 | null;
}
export interface TutorialEvent { completed: TutorialStep; next: TutorialStep | null }

/** Walk 3 m, turn 90 degrees, two M1 starts, 30 ticks of guard (half a second at 60 Hz). */
const MOVE_M = 3;
const TURN_RAD = Math.PI / 2;
const GUARD_TICKS = 30;

/**
 * Practice tutorial progress (spec section 6: "each completion is server confirmed"). Sequential: only the current
 * step can complete. Pure and tick driven; there are no timers.
 */
export class TutorialTracker {
  step = 0;
  skillMask = 0;
  private anchor: { x: number; z: number; yaw: number } | null = null;
  private m1Starts = 0;
  private lastMove = "";
  private guardTicks = 0;

  get done(): boolean { return this.step >= TUTORIAL_STEPS.length; }
  get current(): TutorialStep | null { return TUTORIAL_STEPS[this.step] ?? null; }

  observe(s: TutorialSample): TutorialEvent | null {
    const cur = this.current;
    if (cur === null) return null;
    this.anchor ??= { x: s.x, z: s.z, yaw: s.facingYaw };
    const m1Start = s.moveId.startsWith("m1.") && s.moveId !== this.lastMove;
    this.lastMove = s.moveId;
    this.guardTicks = s.action === "Guard" ? this.guardTicks + 1 : 0;
    let ok = false;
    switch (cur) {
      case "move": ok = Math.hypot(s.x - this.anchor.x, s.z - this.anchor.z) >= MOVE_M; break;
      case "turn": {
        let d = Math.abs(s.facingYaw - this.anchor.yaw) % (2 * Math.PI);
        if (d > Math.PI) d = 2 * Math.PI - d;
        ok = d >= TURN_RAD;
        break;
      }
      case "attack": if (m1Start) this.m1Starts++; ok = this.m1Starts >= 2; break;
      case "block": ok = this.guardTicks >= GUARD_TICKS; break;
      case "dash": ok = s.action === "Dash"; break;
      case "skills":
        if (s.slotOfMove !== null) this.skillMask |= 1 << (s.slotOfMove - 1);
        ok = this.skillMask === 0b1111;
        break;
      case "awaken": ok = s.form === "Awakened"; break;
    }
    if (!ok) return null;
    this.step++;
    this.anchor = { x: s.x, z: s.z, yaw: s.facingYaw };
    this.m1Starts = 0; this.guardTicks = 0;
    return { completed: cur, next: this.current };
  }
}
