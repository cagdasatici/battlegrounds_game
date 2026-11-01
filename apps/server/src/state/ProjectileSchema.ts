import { Schema, defineTypes } from "@colyseus/schema";

/**
 * Replicated projectile record (spec section 20). Authoritative gameplay entity; visual debris is never replicated.
 * Positions are centimetres, velocity centimetres per second. The patch carries state.serverTick alongside.
 */
export class ProjectileSchema extends Schema {
  entityId = 0;
  castId = "";
  ownerId = 0;
  ownerLifeId = 0;
  spawnTick = 0;
  x = 0;
  y = 0;
  z = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  chargeClass = "partial";
  remainingTicks = 0;
  reflectionCount = 0;
}
defineTypes(ProjectileSchema, {
  entityId: "uint16", castId: "string", ownerId: "uint8", ownerLifeId: "uint16", spawnTick: "uint32",
  x: "int32", y: "int32", z: "int32", vx: "int16", vy: "int16", vz: "int16",
  chargeClass: "string", remainingTicks: "uint16", reflectionCount: "uint8",
});
