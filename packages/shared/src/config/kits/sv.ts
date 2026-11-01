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
  // turnRate 90 deg/s is recorded here; enforced by AbilityRunner and Movement (R07).
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
  // Skybreak (T15): grounded, invulnerable commit..last active tick, box 20 x 8 x 24 queried at activeStart, max 4, 100 HP, R120 F4 U20.
  defineAbility({
    id: "sv.a2", label: "Skybreak", handler: "groundWave", startup: 90, active: 6, recovery: 45, cooldown: 0,
    damage100: [10000], range: 24, shape: { kind: "box", w: 20, h: 8, d: 24 }, block: "U", counterable: false, armorBreak: true,
    stunTicks: 0, ragdollTicks: 120, launch: { forward: 4, up: 20 }, maxTargets: 4, oncePerForm: true, consumesForm: true,
  }),
  // Horizon Break (T15): grounded, same invulnerability, beam 32 m radius 3 truncated at the first obstacle, near (<= 8 m) 100 HP, far 60 HP (handler).
  defineAbility({
    id: "sv.a3", label: "Horizon Break", handler: "longBeam", startup: 72, active: 6, recovery: 42, cooldown: 0,
    damage100: [10000], range: 32, shape: { kind: "beam", length: 32, radius: 3 }, block: "U", counterable: false, armorBreak: true,
    stunTicks: 0, ragdollTicks: 90, launch: { forward: 22, up: 5 }, maxTargets: 4, oncePerForm: true, consumesForm: true,
  }),
  // Orbit Collapse (T15): cinematic grab, 3 m default box, capture at an active tick, 100 HP at capture + 90, release at +96 with R90 F6 U10.
  // The capture hit (index 0) deals no damage; the handler overrides the release offset to 96 (last hit offset + 1 would be 91).
  defineAbility({
    id: "sv.a4", label: "Orbit Collapse", handler: "cinematicGrab", startup: 24, active: 6, recovery: 36, cooldown: 0,
    hitOffsets: [0, 90], damage100: [0, 10000], range: 3, block: "U", counterable: false, armorBreak: true,
    stunTicks: 0, ragdollTicks: 90, launch: { forward: 6, up: 10 }, oncePerForm: true, consumesForm: true,
  }),
  // P1 contextual attacks (T23, spec 15). Awakened Vanguard only, one shared use bit (Fighter.contextSpent).
  // Echo Tap: grounded fourth M1 with jumpHeld, 24 HP, box 2 x 2 x 2, U, R84 F14 U6, counterable.
  defineAbility({
    id: "sv.x1", label: "Echo Tap", handler: "melee", startup: 12, active: 4, recovery: 30, cooldown: 0,
    damage100: [2400], range: 2, block: "U", input: "context", stunTicks: 0, ragdollTicks: 84, launch: { forward: 14, up: 6 },
  }),
  // Gale Rebuff: wall capture (window 3, capture cap 60), 40 HP at capture + 48, U, release R90 F18 U3. The capture hit
  // deals nothing and is counterable; the scheduled hit is not. Cinematic: third parties cannot hit either participant.
  defineAbility({
    id: "sv.x2", label: "Gale Rebuff", handler: "galeRebuff", startup: 12, active: 3, recovery: 24, cooldown: 0,
    hitOffsets: [0, 48], damage100: [0, 4000], range: 2, block: "U", input: "context", stunTicks: 0, ragdollTicks: 90,
    launch: { forward: 18, up: 3 },
  }),
];
