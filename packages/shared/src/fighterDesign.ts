/**
 * Original fighter appearance definitions (spec sections 7 and 23, task T25). Pure data: each fighter is a list of
 * simple solid parts attached to rig bones, coloured from a per-kit palette. Silhouettes follow the identity briefs
 * in the specification (stone mantle and amber for Stone Vanguard, ivory/teal layers with a ceramic shoulder guard
 * for Tide Duelist, a segmented backpack with floating rings for Ember Artificer) and share one capsule scale so
 * hitboxes are unchanged. No third party model, texture or reference artwork is used.
 */
import type { KitId } from "./protocol.js";
import type { BoneName, Vec3 } from "./rig.js";

export type PartShape = "box" | "sphere" | "capsule" | "cone" | "cylinder" | "torus";
export type PaletteSlot = "skin" | "hair" | "primary" | "secondary" | "accent" | "trim" | "cloth" | "dark" | "stone";

export interface PartDef {
  readonly name: string;
  readonly shape: PartShape;
  readonly bone: BoneName;
  /** Offset from the bone origin in the rest pose. */
  readonly pos: Vec3;
  /** box [w,h,d]; sphere [r]; capsule [r,length]; cone [r,h]; cylinder [rTop,rBottom,h]; torus [R,r]. */
  readonly size: readonly number[];
  readonly rot?: Vec3;
  readonly color: PaletteSlot;
  /** Drawn unlit so it reads as a light source; skipped by the outline pass. */
  readonly glow?: boolean;
}

export interface FighterDesign {
  readonly kit: KitId;
  readonly label: string;
  readonly palette: Readonly<Record<PaletteSlot, number>>;
  readonly glowColor: number;
  readonly parts: readonly PartDef[];
}

type P = PartDef;
const part = (name: string, shape: PartShape, bone: BoneName, pos: Vec3, size: readonly number[], color: PaletteSlot, extra: { rot?: Vec3; glow?: boolean } = {}): P =>
  ({ name, shape, bone, pos, size, color, ...(extra.rot ? { rot: extra.rot } : {}), ...(extra.glow ? { glow: true } : {}) });

/** Body shared by every kit: pelvis, torso, head, limbs. Colour slots decide how it reads per kit. */
function body(): P[] {
  const out: P[] = [
    part("pelvis", "box", "hips", [0, 0, 0], [0.34, 0.2, 0.22], "dark"),
    part("belly", "box", "spine", [0, 0.04, 0], [0.33, 0.26, 0.21], "primary"),
    part("chest", "box", "chest", [0, 0.07, 0], [0.46, 0.36, 0.28], "primary"),
    part("neck", "cylinder", "neck", [0, 0.01, 0], [0.05, 0.055, 0.1], "skin"),
    part("head", "box", "head", [0, 0.085, -0.005], [0.25, 0.25, 0.23], "skin"),
    part("eyeL", "box", "head", [-0.045, 0.09, -0.108], [0.034, 0.022, 0.012], "dark"),
    part("eyeR", "box", "head", [0.045, 0.09, -0.108], [0.034, 0.022, 0.012], "dark"),
    part("hair", "box", "head", [0, 0.17, 0.03], [0.27, 0.12, 0.27], "hair"),
  ];
  for (const s of ["L", "R"] as const) {
    const x = s === "L" ? -1 : 1;
    const sh = `shoulder${s}` as BoneName, el = `elbow${s}` as BoneName, ha = `hand${s}` as BoneName;
    const hp = `hip${s}` as BoneName, kn = `knee${s}` as BoneName, an = `ankle${s}` as BoneName;
    out.push(
      part(`upperArm${s}`, "box", sh, [0, -0.14, 0], [0.14, 0.3, 0.14], "cloth"),
      part(`foreArm${s}`, "box", el, [0, -0.13, 0], [0.13, 0.28, 0.13], "skin"),
      part(`hand${s}`, "box", ha, [0, -0.035, 0], [0.12, 0.12, 0.12], "skin"),
      part(`thigh${s}`, "box", hp, [0, -0.2, 0], [0.19, 0.44, 0.2], "dark"),
      part(`shin${s}`, "box", kn, [0, -0.19, 0], [0.16, 0.4, 0.17], "dark"),
      part(`foot${s}`, "box", an, [x * 0.005, 0.04, -0.05], [0.125, 0.09, 0.27], "secondary"),
    );
  }
  return out;
}

