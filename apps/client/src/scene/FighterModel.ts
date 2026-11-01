/**
 * Builds a rigged fighter from the shared original rig and design data (packages/shared rig.ts, fighterDesign.ts):
 * one merged, rigidly skinned mesh per fighter with vertex colours (body, glow and outline passes, three draw
 * calls), an Object3D bone hierarchy and AnimationClips. Pure Three.js geometry; no DOM, no loaded files. The same
 * geometry is exported to glTF by ops/scripts/build-art.ts.
 */
import {
  AnimationClip, BackSide, Bone, BoxGeometry, BufferAttribute, BufferGeometry, CapsuleGeometry, Color, ConeGeometry,
  CylinderGeometry, DataTexture, Euler, Float32BufferAttribute, Matrix4, MeshBasicMaterial, MeshToonMaterial, NearestFilter,
  Quaternion, QuaternionKeyframeTrack, RedFormat, Skeleton, SkinnedMesh, SphereGeometry, TorusGeometry, Uint16BufferAttribute,
  Vector3, VectorKeyframeTrack, type KeyframeTrack,
} from "three";
import type { KitId } from "@eb/shared/protocol";
import { FIGHTER_DESIGNS, type PartDef } from "@eb/shared/fighterDesign";
import { BONES, BONE_NAMES, boneRestWorld, buildKitClips, type BoneName, type ClipData } from "@eb/shared/rig";

/** Outline thickness in metres, added to every part dimension for the back-face hull. */
export const OUTLINE = 0.022;

function partGeometry(p: PartDef, grow: number): BufferGeometry {
  const s = p.size;
  switch (p.shape) {
    case "box": return new BoxGeometry((s[0] ?? 0.1) + grow * 2, (s[1] ?? 0.1) + grow * 2, (s[2] ?? 0.1) + grow * 2);
    case "sphere": return new SphereGeometry((s[0] ?? 0.1) + grow, 10, 8);
    case "capsule": return new CapsuleGeometry((s[0] ?? 0.05) + grow, s[1] ?? 0.2, 3, 8);
    case "cone": return new ConeGeometry((s[0] ?? 0.05) + grow, (s[1] ?? 0.2) + grow * 2, 6, 1);
    case "cylinder": return new CylinderGeometry((s[0] ?? 0.05) + grow, (s[1] ?? 0.05) + grow, (s[2] ?? 0.1) + grow * 2, 10, 1);
    case "torus": return new TorusGeometry(s[0] ?? 0.1, (s[1] ?? 0.02) + grow, 6, 18);
  }
}

export type Pass = "body" | "glow" | "outline";

/** Merges the parts of one pass into a single skinned geometry (every vertex bound 100% to its part's bone). */
export function buildFighterGeometry(kit: KitId, pass: Pass): BufferGeometry {
  const design = FIGHTER_DESIGNS[kit];
  const boneIndex = new Map<BoneName, number>(BONE_NAMES.map((n, i) => [n, i]));
  const pos: number[] = [], nor: number[] = [], col: number[] = [], idx: number[] = [], skinIdx: number[] = [], skinW: number[] = [];
  const m = new Matrix4(), e = new Euler(), c = new Color();
  for (const p of design.parts) {
    if (pass === "glow" && !p.glow) continue;
    if (pass === "body" && p.glow) continue;
    if (pass === "outline" && p.glow) continue;
    const g = partGeometry(p, pass === "outline" ? OUTLINE : 0);
    const base = boneRestWorld(p.bone);
    e.set(p.rot?.[0] ?? 0, p.rot?.[1] ?? 0, p.rot?.[2] ?? 0);
    m.compose(new Vector3(base[0] + p.pos[0], base[1] + p.pos[1], base[2] + p.pos[2]), new Quaternion().setFromEuler(e), new Vector3(1, 1, 1));
    g.applyMatrix4(m);
    c.setHex(pass === "outline" ? 0x0c0d14 : design.palette[p.color]);
    const at = g.getAttribute("position"), nm = g.getAttribute("normal"), ix = g.getIndex();
    const offset = pos.length / 3;
    for (let i = 0; i < at.count; i++) {
      pos.push(at.getX(i), at.getY(i), at.getZ(i));
      nor.push(nm.getX(i), nm.getY(i), nm.getZ(i));
      col.push(c.r, c.g, c.b);
      skinIdx.push(boneIndex.get(p.bone) ?? 0, 0, 0, 0);
      skinW.push(1, 0, 0, 0);
    }
    if (ix) for (let i = 0; i < ix.count; i++) idx.push(offset + ix.getX(i));
    else for (let i = 0; i < at.count; i++) idx.push(offset + i);
    g.dispose();
  }
  const out = new BufferGeometry();
  out.setAttribute("position", new Float32BufferAttribute(pos, 3));
  out.setAttribute("normal", new Float32BufferAttribute(nor, 3));
  out.setAttribute("color", new Float32BufferAttribute(col, 3));
  out.setAttribute("skinIndex", new Uint16BufferAttribute(skinIdx, 4));
  out.setAttribute("skinWeight", new Float32BufferAttribute(skinW, 4));
  out.setIndex(new BufferAttribute(new Uint32Array(idx), 1));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
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
  /** Geometry, materials and the ramp owned by this rig; dispose() releases every one once. */
  dispose(): void;
}

export function buildFighterRig(kit: KitId, ramp: DataTexture, opts: { outline: boolean }): FighterRig {
  const bones = BONES.map((b) => { const o = new Bone(); o.name = b.name; o.position.set(...b.rest); return o; });
  const byName = new Map(bones.map((b) => [b.name, b]));
  for (const b of BONES) if (b.parent) byName.get(b.parent)?.add(byName.get(b.name)!);
  const root = byName.get("hips")!;
  root.updateMatrixWorld(true);
  const skeleton = new Skeleton(bones);

  const geos: BufferGeometry[] = [];
  const mats: (MeshToonMaterial | MeshBasicMaterial)[] = [];
  const meshes: SkinnedMesh[] = [];
  const add = (name: string, pass: Pass, mat: MeshToonMaterial | MeshBasicMaterial, shadow: boolean): void => {
    const g = buildFighterGeometry(kit, pass);
    if (g.getAttribute("position").count === 0) { g.dispose(); mat.dispose(); return; }
    geos.push(g); mats.push(mat);
    const mesh = new SkinnedMesh(g, mat);
    mesh.name = `${kit}.${name}`;
    mesh.frustumCulled = false;
    mesh.castShadow = shadow;
    mesh.receiveShadow = shadow;
    meshes.push(mesh);
  };
  add("body", "body", new MeshToonMaterial({ vertexColors: true, gradientMap: ramp }), true);
  add("glow", "glow", new MeshBasicMaterial({ vertexColors: true }), false);
  if (opts.outline) add("outline", "outline", new MeshBasicMaterial({ color: 0x0c0d14, side: BackSide, vertexColors: true }), false);
  // Every mesh shares the one skeleton; the owner places root and meshes as siblings in one group.
  for (const mesh of meshes) mesh.bind(skeleton, new Matrix4());
  const clips = new Map<string, AnimationClip>();
  for (const c of buildKitClips(kit)) clips.set(c.id, toClip(c));
  return {
    root, bones, skeleton, meshes, clips,
    dispose: () => { for (const g of geos) g.dispose(); for (const m of mats) m.dispose(); skeleton.dispose(); },
  };
}
