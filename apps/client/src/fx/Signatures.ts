import { forwardOf } from "@eb/shared/math";
import { EA_DEFS, SV_DEFS, TD_DEFS } from "@eb/shared/config/kits/index";
import { fromYaw } from "@eb/shared/schema";
import type { CombatEvent } from "@eb/shared/protocol";
import type { EffectsPool } from "../scene/EffectsPool.js";
import { THEME, elementOf, elementOfMove, impactPower, scaled, sparkBurst, type Element, type Pt, type Theme } from "./Impact.js";

/**
 * UX10b per-ability signatures. Each shipped ability (slots 1-4 of the base and awakened kits) is a composition of a
 * windup style (charge gathering at the caster), an active style (thick trails, ribbons, element particles) and an impact
 * style (element burst), all built from the pooled GlowLayer primitives and tinted by the fighter's element theme. The
 * table is data: the same few primitives combine differently per ability so every move reads as its own.
 * Presentation only. Windup effects are tagged with the caster id so an interruption, death or room leave ends them.
 */

export type WindupStyle = "gather" | "vortex" | "pillar" | "coil" | "sigil";
export type ActiveShape = "slash" | "ribbon" | "column" | "wave" | "beam" | "orbit" | "spiral" | "nova";
export type ImpactShape = "shards" | "splash" | "embers" | "geyser" | "crack" | "flare";
export interface Signature { windup: WindupStyle; active: ActiveShape; impact: ImpactShape; /** Overall scale of the effect, 0.7 small to 1.8 awakened. */ size: number }

const s = (windup: WindupStyle, active: ActiveShape, impact: ImpactShape, size: number): Signature => ({ windup, active, impact, size });

/** One entry per base (b) and awakened (a) ability of all three fighters. Combinations are unique per element. */
export const SIGNATURES: Readonly<Record<string, Signature>> = {
  // Stone Vanguard: heavy angular chips, cracks and pillars.
  "sv.b1": s("sigil", "wave", "crack", 1.2), "sv.b2": s("gather", "ribbon", "shards", 0.8),
  "sv.b3": s("coil", "slash", "flare", 1), "sv.b4": s("pillar", "column", "shards", 1.2),
  "sv.a1": s("sigil", "nova", "flare", 1.5), "sv.a2": s("pillar", "wave", "crack", 1.8),
  "sv.a3": s("gather", "beam", "flare", 1.7), "sv.a4": s("vortex", "orbit", "shards", 1.5),
  // Tide Duelist: flowing ribbons, spirals and splashes.
  "td.b1": s("coil", "ribbon", "splash", 1), "td.b2": s("vortex", "spiral", "splash", 1.1),
  "td.b3": s("gather", "wave", "splash", 1), "td.b4": s("sigil", "nova", "flare", 1.2),
  "td.a1": s("pillar", "column", "geyser", 1.6), "td.a2": s("sigil", "column", "geyser", 1.8),
  "td.a3": s("coil", "wave", "splash", 1.6), "td.a4": s("vortex", "spiral", "geyser", 1.6),
  // Ember Artificer: gathering heat, thick ribbons, embers and furnace flares.
  "ea.b1": s("gather", "ribbon", "embers", 1), "ea.b2": s("coil", "nova", "embers", 1),
  "ea.b3": s("gather", "slash", "flare", 0.9), "ea.b4": s("pillar", "column", "embers", 1.3),
  "ea.a1": s("vortex", "spiral", "flare", 1.5), "ea.a2": s("gather", "beam", "embers", 1.5),
  "ea.a3": s("coil", "beam", "flare", 1.8), "ea.a4": s("sigil", "nova", "geyser", 1.9),
};

