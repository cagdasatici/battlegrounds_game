import { z } from "zod";

export const PROTOCOL_VERSION = 1 as const;
export const TICK_RATE = 60 as const;
export const PATCH_RATE_MS = 50 as const;
export const MAX_CLIENTS = 4 as const;
export const ARENA_ROOM_NAME = "arena" as const;
export const PRACTICE_ROOM_NAME = "practice" as const;
export const RECONNECT_SECONDS = 20 as const;
export const MAX_PACKET_BYTES = 1024 as const;
export const MAX_EDGES_PER_PACKET = 6 as const;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

const finite = z.number().finite();
const uint32 = z.number().int().min(0).max(0xffffffff);

export const EdgeSchema = z.union([
  z.strictObject({ id: uint32, kind: z.enum(["jump", "dash", "awaken"]) }),
  z.strictObject({
    id: uint32,
    kind: z.enum(["skillDown", "skillUp"]),
    slot: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  }),
]);
export type Edge = z.infer<typeof EdgeSchema>;

export const InputPacketSchema = z.strictObject({
  v: z.literal(1),
  epoch: uint32,
  seq: uint32,
  sampleTick: uint32,
  moveX: finite,
  moveZ: finite,
  yaw: finite,
  pitch: finite,
  attackHeld: z.boolean(),
  blockHeld: z.boolean(),
  jumpHeld: z.boolean(),
  runHeld: z.boolean(),
  facingLock: z.boolean().optional(),
  chargeHeldSlot: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  edges: z.array(EdgeSchema).max(MAX_EDGES_PER_PACKET),
});
export type InputPacket = z.infer<typeof InputPacketSchema>;

export const KitIdSchema = z.enum(["sv", "td", "ea"]);
export type KitId = z.infer<typeof KitIdSchema>;
/** Kits selectable in the lobby. The Ember Artificer joined with T21 once its four base and four awakened moves existed (decision 0022). */
export const P0_KITS: readonly KitId[] = ["sv", "td", "ea"];

const hashStr = z.string().regex(/^[0-9a-f]{16}$/);
export const ReadyMessageSchema = z.strictObject({ kitId: KitIdSchema, contentHash: hashStr });
export const ChangeKitMessageSchema = z.strictObject({ kitId: KitIdSchema });
export const PingMessageSchema = z.strictObject({ nonce: uint32, clientMs: finite });
export const LeaveMessageSchema = z.strictObject({});

/** Practice room dummy toggles (T18d). Intent only: the server applies them to its own dummy. */
export const PracticeSetSchema = z.strictObject({ guard: z.boolean(), ragdoll: z.boolean(), bots: z.array(z.enum(["easy", "medium", "hard"])).max(2).optional() });
export type PracticeSetMessage = z.infer<typeof PracticeSetSchema>;
/** Practice tutorial steps in order. Each is confirmed by the server from simulation state, never by the client. */
export const TUTORIAL_STEPS = ["move", "turn", "attack", "block", "dash", "skills", "awaken"] as const;
export type TutorialStep = (typeof TUTORIAL_STEPS)[number];
/** Room code the client asks for; the server derives a private per session room code from it. */
export const PRACTICE_ROOM_CODE = "practice" as const;

export type ReadyMessage = z.infer<typeof ReadyMessageSchema>;
export type ChangeKitMessage = z.infer<typeof ChangeKitMessageSchema>;
export type PingMessage = z.infer<typeof PingMessageSchema>;

export type RejectReason = "STATE" | "COOLDOWN" | "METER" | "FORM" | "INVALID";
export interface ActionResult {
  epoch: number;
  seq: number;
  edgeId: number;
  accepted: boolean;
  tick: number;
  castId?: string;
  reason?: RejectReason;
}
export type CombatEventKind =
  | "cast" | "hit" | "block" | "counter" | "capture" | "release" | "ko" | "respawn" | "heal";
export interface CombatEvent {
  eventId: string;
  tick: number;
  kind: CombatEventKind;
  actorId: string;
  targetId?: string;
  lifeId: number;
  moveId?: string;
  damage100?: number;
  position?: Vec3;
  /** On "hit": heavy when damage100 >= 1000, an m1 finisher, or the attacker is Awakened. */
  hitClass?: "light" | "heavy";
  /** On "hit" and "heal": victim HP (hundredths) after the event. */
  targetHp100?: number;
}

