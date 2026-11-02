import type { EffectsPool } from "../scene/EffectsPool.js";

/**
 * UX10 shared impact language. One set of procedural primitives (additive flash, spark burst, ground shockwave, oriented
 * blast disc, point light pulse) scaled by a single `power` number and tinted by an element theme. HitFx uses it for every
 * confirmed contact; per-ability signatures reuse the same primitives so the whole game reads as one visual family.
 * Presentation only: power comes from the server event (damage, hit class, KO), never from client input.
 */

export type Element = "stone" | "water" | "ember" | "neutral";
export interface Theme { core: number; accent: number; dark: number; spark: number }
/** Original element palettes: stone = ochre/amber/slate, water = aqua/deep blue/foam, ember = orange/gold/red. */
export const THEME: Readonly<Record<Element, Theme>> = {
  stone: { core: 0xfff1c9, accent: 0xffb347, dark: 0x6b5a45, spark: 0xe8d9b8 },
  water: { core: 0xe6fbff, accent: 0x37c8ff, dark: 0x1f6fff, spark: 0xd8f6ff },
  ember: { core: 0xfff1b0, accent: 0xff7a1a, dark: 0xff3d00, spark: 0xffc04d },
  neutral: { core: 0xfff4d8, accent: 0xff9a4a, dark: 0xff3b3b, spark: 0xffe0b0 },
};
export function elementOf(kitId: string | undefined): Element {
  return kitId === "sv" ? "stone" : kitId === "td" ? "water" : kitId === "ea" ? "ember" : "neutral";
}
/** Element of an ability id such as "td.b2"; neutral for universal moves. */
export function elementOfMove(moveId: string | undefined): Element {
  const k = moveId?.slice(0, 3);
  return k === "sv." ? "stone" : k === "td." ? "water" : k === "ea." ? "ember" : "neutral";
}

export interface Pt { x: number; y: number; z: number }
export interface ImpactInput {
  /** Contact point (chest height). */
  at: Pt;
  /** Ground height under the contact. */
  groundY: number;
  /** Unit direction from attacker to victim on the ground plane; undefined when the attacker is unknown. */
  dir?: { x: number; z: number } | undefined;
  theme: Theme;
  /** 0.35 (light poke) to about 1.4 (heavy), 2 for a KO. */
  power: number;
}

/** Damage and class to a single power number. Hundredths of HP in: 400 (4 HP) is a poke, 2000 a heavy ability, 3000+ a finisher. */
export function impactPower(damage100: number | undefined, heavy: boolean, finisher: boolean, ko: boolean): number {
  const d = Math.min(3000, Math.max(0, damage100 ?? 0));
  let p = 0.4 + (d / 3000) * 0.7; // 0.4 .. 1.1
  if (heavy) p *= 1.2;
  if (finisher) p *= 1.3;
  if (ko) p = Math.max(p * 1.5, 1.9);
  return Math.min(2.2, p);
}

/** Camera shake amplitude in metres (before the user's shake scale) and duration for a power level. */
export function shakeFor(power: number): { amplitude: number; ms: number } {
  return { amplitude: Math.min(0.7, 0.07 + 0.3 * power), ms: Math.round(80 + 110 * power) };
}

const TAU = Math.PI * 2;
const rnd = (a: number, b: number): number => a + Math.random() * (b - a);

/** Count scaled by the tier density, never below `min` so even Low shows the effect. */
export const scaled = (fx: EffectsPool, n: number, min = 1): number => Math.max(min, Math.round(n * fx.glow.density));

