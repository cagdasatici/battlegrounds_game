/**
 * Original floating island arena visuals (spec sections 10 and 23, task T25). Everything is generated in code from
 * the collider list: grass lipped islands with stratified rock undersides, plank bridges, carved stone pillars and
 * walls, lamp-posted rails, a ground glyph, scattered grass, flowers and rocks, drifting clouds, distant islets and a
 * gradient sky dome. One mesh per collider (named by collider id) keeps visuals and physics in one-to-one
 * correspondence; decoration is merged into a handful of meshes named "deco.*". Presentation only.
 */
import {
  BackSide, BoxGeometry, BufferGeometry, Color, ConeGeometry, CylinderGeometry, DodecahedronGeometry, DoubleSide, Euler, Float32BufferAttribute,
  Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshToonMaterial, OctahedronGeometry, Quaternion, RingGeometry, SphereGeometry, Vector3,
  type DataTexture, type Material,
} from "three";
import type { Collider } from "@eb/shared/config/arena";
import { instancePlacements, type EnvKit, type EnvModelId, type EnvPlacement } from "./EnvAssets.js";

export const SKY = { horizon: 0xcfe3f0, zenith: 0x2f86e8, nadir: 0x9fbcd6, fog: 0xc4dae9 } as const;

const PALETTE = {
  grassTop: 0x879b65, grassSide: 0x465b3b, soil: 0x7a5636, rockHi: 0x8a7f78, rockMid: 0x645c66, rockLow: 0x403b4a,
  wood: 0xa87a48, woodDark: 0x6b4a2c, stone: 0x9a968f, stoneDark: 0x6c6a70, amber: 0xf0a030, cloud: 0xffffff, cloudShade: 0xb9cde4,
} as const;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Shader = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => number;