export interface WelcomeMessage {
  epoch: number;
  serverTick: number;
  tickRate: number;
  contentHash: string;
}
/** Decision 0054: opt-in first-to-N KO rounds for hosted sparring and bot rooms. 0 = endless (default). */
export const RoundTargetSchema = z.union([z.literal(0), z.literal(5), z.literal(10)]);
export type RoundTarget = z.infer<typeof RoundTargetSchema>;
/** Results hold time: integer ticks of the fixed 60 Hz clock (10 s). */
export const ROUND_OVER_TICKS = 600;
export const RoundOverMessageSchema = z.strictObject({
  tick: z.number().int().nonnegative(),
  roundTarget: RoundTargetSchema,
  resumesAtTick: z.number().int().nonnegative(),
  standings: z.array(z.strictObject({
    entityId: z.number().int().nonnegative(), displayName: z.string(),
    kills: z.number().int().nonnegative(), deaths: z.number().int().nonnegative(), assists: z.number().int().nonnegative(),
  })),
});
export type RoundOverMessage = z.infer<typeof RoundOverMessageSchema>;
export interface PongMessage { nonce: number; serverMs: number; serverTick: number }
export interface ShutdownMessage { deadlineMs: number; reason: string }

/** Client to server message names. No arbitrary client events are accepted. */
export const ClientMessage = {
  input: "input",
  ready: "ready",
  changeKit: "changeKit",
  ping: "ping",
  leave: "leave",
  practice: "practice",
} as const;
export const ServerMessage = {
  welcome: "welcome",
  actionResult: "actionResult",
  combatEvent: "combatEvent",
  pong: "pong",
  shutdown: "shutdown",
  roundOver: "roundOver",
} as const;

/** Per-message rate limits (spec section 19). */
export const RATE_LIMITS = {
  inputPerSecond: 45,
  inputBurst: 15,
  edgesPerSecond: 20,
  edgeBurst: 8,
  readyPerSecond: 2,
  pingPerSecond: 1,
} as const;

// ---- HTTP contracts (spec section 20) ----
export const DisplayNameSchema = z
  .string()
  .refine((s) => !/[\u0000-\u001f\u007f-\u009f]/.test(s), "control characters")
  .refine((s) => {
    const n = graphemeCount(s);
    return n >= 1 && n <= 16;
  }, "1 to 16 graphemes");

export function graphemeCount(s: string): number {
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: object) => { segment(s: string): Iterable<unknown> } }).Segmenter;
  if (Seg) return [...new Seg(undefined, { granularity: "grapheme" }).segment(s)].length;
  return [...s].length;
}

export const SessionRequestSchema = z.strictObject({
  invite: z.string().min(8).max(128),
  displayName: DisplayNameSchema,
});
/** Open join: only the two local profiles may be chosen. */
export const OPEN_PLAYER_NAMES = ["Arel", "Nora"] as const;
export const OpenSessionRequestSchema = z.strictObject({ displayName: z.enum(OPEN_PLAYER_NAMES) });
export const JoinTicketRequestSchema = z.strictObject({
  roomCode: z.string().min(1).max(64),
});
export interface VersionResponse { protocolVersion: number; contentHash: string; buildId: string }
export interface SessionResponse { expiresAt: number }
export interface JoinTicketResponse {
  ticket: string; expiresAt: number; roomName: string; roomId: string;
  /** Present when the server chose a private code for this session (practice rooms); use it in the join options. */
  roomCode?: string;
}
export const JoinOptionsSchema = z.strictObject({
  roomCode: z.string().min(1).max(64),
  ticket: z.string().regex(/^[0-9a-f]{64}$/),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  contentHash: hashStr,
});
export type JoinOptions = z.infer<typeof JoinOptionsSchema>;

/** Errors surfaced by the client (spec section 6). */
export type ClientErrorCode =
  | "ROOM_FULL" | "INVITE_INVALID" | "VERSION_MISMATCH" | "SERVER_OFFLINE" | "ASSET_FAILED";

/** Application-level compatibility check performed by both sides. */
export function checkCompatibility(
  remote: { protocolVersion: number; contentHash: string },
  local: { protocolVersion: number; contentHash: string },
): "ok" | "VERSION_MISMATCH" {
  return remote.protocolVersion === local.protocolVersion && remote.contentHash === local.contentHash
    ? "ok"
    : "VERSION_MISMATCH";
}

/** Strict parse helper: returns null instead of throwing; enforces byte bound for JSON-ish input. */
export function parseInputPacket(raw: unknown): InputPacket | null {
  if (raw === null || typeof raw !== "object") return null;
  try {
    if (JSON.stringify(raw).length > MAX_PACKET_BYTES) return null;
  } catch {
    return null;
  }
  const r = InputPacketSchema.safeParse(raw);
  return r.success ? r.data : null;
}
