import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Client } from "@colyseus/sdk";
import { roomTuning } from "../../apps/server/src/rooms/ArenaRoom.js";
import { ClientError } from "../../apps/client/src/net/RoomClient.js";
import { PROTOCOL_VERSION } from "../../packages/shared/src/protocol.js";
import { computeContentHash } from "../../packages/shared/src/config/content.js";
import { startHarness, loginClient, waitFor, players, freshCode, type Harness } from "../fixtures/harness.js";

let h: Harness;
beforeAll(async () => { h = await startHarness(25672); });
afterAll(async () => { await h.stop(); });


describe("A01 two authenticated clients in one private room", () => {
  test("distinct entity and life IDs; both see each other and identical health", async () => {
    const code = freshCode();
    const a = await loginClient(h, "Arel");
    const b = await loginClient(h, "Nora");
    const ra = await a.join(code);
    const rb = await b.join(code);
    expect(ra.roomId).toBe(rb.roomId);
    await waitFor(() => players(ra).size === 2 && players(rb).size === 2, 3000, "both players visible");
    a.send("ready", { kitId: "sv", contentHash: a.localContentHash });
    b.send("ready", { kitId: "sv", contentHash: b.localContentHash }); // identical kits allowed
    await waitFor(() => [...players(ra).values()].every((p) => p.ready) && [...players(rb).values()].every((p) => p.ready), 3000, "ready");
    const va = [...players(ra).values()].map((p) => ({ e: p.entityId, l: p.lifeId, hp: p.hp100, kit: p.kitId, n: p.displayName }));
    const vb = [...players(rb).values()].map((p) => ({ e: p.entityId, l: p.lifeId, hp: p.hp100, kit: p.kitId, n: p.displayName }));
    expect(new Set(va.map((p) => p.e)).size).toBe(2);
    expect(new Set(va.map((p) => p.l)).size).toBe(2);
    expect(va).toEqual(vb);
    expect(va.every((p) => p.hp === 10000 && p.kit === "sv")).toBe(true);
    expect(va.map((p) => p.n).sort()).toEqual(["Arel", "Nora"]);
    await a.leave(); await b.leave();
  });
  test("welcome carries epoch, tick rate and content hash", async () => {
    const code = freshCode();
    const a = await loginClient(h, "Arel");
    await a.join(code);
    await waitFor(() => a.welcome !== null, 3000, "welcome");
    expect(a.welcome).toMatchObject({ epoch: 1, tickRate: 60, contentHash: computeContentHash() });
    await a.leave();
  });
});

describe("A17 room-level authentication", () => {
  const opts = (ticket: string, roomCode = "play") => ({ roomCode, ticket, protocolVersion: PROTOCOL_VERSION, contentHash: computeContentHash() });
  const sdk = () => new Client(`ws://localhost:${h.port}`);

  test("joining directly without a ticket fails and leaks no state", async () => {
    await expect(sdk().joinOrCreate("arena", { roomCode: "play" })).rejects.toBeTruthy();
    await expect(sdk().joinOrCreate("arena", {})).rejects.toBeTruthy();
  });
  test("guessed ticket fails", async () => {
    await expect(sdk().joinOrCreate("arena", opts("a".repeat(64)))).rejects.toBeTruthy();
  });
  test("ticket is single use", async () => {
    const c = await loginClient(h, "Arel");
    const t = await c.requestTicket("play");
    const r1 = await sdk().joinOrCreate("arena", opts(t.ticket));
    await expect(sdk().joinOrCreate("arena", opts(t.ticket))).rejects.toBeTruthy();
    await r1.leave();
  });
  test("ticket for room code A cannot be used in room code B", async () => {
    const c = await loginClient(h, "Arel");
    const t = await c.requestTicket("play");
    await expect(sdk().joinOrCreate("arena", opts(t.ticket, "other"))).rejects.toBeTruthy();
  });
  test("wrong content hash or protocol in join options is refused", async () => {
    const c = await loginClient(h, "Arel");
    const t = await c.requestTicket("play");
    await expect(sdk().joinOrCreate("arena", { ...opts(t.ticket), contentHash: "f".repeat(16) })).rejects.toBeTruthy();
    const t2 = await c.requestTicket("play");
    await expect(sdk().joinOrCreate("arena", { ...opts(t2.ticket), protocolVersion: 2 })).rejects.toBeTruthy();
  });
  test("extra join option keys are refused (strict)", async () => {
    const c = await loginClient(h, "Arel");
    const t = await c.requestTicket("play");
    await expect(sdk().joinOrCreate("arena", { ...opts(t.ticket), isAdmin: true })).rejects.toBeTruthy();
  });
  test("one session cannot hold two seats", async () => {
    const c = await loginClient(h, "Arel");
    const r = await c.join("play");
    await expect(c.join("play")).rejects.toBeInstanceOf(ClientError);
    await r.leave();
  });
  test("revoking the session invalidates outstanding tickets", async () => {
    const c = await loginClient(h, "Arel");
    const t = await c.requestTicket("play");
    await c.logout();
    await expect(sdk().joinOrCreate("arena", opts(t.ticket))).rejects.toBeTruthy();
  });
});

