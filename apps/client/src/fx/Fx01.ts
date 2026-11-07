import { DENSITY, type GlowTier } from "../scene/GlowLayer.js";
import { THEME, elementOf, elementOfMove, impactPower, shakeFor, type Element, type Theme } from "./Impact.js";

/**
 * FX01 effect selector. Pure tables and functions: a confirmed server event (or a replicated action phase) plus the actor's
 * replicated `beast` flag and the quality tier go in, an effect spec comes out. The player (LayeredFx.ts) turns a spec into
 * pooled particles, glow slots, ground decals and a screen pulse. Nothing here reads input or schedules gameplay; every
 * number is a presentation value (not a game rule).
 */

export type Tier = GlowTier;
export type Linger = "embers" | "smoke" | "mist" | "dust";
export type ScorchKind = "scorch" | "puddle" | "fracture";

/** Per-tier presentation budget. Counts are further multiplied by the glow density of the tier. */
export interface FxTier { decals: number; decalLifeSec: number; halo: boolean; chroma: boolean; auraPerSec: number; lingerMax: number }
export const FX_TIER: Readonly<Record<Tier, FxTier>> = {
  low: { decals: 3, decalLifeSec: 4, halo: false, chroma: false, auraPerSec: 5, lingerMax: 8 },
  medium: { decals: 8, decalLifeSec: 7, halo: true, chroma: true, auraPerSec: 12, lingerMax: 16 },
  high: { decals: 14, decalLifeSec: 10, halo: true, chroma: true, auraPerSec: 22, lingerMax: 28 },
};

/** Beast form palette: deep lava reds (additive-safe: still bright enough to read) in place of the element colours. */
export const BEAST_THEME: Theme = { core: 0xffc27a, accent: 0xff4a0a, dark: 0xa01800, spark: 0xff7a22 };
export const SMOKE_COLOR = 0x2b2622;
const DUST_COLOR: Readonly<Record<Element, number>> = { stone: 0xb8a58c, water: 0xcfe8f5, ember: 0x6a5a4c, neutral: 0xb8a58c };
export const dustColorOf = (el: Element, beast: boolean): number => (beast ? 0x4a3a30 : DUST_COLOR[el]);

/** Slotted specials 1-4 of the base (b) and awakened (a) kits of all three fighters. */
export const SPECIAL_RE = /^(sv|td|ea)\.[ba][1-4]$/;
export const isSpecial = (moveId: string | undefined): boolean => moveId !== undefined && SPECIAL_RE.test(moveId);
const isBasic = (moveId: string | undefined): boolean => moveId !== undefined && /^(m1\.|dash\.forward)/.test(moveId);

export interface SpecialLayer {
  /** What lingers after the impact: embers rise (ember), smoke drifts, mist floats (water), dust settles (stone). */
  linger: Linger;
  /** Ground decal left behind. */
  scorch: ScorchKind;
  /** Decal radius in metres at medium tier. */
  radius: number;
  /** Multiplier on the travel trail glow. */
  trail: number;
  /** Multiplier on the impact explosion flash and light. */
  flash: number;
}
const L = (linger: Linger, scorch: ScorchKind, radius: number, trail: number, flash: number): SpecialLayer => ({ linger, scorch, radius, trail, flash });

/**
 * Stone Vanguard: dust, smoke and dark fractures. Tide Duelist: mist and wet puddles. Ember Artificer: rising embers, smoke and
 * scorch marks. Awakened specials are larger. One entry per ability id, so every special has its own recipe.
 */
