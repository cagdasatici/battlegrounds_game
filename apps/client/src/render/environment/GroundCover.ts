/**
 * GFX01: instanced ground cover. Grass clumps and flower heads are drawn from fixed pools whose positions live in a repeating
 * window that follows the camera focus (wrapped in the vertex shader), so a small pool gives dense cover wherever the fight is.
 * A density mask texture stops cover over void, bridges, cover blocks and the stone court. Wind sway is vertex-shader only.
 * Pebbles are plain instanced meshes placed once on the CPU. Presentation only; nothing here touches simulation state.
 */
import {
  BufferGeometry, Color, DataTexture, DoubleSide, DodecahedronGeometry, Float32BufferAttribute, Group, InstancedBufferAttribute,
  InstancedBufferGeometry, InstancedMesh, LinearFilter, Matrix4, Mesh, MeshLambertMaterial, MeshToonMaterial, Quaternion, RedFormat,
  Vector2, Vector3, type Material, type Texture,
} from "three";
import type { Collider } from "@eb/shared/config/arena";
import { mulberry32, mixHex } from "../../scene/EnvPalette.js";
import { buildCoverMask, sampleMask, type CoverMask } from "./coverMask.js";
import type { WearPoint } from "./groundShading.js";
import type { EnvQualityProfile } from "./quality.js";
import type { EnvTheme } from "./theme.js";

const MASK_HALF = 80, MASK_CELLS = 320;
const BLADE_H = 0.55;
const maskCache = new WeakMap<readonly Collider[], CoverMask>();
/** Mask for a collider set, built once per set (several scenes in a session share it). */
export function coverMaskFor(colliders: readonly Collider[], wear: readonly WearPoint[]): CoverMask {
  let m = maskCache.get(colliders);
  if (!m) { m = buildCoverMask(colliders, MASK_HALF, MASK_CELLS, wear); maskCache.set(colliders, m); }
  return m;
}

/** Four-blade clump, 3 triangles per blade, vertex colour dark at the root and light at the tip. */
export function clumpGeometry(theme: EnvTheme, seed: number): BufferGeometry {
  const rnd = mulberry32(seed), pos: number[] = [], col: number[] = [];
  const base = new Color(theme.cover.bladeBase), tip = new Color(theme.cover.bladeTip), dry = new Color(theme.cover.bladeDry);
  const push = (x: number, y: number, z: number, c: Color): void => { pos.push(x, y, z); col.push(c.r, c.g, c.b); };
  for (let b = 0; b < 4; b++) {
    const a = (b / 4) * Math.PI * 2 + rnd() * 0.8, lean = 0.12 + rnd() * 0.3, h = BLADE_H * (0.7 + rnd() * 0.5), w = 0.035 + rnd() * 0.02;
    const ox = Math.cos(a) * 0.05, oz = Math.sin(a) * 0.05;
    const cx = Math.cos(a), cz = Math.sin(a), tx = -cz, tz = cx;
    const tipC = tip.clone().lerp(dry, rnd() * 0.45), midC = base.clone().lerp(tipC, 0.5);
    const at = (t: number, side: number): [number, number, number] => {
      const k = t * t * lean * h;
      return [ox + cx * k + tx * side * w * (1 - t * 0.85), t * h, oz + cz * k + tz * side * w * (1 - t * 0.85)];
    };
    const [l0, r0, l1, r1, t2] = [at(0, -1), at(0, 1), at(0.5, -1), at(0.5, 1), at(1, 0)];
    for (const [p, c] of [[l0, base], [r0, base], [l1, midC], [r0, base], [r1, midC], [l1, midC], [l1, midC], [r1, midC], [t2, tipC]] as const) push(p[0], p[1], p[2], c);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new Float32BufferAttribute(col, 3));
  return g;
}

/** Flower: thin stem plus a six-petal head. aHead marks head vertices so the shader can tint them. */
export function flowerGeometry(): BufferGeometry {
  const pos: number[] = [], col: number[] = [], head: number[] = [];
  const v = (x: number, y: number, z: number, c: number, h: number): void => { const k = new Color(c); pos.push(x, y, z); col.push(k.r, k.g, k.b); head.push(h); };
  const H = 0.4, s = 0.012;
  const stem = 0x4a7a3a;
  v(-s, 0, 0, stem, 0); v(s, 0, 0, stem, 0); v(-s, H, 0, stem, 0); v(s, 0, 0, stem, 0); v(s, H, 0, stem, 0); v(-s, H, 0, stem, 0);
  for (let i = 0; i < 6; i++) {
    const a0 = (i / 6) * Math.PI * 2, a1 = ((i + 1) / 6) * Math.PI * 2, r = 0.075;
    v(0, H + 0.02, 0, 0xffe58a, 1); v(Math.cos(a0) * r, H, Math.sin(a0) * r, 0xffffff, 1); v(Math.cos(a1) * r, H, Math.sin(a1) * r, 0xffffff, 1);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new Float32BufferAttribute(col, 3));
  g.setAttribute("aHead", new Float32BufferAttribute(head, 1));
  return g;
}

