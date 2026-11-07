/**
 * WORLD01/WORLD02: small original low-poly props shared by the world builders (curved palm, pine with snow, chunky boulder,
 * log, shell). Each one appends vertex coloured geometry to a Batch so a whole world is a handful of draw calls.
 * Pure geometry: nothing here is collided (the server colliders live in packages/shared/src/config/worlds.ts and are
 * deliberately a little smaller than the drawn silhouette so contact always looks fair).
 */
import {
  BufferGeometry, ConeGeometry, CylinderGeometry, DodecahedronGeometry, Float32BufferAttribute, Matrix4, OctahedronGeometry, Quaternion,
  SphereGeometry, Vector3,
} from "three";
import { mixHex } from "../../scene/EnvPalette.js";
import { Batch, box, xf, type Shader } from "../../scene/ArenaView.js";

const UP = new Vector3(0, 1, 0);

/** A tapered cylinder from `a` to `c` (radius r0 at a, r1 at c) appended to `b`. */
export function segment(b: Batch, a: Vector3, c: Vector3, r0: number, r1: number, color: number | Shader, sides = 6): void {
  const dir = new Vector3().subVectors(c, a), len = dir.length();
  if (!(len > 1e-6)) return;
  const q = new Quaternion().setFromUnitVectors(UP, dir.divideScalar(len));
  const mid = new Vector3().addVectors(a, c).multiplyScalar(0.5);
  b.add(new CylinderGeometry(r1, r0, len, sides, 1), new Matrix4().compose(mid, q, new Vector3(1, 1, 1)), color);
}

/** A flat leaf strip along `pts` (left/right offsets from `side`), coloured base-to-tip, appended to `b`. Needs a double sided material. */
function leafStrip(b: Batch, pts: Vector3[], side: Vector3, widths: number[], base: number, tip: number, droop: number): void {
  const pos: number[] = [], idx: number[] = [], n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i]!, w = widths[i]!;
    // The strip folds a little along its spine, like a real frond.
    pos.push(p.x - side.x * w, p.y - w * droop, p.z - side.z * w, p.x + side.x * w, p.y - w * droop, p.z + side.z * w);
  }
  for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const p0 = pts[0]!, reach = Math.max(0.1, Math.hypot(pts[n - 1]!.x - p0.x, pts[n - 1]!.z - p0.z));
  b.add(g, new Matrix4(), (x, _y, z) => mixHex(base, tip, Math.min(1, Math.hypot(x - p0.x, z - p0.z) / reach)));
}

export interface PalmOptions { height: number; lean: number; leanYaw: number; fronds: number; seed: () => number }

/** A leaning palm with a ringed trunk, a crown of drooping fronds and coconuts. `trunk` and `leaves` are separate batches (the leaves use a double sided material). */
export function palm(trunk: Batch, leaves: Batch, x: number, y: number, z: number, o: PalmOptions): void {
  const rings = 7, rnd = o.seed;
  let prev = new Vector3(x, y, z);
  const dx = Math.cos(o.leanYaw) * o.lean, dz = Math.sin(o.leanYaw) * o.lean;
  for (let i = 1; i <= rings; i++) {
    const t = i / rings, p = new Vector3(x + dx * t * t, y + o.height * t, z + dz * t * t);
    segment(trunk, prev, p, 0.34 - 0.13 * ((i - 1) / rings), 0.34 - 0.13 * t, i % 2 ? 0x8f7048 : 0x6f5434);
    prev = p;
  }
  const crown = prev;
  for (let k = 0; k < o.fronds; k++) {
    const a = (k / o.fronds) * Math.PI * 2 + (rnd() - 0.5) * 0.5, len = 2.6 + rnd() * 1.1;
    const dirX = Math.cos(a), dirZ = Math.sin(a), pts: Vector3[] = [], widths: number[] = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      pts.push(new Vector3(crown.x + dirX * len * t, crown.y + Math.sin(t * Math.PI * 0.55) * 0.9 - t * t * 1.5 * (0.8 + rnd() * 0.3), crown.z + dirZ * len * t));
      widths.push(0.52 * Math.pow(Math.sin(Math.PI * Math.min(0.97, t + 0.06)), 0.8) + 0.03);
    }
    const dry = rnd() < 0.12;
    leafStrip(leaves, pts, new Vector3(-dirZ, 0, dirX), widths, dry ? 0x7a6a34 : 0x2c7a3c, dry ? 0xa38d4a : 0x86c250, 0.35);
  }
  for (const [ox, oz] of [[0.2, 0.1], [-0.15, 0.18], [0.02, -0.22]] as const)
    trunk.add(new SphereGeometry(0.17, 6, 5), xf(crown.x + ox, crown.y - 0.2, crown.z + oz), 0x5b3b1f);
}

