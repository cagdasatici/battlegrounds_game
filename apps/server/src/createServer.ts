import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ARENA_ROOM_NAME } from "@eb/shared/protocol";
import { ArenaRoom, setArenaAuth } from "./rooms/ArenaRoom.js";
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
  return server;
}
