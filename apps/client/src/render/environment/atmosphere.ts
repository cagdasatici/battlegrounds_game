/**
 * GFX01: atmosphere and lighting setup shared by every themed map: fog band, hemisphere + sun + rim lights, tone mapping and the
 * sun shadow settings, all driven by the theme and the quality profile. Only these helpers touch the renderer's tone mapping.
 */
import { ACESFilmicToneMapping, Color, DirectionalLight, Fog, HemisphereLight, NoToneMapping, type Scene } from "three";
import { normalizedSunDir, type EnvTheme } from "./theme.js";
import type { EnvQualityProfile } from "./quality.js";

export interface ToneMappable { toneMapping?: number; toneMappingExposure?: number }

export interface Lights { readonly hemi: HemisphereLight; readonly sun: DirectionalLight; readonly rim: DirectionalLight }

/** Creates the three lights from the theme. The sun position is re-aimed every frame by `aimSun`. */
export function createLights(theme: EnvTheme): Lights {
  const hemi = new HemisphereLight(theme.hemi.sky, theme.hemi.ground, theme.hemi.intensity);
  const sun = new DirectionalLight(theme.sun.color, theme.sun.intensity);
  const rim = new DirectionalLight(theme.rim.color, theme.rim.intensity);
  rim.position.set(...theme.rim.pos);
  const cam = sun.shadow.camera;
  cam.near = 5; cam.far = 160;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
  return { hemi, sun, rim };
}

/** Places the sun `dist` metres from `target` along the theme's sun direction (same vector the sky disc uses). */
export function aimSun(sun: DirectionalLight, theme: EnvTheme, tx: number, tz: number, dist = 70): void {
  const [x, y, z] = normalizedSunDir(theme);
  sun.target.position.set(tx, 0, tz);
  sun.position.set(tx + x * dist, y * dist, tz + z * dist);
  sun.target.updateMatrixWorld();
}

/** Applies a tier's shadow frustum, blur radius and map size. Returns true when the map size changed and the old map was released. */
export function applyShadowProfile(sun: DirectionalLight, p: EnvQualityProfile): boolean {
  const cam = sun.shadow.camera, h = p.shadowHalf;
  cam.left = -h; cam.right = h; cam.top = h; cam.bottom = -h; cam.updateProjectionMatrix();
  sun.shadow.radius = p.shadowRadius;
  const size = p.shadowMapSize || 1024;
  if (sun.shadow.mapSize.x === size) return false;
  sun.shadow.mapSize.set(size, size);
  sun.shadow.map?.dispose(); sun.shadow.map = null;
  return true;
}

/** Fog and tone mapping for a tier. Returns true when the tone mapping mode changed (materials then need recompiling). */
export function applyAtmosphere(scene: Scene, renderer: ToneMappable, theme: EnvTheme, p: EnvQualityProfile, far: number): boolean {
  const near = far * p.fogNear, end = far * p.fogFar;
  if (scene.fog instanceof Fog) { scene.fog.color.set(theme.sky.fog); scene.fog.near = near; scene.fog.far = end; }
  else scene.fog = new Fog(theme.sky.fog, near, end);
  scene.background = new Color(theme.sky.horizon);
  const want = p.toneMapping ? ACESFilmicToneMapping : NoToneMapping;
  const prev = renderer.toneMapping ?? NoToneMapping;
  renderer.toneMapping = want;
  renderer.toneMappingExposure = p.exposure;
  return prev !== want;
}