/** Fallback for kit moves without an entry (the x slots, awakening activations): a modest element-flavoured charge and impact. */
const FALLBACK: Readonly<Record<Element, Signature>> = {
  stone: s("gather", "nova", "shards", 0.8), water: s("gather", "ribbon", "splash", 0.8), ember: s("gather", "nova", "embers", 0.8), neutral: s("gather", "slash", "flare", 0.7),
};
export const signatureOf = (moveId: string | undefined): Signature | undefined => {
  if (!moveId || !/^(sv|td|ea)\./.test(moveId)) return undefined;
  return SIGNATURES[moveId] ?? FALLBACK[elementOfMove(moveId)];
};

const DEFS = [...SV_DEFS, ...TD_DEFS, ...EA_DEFS];
/** Seconds of windup from the ability definition (startup ticks at 60 Hz), clamped so a 0-tick or huge awakened wind-up still reads. Display only. */
export function windupSeconds(moveId: string): number {
  const d = DEFS.find((x) => x.id === moveId);
  return Math.min(1.4, Math.max(0.3, (d?.startup ?? 18) / 60));
}
const reachOf = (moveId: string): number => Math.min(8, Math.max(1.5, DEFS.find((x) => x.id === moveId)?.range ?? 3));

const TAU = Math.PI * 2;
const rnd = (a: number, b: number): number => a + Math.random() * (b - a);

interface Ctx { fx: EffectsPool; theme: Theme; at: Pt; yaw: number; groundY: number; owner?: string; size: number; reach: number; sec: number }
const fwd = (c: Ctx): { dx: number; dz: number; px: number; pz: number } => { const [dx, dz] = forwardOf(c.yaw); return { dx, dz, px: -dz, pz: dx }; };
const hand = (c: Ctx): Pt => { const f = fwd(c); return { x: c.at.x + f.dx * 0.55, y: c.at.y + 0.3, z: c.at.z + f.dz * 0.55 }; };

/** Charging glow and particles gathering at the caster; ends by itself at `sec` and ends early through clearOwner. */
export function playSignatureWindup(fx: EffectsPool, moveId: string, at: Pt, yaw: number, groundY: number, owner: string): void {
  if (!fx.glow) return; // stub pools in older tests have no glow layer; production pools always do
  const sig = signatureOf(moveId);
  if (!sig) return;
  const c: Ctx = { fx, theme: THEME[elementOfMove(moveId)], at, yaw, groundY, owner, size: sig.size, reach: reachOf(moveId), sec: windupSeconds(moveId) };
  WINDUPS[sig.windup](c);
}

