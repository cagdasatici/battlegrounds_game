/**
 * GFX01: ground-cover density mask. A square top-down grid over the map (one byte per cell, 0 = bare, 255 = full cover) built from
 * the collider list. The grass shader samples it to decide where a clump may grow, so grass never appears over void, bridges,
 * cover blocks or the stone court, and thins out on dirt paths. Pure: no Three.js; unit tested.
 */
import type { Collider } from "@eb/shared/config/arena";
import { fbm } from "./noise.js";
import { dirtAmount, type WearPoint } from "./groundShading.js";

export interface CoverMask { readonly size: number; readonly min: number; readonly span: number; readonly data: Uint8Array }

const isGround = (c: Collider): boolean => c.role === "ground";

function insideGround(colliders: readonly Collider[], x: number, z: number, margin: number): boolean {
  for (const c of colliders) {
    if (!isGround(c)) continue;
    if (c.shape === "cuboid" ? Math.abs(x - c.centre[0]) <= c.halfExtents[0] - margin && Math.abs(z - c.centre[2]) <= c.halfExtents[2] - margin
      : Math.hypot(x - c.centre[0], z - c.centre[2]) <= c.radius - margin) return true;
  }
  return false;
}

function blocked(colliders: readonly Collider[], x: number, z: number): boolean {
  for (const c of colliders) {
    if (isGround(c) || c.shape !== "cuboid") continue;
    const m = c.role === "bridge" ? 0.35 : 0.6;
    if (Math.abs(x - c.centre[0]) <= c.halfExtents[0] + m && Math.abs(z - c.centre[2]) <= c.halfExtents[2] + m) return true;
  }
  return false;
}

/** Density in [0, 1] at a world point. */
export function coverDensity(colliders: readonly Collider[], x: number, z: number, wear: readonly WearPoint[] = []): number {
  if (!insideGround(colliders, x, z, 0.45) || blocked(colliders, x, z)) return 0;
  const r = Math.hypot(x, z);
  if (r < 8.9) return 0; // the stone court
  const dirt = dirtAmount(x, z, wear);
  const clump = 0.45 + 0.55 * fbm(x * 0.12 + 3, z * 0.12 - 8, 21);
  return Math.max(0, Math.min(1, clump * (1 - dirt * 0.92)));
}

/** Builds a square mask `size` cells wide covering [-half, half] on both axes. */
export function buildCoverMask(colliders: readonly Collider[], half: number, size = 384, wear: readonly WearPoint[] = []): CoverMask {
  const data = new Uint8Array(size * size), span = half * 2;
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const x = -half + ((i + 0.5) / size) * span, z = -half + ((j + 0.5) / size) * span;
    data[j * size + i] = Math.round(coverDensity(colliders, x, z, wear) * 255);
  }
  return { size, min: -half, span, data };
}

/** Samples a mask at a world point (nearest cell), 0..1. Used by CPU placement of rocks. */
export function sampleMask(m: CoverMask, x: number, z: number): number {
  const i = Math.floor(((x - m.min) / m.span) * m.size), j = Math.floor(((z - m.min) / m.span) * m.size);
  if (i < 0 || j < 0 || i >= m.size || j >= m.size) return 0;
  return m.data[j * m.size + i]! / 255;
}
