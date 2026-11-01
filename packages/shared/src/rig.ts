/**
 * Original fighter rig and procedural animation library (spec section 23, task T25).
 * Pure data and math: no DOM, no Three.js. The client builds skinned meshes and AnimationClips from this,
 * and ops/scripts/build-art.ts exports the same data as glTF 2.0 files. Every pose is authored here in code;
 * nothing is derived from third party animation, footage or rigs.
 *
 * Conventions: metres, y up, a fighter faces -Z (yaw 0). The origin is the physics capsule centre, so the soles
 * are at y = -0.9. A positive X rotation swings a hanging limb forward (towards -Z); positive Y turns left;
 * positive Z swings a right-hand limb outward.
 */
import type { KitId } from "./protocol.js";

export const RIG_VERSION = "eb-rig-1";
export type Vec3 = readonly [number, number, number];

export const BONE_NAMES = [
  "hips", "spine", "chest", "neck", "head",
  "shoulderL", "elbowL", "handL", "shoulderR", "elbowR", "handR",
  "hipL", "kneeL", "ankleL", "hipR", "kneeR", "ankleR",
] as const;
export type BoneName = (typeof BONE_NAMES)[number];

export interface BoneDef { readonly name: BoneName; readonly parent: BoneName | null; readonly rest: Vec3 }

export const BONES: readonly BoneDef[] = [
  { name: "hips", parent: null, rest: [0, -0.05, 0] },
  { name: "spine", parent: "hips", rest: [0, 0.15, 0] },
  { name: "chest", parent: "spine", rest: [0, 0.25, 0] },
  { name: "neck", parent: "chest", rest: [0, 0.28, 0] },
  { name: "head", parent: "neck", rest: [0, 0.12, 0] },
  { name: "shoulderL", parent: "chest", rest: [-0.25, 0.2, 0] },
  { name: "elbowL", parent: "shoulderL", rest: [0, -0.28, 0] },
  { name: "handL", parent: "elbowL", rest: [0, -0.26, 0] },
  { name: "shoulderR", parent: "chest", rest: [0.25, 0.2, 0] },
  { name: "elbowR", parent: "shoulderR", rest: [0, -0.28, 0] },
  { name: "handR", parent: "elbowR", rest: [0, -0.26, 0] },
  { name: "hipL", parent: "hips", rest: [-0.12, -0.05, 0] },
  { name: "kneeL", parent: "hipL", rest: [0, -0.42, 0] },
  { name: "ankleL", parent: "kneeL", rest: [0, -0.38, 0] },
  { name: "hipR", parent: "hips", rest: [0.12, -0.05, 0] },
  { name: "kneeR", parent: "hipR", rest: [0, -0.42, 0] },
  { name: "ankleR", parent: "kneeR", rest: [0, -0.38, 0] },
];

const boneByName = new Map<BoneName, BoneDef>(BONES.map((b) => [b.name, b]));

/** Bone position in the rest pose, in fighter space (the root group). */
export function boneRestWorld(name: BoneName): Vec3 {
  let x = 0, y = 0, z = 0;
  for (let b: BoneDef | undefined = boneByName.get(name); b; b = b.parent ? boneByName.get(b.parent) : undefined) {
    x += b.rest[0]; y += b.rest[1]; z += b.rest[2];
  }
  return [x, y, z];
}

// ---- clip identifiers ---------------------------------------------------------------------------------------

/** Spec section 23 base clip list. */
export const BASE_CLIP_IDS = [
  "idle", "walk", "run", "jump", "fall", "land", "guard", "dashFront", "dashSide", "dashBack",
  "hitLight", "ragdollPose", "getup", "death",
] as const;
export type BaseClipId = (typeof BASE_CLIP_IDS)[number];

/** The four-hit M1 chain (spec section 12) shares ids m1.1 to m1.4, matching the replicated moveId. */
export const M1_CLIP_IDS = ["m1.1", "m1.2", "m1.3", "m1.4"] as const;

const SLOT_SUFFIXES = ["b1", "b2", "b3", "b4", "a1", "a2", "a3", "a4", "activate"] as const;
/** T23 shared context moves, generated for every kit (wall attack, urn pickup and throw). */
const SHARED_CONTEXT_SUFFIXES = ["wall", "pickup", "throw"] as const;
/** Ability ids per kit: eight slotted moves, the awakening activation and the shared context moves; the Stone kit adds sv.x1 to sv.x3. */
export function abilityClipIds(kit: KitId): string[] {
  const ids: string[] = [...SLOT_SUFFIXES, ...SHARED_CONTEXT_SUFFIXES].map((s) => `${kit}.${s}`);
  if (kit === "sv") ids.push("sv.x1", "sv.x2", "sv.x3");
  return ids;
}
/** Every animation id a kit's glTF must carry. */
export function requiredClipIds(kit: KitId): string[] {
  return [...BASE_CLIP_IDS, ...M1_CLIP_IDS, ...abilityClipIds(kit)];
}

// ---- pose and clip data -------------------------------------------------------------------------------------