const WINDUPS: Record<WindupStyle, (c: Ctx) => void> = {
  gather(c) {
    const g = c.fx.glow, h = hand(c), n = scaled(c.fx, 12, 4), R = 1.7 * c.size;
    g.flash({ ...h, color: c.theme.accent, size: 0.45 * c.size, grow: 3.2, life: c.sec, owner: c.owner! });
    g.flash({ ...h, color: c.theme.core, size: 0.25 * c.size, grow: 2.4, life: c.sec, owner: c.owner! });
    for (let i = 0; i < n; i++) {
      const a = rnd(0, TAU), e = rnd(-0.4, 0.9), cs = Math.sqrt(1 - e * e), life = c.sec * 0.55, d = rnd(0, c.sec * 0.45);
      const sx = h.x + Math.cos(a) * cs * R, sy = h.y + e * R, sz = h.z + Math.sin(a) * cs * R;
      g.streak({ x: sx, y: sy, z: sz, vx: (h.x - sx) / life, vy: (h.y - sy) / life, vz: (h.z - sz) / life, color: i % 2 ? c.theme.core : c.theme.accent, length: 0.55, width: 0.05, life, delay: d, owner: c.owner! });
    }
    g.ring({ x: c.at.x, y: c.groundY + 0.06, z: c.at.z, color: c.theme.accent, radius: 0.35, from: 1.8 * c.size, life: c.sec, owner: c.owner! });
  },
  vortex(c) {
    const g = c.fx.glow, n = scaled(c.fx, 14, 5);
    g.flash({ x: c.at.x, y: c.at.y + 0.3, z: c.at.z, color: c.theme.accent, size: 0.6 * c.size, grow: 2.6, life: c.sec, owner: c.owner! });
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU, r = 1.0 * c.size, life = c.sec * 0.8, d = (i / n) * c.sec * 0.2;
      g.streak({ x: c.at.x + Math.cos(a) * r, y: c.groundY + 0.15, z: c.at.z + Math.sin(a) * r, vx: -Math.sin(a) * 5.5, vy: 2.2, vz: Math.cos(a) * 5.5, color: i % 2 ? c.theme.core : c.theme.accent, length: 0.8, width: 0.07, life, delay: d, owner: c.owner! });
    }
    g.ring({ x: c.at.x, y: c.groundY + 0.06, z: c.at.z, color: c.theme.dark, radius: 1.5 * c.size, from: 0.3, life: c.sec, owner: c.owner! });
  },
  pillar(c) {
    const g = c.fx.glow, n = scaled(c.fx, 9, 4);
    g.ring({ x: c.at.x, y: c.groundY + 0.06, z: c.at.z, color: c.theme.accent, radius: 0.4, from: 1.7 * c.size, life: c.sec, owner: c.owner! });
    g.flash({ x: c.at.x, y: c.groundY + 0.3, z: c.at.z, color: c.theme.accent, size: 0.8 * c.size, grow: 2.4, life: c.sec, owner: c.owner! });
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      g.streak({ x: c.at.x + Math.cos(a) * 0.9 * c.size, y: c.groundY, z: c.at.z + Math.sin(a) * 0.9 * c.size, vx: 0, vy: 3.5, vz: 0, color: i % 2 ? c.theme.core : c.theme.accent, length: 1.4, width: 0.08, life: c.sec * 0.8, delay: rnd(0, c.sec * 0.2), owner: c.owner! });
    }
  },
  coil(c) {
    const g = c.fx.glow, h = hand(c), f = fwd(c), n = scaled(c.fx, 8, 3);
    for (let k = 0; k < 3; k++) g.ring({ ...h, color: k ? c.theme.accent : c.theme.core, radius: 0.15, from: 1.1 * c.size, life: c.sec * 0.6, delay: k * c.sec * 0.2, normal: { x: f.dx, y: 0, z: f.dz }, owner: c.owner! });
    g.flash({ ...h, color: c.theme.accent, size: 0.4 * c.size, grow: 3, life: c.sec, owner: c.owner! });
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU, r = 0.9 * c.size, life = c.sec * 0.5;
      g.streak({ x: h.x + f.dx * 0.3 + f.px * Math.cos(a) * r, y: h.y + Math.sin(a) * r, z: h.z + f.dz * 0.3 + f.pz * Math.cos(a) * r, vx: -f.px * Math.cos(a) * r / life, vy: -Math.sin(a) * r / life, vz: -f.pz * Math.cos(a) * r / life, color: c.theme.core, length: 0.4, width: 0.05, life, delay: i * c.sec * 0.04, owner: c.owner! });
    }
  },
  sigil(c) {
    const g = c.fx.glow, R = Math.min(3.2, 1.8 * c.size), n = scaled(c.fx, 6, 3);
    [1, 0.7, 0.42].forEach((k, i) => g.ring({ x: c.at.x, y: c.groundY + 0.05 + i * 0.01, z: c.at.z, color: i === 1 ? c.theme.core : c.theme.accent, radius: R * k, from: R * k * 1.5, life: c.sec, delay: i * c.sec * 0.1, owner: c.owner! }));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      g.streak({ x: c.at.x + Math.cos(a) * R, y: c.groundY, z: c.at.z + Math.sin(a) * R, vx: 0, vy: 2.6, vz: 0, color: c.theme.core, length: 1.1, width: 0.07, life: c.sec * 0.85, delay: i * c.sec * 0.05, owner: c.owner! });
    }
    g.flash({ x: c.at.x, y: c.groundY + 0.4, z: c.at.z, color: c.theme.accent, size: 0.7 * c.size, grow: 2.2, life: c.sec, owner: c.owner! });
  },
};

