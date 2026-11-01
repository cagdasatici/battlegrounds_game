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
];
