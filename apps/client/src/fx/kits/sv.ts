import { forwardOf } from "@eb/shared/math";
import { SV_DEFS } from "@eb/shared/config/kits/index";
import type { EffectsPool } from "../../scene/EffectsPool.js";
import type { CombatEvent } from "@eb/shared/protocol";
import { decalRadiusFor, frameOf, makeKitFx, onHit as onHitWith, scanPlayers as scanWith, type ActiveStyle, type Pos, type Recipe, type SustainCtx } from "./common.js";

/**
 * Stone Vanguard ability effects (FX4-sv). Stone language: fans of thrown chips and circular fractures in the ground.
 * Windup telegraphs key on the replicated action Windup + moveId, active effects on Active, impacts on a bus `hit` with
 * the moveId. Presentation only; all particles come from the FX1 pool and expire by themselves.
 */

export type SvRecipe = Recipe;

const OCHRE = 0xc9a56a, SLATE = 0x6b5a45, DUST = 0xe8d9b8;
const r = (id: string, glow: boolean, style: ActiveStyle, count: number, color: number, reach: number, impact: number): SvRecipe => ({
  windup: { decalRadius: decalRadiusFor(SV_DEFS, id), color: OCHRE, glow },
  active: { style, count, color, life: 0.5, reach },
  impact: { count: impact, color: DUST, life: 0.35, speed: 3.5 },
});

/** One recipe per shipped sv.* ability. Total particles per recipe stay under LOW_QUALITY_CAP (the low pool holds 200). */
/**
 * QV03 Fault Strike (sv.b1). Contact and settling are separate layers inside the legal footprint (handler wave box 2 m wide
 * by 8 m long ahead of the caster; direct strike 3 m ahead): a bright, fast, short-lived crack at the 3 m impact, two rows
 * of chips that split forward and left/right along the wave box, then dark low fragments that lie along the footprint and
 * outlast the chips. The generic windup ring is the grounded warning. Particle counts: 6 + 8 + 12 = 26.
 */
export const FAULT_FOOTPRINT = { forward: 8, halfWidth: 1, impactAt: 3 } as const;
const CRACK = 0xfff1c9, CHIP = 0xe8d9b8, FRAG = 0x4a3d2e;
export const FAULT_LAYERS = { crack: 6, chips: 8, settle: 12 } as const;
export function playFaultStrike(fx: EffectsPool, at: Pos, yaw: number, surface: (x: number, z: number, y: number) => number | null): void {
  const [dx, dz] = forwardOf(yaw), px = -dz, pz = dx; // forward and right (perpendicular)
  const pt = (f: number, l: number): { x: number; z: number } => ({ x: at.x + dx * f + px * l, z: at.z + dz * f + pz * l });
  const impact = pt(FAULT_FOOTPRINT.impactAt, 0);
  if (surface(impact.x, impact.z, at.y) === null) return; // impact over the void: nothing to crack
  // Contact: short bright crack flash at the impact point.
  for (let i = 0; i < FAULT_LAYERS.crack; i++) {
    const s = i % 2 ? 1 : -1, c = pt(FAULT_FOOTPRINT.impactAt, s * 0.25 * (1 + (i >> 1) * 0.8)), y = surface(c.x, c.z, at.y);
    if (y === null) continue;
    fx.spawn({ x: c.x, y: y + 0.12, z: c.z, vx: 0, vy: 0.4, vz: 0, life: 0.45, size: 0.9, color: CRACK });
  }
  // Split: chips leave the impact in two diverging rows; end points stay inside the wave box (lateral <= 0.9 at 8 m).
  const fwd = FAULT_FOOTPRINT.forward - FAULT_FOOTPRINT.impactAt, life = 0.4;
  for (let i = 0; i < FAULT_LAYERS.chips; i++) {
    const s = i % 2 ? 1 : -1, k = (i >> 1) / 3, f = fwd * (0.55 + 0.45 * k) / life, l = s * (0.15 + 0.2 * k) * 1.0 / life;
    const c = pt(FAULT_FOOTPRINT.impactAt, 0);
    fx.spawn({ x: c.x, y: at.y + 0.3, z: c.z, vx: dx * f + px * l, vy: 1.2, vz: dz * f + pz * l, life, size: 0.2, color: CHIP, gravity: 6 });
  }
  // Settling: dark fragments rest on the ground along the footprint and outlast the chips.
  for (let i = 0; i < FAULT_LAYERS.settle; i++) {
    const f = FAULT_FOOTPRINT.impactAt + ((i + 0.5) / FAULT_LAYERS.settle) * fwd, l = (i % 2 ? 1 : -1) * 0.7 * ((i % 3) / 2 + 0.2) * FAULT_FOOTPRINT.halfWidth;
    const c = pt(f, l), y = surface(c.x, c.z, at.y);
    if (y === null) continue;
    fx.spawn({ x: c.x, y: y + 0.06, z: c.z, vx: 0, vy: 0, vz: 0, life: 1.6, size: 0.28, color: FRAG });
  }
}

