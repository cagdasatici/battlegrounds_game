import { forwardOf } from "@eb/shared/math";
import type { CombatEvent } from "@eb/shared/protocol";
import { TD_DEFS } from "@eb/shared/config/kits/index";
import type { EffectsPool } from "../../scene/EffectsPool.js";
import type { CombatBus } from "../../app/CombatBus.js";
import type { PresentationDeps } from "../index.js";
import { LOW_QUALITY_CAP, frameOf, makeKitFx, playImpact, onHit as onHitWith, recipeParticles, scanPlayers as scanWith, type ActiveStyle, type Pos, type Recipe, type SustainCtx } from "./common.js";

export { LOW_QUALITY_CAP, recipeParticles };
export type { ActiveStyle };
export { playActive, playImpact, playWindup } from "./common.js";

/**
 * Tide Duelist ability effects (FX4-td). Water language: ribbon arcs, spirals and rising droplets. Windup telegraphs key
 * on the replicated action Windup + moveId, active effects on Active, impacts on a bus `hit` with the moveId. All
 * particles come from the FX1 pool and expire by themselves. Presentation only; nothing reads or feeds the simulation.
 */

export type TdRecipe = Recipe;

const AQUA = 0x37c8ff, DEEP = 0x1f6fff, FOAM = 0xd8f6ff;
const r = (decalRadius: number, glow: boolean, style: ActiveStyle, count: number, color: number, reach: number, impact: number): TdRecipe => ({
  windup: { decalRadius, color: AQUA, glow },
  active: { style, count, color, life: 0.4, reach },
  impact: { count: impact, color: FOAM, life: 0.3, speed: 4 },
});

/**
 * QV04 Undertow Spiral (td.b2). The drag ribbon exists only after a confirmed first `hit` (capture, +0): a narrow cyan
 * leading edge and a darker curved ribbon travel the server's 3 m / 36 tick drag (0.6 s) away from the caster, starting at
 * the victim. The second `hit` (+48) is the slam and uses the recipe's generic splash. A miss or block emits no `hit`, so
 * nothing victim-bound is drawn. Presentation only: duration is particle life, never a damage or movement timer.
 */
export const UNDERTOW = { dragM: 3, dragSec: 0.6, edge: 6, ribbon: 14, slamGapTicks: 60, elevatedDamage100: 2400, landing: 14 } as const;
const EDGE = 0xa8f0ff, SHEET = 0x123f9c;
const firstHitTick = new Map<string, number>(); // actor id -> tick of the capture hit; removed by the slam or when stale
export function playUndertowHit(fx: EffectsPool, e: CombatEvent, at: Pos, actorAt: Pos | undefined): void {
  const prev = firstHitTick.get(e.actorId);
  if (prev !== undefined && e.tick - prev > 0 && e.tick - prev <= UNDERTOW.slamGapTicks) {
    firstHitTick.delete(e.actorId);
    playImpact(fx, TD_RECIPES["td.b2"]!, at);
    if ((e.damage100 ?? 0) >= UNDERTOW.elevatedDamage100) playElevatedLanding(fx, at); // QV07: the landed elevated branch (24 HP) is bigger than the 14 HP slam
    return;
  }
  if (firstHitTick.size >= 32) firstHitTick.clear(); // bounded; only drops a pending slam distinction
  firstHitTick.set(e.actorId, e.tick);
  if (!actorAt) return;
  let dx = at.x - actorAt.x, dz = at.z - actorAt.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-3) return;
  dx /= len; dz /= len;
  const px = -dz, pz = dx, speed = UNDERTOW.dragM / UNDERTOW.dragSec;
  for (let i = 0; i < UNDERTOW.edge; i++) { // leading edge: narrow, bright, fast
    const l = (i - (UNDERTOW.edge - 1) / 2) * 0.05;
    fx.spawn({ x: at.x + px * l, y: at.y, z: at.z + pz * l, vx: dx * speed, vy: 0, vz: dz * speed, life: UNDERTOW.dragSec, size: 0.12, color: EDGE });
  }
  for (let i = 0; i < UNDERTOW.ribbon; i++) { // darker curved sheet trailing the edge, bowed to one side
    const k = i / (UNDERTOW.ribbon - 1), back = k * 0.9, bow = Math.sin(k * Math.PI) * 0.45;
    fx.spawn({ x: at.x - dx * back + px * bow, y: at.y - 0.1 + 0.15 * Math.sin(k * Math.PI), z: at.z - dz * back + pz * bow, vx: dx * speed, vy: 0, vz: dz * speed, life: UNDERTOW.dragSec, size: 0.22, color: SHEET });
  }
}

