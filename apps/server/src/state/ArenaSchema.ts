import { MapSchema, Schema, defineTypes } from "@colyseus/schema";
import { PlayerSchema } from "./PlayerSchema.js";

export class ArenaState extends Schema {
  protocolVersion = 1;
  contentHash = "";
  serverTick = 0;
  mapId = "islands.v1";
  phase = "lobby";
  players = new MapSchema<PlayerSchema>();
}
defineTypes(ArenaState, {
  protocolVersion: "uint8", contentHash: "string", serverTick: "uint32", mapId: "string", phase: "string",
  players: { map: PlayerSchema },
});