/** Replaces a part of the shared body by name. */
function override(parts: P[], name: string, next: Partial<P>): P[] {
  return parts.map((p) => (p.name === name ? { ...p, ...next } as P : p));
}

function stoneVanguard(): FighterDesign {
  let parts = body();
  parts = override(parts, "chest", { color: "dark" });
  parts = override(parts, "belly", { color: "dark" });
  parts = override(parts, "pelvis", { color: "primary" });
  parts = override(parts, "upperArmL", { color: "skin" });
  parts = override(parts, "upperArmR", { color: "skin" });
  parts = override(parts, "foreArmL", { color: "stone" });
  parts = override(parts, "foreArmR", { color: "stone" });
  parts = override(parts, "hair", { size: [0.27, 0.1, 0.26], pos: [0, 0.17, 0.025] });
  parts = override(parts, "thigh" + "L", { color: "primary" });
  parts = override(parts, "thigh" + "R", { color: "primary" });
  parts.push(
    // Asymmetrical stone mantle: a heavy angular slab over the left shoulder, a smaller one on the right.
    part("mantleL", "box", "chest", [-0.27, 0.22, 0], [0.34, 0.16, 0.38], "stone", { rot: [0, 0, 0.25] }),
    part("mantleL2", "box", "chest", [-0.33, 0.14, 0.02], [0.24, 0.14, 0.32], "stone", { rot: [0, 0.2, 0.55] }),
    part("mantleSpikeL", "cone", "chest", [-0.3, 0.36, -0.02], [0.07, 0.2], "accent", { rot: [0, 0, 0.3] }),
    part("mantleSpikeL2", "cone", "chest", [-0.18, 0.33, 0.1], [0.05, 0.14], "accent", { rot: [0.3, 0, 0.1] }),
    part("mantleR", "box", "chest", [0.25, 0.23, 0.02], [0.2, 0.1, 0.24], "stone", { rot: [0, 0, -0.2] }),
    part("beltAmber", "box", "hips", [0, 0.11, 0], [0.36, 0.05, 0.24], "accent"),
    part("chestCrack", "box", "chest", [0.04, 0.07, -0.128], [0.03, 0.26, 0.01], "accent", { glow: true, rot: [0, 0, 0.35] }),
    part("bracerGlowL", "box", "elbowL", [0, -0.2, -0.05], [0.04, 0.05, 0.01], "accent", { glow: true }),
    part("bracerGlowR", "box", "elbowR", [0, -0.2, -0.05], [0.04, 0.05, 0.01], "accent", { glow: true }),
    part("knuckleL", "box", "handL", [0, -0.01, 0], [0.1, 0.07, 0.1], "stone"),
    part("knuckleR", "box", "handR", [0, -0.01, 0], [0.1, 0.07, 0.1], "stone"),
    part("bootWedgeL", "cone", "ankleL", [-0.005, 0.05, -0.17], [0.065, 0.12], "accent", { rot: [-Math.PI / 2, 0, 0] }),
    part("bootWedgeR", "cone", "ankleR", [0.005, 0.05, -0.17], [0.065, 0.12], "accent", { rot: [-Math.PI / 2, 0, 0] }),
    part("kneePlateL", "box", "kneeL", [0, 0.02, -0.075], [0.12, 0.1, 0.05], "stone"),
    part("kneePlateR", "box", "kneeR", [0, 0.02, -0.075], [0.12, 0.1, 0.05], "stone"),
  );
  return {
    kit: "sv", label: "Stone Vanguard", glowColor: 0xffa63a,
    palette: { skin: 0xc58b62, hair: 0x1b1714, primary: 0x3d4a8a, secondary: 0x2a2a30, accent: 0xffb020, trim: 0xf0a030, cloth: 0x3d3d46, dark: 0x2b2b32, stone: 0x8b8378 },
    parts,
  };
}