/** Radial spark burst of additive streaks plus short fat streaks that read as flying chunks (all pooled glow slots). */
export function sparkBurst(fx: EffectsPool, at: Pt, color: number, count: number, speed: number, life: number, opts: { up?: number; width?: number; length?: number; gravity?: number; dir?: { x: number; z: number }; spread?: number; chunks?: number } = {}): void {
  const n = scaled(fx, count, 3);
  for (let i = 0; i < n; i++) {
    const a = opts.dir ? Math.atan2(opts.dir.z, opts.dir.x) + rnd(-0.5, 0.5) * (opts.spread ?? 1) : rnd(0, TAU);
    const e = opts.dir ? rnd(-0.1, 0.9) : rnd(-0.25, 1), c = Math.sqrt(Math.max(0, 1 - e * e)), s = speed * rnd(0.55, 1);
    fx.glow.streak({ x: at.x, y: at.y, z: at.z, vx: Math.cos(a) * c * s, vy: e * s + (opts.up ?? 0), vz: Math.sin(a) * c * s, color, length: (opts.length ?? 0.6) * rnd(0.6, 1.2), width: opts.width ?? 0.05, life: life * rnd(0.7, 1.1), gravity: opts.gravity ?? 7 });
  }
  const chunks = opts.chunks === 0 ? 0 : scaled(fx, opts.chunks ?? Math.round(count * 0.4), 1);
  for (let i = 0; i < chunks; i++) {
    const a = rnd(0, TAU), s = speed * rnd(0.3, 0.8);
    // Fat short streaks read as chunks and cost no pool particles, so the shared pool's shed policy and counts are untouched.
    fx.glow.streak({ x: at.x, y: at.y, z: at.z, vx: Math.cos(a) * s, vy: rnd(0.5, 1) * s, vz: Math.sin(a) * s, color, length: rnd(0.14, 0.24), width: rnd(0.09, 0.16), life: life * 1.3, gravity: 9 });
  }
}

/** The standard hit: white-hot flash, tinted bloom, sparks, ground shockwave, blast disc facing the attacker, light pulse. */
export function playImpactBurst(fx: EffectsPool, i: ImpactInput): void {
  const p = i.power, g = fx.glow, { at, theme } = i;
  g.flash({ ...at, color: theme.core, size: 0.45 * p + 0.2, grow: 1.25, life: 0.08 + 0.025 * p });
  g.flash({ ...at, color: theme.accent, size: 0.75 * p + 0.25, grow: 1.4, life: 0.14 + 0.03 * p });
  sparkBurst(fx, at, theme.core, 5 + 7 * p, 5 + 5 * p, 0.28 + 0.1 * p, { width: 0.035, length: 0.55 + 0.3 * p, ...(i.dir ? { dir: i.dir } : {}), spread: 1.5, chunks: 0 });
  sparkBurst(fx, at, theme.accent, 4 + 4 * p, 3 + 4 * p, 0.35 + 0.1 * p, { width: 0.07, length: 0.4, chunks: 2 + 2 * p });
  g.ring({ x: at.x, y: i.groundY + 0.06, z: at.z, color: theme.accent, radius: 1.3 + 1.1 * p, life: 0.3 + 0.12 * p });
  const f = i.dir ?? { x: 0, z: 1 };
  g.ring({ ...at, color: theme.core, radius: 0.7 + 0.7 * p, life: 0.2 + 0.06 * p, normal: { x: f.x, y: 0, z: f.z } });
  g.light({ ...at, color: theme.accent, intensity: 26 * p, life: 0.2 + 0.1 * p });
}

/** Block: a cyan shield ripple (three staggered rings on the guard plane, a faint dome) and deflected sparks. No red, no ground shockwave. */
export const SHIELD = 0x5fd8ff, SHIELD_PALE = 0xdaf6ff;
export function playBlockRipple(fx: EffectsPool, at: Pt, towardAttacker: { x: number; z: number }, power: number): void {
  const g = fx.glow, f = towardAttacker;
  const c = { x: at.x + f.x * 0.75, y: at.y, z: at.z + f.z * 0.75 };
  for (let k = 0; k < 3; k++) g.ring({ ...c, color: k === 0 ? SHIELD_PALE : SHIELD, radius: 0.8 + 0.35 * k + 0.25 * power, from: 0.2, life: 0.3 + 0.06 * k, delay: 0.05 * k, normal: { x: f.x, y: 0, z: f.z } });
  g.flash({ ...c, color: SHIELD, size: 0.9 + 0.5 * power, grow: 1.3, life: 0.24 });
  sparkBurst(fx, c, SHIELD_PALE, 8 + 6 * power, 4 + 3 * power, 0.25, { width: 0.04, length: 0.5, dir: f, spread: 1.4, gravity: 3 });
  g.light({ ...c, color: SHIELD, intensity: 12 + 6 * power, life: 0.16 });
}

