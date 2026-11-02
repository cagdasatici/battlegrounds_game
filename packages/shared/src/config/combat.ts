/**
 * Generic on-hit freeze switch (owner requirement, decision 0049). When enabled is false, universal hits (M1 hits 1-3,
 * forward dash attack) apply no Stunned lock and the client plays no hit-stop. Ability specific stunTicks and ragdolls are
 * unaffected. Kept as a mutable object so tests can run the legacy behavior; production code never writes it.
 */
export const HIT_STUN: { enabled: boolean } = { enabled: false };

/** Universal movement and combat values. Every number here is D (local design value), spec section 11. */
export const COMBAT = {
  hp: 100,
  hp100Max: 10000,
  movement: {
    walk: 7,
    run: 11,
    guard: 3,
    acceleration: 70,
    airControl: 0.3,
    gravity: -24,
  },
  capsule: { radius: 0.35, halfHeight: 0.55, height: 1.8, jumpSpeed: 8, coyoteTicks: 6, jumpBufferTicks: 6 },
  controller: { offset: 0.02, stepHeight: 0.3, minStepWidth: 0.2, maxSlopeDeg: 45, snapDown: 0.2 },
  m1: {
    damage: [3, 3, 4, 4] as const,
    startup: 8,
    active: 3,
    recovery: 10,
    finalRecovery: 30,
    chainResetGap: 54,
    box: { width: 1.5, height: 1.7, depth: 1.8, frontFace: 2.1 },
    stunTicks: 24,
    finisherRagdollTicks: 72,
    finisherLaunch: { forward: 8, up: 3 },
    miniUppercut: { damage: 4, up: 10, ragdollTicks: 72 },
    downslam: { damage: 4, down: 16, landingRadius: 1.5 },
  },
  dash: {
    forward: { ticks: 18, speed: 22, hitTicks: 3, damage: 4, stunTicks: 24, cooldown: 300 },
    side: { ticks: 12, speed: 24, cooldown: 120 },
    back: { ticks: 18, speed: 18, cooldown: 240 },
  },
  evasive: { minRagdollAge: 12, ticks: 12, speed: 20, invulnerableTicks: 8, cooldown: 1800 },
  guard: { coneDeg: 120, startup: 3, recovery: 3, blockstun: 6 },
  autoRun: { enterMagnitude: 0.9, enterTicks: 6, exitMagnitude: 0.75, doubleTapTicks: 18, cancelBelow: 0.2 },
  spawnProtectionTicks: 120,
  respawnTicks: 180,
  assistWindowTicks: 480,
  assistMinDamage: 20,
  inputLeaseTicks: 15,
  bufferTicks: 6,
  meter: { svRequired100: 20000, otherRequired100: 35000 },
  /** T23 urn rules (spec 10, 15). D values. Pickup channel, reach and stick limit are spec 15 numbers. */
  props: { pickupTicks: 12, pickupRadius: 1.2, pickupStickMax: 0.1, returnTicks: 600, throwRecovery: 20 },
  /** T23 wall opportunity (spec 13): enemy within 0.6 m of a vertical static collider, attacker within 2 m. */
  wall: { targetGap: 0.6, attackerReach: 2, maxNormalYDeg: 15 },
} as const;

export type CombatConfig = typeof COMBAT;
