/**
 * WORLD01/WORLD02: building blocks shared by the non-grove world builders: sky dome and cloud shell, a vertex coloured
 * heightfield, a tileable grain texture and soft cloud puffs. Everything is original and procedural; nothing here touches
 * simulation state (the collision slab is always flat, see packages/shared/src/config/worlds.ts).
 */
import {
  BackSide, BufferGeometry, Color, DataTexture, Float32BufferAttribute, LinearFilter, Mesh, MeshBasicMaterial, RGBAFormat, RepeatWrapping,
  SphereGeometry, SRGBColorSpace, Uint32BufferAttribute, type Material, type Texture,
} from "three";
import { ARENA_SCALE } from "@eb/shared/config/arena";
import { cloudAlpha, mixHex, mulberry32 } from "../../scene/EnvPalette.js";
import { makeSkyMaterial } from "../environment/sky.js";
import type { EnvTheme } from "../environment/theme.js";
import { Batch, xf, type Shader } from "../../scene/ArenaView.js";

/** Sky dome radius (m); matches the grove so the camera far plane (180 x ARENA_SCALE) keeps it in range. */
export const WORLD_SKY_RADIUS = 165 * ARENA_SCALE;

/** Owner list of everything a world builder allocates, so the scene can release it in one pass. */
export class Allocations {
  readonly geometries: BufferGeometry[] = [];
  readonly materials: Material[] = [];
  readonly textures: Texture[] = [];
  geo<G extends BufferGeometry>(g: G): G { this.geometries.push(g); return g; }
  mat<M extends Material>(m: M): M { this.materials.push(m); return m; }
  tex<T extends Texture>(t: T): T { this.textures.push(t); return t; }
}

/** Gradient sky dome (theme driven, with the sun disc) and the soft cloud layer inside it. The scene recentres the dome on the camera. */
export function makeSkyParts(theme: EnvTheme, a: Allocations): { sky: Mesh; cloudShell: Mesh } {
  const skyG = a.geo(new SphereGeometry(WORLD_SKY_RADIUS, 48, 24));
  const sky = new Mesh(skyG, a.mat(makeSkyMaterial(theme)));
  sky.name = "deco.sky"; sky.renderOrder = -10; sky.frustumCulled = false;
  const w = 256, h = 128, mask = cloudAlpha(w, h, 0xc10ad), px = new Uint8Array(w * h * 4);
  for (let i = 0; i < mask.length; i++) { px[i * 4] = 255; px[i * 4 + 1] = 255; px[i * 4 + 2] = 255; px[i * 4 + 3] = mask[i]!; }
  const tex = a.tex(new DataTexture(px, w, h, RGBAFormat));
  tex.wrapS = RepeatWrapping; tex.colorSpace = SRGBColorSpace; tex.magFilter = LinearFilter; tex.minFilter = LinearFilter; tex.flipY = true; tex.needsUpdate = true;
  const shellG = a.geo(new SphereGeometry(WORLD_SKY_RADIUS - 5, 32, 16));
  const cloudShell = new Mesh(shellG, a.mat(new MeshBasicMaterial({ map: tex, transparent: true, side: BackSide, fog: false, depthWrite: false, opacity: 0.9 })));
  cloudShell.name = "deco.cloudShell"; cloudShell.renderOrder = -9; cloudShell.frustumCulled = false;
  sky.add(cloudShell);
  return { sky, cloudShell };
}

/** Flattened puffs merged into one mesh, scattered on a ring at heights `y0..y1`. */
export function cloudPuffs(count: number, r0: number, r1: number, y0: number, y1: number, tone: { lit: number; shade: number }, seed: number): BufferGeometry {
  const rnd = mulberry32(seed), b = new Batch();
  const shade: Shader = (_x, y, _z, _nx, ny) => mixHex(tone.shade, tone.lit, Math.min(1, 0.45 + ny * 0.5 + (y > (y0 + y1) / 2 ? 0.1 : 0)));
  for (let i = 0; i < count; i++) {
    const ang = rnd() * Math.PI * 2, rad = r0 + rnd() * (r1 - r0), y = y0 + rnd() * (y1 - y0);
    const cx = Math.cos(ang) * rad, cz = Math.sin(ang) * rad;
    for (let k = 0; k < 4; k++) {
      const s = 7 + rnd() * 9;
      b.add(new SphereGeometry(1, 8, 5), xf(cx + (rnd() - 0.5) * 18, y + (rnd() - 0.5) * 2, cz + (rnd() - 0.5) * 18, s, s * 0.38, s * 0.9), shade);
    }
  }
  return b.build();
}

