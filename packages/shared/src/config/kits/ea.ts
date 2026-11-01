import { defineAbility, type AbilityDef } from "../../abilities.js";

/**
 * Ember Artificer base definitions (spec section 15, T20). Every number is D (local design value) taken from the
 * spec 15 table; damage is hundredths of HP. Handler names are implemented in apps/server/src/kits/ea.
 * T21 adds the awakened four (ea.a1 to ea.a4); the activation ea.activate is configured in the Awakening system.
 * Decision records: docs/decisions/0014-t20-artificer-base-rules.md, docs/decisions/0022-t21-artificer-awakening-rules.md.
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

  // Arc Descent (T21): startup armor, advances 0.4 m per active tick (24 m/s, 7.2 m swept reach 8 m), probe sweeps the path.
  // Capture is cinematic: 15 HP at capture, 25 at +36, release +42 R84 F5 U8 (handler data). A missed probe enters a 30 tick
  // vulnerable blast windup, then explodes (radius 5, 20 HP, U, noncounterable, R60 F5 U5); an interrupted windup emits one
  // radius 2 blast for 13 HP; a death emits none. The initial capture hit is counterable.
  defineAbility({
    id: "ea.a1", label: "Arc Descent", handler: "arcDescent", startup: 30, active: 18, recovery: 30, cooldown: 900,
    hitOffsets: [0, 36], damage100: [1500, 2500], range: 8, block: "U", armor: "startup",
    targetStates: ["standing", "air", "ragdoll"], stunTicks: 0, ragdollTicks: 84, launch: { forward: 5, up: 8 }, maxTargets: 4,
  }),
  // Comet Lock (T21): startup vulnerable, dash 40 m/s for up to 24 active ticks (16 m), caster invulnerable through dash and
  // capture. Capture of any state (branch fixed at capture), 0 at capture, branch damage at +54 (50 standing, 30 ragdoll), splash
  // 20 (chip 5, R72 F5 U6, victim excluded, 4 m) at +54, release +60 R90 F3 U8. Noncounterable.
  defineAbility({
    id: "ea.a2", label: "Comet Lock", handler: "cometLock", startup: 20, active: 24, recovery: 36, cooldown: 1200,
    hitOffsets: [0, 54], damage100: [0, 5000], range: 16, block: "U", counterable: false,
    targetStates: ["standing", "air", "ragdoll"], stunTicks: 0, ragdollTicks: 90, launch: { forward: 3, up: 8 }, maxTargets: 4,
  }),
  // Furnace Ray (T21): seven pulses at activeStart+[0,15,30,45,60,75,89], 5 HP each (35 cap per target), beam 24 m radius 1,
  // clipped at cover, B with chip 1, stun 18 and 1 m/s push, armor after the first confirmed damage through active end,
  // turnRate 30, movement zero, vertical velocity zero, max 4 targets.
  defineAbility({
    id: "ea.a3", label: "Furnace Ray", handler: "furnaceRay", startup: 30, active: 90, recovery: 30, cooldown: 1500,
    hitOffsets: [0, 15, 30, 45, 60, 75, 89], damage100: [500, 500, 500, 500, 500, 500, 500], range: 24,
    shape: { kind: "beam", length: 24, radius: 1 }, block: "B", armor: "onHit",
    targetStates: ["standing", "air", "ragdoll"], stunTicks: 18, ragdollTicks: 0, launch: { forward: 1, up: 0 },
    moveScale: 0, turnRate: 30, maxTargets: 4,
  }),
  // Solar Vent (T21): ten pulses at activeStart+[0,20,...,160,179], 7 HP within 10 m else 3 (70 cap per target), beam 36 m
  // radius 3 clipped at cover, U, counterable, no armor, stun 24 and 2 m/s push, turnRate 15, vertical velocity zero. Once per
  // form: a miss or interruption spends the use (framework oncePerForm at commit).
  defineAbility({
    id: "ea.a4", label: "Solar Vent", handler: "solarVent", startup: 72, active: 180, recovery: 48, cooldown: 0,
    hitOffsets: [0, 20, 40, 60, 80, 100, 120, 140, 160, 179], damage100: [700, 700, 700, 700, 700, 700, 700, 700, 700, 700],
    range: 36, shape: { kind: "beam", length: 36, radius: 3 }, block: "U",
    targetStates: ["standing", "air", "ragdoll"], stunTicks: 24, ragdollTicks: 0, launch: { forward: 2, up: 0 },
    moveScale: 0, turnRate: 15, oncePerForm: true, maxTargets: 4,
  }),
];