/**
 * QV06: per-move Vanguard cues. Stone language. Every function is presentation only (particles that expire by themselves);
 * origin, facing and extents come from the replicated pose and the ability definition, never from client input.
 */
const def = (id: string) => SV_DEFS.find((d) => d.id === id)!;
type Surface = (x: number, z: number, y: number) => number | null;
const AMBER = 0xffb347, PALE = 0xf4ead2, BROWN = 0x7a5a3a;

/** Latest scheduled pulse (activeStart + offset) that is due and not yet fired; -1 when none. Marks it fired. */
export function duePulse(c: SustainCtx, offsets: readonly number[]): number {
  let last = -1;
  for (let i = c.state.lastPulse + 1; i < offsets.length && c.startTick + offsets[i]! <= c.tick; i++) last = i;
  if (last >= 0) c.state.lastPulse = last;
  return last;
}

/** sv.b2 Gravel Flurry: one small chip volley per scheduled hit tick inside the 2.5 m reach; the sixth (finisher) volley is heavier and ochre. */
export const FLURRY = { offsets: def("sv.b2").hitOffsets ?? [], reach: 2.5, volley: 5, finisher: 10, life: 0.28 } as const;
export function playGravelFlurry(fx: EffectsPool, c: SustainCtx): void {
  const i = duePulse(c, FLURRY.offsets);
  if (i < 0) return;
  const last = i === FLURRY.offsets.length - 1, n = last ? FLURRY.finisher : FLURRY.volley, f = frameOf(c.at, c.yaw);
  for (let k = 0; k < n; k++) {
    const a = c.yaw + ((k + 0.5) / n - 0.5) * (last ? 1.4 : 0.9), [vx, vz] = forwardOf(a);
    fx.spawn({ x: c.at.x + f.dx * 0.5, y: c.at.y + 0.5 + (k % 3) * 0.22, z: c.at.z + f.dz * 0.5, vx: vx * FLURRY.reach / FLURRY.life, vy: 0.8, vz: vz * FLURRY.reach / FLURRY.life, life: FLURRY.life, size: last ? 0.3 : 0.2, color: last ? OCHRE : DUST, gravity: 5 });
  }
}

/** sv.b3 Rift Palm: a flat bright crescent thrown from the palm, 2 m reach (the reflect surface), with a pale centre line. */
export const PALM = { arc: 10, line: 4, reach: 2, life: 0.3 } as const;
export function playRiftPalm(fx: EffectsPool, at: Pos, yaw: number): void {
  const f = frameOf(at, yaw);
  for (let i = 0; i < PALM.arc; i++) {
    const a = yaw + ((i + 0.5) / PALM.arc - 0.5) * 1.6, [vx, vz] = forwardOf(a);
    fx.spawn({ x: at.x + f.dx * 0.6, y: at.y + 0.45, z: at.z + f.dz * 0.6, vx: vx * (PALM.reach - 0.6) / PALM.life, vy: 0, vz: vz * (PALM.reach - 0.6) / PALM.life, life: PALM.life, size: 0.34, color: PALE });
  }
  for (let i = 0; i < PALM.line; i++) fx.spawn({ x: at.x + f.dx * (0.6 + i * 0.35), y: at.y + 0.45, z: at.z + f.dz * (0.6 + i * 0.35), vx: 0, vy: 0, vz: 0, life: 0.2, size: 0.5, color: AMBER });
}

