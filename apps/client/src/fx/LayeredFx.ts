import { AdditiveBlending, DataTexture, LinearFilter, Mesh, MeshBasicMaterial, PlaneGeometry, RGBAFormat, type Scene } from "three";
import { ARENA } from "@eb/shared/config/arena";
import { HIT_STUN } from "@eb/shared/config/combat";
import { forwardOf } from "@eb/shared/math";
import { fromYaw } from "@eb/shared/schema";
import type { CombatEvent } from "@eb/shared/protocol";
import type { CombatBus } from "../app/CombatBus.js";
import type { EffectsPool } from "../scene/EffectsPool.js";
import { LAYER } from "../ui/Layers.js";
import type { PresentationDeps } from "./index.js";
import type { Pt } from "./Impact.js";
import { reachOf, windupSeconds } from "./Signatures.js";
import { BEAST_THEME, FX_TIER, SMOKE_COLOR, auraRate, dustColorOf, selectActionFx, selectHitFx, type ActionFxSpec, type HitLayerSpec, type Linger, type ScorchKind, type Tier } from "./Fx01.js";

/**
 * FX01 player: turns the specs chosen in Fx01.ts into pooled particles (EffectsPool), glow slots (GlowLayer), pooled ground
 * decals and a DOM screen pulse. Presentation only: it reads confirmed bus events and replicated state, owns no timers (every
 * effect ages in render time) and has a disposer for everything it created.
 */

const TAU = Math.PI * 2;
const rnd = (a: number, b: number): number => a + Math.random() * (b - a);

// ---- ground decals ------------------------------------------------------------------------------------------------------

