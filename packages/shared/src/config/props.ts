import { defineAbility, KIT_PREFIXES, type AbilityDef } from "../abilities.js";

/**
 * Urn pickup and ordinary throw (T23, spec 15 "Urn interaction shared by all kits"), generated per kit prefix like the
 * wall attack. Pickup is a 12 tick channel that deals nothing. The throw is damage 8, startup 10, speed 18, sphere
 * radius 0.3, B, R36 F6 U2; its 20 tick recovery is D.
 */
export const PROP_DEFS: AbilityDef[] = KIT_PREFIXES.flatMap((p) => [
  defineAbility({
    id: `${p}.pickup`, label: "Pick Up", handler: "urnPickup", startup: 12, active: 1, recovery: 0, cooldown: 0,
    damage100: [0], range: 0, block: "B", input: "context", counterable: false,
  }),
  defineAbility({
    id: `${p}.throw`, label: "Urn Throw", handler: "urnThrow", startup: 10, active: 1, recovery: 20, cooldown: 0,
    damage100: [800], range: 0, block: "B", input: "context", stunTicks: 0, ragdollTicks: 36, launch: { forward: 6, up: 2 },
    projectile: {
      speed: 18, lifeTicks: 120, maxRange: 36, radius: 0.3, splashRadius: 0, splashMax: 1, reflectable: true,
      arcAmplitude: 0, arcSpan: 0, chargeMaxTicks: 0, fullDamage100: 0, chip100: 0,
    },
  }),
]);
