import { defineAbility, type AbilityDef } from "../../abilities.js";

/**
 * Tide Duelist definitions (spec section 15). T13 fills the four base moves; T16 adds the awakened four.
 * Every number is D (local design value) taken from the spec 15 table; damage is hundredths of HP.
 * Handler names are internal interfaces implemented in apps/server/src/kits/td.
 * `hitOffsets` of the capture moves are relative to the capture tick (counter stance: to the trigger tick),
 * not to activeStart; the handlers own that schedule (spec 15 handler cards).
 */
export const TD_DEFS: AbilityDef[] = [
  // Current Bind: capture on the initial hit, damage [4,4,4,4,8] at +[0,10,20,30,42], release +43 R60 F7 U3.
  defineAbility({
    id: "td.b1", label: "Current Bind", handler: "captureBarrage",
    startup: 10, active: 5, recovery: 18, cooldown: 1020, range: 2.4, block: "U",
    hitOffsets: [0, 10, 20, 30, 42], damage100: [400, 400, 400, 400, 800],
    targetStates: ["standing", "air", "ragdoll"], // grounded ragdoll is filtered by the handler
    stunTicks: 0, ragdollTicks: 60, launch: { forward: 7, up: 3 },
  }),
  // Undertow Spiral: capture, 5 at +0 and 14 at +48, pair moves 3 m over 36 ticks, release +49 R72 F3 U8.
  defineAbility({
    id: "td.b2", label: "Undertow Spiral", handler: "dragSlam",
    startup: 14, active: 5, recovery: 24, cooldown: 1200, range: 2.2, block: "B",
    hitOffsets: [0, 48], damage100: [500, 1400],
    targetStates: ["standing", "air", "ragdoll"],
    stunTicks: 0, ragdollTicks: 72, launch: { forward: 3, up: 8 },
  }),
  // Tidal Cast: capture (no damage), 9 at +18, release +19 R60 F10 U2; the collision bonus is handler data.
  defineAbility({
    id: "td.b3", label: "Tidal Cast", handler: "throwCapture",
    startup: 12, active: 4, recovery: 18, cooldown: 900, range: 2.2, block: "U",
    hitOffsets: [0, 18], damage100: [0, 900],
    targetStates: ["standing", "air", "ragdoll"],
    stunTicks: 0, ragdollTicks: 60, launch: { forward: 10, up: 2 },
  }),
];