/** QV07: elevated Undertow Spiral landing (final hit of 24 HP): a second, wider foam ring and a short crashing column at the victim. */
export function playElevatedLanding(fx: EffectsPool, at: Pos): void {
  for (let i = 0; i < UNDERTOW.landing; i++) {
    const a = (i / UNDERTOW.landing) * Math.PI * 2, up = i % 2;
    fx.spawn({ x: at.x, y: at.y - 0.3, z: at.z, vx: Math.cos(a) * (up ? 3 : 7), vy: up ? 5 : 0.6, vz: Math.sin(a) * (up ? 3 : 7), life: 0.5, size: up ? 0.4 : 0.3, color: up ? AQUA : FOAM, gravity: 8 });
  }
}

/**
 * QV07: per-move Tide Duelist cues. Water language: ribbons, rings and spiralling droplets. Presentation only; every cue is
 * pooled particles that expire by themselves. Origin, facing and extents come from the replicated pose and the ability
 * definition; confirmed `hit`/`capture`/`counter` events add the victim-bound layers. Misses and blocks emit nothing here.
 */
const def = (id: string) => TD_DEFS.find((d) => d.id === id)!;
type Surface = (x: number, z: number, y: number) => number | null;
const duePulse = (c: SustainCtx, offsets: readonly number[]): number => {
  let last = -1;
  for (let i = c.state.lastPulse + 1; i < offsets.length && c.startTick + offsets[i]! <= c.tick; i++) last = i;
  if (last >= 0) c.state.lastPulse = last;
  return last;
};
const ring = (fx: EffectsPool, at: Pos, n: number, radius: number, life: number, size: number, color: number, y = 0, vy = 0): void => {
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; fx.spawn({ x: at.x + Math.cos(a) * radius, y: at.y + y + (i % 3) * 0.12, z: at.z + Math.sin(a) * radius, vx: -Math.sin(a) * 2, vy, vz: Math.cos(a) * 2, life, size, color }); }
};

/** td.b1 Current Bind: a looping ribbon thrown to the 2.4 m grab point; each strike pulses a tight ring on the victim, the 8 HP release surges outward. */
export const BIND = { loop: 18, lead: 8, reach: 2.4, pulse: 8, surge: 16, wrap: 10, loopSize: 0.4, leadSize: 0.32 } as const;
export function playCurrentBind(fx: EffectsPool, at: Pos, yaw: number): void {
  const f = frameOf(at, yaw), c = f.pt(BIND.reach, 0);
  for (let i = 0; i < BIND.loop; i++) { const a = (i / BIND.loop) * Math.PI * 2; fx.spawn({ x: c.x + Math.cos(a) * 0.55, y: at.y + 0.5 + i * 0.04, z: c.z + Math.sin(a) * 0.55, vx: -Math.sin(a) * 2.5, vy: 0.3, vz: Math.cos(a) * 2.5, life: 0.5, size: BIND.loopSize, color: i % 2 ? AQUA : EDGE }); }
  for (let i = 0; i < BIND.lead; i++) fx.spawn({ x: at.x + f.dx * 0.4, y: at.y + 0.6, z: at.z + f.dz * 0.4, vx: f.dx * BIND.reach / 0.2, vy: 0, vz: f.dz * BIND.reach / 0.2, life: 0.25 + i * 0.01, size: BIND.leadSize, color: EDGE });
}
export function playBindHit(fx: EffectsPool, e: CombatEvent, at: Pos): void {
  const dmg = e.damage100 ?? 0;
  if (dmg === 0) { ring(fx, at, BIND.wrap, 0.8, 0.5, 0.22, AQUA, 0, 0.4); return; } // capture wrap
  if (dmg >= 800) { for (let i = 0; i < BIND.surge; i++) { const a = (i / BIND.surge) * Math.PI * 2; fx.spawn({ x: at.x, y: at.y, z: at.z, vx: Math.cos(a) * 6, vy: 1.5 + (i % 3), vz: Math.sin(a) * 6, life: 0.45, size: 0.3, color: i % 2 ? FOAM : DEEP, gravity: 6 }); } return; }
  ring(fx, at, BIND.pulse, 0.5, 0.25, 0.2, FOAM, 0.2, 0.8);
}

