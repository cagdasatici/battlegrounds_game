/**
 * WORLD01: animated sea surface. One transparent plane; the vertex shader displaces it with a few long travelling swells, the
 * fragment shader adds a fine normal ripple, depth-based colour (turquoise shallows to deep blue), a sky reflection, a sun glint and
 * foam: a bright wash line where the water meets the sand, trailing foam bands behind it and sparse whitecaps offshore. The depth is
 * estimated analytically from the same sea-bed function the terrain uses (coastShape.ts), so the foam sits on the real shoreline. Fog and
 * tone mapping use the stock chunks, so the sea haze matches the rest of the scene. Presentation only.
 */
import { Color, Mesh, PlaneGeometry, ShaderMaterial, UniformsLib, UniformsUtils, Vector2, Vector3 } from "three";
import { COAST_SEA_FLOOR, COAST_SEA_SLOPE, COAST_WATER_Y, COAST_WAVE_AMPLITUDE, type CoastDims } from "./coastShape.js";

const WAVES = /* glsl */ `
// Four swells: direction (xz), wavelength factor, speed, amplitude share.
const vec4 W0 = vec4(0.92, 0.39, 0.105, 0.9);
const vec4 W1 = vec4(-0.55, 0.83, 0.17, 1.15);
const vec4 W2 = vec4(0.31, -0.95, 0.27, 1.4);
const vec4 W3 = vec4(-0.8, -0.6, 0.41, 1.9);
float swell(vec2 p, vec4 w, float t, float a) {
  float k = w.z; // radians per metre
  return a * sin(dot(p, w.xy) * k + t * w.w);
}
vec2 swellGrad(vec2 p, vec4 w, float t, float a) {
  float k = w.z;
  return w.xy * (a * k * cos(dot(p, w.xy) * k + t * w.w));
}
float height(vec2 p, float t, float amp) {
  return amp * (swell(p, W0, t, 1.0) + swell(p, W1, t, 0.6) + swell(p, W2, t, 0.35) + swell(p, W3, t, 0.2));
}
vec2 gradient(vec2 p, float t, float amp) {
  return amp * (swellGrad(p, W0, t, 1.0) + swellGrad(p, W1, t, 0.6) + swellGrad(p, W2, t, 0.35) + swellGrad(p, W3, t, 0.2));
}
`;

const VERT = /* glsl */ `
uniform float uTime; uniform float uAmp;
varying vec3 vWorld; varying float vCrest;
#include <fog_pars_vertex>
${WAVES}
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  float h = height(wp.xz, uTime, uAmp);
  wp.y += h;
  vWorld = wp.xyz; vCrest = h / max(uAmp, 0.0001);
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAG = /* glsl */ `
uniform float uTime; uniform float uAmp; uniform vec2 uHalf; uniform float uLevel; uniform float uSlope; uniform float uFloor;
uniform vec3 uShallow; uniform vec3 uDeep; uniform vec3 uSky; uniform vec3 uFoam; uniform vec3 uSun; uniform vec3 uGlint;
varying vec3 vWorld; varying float vCrest;
#include <fog_pars_fragment>
${WAVES}
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  vec2 p = vWorld.xz;
  float d = length(max(abs(p) - uHalf, 0.0));
  float bed = -min(d * uSlope, -uFloor);
  float depth = vWorld.y - bed;
  // Fine ripples on top of the swells.
  vec2 g = gradient(p, uTime, uAmp) + 0.05 * vec2(vnoise(p * 1.3 + uTime * 0.4) - 0.5, vnoise(p * 1.1 - uTime * 0.35 + 7.0) - 0.5);
  vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 v = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  vec3 col = mix(uShallow, uDeep, smoothstep(0.2, 2.2, depth));
  col = mix(col, uSky, clamp(fres * 0.4, 0.0, 0.5));
  vec3 r = reflect(-v, n);
  col += uGlint * pow(max(dot(r, normalize(uSun)), 0.0), 120.0) * 1.1;
  // Foam: wash line on the sand, bands that slide back out, and sparse whitecaps on the highest crests.
  float grain = 0.55 + 0.45 * vnoise(p * 2.6 + vec2(uTime * 0.25, -uTime * 0.2));
  float wash = (1.0 - smoothstep(0.0, 0.42 + 0.2 * sin(uTime * 0.8 + p.x * 0.07), depth)) * (0.75 + 0.25 * grain);
  float bands = smoothstep(0.82, 1.0, sin(depth * 8.0 - uTime * 1.25 + vnoise(p * 0.5) * 3.0)) * (1.0 - smoothstep(0.35, 1.5, depth)) * grain;
  float caps = smoothstep(0.78, 1.0, vCrest) * smoothstep(0.55, 0.8, vnoise(p * 0.9 + uTime * 0.2)) * smoothstep(1.2, 3.0, depth) * 0.8;
  float foam = clamp(wash + bands * 0.8 + caps, 0.0, 1.0);
  col = mix(col, uFoam, foam);
  float alpha = clamp(smoothstep(0.0, 0.5, depth) * 0.6 + smoothstep(0.4, 2.4, depth) * 0.36 + foam * 0.5, 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export interface WaterColors { shallow: number; deep: number; sky: number; foam: number; glint: number }

export class Water {
  readonly mesh: Mesh<PlaneGeometry, ShaderMaterial>;
  private time = 0;

  constructor(dims: CoastDims, colors: WaterColors, sunDir: readonly [number, number, number]) {
    const g = new PlaneGeometry(480, 480, 128, 128);
    g.rotateX(-Math.PI / 2);
    const m = new ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, fog: true,
      uniforms: UniformsUtils.merge([UniformsLib["fog"], {
        uTime: { value: 0 }, uAmp: { value: COAST_WAVE_AMPLITUDE }, uHalf: { value: new Vector2(dims.halfX, dims.halfZ) },
        uLevel: { value: COAST_WATER_Y }, uSlope: { value: COAST_SEA_SLOPE }, uFloor: { value: COAST_SEA_FLOOR },
        uShallow: { value: new Color(colors.shallow) }, uDeep: { value: new Color(colors.deep) }, uSky: { value: new Color(colors.sky) },
        uFoam: { value: new Color(colors.foam) }, uGlint: { value: new Color(colors.glint) }, uSun: { value: new Vector3(...sunDir).normalize() },
      }]),
    });
    this.mesh = new Mesh(g, m);
    this.mesh.name = "deco.water";
    this.mesh.position.y = COAST_WATER_Y;
    this.mesh.renderOrder = 2; this.mesh.frustumCulled = false;
  }

  /** Advances the swell clock. The caller skips this under Reduced Motion, which leaves a still sea. */
  update(dtSec: number): void {
    this.time += dtSec;
    (this.mesh.material.uniforms["uTime"] as { value: number }).value = this.time;
  }

  dispose(): void {
    this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.mesh.removeFromParent();
  }
}