export interface HeightfieldOptions {
  x0: number; x1: number; z0: number; z1: number;
  /** Vertex spacing in metres. */
  cell: number;
  height(x: number, z: number): number;
  /** sRGB hex colour at a vertex; `h` is the height there. */
  color(x: number, z: number, h: number): number;
  /** World metres per texture repeat (uv = world / uvMetres). */
  uvMetres: number;
}

/** Indexed, vertex coloured grid with analytic-difference normals (smooth shading without crossing a seam). */
export function heightfield(o: HeightfieldOptions): BufferGeometry {
  const nx = Math.max(1, Math.round((o.x1 - o.x0) / o.cell)), nz = Math.max(1, Math.round((o.z1 - o.z0) / o.cell));
  const cols = nx + 1, rows = nz + 1;
  const pos = new Float32Array(cols * rows * 3), nor = new Float32Array(cols * rows * 3), col = new Float32Array(cols * rows * 3), uv = new Float32Array(cols * rows * 2);
  const c = new Color(), e = o.cell * 0.5;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const x = o.x0 + (i / nx) * (o.x1 - o.x0), z = o.z0 + (j / nz) * (o.z1 - o.z0), h = o.height(x, z), k = j * cols + i;
    pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
    const dx = o.height(x + e, z) - o.height(x - e, z), dz = o.height(x, z + e) - o.height(x, z - e);
    const inv = 1 / Math.hypot(dx, 2 * e, dz);
    nor[k * 3] = -dx * inv; nor[k * 3 + 1] = 2 * e * inv; nor[k * 3 + 2] = -dz * inv;
    c.setHex(o.color(x, z, h));
    col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
    uv[k * 2] = x / o.uvMetres; uv[k * 2 + 1] = z / o.uvMetres;
  }
  const idx = new Uint32Array(nx * nz * 6);
  let n = 0;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = j * cols + i, b = a + 1, d = a + cols, f = d + 1;
    idx[n++] = a; idx[n++] = d; idx[n++] = b; idx[n++] = b; idx[n++] = d; idx[n++] = f;
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new Float32BufferAttribute(nor, 3));
  g.setAttribute("color", new Float32BufferAttribute(col, 3));
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  g.setIndex(new Uint32BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

/**
 * Small tileable grayscale grain (multiplies the vertex colour): fine speckle plus faint directional ripples.
 * `ripple` > 0 draws sand wind ripples; `sparkle` > 0 adds bright snow glints.
 */
export function grainTexture(seed: number, o: { base: number; ripple: number; sparkle: number }): DataTexture {
  const size = 128, px = new Uint8Array(size * size * 4), rnd = mulberry32(seed);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const speck = rnd() * 9;
    const rip = o.ripple * 6 * Math.sin(((x + 9 * Math.sin(y * 0.11)) / size) * Math.PI * 2 * 9);
    const glint = o.sparkle > 0 && rnd() < 0.012 * o.sparkle ? 24 : 0;
    const v = Math.max(0, Math.min(255, o.base + speck + rip + glint));
    px[i] = v; px[i + 1] = v; px[i + 2] = v; px[i + 3] = 255;
  }
  const t = new DataTexture(px, size, size, RGBAFormat);
  t.wrapS = t.wrapT = RepeatWrapping; t.magFilter = LinearFilter; t.colorSpace = SRGBColorSpace; t.needsUpdate = true;
  return t;
}

export const smoothstep = (a: number, b: number, t: number): number => { const k = Math.min(1, Math.max(0, (t - a) / (b - a))); return k * k * (3 - 2 * k); };
export const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));

/** Distance from (x, z) to the walkable rectangle [-hx, hx] x [-hz, hz]; 0 inside. */
export function outsideRect(x: number, z: number, hx: number, hz: number): number {
  return Math.hypot(Math.max(0, Math.abs(x) - hx), Math.max(0, Math.abs(z) - hz));
}
