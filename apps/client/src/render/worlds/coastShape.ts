/**
 * WORLD01: pure shape of the Sunreach Coast ground outside the collision slab. Inside the slab the ground is exactly flat (y = 0), because
 * Rapier, client prediction and CRATER01 craters all assume that. Outside it the beach slopes down into the sea on the south, east and
 * west sides and rises into rolling dunes behind the north edge (a visual backdrop; the boundary walls keep fighters on the slab).
 * No Three.js here, so a unit test can pin the rules.
 */
import { fbm, valueNoise } from "../environment/noise.js";
import { clamp01, outsideRect, smoothstep } from "./common.js";

/** Still-water level (m). The sand edge is at y = 0, so the waterline sits `-COAST_WATER_Y / COAST_SEA_SLOPE` metres outside the slab. */
export const COAST_WATER_Y = -0.55;
/** Metres of drop per metre outside the slab, down to `COAST_SEA_FLOOR`. */
export const COAST_SEA_SLOPE = 0.2;
export const COAST_SEA_FLOOR = -2.6;
export const COAST_WAVE_AMPLITUDE = 0.11;

export interface CoastDims { readonly halfX: number; readonly halfZ: number }

/** Terrain height of the sea side only (what the water shader assumes when it estimates depth). */
export const seaBedHeight = (d: number): number => -Math.min(d * COAST_SEA_SLOPE, -COAST_SEA_FLOOR);

/** Ground height at (x, z). 0 on the slab; negative (sea bed) on the south/east/west sides; positive dunes to the north. */
export function coastHeight(x: number, z: number, s: CoastDims): number {
  const d = outsideRect(x, z, s.halfX, s.halfZ);
  if (d <= 0) return 0;
  const sea = seaBedHeight(d);
  const north = smoothstep(0, 1, clamp01((-z - (s.halfZ - 8)) / 14));
  if (north <= 0) return sea;
  const rise = smoothstep(0, 16, d) * 2.4;
  const ridge = smoothstep(10, 46, d) * (5 + 6 * fbm(x * 0.022 + 3, z * 0.022 - 5, 4));
  const rolls = (valueNoise(x * 0.09, z * 0.09, 8) - 0.5) * 1.6 * smoothstep(4, 20, d);
  let dune = rise + ridge + rolls;
  // The dune land ends in the sea far to the sides and far behind, hidden by the haze.
  const keep = (1 - smoothstep(s.halfX + 18, s.halfX + 58, Math.abs(x))) * (1 - smoothstep(s.halfZ + 110, s.halfZ + 148, -z));
  dune = dune * keep + COAST_SEA_FLOOR * (1 - keep);
  return sea + (dune - sea) * north;
}

/** True when the ground at (x, z) is below the still water level (so the sea covers it). */
export const underWater = (x: number, z: number, s: CoastDims): boolean => coastHeight(x, z, s) < COAST_WATER_Y;
