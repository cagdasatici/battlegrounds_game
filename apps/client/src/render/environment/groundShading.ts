/**
 * GFX01: pure ground colouring for the walkable meadow tops. Replaces the old two-sine blend with layered noise (broad light and dark
 * meadow, shaded clumps, sun-dried streaks, flower meadow tint), meandering dirt paths from the stone court to each bridge,
 * a worn ring around the court and trampled pads around cover and spawn decks. Deterministic, no Three.js.
 */
import type { Collider } from "@eb/shared/config/arena";
import { mixHex } from "../../scene/EnvPalette.js";
import { fbm, valueNoise } from "./noise.js";
import type { EnvTheme } from "./theme.js";

/** x, z, radius of a trampled pad (cover bases, spawn decks). */
export type WearPoint = readonly [number, number, number];

const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));
const sstep = (a: number, b: number, t: number): number => { const k = clamp01((t - a) / (b - a)); return k * k * (3 - 2 * k); };

/** Distance to the two meandering route axes (the paths leave the court along the world axes towards the four bridges). */
export function routeDistance(x: number, z: number): number {
  const dz = Math.abs(x - 0.9 * Math.sin(z * 0.1 + 0.4)), dx = Math.abs(z - 0.9 * Math.sin(x * 0.1 + 2.1));
  return Math.min(dz, dx);
}

/** Dirt coverage in [0, 1] at a ground point. Exported so ground cover can thin out on the paths. */
export function dirtAmount(x: number, z: number, wear: readonly WearPoint[]): number {
  const r = Math.hypot(x, z);
  const route = routeDistance(x, z);
  const grain = 0.6 + 0.4 * valueNoise(x * 0.8, z * 0.8, 9);
  const path = Math.exp(-(route * route) / 2.6) * sstep(8.4, 12, r) * grain;
  const ring = Math.exp(-(((r - 10.2) / 0.9) ** 2)) * 0.45 * grain;
  let pads = 0;
  for (const [wx, wz, wr] of wear) {
    const d = Math.hypot(x - wx, z - wz) / wr;
    if (d < 1.6) pads = Math.max(pads, (1 - sstep(0.4, 1.6, d)) * 0.75 * grain);
  }
  return clamp01(Math.max(path * 0.85, ring, pads));
}

/** Meadow colour at a ground point (sRGB hex). */
export function groundHex(theme: EnvTheme, x: number, z: number, wear: readonly WearPoint[] = []): number {
  const g = theme.ground;
  const broad = fbm(x * 0.04, z * 0.04, 3), mid = fbm(x * 0.15, z * 0.15, 5), fine = valueNoise(x * 0.7, z * 0.7, 7);
  let c = mixHex(g.grassA, g.grassB, sstep(0.28, 0.72, broad * 0.6 + mid * 0.4));
  c = mixHex(c, g.patchDark, clamp01((0.4 - mid) * 3) * 0.5);
  c = mixHex(c, g.grassDry, clamp01((broad - 0.6) * 4) * 0.55);
  c = mixHex(c, g.meadow, sstep(0.62, 0.78, fbm(x * 0.085 + 40, z * 0.085 - 12, 11)) * 0.55);
  c = mixHex(c, g.patchDark, (fine - 0.5) * 0.18 + 0.05);
  return mixHex(c, g.dirt, dirtAmount(x, z, wear));
}

/** Trampled pads: one around every obstacle collider (cover blocks, walls) and one per spawn anchor. */
export function wearPointsFor(colliders: readonly Collider[], spawns: ReadonlyArray<readonly [number, number, number]>): WearPoint[] {
  const out: WearPoint[] = [];
  for (const c of colliders) if (c.role === "obstacle" && c.shape === "cuboid") out.push([c.centre[0], c.centre[2], Math.max(c.halfExtents[0], c.halfExtents[2]) + 1.4]);
  for (const s of spawns) out.push([s[0], s[2], 2.6]);
  return out;
}
