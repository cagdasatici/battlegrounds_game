/**
 * Builds a rigged fighter from the shared original rig and design data (packages/shared rig.ts, fighterDesign.ts):
 * one merged, rigidly skinned mesh per fighter with vertex colours (body, glow and outline passes, three draw
 * calls), an Object3D bone hierarchy and AnimationClips. Pure Three.js geometry; no DOM, no loaded files. The same
 * geometry is exported to glTF by ops/scripts/build-art.ts.
 */
import {
  AnimationClip, BackSide, Bone, BoxGeometry, BufferAttribute, BufferGeometry, CapsuleGeometry, Color, ConeGeometry,
  CylinderGeometry, DataTexture, Euler, Float32BufferAttribute, LinearFilter, LinearMipmapLinearFilter, Matrix4, MeshBasicMaterial,
  MeshToonMaterial, NearestFilter, Quaternion, QuaternionKeyframeTrack, RedFormat, RGBAFormat, SRGBColorSpace, Skeleton, SkinnedMesh, SphereGeometry, TorusGeometry, Uint16BufferAttribute,
  Vector3, VectorKeyframeTrack, type KeyframeTrack,
} from "three";
import type { KitId } from "@eb/shared/protocol";
import { FIGHTER_DESIGNS, type PartDef } from "@eb/shared/fighterDesign";
import { BONES, BONE_NAMES, boneRestWorld, buildKitClips, type BoneName, type ClipData, type ClipPhases } from "@eb/shared/rig";

/** Outline thickness in metres, added to every part dimension for the back-face hull. */
export const OUTLINE = 0.012;
/** Total width of the two-bone blend at elbows, knees, shoulders and hips (metres); half on each side of the joint. */
export const JOINT_BAND = 0.06;
export const KIT_ATLAS_SIZE = 512;

export type Lod = "medium" | "low";
interface Detail { boxSeg: number; radial: number; capCap: number; capRad: number; sphW: number; sphH: number; cone: number; cyl: number; tubeSeg: number; ringSeg: number; fine: boolean; rings: "full" | "ends" }
const DETAIL: Readonly<Record<Lod, Detail>> = {
  medium: { boxSeg: 2, radial: 12, capCap: 2, capRad: 8, sphW: 12, sphH: 6, cone: 8, cyl: 12, tubeSeg: 5, ringSeg: 14, fine: true, rings: "full" },
  low: { boxSeg: 1, radial: 8, capCap: 1, capRad: 6, sphW: 8, sphH: 4, cone: 5, cyl: 6, tubeSeg: 3, ringSeg: 8, fine: false, rings: "ends" },
};

/** Beveled box: the standard segmented box with every vertex pushed onto a rounded shell of radius r. */
function roundedBox(w: number, h: number, d: number, bevel: number, seg: number): BufferGeometry {
  const g = new BoxGeometry(w, h, d, seg, seg, seg);
  if (seg < 2) return g;
  const half = [w / 2, h / 2, d / 2];
  const r = Math.max(0, Math.min(bevel, ...half));
  const pos = g.getAttribute("position") as BufferAttribute, nor = g.getAttribute("normal") as BufferAttribute;
  const inner = [0, 0, 0], v = [0, 0, 0];
  for (let i = 0; i < pos.count; i++) {
    v[0] = pos.getX(i); v[1] = pos.getY(i); v[2] = pos.getZ(i);
    let len = 0;
    for (let a = 0; a < 3; a++) { inner[a] = Math.max(-half[a]! + r, Math.min(half[a]! - r, v[a]!)); v[a] = v[a]! - inner[a]!; len += v[a]! * v[a]!; }
    len = Math.sqrt(len);
    if (len < 1e-9) continue;
    pos.setXYZ(i, inner[0]! + (v[0]! / len) * r, inner[1]! + (v[1]! / len) * r, inner[2]! + (v[2]! / len) * r);
    nor.setXYZ(i, v[0]! / len, v[1]! / len, v[2]! / len);
  }
  return g;
}

/** Ring offsets (distance below the limb top) of a limb: the joint band edges get their own rings so blending is smooth. */
function limbRings(length: number, mode: "full" | "ends"): number[] {
  const h = JOINT_BAND / 2;
  return mode === "full" ? [0, h, length / 2, length - h, length] : [0, h, length - h, length];
}