/** Finishing blow: oversized flash, three staggered shockwaves, a vertical beam and spark fountain. */
export function playKoBlast(fx: EffectsPool, i: ImpactInput): void {
  const g = fx.glow, { at, theme } = i;
  g.flash({ ...at, color: 0xffffff, size: 1.8, grow: 1.5, life: 0.28 });
  g.flash({ ...at, color: theme.accent, size: 2.8, grow: 1.4, life: 0.45 });
  for (let k = 0; k < 3; k++) g.ring({ x: at.x, y: i.groundY + 0.06, z: at.z, color: k === 1 ? theme.core : theme.accent, radius: 3.2 + 1.6 * k, life: 0.5 + 0.12 * k, delay: 0.08 * k });
  g.ring({ ...at, color: theme.core, radius: 2.2, life: 0.35, normal: { x: i.dir?.x ?? 0, y: 0, z: i.dir?.z ?? 1 } });
  const n = scaled(fx, 14, 4);
  for (let k = 0; k < n; k++) { // rising light pillar: tall thin streaks around the body
    const a = rnd(0, TAU), r = rnd(0, 0.5);
    g.streak({ x: at.x + Math.cos(a) * r, y: i.groundY, z: at.z + Math.sin(a) * r, vx: 0, vy: rnd(5, 9), vz: 0, color: k % 2 ? theme.core : theme.accent, length: rnd(1.2, 2.6), width: 0.09, life: rnd(0.45, 0.8) });
  }
  sparkBurst(fx, at, theme.core, 34, 9, 0.55, { width: 0.05, length: 0.8, up: 3, chunks: 16 });
  g.light({ ...at, color: theme.accent, intensity: 55, life: 0.5 });
}

/** Counter: golden flash with an inward-then-out ring pair. */
export function playCounterFlash(fx: EffectsPool, at: Pt, groundY: number): void {
  const g = fx.glow;
  g.flash({ ...at, color: 0xfff0a0, size: 1.5, grow: 1.6, life: 0.26 });
  g.ring({ ...at, color: 0xffcc33, radius: 2, from: 0.2, life: 0.32, normal: { x: 0, y: 1, z: 0 } });
  g.ring({ x: at.x, y: groundY + 0.06, z: at.z, color: 0xffcc33, radius: 2.2, life: 0.36 });
  sparkBurst(fx, at, 0xffe27a, 18, 7, 0.35, { width: 0.05, length: 0.7 });
  g.light({ ...at, color: 0xffcc33, intensity: 24, life: 0.25 });
}

/** Special contacts add a narrow directional fan; the shared impact owns the flash and shockwave. */
export function playSpecialImpact(fx: EffectsPool, i: ImpactInput): void {
  const { at, theme, dir } = i, p = Math.min(1.6, i.power), f = dir ?? { x: 0, z: 1 };
  // Narrow impact fan follows the force of the blow; no second screen-filling explosion.
  sparkBurst(fx, at, theme.accent, 12, 8 + 3 * p, 0.24, { dir: f, spread: 1.2, width: 0.045, length: 0.8, chunks: 0 });
  for (let k = -1; k <= 1; k += 2) fx.glow.streak({ ...at, vx: f.x * 7 - f.z * k * 3, vy: k * 2, vz: f.z * 7 + f.x * k * 3,
    color: theme.core, width: 0.065, length: 1.2 * p, life: 0.16 });
}