/** Active phase: thick trails, ribbons, element particles and an emissive pulse at the caster. Not owner tagged (the strike already happened). */
export function playSignatureActive(fx: EffectsPool, moveId: string, at: Pt, yaw: number, groundY: number): void {
  if (!fx.glow) return; // stub pools in older tests have no glow layer; production pools always do
  const sig = signatureOf(moveId);
  if (!sig) return;
  const c: Ctx = { fx, theme: THEME[elementOfMove(moveId)], at, yaw, groundY, size: sig.size, reach: reachOf(moveId), sec: 0.4 };
  ACTIVES[sig.active](c);
  const el = elementOfMove(moveId), g = fx.glow, f = fwd(c);
  if (el === "water") {
    // Continuous swept water ribbons, lifted off the floor so the victim stays legible.
    for (const side of [-1, 1]) g.arc({ centre: { x: at.x + f.dx, y: at.y + side * 0.22, z: at.z + f.dz }, radius: 1.15 * sig.size,
      start: yaw + side * 0.6, sweep: side * Math.PI * 1.35, color: side > 0 ? c.theme.accent : c.theme.dark,
      width: 0.14 * sig.size, rise: 0.6, life: 0.34 });
  } else if (el === "ember") {
    // Swept flame tongues with dark orange edges and narrow gold cores.
    g.arc({ centre: hand(c), radius: 0.85 * sig.size, start: yaw, sweep: Math.PI * 1.4, color: c.theme.dark,
      width: 0.22 * sig.size, rise: 0.9, life: 0.3 });
  }
  const h = hand(c);
  fx.glow.flash({ ...h, color: c.theme.core, size: 0.45 * c.size, grow: 1.3, life: 0.12 });
  fx.glow.light({ ...h, color: c.theme.accent, intensity: 18 * c.size, life: 0.25 });
}

