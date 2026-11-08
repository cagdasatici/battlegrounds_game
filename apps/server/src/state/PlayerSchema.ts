import { ArraySchema, Schema, defineTypes, view } from "@colyseus/schema";
import type { Action, Form } from "@eb/shared/schema";

/**
 * Owner-only record (spec sections 15, 20, 22). Tagged with view() on PlayerSchema.owner, so only clients whose
 * StateView contains it receive it. Ticks are absolute server ticks.
 */
export class OwnerSchema extends Schema {
  ackSeq = 0;
  ackInputTick = 0;
  epoch = 1;
  pendingKit = "";
  evasiveEndTick = 0;
  chargeStartTick = 0;
  lethalCounterRemaining = 0;
  /** Practice room only (T18d): number of server confirmed tutorial steps, skill bits seen, dummy toggles. */
  tutorialStep = 0;
  tutorialSkillMask = 0;
  dummyGuard = false;
  dummyRagdoll = false;
  practiceBotCount = 0;
  practiceBotDifficulty = "easy";
  /** GR15a practice lesson: drillState is idle/running/success; ticks are absolute server ticks. */
  drillId = "";
  drillState = "idle";
  drillStartTick = 0;
  drillSuccessTick = 0;
  /** GR04 owner locomotion state after physics (same tick as the pose). Ticks are absolute server ticks; -1 = never. */
  grounded = false;
  lastGroundedTick = -1;
  jumpPressTick = -1;
  jumpedSinceGrounded = false;
  airJumpsUsed = 0;
}
defineTypes(OwnerSchema, {
  ackSeq: "uint32", ackInputTick: "uint32", epoch: "uint32", pendingKit: "string",
  evasiveEndTick: "uint32", chargeStartTick: "uint32", lethalCounterRemaining: "uint16",
  tutorialStep: "uint8", tutorialSkillMask: "uint8", dummyGuard: "boolean", dummyRagdoll: "boolean", practiceBotCount: "uint8", practiceBotDifficulty: "string",
  drillId: "string", drillState: "string", drillStartTick: "uint32", drillSuccessTick: "uint32",
  grounded: "boolean", lastGroundedTick: "int32", jumpPressTick: "int32", jumpedSinceGrounded: "boolean", airJumpsUsed: "uint8",
});

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
  /** BEAST02: Beast Awaken active; formEndTick is when it ends. */
  beast = false;
  /** DJ01: the air jump of the current airtime is spent (cleared on landing). Drives client flip and ring effects. */
  airJumpUsed = false;
  connected = true;
  ready = false;
  protectedUntilTick = 0;
  kills = 0;
  deaths = 0;
  assists = 0;
  /** Absolute tick at which each slot (1..4) of the current form is ready again; 0 = ready. */
  cooldownEndTicks = new ArraySchema<number>(0, 0, 0, 0);
  owner = new OwnerSchema();
}
defineTypes(PlayerSchema, {
  entityId: "uint8", lifeId: "uint16", kitId: "string", displayName: "string",
  x: "int32", y: "int32", z: "int32", vx: "int16", vy: "int16", vz: "int16", facingYaw: "uint16",
  hp100: "uint16", action: "string", actionStartTick: "uint32", actionEndTick: "uint32", moveId: "string",
  form: "string", formEndTick: "uint32", meter100: "uint32", awakenedUsedMask: "uint8", contextSpent: "boolean", beast: "boolean", airJumpUsed: "boolean",
  connected: "boolean", ready: "boolean", protectedUntilTick: "uint32",
  kills: "uint16", deaths: "uint16", assists: "uint16",
  cooldownEndTicks: { array: "uint32" },
  owner: OwnerSchema,
});
// defineTypes ignores the `view` option in the installed 5.0.43 API; apply the tag explicitly (after the field is declared).
view()(PlayerSchema.prototype, "owner");
