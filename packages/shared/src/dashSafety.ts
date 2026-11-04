import { COMBAT } from "./config/combat.js";

/** FB07 D values. See docs/decisions/fb-FB07.md. */
export const DASH_SAFETY = {
  /** Path sample spacing (m). Footprint ring radius is the capsule radius, so gaps wider than ~0.3 m are caught. */
  step: 0.2,
  /** Stop this far short of the last sampled point that still has ground under the full footprint (m). */
  margin: 0.5,
  /** A sample whose ground is lower than the start ground by more than this counts as a fall (m). */
  maxDrop: 1.0,
  /** Measured ground coast after a full dash (m, FB07 test: 7.57 total vs 6.6 dash); reserved beyond the dash end. */
  coast: 1.0,
  ringPoints: 8,
} as const;

/** Height of the walkable surface at (x, z), or null over the void. Server passes World.walkableTop. */
export type GroundProbe = (x: number, z: number) => number | null;

function footprintGrounded(probe: GroundProbe, x: number, z: number, minTop: number): boolean {
  const c = probe(x, z);
  if (c === null || c < minTop) return false;
  const r = COMBAT.capsule.radius, n = DASH_SAFETY.ringPoints;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const t = probe(x + Math.cos(a) * r, z + Math.sin(a) * r);
    if (t === null || t < minTop) return false;
  }
  return true;
}

/**
 * Pure, deterministic travel clamp for a displacing move (movement dash, Vent Rush). Samples the path every `step` m and
 * returns the distance (0..fullDist) to travel: reserves `coast` after the dash and stops `margin` short of the first sample without ground under the whole
 * capsule footprint. A start already unsafe returns 0. Open ground returns fullDist unchanged.
 */
export function safeTravelDistance(probe: GroundProbe, x: number, z: number, dirX: number, dirZ: number, fullDist: number): number {
  if (!(fullDist > 0) || !Number.isFinite(fullDist)) return 0;
  const len = Math.hypot(dirX, dirZ);
  if (!(len > 1e-9)) return 0;
  const ux = dirX / len, uz = dirZ / len;
  const startTop = probe(x, z);
  if (startTop === null) return fullDist; // body is not on mapped ground (airborne/launched): never interfere
  const minTop = startTop - DASH_SAFETY.maxDrop;
  const reach = fullDist + DASH_SAFETY.coast + DASH_SAFETY.margin;
  const steps = Math.ceil(reach / DASH_SAFETY.step);
  let lastGood = 0;
  for (let i = 1; i <= steps; i++) {
    const d = Math.min(reach, i * DASH_SAFETY.step);
    if (!footprintGrounded(probe, x + ux * d, z + uz * d, minTop)) {
      return Math.max(0, Math.min(fullDist, lastGood - DASH_SAFETY.coast - DASH_SAFETY.margin));
    }
    lastGood = d;
  }
  return fullDist;
}