/** sv.b4 Rising Pillar: a column of slabs rising 1.6 m ahead (the launch point) over a cracked ring on the ground. */
export const PILLAR = { slabs: 10, ring: 8, at: 1.6, radius: 1.1, life: 0.55 } as const;
export function playRisingPillar(fx: EffectsPool, at: Pos, yaw: number, surface: Surface): void {
  const f = frameOf(at, yaw), c = f.pt(PILLAR.at, 0), y0 = surface(c.x, c.z, at.y);
  if (y0 === null) return;
  for (let i = 0; i < PILLAR.slabs; i++) fx.spawn({ x: c.x + (i % 2 ? 0.12 : -0.12), y: y0 + 0.1, z: c.z, vx: 0, vy: 3 + (i % 5) * 1.1, vz: 0, life: PILLAR.life, size: 0.5, color: i % 3 ? SLATE : OCHRE, gravity: 3 });
  for (let i = 0; i < PILLAR.ring; i++) {
    const a = (i / PILLAR.ring) * Math.PI * 2, x = c.x + Math.cos(a) * PILLAR.radius, z = c.z + Math.sin(a) * PILLAR.radius, y = surface(x, z, at.y);
    if (y !== null) fx.spawn({ x, y: y + 0.06, z, vx: 0, vy: 0.3, vz: 0, life: 1, size: 0.24, color: BROWN });
  }
}

/** sv.a1 Stillpoint Reversal response (Active after a countered hit): stone drawn inward to the caster, then a held amber core. The waiting stance is a private status that is not replicated, so observers get no stance cue (owner sees the HUD text). */
export const REVERSAL = { inward: 16, core: 6, radius: 3.2, life: 0.5, hit: 22 } as const;
export function playStillpointResponse(fx: EffectsPool, at: Pos): void {
  for (let i = 0; i < REVERSAL.inward; i++) {
    const a = (i / REVERSAL.inward) * Math.PI * 2;
    fx.spawn({ x: at.x + Math.cos(a) * REVERSAL.radius, y: at.y + 0.3 + (i % 3) * 0.5, z: at.z + Math.sin(a) * REVERSAL.radius, vx: -Math.cos(a) * REVERSAL.radius / REVERSAL.life, vy: 0, vz: -Math.sin(a) * REVERSAL.radius / REVERSAL.life, life: REVERSAL.life, size: 0.3, color: i % 2 ? SLATE : DUST });
  }
  for (let i = 0; i < REVERSAL.core; i++) fx.spawn({ x: at.x, y: at.y + 0.2 + i * 0.25, z: at.z, vx: 0, vy: 0.2, vz: 0, life: 0.7, size: 0.5, color: AMBER });
}
/** The reversal's damage tick (confirmed hit, 100 HP): a heavy amber burst at the victim. */
export function playStillpointHit(fx: EffectsPool, _e: CombatEvent, at: Pos): void {
  for (let i = 0; i < REVERSAL.hit; i++) {
    const a = (i / REVERSAL.hit) * Math.PI * 2, up = i % 2;
    fx.spawn({ x: at.x, y: at.y, z: at.z, vx: Math.cos(a) * (up ? 2.5 : 5), vy: up ? 4 : 0.8, vz: Math.sin(a) * (up ? 2.5 : 5), life: 0.5, size: up ? 0.4 : 0.3, color: up ? AMBER : DUST, gravity: 6 });
  }
}

