import { z } from "zod";
import { SparringRoomCodeSchema } from "./sparring.js";

/** WEB3 room list contracts. Rows carry counts only: never internal ids, member names or link tokens. */
const count = z.number().int().nonnegative().max(16);
export const RoomSummarySchema = z.strictObject({
  roomCode: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/),
  name: z.string().min(1).max(32),
  kind: z.enum(["arena", "sparring"]),
  players: count,
  capacity: count,
  bots: count,
});
export const RoomListResponseSchema = z.strictObject({ rooms: z.array(RoomSummarySchema).max(100) });
export type RoomSummary = z.infer<typeof RoomSummarySchema>;
export type RoomListResponse = z.infer<typeof RoomListResponseSchema>;

/** Admits an ordinary signed-in session as a guest of one listed sparring match. */
export const SparringJoinRequestSchema = z.strictObject({ roomCode: SparringRoomCodeSchema });
export type SparringJoinRequest = z.infer<typeof SparringJoinRequestSchema>;

/** True when no seat is left for a human. */
export const roomIsFull = (r: Pick<RoomSummary, "players" | "bots" | "capacity">): boolean => r.players + r.bots >= r.capacity;