interface CoverUniforms {
  uTime: { value: number }; uCenter: { value: Vector2 }; uWindow: { value: number }; uMask: { value: Texture };
  uMaskMin: { value: number }; uMaskSpan: { value: number }; uSway: { value: number }; uScale: { value: number };
  uPalette: { value: Color[] };
}

const VERT_HEAD = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime; uniform vec2 uCenter; uniform float uWindow; uniform sampler2D uMask; uniform float uMaskMin; uniform float uMaskSpan;
uniform float uSway; uniform float uScale; uniform vec3 uPalette[6];
#ifdef COVER_FLOWER
attribute float aHead;
#endif
`;

const VERT_BEGIN = /* glsl */ `
vec3 transformed;
vec3 coverTint = vec3(1.0);
{
  float T = uWindow;
  vec2 w = aSeed.xy + T * floor((uCenter - aSeed.xy) / T + 0.5);
  float edge = 1.0 - smoothstep(0.36 * T, 0.5 * T, length(w - uCenter));
  float dens = texture2D(uMask, (w - vec2(uMaskMin)) / uMaskSpan).r;
  float keep = step(aSeed.z, dens) * edge;
  #ifdef COVER_FLOWER
  keep *= step(0.42, 0.5 + 0.5 * sin(w.x * 0.23 + 1.3) * sin(w.y * 0.19 + 0.7) + 0.3 * aSeed.z);
  #endif
  float ang = aSeed.w * 6.2831853, ca = cos(ang), sa = sin(ang);
  float size = (0.75 + 0.55 * fract(aSeed.z * 17.13 + aSeed.w * 5.1)) * uScale * keep;
  vec3 p = position;
  p.xz = vec2(ca * p.x - sa * p.z, sa * p.x + ca * p.z);
  p *= size;
  float bend = pow(clamp(position.y / ${BLADE_H.toFixed(2)}, 0.0, 1.2), 2.0);
  vec2 gust = vec2(sin(uTime * 1.5 + w.x * 0.33 + w.y * 0.17), cos(uTime * 1.2 + w.x * 0.19 - w.y * 0.31)) * uSway * bend * size;
  transformed = vec3(w.x + p.x + gust.x, p.y, w.y + p.z + gust.y);
  coverTint = vec3(0.82 + 0.36 * fract(aSeed.w * 9.7 + aSeed.z * 3.3));
  #ifdef COVER_FLOWER
  int pidx = int(floor(fract(aSeed.w * 13.7 + aSeed.z * 5.9) * 5.999));
  vec3 pc = uPalette[pidx];
  coverTint = mix(vec3(1.0), pc, aHead);
  #endif
}
`;

function patchedMaterial(u: CoverUniforms, flower: boolean): MeshLambertMaterial {
  const m = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    const def = flower ? "#define COVER_FLOWER\n" : "";
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${def}${VERT_HEAD}\nvarying vec3 vCoverTint;`)
      .replace("#include <beginnormal_vertex>", "vec3 objectNormal = vec3(0.0, 1.0, 0.0);")
      .replace("#include <begin_vertex>", `${VERT_BEGIN}\nvCoverTint = coverTint;`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vCoverTint;")
      .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb *= vCoverTint;");
  };
  m.customProgramCacheKey = () => (flower ? "eb-cover-flower" : "eb-cover-grass");
  return m;
}

function seeds(n: number, window: number, seed: number): Float32Array {
  const r = mulberry32(seed), a = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { a[i * 4] = r() * window; a[i * 4 + 1] = r() * window; a[i * 4 + 2] = r(); a[i * 4 + 3] = r(); }
  return a;
}

export class GroundCover {
  readonly group = new Group();
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: Material[] = [];
  private readonly maskTexture: DataTexture;
  private readonly uniforms: CoverUniforms;
  private readonly grass: Mesh<InstancedBufferGeometry>;
  private readonly flowers: Mesh<InstancedBufferGeometry>;
  private readonly pebbles: InstancedMesh;
  private time = 0;
  private animate = true;
  private sway = 1;

