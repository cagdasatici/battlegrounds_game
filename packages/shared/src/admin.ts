import { z } from "zod";
import { DifficultySchema } from "./sparring.js";
import { RoundTargetSchema } from "./protocol.js";
import { MapIdSchema } from "./config/maps.js";

/** WEB4 admin contracts. Every request is strict; responses never carry tokens, hashes or full session ids. */
export const ADMIN_COOKIE = "eb_admin";
export const ANNOUNCEMENT_MAX = 200;

export const AdminLoginRequestSchema = z.strictObject({ password: z.string().min(1).max(256) });
export const AdminInviteCreateSchema = z.strictObject({
  ttlHours: z.number().int().min(1).max(24 * 30),
  maxUses: z.number().int().min(1).max(100),
});
export const AdminRoomCreateSchema = z.strictObject({ name: z.string().trim().min(1).max(32), bots: z.array(DifficultySchema).max(3).default([]), roundTarget: RoundTargetSchema.default(0), mapId: MapIdSchema.optional() })
  // Decision 0054: rounds are only for rooms with bots; an open FFA room stays endless.
  .refine((r) => r.roundTarget === 0 || r.bots.length > 0, { message: "roundTarget needs at least one bot" });
export const AdminRoomPatchSchema = z.strictObject({ listed: z.boolean() });
/** Empty text clears the announcement. */
export const AdminAnnouncementPutSchema = z.strictObject({
  text: z.string().max(ANNOUNCEMENT_MAX),
  expiresAt: z.number().int().positive().nullable().optional(),
});

export const AnnouncementSchema = z.strictObject({
  text: z.string().min(1).max(ANNOUNCEMENT_MAX),
  expiresAt: z.number().int().positive().nullable(),
});
export const AnnouncementResponseSchema = z.strictObject({ announcement: AnnouncementSchema.nullable() });

export const AdminRoomRowSchema = z.strictObject({
  roomCode: z.string().min(1).max(64),
  name: z.string().min(1).max(32),
  kind: z.enum(["arena", "sparring"]),
  players: z.number().int().nonnegative(),
  bots: z.number().int().nonnegative(),
  listed: z.boolean(),
});
export const AdminInviteRowSchema = z.strictObject({
  id: z.string(), createdAt: z.number(), expiresAt: z.number(), usesLeft: z.number().int().nonnegative(),
});
export const AdminSessionRowSchema = z.strictObject({
  id: z.string().length(12), displayName: z.string(), createdAt: z.number(), lastActive: z.number(),
});
export const AdminStatusSchema = z.strictObject({
  buildId: z.string(), protocolVersion: z.number(), contentHash: z.string(), uptimeSeconds: z.number(),
  rooms: z.array(AdminRoomRowSchema.pick({ roomCode: true, kind: true, players: true, bots: true })),
  playerCount: z.number().int().nonnegative(),
  logs: z.array(z.string()).max(50),
});
export const AdminLoginResponseSchema = z.strictObject({ csrfToken: z.string(), expiresAt: z.number() });

export type AdminRoomRow = z.infer<typeof AdminRoomRowSchema>;
export type AdminInviteRow = z.infer<typeof AdminInviteRowSchema>;
export type AdminSessionRow = z.infer<typeof AdminSessionRowSchema>;
export type AdminStatus = z.infer<typeof AdminStatusSchema>;
export type Announcement = z.infer<typeof AnnouncementSchema>;