/** Layered snow pine: dark trunk, four needle cones, white caps on every tier. Cones are low-poly (7 sides). */
export function pine(b: Batch, x: number, y: number, z: number, scale: number, rnd: () => number, snowy = true): void {
  const s = scale;
  b.add(new CylinderGeometry(0.22 * s, 0.34 * s, 1.8 * s, 6, 1), xf(x, y + 0.9 * s, z), 0x5b4129);
  const tiers: ReadonlyArray<readonly [number, number, number]> = [[1.7, 2.5, 2.3], [3.2, 2.1, 2.0], [4.5, 1.7, 1.7], [5.6, 1.25, 1.5]];
  const lean = (rnd() - 0.5) * 0.06;
  for (const [h, r, ch] of tiers) {
    const tone = mixHex(0x1c4a3d, 0x2f6e55, rnd() * 0.6);
    b.add(new ConeGeometry(r * s, ch * s, 7, 1), xf(x, y + h * s + ch * s * 0.35, z, 1, 1, 1, lean, rnd() * 3, 0), tone);
    if (snowy) b.add(new ConeGeometry(r * s * 0.78, ch * s * 0.55, 7, 1), xf(x, y + h * s + ch * s * 0.62, z, 1, 1, 1, lean, rnd() * 3, 0), 0xf3f7fb);
  }
  if (snowy) b.add(new SphereGeometry(0.34 * s, 6, 4), xf(x, y + 7.1 * s, z, 1, 0.8, 1), 0xf7fbff);
}

/** Chunky boulder filling a footprint of half extents (hx, hz) and height h at (cx, cz); jittered so no two match. */
export function boulder(b: Batch, cx: number, y0: number, cz: number, hx: number, h: number, hz: number, rnd: () => number, o: { lit: number; mid: number; wet: number; moss?: number; snow?: boolean }): void {
  const shade: Shader = (_x, vy, _z, _nx, ny) => {
    const t = Math.min(1, Math.max(0, (vy - y0) / Math.max(0.1, h)));
    let c = t < 0.28 ? mixHex(o.wet, o.mid, t / 0.28) : mixHex(o.mid, o.lit, (t - 0.28) / 0.72);
    if (o.moss !== undefined && t < 0.45 && ny < 0.6) c = mixHex(c, o.moss, 0.35);
    if (o.snow && ny > 0.62) c = mixHex(c, 0xf4f8fc, Math.min(1, (ny - 0.62) * 3.2));
    return c;
  };
  const jitter = (g: BufferGeometry): BufferGeometry => {
    const p = g.getAttribute("position"), seen = new Map<string, number>();
    for (let i = 0; i < p.count; i++) {
      const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
      let k = seen.get(key);
      if (k === undefined) { k = 0.86 + rnd() * 0.28; seen.set(key, k); }
      p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
    }
    g.computeVertexNormals();
    return g;
  };
  b.add(jitter(new DodecahedronGeometry(1, 0)), xf(cx, y0 + h * 0.46, cz, hx * 1.02, h * 0.56, hz * 1.02, 0, rnd() * 3, 0), shade);
  for (let i = 0; i < 2; i++) {
    const a = rnd() * Math.PI * 2, s = 0.38 + rnd() * 0.2;
    b.add(jitter(new DodecahedronGeometry(1, 0)), xf(cx + Math.cos(a) * hx * 0.85, y0 + h * s * 0.4, cz + Math.sin(a) * hz * 0.85, hx * s, h * s * 0.5, hz * s, 0, rnd() * 3, 0), shade);
  }
}

