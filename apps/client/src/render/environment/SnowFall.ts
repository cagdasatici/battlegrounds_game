/**
 * WORLD02: falling snow. One Points object like AmbientParticles: every flake position is computed in the vertex shader from a fixed
 * seed, the clock and the camera focus (a repeating window that follows the action), so the pool costs no CPU per frame. Flakes fall,
 * drift on a slow wind and fade at the window edge, the ground and the top. The count comes from the quality tier (`EnvQualityProfile.snow`).
 */
import { BufferGeometry, Color, Float32BufferAttribute, NormalBlending, Points, ShaderMaterial, Vector2 } from "three";
import { mulberry32 } from "../../scene/EnvPalette.js";
import type { EnvTheme } from "./theme.js";

/** What the environment layer needs from a particle layer (pollen or snow). */
export interface Sprites {
  readonly points: Points<BufferGeometry, ShaderMaterial>;
  setCount(n: number): void;
  setAnimated(on: boolean): void;
  readonly count: number;
  update(dtSec: number, cx: number, cz: number, pixelScale: number): void;
  dispose(): void;
}

const WINDOW = 56, HEIGHT = 22;

const VERT = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime; uniform vec2 uCenter; uniform float uWindow; uniform float uPixel; uniform float uHeight;
varying float vA;
void main() {
  float T = uWindow;
  float ph = aSeed.z * 40.0 + aSeed.w * 70.0;
  float speed = 1.1 + aSeed.w * 1.5;
  float fall = mod(aSeed.z * uHeight - uTime * speed, uHeight);
  vec2 cell = aSeed.xy + vec2(uTime * 0.55, uTime * 0.18);
  vec2 w = cell + T * floor((uCenter - cell) / T + 0.5);
  vec2 sway = vec2(sin(uTime * 0.7 + ph), cos(uTime * 0.55 + ph * 1.3)) * (0.5 + aSeed.w * 0.7);
  vec4 mv = modelViewMatrix * vec4(w.x + sway.x, fall, w.y + sway.y, 1.0);
  gl_Position = projectionMatrix * mv;
  float edge = 1.0 - smoothstep(0.36 * T, 0.5 * T, length(w - uCenter));
  vA = edge * smoothstep(0.0, 0.6, fall) * smoothstep(0.0, 2.0, uHeight - fall) * (0.6 + 0.4 * aSeed.w);
  gl_PointSize = clamp((0.07 + 0.1 * aSeed.w) * uPixel / max(0.1, -mv.z), 1.5, 14.0);
}`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.15, d);
  gl_FragColor = vec4(uColor, a * vA);
  #include <colorspace_fragment>
}`;

export class SnowFall implements Sprites {
  readonly points: Points<BufferGeometry, ShaderMaterial>;
  private time = 0;
  private animate = true;

  constructor(theme: EnvTheme, max: number) {
    const r = mulberry32(0x5a0f), seed = new Float32Array(max * 4);
    for (let i = 0; i < max; i++) { seed[i * 4] = r() * WINDOW; seed[i * 4 + 1] = r() * WINDOW; seed[i * 4 + 2] = r(); seed[i * 4 + 3] = r(); }
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(new Float32Array(max * 3), 3));
    g.setAttribute("aSeed", new Float32BufferAttribute(seed, 4));
    const m = new ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: NormalBlending, fog: false,
      uniforms: { uTime: { value: 0 }, uCenter: { value: new Vector2() }, uWindow: { value: WINDOW }, uPixel: { value: 700 }, uHeight: { value: HEIGHT }, uColor: { value: new Color(theme.particles.pollen) } },
    });
    this.points = new Points(g, m);
    this.points.name = "deco.ambient";
    this.points.frustumCulled = false; this.points.renderOrder = 5;
    g.setDrawRange(0, 0);
  }

  setCount(n: number): void { this.points.geometry.setDrawRange(0, n); this.points.visible = n > 0; }
  /** Reduced motion freezes the clock; the flakes stay as a still veil (cheaper than hiding the weather of the map). */
  setAnimated(on: boolean): void { this.animate = on; }
  get count(): number { return this.points.geometry.drawRange.count; }

  update(dtSec: number, cx: number, cz: number, pixelScale: number): void {
    if (this.animate) this.time += dtSec;
    const u = this.points.material.uniforms as { uTime: { value: number }; uCenter: { value: Vector2 }; uPixel: { value: number } };
    u.uTime.value = this.time; u.uCenter.value.set(cx, cz); u.uPixel.value = pixelScale;
  }

  dispose(): void { this.points.geometry.dispose(); this.points.material.dispose(); this.points.removeFromParent(); }
}