/** sv.a2 Skybreak: ranks of chips thrown across the whole 20 m wide, 24 m long box, so the wave front is visible. */
const WAVE = def("sv.a2").shape;
export const SKYBREAK = { lanes: 8, ranks: 6, width: WAVE.kind === "box" ? WAVE.w : 20, length: WAVE.kind === "box" ? WAVE.d : 24, life: 0.7 } as const;
export function playSkybreak(fx: EffectsPool, at: Pos, yaw: number): void {
  const f = frameOf(at, yaw);
  for (let r = 0; r < SKYBREAK.ranks; r++) for (let l = 0; l < SKYBREAK.lanes; l++) {
    const fw = ((r + 1) / SKYBREAK.ranks) * SKYBREAK.length * 0.98, lat = ((l + 0.5) / SKYBREAK.lanes - 0.5) * SKYBREAK.width * 0.9, life = SKYBREAK.life;
    fx.spawn({ x: at.x, y: at.y - 0.4, z: at.z, vx: (f.dx * fw + f.px * lat) / life, vy: 1.5, vz: (f.dz * fw + f.pz * lat) / life, life, size: 0.34 + r * 0.04, color: r % 2 ? SLATE : OCHRE, gravity: 4 });
  }
}

/** sv.a3 Horizon Break: a wide pale core inside an amber sheath along the aim, clipped at the first cover, re-emitted every 3 ticks of the 6 tick Active window. */
const BEAM = def("sv.a3").shape;
export const HORIZON = { core: 8, sheath: 12, emitTicks: 3, life: 0.35, originForward: 0.6, length: BEAM.kind === "beam" ? BEAM.length : 32, radius: BEAM.kind === "beam" ? BEAM.radius : 3 } as const;
export function playHorizonBreak(fx: EffectsPool, c: SustainCtx): void {
  if (c.state.lastEmit >= 0 && c.tick - c.state.lastEmit < HORIZON.emitTicks) return;
  c.state.lastEmit = c.tick;
  const f = frameOf(c.at, c.yaw), ox = c.at.x + f.dx * HORIZON.originForward, oz = c.at.z + f.dz * HORIZON.originForward, oy = c.at.y + 1;
  const len = c.cover ? Math.min(HORIZON.length, c.cover(ox, oy - 0.6, oz, f.dx, f.dz, HORIZON.length)) : HORIZON.length;
  if (len <= 0) return;
  for (let i = 0; i < HORIZON.core; i++) { const d = ((i + 0.5) / HORIZON.core) * len; fx.spawn({ x: ox + f.dx * d, y: oy, z: oz + f.dz * d, vx: 0, vy: 0, vz: 0, life: HORIZON.life, size: 0.9, color: PALE }); }
  for (let i = 0; i < HORIZON.sheath; i++) {
    const d = ((i + 0.5) / HORIZON.sheath) * len, s = i % 2 ? 1 : -1, w = HORIZON.radius * 0.8 * (0.5 + (i % 3) / 4);
    fx.spawn({ x: ox + f.dx * d + f.px * s * w, y: oy + (i % 3) * 0.3 - 0.3, z: oz + f.dz * d + f.pz * s * w, vx: 0, vy: 0.4, vz: 0, life: HORIZON.life, size: 0.7, color: AMBER });
  }
}