/** Weathered driftwood log lying along x (alongX) or z, with ring-cut ends and two branch stubs. */
export function log(b: Batch, cx: number, y0: number, cz: number, half: number, radius: number, alongX: boolean, rnd: () => number): void {
  const y = y0 + radius * 0.8;
  const bark: Shader = (_x, _y, _z, _nx, ny) => mixHex(0x9b8a70, 0xc9bca4, Math.max(0, ny) * 0.8 + rnd() * 0.08);
  b.add(new CylinderGeometry(radius, radius * 1.12, half * 2, 7, 1), xf(cx, y, cz, 1, 1, 1, Math.PI / 2 * (alongX ? 0 : 1), 0, alongX ? Math.PI / 2 : 0), bark);
  for (const end of [-1, 1]) {
    const ex = cx + (alongX ? end * half : 0), ez = cz + (alongX ? 0 : end * half);
    b.add(new CylinderGeometry(radius * 0.8, radius * 0.8, 0.04, 7, 1), xf(ex, y, ez, 1, 1, 1, alongX ? 0 : Math.PI / 2, 0, alongX ? Math.PI / 2 : 0), 0x6d5b45);
  }
  for (let i = 0; i < 2; i++) {
    const t = (rnd() - 0.5) * half, side = i ? 1 : -1;
    segment(b, new Vector3(cx + (alongX ? t : 0), y + radius * 0.3, cz + (alongX ? 0 : t)), new Vector3(cx + (alongX ? t : side * 0.6), y + radius + 0.35, cz + (alongX ? side * 0.6 : t)), radius * 0.28, radius * 0.12, 0x8a7a62, 5);
  }
}

/** Small conch-like shell lying on the ground (a cone on its side with a cap) or a round clam. */
export function shell(b: Batch, x: number, y: number, z: number, size: number, tone: number, kind: number, yaw: number): void {
  if (kind % 3 === 0) b.add(new ConeGeometry(size * 0.55, size * 1.5, 6, 1), xf(x, y + size * 0.4, z, 1, 1, 1, Math.PI / 2 - 0.25, yaw, 0), tone);
  else if (kind % 3 === 1) b.add(new SphereGeometry(size, 7, 4), xf(x, y + size * 0.15, z, 1.1, 0.4, 0.9, 0, yaw, 0), tone);
  else b.add(new OctahedronGeometry(size * 0.9, 0), xf(x, y + size * 0.2, z, 1.2, 0.35, 0.9, 0, yaw, 0), tone);
}

/** Five-armed starfish lying flat. */
export function starfish(b: Batch, x: number, y: number, z: number, size: number, yaw: number): void {
  for (let i = 0; i < 5; i++) {
    const a = yaw + (i / 5) * Math.PI * 2;
    b.add(box(size, 0.04, size * 0.26), xf(x + Math.cos(a) * size * 0.5, y + 0.03, z + Math.sin(a) * size * 0.5, 1, 1, 1, 0, -a, 0), 0xe5793a);
  }
  b.add(new SphereGeometry(size * 0.2, 6, 4), xf(x, y + 0.04, z, 1, 0.5, 1), 0xf0925a);
}

/** A tuft of dune grass: three leaning blades. */
export function tuft(b: Batch, x: number, y: number, z: number, h: number, rnd: () => number, base: number, tip: number): void {
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + rnd(), lean = 0.18 + rnd() * 0.3;
    b.add(new ConeGeometry(0.05, h * (0.75 + rnd() * 0.5), 4, 1), xf(x + Math.cos(a) * 0.07, y + h * 0.4, z + Math.sin(a) * 0.07, 1, 1, 1, Math.sin(a) * lean, a, Math.cos(a) * lean), mixHex(base, tip, rnd()));
  }
}

/** One bird: a body triangle and two swept wings (a shallow V seen from above). Used for gulls and ravens (instanced, scaled to flap). */
export function birdGeometry(): BufferGeometry {
  const g = new BufferGeometry();
  const v = [
    0, 0, -0.5, -0.12, 0, 0.35, 0.12, 0, 0.35, // body
    -0.1, 0, 0, -1.5, 0.28, 0.25, -0.3, 0, 0.45, // left wing
    0.1, 0, 0, 1.5, 0.28, 0.25, 0.3, 0, 0.45, // right wing
  ];
  g.setAttribute("position", new Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

/** Wind-packed snow drift filling a footprint of half extents (hx, hz) and height h at (cx, cz): a long squashed mound with a sharp crest. */
export function drift(b: Batch, cx: number, cz: number, hx: number, h: number, hz: number, rnd: () => number): void {
  const shade: Shader = (_x, vy, _z, _nx, ny) => mixHex(0xcfe0ee, 0xffffff, Math.min(1, Math.max(0, vy / Math.max(0.1, h)) * 0.8 + ny * 0.2));
  b.add(new SphereGeometry(1, 10, 6), xf(cx, 0, cz, hx * 1.05, h * 1.05, hz * 1.05, 0, rnd() * 0.3, 0), shade);
  b.add(new SphereGeometry(1, 8, 5), xf(cx + (rnd() - 0.5) * hx, 0, cz + (rnd() - 0.5) * hz, hx * 0.6, h * 0.8, hz * 0.6), shade);
}