/** Euler XYZ radians per bone; bones not listed stay at rest. */
export type Pose = Partial<Record<BoneName, Vec3>>;
export interface Key { readonly t: number; readonly pose: Pose; readonly hips?: Vec3 }
export interface ClipTrack {
  readonly bone: BoneName;
  readonly path: "rotation" | "translation";
  readonly times: number[];
  /** rotation: quaternion xyzw per key; translation: absolute local position per key. */
  readonly values: number[];
}
export interface ClipData { readonly id: string; readonly duration: number; readonly loop: boolean; readonly tracks: ClipTrack[] }

export function eulerToQuat(x: number, y: number, z: number): [number, number, number, number] {
  const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3,
  ];
}

const hipsRest = boneByName.get("hips")!.rest;

/** Builds a clip from keyframes (times in seconds, strictly increasing). Missing bones hold their previous key. */
export function buildClip(id: string, loop: boolean, keys: readonly Key[]): ClipData {
  const duration = keys[keys.length - 1]!.t;
  const tracks: ClipTrack[] = [];
  for (const bone of BONE_NAMES) {
    const times: number[] = [], values: number[] = [];
    let last: Vec3 = [0, 0, 0];
    for (const k of keys) {
      const e = k.pose[bone] ?? last;
      last = e;
      times.push(k.t);
      // Poses are authored with +X = limb swings back; the rig convention (decision 0019) is +X = forward (-Z).
      values.push(...eulerToQuat(-e[0], e[1], e[2]));
    }
    tracks.push({ bone, path: "rotation", times, values });
  }
  const times: number[] = [], values: number[] = [];
  let lastHips: Vec3 = [0, 0, 0];
  for (const k of keys) {
    const d = k.hips ?? lastHips;
    lastHips = d;
    times.push(k.t);
    values.push(hipsRest[0] + d[0], hipsRest[1] + d[1], hipsRest[2] + d[2]);
  }
  tracks.push({ bone: "hips", path: "translation", times, values });
  return { id, duration, loop, tracks };
}

// ---- pose helpers ------------------------------------------------------------------------------------------

const swapLR = (b: BoneName): BoneName => b.endsWith("L") ? (b.slice(0, -1) + "R") as BoneName : b.endsWith("R") ? (b.slice(0, -1) + "L") as BoneName : b;
/** Mirrors a pose left to right: swaps sides and negates the Y and Z turns. */
export function mirror(p: Pose): Pose {
  const out: Pose = {};
  for (const [k, v] of Object.entries(p) as [BoneName, Vec3][]) out[swapLR(k)] = [v[0], -v[1], -v[2]];
  return out;
}
const merge = (...ps: Pose[]): Pose => Object.assign({}, ...ps) as Pose;
/** Linear blend of two poses (used to derive in-betweens). */
export function blendPose(a: Pose, b: Pose, t: number): Pose {
  const out: Pose = {};
  for (const n of BONE_NAMES) {
    const x = a[n] ?? [0, 0, 0], y = b[n] ?? [0, 0, 0];
    if (a[n] || b[n]) out[n] = [x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t];
  }
  return out;
}

/** A relaxed, slightly bent stance shared by all kits. */
const STANCE: Pose = {
  spine: [0.05, 0, 0], chest: [0.03, 0, 0], head: [-0.05, 0, 0],
  shoulderL: [0.15, 0, -0.12], elbowL: [-0.5, 0, 0], shoulderR: [0.15, 0, 0.12], elbowR: [-0.5, 0, 0],
  hipL: [-0.1, 0, -0.04], kneeL: [0.2, 0, 0], ankleL: [-0.1, 0, 0],
  hipR: [0.1, 0, 0.04], kneeR: [0.2, 0, 0], ankleR: [-0.1, 0, 0],
};

export interface KitStyle {
  /** Multiplies hip drop in guarded stances. */
  readonly weight: number;
  /** Idle stance overlay giving each fighter its own silhouette at rest. */
  readonly idle: Pose;
  /** Seconds multiplier for move clips (heavier kits move slower on screen; gameplay timing is separate). */
  readonly tempo: number;
}
export const KIT_STYLE: Readonly<Record<KitId, KitStyle>> = {
  // Stone: wide, low, planted, one shoulder dropped under the mantle.
  sv: { weight: 1.3, tempo: 1.15, idle: { hipL: [-0.12, 0, -0.2], hipR: [0.12, 0, 0.2], kneeL: [0.3, 0, 0], kneeR: [0.3, 0, 0], chest: [0.08, -0.15, 0.05], shoulderL: [0.1, 0, -0.35], shoulderR: [0.25, 0, 0.25], elbowL: [-0.7, 0, 0], elbowR: [-0.9, 0, 0] } },
  // Tide: upright, open palm forward, weight on the back foot.
  td: { weight: 0.9, tempo: 0.95, idle: { chest: [-0.02, 0.2, 0], shoulderR: [0.9, 0.2, 0.1], elbowR: [-0.7, 0, 0], handR: [-0.1, 0, 0], shoulderL: [0.3, 0, -0.5], elbowL: [-0.9, 0, 0], hipL: [-0.25, 0, -0.05], hipR: [0.2, 0, 0.1], kneeR: [0.35, 0, 0] } },
  // Ember: loose and engineered, arms ready at the gauntlets.
  ea: { weight: 1, tempo: 1, idle: { shoulderL: [0.6, 0, -0.2], elbowL: [-1.1, 0, 0], shoulderR: [0.6, 0, 0.2], elbowR: [-1.1, 0, 0], chest: [0.1, 0, 0], head: [-0.08, 0, 0], hipL: [-0.15, 0, -0.1], hipR: [0.15, 0, 0.1], kneeL: [0.28, 0, 0], kneeR: [0.28, 0, 0] } },
};

