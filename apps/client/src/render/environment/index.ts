/**
 * GFX01: the themed environment layer. Owns the instanced ground cover, procedural trees and ambient particles for one map, applies a quality
 * profile to all of them and tears everything down. A map picks its look with `getEnvTheme(map.themeId)`; the scene never needs to know which pieces exist.
 */
import { Group, type DataTexture, type PerspectiveCamera, type Scene } from "three";
import type { Collider } from "@eb/shared/config/arena";
import { AmbientParticles } from "./AmbientParticles.js";
import { SnowFall, type Sprites } from "./SnowFall.js";
import { GroundCover } from "./GroundCover.js";
import { TreeLayer } from "./Trees.js";
import { planTrees, type Islet } from "./treePlan.js";
import { QUALITY_PROFILES, type EnvQualityProfile } from "./quality.js";
import type { WearPoint } from "./groundShading.js";
import type { EnvTheme } from "./theme.js";

export { getEnvTheme, GROVE_THEME, COAST_THEME, FROST_THEME, type EnvTheme } from "./theme.js";
export { profileFor, QUALITY_PROFILES, pixelRatioForProfile, type EnvQualityProfile, type Quality } from "./quality.js";
export { createLights, aimSun, applyAtmosphere, applyShadowProfile } from "./atmosphere.js";
export { makeSkyMaterial } from "./sky.js";
export { groundHex, type WearPoint } from "./groundShading.js";
export { sceneryIslets, type Islet } from "./treePlan.js";

export class EnvironmentLayer {
  readonly group = new Group();
  private readonly cover: GroundCover;
  private readonly trees: TreeLayer;
  private readonly particles: Sprites;
  private readonly snow: boolean;
  private readonly coverScale: number;
  private readonly flowers: boolean;
  private disposed = false;

  constructor(scene: Scene, colliders: readonly Collider[], ramp: DataTexture, theme: EnvTheme, islets: readonly Islet[], wear: readonly WearPoint[]) {
    this.group.name = "deco.env";
    this.cover = new GroundCover(colliders, theme, wear, QUALITY_PROFILES.high);
    this.coverScale = theme.features?.coverScale ?? 1;
    this.flowers = theme.features?.flowers !== false;
    this.trees = new TreeLayer({ theme, ramp, placements: theme.features?.trees === false ? [] : planTrees(theme, colliders, islets) });
    this.snow = theme.features?.snow === true;
    this.particles = this.snow ? new SnowFall(theme, QUALITY_PROFILES.high.snow) : new AmbientParticles(theme, QUALITY_PROFILES.high.particles);
    this.group.add(this.cover.group, this.trees.group, this.particles.points);
    scene.add(this.group);
  }

  setProfile(p: EnvQualityProfile): void {
    // WORLD01: a sparse-cover theme (beach, snow) scales the instanced grass and flower pools down.
    this.cover.setProfile(this.coverScale === 1 ? p : { ...p, grass: Math.round(p.grass * this.coverScale), flowers: this.flowers ? Math.round(p.flowers * this.coverScale) : 0 });
    this.trees.setProfile(p.treeShare, p.sway);
    this.particles.setCount(this.snow ? p.snow : p.particles);
  }

  /** Reduced motion freezes wind and hides drifting particles. */
  setAnimated(on: boolean): void { this.cover.setAnimated(on); this.trees.setAnimated(on); this.particles.setAnimated(on); }

  /** `cx`, `cz` is the camera focus on the ground; the pools repeat around it. */
  update(dtSec: number, cx: number, cz: number, camera: PerspectiveCamera, viewportHeightPx: number): void {
    if (this.disposed) return;
    this.cover.update(dtSec, cx, cz);
    this.trees.update(dtSec);
    this.particles.update(dtSec, cx, cz, viewportHeightPx / (2 * Math.tan((camera.fov * Math.PI) / 360)));
  }

  /** Test hook: what is currently drawn. */
  get stats(): { grass: number; flowers: number; pebbles: number; trees: number; particles: number } {
    return { ...this.cover.counts, trees: this.trees.drawn, particles: this.particles.count };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cover.dispose(); this.trees.dispose(); this.particles.dispose();
    this.group.removeFromParent();
  }
}
