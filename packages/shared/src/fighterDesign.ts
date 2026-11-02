/**
 * Original fighter appearance definitions (spec sections 7 and 23, task T25). Pure data: each fighter is a list of
 * simple solid parts attached to rig bones, coloured from a per-kit palette. Silhouettes follow the identity briefs
 * in the specification (stone mantle and amber for Stone Vanguard, ivory/teal layers with a ceramic shoulder guard
 * for Tide Duelist, a segmented backpack with floating rings for Ember Artificer) and share one capsule scale so
 * hitboxes are unchanged. No third party model, texture or reference artwork is used.
 */
import type { KitId } from "./protocol.js";
import type { BoneName, Vec3 } from "./rig.js";

/** "box" is a rounded box (beveled, 2 segments per side at medium detail); "limb" is a tapered capsule skinned over two bones. */
export type PartShape = "box" | "sphere" | "capsule" | "cone" | "cylinder" | "torus" | "limb";
export type PaletteSlot = "skin" | "hair" | "primary" | "secondary" | "accent" | "trim" | "cloth" | "dark" | "stone";

export interface PartDef {
  readonly name: string;
  readonly shape: PartShape;
  readonly bone: BoneName;
  /** Offset from the bone origin in the rest pose. */
  readonly pos: Vec3;
  /** box [w,h,d]; sphere [r]; capsule [r,length]; cone [r,h]; cylinder [rTop,rBottom,h]; torus [R,r];
   * limb [rTop,rBottom,length,bulge] hanging down -Y from pos, blended with the neighbouring bones at its joints. */
  readonly size: readonly number[];
  readonly rot?: Vec3;
  readonly color: PaletteSlot;
  /** Drawn unlit so it reads as a light source; skipped by the outline pass. */
  readonly glow?: boolean;
  /** Box bevel radius in metres (default: a small share of the smallest side). */
  readonly bevel?: number;
  /** QF01: a glow part that is only built while the fighter is Awakened (amber seams); ignored for non glow parts. */
  readonly awakened?: boolean;
  /** Small detail (brows, mouth, thumb): only built at medium detail, skipped by the low-poly level of detail. */
  readonly fine?: boolean;
}

export interface FighterDesign {
  readonly kit: KitId;
  readonly label: string;
  readonly palette: Readonly<Record<PaletteSlot, number>>;
  readonly glowColor: number;
  readonly parts: readonly PartDef[];
}

type P = PartDef;
const part = (name: string, shape: PartShape, bone: BoneName, pos: Vec3, size: readonly number[], color: PaletteSlot, extra: { rot?: Vec3; glow?: boolean; bevel?: number; fine?: boolean; awakened?: boolean } = {}): P =>
  ({ name, shape, bone, pos, size, color, ...(extra.rot ? { rot: extra.rot } : {}), ...(extra.glow ? { glow: true } : {}), ...(extra.bevel !== undefined ? { bevel: extra.bevel } : {}), ...(extra.fine ? { fine: true } : {}), ...(extra.awakened ? { awakened: true } : {}) });

/** Limb sizes [rTop, rBottom, length, bulge]; lengths match the rig bone spacing so joints sit on bone origins. */
const ARM_UPPER = [0.075, 0.06, 0.28, 0.006] as const;
const ARM_LOWER = [0.06, 0.048, 0.26, 0.004] as const;
const LEG_UPPER = [0.105, 0.075, 0.42, 0.008] as const;
const LEG_LOWER = [0.075, 0.056, 0.38, 0.006] as const;