function tideDuelist(): FighterDesign {
  let parts = body();
  parts = override(parts, "chest", { color: "cloth", size: [0.43, 0.35, 0.26] });
  parts = override(parts, "belly", { color: "primary" });
  parts = override(parts, "pelvis", { color: "dark" });
  parts = override(parts, "upperArmL", { color: "cloth", size: [0.15, 0.3, 0.15] });
  parts = override(parts, "upperArmR", { color: "cloth", size: [0.15, 0.3, 0.15] });
  parts = override(parts, "foreArmL", { color: "cloth" });
  parts = override(parts, "foreArmR", { color: "cloth" });
  parts = override(parts, "foot" + "L", { color: "dark" });
  parts = override(parts, "foot" + "R", { color: "dark" });
  parts.push(
    // Layered ivory and teal fabric: overlapping coat panels and a sash.
    part("coatFront", "box", "chest", [0, -0.02, -0.13], [0.3, 0.38, 0.03], "trim"),
    part("lapelL", "box", "chest", [-0.1, 0.12, -0.14], [0.1, 0.2, 0.025], "secondary", { rot: [0, 0, 0.35] }),
    part("lapelR", "box", "chest", [0.1, 0.12, -0.14], [0.1, 0.2, 0.025], "secondary", { rot: [0, 0, -0.35] }),
    part("sash", "box", "hips", [0, 0.1, -0.005], [0.37, 0.09, 0.25], "secondary"),
    part("skirtFront", "box", "hips", [0, -0.2, -0.12], [0.26, 0.34, 0.03], "cloth", { rot: [0.08, 0, 0] }),
    part("skirtBack", "box", "hips", [0, -0.2, 0.12], [0.26, 0.36, 0.03], "secondary", { rot: [-0.08, 0, 0] }),
    part("sashTail", "box", "hips", [0.14, -0.15, 0.1], [0.07, 0.4, 0.02], "secondary", { rot: [-0.1, 0, -0.12] }),
    // Circular ceramic shoulder guard on the right shoulder, with a teal rim and droplet core.
    part("guardDisc", "cylinder", "chest", [0.3, 0.2, 0], [0.17, 0.17, 0.05], "trim", { rot: [0, 0, Math.PI / 2] }),
    part("guardRim", "torus", "chest", [0.33, 0.2, 0], [0.165, 0.018], "secondary", { rot: [0, Math.PI / 2, 0] }),
    part("guardCore", "sphere", "chest", [0.345, 0.2, 0], [0.04], "accent", { glow: true }),
    // Tied copper hair: crown, tie and a ponytail.
    part("hairTie", "sphere", "head", [0, 0.1, 0.13], [0.035], "accent"),
    part("ponytail", "capsule", "head", [0, 0.03, 0.2], [0.045, 0.2], "hair", { rot: [0.5, 0, 0] }),
    part("bangs", "box", "head", [0, 0.18, -0.07], [0.19, 0.04, 0.09], "hair", { rot: [-0.3, 0, 0] }),
    part("wristTealL", "cylinder", "elbowL", [0, -0.2, 0], [0.06, 0.06, 0.06], "accent"),
    part("wristTealR", "cylinder", "elbowR", [0, -0.2, 0], [0.06, 0.06, 0.06], "accent"),
  );
  return {
    kit: "td", label: "Tide Duelist", glowColor: 0x5fe3d3,
    palette: { skin: 0xd9a47c, hair: 0xb8591f, primary: 0xf6f0dc, secondary: 0x12b5b0, accent: 0x40f0dc, trim: 0xf5f0e4, cloth: 0xe6e0cf, dark: 0x26343f, stone: 0xb9c3c6 },
    parts,
  };
}

