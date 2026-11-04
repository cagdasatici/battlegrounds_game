import type { BotDecision, BotObservation, Difficulty } from "@eb/shared/sparring";

/** GR14 role table. Distances are horizontal metres, inclusive; these are bot selection bands, not hitbox edits. */
export type TacticStage = "counter" | "ranged" | "close";
type Extra = "counter" | "visible" | "route" | "grounded" | "charge" | "none";
export interface Role { stage: TacticStage; min: number; max: number; extra: Extra }

const CLOSE: Role = { stage: "close", min: 0, max: 2, extra: "none" };
const counter: Role = { stage: "counter", min: 0, max: 3, extra: "counter" };
const ranged = (min: number, max: number, extra: Extra): Role => ({ stage: "ranged", min, max, extra });

export const ROLE_TABLE: Readonly<Record<string, Role>> = {
  "sv.b1": CLOSE, "sv.b2": CLOSE, "sv.b3": CLOSE, "sv.b4": CLOSE, "sv.a4": CLOSE,
  "td.b1": CLOSE, "td.b2": CLOSE, "td.b3": CLOSE, "td.a1": CLOSE, "td.a2": CLOSE, "td.a3": CLOSE, "ea.b1": CLOSE,
  "td.b4": counter, "sv.a1": counter,
  "sv.a2": ranged(4, 16, "visible"), "sv.a3": ranged(6, 24, "visible"),
  "td.a4": ranged(2, 8, "route"),
  "ea.b2": ranged(3, 7, "route"), "ea.a1": ranged(3, 7, "route"),
  "ea.b4": ranged(3, 6, "grounded"),
  "ea.b3": ranged(5, 16, "charge"),
  "ea.a2": ranged(4, 12, "route"),
  "ea.a3": ranged(6, 20, "visible"), "ea.a4": ranged(8, 28, "visible"),
};

/** Ember Orb release delay (ticks held) by tier, and the hard ceiling on any bot charge. */
export const CHARGE_RELEASE: Record<Difficulty, number> = { easy: 0, medium: 60, hard: 180 };
export const CHARGE_CAP = 186;
export const CHARGE_LOS_LOSS = 30;
const FACING_COS = Math.cos(Math.PI / 3);

type Enemy = BotObservation["enemies"][number];

/** Is enemy `e` (the one nearest the bot) in the 60 degree facing cone of a bot at `self`? Pure helper for the room. */
export function facesWithin60(enemyYaw: number, enemy: { x: number; z: number }, self: { x: number; z: number }): boolean {
  const dx = self.x - enemy.x, dz = self.z - enemy.z, len = Math.hypot(dx, dz);
  if (len < 1e-9) return true;
  // Movement convention: yaw zero faces -Z.
  return (-Math.sin(enemyYaw) * dx - Math.cos(enemyYaw) * dz) / len >= FACING_COS;
}

/** True when `moveId` may be selected against `target` at horizontal distance `d` (static LOS always required). */
export function roleEligible(moveId: string, d: number, target: Enemy, tactics: NonNullable<BotObservation["tactics"]>): boolean {
  const role = ROLE_TABLE[moveId];
  if (!role || d < role.min || d > role.max) return false;
  if (target.los !== true) return false;
  switch (role.extra) {
    case "counter": return target.attacking && target.facingSelf === true;
    case "route": return tactics.routeSafe(target.id);
    case "grounded": return tactics.grounded && tactics.supported(target.id);
    default: return true;
  }
}

/**
 * First qualifying slot scanning cyclically from 1 + k % 4, restricted to one stage. Medium uses base moves only
 * (".b" IDs); hard uses base and awakened moves.
 */
export function pickMove(stage: TacticStage, difficulty: Difficulty, k: number, d: number, target: Enemy,
  tactics: NonNullable<BotObservation["tactics"]>): 1 | 2 | 3 | 4 | 0 {
  for (let i = 0; i < 4; i++) {
    const slot = ((k + i) % 4) + 1;
    const id = tactics.readyMoves[slot - 1]!;
    if (!id || ROLE_TABLE[id]?.stage !== stage) continue;
    if (difficulty !== "hard" && !id.includes(".b")) continue;
    if (roleEligible(id, d, target, tactics)) return slot as 1 | 2 | 3 | 4;
  }
  return 0;
}

/** Preferred approach distance (spec GR14). */
export function preferredDistance(kit: string, tactics: NonNullable<BotObservation["tactics"]>): number {
  const ready = new Set(tactics.readyMoves);
  if (kit !== "ea") return 2;
  if (tactics.form === "Base") return ready.has("ea.b3") ? 8 : 2;
  return ready.has("ea.a3") || ready.has("ea.a4") ? 10 : 2;
}

/**
 * Retained Ember Orb charge: runs every tick while the previous decision holds slot 3. Releases at the tier's delay
 * (never later than the charge cap); clears the hold when the target becomes invalid, line of sight is lost for 30
 * ticks or the cast is gone (interrupted, died, kit or form change). Returns the decision, or null once the hold ended
 * without needing a release so the normal policy can resume.
 */
export function stepCharge(difficulty: Difficulty, o: BotObservation, previous: BotDecision, eligible: readonly Enemy[]): BotDecision | null {
  const t = o.tactics;
  if (!t || previous.holdSlot === 0) return null;
  const clear: BotDecision = { ...previous, castSlot: 0, dash: false, awaken: false, holdSlot: 0, releaseSlot: 0, losLost: 0 };
  if (t.chargeSlot !== previous.holdSlot) return null; // no cast to release: partial state simply dropped
  const target = eligible.find(e => e.id === previous.targetId);
  const heldFor = o.tick - t.chargeStartTick;
  const losLost = target && target.los === true ? 0 : previous.losLost + 1;
  const release = !target || losLost >= CHARGE_LOS_LOSS
    || heldFor >= Math.min(CHARGE_RELEASE[difficulty], CHARGE_CAP);
  if (release) return { ...clear, targetId: target ? target.id : null, releaseSlot: previous.holdSlot, approach: false, retreat: false, attackHeld: false };
  const dx = target.x - o.self.x, dz = target.z - o.self.z;
  return { ...previous, castSlot: 0, dash: false, awaken: false, releaseSlot: 0, losLost,
    approach: false, retreat: false, attackHeld: false, blockHeld: false,
    yaw: dx === 0 && dz === 0 ? previous.yaw : Math.atan2(-dx, -dz) };
}
