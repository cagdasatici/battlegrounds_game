import { z } from "zod";
import { DisplayNameSchema, RoundTargetSchema, type KitId } from "./protocol.js";

/** Hosted sparring contracts (local design, docs/sparring-plan.md). */
export const SPARRING_ROOM_NAME = "sparring" as const;
export const SPARRING_GUEST_COOKIE = "eb_spar_guest" as const;
export const DifficultySchema = z.enum(["easy", "medium", "hard"]);
export type Difficulty = z.infer<typeof DifficultySchema>;
export const SparringRoomCodeSchema = z.string().regex(/^sp-[0-9a-f]{32}$/);
/** Same base64url encoding as auth newToken(32); CSRF uses newToken(24). */
export const SparringTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const expiresAt = z.number().finite().int().nonnegative();

export const SparringConfigSchema = z.strictObject({ bots: z.array(DifficultySchema).max(3), roundTarget: RoundTargetSchema.optional() });
export type SparringConfig = z.infer<typeof SparringConfigSchema>;
/** `listed` (default false) publishes the match in GET /api/rooms. It is not part of the frozen bot roster. */
export const SparringCreateRequestSchema = z.strictObject({ bots: z.array(DifficultySchema).max(3), listed: z.boolean().optional(), roundTarget: RoundTargetSchema.optional() });
export const SparringCreateResponseSchema = z.strictObject({ roomCode: SparringRoomCodeSchema });
export const SparringLinkRequestSchema = z.strictObject({ roomCode: SparringRoomCodeSchema });
export const SparringLinkResponseSchema = z.strictObject({ token: SparringTokenSchema, expiresAt });
export const SparringRedeemRequestSchema = z.strictObject({
  token: SparringTokenSchema,
  displayName: DisplayNameSchema,
});
export const SparringGuestResponseSchema = z.strictObject({
  roomCode: SparringRoomCodeSchema,
  csrfToken: z.string().regex(/^[A-Za-z0-9_-]{32}$/),
});
export const SparringRedeemResponseSchema = SparringGuestResponseSchema;
export const SparringEndRequestSchema = z.strictObject({ roomCode: SparringRoomCodeSchema });
// End succeeds with HTTP 204 and no body. Join tickets keep the protocol.ts contracts.
export type SparringCreateRequest = z.infer<typeof SparringCreateRequestSchema>;
export type SparringCreateResponse = z.infer<typeof SparringCreateResponseSchema>;
export type SparringLinkRequest = z.infer<typeof SparringLinkRequestSchema>;
export type SparringLinkResponse = z.infer<typeof SparringLinkResponseSchema>;
export type SparringRedeemRequest = z.infer<typeof SparringRedeemRequestSchema>;
export type SparringRedeemResponse = z.infer<typeof SparringRedeemResponseSchema>;
export type SparringGuestResponse = z.infer<typeof SparringGuestResponseSchema>;
export type SparringEndRequest = z.infer<typeof SparringEndRequestSchema>;

/** World-space x/z metres. */
export type SparringPoint = { x: number; z: number };
export interface BotObservation {
  tick: number;
  spawnTick: number;
  selfId: number;
  self: SparringPoint;
  /** Skill slots 1..4 usable now (Idle and off cooldown); the room may force a slot false. */
  slotsReady: readonly [boolean, boolean, boolean, boolean];
  meterFull: boolean;
  enemies: ReadonlyArray<SparringPoint & {
    id: number; alive: boolean; connected: boolean; ready: boolean; attacking: boolean;
  }>;
}
export interface BotDecision {
  targetId: number | null;
  attackHeld: boolean;
  blockHeld: boolean;
  approach: boolean;
  /** 0 = none; otherwise a one-tick skillDown edge for that slot. */
  castSlot: 0 | 1 | 2 | 3 | 4;
  dash: boolean;
  awaken: boolean;
  retreat: boolean;
  yaw: number;
}
export interface SparringSetupActions {
  start(config: SparringConfig, kitId: KitId, listed?: boolean): Promise<void>;
  copyLink(): Promise<string>;
  end(): Promise<void>;
}