export const SPECIAL_LAYERS: Readonly<Record<string, SpecialLayer>> = {
  "sv.b1": L("dust", "fracture", 2.0, 1.0, 1.1), "sv.b2": L("dust", "fracture", 1.1, 1.3, 0.7), "sv.b3": L("smoke", "fracture", 1.4, 1.0, 1.2), "sv.b4": L("dust", "fracture", 1.8, 1.4, 1.1),
  "sv.a1": L("smoke", "fracture", 2.6, 1.2, 1.6), "sv.a2": L("dust", "fracture", 3.4, 1.8, 1.8), "sv.a3": L("smoke", "fracture", 3.0, 2.0, 1.8), "sv.a4": L("dust", "fracture", 3.2, 1.5, 1.6),
  "td.b1": L("mist", "puddle", 1.8, 1.2, 1.0), "td.b2": L("mist", "puddle", 1.4, 1.4, 0.9), "td.b3": L("mist", "puddle", 2.0, 1.0, 1.0), "td.b4": L("mist", "puddle", 2.2, 1.1, 1.2),
  "td.a1": L("mist", "puddle", 3.0, 1.6, 1.6), "td.a2": L("mist", "puddle", 3.4, 1.8, 1.8), "td.a3": L("mist", "puddle", 3.0, 1.6, 1.6), "td.a4": L("mist", "puddle", 3.2, 1.6, 1.7),
  "ea.b1": L("embers", "scorch", 1.6, 1.3, 1.0), "ea.b2": L("embers", "scorch", 2.2, 1.0, 1.1), "ea.b3": L("smoke", "scorch", 1.4, 1.2, 1.0), "ea.b4": L("embers", "scorch", 2.0, 1.4, 1.2),
  "ea.a1": L("embers", "scorch", 2.8, 1.6, 1.6), "ea.a2": L("smoke", "scorch", 2.8, 1.6, 1.6), "ea.a3": L("embers", "scorch", 3.4, 2.0, 1.8), "ea.a4": L("embers", "scorch", 3.8, 1.8, 2.0),
};
const ELEMENT_LAYER: Readonly<Record<Element, SpecialLayer>> = {
  stone: L("dust", "fracture", 1.4, 1, 1), water: L("mist", "puddle", 1.4, 1, 1), ember: L("embers", "scorch", 1.4, 1, 1), neutral: L("dust", "scorch", 1.2, 1, 1),
};
export const layerOf = (moveId: string | undefined, el: Element): SpecialLayer => (moveId ? SPECIAL_LAYERS[moveId] : undefined) ?? ELEMENT_LAYER[el];

/** Beast variants are this much bigger than the base effect. */
export const BEAST_SCALE = 1.6;

export interface HitFxInput {
  kind: string;
  moveId?: string | undefined;
  hitClass?: string | undefined;
  damage100?: number | undefined;
  targetHp100?: number | undefined;
  /** Replicated `beast` flag of the ACTOR (the attacker). */
  actorBeast: boolean;
  /** Element of the attacker's kit when the move id carries none (m1 and dash moves). */
  kitId?: string | undefined;
  tier: Tier;
  reducedMotion: boolean;
  /** The player's flash setting, 0..1. */
  flashLevel: number;
  /** False when the ground height under the contact is unknown (no decal then). */
  hasGround: boolean;
}

export interface HitLayerSpec {
  element: Element;
  beast: boolean;
  special: boolean;
  power: number;
  palette: Theme;
  scale: number;
  dust: number;
  embers: number;
  smoke: number;
  debris: number;
  halo: { size: number } | null;
  /** Extra expanding ground shock rings (the shared impact already draws two). */
  shockRings: number;
  shockRadius: number;
  /** Beast only: glowing ground cracks radiating from the contact. */
  cracks: { count: number; length: number } | null;
  scorch: { kind: ScorchKind; radius: number; lifeSec: number; hot: boolean } | null;
  linger: { kind: Linger; count: number } | null;
  /** Victim rim light in the element accent. */
  rim: { color: number; ms: number } | null;
  pulse: { strength: number; ms: number; chroma: boolean; color: number } | null;
  /** Presentation-only animation freeze for attacker and victim, 0 (none) or 2..5 render frames. */
  freezeFrames: number;
  shake: { amplitude: number; ms: number };
  /** Short bright point light at the contact (zero lights on Low are handled by the glow layer). */
  light: { intensity: number; life: number };
}

