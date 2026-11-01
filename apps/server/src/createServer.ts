import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ARENA_ROOM_NAME, PRACTICE_ROOM_NAME } from "@eb/shared/protocol";
import { ArenaRoom, setArenaAuth } from "./rooms/ArenaRoom.js";
import { PracticeRoom } from "./rooms/PracticeRoom.js";
import { roomDirectory } from "./rooms/RoomDirectory.js";
import type { AuthServices } from "./auth/Services.js";
import { registerSessionRoutes, type HttpApp } from "./http/sessionRoutes.js";

export function createGameServer(auth: AuthServices): Server {
  setArenaAuth(auth);
  auth.ensureRoom = (name, code) => roomDirectory.ensure(name, code);
  const server = new Server({
    transport: new WebSocketTransport(),
    express: (app: unknown) => registerSessionRoutes(app as HttpApp, auth),
  });
  // Joining requires a ticket (onAuth); filterBy keeps each private room code in its own room.
  server.define(ARENA_ROOM_NAME, ArenaRoom).filterBy(["roomCode"]);
  // Practice: one player and a dummy per room; the matchmaker derives a private code per session (sessionRoutes).
  server.define(PRACTICE_ROOM_NAME, PracticeRoom).filterBy(["roomCode"]);
  return server;
}
