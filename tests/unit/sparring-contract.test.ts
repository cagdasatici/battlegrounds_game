import { describe, expect, test } from "vitest";
import {
  DifficultySchema, SparringConfigSchema, SparringCreateRequestSchema,
  SparringCreateResponseSchema, SparringLinkRequestSchema, SparringLinkResponseSchema,
  SparringRedeemRequestSchema, SparringRedeemResponseSchema, SparringGuestResponseSchema,
  SparringEndRequestSchema, SparringRoomCodeSchema,
  type BotObservation, type BotDecision, type SparringSetupActions,
} from "../../packages/shared/src/sparring.js";

const roomCode = `sp-${"a".repeat(32)}`;
const token = "A".repeat(43);
const csrfToken = "B".repeat(32);

describe("BOT0 frozen sparring contracts", () => {
  test("all tiers and ordered zero/three-bot rosters", () => {
    for (const tier of ["easy", "medium", "hard"]) expect(DifficultySchema.parse(tier)).toBe(tier);
    expect(SparringConfigSchema.parse({ bots: [] })).toEqual({ bots: [] });
    const bots = ["hard", "easy", "medium"];
    expect(SparringCreateRequestSchema.parse({ bots })).toEqual({ bots });
    for (const bots of [["easy", "easy", "easy", "easy"], ["Medium"], [1], null]) {
      expect(SparringConfigSchema.safeParse({ bots }).success).toBe(false);
    }
  });

  const records = [
    [SparringCreateRequestSchema, { bots: ["medium"] }],
    [SparringCreateResponseSchema, { roomCode }],
    [SparringLinkRequestSchema, { roomCode }],
    [SparringLinkResponseSchema, { token, expiresAt: 600_000 }],
    [SparringRedeemRequestSchema, { token, displayName: "Player" }],
    [SparringRedeemResponseSchema, { roomCode, csrfToken }],
    [SparringGuestResponseSchema, { roomCode, csrfToken }],
    [SparringEndRequestSchema, { roomCode }],
  ] as const;
  test.each(records)("strict route record %#", (schema, value) => {
    expect(schema.safeParse(value).success).toBe(true);
    expect(schema.safeParse({ ...value, unexpected: true }).success).toBe(false);
    for (const key of Object.keys(value)) {
      const missing: Record<string, unknown> = { ...value };
      delete missing[key];
      expect(schema.safeParse(missing).success).toBe(false);
    }
  });

  test("malformed codes, credentials, display names and expiry are rejected", () => {
    for (const code of ["arena", `sp-${"a".repeat(31)}`, `sp-${"a".repeat(33)}`, `sp-${"A".repeat(32)}`, `${roomCode}\n`]) {
      expect(SparringRoomCodeSchema.safeParse(code).success).toBe(false);
    }
    for (const bad of ["", "a".repeat(42), "a".repeat(44), "+".repeat(43)]) {
      expect(SparringRedeemRequestSchema.safeParse({ token: bad, displayName: "Player" }).success).toBe(false);
    }
    for (const displayName of ["", "a".repeat(17), "bad\nname"]) {
      expect(SparringRedeemRequestSchema.safeParse({ token, displayName }).success).toBe(false);
    }
    for (const expiresAt of [-1, 1.5, Infinity, "600000"]) {
      expect(SparringLinkResponseSchema.safeParse({ token, expiresAt }).success).toBe(false);
    }
    expect(SparringGuestResponseSchema.safeParse({ roomCode, csrfToken: token }).success).toBe(false);
  });

  test("pure integration types retain the agreed boundary", async () => {
    const observation: BotObservation = {
      tick: 30, spawnTick: 0, selfId: 1, self: { x: 0, z: 0 }, slotsReady: [true, true, true, true], meterFull: false,
      enemies: [{ id: 2, x: 1, z: 0, alive: true, connected: true, ready: true, attacking: false }],
    };
    const neutral: BotDecision = { targetId: null, attackHeld: false, blockHeld: false, approach: false, castSlot: 0, dash: false, awaken: false, retreat: false, yaw: 0, holdSlot: 0, releaseSlot: 0, losLost: 0 };
    const actions: SparringSetupActions = { start: async () => {}, copyLink: async () => "local fixture", end: async () => {} };
    expect(observation.enemies[0]?.id).toBe(2);
    expect(neutral.targetId).toBeNull();
    await actions.start({ bots: ["easy"] }, "sv");
    expect(await actions.copyLink()).toBe("local fixture");
    await actions.end();
  });
});
