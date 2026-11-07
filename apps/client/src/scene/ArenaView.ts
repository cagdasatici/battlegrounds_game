/**
 * Original floating island arena visuals (spec sections 10 and 23, task T25). Everything is generated in code from
 * the collider list: grass lipped islands with stratified rock undersides, plank bridges, carved stone pillars and
 * walls, lamp-posted rails, a ground glyph, scattered grass, flowers and rocks, drifting clouds, distant islets and a
 * gradient sky dome. One mesh per collider (named by collider id) keeps visuals and physics in one-to-one
 * correspondence; decoration is merged into a handful of meshes named "deco.*". Presentation only.
 */
import {
  DataTexture, RepeatWrapping, RGBAFormat, SRGBColorSpace, LinearFilter,
  BackSide, BoxGeometry, BufferGeometry, Color, ConeGeometry, CylinderGeometry, DodecahedronGeometry, DoubleSide, Euler, Float32BufferAttribute,
  Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshToonMaterial, OctahedronGeometry, Quaternion, RingGeometry, SphereGeometry, Vector3,
  type Material, type Texture,
} from "three";
import { ARENA, ARENA_SCALE, type Collider } from "@eb/shared/config/arena";
import { ENV_VARIANT, RIM_HEX, cloudAlpha, moteBob, motePlacements, mixHex, mulberry32, plankHex, skyHex, strataHex } from "./EnvPalette.js";
import { GROVE_THEME, type EnvTheme } from "../render/environment/theme.js";
import { groundHex, wearPointsFor, type WearPoint } from "../render/environment/groundShading.js";
import { makeSkyMaterial } from "../render/environment/sky.js";
import { sceneryIslets } from "../render/environment/treePlan.js";
import { instancePlacements, type EnvKit, type EnvModelId, type EnvPlacement } from "./EnvAssets.js";

export const SKY = { horizon: 0xc2d5df, zenith: 0x326b9e, nadir: 0x6e9eae, fog: 0xb7cdd8 } as const;

const PALETTE = {
  grassTop: 0x78916b, grassSide: 0x354f42, soil: 0x7a5636, rockHi: 0x8a7f78, rockMid: 0x645c66, rockLow: 0x403b4a,
  wood: 0xa87a48, woodDark: 0x6b4a2c, stone: 0x9a968f, stoneDark: 0x6c6a70, amber: 0xc79b58, cloud: 0xffffff, cloudShade: 0xb9cde4,
} as const;

export type Shader = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => number;

