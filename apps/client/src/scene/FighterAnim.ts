/**
 * Chooses which clip a fighter view plays from replicated state and observed motion. Presentation only: clip
 * choice and speed never feed back into movement, hits or timing (spec section 23: markers are visual only and the
 * clip is retimed to the server phase).
 */
import type { Action } from "@eb/shared/schema";

export interface AnimInput {
  action: string;
  moveId: string;
  kit: string;
  /** Horizontal speed in m/s derived from presented positions. */
  speed: number;
  /** Vertical speed in m/s. */
  vy: number;
  /** Velocity relative to facing: forward positive, right positive (m/s). */
  forward: number;
  right: number;
  hasClip(id: string): boolean;
}
export interface AnimChoice { clip: string; loop: boolean }

export const RUN_SPEED = 6;
export const WALK_SPEED = 0.6;
export const AIR_VY = 1.8;

export function chooseClip(i: AnimInput): AnimChoice {
  const a = i.action as Action;
  switch (a) {
    case "Dead": return { clip: "death", loop: false };
    case "Ragdolled": case "Captured": return { clip: "ragdollPose", loop: true };
    case "Stunned": return { clip: "hitLight", loop: false };
    case "Guard": return { clip: "guard", loop: true };
    case "Awakening": return { clip: `${i.kit}.activate`, loop: false };
    case "Dash": {
      const side = Math.abs(i.right) > Math.abs(i.forward);
      return { clip: side ? "dashSide" : i.forward < 0 ? "dashBack" : "dashFront", loop: false };
    }
    case "Windup": case "Active": case "Recovery": {
      // Replicated ids may carry a variant suffix (m1.4.finisher, td.b1.charged): use the longest prefix that has a clip.
      for (let id = i.moveId; id.includes("."); id = id.slice(0, id.lastIndexOf("."))) if (i.hasClip(id)) return { clip: id, loop: false };
      return { clip: "m1.1", loop: false };
    }
    default: break;
  }
  if (i.vy > AIR_VY) return { clip: "jump", loop: false };
  if (i.vy < -AIR_VY) return { clip: "fall", loop: true };
  if (i.speed > RUN_SPEED) return { clip: "run", loop: true };
  if (i.speed > WALK_SPEED) return { clip: "walk", loop: true };
  return { clip: "idle", loop: true };
}

/** Time scale that stretches or squeezes a clip so one play fits the server phase length. */
export function retimeScale(clipSeconds: number, phaseTicks: number, tickRate: number): number {
  if (!(phaseTicks > 0) || !(clipSeconds > 0)) return 1;
  return Math.min(4, Math.max(0.25, clipSeconds / (phaseTicks / tickRate)));
}