/** td.b3 Tidal Cast: a curling lasso of water at the 2.2 m reach; the capture swirls at the victim, the 9 HP release throws a fan of spray away from the caster. */
export const CAST = { lasso: 14, reach: 2.2, swirl: 10, spray: 16 } as const;
export function playTidalCast(fx: EffectsPool, at: Pos, yaw: number): void {
  const f = frameOf(at, yaw);
  for (let i = 0; i < CAST.lasso; i++) {
    const k = i / CAST.lasso, a = k * Math.PI * 3, p = f.pt(CAST.reach * k, Math.sin(a) * 0.5);
    fx.spawn({ x: p.x, y: at.y + 0.7 + Math.cos(a) * 0.25, z: p.z, vx: f.dx * 2, vy: 0, vz: f.dz * 2, life: 0.35, size: 0.2, color: i % 2 ? AQUA : EDGE });
  }
}
export function playCastHit(fx: EffectsPool, e: CombatEvent, at: Pos, actorAt: Pos | undefined): void {
  if ((e.damage100 ?? 0) === 0) { ring(fx, at, CAST.swirl, 0.7, 0.6, 0.24, DEEP, 0, 1.2); return; }
  const base = actorAt ? Math.atan2(at.x - actorAt.x, at.z - actorAt.z) : 0;
  for (let i = 0; i < CAST.spray; i++) { const a = base + ((i + 0.5) / CAST.spray - 0.5) * 1.6; fx.spawn({ x: at.x, y: at.y, z: at.z, vx: Math.sin(a) * 9, vy: 1 + (i % 3) * 0.6, vz: Math.cos(a) * 9, life: 0.45, size: 0.28, color: i % 2 ? FOAM : AQUA, gravity: 5 }); }
}

/** td.b4 Mirror Current: the stance is a replicated Active action, so observers see a standing mirror ring around the caster for the 60 tick window. A confirmed counter flares it; the response strikes (6 and 16 HP) are ordinary hits. */
export const MIRROR = { ring: 14, radius: 1.1, life: 0.9, flare: 18, hit: 8, release: 16 } as const;
export function playMirrorCurrent(fx: EffectsPool, at: Pos): void { ring(fx, at, MIRROR.ring, MIRROR.radius, MIRROR.life, 0.18, FOAM, 0.4, 0.15); }
export function playMirrorFlare(fx: EffectsPool, at: Pos): void {
  for (let i = 0; i < MIRROR.flare; i++) { const a = (i / MIRROR.flare) * Math.PI * 2; fx.spawn({ x: at.x, y: at.y, z: at.z, vx: Math.cos(a) * 6, vy: 0.5 + (i % 3) * 0.4, vz: Math.sin(a) * 6, life: 0.3, size: 0.3, color: i % 2 ? FOAM : EDGE }); }
}
export function playMirrorHit(fx: EffectsPool, e: CombatEvent, at: Pos): void {
  if ((e.damage100 ?? 0) >= 1600) { for (let i = 0; i < MIRROR.release; i++) { const a = (i / MIRROR.release) * Math.PI * 2; fx.spawn({ x: at.x, y: at.y, z: at.z, vx: Math.cos(a) * 7, vy: 2 + (i % 3), vz: Math.sin(a) * 7, life: 0.45, size: 0.3, color: i % 2 ? FOAM : AQUA, gravity: 6 }); } return; }
  ring(fx, at, MIRROR.hit, 0.5, 0.25, 0.2, EDGE, 0.2, 0.8);
}