const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));
const n = (v: number, density: number, min = 0): number => (v <= 0 ? 0 : Math.max(min, Math.round(v * density)));

/**
 * Hit-stop policy (decision 0055): the generic on-hit freeze stays off for basic strikes (decision 0049, owner requirement). Only
 * ability hits, beast-form hits and KOs get a short visual freeze, 2 to 5 frames, presentation only.
 */
export function selectHitFx(i: HitFxInput): HitLayerSpec | null {
  if (i.kind !== "hit" && i.kind !== "ko") return null;
  const damage = i.damage100 ?? 0;
  if (i.kind === "hit" && damage <= 0) return null;
  const killing = i.kind === "ko" || i.targetHp100 === 0;
  const special = isSpecial(i.moveId), beast = i.actorBeast;
  const el = elementOfMove(i.moveId) !== "neutral" ? elementOfMove(i.moveId) : elementOf(i.kitId);
  const base = impactPower(damage, i.hitClass === "heavy", /^m1\.4(\.|$)/.test(i.moveId ?? ""), killing);
  const power = clamp(base * (beast ? 1.35 : 1) * (special ? 1.2 : 1), 0.3, 3);
  const heavy = i.hitClass === "heavy" || special || beast || killing || power >= 1;
  const tier = FX_TIER[i.tier], d = DENSITY[i.tier], s = beast ? BEAST_SCALE : 1;
  const palette = beast ? BEAST_THEME : THEME[el];
  const layer = layerOf(i.moveId, el);
  const showy = heavy && !i.reducedMotion;

  const hot = beast || el === "ember";
  const sk = shakeFor(power);
  const strength = i.flashLevel <= 0 || i.reducedMotion || !(heavy || killing) ? 0 : clamp((0.2 + 0.28 * power) * (beast ? 1.3 : 1), 0, 0.9) * clamp(0.4 + i.flashLevel, 0.4, 1);
  const lingerKind: Linger | null = special ? layer.linger : beast ? "smoke" : null;
  const wantsDecal = i.hasGround && (special || killing || (beast && heavy));
  return {
    element: el, beast, special, power, palette, scale: s,
    dust: showy ? n((5 + 7 * power) * s, d, 3) : 0,
    embers: showy && hot ? n((4 + 6 * power) * (beast ? 1.6 : 1), d, 2) : 0,
    smoke: showy && (hot || beast) ? n((2 + 3 * power) * s, d, 1) : 0,
    debris: showy && (el === "stone" || beast) ? n((3 + 5 * power) * s, d, 2) : 0,
    halo: tier.halo && power >= 0.9 && !i.reducedMotion ? { size: (1.6 + 1.2 * power) * s } : null,
    shockRings: showy ? (beast ? 3 : 1) : 0,
    shockRadius: (2.2 + 1.2 * power) * s,
    cracks: beast && heavy ? { count: n(9, d, 4), length: (2.4 + 1.2 * power) } : null,
    scorch: wantsDecal ? { kind: beast && el !== "stone" ? "fracture" : layer.scorch, radius: (special ? layer.radius : 1.1 + 0.5 * power) * s, lifeSec: tier.decalLifeSec * (beast ? 1.6 : 1), hot: beast || layer.scorch === "scorch" } : null,
    linger: lingerKind && !i.reducedMotion ? { kind: lingerKind, count: Math.min(tier.lingerMax, n((5 + 4 * power) * (beast ? 1.4 : 1), d, 2)) } : null,
    rim: heavy ? { color: palette.accent, ms: Math.round(120 + 70 * power) } : null,
    pulse: strength > 0 ? { strength, ms: Math.round(150 + 90 * power), chroma: tier.chroma && heavy, color: palette.accent } : null,
    freezeFrames: (special || beast || killing) && !i.reducedMotion ? clamp(2 + Math.floor(power * 1.6), 2, 5) : 0,
    shake: { amplitude: Math.min(beast ? 0.95 : 0.7, sk.amplitude * (beast ? 1.4 : 1)), ms: Math.round(sk.ms * (beast ? 1.3 : 1)) },
    light: { intensity: 20 * power * layer.flash * s, life: 0.25 + 0.1 * power },
  };
}