const ACTIVES: Record<ActiveShape, (c: Ctx) => void> = {
  slash(c) {
    const g = c.fx.glow, f = fwd(c), n = scaled(c.fx, 9, 4), h = hand(c);
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1) - 0.5, a = c.yaw + k * 1.8, [dx, dz] = forwardOf(a), r = 0.7;
      g.streak({ x: c.at.x + dx * r, y: h.y - 0.05 + Math.cos(k * 3) * 0.2, z: c.at.z + dz * r, vx: dx * c.reach * 2.2, vy: 0, vz: dz * c.reach * 2.2, color: i % 2 ? c.theme.core : c.theme.accent, length: 1.3 * c.size, width: 0.13 * c.size, life: 0.26 });
    }
    g.ring({ x: h.x + f.dx * c.reach * 0.5, y: h.y, z: h.z + f.dz * c.reach * 0.5, color: c.theme.core, radius: 1.3 * c.size, life: 0.28, normal: { x: f.dx, y: 0, z: f.dz }, vx: f.dx * 4, vz: f.dz * 4 });
  },
  ribbon(c) {
    const g = c.fx.glow, f = fwd(c), n = scaled(c.fx, 16, 6), h = hand(c);
    for (const sgn of [1, -1]) for (let i = 0; i < n; i++) {
      const k = i / (n - 1), d = 0.6 + k * Math.min(c.reach + 1, 6), lat = Math.sin(k * Math.PI * 2.2 + (sgn > 0 ? 0 : Math.PI)) * 0.55 * c.size;
      g.streak({ x: h.x + f.dx * d + f.px * lat, y: h.y + Math.sin(k * 5) * 0.12, z: h.z + f.dz * d + f.pz * lat, vx: f.dx * 4, vy: 0, vz: f.dz * 4, color: sgn > 0 ? c.theme.accent : c.theme.core, length: 0.9, width: 0.1 * c.size, life: 0.34 + k * 0.1, delay: k * 0.12 });
    }
  },
  column(c) {
    const g = c.fx.glow, f = fwd(c), d = Math.min(c.reach, 3), x = c.at.x + f.dx * d, z = c.at.z + f.dz * d, n = scaled(c.fx, 10, 4);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU, r = rnd(0.1, 0.6) * c.size;
      g.streak({ x: x + Math.cos(a) * r, y: c.groundY, z: z + Math.sin(a) * r, vx: 0, vy: rnd(7, 11), vz: 0, color: i % 2 ? c.theme.core : c.theme.accent, length: rnd(1.6, 2.8), width: 0.14 * c.size, life: rnd(0.35, 0.55) });
    }
    g.flash({ x, y: c.groundY + 0.5, z, color: c.theme.accent, size: 1.4 * c.size, grow: 1.6, life: 0.3 });
    g.ring({ x, y: c.groundY + 0.06, z, color: c.theme.accent, radius: 2 * c.size, life: 0.4 });
    g.light({ x, y: c.groundY + 1, z, color: c.theme.accent, intensity: 26 * c.size, life: 0.3 });
  },
  wave(c) {
    const g = c.fx.glow, f = fwd(c), n = scaled(c.fx, 8, 3), sp = 9;
    for (let k = 0; k < 3; k++) g.ring({ x: c.at.x + f.dx * 0.6, y: c.groundY + 0.07, z: c.at.z + f.dz * 0.6, color: k === 1 ? c.theme.core : c.theme.accent, radius: (1.1 + 0.4 * k) * c.size, from: 0.5, life: 0.5, delay: k * 0.07, vx: f.dx * sp, vz: f.dz * sp });
    for (let i = 0; i < n; i++) {
      const lat = (i / (n - 1) - 0.5) * 2.4 * c.size;
      g.streak({ x: c.at.x + f.px * lat, y: c.groundY + 0.15, z: c.at.z + f.pz * lat, vx: f.dx * sp * 1.3, vy: 0, vz: f.dz * sp * 1.3, color: c.theme.core, length: 1.2, width: 0.09, life: 0.4, delay: Math.abs(lat) * 0.03 });
    }
  },
  beam(c) {
    const g = c.fx.glow, f = fwd(c), h = hand(c), len = Math.min(c.reach + 2, 6), n = scaled(c.fx, 6, 2);
    g.streak({ ...h, vx: f.dx * 0.5, vy: 0, vz: f.dz * 0.5, color: c.theme.dark, length: len, width: 0.36 * c.size, life: 0.3 });
    g.streak({ ...h, vx: f.dx * 0.5, vy: 0, vz: f.dz * 0.5, color: c.theme.accent, length: len, width: 0.12 * c.size, life: 0.3 });
    for (let i = 0; i < n; i++) {
      const lat = (i % 2 ? 1 : -1) * rnd(0.2, 0.7);
      g.streak({ x: h.x + f.px * lat, y: h.y + rnd(-0.2, 0.2), z: h.z + f.pz * lat, vx: f.dx * 14, vy: 0, vz: f.dz * 14, color: c.theme.core, length: 0.8, width: 0.06, life: 0.3, delay: i * 0.02 });
    }
    g.ring({ ...h, color: c.theme.accent, radius: 1.2 * c.size, life: 0.3, normal: { x: f.dx, y: 0, z: f.dz } });
  },
  orbit(c) {
    const g = c.fx.glow, f = fwd(c), d = Math.min(c.reach, 3), x = c.at.x + f.dx * d, z = c.at.z + f.dz * d, n = scaled(c.fx, 12, 5);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU, r = 1.4 * c.size;
      g.streak({ x: x + Math.cos(a) * r, y: c.groundY + 0.4 + (i % 4) * 0.35, z: z + Math.sin(a) * r, vx: -Math.sin(a) * 6, vy: 0, vz: Math.cos(a) * 6, color: i % 2 ? c.theme.core : c.theme.accent, length: 1, width: 0.1, life: 0.5 });
    }
    g.ring({ x, y: c.groundY + 0.06, z, color: c.theme.dark, radius: 1.6 * c.size, from: 2.4 * c.size, life: 0.45 });
  },
  spiral(c) {
    const g = c.fx.glow, f = fwd(c), h = hand(c), n = scaled(c.fx, 14, 5);
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1), a = k * TAU * 2, d = 0.4 + k * Math.min(c.reach + 1, 5), r = 0.55 * c.size;
      g.streak({ x: h.x + f.dx * d + f.px * Math.cos(a) * r, y: h.y + Math.sin(a) * r, z: h.z + f.dz * d + f.pz * Math.cos(a) * r, vx: f.dx * 5 - f.px * Math.sin(a) * 3, vy: Math.cos(a) * 3, vz: f.dz * 5 - f.pz * Math.sin(a) * 3, color: i % 2 ? c.theme.core : c.theme.accent, length: 0.8, width: 0.09 * c.size, life: 0.36, delay: k * 0.1 });
    }
    g.ring({ ...h, color: c.theme.core, radius: 1.3 * c.size, life: 0.3, normal: { x: f.dx, y: 0, z: f.dz }, vx: f.dx * 5, vz: f.dz * 5 });
  },
  nova(c) {
    const g = c.fx.glow, n = scaled(c.fx, 14, 6), R = Math.min(c.reach + 1, 5.5) * Math.min(c.size, 1.4);
    g.ring({ x: c.at.x, y: c.groundY + 0.07, z: c.at.z, color: c.theme.accent, radius: R, life: 0.45 });
    g.ring({ x: c.at.x, y: c.groundY + 0.08, z: c.at.z, color: c.theme.core, radius: R * 0.7, life: 0.35, delay: 0.05 });
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      g.streak({ x: c.at.x, y: c.groundY + 0.3, z: c.at.z, vx: Math.cos(a) * R * 2.4, vy: 0.3, vz: Math.sin(a) * R * 2.4, color: i % 2 ? c.theme.core : c.theme.accent, length: 0.9, width: 0.1, life: 0.38 });
    }
  },
};

