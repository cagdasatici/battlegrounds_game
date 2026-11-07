import { afterAll, beforeAll, expect, test } from "vitest";
import { matchMaker } from "colyseus";
import { startHarness, waitFor, players, loginClient, type Harness } from "../fixtures/harness.js";
import { COAST_MAP, DEFAULT_MAP_ID, GROVE_MAP, MAP_REGISTRY, insideMapBounds } from "../../packages/shared/src/config/maps.js";
import type { SparringRoom } from "../../apps/server/src/rooms/SparringRoom.js";

// WORLD01: the host's map choice travels create request -> directory -> room -> world, state and welcome.
let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h.stop(); });

const live = (roomId: string): SparringRoom => matchMaker.getLocalRoomById(roomId) as unknown as SparringRoom;

async function host(mapId?: string) {
  const c = await loginClient(h, `Host${Math.floor(Math.random() * 1e6)}`);
  const code = await c.createSparring({ bots: ["easy"], ...(mapId ? { mapId } : {}) });
  const room = await c.join(code);
  await waitFor(() => c.welcome !== null && players(room).size > 0, 3000, "welcome");
  return { c, code, room, server: live(room.roomId) };
}

test("no mapId means the grove; the world, state and welcome agree", async () => {
  const g = await host();
  expect(g.server.world!.map.mapId).toBe(GROVE_MAP.collisionMapId);
  expect((g.room.state as { mapId: string }).mapId).toBe(DEFAULT_MAP_ID);
  expect(g.c.welcome!.mapId).toBe(DEFAULT_MAP_ID);
  await g.c.endSparring(g.code); await g.c.leave().catch(() => undefined);
});

test("mapId coast: the room loads the coast collision, replicates it, uses its urns and spawns everyone on the beach", async () => {
  const g = await host("coast");
  expect(g.server.mapDef).toBe(COAST_MAP);
  expect(g.server.world!.map.mapId).toBe(COAST_MAP.collisionMapId);
  await waitFor(() => (g.room.state as { mapId: string }).mapId === "coast", 3000, "state.mapId");
  expect(g.c.welcome!.mapId).toBe("coast");
  expect(g.server.urns.list().map((u) => [...u.anchor])).toEqual(g.server.world!.map.urnAnchors.map((a) => [...a.position]));
  expect(g.server.urns.list()).toHaveLength(8);
  // Every fighter that has a body (the bot; the human gets one on Ready) stands on the beach, inside the bounds.
  let bodies = 0;
  for (const p of players(g.room).values()) {
    const pos = g.server.movement!.position(p.entityId);
    if (!pos) continue;
    bodies++;
    expect(insideMapBounds(COAST_MAP, pos[0], pos[2]), `entity ${p.entityId}`).toBe(true);
    expect(g.server.world!.walkableTop(pos[0], pos[2])).toBe(0);
  }
  expect(bodies).toBeGreaterThanOrEqual(1);
  await g.c.endSparring(g.code); await g.c.leave().catch(() => undefined);
});

test("every registry map can be requested and is the one the room plays", async () => {
  for (const id of Object.keys(MAP_REGISTRY)) {
    const g = await host(id);
    expect(g.server.mapDef.id).toBe(id);
    expect(g.server.world!.map.mapId).toBe(MAP_REGISTRY[id]!.collisionMapId);
    await g.c.endSparring(g.code); await g.c.leave().catch(() => undefined);
  }
});

test("an unknown or prototype-key mapId is refused by the create endpoint and no room is made", async () => {
  const c = await loginClient(h, "Refuser");
  for (const bad of ["atlantis", "constructor", "__proto__", ""]) {
    await expect(c.createSparring({ bots: [], mapId: bad })).rejects.toBeTruthy();
  }
  // Raw request: the server schema refuses it too (401/403 here because the request carries no session, never 201).
  const r = await fetch(`${h.origin}/api/sparring`, { method: "POST", headers: { origin: h.origin, "content-type": "application/json" }, body: JSON.stringify({ bots: [], mapId: "atlantis" }) });
  expect([400, 401, 403]).toContain(r.status);
});
