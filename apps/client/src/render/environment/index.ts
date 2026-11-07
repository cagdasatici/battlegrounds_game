/**
 * GFX01: the themed environment layer. Owns the instanced ground cover, procedural trees and ambient particles for one map, applies a quality
 * profile to all of them and tears everything down. A map picks its look with `getEnvTheme(map.themeId)`; the scene never needs to know which pieces exist.
 */
import { Group, type DataTexture, type PerspectiveCamera, type Scene } from "three";
import type { Collider } from "@eb/shared/config/arena";
import { AmbientParticles } from "./AmbientParticles.js";
import { GroundCover } from "./GroundCover.js";
import { TreeLayer } from "./Trees.js";
import { planTrees, type Islet } from "./treePlan.js";
import { QUALITY_PROFILES, type EnvQualityProfile } from "./quality.js";
import type { WearPoint } from "./groundShading.js";
import type { EnvTheme } from "./theme.js";

export { getEnvTheme, GROVE_THEME, type EnvTheme } from "./theme.js";
export { profileFor, QUALITY_PROFILES, pixelRatioForProfile, type EnvQualityProfile, type Quality } from "./quality.js";
export { createLights, aimSun, applyAtmosphere, applyShadowProfile } from "./atmosphere.js";
export { makeSkyMaterial } from "./sky.js";
export { groundHex, type WearPoint } from "./groundShading.js";
export { sceneryIslets, type Islet } from "./treePlan.js";

export class EnvironmentLayer {
  readonly group = new Group();
  private readonly cover: GroundCover;
  private readonly trees: TreeLayer;
  private readonly particles: AmbientParticles;
  private disposed = false;

  constructor(scene: Scene, colliders: readonly Collider[], ramp: DataTexture, theme: EnvTheme, islets: readonly Islet[], wear: readonly WearPoint[]) {
    this.group.name = "deco.env";
    this.cover = new GroundCover(colliders, theme, wear, QUALITY_PROFILES.high);
    this.trees = new TreeLayer({ theme, ramp, placements: planTrees(theme, colliders, islets) });
    this.particles = new AmbientParticles(theme, QUALITY_PROFILES.high.particles);
    this.group.add(this.cover.group, this.trees.group, this.particles.points);
    scene.add(this.group);
  }

  setProfile(p: EnvQualityProfile): void {
    this.cover.setProfile(p);
    this.trees.setProfile(p.treeShare, p.sway);
    this.particles.setCount(p.particles);
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
