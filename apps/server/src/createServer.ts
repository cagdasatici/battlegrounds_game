import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ARENA_ROOM_NAME } from "@eb/shared/protocol";
import { ArenaRoom } from "./ArenaRoom.js";
import type { AuthServices } from "./auth/Services.js";
import { registerSessionRoutes, type HttpApp } from "./http/sessionRoutes.js";

export function createGameServer(auth?: AuthServices): Server {
  const server = new Server({
    transport: new WebSocketTransport(),
    ...(auth
      ? { express: (app: unknown) => registerSessionRoutes(app as HttpApp, auth) }
      : {}),
  });
  server.define(ARENA_ROOM_NAME, ArenaRoom);
  return server;
}