describe("seat lifecycle and reconnect reservation", () => {
  test("graceful leave removes the seat immediately", async () => {
    const code = freshCode();
    const a = await loginClient(h, "Arel");
    const b = await loginClient(h, "Nora");
    const ra = await a.join(code);
    const rb = await b.join(code);
    await waitFor(() => players(rb).size === 2, 3000, "2 players");
    await a.leave();
    await waitFor(() => players(rb).size === 1, 3000, "seat removed");
    expect(ra).toBeTruthy();
    await b.leave();
  });

  test("unexpected drop keeps the avatar; reconnect restores the same life with a new epoch", async () => {
    const code = freshCode();
    const a = await loginClient(h, "Arel");
    const b = await loginClient(h, "Nora");
    const ra = await a.join(code);
    const rb = await b.join(code);
    await waitFor(() => players(rb).size === 2, 3000, "2 players");
    a.send("ready", { kitId: "td", contentHash: a.localContentHash });
    await waitFor(() => [...players(rb).values()].some((p) => p.kitId === "td" && p.ready), 3000, "A ready");
    const before = [...players(rb).values()].find((p) => p.kitId === "td")!;
    const entity = before.entityId, life = before.lifeId;
    const token = ra.reconnectionToken;

    ra.reconnection.enabled = false; // drive the reconnect by hand
    ra.connection.close(4010, "network lost");
    await waitFor(() => players(rb).get(String(entity))?.connected === false, 3000, "connected=false");
    expect(players(rb).size).toBe(2); // avatar remains

    const ra2 = await new Client(`ws://localhost:${h.port}`).reconnect(token);
    let epoch = 0;
    ra2.onMessage("welcome", (w: { epoch: number }) => { epoch = w.epoch; });
    await waitFor(() => players(rb).get(String(entity))?.connected === true, 3000, "connected=true");
    await waitFor(() => epoch === 2, 3000, "new epoch welcome");
    const after = players(rb).get(String(entity));
    expect(after.lifeId).toBe(life);
    expect(after.hp100).toBe(10000);
    expect(after.kitId).toBe("td");
    expect(players(rb).size).toBe(2);
    await ra2.leave(); await b.leave();
  });

  test("seat is released when the reservation expires; the session can rejoin afterwards", async () => {
    const code = freshCode();
    const old = roomTuning.reconnectSeconds;
    roomTuning.reconnectSeconds = 1;
    try {
      const a = await loginClient(h, "Arel");
      const b = await loginClient(h, "Nora");
      const ra = await a.join(code);
      const rb = await b.join(code);
      await waitFor(() => players(rb).size === 2, 3000, "2 players");
      ra.reconnection.enabled = false;
      ra.connection.close(4010, "network lost");
      await waitFor(() => players(rb).size === 1, 5000, "seat released after reservation");
      const again = await a.join(code); // same session, fresh ticket
      await waitFor(() => players(rb).size === 2, 3000, "rejoined");
      await again.leave(); await b.leave();
    } finally {
      roomTuning.reconnectSeconds = old;
    }
  });
});

describe("room capacity and lobby rules", () => {
  test("a fifth player gets ROOM_FULL", async () => {
    const code = freshCode();
    const rooms = [];
    for (let i = 0; i < 4; i++) rooms.push(await (await loginClient(h, `P${i}`)).join(code));
    const late = await loginClient(h, "Late");
    await expect(late.join(code)).rejects.toMatchObject({ code: "ROOM_FULL" });
    for (const r of rooms) await r.leave();
  });

  test("ready validates kit and content hash; P1 kit is not selectable; kit change after ready is pending only", async () => {
    const code = freshCode();
    const a = await loginClient(h, "Arel");
    const ra = await a.join(code);
    a.send("ready", { kitId: "ea", contentHash: a.localContentHash });
    a.send("ready", { kitId: "sv", contentHash: "0".repeat(16) });
    await new Promise((r) => setTimeout(r, 1100)); // ready/changeKit are limited to 2 per second
    expect([...players(ra).values()][0].ready).toBe(false);
    a.send("changeKit", { kitId: "td" });
    await waitFor(() => [...players(ra).values()][0].kitId === "td", 3000, "kit change in lobby");
    a.send("ready", { kitId: "td", contentHash: a.localContentHash });
    await waitFor(() => [...players(ra).values()][0].ready, 3000, "ready");
    await new Promise((r) => setTimeout(r, 1100));
    a.send("changeKit", { kitId: "sv" });
    await new Promise((r) => setTimeout(r, 200));
    expect([...players(ra).values()][0].kitId).toBe("td"); // applied at next respawn (T17)
    await a.leave();
  });

  test("ping returns pong with server tick; junk messages do not crash the room", async () => {
    const code = freshCode();
    const a = await loginClient(h, "Arel");
    const ra = await a.join(code);
    let pong: { nonce: number; serverTick: number } | null = null;
    ra.onMessage("pong", (m: { nonce: number; serverTick: number }) => { pong = m; });
    a.send("ping", { nonce: 7, clientMs: 1 });
    ra.send("totallyUnknown", { x: 1 });
    ra.send("input", { nonsense: true });
    ra.send("ready", "garbage");
    await waitFor(() => pong !== null, 3000, "pong");
    expect(pong!.nonce).toBe(7);
    a.send("ping", { nonce: 8, clientMs: 1 });
    await new Promise((r) => setTimeout(r, 100));
    expect(players(ra).size).toBe(1); // room still alive
    await a.leave();
  });

  test("replicated player state never carries secrets", async () => {
    const code = freshCode();
    const a = await loginClient(h, "Arel");
    const ra = await a.join(code);
    const json = JSON.stringify([...players(ra).values()].map((p) => p.toJSON()));
    expect(json).not.toMatch(/ticket|token|invite|cookie|sessionId|authId/i);
    await a.leave();
  });
});
