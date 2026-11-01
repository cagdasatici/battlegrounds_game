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
  // Mirror Current: counter window [commit, commit+60); response [6,16] at trigger+[12,30], release +31 R60 F8 U3.
  defineAbility({
    id: "td.b4", label: "Mirror Current", handler: "counter",
    startup: 0, active: 60, recovery: 30, cooldown: 1020, range: 4, block: "U",
    hitOffsets: [12, 30], damage100: [600, 1600],
    counterable: false, // the response is noncounterable (spec 13/15)
    stunTicks: 0, ragdollTicks: 60, launch: { forward: 8, up: 3 },
  }),

  // Cascade Chain (T16): capture (all target states), damage [4,4,4,4,10] at capture+[0,8,16,24,32] (the capture hit is index 0),
  // release +33 R60 F5 U4. Caster armor from the first confirmed capture (armor onHit). Not a once per form move.
  defineAbility({
    id: "td.a1", label: "Cascade Chain", handler: "cascadeChain",
    startup: 8, active: 5, recovery: 16, cooldown: 510, range: 2.5, block: "U", armor: "onHit",
    hitOffsets: [0, 8, 16, 24, 32], damage100: [400, 400, 400, 400, 1000],
    targetStates: ["standing", "air", "ragdoll"],
    stunTicks: 0, ragdollTicks: 60, launch: { forward: 5, up: 4 },
  }),
  // Deepfall (T16): cinematic capture, startup armor, 69 HP at capture+72 (the capture hit deals nothing), release +78 R90 F4 U12.
  // The area hit (4 m, 20 HP, U, noncounterable, R60 F6 U4, max 3 others so 4 targets in all) is handler data.
  defineAbility({
    id: "td.a2", label: "Deepfall", handler: "deepfall",
    startup: 16, active: 5, recovery: 30, cooldown: 0, range: 2.5, block: "U", armor: "startup", armorBreak: true,
    hitOffsets: [0, 72], damage100: [0, 6900],
    targetStates: ["standing", "air", "ragdoll"],
    stunTicks: 0, ragdollTicks: 90, launch: { forward: 4, up: 12 }, maxTargets: 4, oncePerForm: true,
  }),
  // Split Tide (T16): two probes at activeStart+[0,17], 12 HP stun 30 then 26 HP R72 F10 U4, counterable, no capture, no armorBreak.
  // The caster has armor from commit through the last active tick (armor startup plus handler armorUntil = activeEnd).
  defineAbility({
    id: "td.a3", label: "Split Tide", handler: "splitTide",
    startup: 16, active: 18, recovery: 24, cooldown: 840, range: 3, block: "U", armor: "startup",
    hitOffsets: [0, 17], damage100: [1200, 2600],
    targetStates: ["standing", "air", "ragdoll"],
    stunTicks: 30, ragdollTicks: 0, launch: { forward: 10, up: 4 },
  }),
  // Riptide Pursuit (T16): branch fixed at commit. Close (a target within 2 m): capture damage [8,22] at +[0,36]. Ranged: dash 18 m/s
  // (0.3 m per tick) for up to 30 active ticks (9 m), stops at a wall or at the capture; 27 HP at +36 (the ranged capture hit deals nothing).
  // Release +37 R72 F8 U5. Caster armor only after the capture. The P1 second target chain is T24.
  defineAbility({
    id: "td.a4", label: "Riptide Pursuit", handler: "riptidePursuit",
    startup: 12, active: 30, recovery: 30, cooldown: 570, range: 9, block: "U",
    hitOffsets: [0, 36], damage100: [800, 2200],
    targetStates: ["standing", "air", "ragdoll"],
    stunTicks: 0, ragdollTicks: 72, launch: { forward: 8, up: 5 },
  }),
];