function emberArtificer(): FighterDesign {
  let parts = body();
  parts = override(parts, "chest", { color: "primary" });
  parts = override(parts, "belly", { color: "dark" });
  parts = override(parts, "pelvis", { color: "secondary" });
  parts = override(parts, "upperArmL", { color: "primary" });
  parts = override(parts, "upperArmR", { color: "primary" });
  parts = override(parts, "foreArmL", { color: "dark" });
  parts = override(parts, "foreArmR", { color: "dark" });
  parts = override(parts, "hair", { color: "stone", size: [0.27, 0.1, 0.26], pos: [0, 0.17, 0.04] });
  parts.push(
    // Segmented ceramic backpack: three stacked plates with copper bands.
    part("packA", "box", "chest", [0, 0.2, 0.2], [0.3, 0.16, 0.14], "trim"),
    part("packB", "box", "chest", [0, 0.03, 0.2], [0.34, 0.16, 0.16], "trim"),
    part("packC", "box", "spine", [0, 0.0, 0.2], [0.3, 0.16, 0.15], "trim"),
    part("bandA", "box", "chest", [0, 0.115, 0.2], [0.36, 0.03, 0.18], "accent"),
    part("bandB", "box", "chest", [0, -0.05, 0.2], [0.36, 0.03, 0.18], "accent"),
    part("ventL", "cylinder", "chest", [-0.1, 0.3, 0.22], [0.035, 0.045, 0.1], "dark"),
    part("ventR", "cylinder", "chest", [0.1, 0.3, 0.22], [0.035, 0.045, 0.1], "dark"),
    part("ventGlowL", "sphere", "chest", [-0.1, 0.36, 0.22], [0.03], "accent", { glow: true }),
    part("ventGlowR", "sphere", "chest", [0.1, 0.36, 0.22], [0.03], "accent", { glow: true }),
    // Floating copper rings orbiting the backpack (they ride the chest bone).
    part("ringOuter", "torus", "chest", [0, 0.2, 0.42], [0.3, 0.022], "accent", { rot: [Math.PI / 2 - 0.35, 0, 0.2], glow: true }),
    part("ringInner", "torus", "chest", [0, 0.2, 0.42], [0.2, 0.018], "trim", { rot: [Math.PI / 2 + 0.4, 0.5, 0] }),
    // Independent gauntlets with heat vents.
    part("gauntletL", "box", "elbowL", [0, -0.14, 0], [0.15, 0.2, 0.15], "secondary"),
    part("gauntletR", "box", "elbowR", [0, -0.14, 0], [0.15, 0.2, 0.15], "secondary"),
    part("gauntletVentL", "box", "elbowL", [0, -0.14, -0.078], [0.1, 0.03, 0.01], "accent", { glow: true }),
    part("gauntletVentR", "box", "elbowR", [0, -0.14, -0.078], [0.1, 0.03, 0.01], "accent", { glow: true }),
    part("gauntletRingL", "torus", "handL", [0, 0.08, 0], [0.09, 0.012], "accent", { rot: [Math.PI / 2, 0, 0], glow: true }),
    part("gauntletRingR", "torus", "handR", [0, 0.08, 0], [0.09, 0.012], "accent", { rot: [Math.PI / 2, 0, 0], glow: true }),
    // Engineer goggles pushed up on the forehead.
    part("goggleBand", "box", "head", [0, 0.14, -0.035], [0.25, 0.035, 0.22], "dark"),
    part("lensL", "cylinder", "head", [-0.05, 0.165, -0.105], [0.035, 0.035, 0.03], "accent", { rot: [Math.PI / 2, 0, 0], glow: true }),
    part("lensR", "cylinder", "head", [0.05, 0.165, -0.105], [0.035, 0.035, 0.03], "accent", { rot: [Math.PI / 2, 0, 0], glow: true }),
    part("bootCapL", "box", "ankleL", [0, 0.08, -0.04], [0.14, 0.1, 0.28], "accent"),
    part("bootCapR", "box", "ankleR", [0, 0.08, -0.04], [0.14, 0.1, 0.28], "accent"),
  );
  return {
    kit: "ea", label: "Ember Artificer", glowColor: 0xffb070,
    palette: { skin: 0xe2b89a, hair: 0x5a2a44, primary: 0xb03a8c, secondary: 0x6a2a6a, accent: 0xff8a2a, trim: 0xf6dcc0, cloth: 0x7a3a66, dark: 0x2a1a2a, stone: 0xe8c9a8 },
    parts,
  };
}

export const FIGHTER_DESIGNS: Readonly<Record<KitId, FighterDesign>> = { sv: stoneVanguard(), td: tideDuelist(), ea: emberArtificer() };
