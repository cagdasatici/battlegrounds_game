import { describe, expect, test } from "vitest";
import {
  InputPacketSchema, parseInputPacket, checkCompatibility, SessionRequestSchema, JoinOptionsSchema,
  ReadyMessageSchema, ChangeKitMessageSchema, PingMessageSchema, graphemeCount, PROTOCOL_VERSION,
} from "../../packages/shared/src/protocol.js";
import { computeContentHash } from "../../packages/shared/src/config/content.js";
import { contentHashOf, canonicalJson } from "../../packages/shared/src/math.js";
import { quantizeYaw, fromYaw, quantizeCm, fromCm, FORBIDDEN_STATE_FIELDS, PLAYER_PUBLIC_FIELDS, PLAYER_OWNER_FIELDS } from "../../packages/shared/src/schema.js";
import { COMBAT } from "../../packages/shared/src/config/combat.js";

const good = () => ({
  v: 1, epoch: 1, seq: 1, sampleTick: 0, moveX: 0, moveZ: -1, yaw: 0, pitch: 0,
  attackHeld: false, blockHeld: false, jumpHeld: false, runHeld: false, chargeHeldSlot: 0, edges: [],
});

describe("InputPacket validation", () => {
  test("accepts a valid packet", () => expect(parseInputPacket(good())).not.toBeNull());
  test("rejects unknown keys", () => expect(parseInputPacket({ ...good(), hax: 1 })).toBeNull());
  test("rejects wrong version", () => expect(parseInputPacket({ ...good(), v: 2 })).toBeNull());
  test("rejects NaN and Infinity", () => {
    expect(parseInputPacket({ ...good(), moveX: NaN })).toBeNull();
    expect(parseInputPacket({ ...good(), yaw: Infinity })).toBeNull();
  });
  test("rejects more than 6 edges", () => {
    const edges = Array.from({ length: 7 }, (_, i) => ({ id: i, kind: "jump" }));
    expect(InputPacketSchema.safeParse({ ...good(), edges }).success).toBe(false);
    expect(parseInputPacket({ ...good(), edges: edges.slice(0, 6) })).not.toBeNull();
  });
  test("skill edges require a slot 1..4; others forbid it", () => {
    expect(InputPacketSchema.safeParse({ ...good(), edges: [{ id: 1, kind: "skillDown" }] }).success).toBe(false);
    expect(InputPacketSchema.safeParse({ ...good(), edges: [{ id: 1, kind: "skillDown", slot: 5 }] }).success).toBe(false);
    expect(InputPacketSchema.safeParse({ ...good(), edges: [{ id: 1, kind: "skillDown", slot: 4 }] }).success).toBe(true);
    expect(InputPacketSchema.safeParse({ ...good(), edges: [{ id: 1, kind: "jump", slot: 1 }] }).success).toBe(false);
  });
  test("rejects packets over 1024 bytes", () => {
    const edges = Array.from({ length: 6 }, (_, i) => ({ id: i, kind: "jump", pad: "x".repeat(200) }));
    expect(parseInputPacket({ ...good(), edges })).toBeNull();
  });
  test("rejects non-objects and negative / fractional counters", () => {
    expect(parseInputPacket(null)).toBeNull();
    expect(parseInputPacket("x")).toBeNull();
    expect(parseInputPacket({ ...good(), seq: -1 })).toBeNull();
    expect(parseInputPacket({ ...good(), seq: 1.5 })).toBeNull();
  });
});

describe("other client messages", () => {
  test("ready/changeKit/ping are strict", () => {
    expect(ReadyMessageSchema.safeParse({ kitId: "sv", contentHash: "0123456789abcdef" }).success).toBe(true);
    expect(ReadyMessageSchema.safeParse({ kitId: "sv", contentHash: "short" }).success).toBe(false);
    expect(ChangeKitMessageSchema.safeParse({ kitId: "zz" }).success).toBe(false);
    expect(PingMessageSchema.safeParse({ nonce: 1, clientMs: 5, extra: 1 }).success).toBe(false);
  });
});

