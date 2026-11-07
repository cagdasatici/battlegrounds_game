/**
 * GFX01: ambient pollen and fireflies. One Points object; every position is computed in the vertex shader from a fixed seed, the clock
 * and the camera focus (repeating window, so the pool always surrounds the action). Soft additive discs, no CPU work per frame.
 */
import { AdditiveBlending, BufferGeometry, Color, Float32BufferAttribute, Points, ShaderMaterial, Vector2 } from "three";
import { mulberry32 } from "../../scene/EnvPalette.js";
import type { EnvTheme } from "./theme.js";

const WINDOW = 64;

const VERT = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime; uniform vec2 uCenter; uniform float uWindow; uniform float uPixel; uniform float uShare;
uniform vec3 uPollen; uniform vec3 uFirefly;
varying vec3 vCol; varying float vA;
void main() {
  float T = uWindow;
  bool fire = aSeed.w < uShare;
  vec2 cell = aSeed.xy + vec2(uTime * 0.35, uTime * 0.12);
  vec2 w = cell + T * floor((uCenter - cell) / T + 0.5);
  float ph = aSeed.z * 40.0 + aSeed.w * 70.0;
  vec2 wob = vec2(sin(uTime * 0.31 + ph), cos(uTime * 0.27 + ph * 1.3)) * (fire ? 1.6 : 0.9);
  float y = 0.5 + aSeed.z * (fire ? 3.2 : 6.5) + sin(uTime * 0.4 + ph) * 0.45;
  vec4 mv = modelViewMatrix * vec4(w.x + wob.x, y, w.y + wob.y, 1.0);
  gl_Position = projectionMatrix * mv;
  float edge = 1.0 - smoothstep(0.36 * T, 0.5 * T, length(w - uCenter));
  float blink = 0.25 + 0.75 * pow(0.5 + 0.5 * sin(uTime * 1.9 + ph), 3.0);
  vA = edge * (fire ? blink : 0.55);
  vCol = fire ? uFirefly : uPollen;
  float size = fire ? 0.2 : 0.09;
  gl_PointSize = clamp(size * uPixel / max(0.1, -mv.z), 1.5, 26.0);
}`;

const FRAG = /* glsl */ `
varying vec3 vCol; varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d); a *= a;
  gl_FragColor = vec4(vCol, a * vA);
  #include <colorspace_fragment>
}`;

export class AmbientParticles {
  readonly points: Points<BufferGeometry, ShaderMaterial>;
  private time = 0;
  private animate = true;

  constructor(theme: EnvTheme, max: number) {
    const r = mulberry32(0xf17e), seed = new Float32Array(max * 4);
    for (let i = 0; i < max; i++) { seed[i * 4] = r() * WINDOW; seed[i * 4 + 1] = r() * WINDOW; seed[i * 4 + 2] = r(); seed[i * 4 + 3] = r(); }
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(new Float32Array(max * 3), 3));
    g.setAttribute("aSeed", new Float32BufferAttribute(seed, 4));
    const m = new ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: AdditiveBlending, fog: false,
      uniforms: {
        uTime: { value: 0 }, uCenter: { value: new Vector2() }, uWindow: { value: WINDOW }, uPixel: { value: 700 }, uShare: { value: theme.particles.fireflyShare },
        uPollen: { value: new Color(theme.particles.pollen) }, uFirefly: { value: new Color(theme.particles.firefly) },
      },
    });
    this.points = new Points(g, m);
    this.points.name = "deco.ambient";
    this.points.frustumCulled = false; this.points.renderOrder = 5;
    g.setDrawRange(0, 0);
  }

  setCount(n: number): void { this.points.geometry.setDrawRange(0, n); this.points.visible = n > 0 && this.animate; }
  /** Reduced motion hides the drifting particles entirely. */
  setAnimated(on: boolean): void { this.animate = on; this.points.visible = on && this.points.geometry.drawRange.count > 0; }
  get count(): number { return this.points.geometry.drawRange.count; }

  /** `pixelScale`: viewport height in device pixels over twice the tangent of half the vertical fov, so sprite size is world-sized. */
  update(dtSec: number, cx: number, cz: number, pixelScale: number): void {
    if (this.animate) this.time += dtSec;
    const u = this.points.material.uniforms as { uTime: { value: number }; uCenter: { value: Vector2 }; uPixel: { value: number } };
    u.uTime.value = this.time; u.uCenter.value.set(cx, cz); u.uPixel.value = pixelScale;
  }

  dispose(): void {
    this.points.geometry.dispose(); this.points.material.dispose(); this.points.removeFromParent();
  }
}
