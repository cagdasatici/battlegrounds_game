import { defineAbility, type AbilityDef } from "../../abilities.js";

/**
 * Ember Artificer base definitions (spec section 15, T20). Every number is D (local design value) taken from the
 * spec 15 table; damage is hundredths of HP. Handler names are implemented in apps/server/src/kits/ea.
 * The awakened four arrive with T21; the kit stays hidden from lobby selection (P0_KITS) until a later task.
 * Decision record: docs/decisions/0014-t20-artificer-base-rules.md.
 */
export const EA_DEFS: AbilityDef[] = [
  // Cinder Array: six hits at activeStart+[0,8,16,24,32,39]. Standing damage [2,2,2,2,3,10]; the ragdoll table
  // [1,1,1,1,2,7] and the per target branch snapshot are handler data. Intermediate hits stun 12, the final hit is
  // R72 F3 U9 (handler candidate). Caster holds zero vertical velocity through the active ticks (handler).
  defineAbility({
    id: "ea.b1", label: "Cinder Array", handler: "cinderArray", startup: 10, active: 40, recovery: 24, cooldown: 900,
    hitOffsets: [0, 8, 16, 24, 32, 39], damage100: [200, 200, 200, 200, 300, 1000], range: 2.5, block: "B",
    targetStates: ["standing", "air", "ragdoll"], stunTicks: 12, ragdollTicks: 0, moveScale: 0.2, turnRate: 90, maxTargets: 3,
  }),
  // Vent Rush: travel 8 m at 20 m/s along the commit aim (24 active ticks), a second press after 6 active ticks ends
  // travel early (input recast). Front blast (index 0): sphere r 2.5 centred 1.5 m ahead, 15 HP (24 on a ragdoll
  // target), B, chip 6, R72 F10 U3. Rear blast (index 1, reserved at activeStart): 10 HP, U, R36 F4 U2; a target takes
  // only one phase (maxHitsPerTarget 1). Both phases resolve at travel end (handler data).
  defineAbility({
    id: "ea.b2", label: "Vent Rush", handler: "ventRush", startup: 10, active: 24, recovery: 24, cooldown: 1020,
    hitOffsets: [0, 1], damage100: [1500, 1000], range: 1.5, shape: { kind: "sphere", r: 2.5 }, block: "B",
    input: "recast", targetStates: ["standing", "air", "ragdoll"], stunTicks: 0, ragdollTicks: 72, launch: { forward: 10, up: 3 },
    maxTargets: 4, maxHitsPerTarget: 1,
  }),
  // Ember Orb: holdRelease charge 0 to 180 ticks then 6 release; partial 15 HP blockable with chip 5, full 25 HP U;
  // speed 24 m/s, life 120 ticks, 40 m, splash 2 m max 4, R60 F6 U3, reflectable (chargeProjectile, T19).
  defineAbility({
    id: "ea.b3", label: "Ember Orb", handler: "chargeProjectile", startup: 6, active: 1, recovery: 24, cooldown: 1500,
    damage100: [1500], range: 40, block: "B", input: "holdRelease", moveScale: 0.15, turnRate: 120,
    stunTicks: 0, ragdollTicks: 60, launch: { forward: 6, up: 3 }, targetStates: ["standing", "air", "ragdoll"],
    shape: { kind: "sphere", r: 0.35 },
    projectile: {
      speed: 24, lifeTicks: 120, maxRange: 40, radius: 0.35, splashRadius: 2, splashMax: 4, reflectable: true,
      arcAmplitude: 0.5, arcSpan: 20, chargeMaxTicks: 180, fullDamage100: 2500, chip100: 500,
    },
  }),
  // Furnace Drop: rises at +10 m/s through the 18 startup ticks, then descends at 18 m/s toward a point up to 8 m ahead
  // and detonates on the first ground contact inside the 48 active ticks (sphere r 4 around the caster, 20 HP, B,
  // chip 4, R84 F4 U10). Otherwise it expires into a normal fall without an explosion (handler).
  defineAbility({
    id: "ea.b4", label: "Furnace Drop", handler: "furnaceDrop", startup: 18, active: 48, recovery: 30, cooldown: 1020,
    damage100: [2000], range: 0, shape: { kind: "sphere", r: 4 }, block: "B", targetStates: ["standing", "air", "ragdoll"],
    stunTicks: 0, ragdollTicks: 84, launch: { forward: 4, up: 10 }, maxTargets: 4,
  }),
];