/** td.a1 Cascade Chain: five linked water rings along the 2.5 m reach; each chain strike snaps a ring on the victim, the 10 HP finisher bursts. */
export const CHAIN = { links: 5, per: 6, reach: 2.5, snap: 6, burst: 18, size: 0.38 } as const;
export function playCascadeChain(fx: EffectsPool, at: Pos, yaw: number): void {
  const f = frameOf(at, yaw);
  for (let l = 0; l < CHAIN.links; l++) { const c = f.pt(((l + 1) / CHAIN.links) * CHAIN.reach, 0); for (let i = 0; i < CHAIN.per; i++) { const a = (i / CHAIN.per) * Math.PI * 2 + l; fx.spawn({ x: c.x + Math.cos(a) * 0.3, y: at.y + 0.6 + Math.sin(a) * 0.3, z: c.z + f.px * Math.cos(a) * 0.3, vx: f.dx * 1.5, vy: 0, vz: f.dz * 1.5, life: 0.35 + l * 0.05, size: CHAIN.size, color: l % 2 ? AQUA : EDGE }); } }
}
export function playChainHit(fx: EffectsPool, e: CombatEvent, at: Pos): void {
  if ((e.damage100 ?? 0) >= 1000) { for (let i = 0; i < CHAIN.burst; i++) { const a = (i / CHAIN.burst) * Math.PI * 2; fx.spawn({ x: at.x, y: at.y, z: at.z, vx: Math.cos(a) * 6, vy: 2 + (i % 3), vz: Math.sin(a) * 6, life: 0.45, size: 0.3, color: i % 2 ? FOAM : DEEP, gravity: 6 }); } return; }
  ring(fx, at, CHAIN.snap, 0.45, 0.22, 0.2, FOAM, 0.2, 0.6);
}

/** td.a2 Deepfall: the cast draws a diving spiral around the caster; the capture lifts a water column at the victim; the 69 HP landing is a 4 m ring plus a crashing column; the 20 HP area hits are small splashes. */
export const DEEPFALL = { dive: 16, column: 14, ring: 24, crash: 12, area: 8, radius: 4 } as const;
export function playDeepfallCast(fx: EffectsPool, at: Pos): void {
  for (let i = 0; i < DEEPFALL.dive; i++) { const a = (i / DEEPFALL.dive) * Math.PI * 4; fx.spawn({ x: at.x + Math.cos(a) * 0.8, y: at.y + 1.8 - (i / DEEPFALL.dive) * 1.6, z: at.z + Math.sin(a) * 0.8, vx: -Math.sin(a) * 2, vy: -1.5, vz: Math.cos(a) * 2, life: 0.5, size: 0.22, color: i % 2 ? DEEP : AQUA }); }
}
export function playDeepfallHit(fx: EffectsPool, e: CombatEvent, at: Pos): void {
  const dmg = e.damage100 ?? 0;
  if (dmg === 0) { for (let i = 0; i < DEEPFALL.column; i++) fx.spawn({ x: at.x + (i % 2 ? 0.2 : -0.2), y: at.y - 0.4, z: at.z, vx: 0, vy: 3 + (i % 5) * 0.8, vz: 0, life: 0.7, size: 0.3, color: i % 2 ? AQUA : FOAM }); return; } // capture: the water column lifts the victim
  if (dmg >= 3000) { // landing
    for (let i = 0; i < DEEPFALL.ring; i++) { const a = (i / DEEPFALL.ring) * Math.PI * 2; fx.spawn({ x: at.x, y: at.y - 0.3, z: at.z, vx: Math.cos(a) * DEEPFALL.radius / 0.4, vy: 0.3, vz: Math.sin(a) * DEEPFALL.radius / 0.4, life: 0.4, size: 0.34, color: i % 2 ? FOAM : DEEP }); }
    for (let i = 0; i < DEEPFALL.crash; i++) fx.spawn({ x: at.x, y: at.y, z: at.z, vx: Math.cos(i) * 2, vy: 5 + (i % 4), vz: Math.sin(i) * 2, life: 0.6, size: 0.4, color: FOAM, gravity: 9 });
    return;
  }
  ring(fx, at, DEEPFALL.area, 0.6, 0.3, 0.22, AQUA, 0.1, 1);
}