/** Accumulates transformed, vertex coloured geometry into one BufferGeometry. */
export class Batch {
  private pos: number[] = []; private nor: number[] = []; private col: number[] = []; private uv: number[] = []; private idx: number[] = [];
  private readonly c = new Color();
  add(g: BufferGeometry, m: Matrix4, color: number | Shader): void {
    g.applyMatrix4(m);
    const at = g.getAttribute("position"), nm = g.getAttribute("normal"), ix = g.getIndex();
    const base = this.pos.length / 3;
    for (let i = 0; i < at.count; i++) {
      const x = at.getX(i), y = at.getY(i), z = at.getZ(i), nx = nm.getX(i), ny = nm.getY(i), nz = nm.getZ(i);
      this.pos.push(x, y, z); this.uv.push(x / 4, z / 4); this.nor.push(nx, ny, nz);
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
    g.setAttribute("uv", new Float32BufferAttribute(this.uv, 2));
    g.setAttribute("normal", new Float32BufferAttribute(this.nor, 3));
    g.setAttribute("color", new Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

const tmpE = new Euler(), tmpQ = new Quaternion(), tmpS = new Vector3(1, 1, 1), tmpV = new Vector3();
export const xf = (x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0): Matrix4 => {
  tmpQ.setFromEuler(tmpE.set(rx, ry, rz));
  return new Matrix4().compose(tmpV.set(x, y, z), tmpQ, tmpS.set(sx, sy, sz));
};
const lerpHex = mixHex;
export const box = (w: number, h: number, d: number): BoxGeometry => new BoxGeometry(w, h, d);
/** Drops one face group of a BoxGeometry (0 +x, 1 -x, 2 +y, 3 -y, 4 +z, 5 -z): the finely tessellated meadow lip never shows its underside. */
function withoutFace(g: BoxGeometry, face: number): BoxGeometry {
  const idx = g.getIndex()!, keep: number[] = [];
  g.groups.forEach((grp, i) => { if (i !== face) for (let k = grp.start; k < grp.start + grp.count; k++) keep.push(idx.getX(k)); });
  g.setIndex(keep); g.clearGroups();
  return g;
}

export interface ArenaBuild {
  readonly group: Group;
  /** Sky dome; the scene recentres it on the camera so it never moves relative to the viewer. */
  readonly sky: Mesh;
  readonly clouds: Mesh;
  /** FB08: soft cloud shell child of the sky dome (hidden on low) and bobbing motes; render-loop only. */
  readonly cloudShell: Mesh;
  readonly motes: InstancedMesh;
  /** Sets mote bob for `timeSec` (0 is the rest pose); never touches gameplay state. */
  setMotes(timeSec: number): void;
  readonly geometries: BufferGeometry[];
  readonly materials: Material[];
  /** CRATER01: the ground material, patched so craters cut through it. */
  readonly terrain: Material;
  readonly textures: Texture[];
  /** WORLD01: other ground-hugging materials the crater cut must also open (decals lying on the floor). */
  readonly groundMaterials?: Material[];
  /** WORLD01: per-frame world animation (water, wind); skipped under Reduced Motion. */
  animate?(dtSec: number): void;
}

const RIM_W = 0.32;
/** GFX01: vertex spacing (m) of the walkable top, so ground colour has real resolution on the 1.5x larger islands. */
const GROUND_CELL = 1.6;
const isGround = (c: Collider): boolean => c.role === "ground";

function groundGeometry(c: Collider, all: readonly Collider[], theme: EnvTheme, wear: readonly WearPoint[]): BufferGeometry {
  const b = new Batch();
  const top = c.centre[1] + (c.shape === "cuboid" ? c.halfExtents[1] : c.halfHeight);
  const bottom = top - (c.shape === "cuboid" ? c.halfExtents[1] : c.halfHeight) * 2;
  const lip = 0.38;
  const rock: Shader = (_x, y) => strataHex(ENV_VARIANT.rock, (top - lip - y) / Math.max(1, top - lip - bottom), PALETTE.rockHi, PALETTE.rockLow, 0x4e3a28);
  // GFX01: layered noise meadow with dirt paths and trampled pads (render/environment/groundShading.ts).
  const grass: Shader = (x, _y, z, _nx, ny) => (ny <= 0.5 ? PALETTE.grassSide : groundHex(theme, x, z, wear));
  if (c.shape === "cuboid") {
    const [hx, hy, hz] = c.halfExtents;
    b.add(box(hx * 2, hy * 2 - lip, hz * 2), xf(c.centre[0], bottom + (hy * 2 - lip) / 2, c.centre[2]), rock);
    b.add(withoutFace(new BoxGeometry(hx * 2 + 0.08, lip, hz * 2 + 0.08, Math.ceil(hx * 2 / GROUND_CELL), 1, Math.ceil(hz * 2 / GROUND_CELL)), 3), xf(c.centre[0], top - lip / 2, c.centre[2]), grass);
    // FB08: pale edge strips on the walkable top (inside the collider) so ledges read at a glance; skipped where
    // another island overlaps, so only true outer edges are lit.
    if (ENV_VARIANT.rock > 0) for (const sd of [-1, 1]) {
      const seg = 0.5;
      for (let i = 0; i < hx * 2 / seg; i++) { const x = c.centre[0] - hx + seg * (i + 0.5), z = c.centre[2] + sd * hz; if (!insideIsland(all, x, z + sd * 0.12, 0)) b.add(box(seg, 0.02, RIM_W), xf(x, top + 0.012, z - sd * RIM_W / 2), RIM_HEX); }
      for (let i = 0; i < hz * 2 / seg; i++) { const z = c.centre[2] - hz + seg * (i + 0.5), x = c.centre[0] + sd * hx; if (!insideIsland(all, x + sd * 0.12, z, 0)) b.add(box(RIM_W, 0.02, seg), xf(x - sd * RIM_W / 2, top + 0.012, z), RIM_HEX); }
    }
  } else {
    const h = c.halfHeight * 2;
    b.add(new CylinderGeometry(c.radius, c.radius * 0.96, h - lip, 28, 1), xf(c.centre[0], bottom + (h - lip) / 2, c.centre[2]), rock);
    b.add(new CylinderGeometry(c.radius + 0.04, c.radius + 0.04, lip, 28, 1), xf(c.centre[0], top - lip / 2, c.centre[2]), grass);
    if (ENV_VARIANT.rock > 0) for (let i = 0; i < 24; i++) {
      const a0 = i / 24 * Math.PI * 2, am = a0 + Math.PI / 24;
      if (insideIsland(all, c.centre[0] + Math.cos(am) * (c.radius + 0.12), c.centre[2] - Math.sin(am) * (c.radius + 0.12), 0)) continue;
      b.add(new RingGeometry(c.radius - RIM_W, c.radius, 2, 1, a0, Math.PI / 12), xf(c.centre[0], top + 0.012, c.centre[2], 1, 1, 1, -Math.PI / 2), RIM_HEX);
    }
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
    const tone = plankHex(ENV_VARIANT.bridge, i, n, PALETTE.wood, PALETTE.woodDark);
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

/** Cool slate, sand, warm clay and moss: the tones of the north/west, east, west and south approaches. */
const PILLAR_TONES = [0xa9b2bf, 0xd2bf8c, 0xc98f62, 0x86a070] as const;
const pillarMoss = (id: string): number => [1, 2, 0, 3][Number(id.slice(7)) % 4] ?? 0;

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
    let tone = lerpHex(PALETTE.stone, PALETTE.stoneDark, (i % 2) * 0.35 + (courses - i) * 0.02);
    // QE02: each pillar weathers differently (moss creeps up a different number of courses, in its quadrant's tone).
    if (!isWall) tone = lerpHex(tone, PILLAR_TONES[Number(c.id.slice(7)) % 4]!, 0.4);
    if (!isWall && i < pillarMoss(c.id)) tone = lerpHex(tone, 0x6f8a58, 0.5);
    b.add(box(hx * 2 - inset, ch - 0.02, hz * 2 - inset), xf(c.centre[0], bottom + ch * (i + 0.5), c.centre[2]), tone);
  }
  b.add(box(hx * 2 + 0.08, 0.16, hz * 2 + 0.08), xf(c.centre[0], top - 0.08, c.centre[2]), isWall ? PALETTE.stoneDark : PALETTE.amber);
  if (!isWall) {
    b.add(box(hx * 2 + 0.06, 0.1, hz * 2 + 0.06), xf(c.centre[0], bottom + 0.05, c.centre[2]), PALETTE.stoneDark);
    // Inlaid flutes and small diamond seals keep the original collision silhouette.
    for (const side of [-1, 1]) for (const axis of [0, 1]) {
      const x = c.centre[0] + (axis === 0 ? side * (hx + 0.006) : 0);
      const z = c.centre[2] + (axis === 1 ? side * (hz + 0.006) : 0);
      b.add(box(axis === 0 ? 0.012 : 0.075, hy * 1.35, axis === 1 ? 0.012 : 0.075), xf(x, c.centre[1], z), PALETTE.stoneDark);
      b.add(new OctahedronGeometry(0.16, 0), xf(x, top - 0.42, z, axis === 0 ? 0.12 : 1, 1, axis === 1 ? 0.12 : 1), PALETTE.amber);
    }
  }
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
  const shade: Shader = (_x, vy) => (ENV_VARIANT.rock > 0 ? strataHex(ENV_VARIANT.rock, (y - vy) / depth * 0.75 + 0.25, PALETTE.rockHi, PALETTE.rockLow, PALETTE.rockMid) : lerpHex(PALETTE.rockMid, PALETTE.rockLow, (y - vy) / depth));
  b.add(g, xf(cx, y - depth / 2, cz, rx, 1, rz, Math.PI), shade);
}

function insideIsland(colliders: readonly Collider[], x: number, z: number, margin: number): boolean {
  return colliders.some((c) => isGround(c) && c.shape === "cuboid" && Math.abs(x - c.centre[0]) <= c.halfExtents[0] - margin && Math.abs(z - c.centre[2]) <= c.halfExtents[2] - margin)
    || colliders.some((c) => isGround(c) && c.shape === "cylinder" && Math.hypot(x - c.centre[0], z - c.centre[2]) <= c.radius - margin);
}

function nearObstacle(colliders: readonly Collider[], x: number, z: number, margin: number): boolean {
  return colliders.some((c) => c.role !== "ground" && c.shape === "cuboid" && Math.abs(x - c.centre[0]) <= c.halfExtents[0] + margin && Math.abs(z - c.centre[2]) <= c.halfExtents[2] + margin);
}

/** ARENA01: sky dome radius (m), scaled with the world so distant islets stay inside it; the camera far plane is larger. */
const SKY_RADIUS = 165 * ARENA_SCALE;

/** Distant islets as [x, topY, z, radius]. Shared by the code-built islets and the glTF dressing plan. */
export const ISLETS: ReadonlyArray<readonly [number, number, number, number]> = ([[-78, -12, -62, 9], [86, -4, -48, 11], [-96, 6, 52, 8], [70, -14, 82, 12], [8, -18, -112, 14], [-30, -6, 104, 10]] as const)
  .map(([x, y, z, r]) => [x * ARENA_SCALE, y, z * ARENA_SCALE, r] as const); // ARENA01: positions spread with the world, sizes unchanged

/** GFX01: extra far scenery islets (positions pure, see render/environment/treePlan.ts); trees on all islets come from the environment layer. */
export const SCENERY_ISLETS: ReadonlyArray<readonly [number, number, number, number]> = sceneryIslets(ARENA_SCALE, ISLETS);

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
 * QE02: one distinct landmark per island approach, all outside walkable ground (the plan test checks every crown).
 * East keeps the approved flowering grove; north is tall pines over slate, west a broad common-tree crown over warm
 * rock, south twisted silhouettes over low fern banks. Smaller flush accents (under 0.15 m) repeat each approach's
 * species along its bridge mouths. `extra` props drop on the low tier.
 */
function planApproaches(): EnvPlacement[] {
  const out: EnvPlacement[] = [];
  const add = (p: EnvPlacement): void => { out.push(p); };
  // East: the approved gate pair, flowers, fern, grass and flush stone beyond the walkable mouth.
  for (const [x, z, scale] of [[29, -9.5, 0.8], [30.4, 9.9, 1.1]] as const)
    add({ model: "CommonTree_1", x, y: -0.6, z, yaw: z < 0 ? 0.7 : 2.3, scale, region: "e" });
  for (let i = 0; i < 2; i++) {
    for (const side of [-1, 1]) {
      const x = 32 + i * 6, z = side * (4.6 + (i % 2) * 0.35);
      add({ model: "Fern_1", x, y: 0.005, z, yaw: i * 1.7, scale: 0.055, region: "e" });
      if (i === 0) add({ model: "Bush_Common_Flowers", x: x + 0.25, y: 0.005, z: z + side * 0.35, yaw: i, scale: 0.1, region: "e" });
      add({ model: "Grass_Common_Short", x: x - 0.9, y: 0.005, z: z + side * 0.2, yaw: i * 2.1 + side, scale: 0.08, region: "e" });
      if (i === 1) add({ model: "RockPath_Round_Thin", x: x - 0.2, y: 0.003, z: side * 3.8, yaw: i * 0.6, scale: 0.28, region: "e" });
    }
  }
  // East: a flowering hedge behind the far satellite rail puts the grove in the bridge sightline (solid, outside the footprint).
  for (const [x, z, scale, yaw] of [[44.4, -3.4, 1.15, 0.5], [44.1, 2.9, 1, 2.2], [45.4, -0.2, 0.8, 4.1]] as const)
    add({ model: "Bush_Common_Flowers", x, y: -0.5, z, yaw, scale, region: "e" });
  // North: a tall pine pair behind the far satellite (it frames the sightline across the bridge), a supporting pair on
  // the flanks of the gap, and a cool slate rock group.
  for (const [x, z, scale, yaw, extra] of [[-8.8, -44.5, 1.45, 0.4, false], [9.6, -46, 1.2, 3, false], [-11.5, -25.5, 1.1, 1.9, true], [10.8, -27.3, 1, 2.6, true]] as const)
    add({ model: "Pine_1", x, y: -0.8, z, yaw, scale, region: "n", extra });
  for (const [x, z, scale, ry] of [[-4.5, -40.2, 0.9, 0.3], [0.5, -41.4, 1.2, 2.1], [4.3, -40.1, 0.8, 4.4]] as const)
    add({ model: "Rock_Medium_2", x, y: -2.3, z, yaw: ry, scale, tint: 0xb8c4d6, region: "n" });
  // West: a broad common-tree pair behind the far satellite, one supporting flank tree, and a warm rock group; no
  // flowers, so it never reads as the east grove.
  for (const [x, z, scale, yaw, extra] of [[-46.5, -5.5, 1.2, 5.1, false], [-48.5, 6.5, 0.85, 1.4, false]] as const)
    add({ model: "CommonTree_1", x, y: -0.6, z, yaw, scale, region: "w", extra });
  for (const [x, z, scale, ry, extra] of [[-27.4, -9.2, 1.1, 0.5, false], [-26.2, -11, 0.7, 2.6, false], [-36.5, -9.6, 0.9, 4.2, true]] as const)
    add({ model: "Rock_Medium_3", x, y: -2.3, z, yaw: ry, scale, tint: 0xffcf9a, region: "w", extra });
  // South: twisted silhouettes behind the far satellite (a supporting one on the flank) over low fern banks.
  for (const [x, z, scale, yaw, extra] of [[-4.5, 43.8, 0.6, 1, false], [6.8, 45.5, 0.5, 2.2, false]] as const)
    add({ model: "TwistedTree_2", x, y: -0.8, z, yaw, scale, region: "s", extra });
  for (const side of [-1, 1]) for (const [dx, z, sc] of [[3.3, 18.2, 0.055], [4.6, 19.1, 0.05], [3.9, 27.3, 0.055], [5.2, 28.6, 0.05]] as const)
    add({ model: "Fern_1", x: side * dx, y: 0.005, z, yaw: dx * side, scale: sc, region: "s", extra: dx > 4.5 });
  // Small repeats along the other three bridge mouths.
  for (const side of [-1, 1]) {
    add({ model: "Grass_Common_Short", x: side * 3.6, y: 0.005, z: -17.2, yaw: side, scale: 0.08, region: "n" });
    add({ model: "Grass_Common_Short", x: -22.8, y: 0.005, z: side * 3.7, yaw: side * 2, scale: 0.08, region: "w" });
    add({ model: "Grass_Common_Short", x: -32.5, y: 0.005, z: side * 4.4, yaw: side * 0.7, scale: 0.08, region: "w" });
    add({ model: "Fern_1", x: side * 3.2, y: 0.005, z: -28, yaw: side, scale: 0.05, region: "n" });
  }
  // The plan above was authored for the original 48 x 40 main island; each approach moves out with its satellite (BEAST01, ARENA01).
  const dx = (ARENA.main.width - 48) / 2, dz = (ARENA.main.depth - 40) / 2;
  const shift: Record<string, readonly [number, number]> = { e: [dx, 0], w: [-dx, 0], n: [0, -dz], s: [0, dz] };
  return out.map((p) => { const d = shift[p.region ?? ""]; return d ? { ...p, x: p.x + d[0], z: p.z + d[1] } : p; });
}

/**
 * Deterministic placement plan for the glTF dressing (ART1). Every placement is either outside all walkable ground
 * footprints (rim boulders on the island flanks, trees and rocks on the distant islets) or on the top face of a
 * non-walkable obstacle collider (a boulder on each pillar). Low decorative cover is additionally allowed at the east route margins (under 0.15 m).
 */
export function planDressing(colliders: readonly Collider[]): EnvPlacement[] {
  const rnd = mulberry32(0x0a771);
  const out: EnvPlacement[] = [];
  ISLETS.forEach(([x, y, z, r], i) => {
    // QE02: one region per islet so the frustum culls the five that are behind the camera.
    const region = `i${i}`;
    // Islets alternate the two lighter species; the twisted tree is reserved for the south landmark.
    const treeModel = TREE_MODELS[i % 2]!;
    out.push({ model: treeModel, x: x + r * 0.3, y, z, yaw: rnd() * 6.28, scale: MODEL_SCALE[treeModel] * (0.9 + rnd() * 0.3), region });
    out.push({ model: "Bush_Common", x: x - r * 0.35, y, z: z + r * 0.2, yaw: rnd() * 6.28, scale: 1.4, region });
    out.push({ model: ROCK_MODELS[i % 3]!, x: x - r * 0.1, y, z: z - r * 0.45, yaw: rnd() * 6.28, scale: 0.9 + rnd() * 0.5, region });
  });
  for (const c of colliders) {
    if (c.role !== "obstacle" || c.shape !== "cuboid" || !c.id.startsWith("pillar")) continue;
    // QE02: each pillar crowns with a different boulder, size and tint so the ring reads as four places, not one repeat.
    const n = Number(c.id.slice(7));
    out.push({ model: ROCK_MODELS[(n + 1) % 3]!, x: c.centre[0] + (n % 2 ? 0.25 : -0.2), y: c.centre[1] + c.halfExtents[1], z: c.centre[2], yaw: rnd() * 6.28, scale: [0.34, 0.52, 0.42, 0.6][n % 4]!, tint: [0xb8c4d6, 0xffd9b0, 0xc9d8b8, 0xffffff][n % 4]! });
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
      if (k % 2 === 1) continue; // QE02: thinned by half to free triangle budget for the approach landmarks
      if (groundFootprintGap(colliders, px, pz) < 0.6) continue;
      if (bridges.some((b) => b.shape === "cuboid" && Math.abs(px - b.centre[0]) < b.halfExtents[0] + 2.5 && Math.abs(pz - b.centre[2]) < b.halfExtents[2] + 2.5)) continue;
      out.push({ model: ROCK_MODELS[Math.floor(rnd() * 3)]!, x: px, y: c.centre[1] + (c.shape === "cuboid" ? c.halfExtents[1] : c.halfHeight) - 2.6, z: pz, yaw: rnd() * 6.28, scale: 0.6 + rnd() * 0.7, region: `r${px < 0 ? 0 : 1}${pz < 0 ? 0 : 1}` });
    }
  }
  if (colliders.some((c) => c.id === "sat.east")) out.push(...planApproaches());
  return out;
}

/**
 * Instanced glTF dressing for a loaded kit. Core props live in `env.dressing`; supporting props sit in the child group
 * `env.dressing.extra`, which the scene hides on the low tier. Geometry and materials belong to the kit, not to the result.
 */
export function buildDressing(colliders: readonly Collider[], kit: EnvKit): { group: Group; meshes: InstancedMesh[]; extra: Group } {
  const plan = planDressing(colliders);
  const group = new Group();
  group.name = "env.dressing";
  const extra = new Group();
  extra.name = "env.dressing.extra";
  group.add(extra);
  const far = new Set<EnvModelId>([...TREE_MODELS, "Fern_1", "Bush_Common_Flowers", "Grass_Common_Short"]), meshes: InstancedMesh[] = [];
  // Distant islet props and rim boulders cast no shadows; only the pillar boulders sit in the shadow frustum.
  for (const [target, subset] of [[group, plan.filter((p) => !p.extra)], [extra, plan.filter((p) => p.extra)]] as const) {
    const made = [
      ...instancePlacements(kit, subset.filter((p) => far.has(p.model) || p.model === "Bush_Common"), { cast: false, receive: false }),
      ...instancePlacements(kit, subset.filter((p) => !far.has(p.model) && p.model !== "Bush_Common"), { cast: false, receive: true }),
    ];
    for (const m of made) target.add(m);
    meshes.push(...made);
  }
  return { group, meshes, extra };
}

/** Original small repeating grass/grain texture. No external bitmap or canvas allocation. */
function meadowTexture(): DataTexture {
  const size = 128, pixels = new Uint8Array(size * size * 4), rnd = mulberry32(0x6b73);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const grain = rnd() * 5;
    const blade = ((x * 7 + y * 3) % 19 < 2) ? 5 : 0;
    const value = 231 + grain + blade + 3 * Math.sin(x * .34) * Math.sin(y * .28);
    pixels[i] = value; pixels[i + 1] = value + 3; pixels[i + 2] = value - 5; pixels[i + 3] = 255;
  }
  const texture = new DataTexture(pixels, size, size, RGBAFormat);
  texture.wrapS = texture.wrapT = RepeatWrapping; texture.magFilter = LinearFilter;
  texture.colorSpace = SRGBColorSpace; texture.needsUpdate = true; return texture;
}

export function buildArena(colliders: readonly Collider[], ramp: DataTexture, opts: { detail: number; theme?: EnvTheme } = { detail: 1 }): ArenaBuild {
  const theme = opts.theme ?? GROVE_THEME;
  const wear = wearPointsFor(colliders, ARENA.spawnAnchors);
  const group = new Group();
  const geometries: BufferGeometry[] = [];
  const materials: Material[] = [];
  const toon = new MeshToonMaterial({ vertexColors: true, gradientMap: ramp });
  const unlit = new MeshBasicMaterial({ vertexColors: true });
  const flatToon = new MeshToonMaterial({ vertexColors: true, gradientMap: ramp });
  const grassMap = meadowTexture();
  const terrain = new MeshToonMaterial({ vertexColors: true, gradientMap: ramp, map: grassMap });
  materials.push(toon, unlit, flatToon, terrain);
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
    const g = isGround(c) ? groundGeometry(c, colliders, theme, wear) : c.role === "bridge" ? bridgeGeometry(c, glow, posts) : c.role === "guardrail" ? railGeometry(c, glow) : obstacleGeometry(c);
    addMesh(c.id, g, isGround(c) ? terrain : toon, { cast: c.role === "obstacle" || c.role === "ground", receive: true });
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
  for (const c of colliders) {
    if (!isGround(c) || c.shape !== "cuboid") continue;
    const [hx, hy, hz] = c.halfExtents;
    for (let side = 0; side < 4; side++) for (let i = 0; i < 7; i++) {
      const t = (i + 0.5) / 7 * 2 - 1;
      const x = c.centre[0] + (side < 2 ? (side === 0 ? -1 : 1) * (hx + 0.35) : t * hx);
      const z = c.centre[2] + (side >= 2 ? (side === 2 ? -1 : 1) * (hz + 0.35) : t * hz);
      if (insideIsland(colliders, x, z, 0)) continue;
      under.add(new DodecahedronGeometry(1, 0), xf(x, c.centre[1] - hy - 0.4, z, 0.8 + rnd(), 1.5 + rnd() * 2, 0.9 + rnd(), 0.2, rnd() * 3, 0.1), lerpHex(0x49555f, 0x84908a, rnd()));
    }
  }
  addMesh("deco.under", under.build(), flatToon, { cast: false, receive: false });

  // Non-walkable rock shelves carry the landmark roots and rock groups beyond the collision footprint.
  const shelves = new Batch();
  for (const p of planDressing(colliders).filter((p) => p.region && /^[nsew]$/.test(p.region) && p.y < 0)) {
    const tree = p.model === "CommonTree_1" || p.model === "Pine_1" || p.model === "TwistedTree_2";
    shelves.add(new DodecahedronGeometry(1, 0), xf(p.x, tree ? -2.1 : -2.0, p.z, tree ? 2.6 : 1.5 * p.scale + 0.6, tree ? 1.9 : 1.2, tree ? 2.6 : 1.5 * p.scale + 0.6, 0, p.yaw, 0), PALETTE.rockMid);
  }
  if (!shelves.empty) addMesh("deco.rootShelves", shelves.build(), flatToon, { cast: false, receive: true });

  // Ground cover on the playable islands: grass tufts, flowers and small rocks, kept off obstacles and the glyph.
  const cover = new Batch(), coverLow = new Batch();
  const tufts = Math.round(140 * opts.detail);
  const flowerColors = [0xf7e27a, 0xfff6e6, 0xe98aa8, 0x8fb7ff];
  let placed = 0, tries = 0;
  while (placed < tufts && tries < tufts * 12) {
    tries++;
    const x = (rnd() - 0.5) * 100 * ARENA_SCALE, z = (rnd() - 0.5) * 80 * ARENA_SCALE;
    if (!insideIsland(colliders, x, z, 0.5) || nearObstacle(colliders, x, z, 0.4)) continue;
    if (colliders.some((c) => c.role === "bridge" && c.shape === "cuboid" && Math.abs(x - c.centre[0]) < c.halfExtents[0] + 0.3 && Math.abs(z - c.centre[2]) < c.halfExtents[2] + 0.3)) continue;
    if (x > 16 && Math.abs(z) < 6) continue;
    placed++;
    // QE02: every third tuft is also kept on the low tier (about 1 000 triangles) so low no longer reads as bare plain.
    const out = placed % 3 === 0 ? coverLow : cover;
    const h = 0.22 + rnd() * 0.28;
    const tone = lerpHex(0x5f9a3a, 0xa6d66a, rnd());
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + rnd();
      b2(out, x + Math.cos(a) * 0.06, h, z + Math.sin(a) * 0.06, 0.035, tone, (rnd() - 0.5) * 0.5, a);
    }
    if (rnd() < 0.12) out.add(new SphereGeometry(0.05, 6, 4), xf(x + 0.1, h + 0.05, z), flowerColors[Math.floor(rnd() * flowerColors.length)] ?? 0xffffff);
    if (rnd() < 0.03) out.add(new DodecahedronGeometry(0.16 + rnd() * 0.12, 0), xf(x, 0.08, z, 1, 0.7, 1, 0, rnd() * 3, 0), lerpHex(PALETTE.rockHi, PALETTE.stone, rnd()));
  }
  addMesh("deco.coverLow", coverLow.build(), flatToon, { cast: false, receive: true });
  addMesh("deco.cover", cover.build(), flatToon, { cast: false, receive: true });

  // QE02: island boundary vs safe bridge. A darker meadow band follows each outer edge and stops 0.3 m short of every
  // bridge mouth, where paired flush stepping slabs (one tone per approach) mark the way across. All under 0.07 m tall.
  const edge = new Batch(), slabs = new Batch();
  const bridgesC = colliders.filter((c) => c.role === "bridge" && c.shape === "cuboid");
  const approachTone: Record<string, number> = { north: 0xa9b2bf, west: 0xc9a27a, south: 0x8fa07a, east: 0xcdbb94 };
  for (const c of colliders) {
    if (!isGround(c) || c.shape !== "cuboid") continue;
    const [hx, , hz] = c.halfExtents;
    for (const axis of ["x", "z"] as const) for (const sign of [-1, 1]) {
      if (c.id === "main.x" && axis === "z") continue; // internal seam of the rounded cross
      if (c.id === "main.z" && axis === "x") continue;
      const e = (axis === "x" ? c.centre[0] + sign * hx : c.centre[2] + sign * hz);
      const half = axis === "x" ? hz : hx, mid = axis === "x" ? c.centre[2] : c.centre[0];
      let segs: Array<[number, number]> = [[mid - half + 0.2, mid + half - 0.2]];
      for (const b of bridgesC) {
        if (b.shape !== "cuboid") continue;
        const bAlongX = b.halfExtents[0] >= b.halfExtents[2];
        if ((axis === "x") !== bAlongX) continue;
        const bEnd = axis === "x" ? [b.centre[0] - b.halfExtents[0], b.centre[0] + b.halfExtents[0]] : [b.centre[2] - b.halfExtents[2], b.centre[2] + b.halfExtents[2]];
        if (!bEnd.some((v) => Math.abs(v - e) < 0.2)) continue;
        const lat = axis === "x" ? b.centre[2] : b.centre[0], lw = (axis === "x" ? b.halfExtents[2] : b.halfExtents[0]) + 0.3;
        segs = segs.flatMap(([lo, hi]) => [[lo, Math.min(hi, lat - lw)], [Math.max(lo, lat + lw), hi]] as Array<[number, number]>).filter(([lo, hi]) => hi - lo > 0.4);
      }
      for (const [lo, hi] of segs) {
        const len = hi - lo, m2 = (lo + hi) / 2, inset = e - sign * 0.42;
        edge.add(box(axis === "x" ? 0.5 : len, 0.02, axis === "x" ? len : 0.5), xf(axis === "x" ? inset : m2, 0.02, axis === "x" ? m2 : inset), 0x56693f);
      }
    }
  }
  for (const b of bridgesC) {
    if (b.shape !== "cuboid") continue;
    const alongX = b.halfExtents[0] >= b.halfExtents[2];
    const name = alongX ? (b.centre[0] > 0 ? "east" : "west") : b.centre[2] > 0 ? "south" : "north";
    const lenH = alongX ? b.halfExtents[0] : b.halfExtents[2], latC = alongX ? b.centre[2] : b.centre[0], axC = alongX ? b.centre[0] : b.centre[2];
    const lw = (alongX ? b.halfExtents[2] : b.halfExtents[0]) + 0.9;
    for (const end of [-1, 1]) for (const [d, side, r] of [[0.8, -1, 0.42], [0.9, 1, 0.38], [2.0, -1, 0.34], [2.1, 1, 0.4]] as const) {
      const ax = axC + end * (lenH + d), lt = latC + side * lw;
      const g = new CylinderGeometry(r, r * 1.06, 0.06, 7, 1);
      slabs.add(g, xf(alongX ? ax : lt, 0.03, alongX ? lt : ax, 1, 1, 1, 0, ax * 3.1 + lt, 0), lerpHex(approachTone[name]!, 0x77736c, (d - 0.8) * 0.2));
    }
  }
  addMesh("deco.edge", edge.build(), flatToon, { cast: false, receive: true });
  addMesh("deco.slabs", slabs.build(), flatToon, { cast: false, receive: true });

  // VIS01: a weathered radial stone court and broken flagstone approaches. All are flush decoration.
  const court = new Batch();
  for (let band = 0; band < 5; band++) {
    const inner = band * 1.72 + 0.12, outer = inner + 1.66, count = 12 + band * 6;
    for (let i = 0; i < count; i++) {
      const a = i / count * Math.PI * 2 + (band % 2) * 0.11;
      const tone = lerpHex(0x647776, 0xabb3a1, rnd() * 0.55 + band * 0.045);
      court.add(new RingGeometry(inner, outer, 4, 1, a + 0.007, Math.PI * 2 / count - 0.014), xf(0, 0.012, 0, 1, 1, 1, -Math.PI / 2), tone);
    }
  }
  for (let route = 0; route < 4; route++) {
    const a = route * Math.PI / 2;
    for (let i = 0; i < 8; i++) for (const side of [-1, 1]) {
      const d = 9.2 + i * 1.12, lateral = side * (0.42 + rnd() * 0.12);
      const x = Math.sin(a) * d + Math.cos(a) * lateral, z = Math.cos(a) * d - Math.sin(a) * lateral;
      if (!insideIsland(colliders, x, z, 0.9)) continue;
      court.add(new CylinderGeometry(0.48, 0.5, 0.025, 6), xf(x, 0.017, z, 1, 1, 0.76, 0, a + rnd() * 0.3, 0), lerpHex(0x7a8580, 0xb5af95, rnd() * 0.7));
    }
  }
  addMesh("deco.court", court.build(), terrain, { cast: false, receive: true });

  // Ground glyph at the arena centre: pale inlaid rings and spokes just above the floor.
  const glyph = new Batch();
  const ringMat = (r0: number, r1: number, col: number): void => { glyph.add(new RingGeometry(r0, r1, 64, 1), xf(0, 0.02, 0, 1, 1, 1, -Math.PI / 2), col); };
  ringMat(4.72, 4.78, 0xe9dcb4); ringMat(8.45, 8.52, 0xd7c99e); ringMat(1.2, 1.25, 0xe9dcb4);
  for (let i = 0; i < 24; i++) {
    const a = i / 24 * Math.PI * 2;
    glyph.add(box(0.055, 0.01, i % 3 === 0 ? 0.55 : 0.22), xf(Math.sin(a) * 8.15, 0.023, Math.cos(a) * 8.15, 1, 1, 1, 0, a, 0), 0xddc89a);
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    glyph.add(box(0.045, 0.01, 2.9), xf(Math.sin(a) * 3, 0.021, Math.cos(a) * 3, 1, 1, 1, 0, a, 0), 0xd7c99e);
  }
  const glyphMat = new MeshBasicMaterial({ transparent: true, opacity: .48, vertexColors: true, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
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
  for (const [x, y, z, r] of SCENERY_ISLETS) {
    far.add(new CylinderGeometry(r, r * 0.95, 1.6, 14, 1), xf(x, y - 0.8, z), (_x, _y, _z, _nx, ny) => (ny > 0.5 ? lerpHex(PALETTE.grassTop, 0x5f8a55, rnd()) : PALETTE.grassSide));
    underside(far, x, z, y - 1.6, r * 0.95, r * 0.95, r * 1.7, rnd);
  }
  addMesh("deco.islets", far.build(), flatToon, { cast: false, receive: false });
  // Code-built trees stay as the fallback; the scene hides this mesh once the glTF dressing is in.
  addMesh("deco.isletTrees", isletTrees.build(), flatToon, { cast: false, receive: false });

  // Clouds: flattened puffs below and far around the arena, merged into one mesh.
  const cl = new Batch();
  const puffShade: Shader = (_x, y, _z, _nx, ny) => lerpHex(PALETTE.cloudShade, PALETTE.cloud, Math.min(1, 0.45 + ny * 0.5 + (y > -20 ? 0.1 : 0)));
  for (let i = 0; i < 26; i++) {
    const ang = rnd() * Math.PI * 2, rad = (70 + rnd() * 90) * ARENA_SCALE, y = -75 + rnd() * 40;
    const cx = Math.cos(ang) * rad, cz = Math.sin(ang) * rad;
    for (let k = 0; k < 4; k++) {
      const s = 7 + rnd() * 9;
      cl.add(new SphereGeometry(1, 8, 5), xf(cx + (rnd() - 0.5) * 18, y + (rnd() - 0.5) * 2, cz + (rnd() - 0.5) * 18, s, s * 0.38, s * 0.9), puffShade);
    }
  }
  const clouds = addMesh("deco.clouds", cl.build(), flatToon, { cast: false, receive: false });

  // Sky dome with a vertical gradient; unaffected by fog.
  // GFX01: procedural gradient + sun disc (render/environment/sky.ts); the sun sits where the directional light points.
  const skyG = new SphereGeometry(SKY_RADIUS, 48, 24);
  // Distant suspended spires belong to the sky, so camera movement cannot expose a backdrop edge.
  const horizon = new Batch();
  for (let i = 0; i < 16; i++) {
    const a = i / 16 * Math.PI * 2, r = 138 * ARENA_SCALE, x = Math.cos(a) * r, z = Math.sin(a) * r, y = -17 - rnd() * 12;
    const w = 3.5 + rnd() * 5, h = 4 + rnd() * 6, tone = lerpHex(0x85a9b6, 0xb5c9d0, rnd());
    horizon.add(new DodecahedronGeometry(1, 0), xf(x, y, z, w, 2, w * 0.7, 0, a, 0), tone);
    horizon.add(new DodecahedronGeometry(1, 0), xf(x + w * 0.12, y - h * 0.6, z, w * 0.62, h, w * 0.48, 0.2, a, 0.12), tone);
  }
  const backdrop = addMesh("deco.horizon", horizon.build(), new MeshBasicMaterial({ vertexColors: true, fog: false, side: DoubleSide }), { cast: false, receive: false });
  materials.push(backdrop.material as Material);
  geometries.push(skyG);
  const skyMat = makeSkyMaterial(theme);
  materials.push(skyMat);
  const sky = new Mesh(skyG, skyMat);
  sky.name = "deco.sky";
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  group.add(sky);
  sky.add(backdrop);

  // FB08: soft cloud layer, a 256x128 alpha mask on a slightly smaller shell inside the dome (one draw call, medium and high).
  const maskW = 256, maskH = 128, mask = cloudAlpha(maskW, maskH, 0xc10ad);
  const px = new Uint8Array(maskW * maskH * 4);
  for (let i = 0; i < mask.length; i++) { px[i * 4] = 255; px[i * 4 + 1] = 255; px[i * 4 + 2] = 255; px[i * 4 + 3] = mask[i]!; }
  const cloudTex = new DataTexture(px, maskW, maskH, RGBAFormat);
  cloudTex.wrapS = RepeatWrapping; cloudTex.colorSpace = SRGBColorSpace; cloudTex.magFilter = LinearFilter; cloudTex.minFilter = LinearFilter; cloudTex.flipY = true; cloudTex.needsUpdate = true;
  const shellG = new SphereGeometry(SKY_RADIUS - 5, 32, 16);
  const shellMat = new MeshBasicMaterial({ map: cloudTex, transparent: true, side: BackSide, fog: false, depthWrite: false, opacity: 0.9 });
  geometries.push(shellG); materials.push(shellMat);
  const cloudShell = new Mesh(shellG, shellMat);
  cloudShell.name = "deco.cloudShell"; cloudShell.renderOrder = -9; cloudShell.frustumCulled = false;
  sky.add(cloudShell);

  // FB08: ambient motes, one InstancedMesh of small drifting rocks around and below the islands.
  const spots = motePlacements(28, 0x3071e);
  const moteG = new OctahedronGeometry(1, 0), moteMat = new MeshToonMaterial({ color: 0xcdd6cf, gradientMap: ramp });
  geometries.push(moteG); materials.push(moteMat);
  const motes = new InstancedMesh(moteG, moteMat, spots.length);
  motes.name = "deco.motes"; motes.frustumCulled = false;
  group.add(motes);
  const mm = new Matrix4();
  const setMotes = (timeSec: number): void => {
    spots.forEach((m, i) => { motes.setMatrixAt(i, mm.compose(tmpV.set(m.x, m.y + moteBob(m.phase, timeSec), m.z), tmpQ.setFromEuler(tmpE.set(0, m.phase + timeSec * 0.05, 0)), tmpS.set(m.size, m.size * 1.3, m.size))); });
    motes.instanceMatrix.needsUpdate = true;
  };
  setMotes(0);

  return { group, sky, clouds, cloudShell, motes, setMotes, geometries, materials, textures: [grassMap, cloudTex], terrain, groundMaterials: [glyphMat] };
}

/** One grass blade cone merged into a batch, leaning by `lean` radians around `yaw`. */
function b2(b: Batch, x: number, h: number, z: number, r: number, tone: number, lean: number, yaw: number): void {
  b.add(new ConeGeometry(r, h, 4, 1), xf(x, h / 2, z, 1, 1, 1, Math.sin(yaw) * lean, yaw, Math.cos(yaw) * lean), tone);
}