/** sv.a4 Orbit Collapse: stone circling the grab point 3 m ahead; the confirmed capture (0 damage) adds a tight orbit on the victim, the release (100 HP) slams outward. */
export const ORBIT = { ring: 16, reach: 3, radius: 1.6, life: 0.6, capture: 14, release: 20 } as const;
export function playOrbit(fx: EffectsPool, at: Pos, yaw: number): void {
  const c = frameOf(at, yaw).pt(ORBIT.reach, 0);
  for (let i = 0; i < ORBIT.ring; i++) {
    const a = (i / ORBIT.ring) * Math.PI * 2, w = 3.2;
    fx.spawn({ x: c.x + Math.cos(a) * ORBIT.radius, y: at.y + 0.4 + (i % 4) * 0.35, z: c.z + Math.sin(a) * ORBIT.radius, vx: -Math.sin(a) * w * ORBIT.radius, vy: 0, vz: Math.cos(a) * w * ORBIT.radius, life: ORBIT.life, size: 0.28, color: i % 2 ? SLATE : AMBER });
  }
}
export function playOrbitHit(fx: EffectsPool, e: CombatEvent, at: Pos): void {
  const capture = (e.damage100 ?? 0) === 0, n = capture ? ORBIT.capture : ORBIT.release;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    if (capture) fx.spawn({ x: at.x + Math.cos(a) * 0.9, y: at.y + (i % 3) * 0.3, z: at.z + Math.sin(a) * 0.9, vx: -Math.sin(a) * 4, vy: 0.3, vz: Math.cos(a) * 4, life: 0.9, size: 0.26, color: AMBER });
    else fx.spawn({ x: at.x, y: at.y, z: at.z, vx: Math.cos(a) * 6, vy: 2 + (i % 3), vz: Math.sin(a) * 6, life: 0.6, size: 0.4, color: i % 2 ? SLATE : DUST, gravity: 7 });
  }
}

/** sv.x1 Echo Tap: a bright tap ring at the contact, then a wider dim echo ring (two radii, two lifetimes). */
export const ECHO = { tap: 8, echo: 10, tapR: 0.5, echoR: 1.5, at: 1.5 } as const;
export function playEchoTap(fx: EffectsPool, at: Pos, yaw: number): void {
  const c = frameOf(at, yaw).pt(ECHO.at, 0);
  for (let i = 0; i < ECHO.tap; i++) { const a = (i / ECHO.tap) * Math.PI * 2; fx.spawn({ x: c.x, y: at.y + 0.1, z: c.z, vx: Math.cos(a) * ECHO.tapR / 0.2, vy: 0, vz: Math.sin(a) * ECHO.tapR / 0.2, life: 0.2, size: 0.36, color: PALE }); }
  for (let i = 0; i < ECHO.echo; i++) { const a = (i / ECHO.echo) * Math.PI * 2; fx.spawn({ x: c.x, y: at.y + 0.1, z: c.z, vx: Math.cos(a) * ECHO.echoR / 0.5, vy: 0, vz: Math.sin(a) * ECHO.echoR / 0.5, life: 0.5, size: 0.24, color: AMBER }); }
}

/** sv.x2 Gale Rebuff: low gust streaks toward the wall; the capture (0 damage) pins dust at the captive, the scheduled release (40 HP) throws a fan away from the caster. */
export const GALE = { streaks: 12, release: 16, pin: 6, reach: 2.4 } as const;
export function playGale(fx: EffectsPool, at: Pos, yaw: number): void {
  const f = frameOf(at, yaw);
  for (let i = 0; i < GALE.streaks; i++) {
    const l = ((i % 4) - 1.5) * 0.35, h = 0.5 + Math.floor(i / 4) * 0.4;
    fx.spawn({ x: at.x + f.px * l + f.dx * 0.5, y: at.y + h, z: at.z + f.pz * l + f.dz * 0.5, vx: f.dx * GALE.reach / 0.3, vy: 0, vz: f.dz * GALE.reach / 0.3, life: 0.3, size: 0.26, color: PALE });
  }
}
export function playGaleHit(fx: EffectsPool, e: CombatEvent, at: Pos, actorAt: Pos | undefined): void {
  if ((e.damage100 ?? 0) === 0) {
    for (let i = 0; i < GALE.pin; i++) fx.spawn({ x: at.x, y: at.y - 0.4 + i * 0.2, z: at.z, vx: 0, vy: 0.2, vz: 0, life: 0.5, size: 0.4, color: DUST });
    return;
  }
  const base = actorAt ? Math.atan2(at.x - actorAt.x, at.z - actorAt.z) : 0;
  for (let i = 0; i < GALE.release; i++) {
    const a = base + ((i + 0.5) / GALE.release - 0.5) * 1.8;
    fx.spawn({ x: at.x, y: at.y, z: at.z, vx: Math.sin(a) * 8, vy: 1 + (i % 3) * 0.6, vz: Math.cos(a) * 8, life: 0.45, size: 0.3, color: i % 2 ? PALE : DUST, gravity: 5 });
  }
}