  constructor(colliders: readonly Collider[], theme: EnvTheme, wear: readonly WearPoint[], maxProfile: EnvQualityProfile) {
    this.group.name = "deco.cover.field";
    const mask = coverMaskFor(colliders, wear);
    this.maskTexture = new DataTexture(mask.data, mask.size, mask.size, RedFormat);
    this.maskTexture.magFilter = LinearFilter; this.maskTexture.minFilter = LinearFilter; this.maskTexture.needsUpdate = true;
    this.uniforms = {
      uTime: { value: 0 }, uCenter: { value: new Vector2(0, 0) }, uWindow: { value: maxProfile.coverWindow }, uMask: { value: this.maskTexture },
      uMaskMin: { value: mask.min }, uMaskSpan: { value: mask.span }, uSway: { value: 0.09 }, uScale: { value: 1 },
      uPalette: { value: Array.from({ length: 6 }, (_, i) => new Color(theme.cover.flowers[i % theme.cover.flowers.length] ?? 0xffffff)) },
    };
    const make = (flower: boolean, n: number, seed: number): Mesh<InstancedBufferGeometry> => {
      const src = flower ? flowerGeometry() : clumpGeometry(theme, seed);
      const g = new InstancedBufferGeometry();
      g.index = src.index;
      for (const k of Object.keys(src.attributes)) g.setAttribute(k, src.getAttribute(k));
      g.setAttribute("aSeed", new InstancedBufferAttribute(seeds(n, maxProfile.coverWindow, seed + 1), 4));
      g.instanceCount = 0;
      src.dispose();
      const mat = patchedMaterial(this.uniforms, flower);
      const mesh = new Mesh(g, mat);
      mesh.name = flower ? "deco.cover.flowers" : "deco.cover.grass";
      mesh.frustumCulled = false; mesh.receiveShadow = true; mesh.castShadow = false;
      this.geometries.push(g); this.materials.push(mat); this.group.add(mesh);
      return mesh;
    };
    this.grass = make(false, maxProfile.grass, 0x6a55);
    this.flowers = make(true, maxProfile.flowers, 0x71f1);
    this.pebbles = this.buildPebbles(colliders, theme, mask, maxProfile.pebbles);
    this.group.add(this.pebbles);
  }

  private buildPebbles(colliders: readonly Collider[], theme: EnvTheme, mask: CoverMask, max: number): InstancedMesh {
    const g = new DodecahedronGeometry(1, 0), mat = new MeshToonMaterial({ color: 0xffffff });
    const mesh = new InstancedMesh(g, mat, max);
    mesh.name = "deco.cover.pebbles"; mesh.receiveShadow = true;
    const rnd = mulberry32(0x9eb), m = new Matrix4(), q = new Quaternion(), p = new Vector3(), s = new Vector3(), c = new Color(), up = new Vector3(0, 1, 0);
    let n = 0;
    for (let tries = 0; n < max && tries < max * 40; tries++) {
      const x = (rnd() * 2 - 1) * MASK_HALF, z = (rnd() * 2 - 1) * MASK_HALF;
      if (sampleMask(mask, x, z) < 0.35) continue;
      const k = rnd() < 0.12 ? 0.3 + rnd() * 0.35 : 0.08 + rnd() * 0.16; // a few boulders among the pebbles
      q.setFromAxisAngle(up, rnd() * 6.28);
      p.set(x, k * 0.3, z); s.set(k * (1 + rnd() * 0.6), k * 0.7, k * (1 + rnd() * 0.6));
      mesh.setMatrixAt(n, m.compose(p, q, s));
      mesh.setColorAt(n, c.set(mixHex(theme.cover.pebbles[0], theme.cover.pebbles[1], rnd())));
      n++;
    }
    mesh.count = n; mesh.computeBoundingSphere(); mesh.frustumCulled = false;
    mesh.count = 0; mesh.userData["placed"] = n;
    this.geometries.push(g); this.materials.push(mat);
    void colliders;
    return mesh;
  }

  /** Applies a tier: pool sizes, window and sway. Cheap; no allocation. */
  setProfile(p: EnvQualityProfile): void {
    this.grass.geometry.instanceCount = p.grass;
    this.flowers.geometry.instanceCount = p.flowers;
    this.pebbles.count = Math.min(p.pebbles, (this.pebbles.userData["placed"] as number) ?? 0);
    this.pebbles.visible = this.pebbles.count > 0;
    this.grass.visible = p.grass > 0; this.flowers.visible = p.flowers > 0;
    this.uniforms.uWindow.value = p.coverWindow;
    this.sway = p.sway ? 1 : 0;
    this.applySway();
  }

  /** FB08: reduced motion freezes time and sway. */
  setAnimated(on: boolean): void { this.animate = on; this.applySway(); }
  private applySway(): void { this.uniforms.uSway.value = this.animate ? 0.09 * this.sway : 0; }

  get counts(): { grass: number; flowers: number; pebbles: number } {
    return { grass: this.grass.geometry.instanceCount, flowers: this.flowers.geometry.instanceCount, pebbles: this.pebbles.count };
  }

  update(dtSec: number, cx: number, cz: number): void {
    if (this.animate) this.time += dtSec;
    this.uniforms.uTime.value = this.time;
    this.uniforms.uCenter.value.set(cx, cz);
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.maskTexture.dispose();
    this.pebbles.dispose();
    this.group.removeFromParent();
    this.geometries.length = 0; this.materials.length = 0;
  }
}
