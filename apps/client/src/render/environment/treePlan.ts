/**
 * GFX01: pure placement of procedural trees and distant scenery islets. Deterministic (seeded), no Three.js, so a unit test can pin
 * the rules: no trunk or crown over walkable ground, no tree in front of a bridge mouth, every tree sits on an islet or a rock ledge.
 */
import type { Collider } from "@eb/shared/config/arena";
import { mulberry32 } from "../../scene/EnvPalette.js";
import type { EnvTheme } from "./theme.js";

export type TreeSpecies = "oak" | "pine" | "birch" | "bush";
export interface TreePlacement {
  readonly species: TreeSpecies; readonly x: number; readonly y: number; readonly z: number;
  readonly yaw: number; readonly scale: number; readonly tint: number;
  /** Rock ledge radius under a rim tree; absent for trees standing on an islet top. */
  readonly ledge?: { readonly r: number };
}
/** [x, topY, z, radius] */
export type Islet = readonly [number, number, number, number];

/** Extra distant islets (D): a ring beyond the six original ones, spaced so none overlap each other or an original islet. */
export function sceneryIslets(scale: number, original: readonly Islet[]): Islet[] {
  const rnd = mulberry32(0x5ce7e), out: Islet[] = [];
  const all = (): readonly Islet[] => [...original, ...out];
  for (let i = 0, tries = 0; out.length < 12 && tries < 400; tries++, i++) {
    const a = (out.length / 12) * Math.PI * 2 + (rnd() - 0.5) * 0.4, rad = (92 + rnd() * 56) * scale;
    const cand: Islet = [Math.cos(a) * rad, -34 + rnd() * 50, Math.sin(a) * rad, 7 + rnd() * 8];
    if (all().every((o) => Math.hypot(o[0] - cand[0], o[2] - cand[2]) > o[3] + cand[3] + 16)) out.push(cand);
  }
  return out;
}

const pickSpecies = (theme: EnvTheme, r: number): TreeSpecies => {
  const [oak, pine] = theme.trees.mix;
  return r < oak ? "oak" : r < oak + pine ? "pine" : "birch";
};

/** Shortest horizontal distance from a point to the walkable footprints (0 inside). */
export function groundGap(colliders: readonly Collider[], x: number, z: number): number {
  let gap = Infinity;
  for (const c of colliders) {
    if (c.role !== "ground") continue;
    const d = c.shape === "cuboid"
      ? Math.hypot(Math.max(0, Math.abs(x - c.centre[0]) - c.halfExtents[0]), Math.max(0, Math.abs(z - c.centre[2]) - c.halfExtents[2]))
      : Math.max(0, Math.hypot(x - c.centre[0], z - c.centre[2]) - c.radius);
    gap = Math.min(gap, d);
  }
  return gap;
}

const nearBridge = (colliders: readonly Collider[], x: number, z: number, m: number): boolean =>
  colliders.some((c) => c.role === "bridge" && c.shape === "cuboid" && Math.abs(x - c.centre[0]) < c.halfExtents[0] + m && Math.abs(z - c.centre[2]) < c.halfExtents[2] + m);

/** Crown radius in metres at scale 1; used for the walkable-ground clearance rule. */
export const CROWN_RADIUS: Readonly<Record<TreeSpecies, number>> = { oak: 1.9, pine: 1.9, birch: 1.2, bush: 1.1 };

export function planTrees(theme: EnvTheme, colliders: readonly Collider[], islets: readonly Islet[]): TreePlacement[] {
  const rnd = mulberry32(0x7ee5), out: TreePlacement[] = [];
  const tint = (): number => Math.floor(rnd() * theme.trees.tints.length);
  // 1. Islet clusters: spaced picks inside each disc.
  for (const [x, y, z, r] of islets) {
    const n = 3 + Math.floor(r / 2.6), spots: Array<[number, number]> = [];
    for (let t = 0; spots.length < n && t < 60; t++) {
      const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * r * 0.78;
      const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      if (spots.every(([sx, sz]) => Math.hypot(sx - px, sz - pz) > 2.6)) spots.push([px, pz]);
    }
    for (const [px, pz] of spots) {
      const bush = rnd() < 0.18, species = bush ? "bush" : pickSpecies(theme, rnd());
      out.push({ species, x: px, y, z: pz, yaw: rnd() * 6.28, scale: (bush ? 1.1 : 1.0) * (0.85 + rnd() * 0.7), tint: tint() });
    }
  }
  // 2. Rim trees on rock ledges outside the walkable footprint, away from bridge mouths and other islands.
  const OFFSET = 3.6;
  for (const c of colliders) {
    if (c.role !== "ground" || c.shape !== "cuboid") continue;
    const [hx, , hz] = c.halfExtents;
    const per = 4 * (hx + hz), step = 9.5, n = Math.floor(per / step);
    for (let k = 0; k < n; k++) {
      const u = ((k + 0.25 + rnd() * 0.5) / n) * per;
      let px: number, pz: number;
      if (u < 2 * hx) { px = c.centre[0] - hx + u; pz = c.centre[2] - hz - OFFSET; }
      else if (u < 2 * hx + 2 * hz) { px = c.centre[0] + hx + OFFSET; pz = c.centre[2] - hz + (u - 2 * hx); }
      else if (u < 4 * hx + 2 * hz) { px = c.centre[0] + hx - (u - 2 * hx - 2 * hz); pz = c.centre[2] + hz + OFFSET; }
      else { px = c.centre[0] - hx - OFFSET; pz = c.centre[2] + hz - (u - 4 * hx - 2 * hz); }
      if (groundGap(colliders, px, pz) < 3.2 || nearBridge(colliders, px, pz, 8)) continue;
      const bush = rnd() < 0.3, species = bush ? "bush" : pickSpecies(theme, rnd());
      const scale = (bush ? 1.3 : 1.15) * (0.85 + rnd() * 0.6);
      out.push({ species, x: px, y: -0.3, z: pz, yaw: rnd() * 6.28, scale, tint: tint(), ledge: { r: 3 + rnd() * 0.6 } });
    }
  }
  // Interleave deterministically so a share of the list is a uniform thinning.
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [out[i], out[j]] = [out[j]!, out[i]!]; }
  return out;
}