/** td.a3 Split Tide: two probes at activeStart+[0,17]. The first sweeps a modest crescent over the 3 m range, the second (26 HP) a wider, heavier one. Pulses come from the replicated tick, so a skipped frame still draws the latest due probe once. */
export const SPLIT = { offsets: def("td.a3").hitOffsets ?? [], first: 18, second: 26, firstSize: 0.4, secondSize: 0.55, reach: def("td.a3").range, hit: 8, release: 16 } as const;
export function playSplitTide(fx: EffectsPool, c: SustainCtx): void {
  const i = duePulse(c, SPLIT.offsets);
  if (i < 0) return;
  const n = i === 0 ? SPLIT.first : SPLIT.second, span = i === 0 ? 1.4 : 2.4;
  for (let k = 0; k < n; k++) {
    const a = c.yaw + ((k + 0.5) / n - 0.5) * span, [vx, vz] = forwardOf(a);
    fx.spawn({ x: c.at.x + vx * 0.5, y: c.at.y + 0.5 + (k % 3) * 0.2, z: c.at.z + vz * 0.5, vx: vx * SPLIT.reach / 0.25, vy: 0.2, vz: vz * SPLIT.reach / 0.25, life: 0.25, size: i === 0 ? SPLIT.firstSize : SPLIT.secondSize, color: i === 0 ? AQUA : DEEP });
  }
}
export function playSplitHit(fx: EffectsPool, e: CombatEvent, at: Pos): void {
  if ((e.damage100 ?? 0) >= 2600) { for (let i = 0; i < SPLIT.release; i++) { const a = (i / SPLIT.release) * Math.PI * 2; fx.spawn({ x: at.x, y: at.y, z: at.z, vx: Math.cos(a) * 7, vy: 2 + (i % 3), vz: Math.sin(a) * 7, life: 0.45, size: 0.3, color: i % 2 ? FOAM : DEEP, gravity: 6 }); } return; }
  ring(fx, at, SPLIT.hit, 0.5, 0.25, 0.2, FOAM, 0.2, 0.8);
}

/**
 * td.a4 Riptide Pursuit: a lunge ring at the start of Active, then (ranged branch) a spray trail left behind the caster as it dashes up to 9 m.
 * The trail is drawn only while the replicated position moves, so the close branch (no travel) shows just the lunge. Capture wraps the victim; the 22/27 HP finish is a heavy release splash.
 */
export const RIPTIDE = { lunge: 8, trailPer: 4, trailEvery: 2, trailLife: 0.35, trailSize: 0.45, lungeSize: 0.35, wrap: 12, finish: 20, minStep: 0.05 } as const;
export function playRiptidePursuit(fx: EffectsPool, c: SustainCtx): void {
  const first = c.state.lastEmit < 0;
  if (first) { c.state.lastEmit = c.tick; c.state.px = c.at.x; c.state.pz = c.at.z; ring(fx, c.at, RIPTIDE.lunge, 0.6, 0.3, RIPTIDE.lungeSize, EDGE, 0.5); return; }
  const moved = Math.hypot(c.at.x - (c.state.px ?? c.at.x), c.at.z - (c.state.pz ?? c.at.z)), dx = c.at.x - (c.state.px ?? c.at.x), dz = c.at.z - (c.state.pz ?? c.at.z);
  if (moved < RIPTIDE.minStep || c.tick - c.state.lastEmit < RIPTIDE.trailEvery) return;
  const ux = dx / moved, uz = dz / moved;
  c.state.lastEmit = c.tick; c.state.px = c.at.x; c.state.pz = c.at.z;
  for (let i = 0; i < RIPTIDE.trailPer; i++) fx.spawn({ x: c.at.x - ux * 0.3, y: c.at.y + 0.3 + i * 0.25, z: c.at.z - uz * 0.3, vx: -ux * 2, vy: 0.4, vz: -uz * 2, life: RIPTIDE.trailLife, size: RIPTIDE.trailSize, color: i % 2 ? AQUA : FOAM });
}
export function playRiptideHit(fx: EffectsPool, e: CombatEvent, at: Pos): void {
  if ((e.damage100 ?? 0) >= 2200) { for (let i = 0; i < RIPTIDE.finish; i++) { const a = (i / RIPTIDE.finish) * Math.PI * 2; fx.spawn({ x: at.x, y: at.y, z: at.z, vx: Math.cos(a) * 7, vy: 2 + (i % 4), vz: Math.sin(a) * 7, life: 0.5, size: 0.32, color: i % 2 ? FOAM : DEEP, gravity: 7 }); } return; }
  ring(fx, at, RIPTIDE.wrap, 0.8, 0.5, 0.22, AQUA, 0, 0.5);
}

