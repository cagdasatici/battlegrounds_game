import { Server, matchMaker } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ARENA_ROOM_NAME, MAX_CLIENTS, PRACTICE_ROOM_NAME } from "@eb/shared/protocol";
import { setArenaAuth } from "./rooms/ArenaRoom.js";
import { BotArenaRoom } from "./rooms/BotArenaRoom.js";
import { SparringRoom } from "./rooms/SparringRoom.js";
import { SPARRING_ROOM_NAME } from "@eb/shared/sparring";
import { registerSparringRoutes } from "./http/sparringRoutes.js";
import { PracticeRoom } from "./rooms/PracticeRoom.js";
import { roomDirectory } from "./rooms/RoomDirectory.js";
import type { AuthServices } from "./auth/Services.js";
import { registerStaticRoutes } from "./http/staticFiles.js";
import { registerSessionRoutes, type HttpApp } from "./http/sessionRoutes.js";

export function createGameServer(auth: AuthServices, opts: { staticDir?: string | null } = {}): Server {
  setArenaAuth(auth);
  auth.ensureRoom = (name, code) => {
    if (name === SPARRING_ROOM_NAME && !auth.sparring.describe(code)) throw new Error("MATCH_CLOSED");
    return roomDirectory.ensure(name, code);
  };
  auth.occupancy = (_name, code) => {
    const id = roomDirectory.get(code);
    const room = id ? matchMaker.getLocalRoomById(id) : undefined;
    return { players: room?.clients.length ?? 0, capacity: room?.maxClients ?? MAX_CLIENTS };
  };
  const closing = new Set<string>();
  auth.closeRoom = async (code) => {
    if (closing.has(code)) return;
    const id = roomDirectory.get(code);
    const room = id ? matchMaker.getLocalRoomById(id) : undefined;
    if (room) {
      closing.add(code);
      try { await room.disconnect(); } finally { closing.delete(code); }
    }
  };
  const server = new Server({
    transport: new WebSocketTransport(),
    express: (app: unknown) => {
      registerSessionRoutes(app as HttpApp, auth, auth.now);
      registerSparringRoutes(app as HttpApp, auth);
      if (opts.staticDir) registerStaticRoutes(app as HttpApp, opts.staticDir, auth.config.allowedOrigins[0]);
    },
  });
  // Joining requires a ticket (onAuth); filterBy keeps each private room code in its own room.
  server.define(ARENA_ROOM_NAME, BotArenaRoom).filterBy(["roomCode"]);
  // Practice: one player and a dummy per room; the matchmaker derives a private code per session (sessionRoutes).
  server.define(PRACTICE_ROOM_NAME, PracticeRoom).filterBy(["roomCode"]);
  server.define(SPARRING_ROOM_NAME, SparringRoom).filterBy(["roomCode"]);
  // Wall-time lifecycle only: no simulation or damage scheduling. Runs without connected clients.
  const sweep = setInterval(() => {
    for (const code of auth.sparring.sweep()) void auth.closeRoom(code);
  }, 250);
  sweep.unref();
  server.onBeforeShutdown(() => { clearInterval(sweep); });
  return server;
}