/** Accumulates transformed, vertex coloured geometry into one BufferGeometry. */
class Batch {
  private pos: number[] = []; private nor: number[] = []; private col: number[] = []; private idx: number[] = [];
  private readonly c = new Color();
  add(g: BufferGeometry, m: Matrix4, color: number | Shader): void {
    g.applyMatrix4(m);
    const at = g.getAttribute("position"), nm = g.getAttribute("normal"), ix = g.getIndex();
    const base = this.pos.length / 3;
    for (let i = 0; i < at.count; i++) {
      const x = at.getX(i), y = at.getY(i), z = at.getZ(i), nx = nm.getX(i), ny = nm.getY(i), nz = nm.getZ(i);
      this.pos.push(x, y, z); this.nor.push(nx, ny, nz);
      this.c.setHex(typeof color === "number" ? color : color(x, y, z, nx, ny, nz));
      this.col.push(this.c.r, this.c.g, this.c.b);
    }
    if (ix) for (let i = 0; i < ix.count; i++) this.idx.push(base + ix.getX(i));
    else for (let i = 0; i < at.count; i++) this.idx.push(base + i);
    g.dispose();
  }
  get empty(): boolean { return this.pos.length === 0; }
  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new Float32BufferAttribute(this.nor, 3));
    g.setAttribute("color", new Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

const tmpE = new Euler(), tmpQ = new Quaternion(), tmpS = new Vector3(1, 1, 1), tmpV = new Vector3();
const xf = (x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0): Matrix4 => {
  tmpQ.setFromEuler(tmpE.set(rx, ry, rz));
  return new Matrix4().compose(tmpV.set(x, y, z), tmpQ, tmpS.set(sx, sy, sz));
};
const lerpHex = (a: number, b: number, t: number): number => new Color(a).lerp(new Color(b), Math.min(1, Math.max(0, t))).getHex();
const box = (w: number, h: number, d: number): BoxGeometry => new BoxGeometry(w, h, d);

export interface ArenaBuild {
  readonly group: Group;
  /** Sky dome; the scene recentres it on the camera so it never moves relative to the viewer. */
  readonly sky: Mesh;
  readonly clouds: Mesh;
  readonly geometries: BufferGeometry[];
  readonly materials: Material[];
}

const isGround = (c: Collider): boolean => c.role === "ground";

function groundGeometry(c: Collider): BufferGeometry {
  const b = new Batch();
  const top = c.centre[1] + (c.shape === "cuboid" ? c.halfExtents[1] : c.halfHeight);
  const bottom = top - (c.shape === "cuboid" ? c.halfExtents[1] : c.halfHeight) * 2;
  const lip = 0.38;
  const rock: Shader = (_x, y) => {
    const t = (top - lip - y) / Math.max(1, top - lip - bottom);
    // The bank just under the lip is darkened so the pale meadow edge reads against it.
    return t < 0.25 ? lerpHex(0x4e3a28, PALETTE.rockHi, Math.pow(t / 0.25, 0.7)) : lerpHex(PALETTE.rockHi, PALETTE.rockLow, (t - 0.25) / 0.75);
  };
  const grass: Shader = (x, _y, z, _nx, ny) => {
    if (ny <= 0.5) return PALETTE.grassSide;
    // Broad, quiet patches read at gameplay distance; warm wear leads the east spawn to the bridge.
    const wear = Math.exp(-Math.pow((z + 1.5) / 3.2, 2)) * Math.max(0, Math.min(1, (x - 15) / 12));
    const meadow = 0.5 + 0.5 * Math.sin(x * 0.27 + Math.cos(z * 0.31));
    return lerpHex(lerpHex(0x71885b, 0x9ca874, meadow), 0xb5a486, wear * 0.85);
  };
  if (c.shape === "cuboid") {
    const [hx, hy, hz] = c.halfExtents;
    b.add(box(hx * 2, hy * 2 - lip, hz * 2), xf(c.centre[0], bottom + (hy * 2 - lip) / 2, c.centre[2]), rock);
    b.add(new BoxGeometry(hx * 2 + 0.08, lip, hz * 2 + 0.08, 8, 1, 8), xf(c.centre[0], top - lip / 2, c.centre[2]), grass);
  } else {
    const h = c.halfHeight * 2;
    b.add(new CylinderGeometry(c.radius, c.radius * 0.96, h - lip, 28, 1), xf(c.centre[0], bottom + (h - lip) / 2, c.centre[2]), rock);
    b.add(new CylinderGeometry(c.radius + 0.04, c.radius + 0.04, lip, 28, 1), xf(c.centre[0], top - lip / 2, c.centre[2]), grass);
  }
  return b.build();
}

function bridgeGeometry(c: Collider, glow: Batch, posts: Batch): BufferGeometry {
  const b = new Batch();
  if (c.shape !== "cuboid") return b.build();
  const [hx, hy, hz] = c.halfExtents;
  const alongX = hx >= hz;
  const len = (alongX ? hx : hz) * 2, wid = (alongX ? hz : hx) * 2;
  const n = Math.round(len / 0.6);
  const step = len / n;
  const top = c.centre[1] + hy;
  // Under-beams, then planks with small gaps that show the dark beams.
  for (const side of [-1, 1]) {
    const off = side * (wid / 2 - 0.12);
    b.add(box(alongX ? len : 0.2, 0.2, alongX ? 0.2 : len), xf(c.centre[0] + (alongX ? 0 : off), top - hy * 2 + 0.1, c.centre[2] + (alongX ? off : 0)), PALETTE.woodDark);
  }
  for (let i = 0; i < n; i++) {
    const t = -len / 2 + step * (i + 0.5);
    const tone = lerpHex(PALETTE.wood, PALETTE.woodDark, (i % 3) * 0.12);
    b.add(box(alongX ? step * 0.88 : wid, hy * 2 - 0.1, alongX ? wid : step * 0.88), xf(c.centre[0] + (alongX ? t : 0), top - (hy * 2 - 0.1) / 2, c.centre[2] + (alongX ? 0 : t)), tone);
  }
  // Corner posts with lamps.
  for (const lx of [-1, 1]) for (const lz of [-1, 1]) {
    const px = c.centre[0] + (alongX ? lx * (len / 2 - 0.15) : lx * (wid / 2 - 0.1));
    const pz = c.centre[2] + (alongX ? lz * (wid / 2 - 0.1) : lz * (len / 2 - 0.15));
    posts.add(box(0.14, 0.9, 0.14), xf(px, top + 0.45, pz), PALETTE.woodDark);
    glow.add(new SphereGeometry(0.1, 8, 6), xf(px, top + 1.0, pz), PALETTE.amber);
  }
  return b.build();
}

function obstacleGeometry(c: Collider): BufferGeometry {
  const b = new Batch();
  if (c.shape !== "cuboid") return b.build();
  const [hx, hy, hz] = c.halfExtents;
  const bottom = c.centre[1] - hy, top = c.centre[1] + hy;
  const isWall = c.id.startsWith("wall");
  const courses = Math.max(2, Math.round((hy * 2) / 0.45));
  const ch = (hy * 2 - 0.16) / courses;
  for (let i = 0; i < courses; i++) {
    const inset = isWall ? 0 : (i % 2) * 0.03;
    const tone = lerpHex(PALETTE.stone, PALETTE.stoneDark, (i % 2) * 0.35 + (courses - i) * 0.02);
    b.add(box(hx * 2 - inset, ch - 0.02, hz * 2 - inset), xf(c.centre[0], bottom + ch * (i + 0.5), c.centre[2]), tone);
  }
  b.add(box(hx * 2 + 0.08, 0.16, hz * 2 + 0.08), xf(c.centre[0], top - 0.08, c.centre[2]), isWall ? PALETTE.stoneDark : PALETTE.amber);
  if (!isWall) b.add(box(hx * 2 + 0.06, 0.1, hz * 2 + 0.06), xf(c.centre[0], bottom + 0.05, c.centre[2]), PALETTE.stoneDark);
  return b.build();
}

function railGeometry(c: Collider, glow: Batch): BufferGeometry {
  const b = new Batch();
  if (c.shape !== "cuboid") return b.build();
  const [hx, hy, hz] = c.halfExtents;
  const alongZ = hz >= hx;
  const len = (alongZ ? hz : hx) * 2;
  const top = c.centre[1] + hy, bottom = c.centre[1] - hy;
  b.add(box(alongZ ? 0.12 : len, 0.1, alongZ ? len : 0.12), xf(c.centre[0], top - 0.05, c.centre[2]), PALETTE.woodDark);
  b.add(box(alongZ ? 0.08 : len, 0.07, alongZ ? len : 0.08), xf(c.centre[0], c.centre[1], c.centre[2]), PALETTE.wood);
  const n = Math.floor(len / 2);
  for (let i = 0; i <= n; i++) {
    const t = -len / 2 + 0.09 + ((len - 0.18) * i) / n;
    const px = c.centre[0] + (alongZ ? 0 : t), pz = c.centre[2] + (alongZ ? t : 0);
    b.add(box(0.18, hy * 2, 0.18), xf(px, c.centre[1], pz), PALETTE.woodDark);
    if (i % 2 === 0) glow.add(new SphereGeometry(0.1, 8, 6), xf(px, top + 0.14, pz), PALETTE.amber);
  }
  void bottom;
  return b.build();
}

/** Inverted jagged rock cone under an island. Deterministic jitter, strata colouring by depth. */
function underside(b: Batch, cx: number, cz: number, y: number, rx: number, rz: number, depth: number, rnd: () => number): void {
  const g = new ConeGeometry(1, depth, 9, 3, false);
  const p = g.getAttribute("position");
  for (let i = 0; i < p.count; i++) {
    const vy = p.getY(i);
    const wob = 1 + (rnd() - 0.5) * 0.28 * (vy > depth / 2 - 0.01 ? 0 : 1);
    p.setX(i, p.getX(i) * wob); p.setZ(i, p.getZ(i) * wob);
  }
  g.computeVertexNormals();
  const shade: Shader = (_x, vy) => lerpHex(PALETTE.rockMid, PALETTE.rockLow, (y - vy) / depth);
  b.add(g, xf(cx, y - depth / 2, cz, rx, 1, rz, Math.PI), shade);
}

function insideIsland(colliders: readonly Collider[], x: number, z: number, margin: number): boolean {
  return colliders.some((c) => isGround(c) && c.shape === "cuboid" && Math.abs(x - c.centre[0]) <= c.halfExtents[0] - margin && Math.abs(z - c.centre[2]) <= c.halfExtents[2] - margin)
    || colliders.some((c) => isGround(c) && c.shape === "cylinder" && Math.hypot(x - c.centre[0], z - c.centre[2]) <= c.radius - margin);
}

function nearObstacle(colliders: readonly Collider[], x: number, z: number, margin: number): boolean {
  return colliders.some((c) => c.role !== "ground" && c.shape === "cuboid" && Math.abs(x - c.centre[0]) <= c.halfExtents[0] + margin && Math.abs(z - c.centre[2]) <= c.halfExtents[2] + margin);
}

/** Distant islets as [x, topY, z, radius]. Shared by the code-built islets and the glTF dressing plan. */
export const ISLETS: ReadonlyArray<readonly [number, number, number, number]> = [[-78, -12, -62, 9], [86, -4, -48, 11], [-96, 6, 52, 8], [70, -14, 82, 12], [8, -18, -112, 14], [-30, -6, 104, 10]];

/** Outward distance (m) between a rim boulder's centre and the nearest walkable footprint edge. */
const RIM_OFFSET = 1.1;
const TREE_MODELS: readonly EnvModelId[] = ["CommonTree_1", "Pine_1", "TwistedTree_2"];
const ROCK_MODELS: readonly EnvModelId[] = ["Rock_Medium_1", "Rock_Medium_2", "Rock_Medium_3"];
const MODEL_SCALE: Readonly<Record<EnvModelId, number>> = { CommonTree_1: 1.1, Pine_1: 1.1, TwistedTree_2: 0.55, Bush_Common: 1, Fern_1: 0.1, Bush_Common_Flowers: 0.1, Grass_Common_Short: 0.08, RockPath_Round_Thin: 0.3, Rock_Medium_1: 1, Rock_Medium_2: 1, Rock_Medium_3: 1 };

const groundFootprintGap = (colliders: readonly Collider[], x: number, z: number): number => {
  let gap = Infinity;
  for (const c of colliders) {
    if (!isGround(c)) continue;
    const d = c.shape === "cuboid" ? Math.max(Math.abs(x - c.centre[0]) - c.halfExtents[0], Math.abs(z - c.centre[2]) - c.halfExtents[2]) : Math.hypot(x - c.centre[0], z - c.centre[2]) - c.radius;
    gap = Math.min(gap, d);
  }
  return gap;
};

/**
 * Deterministic placement plan for the glTF dressing (ART1). Every placement is either outside all walkable ground
 * footprints (rim boulders on the island flanks, trees and rocks on the distant islets) or on the top face of a
 * non-walkable obstacle collider (a boulder on each pillar). Low decorative cover is additionally allowed at the east route margins (under 0.15 m).
 */
export function planDressing(colliders: readonly Collider[]): EnvPlacement[] {
  const rnd = mulberry32(0x0a771);
  const out: EnvPlacement[] = [];
  ISLETS.forEach(([x, y, z, r], i) => {
    out.push({ model: TREE_MODELS[i % 3]!, x: x + r * 0.3, y, z, yaw: rnd() * 6.28, scale: MODEL_SCALE[TREE_MODELS[i % 3]!] * (0.9 + rnd() * 0.3) });
    out.push({ model: "Bush_Common", x: x - r * 0.35, y, z: z + r * 0.2, yaw: rnd() * 6.28, scale: 1.4 });
    out.push({ model: ROCK_MODELS[i % 3]!, x: x - r * 0.1, y, z: z - r * 0.45, yaw: rnd() * 6.28, scale: 0.9 + rnd() * 0.5 });
  });
  for (const c of colliders) {
    if (c.role !== "obstacle" || c.shape !== "cuboid" || !c.id.startsWith("pillar")) continue;
    out.push({ model: ROCK_MODELS[out.length % 3]!, x: c.centre[0], y: c.centre[1] + c.halfExtents[1], z: c.centre[2], yaw: rnd() * 6.28, scale: 0.45 });
  }
  const bridges = colliders.filter((c) => c.role === "bridge" && c.shape === "cuboid");
  for (const c of colliders) {
    if (!isGround(c)) continue;
    const perim = c.shape === "cuboid" ? 4 * (c.halfExtents[0] + c.halfExtents[2]) : 2 * Math.PI * c.radius;
    const n = Math.floor(perim / 5);
    for (let k = 0; k < n; k++) {
      const t = (k + rnd() * 0.6) / n;
      let px: number, pz: number;
      if (c.shape === "cuboid") {
        const [hx, hy2] = [c.halfExtents[0], c.halfExtents[2]];
        const u = t * 4 * (hx + hy2);
        const e = u < 2 * hx ? 0 : u < 2 * hx + 2 * hy2 ? 1 : u < 4 * hx + 2 * hy2 ? 2 : 3;
        const o = RIM_OFFSET;
        if (e === 0) { px = c.centre[0] - hx + u; pz = c.centre[2] - hy2 - o; }
        else if (e === 1) { px = c.centre[0] + hx + o; pz = c.centre[2] - hy2 + (u - 2 * hx); }
        else if (e === 2) { px = c.centre[0] + hx - (u - 2 * hx - 2 * hy2); pz = c.centre[2] + hy2 + o; }
        else { px = c.centre[0] - hx - o; pz = c.centre[2] + hy2 - (u - 4 * hx - 2 * hy2); }
      } else {
        const a = t * Math.PI * 2;
        px = c.centre[0] + Math.cos(a) * (c.radius + RIM_OFFSET); pz = c.centre[2] + Math.sin(a) * (c.radius + RIM_OFFSET);
      }
      if (groundFootprintGap(colliders, px, pz) < 0.6) continue;
      if (bridges.some((b) => b.shape === "cuboid" && Math.abs(px - b.centre[0]) < b.halfExtents[0] + 2.5 && Math.abs(pz - b.centre[2]) < b.halfExtents[2] + 2.5)) continue;
      out.push({ model: ROCK_MODELS[Math.floor(rnd() * 3)]!, x: px, y: c.centre[1] + (c.shape === "cuboid" ? c.halfExtents[1] : c.halfHeight) - 2.6, z: pz, yaw: rnd() * 6.28, scale: 0.6 + rnd() * 0.7 });
    }
  }
  // East spawn (-3 z) -> bridge: asymmetric broadleaf gate rooted beyond the island edge.
  // West deck answers with a narrow pine skyline. No solid-looking prop enters a walkable footprint.
  if (colliders.some((c) => c.id === "sat.east")) {
    for (const [x, z, scale] of [[29, -9.5, 0.8], [30.4, 9.9, 1.1]] as const)
      out.push({ model: "CommonTree_1", x, y: -0.6, z, yaw: z < 0 ? 0.7 : 2.3, scale });
    for (const [x, z, scale] of [[-34, -12.5, 1.3], [-39, -13.8, 1.7]] as const)
      out.push({ model: "Pine_1", x, y: -0.8, z, yaw: 1.2, scale });
    for (let i = 0; i < 2; i++) {
      for (const side of [-1, 1]) {
        const x = 32 + i * 6, z = side * (4.6 + (i % 2) * 0.35);
        out.push({ model: "Fern_1", x, y: 0.005, z, yaw: i * 1.7, scale: 0.055 });
        if (i === 0) out.push({ model: "Bush_Common_Flowers", x: x + 0.25, y: 0.005, z: z + side * 0.35, yaw: i, scale: 0.1 });
        out.push({ model: "Grass_Common_Short", x: x - 0.9, y: 0.005, z: z + side * 0.2, yaw: i * 2.1 + side, scale: 0.08 });
        if (i === 1) out.push({ model: "RockPath_Round_Thin", x: x - 0.2, y: 0.003, z: side * 3.8, yaw: i * 0.6, scale: 0.28 });
      }
    }
  }
  return out;
}

/** Instanced glTF dressing for a loaded kit, in one group. Geometry and materials belong to the kit, not to the result. */
export function buildDressing(colliders: readonly Collider[], kit: EnvKit): { group: Group; meshes: InstancedMesh[] } {
  const plan = planDressing(colliders);
  const group = new Group();
  group.name = "env.dressing";
  const far = new Set<EnvModelId>([...TREE_MODELS, "Fern_1", "Bush_Common_Flowers", "Grass_Common_Short"]), meshes: InstancedMesh[] = [];
  // Distant islet props and rim boulders cast no shadows; only the pillar boulders sit in the shadow frustum.
  meshes.push(...instancePlacements(kit, plan.filter((p) => far.has(p.model) || p.model === "Bush_Common"), { cast: false, receive: false }));
  meshes.push(...instancePlacements(kit, plan.filter((p) => !far.has(p.model) && p.model !== "Bush_Common"), { cast: false, receive: true }));
  for (const m of meshes) group.add(m);
  return { group, meshes };
}

export function buildArena(colliders: readonly Collider[], ramp: DataTexture, opts: { detail: number } = { detail: 1 }): ArenaBuild {
  const group = new Group();
  const geometries: BufferGeometry[] = [];
  const materials: Material[] = [];
  const toon = new MeshToonMaterial({ vertexColors: true, gradientMap: ramp });
  const unlit = new MeshBasicMaterial({ vertexColors: true });
  const flatToon = new MeshToonMaterial({ vertexColors: true, gradientMap: ramp });
  materials.push(toon, unlit, flatToon);
  const addMesh = (name: string, g: BufferGeometry, mat: Material, shadows: { cast: boolean; receive: boolean }): Mesh => {
    geometries.push(g);
    const m = new Mesh(g, mat);
    m.name = name;
    m.castShadow = shadows.cast; m.receiveShadow = shadows.receive;
    group.add(m);
    return m;
  };
  const glow = new Batch();
  const rnd = mulberry32(0x7a11e57);

  const posts = new Batch();
  for (const c of colliders) {
    const g = isGround(c) ? groundGeometry(c) : c.role === "bridge" ? bridgeGeometry(c, glow, posts) : c.role === "guardrail" ? railGeometry(c, glow) : obstacleGeometry(c);
    addMesh(c.id, g, toon, { cast: c.role === "obstacle" || c.role === "ground", receive: true });
  }

  if (!posts.empty) addMesh("deco.posts", posts.build(), toon, { cast: false, receive: true });

  // Rock undersides turn the slabs into floating islands.
  const under = new Batch();
  for (const c of colliders) {
    if (!isGround(c) || c.shape !== "cuboid") continue;
    const [hx, hy, hz] = c.halfExtents;
    const bottom = c.centre[1] - hy;
    underside(under, c.centre[0], c.centre[2], bottom + 0.01, hx * 0.98, hz * 0.98, Math.min(hx, hz) * 1.6 + 3, rnd);
  }
  addMesh("deco.under", under.build(), flatToon, { cast: false, receive: false });

  // Non-walkable rock shelves carry the landmark roots beyond the collision footprint.
  const shelves = new Batch();
  for (const p of planDressing(colliders).filter((p) => (p.model === "CommonTree_1" || p.model === "Pine_1") && Math.abs(p.x) < 45 && Math.abs(p.z) < 20)) {
    shelves.add(new DodecahedronGeometry(1, 0), xf(p.x, -2.1, p.z, 2.6, 1.9, 2.6, 0, p.yaw, 0), PALETTE.rockMid);
  }
  if (!shelves.empty) addMesh("deco.rootShelves", shelves.build(), flatToon, { cast: false, receive: true });

  // Ground cover on the playable islands: grass tufts, flowers and small rocks, kept off obstacles and the glyph.
  const cover = new Batch();
  const tufts = Math.round(140 * opts.detail);
  const flowerColors = [0xf7e27a, 0xfff6e6, 0xe98aa8, 0x8fb7ff];
  let placed = 0, tries = 0;
  while (placed < tufts && tries < tufts * 12) {
    tries++;
    const x = (rnd() - 0.5) * 100, z = (rnd() - 0.5) * 80;
    if (!insideIsland(colliders, x, z, 0.5) || nearObstacle(colliders, x, z, 0.4)) continue;
    if (colliders.some((c) => c.role === "bridge" && c.shape === "cuboid" && Math.abs(x - c.centre[0]) < c.halfExtents[0] + 0.3 && Math.abs(z - c.centre[2]) < c.halfExtents[2] + 0.3)) continue;
    if (x > 16 && Math.abs(z) < 6) continue;
    placed++;
    const h = 0.22 + rnd() * 0.28;
    const tone = lerpHex(0x5f9a3a, 0xa6d66a, rnd());
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + rnd();
      b2(cover, x + Math.cos(a) * 0.06, h, z + Math.sin(a) * 0.06, 0.035, tone, (rnd() - 0.5) * 0.5, a);
    }
    if (rnd() < 0.12) cover.add(new SphereGeometry(0.05, 6, 4), xf(x + 0.1, h + 0.05, z), flowerColors[Math.floor(rnd() * flowerColors.length)] ?? 0xffffff);
    if (rnd() < 0.03) cover.add(new DodecahedronGeometry(0.16 + rnd() * 0.12, 0), xf(x, 0.08, z, 1, 0.7, 1, 0, rnd() * 3, 0), lerpHex(PALETTE.rockHi, PALETTE.stone, rnd()));
  }
  addMesh("deco.cover", cover.build(), flatToon, { cast: false, receive: true });

  // Ground glyph at the arena centre: pale inlaid rings and spokes just above the floor.
  const glyph = new Batch();
  const ringMat = (r0: number, r1: number, col: number): void => { glyph.add(new RingGeometry(r0, r1, 64, 1), xf(0, 0.02, 0, 1, 1, 1, -Math.PI / 2), col); };
  ringMat(4.6, 4.85, 0xe9dcb4); ringMat(8.1, 8.26, 0xd7c99e); ringMat(1.2, 1.35, 0xe9dcb4);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    glyph.add(box(0.14, 0.01, 3.2), xf(Math.sin(a) * 3, 0.021, Math.cos(a) * 3, 1, 1, 1, 0, a, 0), 0xd7c99e);
  }
  const glyphMat = new MeshBasicMaterial({ vertexColors: true, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  materials.push(glyphMat);
  addMesh("deco.glyph", glyph.build(), glyphMat, { cast: false, receive: false });

  if (!glow.empty) addMesh("deco.lamps", glow.build(), unlit, { cast: false, receive: false });

  // Distant islets: far enough to read as scenery, each with a small crystal and a tree.
  const far = new Batch();
  const isletTrees = new Batch();
  for (const [x, y, z, r] of ISLETS) {
    far.add(new CylinderGeometry(r, r * 0.95, 1.6, 14, 1), xf(x, y - 0.8, z), (_x, _y, _z, _nx, ny) => (ny > 0.5 ? PALETTE.grassTop : PALETTE.grassSide));
    underside(far, x, z, y - 1.6, r * 0.95, r * 0.95, r * 1.5, rnd);
    isletTrees.add(new CylinderGeometry(0.25, 0.35, 2.6, 6, 1), xf(x + r * 0.3, y + 1.3, z), PALETTE.woodDark);
    isletTrees.add(new ConeGeometry(2.2, 3.4, 7, 1), xf(x + r * 0.3, y + 3.9, z), 0x3f7a3a);
    isletTrees.add(new ConeGeometry(1.6, 2.6, 7, 1), xf(x + r * 0.3, y + 5.6, z), 0x4f8f45);
    isletTrees.add(new OctahedronGeometry(0.9, 0), xf(x - r * 0.3, y + 1.1, z + 1, 0.7, 1.5, 0.7), lerpHex(0xf0a030, 0x5fe3d3, rnd()));
  }
  addMesh("deco.islets", far.build(), flatToon, { cast: false, receive: false });
  // Code-built trees stay as the fallback; the scene hides this mesh once the glTF dressing is in.
  addMesh("deco.isletTrees", isletTrees.build(), flatToon, { cast: false, receive: false });

  // Clouds: flattened puffs below and far around the arena, merged into one mesh.
  const cl = new Batch();
  const puffShade: Shader = (_x, y, _z, _nx, ny) => lerpHex(PALETTE.cloudShade, PALETTE.cloud, Math.min(1, 0.45 + ny * 0.5 + (y > -20 ? 0.1 : 0)));
  for (let i = 0; i < 26; i++) {
    const ang = rnd() * Math.PI * 2, rad = 70 + rnd() * 90, y = -75 + rnd() * 40;
    const cx = Math.cos(ang) * rad, cz = Math.sin(ang) * rad;
    for (let k = 0; k < 4; k++) {
      const s = 7 + rnd() * 9;
      cl.add(new SphereGeometry(1, 10, 6), xf(cx + (rnd() - 0.5) * 18, y + (rnd() - 0.5) * 2, cz + (rnd() - 0.5) * 18, s, s * 0.38, s * 0.9), puffShade);
    }
  }
  const clouds = addMesh("deco.clouds", cl.build(), flatToon, { cast: false, receive: false });

  // Sky dome with a vertical gradient; unaffected by fog.
  const skyG = new SphereGeometry(165, 24, 14);
  const sp = skyG.getAttribute("position");
  const colors: number[] = [];
  const c = new Color();
  for (let i = 0; i < sp.count; i++) {
    const t = sp.getY(i) / 165;
    c.setHex(t >= 0 ? lerpHex(SKY.horizon, SKY.zenith, Math.pow(t, 0.6)) : lerpHex(SKY.horizon, SKY.nadir, Math.min(1, -t * 2)));
    colors.push(c.r, c.g, c.b);
  }
  skyG.setAttribute("color", new Float32BufferAttribute(colors, 3));
  geometries.push(skyG);
  const skyMat = new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false, depthWrite: false });
  materials.push(skyMat);
  const sky = new Mesh(skyG, skyMat);
  sky.name = "deco.sky";
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  group.add(sky);

  return { group, sky, clouds, geometries, materials };
}

/** One grass blade cone merged into a batch, leaning by `lean` radians around `yaw`. */
function b2(b: Batch, x: number, h: number, z: number, r: number, tone: number, lean: number, yaw: number): void {
  b.add(new ConeGeometry(r, h, 4, 1), xf(x, h / 2, z, 1, 1, 1, Math.sin(yaw) * lean, yaw, Math.cos(yaw) * lean), tone);
}