// ---- move archetypes ----------------------------------------------------------------------------------------

type Archetype = "strike" | "flurry" | "palm" | "launcher" | "slam" | "beam" | "counter" | "cast" | "throw" | "grab" | "spin" | "dashStrike" | "activate" | "kick";

/** Visual archetype per move id. Presentation only: it never affects timing, damage or hitboxes. */
export const MOVE_ARCHETYPE: Readonly<Record<string, Archetype>> = {
  "m1.1": "strike", "m1.2": "strike", "m1.3": "palm", "m1.4": "kick",
  "sv.b1": "strike", "sv.b2": "flurry", "sv.b3": "palm", "sv.b4": "launcher",
  "sv.a1": "counter", "sv.a2": "slam", "sv.a3": "beam", "sv.a4": "grab", "sv.activate": "activate",
  "sv.x1": "strike", "sv.x2": "palm", "sv.x3": "launcher",
  "td.b1": "cast", "td.b2": "spin", "td.b3": "throw", "td.b4": "counter",
  "td.a1": "flurry", "td.a2": "slam", "td.a3": "beam", "td.a4": "dashStrike", "td.activate": "activate",
  "ea.b1": "throw", "ea.b2": "dashStrike", "ea.b3": "cast", "ea.b4": "slam",
  "ea.a1": "slam", "ea.a2": "grab", "ea.a3": "beam", "ea.a4": "cast", "ea.activate": "activate",
};

interface Phases { windup: Pose; windupHips?: Vec3; active: Pose; activeHips?: Vec3; extra?: Key[] }
const R_STRIKE_BACK: Pose = { chest: [0, 0.6, 0], spine: [0.05, 0.3, 0], shoulderR: [-0.7, 0, 0.3], elbowR: [-1.6, 0, 0], shoulderL: [0.9, 0, -0.2], elbowL: [-1.3, 0, 0], hipL: [-0.3, 0, -0.1], kneeL: [0.4, 0, 0], hipR: [0.35, 0, 0.1], kneeR: [0.5, 0, 0] };

