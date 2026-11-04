import { ArraySchema, MapSchema, Schema, defineTypes } from "@colyseus/schema";
import { PlayerSchema } from "./PlayerSchema.js";
import { ProjectileSchema } from "./ProjectileSchema.js";
import { UrnSchema } from "./UrnSchema.js";

/** GR08: one frozen results row, written once when the round ends. */
export class RoundStandingSchema extends Schema {
  entityId = 0;
  displayName = "";
  kills = 0;
  deaths = 0;
  assists = 0;
}
defineTypes(RoundStandingSchema, { entityId: "uint8", displayName: "string", kills: "uint16", deaths: "uint16", assists: "uint16" });

export class ArenaState extends Schema {
  protocolVersion = 1;
  contentHash = "";
  serverTick = 0;
  mapId = "islands.v1";
  phase = "lobby";
  players = new MapSchema<PlayerSchema>();
  projectiles = new MapSchema<ProjectileSchema>();
  urns = new MapSchema<UrnSchema>();
  /** GR08 durable round state: 0 = endless, else first to N. */
  roundTarget = 0;
  roundNumber = 1;
  /** Tick at which the results phase ends; 0 while playing. */
  roundEndsAtTick = 0;
  roundStandings = new ArraySchema<RoundStandingSchema>();
}
defineTypes(ArenaState, {
  protocolVersion: "uint8", contentHash: "string", serverTick: "uint32", mapId: "string", phase: "string",
  players: { map: PlayerSchema },
  projectiles: { map: ProjectileSchema },
  urns: { map: UrnSchema },
  roundTarget: "uint8", roundNumber: "uint32", roundEndsAtTick: "uint32",
  roundStandings: [RoundStandingSchema],
});