/** sv.x3 Meteor Cast: the thrown urn leaves the hand in a dust puff; the confirmed hit shatters it into ochre and brown shards. The flight itself is the projectile view. */
export const URN = { puff: 8, shards: 16 } as const;
export function playMeteorCast(fx: EffectsPool, at: Pos, yaw: number): void {
  const f = frameOf(at, yaw);
  for (let i = 0; i < URN.puff; i++) { const s = i % 2 ? 0.8 : -0.8; fx.spawn({ x: at.x + f.dx * 0.6 + f.px * 0.3, y: at.y + 0.9 + (i % 4) * 0.12, z: at.z + f.dz * 0.6 + f.pz * 0.3, vx: f.dx * 4 + s * f.px, vy: 0.6, vz: f.dz * 4 + s * f.pz, life: 0.35, size: 0.3, color: i % 2 ? OCHRE : DUST }); }
}
export function playUrnShatter(fx: EffectsPool, _e: CombatEvent, at: Pos): void {
  for (let i = 0; i < URN.shards; i++) {
    const a = (i / URN.shards) * Math.PI * 2;
    fx.spawn({ x: at.x, y: at.y, z: at.z, vx: Math.cos(a) * (3 + (i % 3)), vy: 2.5 + (i % 4) * 0.6, vz: Math.sin(a) * (3 + (i % 3)), life: 0.7, size: i % 3 ? 0.22 : 0.4, color: i % 2 ? OCHRE : BROWN, gravity: 9 });
  }
}

/** sv.activate (action Awakening, 30 ticks, no damage): amber rising column around the body and a stone ring pushed out at the feet. */
export const ACTIVATE = { column: 14, ring: 12, glow: 6, life: 0.9, radius: 2.2 } as const;
export function playVanguardActivate(fx: EffectsPool, at: Pos, _yaw: number, surface: Surface): void {
  for (let i = 0; i < ACTIVATE.column; i++) {
    const a = (i / ACTIVATE.column) * Math.PI * 4;
    fx.spawn({ x: at.x + Math.cos(a) * 0.7, y: at.y + 0.1 + (i / ACTIVATE.column) * 0.6, z: at.z + Math.sin(a) * 0.7, vx: -Math.sin(a) * 1.2, vy: 2.6, vz: Math.cos(a) * 1.2, life: ACTIVATE.life, size: 0.28, color: AMBER });
  }
  for (let i = 0; i < ACTIVATE.ring; i++) {
    const a = (i / ACTIVATE.ring) * Math.PI * 2, x = at.x + Math.cos(a) * 0.5, z = at.z + Math.sin(a) * 0.5, y = surface(x, z, at.y);
    if (y !== null) fx.spawn({ x, y: y + 0.08, z, vx: Math.cos(a) * ACTIVATE.radius / 0.6, vy: 0, vz: Math.sin(a) * ACTIVATE.radius / 0.6, life: 0.6, size: 0.3, color: SLATE });
  }
  for (let i = 0; i < ACTIVATE.glow; i++) fx.spawn({ x: at.x, y: at.y + 0.6 + i * 0.25, z: at.z, vx: 0, vy: 0.3, vz: 0, life: 0.8, size: 0.6, color: AMBER });
}