/** Tapered capsule hanging from y = 0 to y = -length, open or capped at the ends. Wound outward. */
function limbGeometry(rTop: number, rBottom: number, length: number, bulge: number, radial: number, mode: "full" | "ends", capTop: boolean, capBottom: boolean, grow: number): BufferGeometry {
  const ys = limbRings(length, mode);
  const pos: number[] = [], nor: number[] = [], idx: number[] = [];
  ys.forEach((y, k) => {
    const t = y / length;
    const r = rTop + (rBottom - rTop) * t + bulge * Math.sin(Math.PI * t) + grow;
    // The slope of the taper tilts the radial normal slightly outward-and-up.
    const slope = (rBottom - rTop) / length;
    for (let i = 0; i < radial; i++) {
      const a = (i / radial) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
      pos.push(c * r, -y, sn * r);
      const l = Math.hypot(1, slope);
      nor.push(c / l, -slope / l, sn / l);
    }
    void k;
  });
  for (let k = 0; k < ys.length - 1; k++) for (let i = 0; i < radial; i++) {
    const a = k * radial + i, b = k * radial + ((i + 1) % radial), c = (k + 1) * radial + i, d = (k + 1) * radial + ((i + 1) % radial);
    idx.push(a, b, c, b, d, c);
  }
  const cap = (k: number, y: number, up: boolean): void => {
    const centre = pos.length / 3;
    pos.push(0, y, 0); nor.push(0, up ? 1 : -1, 0);
    const first = pos.length / 3;
    for (let i = 0; i < radial; i++) { pos.push(pos[(k * radial + i) * 3]!, y, pos[(k * radial + i) * 3 + 2]!); nor.push(0, up ? 1 : -1, 0); }
    for (let i = 0; i < radial; i++) { const p = first + i, q = first + ((i + 1) % radial); idx.push(...(up ? [centre, q, p] : [centre, p, q])); }
  };
  if (capTop) cap(0, 0, true);
  if (capBottom) cap(ys.length - 1, -length, false);
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

function partGeometry(p: PartDef, grow: number, d: Detail): BufferGeometry {
  const s = p.size;
  switch (p.shape) {
    case "box": {
      const w = (s[0] ?? 0.1) + grow * 2, h = (s[1] ?? 0.1) + grow * 2, dp = (s[2] ?? 0.1) + grow * 2;
      const bevel = (p.bevel ?? Math.min(0.03, Math.min(w, h, dp) * 0.3)) + grow;
      const roundedCore = ["head", "hair", "chest", "belly", "pelvis", "handL", "handR", "footL", "footR"].includes(p.name);
      return roundedBox(w, h, dp, bevel, roundedCore ? d.boxSeg + 1 : d.boxSeg);
    }
    case "sphere": return new SphereGeometry((s[0] ?? 0.1) + grow, d.sphW, d.sphH);
    case "capsule": return new CapsuleGeometry((s[0] ?? 0.05) + grow, s[1] ?? 0.2, d.capCap, d.capRad);
    case "cone": return new ConeGeometry((s[0] ?? 0.05) + grow, (s[1] ?? 0.2) + grow * 2, d.cone, 1);
    case "cylinder": return new CylinderGeometry((s[0] ?? 0.05) + grow, (s[1] ?? 0.05) + grow, (s[2] ?? 0.1) + grow * 2, d.cyl, 1);
    case "torus": return new TorusGeometry(s[0] ?? 0.1, (s[1] ?? 0.02) + grow, d.tubeSeg, d.ringSeg);
    case "limb": {
      // Shoulders and hips are capped at the top (they sit inside the torso); elbows and knees continue from the upper limb.
      const top = p.bone.startsWith("shoulder") || p.bone.startsWith("hip");
      return limbGeometry(s[0] ?? 0.07, s[1] ?? 0.05, s[2] ?? 0.3, s[3] ?? 0, d.radial, d.rings, top, !top, grow);
    }
  }
}

/** Child bone whose origin is the lower joint of a limb on this bone (blended), if any. */
const LOWER_JOINT: Partial<Record<BoneName, BoneName>> = { shoulderL: "elbowL", shoulderR: "elbowR", hipL: "kneeL", hipR: "kneeR" };
const UPPER_JOINT_PARENT: Partial<Record<BoneName, BoneName>> = {
  shoulderL: "chest", shoulderR: "chest", elbowL: "shoulderL", elbowR: "shoulderR", hipL: "hips", hipR: "hips", kneeL: "hipL", kneeR: "hipR",
};
const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

/** Two-bone influences of a limb vertex at fighter-space height y: [bone a, bone b, weight a, weight b]. */
function limbSkin(bone: BoneName, y: number, index: (n: BoneName) => number): [number, number, number, number] {
  const half = JOINT_BAND / 2;
  const parent = UPPER_JOINT_PARENT[bone], child = LOWER_JOINT[bone];
  if (parent) {
    const wSelf = clamp01(0.5 + (boneRestWorld(bone)[1] - y) / (2 * half));
    if (wSelf < 1) return [index(parent), index(bone), 1 - wSelf, wSelf];
  }
  if (child) {
    const wChild = clamp01(0.5 + (boneRestWorld(child)[1] - y) / (2 * half));
    if (wChild > 0) return [index(bone), index(child), 1 - wChild, wChild];
  }
  return [index(bone), 0, 1, 0];
}

export type Pass = "body" | "glow" | "outline";

const ATLAS_SLOTS = ["skin", "hair", "primary", "secondary", "accent", "trim", "cloth", "dark", "stone"] as const;
const ATLAS_GRID = 4;

/**
 * Merges the parts of one pass into a single skinned geometry. Limbs are blended over JOINT_BAND at their joints;
 * every other part is bound 100% to its bone. userData.parts lists each part's vertex range for tests and tools.
 * The outline hull always uses the cheap level of detail.
 */
export function buildFighterGeometry(kit: KitId, pass: Pass, lod: Lod = "medium", awakened = false): BufferGeometry {
  const design = FIGHTER_DESIGNS[kit];
  const detail = DETAIL[pass === "outline" ? "low" : lod];
  const boneIndex = new Map<BoneName, number>(BONE_NAMES.map((n, i) => [n, i]));
  const index = (n: BoneName): number => boneIndex.get(n) ?? 0;
  const pos: number[] = [], nor: number[] = [], col: number[] = [], uv: number[] = [], idx: number[] = [], skinIdx: number[] = [], skinW: number[] = [];
  const ranges: { name: string; start: number; count: number; radial?: number }[] = [];
  const m = new Matrix4(), e = new Euler(), c = new Color();
  for (const p of design.parts) {
    if (pass === "glow" && !p.glow) continue;
    if (pass === "body" && p.glow) continue;
    if (pass === "outline" && p.glow) continue;
    if (p.fine && !detail.fine) continue;
    if (p.awakened && !awakened) continue; // QF01: awakened-only glow seams
    const g = partGeometry(p, pass === "outline" ? OUTLINE : 0, detail);
    const base = boneRestWorld(p.bone);
    e.set(p.rot?.[0] ?? 0, p.rot?.[1] ?? 0, p.rot?.[2] ?? 0);
    m.compose(new Vector3(base[0] + p.pos[0], base[1] + p.pos[1], base[2] + p.pos[2]), new Quaternion().setFromEuler(e), new Vector3(1, 1, 1));
    g.applyMatrix4(m);
    c.setHex(pass === "outline" ? 0x0c0d14 : design.palette[p.color]);
    const cell = ATLAS_SLOTS.indexOf(p.color);
    const cu = (cell % ATLAS_GRID) / ATLAS_GRID, cv = Math.floor(cell / ATLAS_GRID) / ATLAS_GRID, cs = 1 / ATLAS_GRID;
    const at = g.getAttribute("position"), nm = g.getAttribute("normal"), ix = g.getIndex();
    const offset = pos.length / 3;
    for (let i = 0; i < at.count; i++) {
      const x = at.getX(i), y = at.getY(i), z = at.getZ(i);
      pos.push(x, y, z);
      nor.push(nm.getX(i), nm.getY(i), nm.getZ(i));
      col.push(c.r, c.g, c.b);
      // Stay inside the 128 px cell (0.15 cell margin) so filtering never bleeds into a neighbouring colour.
      uv.push(cu + cs * (0.5 + Math.max(-0.35, Math.min(0.35, (x + z * 0.6) * 0.5))), cv + cs * (0.5 + Math.max(-0.35, Math.min(0.35, y * 0.4))));
      if (p.shape === "limb") { const [i0, i1, w0, w1] = limbSkin(p.bone, y, index); skinIdx.push(i0, i1, 0, 0); skinW.push(w0, w1, 0, 0); }
      else { skinIdx.push(index(p.bone), 0, 0, 0); skinW.push(1, 0, 0, 0); }
    }
    if (ix) for (let i = 0; i < ix.count; i++) idx.push(offset + ix.getX(i));
    else for (let i = 0; i < at.count; i++) idx.push(offset + i);
    ranges.push({ name: p.name, start: offset, count: at.count, ...(p.shape === "limb" ? { radial: detail.radial } : {}) });
    g.dispose();
  }
  const out = new BufferGeometry();
  out.setAttribute("position", new Float32BufferAttribute(pos, 3));
  out.setAttribute("normal", new Float32BufferAttribute(nor, 3));
  out.setAttribute("color", new Float32BufferAttribute(col, 3));
  out.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  out.setAttribute("skinIndex", new Uint16BufferAttribute(skinIdx, 4));
  out.setAttribute("skinWeight", new Float32BufferAttribute(skinW, 4));
  out.setIndex(new BufferAttribute(new Uint32Array(idx), 1));
  out.userData.parts = ranges;
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

const atlasCache = new Map<KitId, Uint8Array>();
function hash(x: number, y: number, k: number): number {
  let h = (x * 374761393 + y * 668265263 + k * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/**
 * Generated colour atlas (512 px square) for a kit: a 4x4 grid of 128 px cells, one per palette slot, each filled with
 * the slot colour plus a gradient, grain and a slot-specific pattern (cloth weave, stone speckle, plate seams). Pure code.
 */
export function makeKitAtlas(kit: KitId, size = KIT_ATLAS_SIZE): DataTexture {
  let data = atlasCache.get(kit);
  if (!data || data.length !== size * size * 4) {
    data = new Uint8Array(size * size * 4);
    const pal = FIGHTER_DESIGNS[kit].palette;
    const cellPx = size / ATLAS_GRID;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const cx = Math.floor(x / cellPx), cy = Math.floor(y / cellPx);
      const slot = ATLAS_SLOTS[cy * ATLAS_GRID + cx];
      const o = (y * size + x) * 4;
      if (!slot) { data[o] = data[o + 1] = data[o + 2] = 128; data[o + 3] = 255; continue; }
      const hex = pal[slot];
      const lx = (x % cellPx) / cellPx, ly = (y % cellPx) / cellPx;
      let f = 0.94 + 0.12 * ly + (hash(x, y, cy * 4 + cx) - 0.5) * 0.06;
      if (slot === "cloth" || slot === "primary" || slot === "secondary") f *= 0.96 + 0.04 * (((x >> 2) + (y >> 2)) & 1);
      else if (slot === "stone") f *= 0.9 + 0.2 * hash(x >> 2, y >> 2, 7);
      else if (slot === "trim" || slot === "accent") f *= 1 - 0.08 * Math.abs(Math.sin(lx * 18));
      data[o] = Math.min(255, Math.round(((hex >> 16) & 255) * f));
      data[o + 1] = Math.min(255, Math.round(((hex >> 8) & 255) * f));
      data[o + 2] = Math.min(255, Math.round((hex & 255) * f));
      data[o + 3] = 255;
    }
    atlasCache.set(kit, data);
  }
  const t = new DataTexture(data, size, size, RGBAFormat);
  t.colorSpace = SRGBColorSpace;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.flipY = false;
  t.needsUpdate = true;
  return t;
}

/** Three tonal bands (spec section 23): a 3x1 nearest-filtered ramp shared by every toon material. */
export function makeToonRamp(): DataTexture {
  const t = new DataTexture(new Uint8Array([105, 175, 255]), 3, 1, RedFormat);
  t.minFilter = NearestFilter; t.magFilter = NearestFilter;
  t.needsUpdate = true;
  return t;
}

export function toClip(c: ClipData): AnimationClip {
  const tracks: KeyframeTrack[] = c.tracks.map((t) =>
    t.path === "rotation"
      ? new QuaternionKeyframeTrack(`${t.bone}.quaternion`, t.times, t.values)
      : new VectorKeyframeTrack(`${t.bone}.position`, t.times, t.values));
  return new AnimationClip(c.id, c.duration, tracks);
}

export interface FighterRig {
  readonly root: Bone;
  readonly bones: Bone[];
  readonly skeleton: Skeleton;
  readonly meshes: SkinnedMesh[];
  readonly clips: Map<string, AnimationClip>;
  readonly phases: Map<string, ClipPhases>;
  /** Swaps every mesh to the geometry of another level of detail in place (same skeleton, no extra draw calls). */
  setLod(lod: Lod): void;
  /** QF01: shows or hides the Awakened-only glow seams by rebuilding the glow geometry in place (still three passes). */
  setAwakened(on: boolean): void;
  /** Geometry, materials and the atlas owned by this rig; dispose() releases every one once. */
  dispose(): void;
}

export function buildFighterRig(kit: KitId, ramp: DataTexture, opts: { outline: boolean; lod?: Lod }): FighterRig {
  const bones = BONES.map((b) => { const o = new Bone(); o.name = b.name; o.position.set(...b.rest); return o; });
  const byName = new Map(bones.map((b) => [b.name, b]));
  for (const b of BONES) if (b.parent) byName.get(b.parent)?.add(byName.get(b.name)!);
  const root = byName.get("hips")!;
  root.updateMatrixWorld(true);
  const skeleton = new Skeleton(bones);

  const atlas = makeKitAtlas(kit);
  const passOf = new Map<SkinnedMesh, Pass>();
  let lod: Lod = opts.lod ?? "medium";
  let awakened = false;
  const mats: (MeshToonMaterial | MeshBasicMaterial)[] = [];
  const meshes: SkinnedMesh[] = [];
  const add = (name: string, pass: Pass, mat: MeshToonMaterial | MeshBasicMaterial, shadow: boolean): void => {
    const g = buildFighterGeometry(kit, pass, lod, awakened);
    if (g.getAttribute("position").count === 0) { g.dispose(); mat.dispose(); return; }
    mats.push(mat);
    const mesh = new SkinnedMesh(g, mat);
    passOf.set(mesh, pass);
    mesh.name = `${kit}.${name}`;
    mesh.frustumCulled = false;
    mesh.castShadow = shadow;
    mesh.receiveShadow = shadow;
    meshes.push(mesh);
  };
  add("body", "body", new MeshToonMaterial({ map: atlas, gradientMap: ramp }), true);
  add("glow", "glow", new MeshBasicMaterial({ vertexColors: true }), false);
  if (opts.outline) add("outline", "outline", new MeshBasicMaterial({ color: 0x0c0d14, side: BackSide, vertexColors: true }), false);
  // Every mesh shares the one skeleton; the owner places root and meshes as siblings in one group.
  for (const mesh of meshes) mesh.bind(skeleton, new Matrix4());
  const clips = new Map<string, AnimationClip>();
  const phases = new Map<string, ClipPhases>();
  for (const c of buildKitClips(kit)) { clips.set(c.id, toClip(c)); if (c.phases) phases.set(c.id, c.phases); }
  return {
    root, bones, skeleton, meshes, clips, phases,
    setLod: (next) => {
      if (next === lod) return;
      lod = next;
      for (const mesh of meshes) { const old = mesh.geometry; mesh.geometry = buildFighterGeometry(kit, passOf.get(mesh)!, lod, awakened); old.dispose(); }
    },
    setAwakened: (on) => {
      if (on === awakened) return;
      awakened = on;
      for (const mesh of meshes) if (passOf.get(mesh) === "glow") { const old = mesh.geometry; mesh.geometry = buildFighterGeometry(kit, "glow", lod, awakened); old.dispose(); }
    },
    dispose: () => { for (const mesh of meshes) mesh.geometry.dispose(); for (const m of mats) m.dispose(); atlas.dispose(); skeleton.dispose(); },
  };
}