/** Body shared by every kit: pelvis, torso, head, limbs. Colour slots decide how it reads per kit. */
function body(): P[] {
  const out: P[] = [
    part("pelvis", "box", "hips", [0, 0, 0], [0.34, 0.2, 0.22], "dark", { bevel: 0.05 }),
    part("belly", "box", "spine", [0, 0.04, 0], [0.33, 0.26, 0.21], "primary", { bevel: 0.05 }),
    part("chest", "box", "chest", [0, 0.07, 0], [0.46, 0.36, 0.28], "primary", { bevel: 0.07 }),
    part("neck", "cylinder", "neck", [0, 0.01, 0], [0.05, 0.055, 0.1], "skin"),
    part("head", "box", "head", [0, 0.085, -0.005], [0.25, 0.25, 0.23], "skin", { bevel: 0.09 }),
    part("eyeL", "box", "head", [-0.05, 0.09, -0.12], [0.034, 0.024, 0.012], "dark", { bevel: 0.006 }),
    part("eyeR", "box", "head", [0.05, 0.09, -0.12], [0.034, 0.024, 0.012], "dark", { bevel: 0.006 }),
    part("browL", "box", "head", [-0.05, 0.125, -0.121], [0.06, 0.014, 0.012], "hair", { rot: [0, 0, 0.18], bevel: 0.005, fine: true }),
    part("browR", "box", "head", [0.05, 0.125, -0.121], [0.06, 0.014, 0.012], "hair", { rot: [0, 0, -0.18], bevel: 0.005, fine: true }),
    part("mouth", "box", "head", [0, 0.03, -0.121], [0.05, 0.01, 0.012], "dark", { bevel: 0.004, fine: true }),
    part("hair", "box", "head", [0, 0.17, 0.03], [0.27, 0.12, 0.27], "hair", { bevel: 0.05 }),
  ];
  for (const s of ["L", "R"] as const) {
    const x = s === "L" ? -1 : 1;
    const sh = `shoulder${s}` as BoneName, el = `elbow${s}` as BoneName, ha = `hand${s}` as BoneName;
    const hp = `hip${s}` as BoneName, kn = `knee${s}` as BoneName, an = `ankle${s}` as BoneName;
    out.push(
      part(`upperArm${s}`, "limb", sh, [0, 0, 0], ARM_UPPER, "cloth"),
      part(`elbowJoint${s}`, "sphere", el, [0, 0, 0], [0.061], "skin"),
      part(`foreArm${s}`, "limb", el, [0, 0, 0], ARM_LOWER, "skin"),
      part(`hand${s}`, "box", ha, [0, -0.05, 0], [0.09, 0.1, 0.05], "skin", { bevel: 0.02 }),
      part(`thumb${s}`, "capsule", ha, [-x * 0.052, -0.035, -0.012], [0.017, 0.045], "skin", { rot: [0, 0, -x * 0.35], fine: true }),
      part(`thigh${s}`, "limb", hp, [0, 0, 0], LEG_UPPER, "dark"),
      part(`shin${s}`, "limb", kn, [0, 0, 0], LEG_LOWER, "dark"),
      part(`foot${s}`, "box", an, [x * 0.005, 0.04, -0.05], [0.125, 0.09, 0.27], "secondary", { bevel: 0.035 }),
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
  // QF01: heavy asymmetric forearms. The left (lead) arm is a thick stone pillar, the right a lighter bracer.
  // Ring radii match across each elbow (upper arm bottom == forearm top) so the joint blend stays closed.
  parts = override(parts, "upperArmL", { size: [0.09, 0.078, 0.28, 0.01] });
  parts = override(parts, "foreArmL", { color: "stone", size: [0.078, 0.072, 0.26, 0.022] });
  parts = override(parts, "foreArmR", { color: "stone", size: [0.06, 0.056, 0.26, 0.014] });
  parts = override(parts, "chest", { size: [0.5, 0.36, 0.28] });
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
    // Armour layers: hanging tassets and a back slab so the rear silhouette is blocky and heavy.
    part("tassetL", "box", "hips", [-0.13, -0.14, -0.1], [0.14, 0.2, 0.04], "stone", { rot: [0.1, 0, 0.05], bevel: 0.015 }),
    part("tassetR", "box", "hips", [0.13, -0.14, -0.1], [0.14, 0.2, 0.04], "stone", { rot: [0.1, 0, -0.05], bevel: 0.015 }),
    part("backSlab", "box", "chest", [0, 0.1, 0.17], [0.34, 0.3, 0.07], "stone", { bevel: 0.025 }),
    // QF01 broad trapezoid shoulders: two sloped trapezius wedges climb from the neck to the mantles.
    part("trapL", "box", "chest", [-0.15, 0.3, 0.01], [0.3, 0.09, 0.32], "stone", { rot: [0, 0, 0.32], bevel: 0.03 }),
    part("trapR", "box", "chest", [0.15, 0.3, 0.01], [0.3, 0.09, 0.32], "stone", { rot: [0, 0, -0.32], bevel: 0.03 }),
    // QF01 layered stone slabs seen from behind: three offset plates step down the back, plus a skirt slab over the hips.
    part("backSlab2", "box", "chest", [0.07, -0.02, 0.2], [0.28, 0.2, 0.06], "stone", { rot: [0, 0.06, -0.05], bevel: 0.02 }),
    part("backSlab3", "box", "spine", [-0.06, 0.0, 0.18], [0.3, 0.18, 0.06], "stone", { rot: [0, -0.07, 0.04], bevel: 0.02 }),
    part("skirtSlab", "box", "hips", [0.02, -0.12, 0.13], [0.3, 0.2, 0.05], "stone", { rot: [-0.08, 0, 0], bevel: 0.02 }),
    // Heavy asymmetric bracer slabs: big on the left, shorter on the right.
    part("bracerSlabL", "box", "elbowL", [0, -0.14, 0], [0.19, 0.2, 0.17], "stone", { bevel: 0.03 }),
    part("bracerSlabR", "box", "elbowR", [0, -0.12, 0], [0.14, 0.14, 0.13], "stone", { bevel: 0.025 }),
    // QF01 amber seams: glow strips that only exist while Awakened.
    part("seamBackA", "box", "chest", [0, 0.1, 0.208], [0.03, 0.26, 0.01], "accent", { glow: true, awakened: true }),
    part("seamBackB", "box", "spine", [-0.06, 0.0, 0.212], [0.22, 0.025, 0.01], "accent", { glow: true, awakened: true }),
    part("seamShoulderL", "box", "chest", [-0.2, 0.345, 0.01], [0.2, 0.02, 0.2], "accent", { glow: true, awakened: true, rot: [0, 0, 0.32] }),
    part("seamShoulderR", "box", "chest", [0.2, 0.345, 0.01], [0.2, 0.02, 0.2], "accent", { glow: true, awakened: true, rot: [0, 0, -0.32] }),
    part("seamBracerL", "box", "elbowL", [0, -0.14, -0.088], [0.14, 0.025, 0.01], "accent", { glow: true, awakened: true }),
    part("seamBracerR", "box", "elbowR", [0, -0.12, -0.068], [0.1, 0.025, 0.01], "accent", { glow: true, awakened: true }),
  );
  return {
    kit: "sv", label: "Stone Vanguard", glowColor: 0xffa63a,
    palette: { skin: 0xc58b62, hair: 0x1b1714, primary: 0x3d4a8a, secondary: 0x2a2a30, accent: 0xffb020, trim: 0xf0a030, cloth: 0x3d3d46, dark: 0x2b2b32, stone: 0x8b8378 },
    parts,
  };
}

function tideDuelist(): FighterDesign {
  let parts = body();
  // QF02 narrow shoulders: the chest is slimmer than the Vanguard's wedge and the old wide cape is gone.
  parts = override(parts, "chest", { color: "cloth", size: [0.35, 0.35, 0.23] });
  parts = override(parts, "belly", { color: "primary" });
  parts = override(parts, "pelvis", { color: "dark" });
  parts = override(parts, "upperArmL", { color: "cloth", size: [0.082, 0.06, 0.28, 0.01] });
  parts = override(parts, "upperArmR", { color: "cloth", size: [0.082, 0.06, 0.28, 0.01] });
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
    // QF02 split hip panels: two unequal panels hang apart at the hip (long left, short right) so the legs read between them.
    part("panelL", "box", "hips", [-0.15, -0.22, -0.07], [0.12, 0.4, 0.03], "cloth", { rot: [0.08, 0, 0.1] }),
    part("panelR", "box", "hips", [0.14, -0.17, -0.07], [0.1, 0.3, 0.03], "secondary", { rot: [0.06, 0, -0.1] }),
    part("panelBackL", "box", "hips", [-0.1, -0.22, 0.12], [0.1, 0.34, 0.025], "secondary", { rot: [-0.1, 0, 0.08] }),
    // Circular ceramic shoulder guard on the right shoulder, with a teal rim and droplet core.
    part("guardDisc", "cylinder", "chest", [0.3, 0.2, 0], [0.17, 0.17, 0.05], "trim", { rot: [0, 0, Math.PI / 2] }),
    part("guardRim", "torus", "chest", [0.33, 0.2, 0], [0.165, 0.018], "secondary", { rot: [0, Math.PI / 2, 0] }),
    part("guardCore", "sphere", "chest", [0.345, 0.2, 0], [0.04], "accent", { glow: true }),
    // Tied copper hair: crown, tie and a ponytail.
    part("ponytail", "capsule", "head", [0, 0.03, 0.2], [0.045, 0.2], "hair", { rot: [0.5, 0, 0] }),
    part("bangs", "box", "head", [0, 0.18, -0.07], [0.19, 0.04, 0.09], "hair", { rot: [-0.3, 0, 0] }),
    part("wristTealL", "cylinder", "elbowL", [0, -0.2, 0], [0.06, 0.06, 0.06], "accent"),
    part("wristTealR", "cylinder", "elbowR", [0, -0.2, 0], [0.06, 0.06, 0.06], "accent"),
    // QF02 long asymmetric scarf: a collar ring and two stacked tails that trail from the neck down the left side of the back.
    part("scarf", "torus", "neck", [0, -0.02, 0], [0.085, 0.028], "secondary", { rot: [Math.PI / 2, 0, 0] }),
    part("scarfTailA", "box", "chest", [-0.08, 0.04, 0.15], [0.1, 0.46, 0.025], "secondary", { rot: [-0.14, 0, 0.1], bevel: 0.01 }),
    part("scarfTailB", "box", "spine", [-0.17, -0.2, 0.17], [0.08, 0.5, 0.022], "cloth", { rot: [-0.2, 0, 0.16], bevel: 0.008 }),
    // QF02 forked crest: two glow blades above the brow, only while Awakened.
    part("crestL", "cone", "head", [-0.06, 0.3, -0.02], [0.03, 0.2], "accent", { glow: true, awakened: true, rot: [0, 0, 0.35] }),
    part("crestR", "cone", "head", [0.06, 0.3, -0.02], [0.03, 0.2], "accent", { glow: true, awakened: true, rot: [0, 0, -0.35] }),
  );
  return {
    kit: "td", label: "Tide Duelist", glowColor: 0x5fe3d3,
    palette: { skin: 0xd9a47c, hair: 0xb8591f, primary: 0xf6f0dc, secondary: 0x12b5b0, accent: 0x40f0dc, trim: 0xf5f0e4, cloth: 0xe6e0cf, dark: 0x26343f, stone: 0xb9c3c6 },
    parts,
  };
}