/** Ability-specific burst on a confirmed hit, on top of the shared UX10a impact language. `power` comes from the server event. */
export function playSignatureImpact(fx: EffectsPool, moveId: string | undefined, at: Pt, groundY: number, power: number, kitId?: string): void {
  if (!fx.glow) return; // stub pools in older tests have no glow layer; production pools always do
  const sig = signatureOf(moveId);
  const el = sig ? elementOfMove(moveId) : elementOf(kitId);
  if (!sig && el === "neutral") return;
  const shape = sig?.impact ?? FALLBACK[el].impact, theme = THEME[el], p = Math.max(0.5, power) * (sig ? Math.min(1.3, 0.8 + 0.25 * sig.size) : 1);
  IMPACTS[shape](fx, theme, at, groundY, p);
}

const IMPACTS: Record<ImpactShape, (fx: EffectsPool, t: Theme, at: Pt, groundY: number, p: number) => void> = {
  shards(fx, t, at, gy, p) {
    const g = fx.glow, n = scaled(fx, 8 + 6 * p, 4);
    for (let i = 0; i < n; i++) { const a = rnd(0, TAU), sp = rnd(3, 7) * (0.7 + 0.4 * p); g.streak({ x: at.x, y: at.y, z: at.z, vx: Math.cos(a) * sp, vy: rnd(3, 7), vz: Math.sin(a) * sp, color: i % 3 ? t.spark : t.dark, length: rnd(0.25, 0.5), width: rnd(0.12, 0.2), life: rnd(0.45, 0.75), gravity: 16 }); }
    IMPACTS.crack(fx, t, at, gy, p * 0.7);
  },
  splash(fx, t, at, gy, p) {
    const g = fx.glow, n = scaled(fx, 10 + 6 * p, 5);
    for (let i = 0; i < n; i++) { const a = rnd(0, TAU), sp = rnd(1.5, 4.5); g.streak({ x: at.x, y: gy + 0.2, z: at.z, vx: Math.cos(a) * sp, vy: rnd(5, 9) * (0.8 + 0.3 * p), vz: Math.sin(a) * sp, color: i % 2 ? t.core : t.accent, length: rnd(0.4, 0.8), width: 0.07, life: rnd(0.5, 0.8), gravity: 15 }); }
    g.ring({ x: at.x, y: gy + 0.08, z: at.z, color: t.core, radius: 1.8 + p, life: 0.45, delay: 0.05 });
  },
  embers(fx, t, at, gy, p) {
    const g = fx.glow, n = scaled(fx, 12 + 6 * p, 5);
    for (let i = 0; i < n; i++) { const a = rnd(0, TAU), sp = rnd(0.6, 2.6); g.streak({ x: at.x, y: at.y - 0.3, z: at.z, vx: Math.cos(a) * sp, vy: rnd(1.5, 4), vz: Math.sin(a) * sp, color: i % 3 === 0 ? t.core : i % 3 === 1 ? t.spark : t.accent, length: rnd(0.18, 0.35), width: rnd(0.08, 0.14), life: rnd(0.7, 1.2), gravity: -1.5 }); }
    g.flash({ x: at.x, y: at.y, z: at.z, color: t.dark, size: 1.8 + p, grow: 1.5, life: 0.4 });
    g.ring({ x: at.x, y: gy + 0.08, z: at.z, color: t.dark, radius: 2 + p, life: 0.45 });
  },
  geyser(fx, t, at, gy, p) {
    const g = fx.glow, n = scaled(fx, 8, 4);
    for (let i = 0; i < n; i++) { const a = (i / n) * TAU, r = rnd(0.1, 0.5); g.streak({ x: at.x + Math.cos(a) * r, y: gy, z: at.z + Math.sin(a) * r, vx: 0, vy: rnd(8, 12) * (0.8 + 0.3 * p), vz: 0, color: i % 2 ? t.core : t.accent, length: rnd(1.8, 3), width: 0.16, life: rnd(0.4, 0.65) }); }
    g.ring({ x: at.x, y: gy + 0.08, z: at.z, color: t.accent, radius: 2.2 + p, life: 0.5 });
    g.light({ x: at.x, y: gy + 1, z: at.z, color: t.accent, intensity: 24 * p, life: 0.35 });
  },
  crack(fx, t, at, gy, p) {
    const g = fx.glow, n = scaled(fx, 8, 4);
    for (let i = 0; i < n; i++) { const a = (i / n) * TAU + rnd(-0.2, 0.2); g.streak({ x: at.x, y: gy + 0.05, z: at.z, vx: 0, vy: 0, vz: 0, dir: { x: Math.cos(a), y: 0, z: Math.sin(a) }, color: t.dark, length: rnd(1.2, 2.2) * (0.8 + 0.4 * p), width: 0.07, life: 0.7 }); }
  },
  flare(fx, t, at, _gy, p) {
    const g = fx.glow, n = 8;
    for (let i = 0; i < n; i++) { const a = (i / n) * TAU; g.streak({ x: at.x, y: at.y, z: at.z, vx: Math.cos(a) * 9, vy: Math.sin(a * 2) * 3, vz: Math.sin(a) * 9, color: i % 2 ? t.core : t.accent, length: 1.6 * (0.8 + 0.3 * p), width: 0.08, life: 0.22 }); }
    g.flash({ ...at, color: t.core, size: 1.8 + p, grow: 1.7, life: 0.2 });
  },
};

