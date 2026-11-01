import { afterAll, beforeAll, expect, test } from "vitest";
import { Client } from "@colyseus/sdk";
import type { Server } from "colyseus";
import { createGameServer } from "../../apps/server/src/createServer.js";
import { ARENA_ROOM_NAME, PROTOCOL_VERSION } from "../../packages/shared/src/protocol.js";

let server: Server;
const PORT = 25670;

beforeAll(async () => {
  server = createGameServer();
  await server.listen(PORT, undefined, undefined);
});
afterAll(async () => {
  await server.gracefullyShutdown(false);
});

test("a real client joins the arena room and receives state", async () => {
  const client = new Client(`ws://localhost:${PORT}`);
  const room = await client.joinOrCreate(ARENA_ROOM_NAME);
  const welcome = await new Promise<{ protocolVersion: number }>((resolve) => {
    room.onMessage("welcome", resolve);
  });
  expect(welcome.protocolVersion).toBe(PROTOCOL_VERSION);
  await new Promise((r) => setTimeout(r, 300));
  expect((room.state as { serverTick: number }).serverTick).toBeGreaterThan(0);
  await room.leave();
});
