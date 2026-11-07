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

/** BEAST01: the sparring beast. One always-present record; `phase` says whether it exists. Never holds auth data. */
export class BeastSchema extends Schema {
  /** none | warning | alive | defeated */
  phase = "none";
  x = 0;
  y = 0;
  z = 0;
  facingYaw = 0;
  hp100 = 0;
  hpMax100 = 0;
  /** Idle | Windup | Active | Recovery | Stunned | Dead (the fighter action). */
  action = "Idle";
  moveId = "";
  actionStartTick = 0;
  actionEndTick = 0;
  /** Warning countdown end (phase warning) or collapse end (phase defeated). */
  phaseEndTick = 0;
  /** Body scale in hundredths (550 = 5.5x). */
  scale100 = 550;
  /** True while the walk animation should play. */
  walking = false;
}
defineTypes(BeastSchema, {
  phase: "string", x: "int32", y: "int32", z: "int32", facingYaw: "uint16", hp100: "uint16", hpMax100: "uint16",
  action: "string", moveId: "string", actionStartTick: "uint32", actionEndTick: "uint32", phaseEndTick: "uint32",
  scale100: "uint16", walking: "boolean",
});

/** BEAST02: one live crater (sparring). Centimetres; startTick is an absolute server tick. */
export class CraterSchema extends Schema {
  id = 0;
  x = 0;
  z = 0;
  radius100 = 0;
  startTick = 0;
}
defineTypes(CraterSchema, { id: "uint16", x: "int32", z: "int32", radius100: "uint16", startTick: "uint32" });

export class ArenaState extends Schema {
  protocolVersion = 1;
  contentHash = "";
  serverTick = 0;
  mapId = "islands.v1";
  phase = "lobby";
  players = new MapSchema<PlayerSchema>();
  projectiles = new MapSchema<ProjectileSchema>();
  urns = new MapSchema<UrnSchema>();
  beast = new BeastSchema();
  craters = new ArraySchema<CraterSchema>();
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
  beast: BeastSchema,
  craters: [CraterSchema],
  roundTarget: "uint8", roundNumber: "uint32", roundEndsAtTick: "uint32",
  roundStandings: [RoundStandingSchema],
});