/** The universal M1 finisher (move m1.4), tinted by the attacker's element: a wide crossing slash and a themed burst. */
export function playFinisherImpact(fx: EffectsPool, kitId: string | undefined, at: Pt, groundY: number, dir: { x: number; z: number } | undefined, power: number): void {
  const el = elementOf(kitId), t = THEME[el], g = fx.glow, f = dir ?? { x: 0, z: 1 };
  for (const [sgn, tilt] of [[1, 0.6], [-1, -0.6]] as const) {
    g.streak({ x: at.x - f.z * sgn * 1.0 - f.x * 0.8, y: at.y + tilt * 0.9, z: at.z + f.x * sgn * 1.0 - f.z * 0.8, vx: f.z * -sgn * 14 + f.x * 3, vy: -tilt * 8, vz: f.x * sgn * 14 + f.z * 3, color: t.core, length: 2.2, width: 0.16, life: 0.2 });
    g.streak({ x: at.x - f.z * sgn * 1.0 - f.x * 0.8, y: at.y + tilt * 0.9, z: at.z + f.x * sgn * 1.0 - f.z * 0.8, vx: f.z * -sgn * 14 + f.x * 3, vy: -tilt * 8, vz: f.x * sgn * 14 + f.z * 3, color: t.accent, length: 2.6, width: 0.34, life: 0.24 });
  }
  const shape: ImpactShape = el === "stone" ? "shards" : el === "water" ? "splash" : el === "ember" ? "embers" : "flare";
  IMPACTS[shape](fx, t, at, groundY, Math.max(0.8, power));
}