function phases(a: Archetype): Phases {
  switch (a) {
    case "strike":
      return {
        windup: R_STRIKE_BACK, windupHips: [0, -0.08, 0.04],
        active: { chest: [0.1, -0.6, 0], spine: [0.1, -0.3, 0], shoulderR: [1.5, -0.2, 0.1], elbowR: [-0.1, 0, 0], shoulderL: [0.5, 0, -0.4], elbowL: [-1.4, 0, 0], hipL: [0.3, 0, -0.1], kneeL: [0.2, 0, 0], hipR: [-0.5, 0, 0.1], kneeR: [0.55, 0, 0] },
        activeHips: [0, -0.1, -0.1],
      };
    case "kick":
      return {
        windup: { chest: [-0.15, 0, 0], hipR: [-0.6, 0, 0.1], kneeR: [1.2, 0, 0], shoulderL: [0.5, 0, -0.5], shoulderR: [0.8, 0, 0.5], elbowL: [-1, 0, 0], elbowR: [-1, 0, 0], hipL: [0.1, 0, -0.1], kneeL: [0.4, 0, 0] },
        active: { chest: [-0.25, 0, 0], spine: [-0.1, 0, 0], hipR: [1.55, 0, 0.1], kneeR: [0.1, 0, 0], ankleR: [-0.4, 0, 0], shoulderL: [0.3, 0, -0.9], shoulderR: [0.6, 0, 0.9], elbowL: [-0.4, 0, 0], elbowR: [-0.4, 0, 0], hipL: [0.15, 0, -0.1], kneeL: [0.5, 0, 0] },
        activeHips: [0, 0, -0.1],
      };
    case "palm":
      return {
        windup: { chest: [0, 0.3, 0], shoulderR: [0.2, 0, 0.35], elbowR: [-1.9, 0, 0], shoulderL: [0.7, 0, -0.5], elbowL: [-0.8, 0, 0], hipL: [-0.3, 0, -0.1], kneeL: [0.4, 0, 0], hipR: [0.3, 0, 0.1], kneeR: [0.45, 0, 0] },
        windupHips: [0, -0.06, 0.05],
        active: { chest: [0.15, -0.3, 0], shoulderR: [1.55, 0, 0.05], elbowR: [0, 0, 0], handR: [-0.3, 0, 0], shoulderL: [0.6, 0, -0.6], elbowL: [-0.8, 0, 0], hipL: [0.35, 0, -0.1], kneeL: [0.3, 0, 0], hipR: [-0.4, 0, 0.1], kneeR: [0.4, 0, 0] },
        activeHips: [0, -0.07, -0.12],
      };
    case "flurry":
      return {
        windup: R_STRIKE_BACK, windupHips: [0, -0.06, 0.02],
        active: { chest: [0.1, -0.4, 0], shoulderR: [1.5, -0.1, 0.1], elbowR: [-0.1, 0, 0], shoulderL: [0.5, 0, -0.3], elbowL: [-1.5, 0, 0], hipL: [0.2, 0, -0.1], kneeL: [0.3, 0, 0], hipR: [-0.3, 0, 0.1], kneeR: [0.4, 0, 0] },
        activeHips: [0, -0.06, -0.06],
        extra: [
          { t: 0.55, pose: { chest: [0.1, 0.4, 0], shoulderL: [1.5, 0.1, -0.1], elbowL: [-0.1, 0, 0], shoulderR: [0.5, 0, 0.3], elbowR: [-1.5, 0, 0] }, hips: [0, -0.06, -0.06] },
          { t: 0.7, pose: { chest: [0.1, -0.4, 0], shoulderR: [1.5, -0.1, 0.1], elbowR: [-0.1, 0, 0], shoulderL: [0.5, 0, -0.3], elbowL: [-1.5, 0, 0] }, hips: [0, -0.06, -0.06] },
        ],
      };
    case "launcher":
      return {
        windup: { spine: [0.35, 0, 0], chest: [0.25, 0, 0], shoulderR: [-0.6, 0, 0.2], elbowR: [-0.5, 0, 0], shoulderL: [0.4, 0, -0.5], elbowL: [-1, 0, 0], hipL: [-0.9, 0, -0.15], kneeL: [1.3, 0, 0], hipR: [0.7, 0, 0.15], kneeR: [1.1, 0, 0], head: [-0.3, 0, 0] },
        windupHips: [0, -0.28, 0.06],
        active: { spine: [-0.15, 0, 0], chest: [-0.2, 0, 0], shoulderR: [2.9, 0, 0.1], elbowR: [-0.15, 0, 0], shoulderL: [0.3, 0, -0.7], elbowL: [-0.8, 0, 0], hipL: [-0.1, 0, -0.1], kneeL: [0.1, 0, 0], hipR: [-0.15, 0, 0.1], kneeR: [0.05, 0, 0], ankleL: [0.6, 0, 0], ankleR: [0.6, 0, 0], head: [-0.2, 0, 0] },
        activeHips: [0, 0.1, -0.05],
      };
    case "slam":
      return {
        windup: { spine: [-0.3, 0, 0], chest: [-0.25, 0, 0], shoulderL: [3.0, 0, -0.2], shoulderR: [3.0, 0, 0.2], elbowL: [-0.3, 0, 0], elbowR: [-0.3, 0, 0], head: [-0.25, 0, 0], hipL: [-0.2, 0, -0.15], hipR: [-0.2, 0, 0.15], kneeL: [0.3, 0, 0], kneeR: [0.3, 0, 0], ankleL: [0.5, 0, 0], ankleR: [0.5, 0, 0] },
        windupHips: [0, 0.08, 0.1],
        active: { spine: [0.7, 0, 0], chest: [0.5, 0, 0], shoulderL: [0.7, 0, -0.15], shoulderR: [0.7, 0, 0.15], elbowL: [-0.15, 0, 0], elbowR: [-0.15, 0, 0], head: [0.2, 0, 0], hipL: [-0.9, 0, -0.2], hipR: [-0.9, 0, 0.2], kneeL: [1.2, 0, 0], kneeR: [1.2, 0, 0] },
        activeHips: [0, -0.3, -0.12],
      };
    case "beam":
      return {
        windup: { chest: [0.05, 0.4, 0], shoulderL: [1.1, 0, -0.4], shoulderR: [1.1, 0, 0.4], elbowL: [-1.6, 0, 0], elbowR: [-1.6, 0, 0], hipL: [-0.2, 0, -0.35], hipR: [0.2, 0, 0.35], kneeL: [0.5, 0, 0], kneeR: [0.5, 0, 0] },
        windupHips: [0, -0.15, 0.06],
        active: { chest: [0.1, 0, 0], head: [0.05, 0, 0], shoulderL: [1.5, 0, -0.1], shoulderR: [1.5, 0, 0.1], elbowL: [-0.05, 0, 0], elbowR: [-0.05, 0, 0], handL: [-0.3, 0, 0], handR: [-0.3, 0, 0], hipL: [0.1, 0, -0.4], hipR: [-0.25, 0, 0.4], kneeL: [0.35, 0, 0], kneeR: [0.6, 0, 0] },
        activeHips: [0, -0.18, 0],
      };
    case "counter":
      return {
        windup: { chest: [-0.1, 0, 0], spine: [-0.05, 0, 0], shoulderL: [1.2, 0.3, -0.3], shoulderR: [1.2, -0.3, 0.3], elbowL: [-1.9, 0, 0], elbowR: [-1.9, 0, 0], hipL: [-0.1, 0, -0.2], hipR: [0.1, 0, 0.2], kneeL: [0.4, 0, 0], kneeR: [0.4, 0, 0] },
        windupHips: [0, -0.12, 0.04],
        active: { chest: [0.1, -0.7, 0], spine: [0.1, -0.35, 0], shoulderR: [1.5, 0.2, 0.1], elbowR: [-0.1, 0, 0], shoulderL: [0.9, 0, -0.5], elbowL: [-1.3, 0, 0], hipL: [0.3, 0, -0.1], kneeL: [0.3, 0, 0], hipR: [-0.45, 0, 0.1], kneeR: [0.5, 0, 0] },
        activeHips: [0, -0.1, -0.1],
      };
    case "cast":
      return {
        windup: { chest: [-0.2, 0, 0], head: [-0.2, 0, 0], shoulderL: [0.8, 0, -1.1], shoulderR: [0.8, 0, 1.1], elbowL: [-0.9, 0, 0], elbowR: [-0.9, 0, 0], handL: [-0.4, 0, 0], handR: [-0.4, 0, 0], hipL: [-0.1, 0, -0.2], hipR: [0.1, 0, 0.2], kneeL: [0.3, 0, 0], kneeR: [0.3, 0, 0] },
        windupHips: [0, -0.06, 0.04],
        active: { chest: [0.18, 0, 0], head: [0.1, 0, 0], shoulderL: [1.45, 0, -0.35], shoulderR: [1.45, 0, 0.35], elbowL: [-0.2, 0, 0], elbowR: [-0.2, 0, 0], handL: [-0.3, 0, 0], handR: [-0.3, 0, 0], hipL: [0.15, 0, -0.2], hipR: [-0.15, 0, 0.2], kneeL: [0.35, 0, 0], kneeR: [0.4, 0, 0] },
        activeHips: [0, -0.08, -0.08],
      };
    case "throw":
      return {
        windup: { chest: [0, 0.7, 0], spine: [0, 0.3, 0], shoulderR: [-1.1, 0, 0.5], elbowR: [-1.4, 0, 0], shoulderL: [1.3, 0, -0.2], elbowL: [-0.2, 0, 0], hipL: [-0.4, 0, -0.1], kneeL: [0.4, 0, 0], hipR: [0.35, 0, 0.1], kneeR: [0.6, 0, 0] },
        windupHips: [0, -0.1, 0.06],
        active: { chest: [0.15, -0.65, 0], spine: [0.1, -0.3, 0], shoulderR: [1.6, -0.1, 0.05], elbowR: [0, 0, 0], handR: [-0.35, 0, 0], shoulderL: [0.6, 0, -0.6], elbowL: [-1, 0, 0], hipL: [0.4, 0, -0.1], kneeL: [0.3, 0, 0], hipR: [-0.55, 0, 0.1], kneeR: [0.5, 0, 0] },
        activeHips: [0, -0.08, -0.12],
      };
    case "grab":
      return {
        windup: { chest: [0.1, 0.3, 0], shoulderR: [1.35, -0.2, 0.3], elbowR: [-0.3, 0, 0], handR: [-0.5, 0, 0], shoulderL: [0.6, 0, -0.5], elbowL: [-1.2, 0, 0], hipL: [-0.3, 0, -0.1], kneeL: [0.4, 0, 0], hipR: [0.3, 0, 0.1], kneeR: [0.4, 0, 0] },
        windupHips: [0, -0.1, -0.05],
        active: { chest: [0.25, -0.2, 0], shoulderR: [0.9, 0, 0.1], elbowR: [-1.7, 0, 0], handR: [-0.6, 0, 0], shoulderL: [1.1, 0, -0.3], elbowL: [-1.2, 0, 0], hipL: [0.2, 0, -0.1], kneeL: [0.3, 0, 0], hipR: [-0.3, 0, 0.1], kneeR: [0.5, 0, 0] },
        activeHips: [0, -0.14, 0.02],
      };
    case "spin":
      return {
        windup: { chest: [0, 0.9, 0], spine: [0, 0.4, 0], shoulderL: [1.0, 0, -1.0], shoulderR: [1.0, 0, 1.0], elbowL: [-0.3, 0, 0], elbowR: [-0.3, 0, 0], hipL: [-0.3, 0, -0.3], hipR: [0.3, 0, 0.3], kneeL: [0.5, 0, 0], kneeR: [0.5, 0, 0] },
        windupHips: [0, -0.12, 0],
        active: { chest: [0.1, -1.1, 0], spine: [0, -0.5, 0], shoulderL: [1.3, 0, -1.2], shoulderR: [1.3, 0, 1.2], elbowL: [-0.2, 0, 0], elbowR: [-0.2, 0, 0], hipL: [0.3, 0, -0.3], hipR: [-0.3, 0, 0.3], kneeL: [0.4, 0, 0], kneeR: [0.5, 0, 0] },
        activeHips: [0, -0.12, 0],
      };
    case "dashStrike":
      return {
        windup: { spine: [0.4, 0, 0], chest: [0.3, 0, 0], shoulderR: [-0.9, 0, 0.3], elbowR: [-0.8, 0, 0], shoulderL: [0.8, 0, -0.3], elbowL: [-1.2, 0, 0], hipL: [-0.7, 0, -0.1], kneeL: [0.9, 0, 0], hipR: [0.6, 0, 0.1], kneeR: [0.9, 0, 0] },
        windupHips: [0, -0.15, 0.1],
        active: { spine: [0.55, 0, 0], chest: [0.4, -0.3, 0], shoulderR: [1.5, 0, 0.1], elbowR: [-0.05, 0, 0], shoulderL: [-0.6, 0, -0.5], elbowL: [-0.5, 0, 0], hipL: [0.9, 0, -0.1], kneeL: [0.5, 0, 0], hipR: [-0.9, 0, 0.1], kneeR: [1.0, 0, 0] },
        activeHips: [0, -0.1, -0.15],
      };
    case "activate":
      return {
        windup: { spine: [0.45, 0, 0], chest: [0.35, 0, 0], head: [0.3, 0, 0], shoulderL: [0.5, 0, -0.1], shoulderR: [0.5, 0, 0.1], elbowL: [-1.7, 0, 0], elbowR: [-1.7, 0, 0], hipL: [-0.7, 0, -0.25], hipR: [-0.7, 0, 0.25], kneeL: [1.2, 0, 0], kneeR: [1.2, 0, 0] },
        windupHips: [0, -0.3, 0],
        active: { spine: [-0.25, 0, 0], chest: [-0.3, 0, 0], head: [-0.4, 0, 0], shoulderL: [2.6, 0, -0.9], shoulderR: [2.6, 0, 0.9], elbowL: [-0.2, 0, 0], elbowR: [-0.2, 0, 0], hipL: [-0.1, 0, -0.3], hipR: [-0.1, 0, 0.3], kneeL: [0.1, 0, 0], kneeR: [0.1, 0, 0], ankleL: [0.5, 0, 0], ankleR: [0.5, 0, 0] },
        activeHips: [0, 0.1, 0],
      };
  }
}

