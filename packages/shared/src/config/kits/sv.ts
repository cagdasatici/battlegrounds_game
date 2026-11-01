import { defineAbility, type AbilityDef } from "../../abilities.js";

/**
 * Stone Vanguard definitions (spec section 15). Filled by T12 (base) and T15 (awakened).
 * Every number is D (local design value). Damage is hundredths of HP. Block: B blockable, U bypasses guard.
 */
export const SV_DEFS: AbilityDef[] = [
  // Fault Strike: direct 20 HP, R72 F14 U4, 3 m, U. The 8 m wave (10 HP, B) and landing bonus (10 HP) are handler data.
  defineAbility({
    id: "sv.b1", label: "Fault Strike", handler: "faultStrike", startup: 24, active: 4, recovery: 24, cooldown: 1200,
    damage100: [2000], range: 3, block: "U", targetStates: ["standing", "air", "ragdoll"],
    stunTicks: 0, ragdollTicks: 72, launch: { forward: 14, up: 4 }, maxTargets: 4,
  }),
  // Gravel Flurry: six scheduled hits, 15 HP total per target, B, intermediate stun 12, final R60 F7 U2 (handler).
  // turnRate 90 deg/s is recorded here; the Movement facing lock is not enforced yet (T12 limitation).
  defineAbility({
    id: "sv.b2", label: "Gravel Flurry", handler: "barrage", startup: 10, active: 40, recovery: 18, cooldown: 900,
    hitOffsets: [0, 8, 16, 24, 32, 39], damage100: [200, 200, 200, 200, 200, 500], range: 2.5, block: "B",
    targetStates: ["standing", "air", "ragdoll"], stunTicks: 12, ragdollTicks: 0, moveScale: 0.15, turnRate: 90, maxTargets: 3,
  }),
  // Rift Palm: 7 HP, U, stun 30, launch F2 U0 (no ragdoll), reflects one projectile per cast (handler).
  defineAbility({
    id: "sv.b3", label: "Rift Palm", handler: "reflectPalm", startup: 8, active: 3, recovery: 14, cooldown: 600,
    damage100: [700], range: 2, block: "U", targetStates: ["standing", "air", "ragdoll"],
    stunTicks: 30, ragdollTicks: 0, launch: { forward: 2, up: 0 },
  }),
  // Rising Pillar: 15 HP, U, R84 F1 U11, standing/air/ragdoll, no landing damage.
  defineAbility({
    id: "sv.b4", label: "Rising Pillar", handler: "launcher", startup: 16, active: 4, recovery: 20, cooldown: 900,
    damage100: [1500], range: 2, block: "U", targetStates: ["standing", "air", "ragdoll"],
    stunTicks: 0, ragdollTicks: 84, launch: { forward: 1, up: 11 },
  }),
  // Stillpoint Reversal (T15): commit spends the form; a private counter status stays open for 600 ticks (def.active).
  // Response: 100 HP (lethal cap, never Infinity) at trigger + 60, release at +72, then recovery 18. Range 40 m is the trigger reach.
  defineAbility({
    id: "sv.a1", label: "Stillpoint Reversal", handler: "lethalCounter", startup: 0, active: 600, recovery: 18, cooldown: 0,
    hitOffsets: [60], damage100: [10000], range: 40, block: "U", counterable: false, stunTicks: 0, ragdollTicks: 0,
    oncePerForm: true, consumesForm: true,
  }),
];