/** td.activate (action Awakening, 60 ticks, burst at +48): a rising blue column with a ground ring pushed out at the feet. The burst's hits (20 HP, 5 m) splash each victim. */
export const ACTIVATE = { column: 14, ring: 12, glow: 6, life: 0.9, radius: 2.4, hit: 10 } as const;
export function playTideActivate(fx: EffectsPool, at: Pos, _yaw: number, surface: Surface): void {
  for (let i = 0; i < ACTIVATE.column; i++) { const a = (i / ACTIVATE.column) * Math.PI * 4; fx.spawn({ x: at.x + Math.cos(a) * 0.7, y: at.y + 0.1 + (i / ACTIVATE.column) * 0.6, z: at.z + Math.sin(a) * 0.7, vx: -Math.sin(a) * 1.2, vy: 2.8, vz: Math.cos(a) * 1.2, life: ACTIVATE.life, size: 0.26, color: i % 2 ? AQUA : FOAM }); }
  for (let i = 0; i < ACTIVATE.ring; i++) { const a = (i / ACTIVATE.ring) * Math.PI * 2, x = at.x + Math.cos(a) * 0.5, z = at.z + Math.sin(a) * 0.5, y = surface(x, z, at.y); if (y !== null) fx.spawn({ x, y: y + 0.08, z, vx: Math.cos(a) * ACTIVATE.radius / 0.6, vy: 0, vz: Math.sin(a) * ACTIVATE.radius / 0.6, life: 0.6, size: 0.3, color: DEEP }); }
  for (let i = 0; i < ACTIVATE.glow; i++) fx.spawn({ x: at.x, y: at.y + 0.6 + i * 0.25, z: at.z, vx: 0, vy: 0.3, vz: 0, life: 0.8, size: 0.6, color: AQUA });
}
export function playTideActivateHit(fx: EffectsPool, _e: CombatEvent, at: Pos): void { ring(fx, at, ACTIVATE.hit, 0.7, 0.4, 0.26, FOAM, 0.1, 1.5); }

