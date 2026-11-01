import { Schema, defineTypes } from "@colyseus/schema";
import type { Action, Form } from "@eb/shared/schema";

/**
 * Public replicated player record (spec section 20). Positions are centimetres, yaw is 1/1024 turn
 * (see shared/schema.ts quantizers). Owner-only fields arrive with prediction in T08.
 * Never add invites, tokens or auth identifiers here.
 */
export class PlayerSchema extends Schema {
  entityId = 0;
  lifeId = 0;
  kitId = "sv";
  displayName = "";
  x = 0;
  y = 0;
  z = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  facingYaw = 0;
  hp100 = 10000;
  action: Action = "Idle";
  actionStartTick = 0;
  actionEndTick = 0;
  moveId = "";
  form: Form = "Base";
  formEndTick = 0;
  meter100 = 0;
  awakenedUsedMask = 0;
  contextSpent = false;
  connected = true;
  ready = false;
  protectedUntilTick = 0;
  kills = 0;
  deaths = 0;
  assists = 0;
}
defineTypes(PlayerSchema, {
  entityId: "uint8", lifeId: "uint16", kitId: "string", displayName: "string",
  x: "int32", y: "int32", z: "int32", vx: "int16", vy: "int16", vz: "int16", facingYaw: "uint16",
  hp100: "uint16", action: "string", actionStartTick: "uint32", actionEndTick: "uint32", moveId: "string",
  form: "string", formEndTick: "uint32", meter100: "uint16", awakenedUsedMask: "uint8", contextSpent: "boolean",
  connected: "boolean", ready: "boolean", protectedUntilTick: "uint32",
  kills: "uint16", deaths: "uint16", assists: "uint16",
});
