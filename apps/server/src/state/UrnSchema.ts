import { Schema, defineTypes } from "@colyseus/schema";

/**
 * Replicated urn record (T23, spec 10). Server owned prop: anchored on its stand, carried by a fighter (reserved while
 * the 12 tick pickup runs), or returning after a throw. Positions are centimetres. holderId 0 means nobody.
 */
export class UrnSchema extends Schema {
  id = 0;
  state = "anchored";
  holderId = 0;
  returnTick = 0;
  x = 0;
  y = 0;
  z = 0;
}
defineTypes(UrnSchema, { id: "uint8", state: "string", holderId: "uint8", returnTick: "uint32", x: "int32", y: "int32", z: "int32" });