const TEX = 64;
const hash = (a: number, b: number): number => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
const smooth = (e0: number, e1: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

/** White-on-alpha procedural masks; the material colour tints them. No image assets. */
function maskTexture(kind: "disc" | "heat" | "cracks"): DataTexture {
  const px = new Uint8Array(TEX * TEX * 4);
  for (let y = 0; y < TEX; y++) for (let x = 0; x < TEX; x++) {
    const dx = (x + 0.5) / TEX * 2 - 1, dy = (y + 0.5) / TEX * 2 - 1, r = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
    const edge = 0.78 + 0.16 * Math.sin(a * 7 + Math.sin(a * 3) * 2) + 0.05 * hash(Math.floor(a * 6), 1);
    let alpha = 0;
    if (kind === "disc") alpha = smooth(edge, edge - 0.3, r) * (0.55 + 0.45 * (1 - r));
    else if (kind === "heat") alpha = Math.exp(-(((r - (edge - 0.1)) / 0.08) ** 2)) * (0.6 + 0.4 * hash(x, y)) + smooth(0.55, 0, r) * 0.35 * hash(x >> 2, y >> 2);
    else { // cracks: nine jagged spokes
      let best = 0;
      for (let k = 0; k < 9; k++) {
        const sa = (k / 9) * TAU + (hash(k, 7) - 0.5) * 0.5 + Math.sin(r * 9 + k) * 0.08;
        let da = Math.abs(((a - sa + Math.PI * 3) % TAU) - Math.PI); da = Math.PI - da;
        best = Math.max(best, Math.exp(-((da * r / 0.03) ** 2)) * smooth(1, 0.15, r));
      }
      alpha = Math.max(best, smooth(0.28, 0.05, r) * 0.8);
    }
    const i = (y * TEX + x) * 4;
    px[i] = 255; px[i + 1] = 255; px[i + 2] = 255; px[i + 3] = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
  }
  const t = new DataTexture(px, TEX, TEX, RGBAFormat);
  t.magFilter = LinearFilter; t.minFilter = LinearFilter; t.needsUpdate = true;
  return t;
}

const DISC_COLOR: Readonly<Record<ScorchKind, number>> = { scorch: 0x0d0a08, puddle: 0x0e2f4a, fracture: 0x1a1410 };
const DISC_PEAK: Readonly<Record<ScorchKind, number>> = { scorch: 0.8, puddle: 0.55, fracture: 0.85 };

interface DecalSlot { disc: Mesh<PlaneGeometry, MeshBasicMaterial>; heat: Mesh<PlaneGeometry, MeshBasicMaterial>; age: number; life: number; peak: number; heatPeak: number }

/**
 * Fixed pool of lingering ground marks (scorch, wet puddle, fracture). Capacity comes from the tier; a full pool recycles the
 * decal closest to expiry. Each slot is a dark mask plus an additive heat rim that cools faster than the mark fades.
 */
export class ScorchDecals {
  private readonly geo = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  private readonly tex = { disc: maskTexture("disc"), heat: maskTexture("heat"), cracks: maskTexture("cracks") };
  private readonly slots: DecalSlot[] = [];
  private disposed = false;

  constructor(private readonly scene: Scene, readonly capacity: number) {
    for (let i = 0; i < capacity; i++) {
      const disc = new Mesh(this.geo, new MeshBasicMaterial({ map: this.tex.disc, transparent: true, depthWrite: false, opacity: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
      const heat = new Mesh(this.geo, new MeshBasicMaterial({ map: this.tex.heat, transparent: true, depthWrite: false, opacity: 0, blending: AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
      for (const m of [disc, heat]) { m.visible = false; m.renderOrder = 3; m.name = "fx.decal"; m.frustumCulled = false; scene.add(m); }
      this.slots.push({ disc, heat, age: 1, life: 1, peak: 0, heatPeak: 0 });
    }
  }

  get activeCount(): number { let n = 0; for (const s of this.slots) if (s.age < s.life) n++; return n; }

  add(kind: ScorchKind, x: number, groundY: number, z: number, radius: number, lifeSec: number, hot: boolean): boolean {
    if (this.disposed || this.slots.length === 0 || lifeSec <= 0 || radius <= 0) return false;
    let pick = 0, best = Infinity;
    for (let i = 0; i < this.slots.length; i++) { const s = this.slots[i]!, left = s.age < s.life ? s.life - s.age : -1; if (left < best) { best = left; pick = i; } }
    const s = this.slots[pick]!;
    s.age = 0; s.life = lifeSec; s.peak = DISC_PEAK[kind]; s.heatPeak = kind === "puddle" ? 0.28 : hot ? 1 : 0;
    s.disc.material.map = kind === "fracture" ? this.tex.cracks : this.tex.disc;
    s.disc.material.color.setHex(DISC_COLOR[kind]);
    s.heat.material.color.setHex(kind === "puddle" ? 0x5fd8ff : 0xff5a10);
    const yaw = Math.random() * TAU;
    for (const m of [s.disc, s.heat]) { m.position.set(x, groundY + 0.03 + pick * 0.002, z); m.scale.setScalar(radius * 2); m.rotation.y = yaw; m.visible = true; }
    return true;
  }

  update(dtSec: number): void {
    if (this.disposed || !(dtSec > 0)) return;
    for (const s of this.slots) {
      if (!(s.age < s.life)) continue;
      s.age += dtSec;
      if (s.age >= s.life) { s.disc.visible = false; s.heat.visible = false; s.disc.material.opacity = 0; s.heat.material.opacity = 0; continue; }
      const k = s.age / s.life;
      s.disc.material.opacity = s.peak * Math.min(1, s.age / 0.08) * (k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4);
      s.heat.material.opacity = s.heatPeak * Math.min(1, s.age / 0.05) * Math.max(0, 1 - k / 0.45);
      s.heat.visible = s.heat.material.opacity > 0.01;
    }
  }

  clear(): void { for (const s of this.slots) { s.age = s.life; s.disc.visible = false; s.heat.visible = false; } }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const s of this.slots) {
      s.disc.removeFromParent(); s.heat.removeFromParent();
      s.disc.material.dispose(); s.heat.material.dispose();
    }
    this.slots.length = 0;
    this.geo.dispose();
    for (const t of Object.values(this.tex)) t.dispose();
  }
}

// ---- screen pulse -------------------------------------------------------------------------------------------------------

/** One full-screen overlay reused for every pulse: a coloured edge flash with an optional red/cyan fringe (cheap chromatic split). */
export class ScreenPulse {
  private el: HTMLElement | null = null;
  private anim: Animation | null = null;
  /** Pulses fired so far (test and debug). */
  fired = 0;

  constructor(doc?: Document) {
    if (!doc?.body || typeof doc.createElement !== "function") return;
    const el = doc.createElement("div");
    el.setAttribute("data-fx", "screen-pulse"); el.setAttribute("aria-hidden", "true");
    el.style.cssText = `position:fixed;inset:0;pointer-events:none;opacity:0;z-index:${LAYER.damageCues - 1};mix-blend-mode:screen`;
    doc.body.append(el);
    this.el = el;
  }

  fire(p: { strength: number; ms: number; chroma: boolean; color: number }): void {
    const el = this.el;
    if (!el || !(p.strength > 0)) return;
    const c = `${(p.color >> 16) & 255},${(p.color >> 8) & 255},${p.color & 255}`;
    el.style.background = `radial-gradient(ellipse at 50% 50%, rgba(${c},0) 38%, rgba(${c},0.9) 135%)`;
    el.style.boxShadow = p.chroma ? "inset 18px 0 30px -12px rgba(255,40,70,0.7), inset -18px 0 30px -12px rgba(40,210,255,0.7)" : "none";
    this.fired += 1;
    el.setAttribute("data-pulses", String(this.fired));
    this.anim?.cancel();
    this.anim = typeof el.animate === "function" ? el.animate([{ opacity: p.strength }, { opacity: 0 }], { duration: p.ms, easing: "ease-out", fill: "forwards" }) : null;
    if (!this.anim) el.style.opacity = "0";
  }

  dispose(): void {
    this.anim?.cancel(); this.anim = null;
    this.el?.remove(); this.el = null;
  }
}

// ---- emitters -----------------------------------------------------------------------------------------------------------

/** Lingering particles after an impact: rising embers, drifting smoke, floating mist or settling dust (pool particles, long life). */
export function emitLinger(fx: EffectsPool, kind: Linger, count: number, at: Pt, groundY: number, spread: number, beast: boolean): void {
  const pal = BEAST_THEME;
  for (let i = 0; i < count; i++) {
    const a = rnd(0, TAU), r = rnd(0, spread), x = at.x + Math.cos(a) * r, z = at.z + Math.sin(a) * r, y = groundY + rnd(0.1, 0.5);
    if (kind === "embers") fx.spawn({ x, y, z, vx: rnd(-0.3, 0.3), vy: rnd(0.9, 2.2), vz: rnd(-0.3, 0.3), life: rnd(1.2, 2), size: rnd(0.07, 0.13), color: i % 3 === 0 ? 0xfff1b0 : beast ? pal.spark : 0xff9a2a, gravity: -0.4 });
    else if (kind === "smoke") fx.spawn({ x, y, z, vx: rnd(-0.2, 0.2), vy: rnd(0.6, 1.3), vz: rnd(-0.2, 0.2), life: rnd(1.2, 1.8), size: rnd(0.5, 0.85), color: SMOKE_COLOR, gravity: -0.2 });
    else if (kind === "mist") fx.spawn({ x, y, z, vx: rnd(-0.3, 0.3), vy: rnd(0.4, 0.9), vz: rnd(-0.3, 0.3), life: rnd(1.2, 1.9), size: rnd(0.45, 0.8), color: 0xcfeaff, gravity: -0.1 });
    else fx.spawn({ x, y, z, vx: rnd(-0.4, 0.4), vy: rnd(0.2, 0.6), vz: rnd(-0.4, 0.4), life: rnd(1, 1.6), size: rnd(0.3, 0.55), color: dustColorOf("stone", beast), gravity: 0 });
  }
}

export interface LayerCtx {
  fx: EffectsPool;
  decals: ScorchDecals | null;
  pulse: ScreenPulse | null;
  at: Pt;
  groundY: number;
  /** Ground height known (false: no decals and no ground rings). */
  hasGround: boolean;
}

/** Plays the FX01 layers of one confirmed hit on top of the shared impact: halo, shock rings, dust, embers, smoke, debris, cracks, decal, linger. */
export function playHitLayers(spec: HitLayerSpec, c: LayerCtx): void {
  const { fx, at, groundY: gy } = c, g = fx.glow, p = spec.palette, s = spec.scale;
  if (spec.halo) g.flash({ ...at, color: p.accent, size: spec.halo.size, grow: 1.7, life: 0.32 });
  if (spec.special || spec.beast) g.light({ ...at, color: p.accent, intensity: spec.light.intensity, life: spec.light.life });
  for (let k = 0; k < spec.shockRings; k++) g.ring({ x: at.x, y: gy + 0.07, z: at.z, color: k === 1 ? p.core : p.accent, radius: spec.shockRadius * (1 + 0.35 * k), life: 0.4 + 0.1 * k, delay: 0.05 * k });
  for (let i = 0; i < spec.dust; i++) {
    const a = rnd(0, TAU), sp = rnd(1.2, 3.2) * Math.sqrt(s);
    fx.spawn({ x: at.x + Math.cos(a) * 0.3, y: gy + 0.15, z: at.z + Math.sin(a) * 0.3, vx: Math.cos(a) * sp, vy: rnd(0.3, 1.1), vz: Math.sin(a) * sp, life: rnd(0.5, 0.9), size: rnd(0.4, 0.75) * Math.pow(s, 0.7), color: dustColorOf(spec.element, spec.beast), gravity: -0.3 });
  }
  for (let i = 0; i < spec.embers; i++) {
    const a = rnd(0, TAU), sp = rnd(0.6, 2.6);
    fx.spawn({ x: at.x, y: at.y - 0.2, z: at.z, vx: Math.cos(a) * sp, vy: rnd(2, 5), vz: Math.sin(a) * sp, life: rnd(0.8, 1.4), size: rnd(0.08, 0.16), color: i % 2 ? p.spark : p.accent, gravity: 1.5 });
  }
  for (let i = 0; i < spec.smoke; i++) {
    const a = rnd(0, TAU), sp = rnd(0.2, 0.8);
    fx.spawn({ x: at.x, y: gy + 0.4, z: at.z, vx: Math.cos(a) * sp, vy: rnd(0.8, 1.6), vz: Math.sin(a) * sp, life: rnd(1.1, 1.7), size: rnd(0.5, 0.9) * s, color: SMOKE_COLOR, gravity: -0.2 });
  }
  for (let i = 0; i < spec.debris; i++) {
    const a = rnd(0, TAU), sp = rnd(2, 5) * Math.sqrt(s);
    g.streak({ x: at.x, y: at.y, z: at.z, vx: Math.cos(a) * sp, vy: rnd(2.5, 6), vz: Math.sin(a) * sp, color: i % 3 ? p.spark : p.dark, length: rnd(0.14, 0.26) * s, width: rnd(0.09, 0.16) * s, life: rnd(0.5, 0.8), gravity: 16 });
  }
  if (spec.cracks && c.hasGround) {
    for (let i = 0; i < spec.cracks.count; i++) {
      const a = (i / spec.cracks.count) * TAU + rnd(-0.2, 0.2), len = spec.cracks.length * rnd(0.7, 1.2), dir = { x: Math.cos(a), y: 0, z: Math.sin(a) };
      g.streak({ x: at.x, y: gy + 0.05, z: at.z, vx: 0, vy: 0, vz: 0, dir, color: p.dark, length: len, width: 0.16, life: 1.4 });
      g.streak({ x: at.x, y: gy + 0.06, z: at.z, vx: 0, vy: 0, vz: 0, dir, color: p.core, length: len * 0.55, width: 0.05, life: 0.7 });
    }
  }
  if (spec.scorch && c.hasGround) c.decals?.add(spec.scorch.kind, at.x, gy, at.z, spec.scorch.radius, spec.scorch.lifeSec, spec.scorch.hot);
  if (spec.linger) emitLinger(fx, spec.linger.kind, spec.linger.count, at, gy, spec.scorch ? spec.scorch.radius * 0.5 : 0.8, spec.beast);
  if (spec.pulse) c.pulse?.fire(spec.pulse);
}

export interface ActionCtx extends LayerCtx { yaw: number; moveId: string; owner: string; localInvolved: boolean; shake?: ((amplitude: number, ms: number) => void) | undefined }

/** Charge-up (Windup) gathering motes plus a growing halo, or release (Active) trail, shed particles, roar pulse, cracks and decal. */
export function playActionLayers(spec: ActionFxSpec, c: ActionCtx): void {
  const { fx, at, groundY: gy } = c, g = fx.glow, p = spec.palette, s = spec.scale, [dx, dz] = forwardOf(c.yaw), px = -dz, pz = dx;
  const hand = { x: at.x + dx * 0.55, y: at.y + 0.3, z: at.z + dz * 0.55 };
  if (spec.phase === "charge") {
    const sec = windupSeconds(c.moveId), R = 1.5 * s;
    for (let i = 0; i < spec.motes; i++) {
      const a = rnd(0, TAU), e = rnd(-0.3, 0.9), cs = Math.sqrt(1 - e * e), life = Math.max(0.3, sec * 0.7);
      fx.spawn({ x: hand.x + Math.cos(a) * cs * R, y: hand.y + e * R, z: hand.z + Math.sin(a) * cs * R, vx: -Math.cos(a) * cs * R / life, vy: -e * R / life, vz: -Math.sin(a) * cs * R / life, life, size: rnd(0.08, 0.14) * Math.sqrt(s), color: spec.moteColor });
    }
    if (spec.halo) g.flash({ ...hand, color: p.accent, size: spec.halo.size, grow: 2.6, life: sec, owner: c.owner });
    if (spec.beast) { // lava ring closing on the caster, ground vents breathing embers
      g.ring({ x: at.x, y: gy + 0.06, z: at.z, color: p.dark, radius: 1.2 * s, from: 4 * s, life: sec, owner: c.owner });
      emitLinger(fx, "embers", Math.max(2, Math.round(spec.motes * 0.5)), at, gy, 2.4, true);
    }
    return;
  }
  // release
  const reach = Math.min(8, reachOf(c.moveId)), line = Math.max(2, reach);
  const n = Math.max(3, Math.round(spec.motes));
  for (let i = 0; i < n; i++) {
    const d = (i + rnd(0, 1)) / n * line, lat = rnd(-0.5, 0.5) * s;
    emitLinger(fx, spec.linger, 1, { x: at.x + dx * d + px * lat, y: at.y, z: at.z + dz * d + pz * lat }, gy + (at.y - gy) * 0.45, 0.15, spec.beast);
  }
  if (spec.trail > 0) {
    g.streak({ ...hand, vx: dx * 0.4, vy: 0, vz: dz * 0.4, color: p.dark, length: line * 0.8, width: 0.3 * spec.trail, life: 0.28 });
    g.streak({ ...hand, vx: dx * 0.4, vy: 0, vz: dz * 0.4, color: p.core, length: line * 0.6, width: 0.1 * spec.trail, life: 0.2 });
  }
  if (spec.halo) g.flash({ ...hand, color: p.accent, size: spec.halo.size, grow: 1.6, life: 0.26 });
  if (spec.roar) {
    for (let k = 0; k < spec.roar.rings; k++) g.ring({ x: at.x, y: gy + 0.07, z: at.z, color: k === 1 ? p.core : p.accent, radius: spec.roar.radius * (1 + 0.3 * k), life: 0.45 + 0.1 * k, delay: 0.06 * k });
    if (c.hasGround) for (let i = 0; i < spec.roar.cracks; i++) {
      const a = c.yaw + (i / Math.max(1, spec.roar.cracks - 1) - 0.5) * 1.6 + rnd(-0.1, 0.1), [cx, cz] = forwardOf(a), len = rnd(2.5, 5) * Math.sqrt(s);
      g.streak({ x: at.x + cx * 0.8, y: gy + 0.05, z: at.z + cz * 0.8, vx: 0, vy: 0, vz: 0, dir: { x: cx, y: 0, z: cz }, color: p.dark, length: len, width: 0.15, life: 1.3 });
      g.streak({ x: at.x + cx * 0.8, y: gy + 0.06, z: at.z + cz * 0.8, vx: 0, vy: 0, vz: 0, dir: { x: cx, y: 0, z: cz }, color: p.core, length: len * 0.5, width: 0.05, life: 0.6 });
    }
    if (c.localInvolved) c.pulse?.fire({ strength: 0.3, ms: 220, chroma: false, color: p.accent });
  }
  if (spec.scorch && c.hasGround) {
    const d = Math.min(reach, 3);
    c.decals?.add(spec.scorch.kind, at.x + dx * d, gy, at.z + dz * d, spec.scorch.radius, spec.scorch.lifeSec, spec.scorch.hot);
  }
  if (spec.shake && c.localInvolved) c.shake?.(spec.shake.amplitude, spec.shake.ms);
}

// ---- scans (replicated state) -------------------------------------------------------------------------------------------

interface PlayerLike { x: number; y: number; z: number; facingYaw?: number; action?: string; moveId?: string; actionStartTick?: number; kitId?: string; beast?: boolean }
type Surface = (x: number, z: number, y: number) => number | null;
const groundAt = (surface: Surface | undefined, x: number, z: number, y: number): number | null => (surface ? surface(x, z, y) : y - ARENA.capsule.centreAboveSurface);

export interface ScanEnv {
  fx: EffectsPool; tier: () => Tier; reducedMotion: () => boolean; decals: () => ScorchDecals | null; pulse: ScreenPulse | null;
  surface?: Surface | undefined; localId?: (() => string | undefined) | undefined; shake?: ((a: number, ms: number) => void) | undefined;
}

/** Fires the charge-up and release layers once per replicated action start. `seen` maps entity id to the last "<action>:<move>:<tick>" key. */
export function scanActions(env: ScanEnv, players: Map<string, unknown>, seen: Map<string, string>): void {
  const live = new Set<string>();
  for (const [id, v] of players) {
    live.add(id);
    const p = v as PlayerLike, prev = seen.get(id);
    if (p.action !== "Windup" && p.action !== "Active") { if (prev?.startsWith("Windup:")) env.fx.glow?.clearOwner(id); seen.delete(id); continue; }
    const spec = selectActionFx({ action: p.action, moveId: p.moveId, beast: p.beast === true, kitId: p.kitId, tier: env.tier(), reducedMotion: env.reducedMotion() });
    if (!spec) continue;
    const key = `${p.action}:${p.moveId}:${p.actionStartTick ?? 0}`;
    if (prev === key) continue;
    if (prev?.startsWith("Windup:")) env.fx.glow?.clearOwner(id);
    seen.set(id, key);
    const at = { x: p.x / 100, y: p.y / 100, z: p.z / 100 }, gy = groundAt(env.surface, at.x, at.z, at.y);
    playActionLayers(spec, { fx: env.fx, decals: env.decals(), pulse: env.pulse, at, groundY: gy ?? at.y - ARENA.capsule.centreAboveSurface, hasGround: gy !== null, yaw: fromYaw(p.facingYaw ?? 0), moveId: p.moveId!, owner: id, localInvolved: env.localId?.() === id, shake: env.shake });
  }
  for (const id of [...seen.keys()]) if (!live.has(id)) { if (seen.get(id)?.startsWith("Windup:")) env.fx.glow?.clearOwner(id); seen.delete(id); }
}

/** Beast-form aura: lava embers and smoke rising around every transformed fighter, rate set by the tier. `acc` carries fractional spawns per id. */
export function scanAura(env: ScanEnv, players: Map<string, unknown>, dtSec: number, acc: Map<string, number>): void {
  const rate = auraRate(env.tier(), env.reducedMotion());
  const live = new Set<string>();
  for (const [id, v] of players) {
    const p = v as PlayerLike;
    if (p.beast !== true || p.action === "Dead" || rate <= 0) continue;
    live.add(id);
    let a = Math.min(3, (acc.get(id) ?? 0) + dtSec * rate);
    const at = { x: p.x / 100, y: p.y / 100, z: p.z / 100 }, gy = groundAt(env.surface, at.x, at.z, at.y) ?? at.y - ARENA.capsule.centreAboveSurface;
    while (a >= 1) {
      a -= 1;
      const ang = rnd(0, TAU), r = rnd(0.5, 2.4), x = at.x + Math.cos(ang) * r, z = at.z + Math.sin(ang) * r;
      if (Math.random() < 0.28) env.fx.spawn({ x, y: gy + 0.3, z, vx: rnd(-0.2, 0.2), vy: rnd(0.8, 1.6), vz: rnd(-0.2, 0.2), life: rnd(1.2, 1.9), size: rnd(0.6, 1), color: SMOKE_COLOR, gravity: -0.2 });
      else env.fx.spawn({ x, y: gy + 0.1, z, vx: rnd(-0.3, 0.3), vy: rnd(1.5, 3.4), vz: rnd(-0.3, 0.3), life: rnd(1, 1.8), size: rnd(0.1, 0.18), color: Math.random() < 0.5 ? BEAST_THEME.spark : BEAST_THEME.accent, gravity: -0.3 });
    }
    acc.set(id, a);
  }
  for (const id of [...acc.keys()]) if (!live.has(id)) acc.delete(id);
}

// ---- bus attach ---------------------------------------------------------------------------------------------------------

/** Test and debug probe for the browser lab: live decal and pulse counts of the attached instance. */
export const layeredFxProbe: { decals(): number; pulses(): number } = { decals: () => 0, pulses: () => 0 };

export const LayeredFx = {
  attach(bus: CombatBus, deps: PresentationDeps): () => void {
    const effects = deps.effects;
    if (!effects) return () => {};
    const tier = (): Tier => effects.glow.currentTier ?? "medium";
    const settings = (): { reducedMotion?: unknown; flashLevel?: unknown } => (deps.settings.get() as { reducedMotion?: unknown; flashLevel?: unknown } | undefined) ?? {};
    const reduced = (): boolean => settings().reducedMotion === true;
    const flashLevel = (): number => { const v = settings().flashLevel; return typeof v === "number" ? v : 0.3; };
    let decals: ScorchDecals | null = null, decalTier: Tier | null = null;
    const getDecals = (): ScorchDecals | null => {
      const t = tier();
      if (!decals || decalTier !== t) { decals?.dispose(); decals = new ScorchDecals(deps.scene, FX_TIER[t].decals); decalTier = t; }
      return decals;
    };
    const pulse = new ScreenPulse(typeof document !== "undefined" ? document : undefined);
    layeredFxProbe.decals = () => decals?.activeCount ?? 0;
    layeredFxProbe.pulses = () => pulse.fired;
    const chest = (id: string): Pt | undefined => { const p = deps.players().get(id) as Pt | undefined; return p ? { x: p.x / 100, y: p.y / 100 + 0.3, z: p.z / 100 } : undefined; };

    const off = bus.on((e: CombatEvent) => {
      const victim = e.targetId ?? e.actorId, at = e.position ?? chest(victim);
      if (!at || (e.kind !== "hit" && e.kind !== "ko")) return;
      const actor = deps.players().get(e.actorId) as PlayerLike | undefined;
      const gy = groundAt(deps.surfaceHeight, at.x, at.z, at.y);
      const spec = selectHitFx({ kind: e.kind, moveId: e.moveId, hitClass: e.hitClass, damage100: e.damage100, targetHp100: e.targetHp100, actorBeast: actor?.beast === true, kitId: actor?.kitId,
        tier: tier(), reducedMotion: reduced(), flashLevel: flashLevel(), hasGround: gy !== null });
      if (!spec) return;
      effects.glow.setSoft(reduced());
      playHitLayers(spec, { fx: effects, decals: getDecals(), pulse, at, groundY: gy ?? at.y - ARENA.capsule.centreAboveSurface, hasGround: gy !== null });
      const target = deps.fighters?.(victim);
      if (spec.rim) target?.flash(spec.rim.color, spec.rim.ms, flashLevel() * (reduced() ? 0.5 : 1));
      // Hit-stop: ability, beast and KO hits only (decision 0055). Presentation: pauses the two animations, never the simulation.
      if (spec.freezeFrames > 0 && !HIT_STUN.enabled) { target?.freeze(spec.freezeFrames); deps.fighters?.(e.actorId)?.freeze(spec.freezeFrames); }
      const me = deps.localId();
      if (!reduced() && me !== undefined && (e.actorId === me || e.targetId === me)) deps.shake?.(spec.shake.amplitude, spec.shake.ms);
    });

    const env: ScanEnv = { fx: effects, tier, reducedMotion: reduced, decals: getDecals, pulse, surface: deps.surfaceHeight, localId: deps.localId, shake: deps.shake };
    const seen = new Map<string, string>(), acc = new Map<string, number>();
    let raf = 0, alive = true, last = typeof performance !== "undefined" ? performance.now() : 0;
    const frame = (now: number): void => {
      if (!alive) return;
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now;
      decals?.update(dt);
      scanActions(env, deps.players(), seen);
      scanAura(env, deps.players(), dt, acc);
      raf = requestAnimationFrame(frame);
    };
    if (typeof requestAnimationFrame === "function") raf = requestAnimationFrame(frame);
    return () => {
      alive = false;
      if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(raf);
      off();
      seen.clear(); acc.clear();
      decals?.dispose(); decals = null;
      pulse.dispose();
      layeredFxProbe.decals = () => 0; layeredFxProbe.pulses = () => 0;
    };
  },
};
