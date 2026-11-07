/**
 * CRATER01: pure sunken-crater ground profile shared by the server (authority), client prediction and the client mesh.
 * No DOM, Three.js or Node APIs. Rapier collision stays flat ("physical" space); a fighter's world height is its physical
 * height plus `groundHeightAt(x, z)` (<= 0), so a landing, a takeoff and a walk out of a bowl all follow the same function.
 */
import { CRATER, craterDepth } from "./config/beast.js";

/** A crater in metres. `startTick` + `tick` enable healing; omit both for a full-strength crater. */
export interface GroundCrater { x: number; z: number; radius: number; startTick?: number }

/** Full-strength pit depth (m) of a crater of the given radius: D band 1.2 to 1.8. */
export function craterPitDepth(radius: number): number {
  return Math.min(CRATER.depthMax, Math.max(CRATER.depthMin, CRATER.depthPerRadius * radius));
}

/** Bowl offset for one crater: -depth * (1 - (r/R)^2)^2, zero slope at the lip, 0 outside. */
export function craterOffset(x: number, z: number, c: GroundCrater, tick?: number): number {
  if (!(c.radius > 0)) return 0;
  const u = Math.hypot(x - c.x, z - c.z) / c.radius;
  if (!(u < 1)) return 0;
  const heal = tick !== undefined && c.startTick !== undefined ? craterDepth(tick, c.startTick) : 1;
  const w = 1 - u * u;
  return -craterPitDepth(c.radius) * heal * w * w;
}

/** Ground height offset (m, <= 0) at (x, z): the deepest overlapping crater wins (min), 0 outside every crater. */
export function groundHeightAt(x: number, z: number, craters: Iterable<GroundCrater>, tick?: number): number {
  let h = 0;
  for (const c of craters) h = Math.min(h, craterOffset(x, z, c, tick));
  return h;
}

/** Replicated crater record (centimetres, absolute server tick) to metres. */
export function groundCraterFromRecord(r: { x: number; z: number; radius100: number; startTick: number }): GroundCrater {
  return { x: r.x / 100, z: r.z / 100, radius: r.radius100 / 100, startTick: r.startTick };
}

export type GroundFn = (x: number, z: number) => number;

/** Horizontal travel multiplier for a move that climbs; 1 when level or descending. */
export function climbScale(ground: GroundFn, x: number, z: number, dx: number, dz: number): number {
  const run = Math.hypot(dx, dz);
  if (!(run > 1e-9)) return 1;
  const slope = (ground(x + dx, z + dz) - ground(x, z)) / run;
  return slope > 0 ? Math.max(CRATER.climbMinScale, 1 - CRATER.climbSlow * slope) : 1;
}

/**
 * Wraps a flat-world collide query so it runs on a ground-following body. `pos` and the result are WORLD space; `inner`
 * works in physical (flat) space. Used by client prediction; the server MovementSystem applies the same two steps.
 */
export function groundCollide<R extends { corrected: { x: number; y: number; z: number } }>(
  ground: GroundFn, pos: { x: number; y: number; z: number }, desired: { x: number; y: number; z: number },
  inner: (physPos: { x: number; y: number; z: number }, desired: { x: number; y: number; z: number }) => R,
): R {
  const g0 = ground(pos.x, pos.z);
  const s = climbScale(ground, pos.x, pos.z, desired.x, desired.z);
  const r = inner({ x: pos.x, y: pos.y - g0, z: pos.z }, { x: desired.x * s, y: desired.y, z: desired.z * s });
  const g1 = ground(pos.x + r.corrected.x, pos.z + r.corrected.z);
  return { ...r, corrected: { x: r.corrected.x, y: r.corrected.y + (g1 - g0), z: r.corrected.z } };
}
