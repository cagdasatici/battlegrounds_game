import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ARENA_ROOM_NAME } from "@eb/shared/protocol";
import { ArenaRoom } from "./ArenaRoom.js";

export function createGameServer(): Server {
  const server = new Server({ transport: new WebSocketTransport() });
  server.define(ARENA_ROOM_NAME, ArenaRoom);
  return server;
}
