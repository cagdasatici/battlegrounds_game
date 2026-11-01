import { MapSchema, Schema, defineTypes } from "@colyseus/schema";
import { PlayerSchema } from "./PlayerSchema.js";
import { ProjectileSchema } from "./ProjectileSchema.js";
import { UrnSchema } from "./UrnSchema.js";

export class ArenaState extends Schema {
  protocolVersion = 1;
  contentHash = "";
  serverTick = 0;
  mapId = "islands.v1";
  phase = "lobby";
  players = new MapSchema<PlayerSchema>();
  projectiles = new MapSchema<ProjectileSchema>();
  urns = new MapSchema<UrnSchema>();
}
defineTypes(ArenaState, {
  protocolVersion: "uint8", contentHash: "string", serverTick: "uint32", mapId: "string", phase: "string",
  players: { map: PlayerSchema },
  projectiles: { map: ProjectileSchema },
  urns: { map: UrnSchema },
});