/** One recipe per shipped td.* ability plus the activation. Total particles per recipe stay under LOW_QUALITY_CAP (the low pool holds 200). */
export const TD_RECIPES: Readonly<Record<string, TdRecipe>> = {
  "td.b1": { ...r(1.2, false, "ribbon", BIND.loop + BIND.lead, AQUA, 2.4, 0), playActive: playCurrentBind, playHit: playBindHit, hitCount: BIND.surge },
  "td.b2": { ...r(1.1, false, "spiral", 28, DEEP, 2.2, 10), playHit: playUndertowHit, hitCount: UNDERTOW.edge + UNDERTOW.ribbon + UNDERTOW.landing },
  "td.b3": { ...r(1.1, true, "arc", CAST.lasso, AQUA, 2.2, 0), playActive: playTidalCast, playHit: playCastHit, hitCount: CAST.spray },
  "td.b4": { ...r(2, false, "ring", MIRROR.ring, FOAM, 4, 0), playActive: playMirrorCurrent, playHit: playMirrorHit, hitCount: MIRROR.flare },
  "td.a1": { ...r(1.3, false, "ribbon", CHAIN.links * CHAIN.per, DEEP, 2.5, 0), playActive: playCascadeChain, playHit: playChainHit, hitCount: CHAIN.burst },
  "td.a2": { ...r(2, false, "spiral", DEEPFALL.dive, DEEP, 4, 0), playActive: (fx, at) => playDeepfallCast(fx, at), playHit: playDeepfallHit, hitCount: DEEPFALL.ring + DEEPFALL.crash },
  "td.a3": { ...r(1.5, false, "arc", 0, AQUA, 3, 0), sustain: playSplitTide, sustainPeak: SPLIT.first + SPLIT.second, playHit: playSplitHit, hitCount: SPLIT.release },
  "td.a4": { ...r(1, true, "ribbon", 0, AQUA, 9, 0), sustain: playRiptidePursuit, sustainPeak: RIPTIDE.lunge + RIPTIDE.trailPer * 12, playHit: playRiptideHit, hitCount: RIPTIDE.finish },
  /** Awakening (action "Awakening", moveId td.activate): played once from the replicated action start. */
  "td.activate": { ...r(1, false, "ring", ACTIVATE.column + ACTIVATE.ring + ACTIVATE.glow, AQUA, 2.4, 0), playActive: playTideActivate, playHit: playTideActivateHit, hitCount: ACTIVATE.hit },
};

export const recipeFor = (moveId: string | undefined): TdRecipe | undefined => (moveId ? TD_RECIPES[moveId] : undefined);

/** Ground decal radius from the ability definition's shape; used by tests to keep recipes honest. */
export function shapeRadius(moveId: string): number | undefined {
  const s = TD_DEFS.find((d) => d.id === moveId)?.shape;
  if (!s) return undefined;
  return s.kind === "sphere" ? s.r : s.kind === "box" ? s.w / 2 : s.radius;
}

export function scanPlayers(fx: EffectsPool, players: Map<string, unknown>, seen: Map<string, string>): void {
  scanWith(fx, players, seen, recipeFor);
}

export function onHit(fx: EffectsPool, e: CombatEvent, chest: (id: string) => Pos | undefined): void {
  onHitWith(fx, e, chest, recipeFor);
}

const baseFx = makeKitFx(recipeFor);

/**
 * Kit-owned bus extras on top of the shared attach:
 *  - `capture` events (the server reports a capture with kind "capture", damage 0) play the move's hit cue as a 0 damage hit,
 *    except td.b2 whose first-hit ribbon logic already runs on its damaging first `hit`;
 *  - a confirmed `counter` whose target is currently standing in Mirror Current flares the mirror at that fighter.
 */
export const TdFx = {
  attach(bus: CombatBus, deps: PresentationDeps): () => void {
    const fx = deps.effects;
    const offBase = baseFx.attach(bus, deps);
    if (!fx) return offBase;
    const chest = (id: string): Pos | undefined => {
      const p = deps.players().get(id) as Pos | undefined;
      return p ? { x: p.x / 100, y: p.y / 100 + 0.3, z: p.z / 100 } : undefined;
    };
    const off = bus.on((e) => { onTdEvent(fx, e, chest, (id) => deps.players().get(id) as { action?: string; moveId?: string } | undefined); });
    return () => { off(); offBase(); };
  },
};

/** Exported for tests: capture mapping and counter flare. */
export function onTdEvent(fx: EffectsPool, e: CombatEvent, chest: (id: string) => Pos | undefined, who: (id: string) => { action?: string; moveId?: string } | undefined): void {
  if (e.kind === "capture") {
    if (e.moveId === "td.b2") return;
    onHit(fx, { ...e, kind: "hit", damage100: 0 }, chest);
    return;
  }
  if (e.kind === "counter" && e.targetId) {
    const p = who(e.targetId);
    const at = chest(e.targetId);
    if (p?.moveId === "td.b4" && p.action === "Active" && at) playMirrorFlare(fx, at);
  }
}