/** sv.b1 confirmed hit (QI01 carried item): the flash is drawn where the bodies are. At point blank the 3 m footprint mark lies behind the victim and is hidden from both fighters' cameras. */
export const FAULT_HIT = { flash: 3, sparks: 5 } as const;
export function playFaultHit(fx: EffectsPool, _e: CombatEvent, at: Pos): void {
  for (let i = 0; i < FAULT_HIT.flash; i++) fx.spawn({ x: at.x, y: at.y + i * 0.15, z: at.z, vx: 0, vy: 0.3, vz: 0, life: 0.5, size: 1.3, color: CRACK });
  for (let i = 0; i < FAULT_HIT.sparks; i++) { const a = (i / FAULT_HIT.sparks) * Math.PI * 2; fx.spawn({ x: at.x, y: at.y, z: at.z, vx: Math.cos(a) * 3.5, vy: 1.5, vz: Math.sin(a) * 3.5, life: 0.4, size: 0.24, color: CHIP, gravity: 6 }); }
}

export const SV_RECIPES: Readonly<Record<string, SvRecipe>> = {
  "sv.b1": { ...r("sv.b1", false, "fracture", 26, SLATE, 3, 10), playActive: playFaultStrike, playHit: playFaultHit, hitCount: FAULT_HIT.flash + FAULT_HIT.sparks },
  "sv.b2": { ...r("sv.b2", true, "fan", 0, OCHRE, 2.5, 8), sustain: playGravelFlurry, sustainPeak: 30 },
  "sv.b3": { ...r("sv.b3", false, "fan", PALM.arc + PALM.line, PALE, 2, 10), playActive: playRiftPalm },
  "sv.b4": { ...r("sv.b4", false, "fracture", PILLAR.slabs + PILLAR.ring, SLATE, 2, 14), playActive: playRisingPillar },
  "sv.a1": { ...r("sv.a1", false, "ring", REVERSAL.inward + REVERSAL.core, DUST, 3, 0), playActive: playStillpointResponse, playHit: playStillpointHit, hitCount: REVERSAL.hit },
  "sv.a2": { ...r("sv.a2", false, "fracture", SKYBREAK.lanes * SKYBREAK.ranks, SLATE, 10, 20), playActive: playSkybreak },
  "sv.a3": { ...r("sv.a3", true, "fan", 0, OCHRE, 32, 12), sustain: playHorizonBreak, sustainPeak: (HORIZON.core + HORIZON.sheath) * 2 },
  "sv.a4": { ...r("sv.a4", false, "fracture", ORBIT.ring, SLATE, 4, 0), playActive: playOrbit, playHit: playOrbitHit, hitCount: ORBIT.release },
  "sv.x1": { ...r("sv.x1", false, "fan", ECHO.tap + ECHO.echo, AMBER, 2.5, 8), playActive: playEchoTap },
  "sv.x2": { ...r("sv.x2", false, "fan", GALE.streaks, DUST, 2.4, 0), playActive: playGale, playHit: playGaleHit, hitCount: GALE.release },
  "sv.x3": { ...r("sv.x3", false, "fan", URN.puff, OCHRE, 4, 0), playActive: playMeteorCast, playHit: playUrnShatter, hitCount: URN.shards },
  /** Awakening (action "Awakening", moveId sv.activate): played once from the replicated action start. */
  "sv.activate": { ...r("sv.activate", false, "ring", ACTIVATE.column + ACTIVATE.ring + ACTIVATE.glow, AMBER, 2.2, 0), playActive: playVanguardActivate },
};


export const recipeFor = (moveId: string | undefined): SvRecipe | undefined => (moveId ? SV_RECIPES[moveId] : undefined);

export function scanPlayers(fx: EffectsPool, players: Map<string, unknown>, seen: Map<string, string>): void {
  scanWith(fx, players, seen, recipeFor);
}

export function onHit(fx: EffectsPool, e: CombatEvent, chest: (id: string) => Pos | undefined): void {
  onHitWith(fx, e, chest, recipeFor);
}

export const SvFx = makeKitFx(recipeFor);