function emberArtificer(): FighterDesign {
  let parts = body();
  // QF03 compact torso: the chest is slimmer and shallower than the Vanguard's wedge so the furnace pack carries the outline.
  parts = override(parts, "chest", { color: "primary", size: [0.4, 0.34, 0.24] });
  parts = override(parts, "belly", { color: "dark" });
  parts = override(parts, "pelvis", { color: "secondary" });
  parts = override(parts, "upperArmL", { color: "primary" });
  parts = override(parts, "upperArmR", { color: "primary" });
  parts = override(parts, "foreArmL", { color: "dark" });
  parts = override(parts, "foreArmR", { color: "dark" });
  parts = override(parts, "hair", { color: "stone", size: [0.27, 0.1, 0.26], pos: [0, 0.17, 0.04] });
  parts.push(
    // QF03 tapered furnace backpack: wide hot base on the spine, narrowing in two steps to a chimney stack. Copper bands.
    part("packC", "box", "spine", [0, -0.02, 0.2], [0.4, 0.2, 0.17], "trim"),
    part("packB", "box", "chest", [0, 0.01, 0.2], [0.3, 0.17, 0.16], "trim"),
    part("packA", "box", "chest", [0, 0.2, 0.2], [0.2, 0.18, 0.12], "trim"),
    part("bandA", "box", "chest", [0, 0.115, 0.2], [0.3, 0.03, 0.17], "accent"),
    part("bandB", "box", "chest", [0, -0.07, 0.2], [0.34, 0.03, 0.18], "accent"),
    // Chimney stack on top with a glowing mouth.
    part("stack", "cylinder", "chest", [0, 0.36, 0.2], [0.055, 0.07, 0.16], "dark"),
    part("stackGlow", "sphere", "chest", [0, 0.45, 0.2], [0.035], "accent", { glow: true }),
    // QF03 side vents: dark louvre blocks and glowing slits on both flanks of the pack, visible from behind and the side.
    part("ventL", "box", "chest", [-0.19, 0.03, 0.2], [0.07, 0.18, 0.14], "dark"),
    part("ventR", "box", "chest", [0.19, 0.03, 0.2], [0.07, 0.18, 0.14], "dark"),
    part("ventGlowL", "box", "chest", [-0.228, 0.03, 0.2], [0.012, 0.12, 0.09], "accent", { glow: true }),
    part("ventGlowR", "box", "chest", [0.228, 0.03, 0.2], [0.012, 0.12, 0.09], "accent", { glow: true }),
    // QF03 Awakened: two clear vent fins flare out from the flanks of the pack.
    part("finL", "cone", "chest", [-0.26, 0.3, 0.2], [0.075, 0.44], "accent", { glow: true, awakened: true, rot: [0, 0, 0.6] }),
    part("finR", "cone", "chest", [0.26, 0.3, 0.2], [0.075, 0.44], "accent", { glow: true, awakened: true, rot: [0, 0, -0.6] }),
    // QF03 asymmetric forearms: a big insulated guard on the left forearm, a slim heat vent on the right.
    part("gauntletL", "box", "elbowL", [0, -0.14, 0], [0.22, 0.3, 0.2], "trim", { bevel: 0.03 }),
    part("gauntletR", "box", "elbowR", [0, -0.14, 0], [0.13, 0.2, 0.13], "secondary"),
    part("gauntletVentL", "box", "elbowL", [0, -0.14, -0.103], [0.14, 0.03, 0.01], "accent", { glow: true }),
    part("gauntletVentR", "box", "elbowR", [0, -0.14, -0.068], [0.09, 0.03, 0.01], "accent", { glow: true }),
    part("gauntletRingL", "torus", "handL", [0, 0.08, 0], [0.09, 0.012], "accent", { rot: [Math.PI / 2, 0, 0], glow: true }),
    part("gauntletRingR", "torus", "handR", [0, 0.08, 0], [0.09, 0.012], "accent", { rot: [Math.PI / 2, 0, 0], glow: true }),
    // Engineer goggles pushed up on the forehead.
    part("goggleBand", "box", "head", [0, 0.14, -0.035], [0.25, 0.035, 0.22], "dark"),
    part("lensL", "cylinder", "head", [-0.05, 0.165, -0.105], [0.035, 0.035, 0.03], "accent", { rot: [Math.PI / 2, 0, 0], glow: true }),
    part("lensR", "cylinder", "head", [0.05, 0.165, -0.105], [0.035, 0.035, 0.03], "accent", { rot: [Math.PI / 2, 0, 0], glow: true }),
    part("bootCapL", "box", "ankleL", [0, 0.08, -0.04], [0.14, 0.1, 0.28], "accent"),
    part("bootCapR", "box", "ankleR", [0, 0.08, -0.04], [0.14, 0.1, 0.28], "accent"),
    part("apron", "box", "hips", [0, -0.17, -0.12], [0.22, 0.3, 0.03], "trim", { rot: [0.06, 0, 0], bevel: 0.012 }),
  );
  return {
    kit: "ea", label: "Ember Artificer", glowColor: 0xffb070,
    palette: { skin: 0xe2b89a, hair: 0x5a2a44, primary: 0xb03a8c, secondary: 0x6a2a6a, accent: 0xff8a2a, trim: 0xf6dcc0, cloth: 0x7a3a66, dark: 0x2a1a2a, stone: 0xe8c9a8 },
    parts,
  };
}

export const FIGHTER_DESIGNS: Readonly<Record<KitId, FighterDesign>> = { sv: stoneVanguard(), td: tideDuelist(), ea: emberArtificer() };