// ---- clip library -------------------------------------------------------------------------------------------

const P = (p: Pose): Pose => p;
const walkPose = (ph: number, amp: number, lean: number): Pose => {
  const s = Math.sin(ph), c = Math.cos(ph);
  return merge(STANCE, {
    spine: [lean, -s * 0.12, 0], chest: [lean * 0.6, s * 0.15, 0], head: [-lean * 0.5, 0, 0],
    hipL: [s * amp, 0, -0.04], kneeL: [Math.max(0, -c) * amp * 1.3 + 0.1, 0, 0], ankleL: [-s * amp * 0.3, 0, 0],
    hipR: [-s * amp, 0, 0.04], kneeR: [Math.max(0, c) * amp * 1.3 + 0.1, 0, 0], ankleR: [s * amp * 0.3, 0, 0],
    shoulderL: [-s * amp * 0.9 + 0.15, 0, -0.1], elbowL: [-0.5 - amp * 0.5, 0, 0],
    shoulderR: [s * amp * 0.9 + 0.15, 0, 0.1], elbowR: [-0.5 - amp * 0.5, 0, 0],
  } as Pose);
};
function cycle(id: string, dur: number, amp: number, lean: number, bob: number): ClipData {
  const keys: Key[] = [];
  const n = 8;
  for (let i = 0; i <= n; i++) {
    const ph = (i / n) * Math.PI * 2;
    keys.push({ t: (dur * i) / n, pose: walkPose(ph, amp, lean), hips: [0, -Math.abs(Math.cos(ph)) * bob, 0] });
  }
  return buildClip(id, true, keys);
}

