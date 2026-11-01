/**
 * Replicated state field contract (spec section 20). This module is the shared, framework-free
 * description of what is replicated; apps/server/src/state maps it onto @colyseus/schema.
 */
export type Phase = "lobby" | "playing";
export type Action =
  | "Idle" | "Guard" | "Dash" | "Windup" | "Active" | "Recovery"
  | "Stunned" | "Ragdolled" | "Captured" | "Awakening" | "Dead";
export type Form = "Base" | "Awakened";

export const PLAYER_PUBLIC_FIELDS = [
  "entityId", "lifeId", "kitId", "displayName", "x", "y", "z", "vx", "vy", "vz", "facingYaw", "hp100",
  "action", "actionStartTick", "actionEndTick", "moveId", "form", "formEndTick", "meter100",
  "awakenedUsedMask", "contextSpent", "connected", "ready", "protectedUntilTick",
  "kills", "deaths", "assists",
] as const;

/** Owner only fields; never broadcast to other players. */
export const PLAYER_OWNER_FIELDS = [
  "ackSeq", "ackInputTick", "epoch", "pendingKit", "evasiveEndTick", "chargeStartTick",
] as const;

/** Public projectile record fields (spec section 20). */
export const PROJECTILE_FIELDS = [
  "entityId", "castId", "ownerId", "ownerLifeId", "spawnTick", "x", "y", "z", "vx", "vy", "vz",
  "chargeClass", "remainingTicks", "reflectionCount",
] as const;

/** Public urn record fields (T23, spec 10). */
export const URN_FIELDS = ["id", "state", "holderId", "returnTick", "x", "y", "z"] as const;

/** Fields that must never be replicated. */
export const FORBIDDEN_STATE_FIELDS = ["invite", "token", "ticket", "sessionId", "authId", "cookie"] as const;

/** Wire quantisation (spec section 20): centimetres and 1/1024 turn. */
export const quantizeCm = (m: number): number => Math.round(m * 100);
export const fromCm = (cm: number): number => cm / 100;
export const quantizeYaw = (rad: number): number => {
  const turns = rad / (Math.PI * 2);
  return ((Math.round(turns * 1024) % 1024) + 1024) % 1024;
};
export const fromYaw = (q: number): number => (q / 1024) * Math.PI * 2;