describe("HTTP contracts", () => {
  test("display names: 1-16 graphemes, no control chars", () => {
    const ok = (n: string) => SessionRequestSchema.safeParse({ invite: "x".repeat(10), displayName: n }).success;
    expect(ok("Arel")).toBe(true);
    expect(ok("")).toBe(false);
    expect(ok("a".repeat(17))).toBe(false);
    expect(ok("a".repeat(16))).toBe(true);
    expect(ok("bad\u0007name")).toBe(false);
    expect(ok("👨‍👩‍👧‍👦".repeat(16))).toBe(true); // 16 graphemes, many code points
    expect(graphemeCount("👨‍👩‍👧‍👦")).toBe(1);
  });
  test("join options require a 64 hex ticket and matching version", () => {
    const base = { roomCode: "play", ticket: "a".repeat(64), protocolVersion: PROTOCOL_VERSION, contentHash: "0".repeat(16) };
    expect(JoinOptionsSchema.safeParse(base).success).toBe(true);
    expect(JoinOptionsSchema.safeParse({ ...base, ticket: "zz" }).success).toBe(false);
    expect(JoinOptionsSchema.safeParse({ ...base, protocolVersion: PROTOCOL_VERSION + 1 }).success).toBe(false);
  });
});

describe("protocol compatibility", () => {
  const local = { protocolVersion: PROTOCOL_VERSION, contentHash: computeContentHash() };
  test("same version and hash is ok", () => expect(checkCompatibility(local, local)).toBe("ok"));
  test("version mismatch refused", () =>
    expect(checkCompatibility({ ...local, protocolVersion: PROTOCOL_VERSION + 1 }, local)).toBe("VERSION_MISMATCH"));
  test("hash mismatch refused", () =>
    expect(checkCompatibility({ ...local, contentHash: "f".repeat(16) }, local)).toBe("VERSION_MISMATCH"));
});

describe("content hash", () => {
  test("is stable and 16 hex chars", () => {
    expect(computeContentHash()).toMatch(/^[0-9a-f]{16}$/);
    expect(computeContentHash()).toBe(computeContentHash());
  });
  test("is key-order independent", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(canonicalJson({ a: [2, { c: 2, d: 1 }], b: 1 }));
    expect(contentHashOf({ a: 1, b: 2 })).toBe(contentHashOf({ b: 2, a: 1 }));
  });
  test("changes when any value changes", () => {
    expect(contentHashOf({ a: 1 })).not.toBe(contentHashOf({ a: 2 }));
    expect(computeContentHash([{ extra: 1 }])).not.toBe(computeContentHash());
  });
});

describe("state contract", () => {
  test("no secret-bearing field is replicated", () => {
    const all = [...PLAYER_PUBLIC_FIELDS, ...PLAYER_OWNER_FIELDS].map((f) => f.toLowerCase());
    for (const bad of FORBIDDEN_STATE_FIELDS) expect(all).not.toContain(bad.toLowerCase());
  });
  test("owner fields are disjoint from public fields", () => {
    for (const f of PLAYER_OWNER_FIELDS) expect((PLAYER_PUBLIC_FIELDS as readonly string[]).includes(f)).toBe(false);
  });
  test("quantisation round trips within resolution", () => {
    expect(fromCm(quantizeCm(1.234))).toBeCloseTo(1.23, 2);
    for (const y of [0, 1, -1, 3.1, -3.1, 6.2]) {
      const back = fromYaw(quantizeYaw(y));
      const d = Math.abs(((back - y + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      expect(d).toBeLessThan((Math.PI * 2) / 1024);
    }
    expect(quantizeYaw(-0.0001)).toBeGreaterThanOrEqual(0);
    expect(quantizeYaw(-0.0001)).toBeLessThan(1024);
  });
});

describe("combat config", () => {
  test("matches section 11 values", () => {
    expect(COMBAT.m1.damage).toEqual([3, 3, 4, 4]);
    expect(COMBAT.m1.damage.reduce((a, b) => a + b, 0)).toBe(14); // A02: 14 per chain
    expect(COMBAT.movement.gravity).toBe(-24);
    expect(COMBAT.dash.forward.cooldown).toBe(300);
    expect(COMBAT.evasive.cooldown).toBe(1800);
    expect(COMBAT.spawnProtectionTicks).toBe(120);
  });
});