function dashClip(id: string, dir: "front" | "side" | "back"): ClipData {
  const lean = dir === "front" ? 0.55 : dir === "back" ? -0.35 : 0.1;
  const side = dir === "side" ? 0.5 : 0;
  const a = merge(STANCE, { spine: [lean, 0, side], chest: [lean * 0.6, 0, side], hipL: [-0.9 * (dir === "back" ? -1 : 1), 0, -0.2 - side], kneeL: [0.9, 0, 0], hipR: [0.7 * (dir === "back" ? -1 : 1), 0, 0.2 + side], kneeR: [0.5, 0, 0], shoulderL: [-0.7, 0, -0.5], shoulderR: [0.9, 0, 0.5], elbowL: [-0.6, 0, 0], elbowR: [-0.6, 0, 0] } as Pose);
  const b = merge(a, { hipL: [0.7 * (dir === "back" ? -1 : 1), 0, -0.2 - side], hipR: [-0.9 * (dir === "back" ? -1 : 1), 0, 0.2 + side] } as Pose);
  return buildClip(id, false, [
    { t: 0, pose: STANCE }, { t: 0.08, pose: a, hips: [0, -0.12, 0] }, { t: 0.18, pose: b, hips: [0, -0.08, 0] }, { t: 0.28, pose: STANCE },
  ]);
}

