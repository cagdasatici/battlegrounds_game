import { afterAll, beforeAll, expect, test } from "vitest";
import { matchMaker } from "colyseus";
import { startHarness, loginClient, waitFor, players, type Harness } from "../fixtures/harness.js";
import type { ArenaRoom } from "../../apps/server/src/rooms/ArenaRoom.js";
import { TokenBucket } from "../../apps/server/src/net/RateLimits.js";
import { CombatBus } from "../../apps/client/src/app/CombatBus.js";
import { ServerMessage, type CombatEvent } from "../../packages/shared/src/protocol.js";

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h.stop(); });

test("practice bot resets stay in uint8 range and preserve the human id", async () => {
  const c = await loginClient(h, "Practice");
  const room = await c.join("practice");
  try {
    await waitFor(() => players(room).size === 2);
    const humanId = [...players(room).values()].find(p => p.owner !== undefined).entityId;
    const server = matchMaker.getLocalRoomById(room.roomId) as unknown as ArenaRoom;
    // Only lift the command bucket in this fixture: all requests still traverse real sockets and strict schemas.
    (server as unknown as { practiceBucket: TokenBucket }).practiceBucket = new TokenBucket(1000, 1000, performance.now());
    // Protocol supports at most two bots. 130 cycles allocate 260 bot lives, crossing the old uint8 limit.
    for (let i = 0; i < 130; i++) {
      c.send("practice", { guard: false, ragdoll: false, bots: ["easy", "medium"] });
      await waitFor(() => players(room).size === 4);
      const ids = [...players(room).values()].map(p => p.entityId);
      expect(ids.every(id => id >= 1 && id <= 255)).toBe(true);
      expect(new Set(ids).size).toBe(4);
      expect([...players(room).values()].find(p => p.owner !== undefined).entityId).toBe(humanId);
      c.send("practice", { guard: false, ragdoll: false, bots: [] });
      await waitFor(() => players(room).size === 2);
    }
  } finally { await c.leave(); }
}, 30000);

test("a new occupant reuses id 1, keeps B's owner view, and ignores A's old life event", async () => {
  const a = await loginClient(h, "A"), b = await loginClient(h, "B"), c = await loginClient(h, "C");
  const ra = await a.join("r2"), rb = await b.join("r2");
  const server = matchMaker.getLocalRoomById(ra.roomId) as unknown as ArenaRoom;
  a.send("ready", { kitId: "sv", contentHash: a.localContentHash });
  b.send("ready", { kitId: "td", contentHash: b.localContentHash });
  await waitFor(() => players(rb).get("1")?.ready && players(rb).get("2")?.ready);
  const oldLife = players(rb).get("1").lifeId, hpB = players(rb).get("2").hp100;
  await a.leave();
  await waitFor(() => !server.state.players.has("1"));
  const rc = await c.join("r2");
  let bus: CombatBus | undefined;
  try {
    c.send("ready", { kitId: "ea", contentHash: c.localContentHash });
    await waitFor(() => [...players(rc).values()].some(p => p.displayName === "C" && p.ready));
    const me = [...players(rc).values()].find(p => p.owner !== undefined);
    expect(me.entityId).toBe(1);
    expect(me.lifeId).toBeGreaterThan(oldLife);
    expect(players(rb).get("2").owner).toBeDefined();
    expect(players(rb).get("2").hp100).toBe(hpB);
    expect(players(rb).get("1")?.owner).toBeUndefined();
    const got: string[] = [];
    bus = new CombatBus(handler => rc.onMessage(ServerMessage.combatEvent, handler), id => players(rc).get(id)?.lifeId);
    bus.on(e => got.push(e.eventId));
    const stale: CombatEvent = { eventId: "rel02:old", tick: server.sim.tick, kind: "hit", actorId: "2", targetId: "1", lifeId: oldLife };
    server.broadcast(ServerMessage.combatEvent, stale);
    server.broadcast(ServerMessage.combatEvent, { ...stale, eventId: "rel02:current", lifeId: me.lifeId });
    await waitFor(() => got.includes("rel02:current"));
    expect(got).not.toContain("rel02:old");
  } finally { bus?.dispose(); await b.leave(); await c.leave(); }
});