// ---- action phases (charge-up, release) -----------------------------------------------------------------------------------

export interface ActionFxInput { action: string; moveId: string | undefined; beast: boolean; kitId?: string | undefined; tier: Tier; reducedMotion: boolean }
export interface ActionFxSpec {
  phase: "charge" | "release";
  element: Element;
  beast: boolean;
  palette: Theme;
  scale: number;
  /** Pool particles gathering (charge) or shed along the travel line (release). */
  motes: number;
  moteColor: number;
  linger: Linger;
  /** Travel trail glow multiplier (release). */
  trail: number;
  halo: { size: number } | null;
  /** Roar shock pulse (beast release): ground rings plus a screen pulse, and ground cracks ahead of the caster. */
  roar: { rings: number; radius: number; cracks: number } | null;
  /** Ground decal under or ahead of the caster on release (area specials). */
  scorch: { kind: ScorchKind; radius: number; lifeSec: number; hot: boolean } | null;
  shake: { amplitude: number; ms: number } | null;
}

/** Ground area abilities leave a mark at their release point; pure projectiles and beams do not. */
const GROUND_AREA = new Set(["sv.b1", "sv.b4", "sv.a1", "sv.a2", "sv.a4", "td.b3", "td.b4", "td.a1", "td.a2", "td.a3", "td.a4", "ea.b2", "ea.b4", "ea.a1", "ea.a3", "ea.a4"]);

export function selectActionFx(i: ActionFxInput): ActionFxSpec | null {
  const special = isSpecial(i.moveId);
  if (!special && !(i.beast && isBasic(i.moveId))) return null;
  if (i.action !== "Windup" && i.action !== "Active") return null;
  const charge = i.action === "Windup", el = special ? elementOfMove(i.moveId) : elementOf(i.kitId);
  const layer = layerOf(i.moveId, el), tier = FX_TIER[i.tier], d = DENSITY[i.tier];
  const s = i.beast ? BEAST_SCALE : 1, w = special ? 1 : 0.55;
  const palette = i.beast ? BEAST_THEME : THEME[el];
  const quiet = i.reducedMotion;
  const sh = i.beast ? shakeFor((special ? 1.3 : 0.9)) : null;
  return {
    phase: charge ? "charge" : "release", element: el, beast: i.beast, palette, scale: s,
    motes: quiet ? 0 : n((charge ? 10 : 8) * w * s, d, 2), moteColor: i.beast ? palette.spark : charge ? palette.core : palette.accent,
    linger: i.beast ? "embers" : layer.linger, trail: layer.trail * s,
    halo: tier.halo && !quiet && (special || i.beast) ? { size: (charge ? 0.9 : 1.3) * layer.flash * s } : null,
    roar: i.beast && !charge && !quiet ? { rings: special ? 3 : 1, radius: (special ? 5 : 3) * 1, cracks: special ? n(8, d, 4) : n(4, d, 2) } : null,
    scorch: !charge && special && GROUND_AREA.has(i.moveId!) ? { kind: i.beast && el !== "stone" ? "fracture" : layer.scorch, radius: layer.radius * s, lifeSec: tier.decalLifeSec * (i.beast ? 1.6 : 1), hot: i.beast || layer.scorch === "scorch" } : null,
    shake: sh && !charge && !quiet ? { amplitude: Math.min(0.95, sh.amplitude * 1.2), ms: sh.ms } : null,
  };
}

/** Beast aura: embers per second for the tier, none under reduced motion. */
export const auraRate = (tier: Tier, reducedMotion: boolean): number => (reducedMotion ? 0 : FX_TIER[tier].auraPerSec);