function moveClip(id: string, kit: KitId): ClipData {
  const style = KIT_STYLE[kit];
  const ph = phases(MOVE_ARCHETYPE[id] ?? "strike");
  const base = merge(STANCE, style.idle);
  const sc = (t: number): number => t * style.tempo;
  const mirrored = id === "m1.2";
  const w = mirrored ? mirror(ph.windup) : ph.windup;
  const a = mirrored ? mirror(ph.active) : ph.active;
  const wk = merge(base, w), ak = merge(base, a);
  const keys: Key[] = [
    { t: 0, pose: base },
    { t: sc(0.3), pose: wk, hips: ph.windupHips ?? [0, 0, 0] },
    { t: sc(0.42), pose: ak, hips: ph.activeHips ?? [0, 0, 0] },
  ];
  let end = 0.42;
  for (const e of ph.extra ?? []) { keys.push({ t: sc(e.t), pose: merge(base, mirrored ? mirror(e.pose) : e.pose), ...(e.hips ? { hips: e.hips } : {}) }); end = e.t; }
  keys.push({ t: sc(end + 0.12), pose: blendPose(ak, base, 0.35), hips: ph.activeHips ?? [0, 0, 0] });
  keys.push({ t: sc(end + 0.45), pose: base });
  return buildClip(id, false, keys);
}

