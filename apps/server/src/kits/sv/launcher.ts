import { meleeCandidates, type AbilityHandler } from "../../sim/AbilityRunner.js";

/**
 * sv.b4 Rising Pillar (spec 15). Default scheduled query on the definition shape (2 m box, yaw only):
 * supports standing, airborne and ragdolled targets; hit R84 F1 U11 (definition); a target captured by another
 * attacker is ineligible (queryTargets skips Captured fighters unless a handler opts in, and this one does not).
 *
 * - No extra landing damage: this handler never attaches a LandingBonusBook entry.
 * - Aerial use relies only on the authoritative capsule poses (attacker y vs target y); the pitch of the client
 *   camera is never an input to the server query.
 * - Animation playback speed is client presentation. The active tick comes from the definition ticks and the
 *   launch velocity from def.launch, so neither can depend on animation timing.
 */
export const LAUNCHER: AbilityHandler = { name: "launcher", candidates: meleeCandidates };