/** Finisher swing trail on the replicated Active phase of m1.4 (so the blow is readable even on a miss). */
export function playFinisherSwing(fx: EffectsPool, kitId: string | undefined, at: Pt, yaw: number, groundY: number): void {
  const t = THEME[elementOf(kitId)], g = fx.glow, n = scaled(fx, 10, 5), h = at.y + 0.3;
  for (let i = 0; i < n; i++) {
    const k = i / (n - 1) - 0.5, a = yaw + k * 2.2, [dx, dz] = forwardOf(a);
    g.streak({ x: at.x + dx * 0.6, y: h + Math.cos(k * 3) * 0.25, z: at.z + dz * 0.6, vx: dx * 7, vy: 0, vz: dz * 7, color: i % 2 ? t.core : t.accent, length: 1.4, width: 0.16, life: 0.26 });
  }
  g.ring({ x: at.x, y: groundY + 0.07, z: at.z, color: t.accent, radius: 2, life: 0.3 });
}

export interface SigPlayer { x: number; y: number; z: number; facingYaw?: number; action?: string; moveId?: string; actionStartTick?: number; kitId?: string }

/** Fires the M1 finisher windup glow and swing exactly once per replicated action start; `seen` maps entity id to the last key. */
export function scanFinisher(fx: EffectsPool, players: Map<string, unknown>, seen: Map<string, string>, groundOf?: (x: number, z: number, y: number) => number | null): void {
  const live = new Set<string>();
  for (const [id, v] of players) {
    live.add(id);
    const p = v as SigPlayer;
    if ((p.action !== "Windup" && p.action !== "Active") || !/^m1\.4(\.|$)/.test(p.moveId ?? "")) { if (seen.get(id)?.startsWith("Windup")) fx.glow?.clearOwner(id); seen.delete(id); continue; }
    const key = `${p.action}:${p.actionStartTick ?? 0}`;
    if (seen.get(id) === key) continue;
    if (seen.get(id)?.startsWith("Windup")) fx.glow?.clearOwner(id);
    seen.set(id, key);
    const at = { x: p.x / 100, y: p.y / 100, z: p.z / 100 }, yaw = fromYaw(p.facingYaw ?? 0), gy = groundOf?.(at.x, at.z, at.y) ?? at.y - 0.9;
    if (p.action === "Windup") {
      const t = THEME[elementOf(p.kitId)], f = forwardOf(yaw);
      fx.glow.flash({ x: at.x + f[0] * 0.55, y: at.y + 0.3, z: at.z + f[1] * 0.55, color: t.accent, size: 0.35, grow: 3, life: 0.14, owner: id });
    } else playFinisherSwing(fx, p.kitId, at, yaw, gy);
  }
  for (const id of [...seen.keys()]) if (!live.has(id)) { if (seen.get(id)?.startsWith("Windup")) fx.glow?.clearOwner(id); seen.delete(id); }
}

/** Power for a kit hit event, matching HitFx. */
export const eventPower = (e: Pick<CombatEvent, "damage100" | "hitClass" | "targetHp100">): number => impactPower(e.damage100, e.hitClass === "heavy", false, e.targetHp100 === 0);
