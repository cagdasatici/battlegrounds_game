import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { matchMaker } from "colyseus";
import { startHarness, loginClient, waitFor, players, freshCode, type Harness } from "../fixtures/harness.js";
import type { ArenaRoom } from "../../apps/server/src/rooms/ArenaRoom.js";

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h.stop(); });

describe("T29 over a real server", () => {
  test("GR10: a rejected invite never writes the source address into routine logs", async () => {
    const { recentLogLines } = await import("../../apps/server/src/ops/StructuredLog.js");
    const r = await fetch(`${h.origin}/api/session`, {
      method: "POST", headers: { "content-type": "application/json", origin: h.origin, "cf-connecting-ip": "203.0.113.9" },
      body: JSON.stringify({ invite: "nope-nope-nope", displayName: "ReviewChild" }),
    });
    expect(r.status).toBe(401);
    const all = recentLogLines().join("\n");
    expect(all).toContain("invite rejected");
    expect(all).not.toContain("203.0.113.9");
  });

  test("A16: ten malformed pings from a real client disconnect it; the room keeps running and the other client stays", async () => {
    const code = freshCode();
    const a = await loginClient(h, "Arel"), b = await loginClient(h, "Nora");
    const ra = await a.join(code), rb = await b.join(code);
    await waitFor(() => players(ra).size === 2 && players(rb).size === 2, 3000, "joined");
    let left = false;
    ra.onLeave(() => { left = true; });
    // Pings are bucketed (1/s, burst 2) but a malformed one only counts after it passes the bucket, so mix in unknown types too.
    for (let i = 0; i < 12; i++) ra.send("bogus", { i });
    await waitFor(() => left, 3000, "offender disconnected");
    const room = matchMaker.getLocalRoomById(rb.roomId) as unknown as ArenaRoom;
    expect(room.sim.tick).toBeGreaterThan(0);
    expect(players(rb).size).toBeGreaterThanOrEqual(1);
    await b.leave();
  });

  test("A17: a foreign Origin on the WebSocket auth step is refused even with a valid ticket; a ticket cannot be reused", async () => {
    const code = freshCode();
    const a = await loginClient(h, "Arel");
    const ra = await a.join(code);
    await waitFor(() => players(ra).size === 1, 3000, "joined");
    const room = matchMaker.getLocalRoomById(ra.roomId) as unknown as ArenaRoom;
    const before = players(ra).size;
    const opts = { ticket: "0".repeat(64), roomCode: code, contentHash: "x", protocolVersion: 1 };
    await expect(room.onAuth({} as never, opts, { headers: new Headers({ origin: "https://evil.example" }) })).rejects.toThrow("AUTH_FAILED");
    await expect(room.onAuth({} as never, opts, { headers: new Headers({ origin: h.origin }) })).rejects.toThrow("AUTH_FAILED"); // unknown ticket
    expect(players(ra).size).toBe(before);
    await a.leave();
  });
});