/** The deterministic clip set for one kit: base clips, M1 chain and that kit's ability ids. */
export function buildKitClips(kit: KitId): ClipData[] {
  const style = KIT_STYLE[kit];
  const idlePose = merge(STANCE, style.idle);
  const breathe = merge(idlePose, { chest: [(idlePose.chest?.[0] ?? 0) + 0.04, idlePose.chest?.[1] ?? 0, idlePose.chest?.[2] ?? 0], head: [-0.09, 0, 0], shoulderL: [(idlePose.shoulderL?.[0] ?? 0) + 0.04, idlePose.shoulderL?.[1] ?? 0, idlePose.shoulderL?.[2] ?? 0] } as Pose);
  const lowHips: Vec3 = [0, -0.06 * style.weight, 0];
  const guardPose = merge(STANCE, { spine: [0.15, 0, 0], chest: [0.12, 0, 0], head: [0.1, 0, 0], shoulderL: [1.3, 0.3, -0.25], shoulderR: [1.3, -0.3, 0.25], elbowL: [-2.0, 0, 0], elbowR: [-2.0, 0, 0], hipL: [-0.15, 0, -0.2], hipR: [0.15, 0, 0.2], kneeL: [0.45, 0, 0], kneeR: [0.45, 0, 0] } as Pose);
  const hit = merge(STANCE, { spine: [-0.3, 0, 0.1], chest: [-0.25, 0.1, 0], head: [-0.4, 0, 0.15], shoulderL: [-0.4, 0, -0.5], shoulderR: [-0.3, 0, 0.5], elbowL: [-0.3, 0, 0], elbowR: [-0.3, 0, 0], hipL: [0.2, 0, -0.1], hipR: [0.3, 0, 0.1], kneeL: [0.3, 0, 0], kneeR: [0.4, 0, 0] } as Pose);
  const ragdoll = P({ hips: [0.2, 0, 0], spine: [0.4, 0, 0.2], chest: [0.3, 0.2, 0.1], neck: [0.2, 0, 0], head: [0.3, 0.3, 0], shoulderL: [-0.5, 0, -1.2], shoulderR: [1.0, 0, 0.9], elbowL: [-0.8, 0, 0], elbowR: [-0.4, 0, 0], hipL: [-1.0, 0, -0.5], kneeL: [0.9, 0, 0], hipR: [0.6, 0, 0.6], kneeR: [0.4, 0, 0], ankleL: [0.3, 0, 0], ankleR: [-0.3, 0, 0] });
  const down = P({ spine: [0.2, 0, 0], chest: [0.1, 0, 0], head: [0.1, 0.4, 0], shoulderL: [-0.2, 0, -0.9], shoulderR: [0.5, 0, 1.0], elbowL: [-0.3, 0, 0], elbowR: [-0.6, 0, 0], hipL: [-0.3, 0, -0.3], kneeL: [0.4, 0, 0], hipR: [0.2, 0, 0.3], kneeR: [0.2, 0, 0] });
  const clips: ClipData[] = [
    buildClip("idle", true, [{ t: 0, pose: idlePose }, { t: 1.1, pose: breathe, hips: [0, -0.012, 0] }, { t: 2.2, pose: idlePose }]),
    cycle("walk", 0.9, 0.5, 0.05, 0.03),
    cycle("run", 0.55, 0.95, 0.28, 0.06),
    buildClip("jump", false, [{ t: 0, pose: merge(STANCE, { hipL: [-0.8, 0, -0.1], kneeL: [1.2, 0, 0], hipR: [-0.8, 0, 0.1], kneeR: [1.2, 0, 0] } as Pose), hips: [0, -0.2, 0] }, { t: 0.12, pose: merge(STANCE, { spine: [-0.1, 0, 0], shoulderL: [1.5, 0, -0.5], shoulderR: [1.5, 0, 0.5], hipL: [-0.5, 0, -0.1], kneeL: [0.8, 0, 0], hipR: [0.1, 0, 0.1], kneeR: [0.2, 0, 0], ankleL: [0.5, 0, 0], ankleR: [0.5, 0, 0] } as Pose), hips: [0, 0.05, 0] }, { t: 0.4, pose: merge(STANCE, { shoulderL: [1.2, 0, -0.6], shoulderR: [1.2, 0, 0.6], hipL: [-0.4, 0, -0.1], kneeL: [0.9, 0, 0], hipR: [0.2, 0, 0.1], kneeR: [0.5, 0, 0] } as Pose) }]),
    buildClip("fall", true, [{ t: 0, pose: merge(STANCE, { spine: [0.1, 0, 0], shoulderL: [0.9, 0, -0.9], shoulderR: [0.9, 0, 0.9], elbowL: [-0.4, 0, 0], elbowR: [-0.4, 0, 0], hipL: [-0.3, 0, -0.2], kneeL: [0.7, 0, 0], hipR: [0.15, 0, 0.2], kneeR: [0.3, 0, 0] } as Pose) }, { t: 0.5, pose: merge(STANCE, { spine: [0.14, 0, 0], shoulderL: [1.1, 0, -1.0], shoulderR: [1.1, 0, 1.0], elbowL: [-0.5, 0, 0], elbowR: [-0.5, 0, 0], hipL: [-0.2, 0, -0.25], kneeL: [0.8, 0, 0], hipR: [0.25, 0, 0.25], kneeR: [0.4, 0, 0] } as Pose) }, { t: 1, pose: merge(STANCE, { spine: [0.1, 0, 0], shoulderL: [0.9, 0, -0.9], shoulderR: [0.9, 0, 0.9], elbowL: [-0.4, 0, 0], elbowR: [-0.4, 0, 0], hipL: [-0.3, 0, -0.2], kneeL: [0.7, 0, 0], hipR: [0.15, 0, 0.2], kneeR: [0.3, 0, 0] } as Pose) }]),
    buildClip("land", false, [{ t: 0, pose: merge(STANCE, { spine: [0.5, 0, 0], chest: [0.3, 0, 0], hipL: [-1.0, 0, -0.2], kneeL: [1.6, 0, 0], hipR: [-1.0, 0, 0.2], kneeR: [1.6, 0, 0], shoulderL: [0.5, 0, -0.4], shoulderR: [0.5, 0, 0.4] } as Pose), hips: [0, -0.35, 0] }, { t: 0.2, pose: STANCE, hips: [0, -0.05, 0] }, { t: 0.3, pose: idlePose }]),
    buildClip("guard", true, [{ t: 0, pose: guardPose, hips: lowHips }, { t: 0.6, pose: merge(guardPose, { chest: [0.15, 0, 0] } as Pose), hips: lowHips }, { t: 1.2, pose: guardPose, hips: lowHips }]),
    dashClip("dashFront", "front"), dashClip("dashSide", "side"), dashClip("dashBack", "back"),
    buildClip("hitLight", false, [{ t: 0, pose: idlePose }, { t: 0.07, pose: hit, hips: [0, -0.04, 0.08] }, { t: 0.28, pose: idlePose }]),
    buildClip("ragdollPose", true, [{ t: 0, pose: ragdoll, hips: [0, -0.2, 0.1] }, { t: 0.8, pose: merge(ragdoll, { chest: [0.32, 0.22, 0.1] } as Pose), hips: [0, -0.2, 0.1] }, { t: 1.6, pose: ragdoll, hips: [0, -0.2, 0.1] }]),
    buildClip("getup", false, [{ t: 0, pose: down, hips: [0, -0.4, 0.1] }, { t: 0.35, pose: merge(STANCE, { spine: [0.6, 0, 0], hipL: [-1.4, 0, -0.2], kneeL: [2.0, 0, 0], hipR: [-0.6, 0, 0.2], kneeR: [1.4, 0, 0], shoulderL: [0.6, 0, -0.5], shoulderR: [0.6, 0, 0.5] } as Pose), hips: [0, -0.32, 0.05] }, { t: 0.75, pose: idlePose }]),
    buildClip("death", false, [{ t: 0, pose: hit, hips: [0, -0.05, 0.05] }, { t: 0.4, pose: merge(ragdoll, { spine: [-0.3, 0, 0], hipL: [-0.5, 0, -0.2], kneeL: [0.8, 0, 0] } as Pose), hips: [0, -0.35, 0.2] }, { t: 0.9, pose: down, hips: [0, -0.62, 0.35] }]),
  ];
  for (const id of [...M1_CLIP_IDS, ...abilityClipIds(kit)]) clips.push(moveClip(id, kit));
  return clips;
}

/** Peak bone rotation (radians) in a clip relative to the first key; used by tests to prove clips actually move. */
export function clipMotionAmount(c: ClipData): number {
  let m = 0;
  for (const t of c.tracks) {
    if (t.path !== "rotation") continue;
    const n = t.times.length;
    for (let i = 1; i < n; i++) {
      let dot = 0;
      for (let k = 0; k < 4; k++) dot += (t.values[i * 4 + k] ?? 0) * (t.values[k] ?? 0);
      m = Math.max(m, 2 * Math.acos(Math.min(1, Math.abs(dot))));
    }
  }
  return m;
}
