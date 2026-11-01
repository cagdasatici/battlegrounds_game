import { describe, expect, test } from "vitest";
import { InputChannel } from "../../apps/server/src/net/ValidateInput.js";
import { ArenaRoom, setArenaAuth } from "../../apps/server/src/rooms/ArenaRoom.js";

function packet(seq: number, edges: unknown[] = []): unknown {
  return {
    v: 1, epoch: 1, seq, sampleTick: seq, moveX: 0, moveZ: 0, yaw: 0, pitch: 0,
    attackHeld: false, blockHeld: false, jumpHeld: false, runHeld: false, chargeHeldSlot: 0, edges,
  };
}

describe("R09.1 ActionResult.seq is the seq of the packet carrying the edge", () => {
  test("an edge in seq 7 followed by seq 8 without edges reports seq 7", () => {
    const ch = new InputChannel(0);
    expect(ch.accept(packet(7, [{ id: 1, kind: "jump" }]), 10, 0)).toBeNull();
    expect(ch.accept(packet(8), 11, 0)).toBeNull();
    expect(ch.lastReceivedSeq).toBe(8);
    const q = ch.drain();
    expect(q).toHaveLength(1);
    expect(q[0]!.seq).toBe(7);
    expect(ch.seqOfEdge(1)).toBe(7);
  });
});

describe("R09.2 event ids are roomEpoch:serverTick:counter", () => {
  test("format and uint32 epoch", () => {
    const room = new ArenaRoom();
    const sent: Array<{ eventId: string }> = [];
    (room as unknown as { broadcast: (t: string, m: { eventId: string }) => void }).broadcast = (_t, m) => sent.push(m);
    const r = room as unknown as { roomEpoch: number; broadcastEvent: (...a: unknown[]) => void };
    r.roomEpoch = 0xdeadbeef;
    r.broadcastEvent(42, "cast", 1, undefined, 1);
    r.broadcastEvent(42, "cast", 1, undefined, 1);
    expect(sent.map((e) => e.eventId)).toEqual([`${0xdeadbeef}:42:1`, `${0xdeadbeef}:42:2`]);
    const fresh = new ArenaRoom() as unknown as { roomEpoch: number };
    expect(Number.isInteger(fresh.roomEpoch) && fresh.roomEpoch >= 0 && fresh.roomEpoch <= 0xffffffff).toBe(true);
  });
});

describe("R09.3 overload refusal in onAuth", () => {
  test("refuses with ROOM_FULL while overloaded, using an injected wall clock", async () => {
    setArenaAuth(null);
    const room = new ArenaRoom();
    const wall = { now: 1000 };
    (room as unknown as { wallNow: () => number }).wallNow = () => wall.now;
    // Five overloads inside 10 s: each advance asks for far more catch-up than 5 steps allow.
    for (let i = 0; i < 5; i++) room.sim.advance(250, () => undefined, wall.now + i);
    expect(room.sim.isOverloaded(wall.now)).toBe(true);
    await expect(room.onAuth({} as never, {})).rejects.toThrow("ROOM_FULL");
    wall.now += 11_000; // overloads age out
    await expect(room.onAuth({} as never, {})).rejects.toThrow("AUTH_FAILED");
  });
});
