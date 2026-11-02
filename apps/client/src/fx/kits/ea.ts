import { forwardOf } from "@eb/shared/math";
import { EA_DEFS } from "@eb/shared/config/kits/index";
import type { EffectsPool } from "../../scene/EffectsPool.js";
import type { CombatEvent } from "@eb/shared/protocol";
import type { CombatBus } from "../../app/CombatBus.js";
import type { PresentationDeps } from "../index.js";
import { beamGen, beamStation, decalRadiusFor, frameOf, makeKitFx, type SustainCtx, onHit as onHitWith, scanPlayers as scanWith, type ActiveStyle, type Pos, type Recipe } from "./common.js";

/**
 * Ember Artificer ability effects (FX4-ea). Heat language: expanding rings, rising heat particles and ember streams.
 * Windup telegraphs key on the replicated action Windup + moveId, active effects on Active, impacts on a bus `hit` with
 * the moveId. Presentation only; all particles come from the FX1 pool and expire by themselves.
 */

export type EaRecipe = Recipe;

const EMBER = 0xff7a1a, GOLD = 0xffc04d, RED = 0xff3d00;
const r = (id: string, glow: boolean, style: ActiveStyle, count: number, color: number, reach: number, impact: number): EaRecipe => ({
  windup: { decalRadius: decalRadiusFor(EA_DEFS, id), color: EMBER, glow },
  active: { style, count, color, life: 0.5, reach },
  impact: { count: impact, color: GOLD, life: 0.35, speed: 3.5 },
});

/**
 * QV05 Furnace Ray (ea.a3). While the replicated action is Active, a thin bright core inside a tapering orange sheath is
 * redrawn every EMIT_TICKS along the current aim, ending at the first cover (the client's cover query, same as the
 * warning). It stops the frame the replicated action leaves Active (interruption, death) or the server tick reaches the
 * active end; leftover particles live at most BEAM_LIFE seconds. A brighter flare marks each pulse tick
 * (activeStart + hitOffsets[i], the server's schedule). Presentation only: no damage, no timers, just particle life.
 */
const RAY = EA_DEFS.find((d) => d.id === "ea.a3")!;
const RAY_LEN = RAY.shape.kind === "beam" ? RAY.shape.length : 24;
export const FURNACE = { emitTicks: 4, life: 0.12, core: 20, sheath: 8, coreSize: 0.9, sheathSize: 0.8, grow: 0.5, flare: 6, flareLife: 0.25, originForward: 0.6, originUp: 0.4, pulses: RAY.hitOffsets, length: RAY_LEN } as const;
const CORE = 0xfff1b0, SHEATH = 0xff7a1a;
export function playFurnaceRay(fx: EffectsPool, c: SustainCtx): void {
  const [dx, dz] = forwardOf(c.yaw);
  const ox = c.at.x + dx * FURNACE.originForward, oz = c.at.z + dz * FURNACE.originForward, oy = c.at.y + 1;
  const len = c.cover ? Math.min(FURNACE.length, c.cover(ox, oy - 1 + FURNACE.originUp, oz, dx, dz, FURNACE.length)) : FURNACE.length;
  if (len <= 0) return;
  const px = -dz, pz = dx;
  const due = FURNACE.pulses.findIndex((o, i) => i > c.state.lastPulse && c.startTick + o <= c.tick);
  if (due >= 0) { // flare for the newest pulse due; the pulse index is remembered so each fires once
    let last = due;
    for (let i = due; i < FURNACE.pulses.length && c.startTick + FURNACE.pulses[i]! <= c.tick; i++) last = i;
    c.state.lastPulse = last;
    for (let i = 0; i < FURNACE.flare; i++) {
      const d = ((i + 0.5) / FURNACE.flare) * len;
      fx.spawn({ x: ox + dx * d, y: oy, z: oz + dz * d, vx: 0, vy: 0.8, vz: 0, life: FURNACE.flareLife, size: 0.9, color: GOLD, essential: true });
    }
  }
  if (c.state.lastEmit >= 0 && c.tick - c.state.lastEmit < FURNACE.emitTicks) return;
  c.state.lastEmit = c.tick;
  // QV09: one continuous bright core (interleaved generations), with a thin tapering orange rim hugging it.
  const gen = beamGen(c.state);
  for (let i = 0; i < FURNACE.core; i++) {
    const d = beamStation(i, FURNACE.core, len, gen);
    fx.spawn({ x: ox + dx * d, y: oy, z: oz + dz * d, vx: 0, vy: 0, vz: 0, life: FURNACE.life, size: FURNACE.coreSize * (1 + FURNACE.grow * d / len), color: CORE, essential: true }); // grows with distance so the far end still reads
  }
  for (let i = 0; i < FURNACE.sheath; i++) {
    const d = beamStation(i, FURNACE.sheath, len, gen), k = d / len, half = 0.55 * (1 - k) + 0.2, side = i % 2 === 0 ? half : -half; // tapers with distance
    fx.spawn({ x: ox + dx * d + px * side, y: oy, z: oz + dz * d + pz * side, vx: 0, vy: 0, vz: 0, life: FURNACE.life, size: FURNACE.sheathSize, color: SHEATH, essential: true });
  }
}

/**
 * QV08: per-move Ember Artificer cues. Heat language: ember bursts, blast rings and rising heat. Presentation only: pooled
 * particles that expire by themselves. Origin, facing and extents come from the replicated pose and the ability definition;
 * confirmed `hit`/`capture` events add the victim-bound layers (damage tiers are the definitions' numbers). Misses and blocks
 * emit nothing. Endpoints of b2/b4/a1/a2 are not replicated (QV02), so travel is drawn from the caster along its aim and
 * blasts only where a confirmed hit reports a position.
 */
const def = (id: string) => EA_DEFS.find((d) => d.id === id)!;
type Surface = (x: number, z: number, y: number) => number | null;
const burst = (fx: EffectsPool, at: Pos, n: number, speed: number, life: number, size: number, up: number, c1: number, c2: number, y = 0): void => {
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; fx.spawn({ x: at.x, y: at.y + y, z: at.z, vx: Math.cos(a) * speed, vy: up + (i % 3) * 0.5, vz: Math.sin(a) * speed, life, size, color: i % 2 ? c1 : c2, gravity: 6 }); }
};
const streak = (fx: EffectsPool, at: Pos, yaw: number, n: number, speed: number, life: number, size: number, c1: number, c2: number, y = 0.8): void => {
  const f = frameOf(at, yaw);
  for (let i = 0; i < n; i++) { const side = ((i % 3) - 1) * 0.25; fx.spawn({ x: at.x + f.dx * 0.4 + f.px * side, y: at.y + y + (i % 2) * 0.2, z: at.z + f.dz * 0.4 + f.pz * side, vx: f.dx * speed, vy: 0, vz: f.dz * speed, life, size, color: i % 2 ? c1 : c2 }); }
};

/** ea.b1 Cinder Array: an ember burst aimed into the real 2.5 m range; each of the six strikes sparks the victim, the 10 HP finisher bursts. */
export const CINDER = { burst: 18, reach: def("ea.b1").range, spark: 6, finish: 16 } as const;
export function playCinderArray(fx: EffectsPool, at: Pos, yaw: number): void {
  const f = frameOf(at, yaw);
  for (let i = 0; i < CINDER.burst; i++) {
    const k = (i + 0.5) / CINDER.burst, lat = (k - 0.5) * 1.6 * k, d = k * CINDER.reach;
    fx.spawn({ x: at.x + f.dx * d + f.px * lat, y: at.y + 0.9 + (i % 3) * 0.12, z: at.z + f.dz * d + f.pz * lat, vx: f.dx * 2, vy: 0.2, vz: f.dz * 2, life: 0.25, size: 0.2, color: i % 2 ? GOLD : EMBER });
  }
}
export function playCinderHit(fx: EffectsPool, e: CombatEvent, at: Pos): void {
  burst(fx, at, (e.damage100 ?? 0) >= 1000 ? CINDER.finish : CINDER.spark, (e.damage100 ?? 0) >= 1000 ? 6 : 3, 0.3, 0.2, 1, GOLD, EMBER);
}

/** ea.b2 Vent Rush: a forward ember streak over the 8 m travel; the 15 HP front blast (24 on a ragdoll) is a ring at the victim, the 10 HP rear blast a duller backwards puff. */
export const VENT = { streak: 14, travelM: 8, travelSec: 0.4, front: 14, rear: 10, blastR: 2.5 } as const;
export function playVentRush(fx: EffectsPool, at: Pos, yaw: number): void { streak(fx, at, yaw, VENT.streak, VENT.travelM / VENT.travelSec, VENT.travelSec, 0.3, EMBER, GOLD); }
export function playVentHit(fx: EffectsPool, e: CombatEvent, at: Pos, actorAt: Pos | undefined): void {
  if ((e.damage100 ?? 0) >= 1500) { burst(fx, at, VENT.front, VENT.blastR / 0.3, 0.3, 0.34, 0.8, RED, GOLD); return; }
  const base = actorAt ? Math.atan2(at.x - actorAt.x, at.z - actorAt.z) : 0; // rear blast: away from the rush direction
  for (let i = 0; i < VENT.rear; i++) { const a = base + Math.PI + ((i + 0.5) / VENT.rear - 0.5) * 1.8; fx.spawn({ x: at.x, y: at.y, z: at.z, vx: Math.sin(a) * 5, vy: 1 + (i % 3) * 0.4, vz: Math.cos(a) * 5, life: 0.3, size: 0.26, color: i % 2 ? EMBER : RED }); }
}

/** ea.b3 Ember Orb: windup keeps the charging glow; the release is a muzzle flare. The orb itself is the persistent ORB2 projectile (unchanged). Splash ring at the 2 m radius; the 25 HP full charge is bigger. */
export const ORB = { muzzle: 10, splash: 10, full: 16, splashR: 2 } as const;
export function playOrbRelease(fx: EffectsPool, at: Pos, yaw: number): void {
  const f = frameOf(at, yaw);
  for (let i = 0; i < ORB.muzzle; i++) { const a = (i / ORB.muzzle) * Math.PI * 2; fx.spawn({ x: at.x + f.dx * 0.6, y: at.y + 1.1 + Math.sin(a) * 0.25, z: at.z + f.dz * 0.6, vx: f.dx * 3 + f.px * Math.cos(a) * 2, vy: Math.sin(a) * 1.5, vz: f.dz * 3 + f.pz * Math.cos(a) * 2, life: 0.25, size: 0.24, color: i % 2 ? GOLD : EMBER }); }
}
export function playOrbHit(fx: EffectsPool, e: CombatEvent, at: Pos): void { burst(fx, at, (e.damage100 ?? 0) >= 2500 ? ORB.full : ORB.splash, ORB.splashR / 0.3, 0.3, 0.3, 0.6, GOLD, RED); }

/** ea.b4 Furnace Drop: a falling column of embers around the caster at Active start (the descent); contact with a hit victim is a 4 m shock ring plus a rising plume. A drop that finds nothing shows only the descent. */
export const DROP = { column: 14, ring: 24, plume: 8, radius: 4 } as const;
export function playFurnaceDrop(fx: EffectsPool, at: Pos): void {
  for (let i = 0; i < DROP.column; i++) { const a = (i / DROP.column) * Math.PI * 4; fx.spawn({ x: at.x + Math.cos(a) * 0.6, y: at.y + 2.6 - (i / DROP.column) * 1.4, z: at.z + Math.sin(a) * 0.6, vx: 0, vy: -9, vz: 0, life: 0.3, size: 0.3, color: i % 2 ? RED : GOLD }); }
}
export function playDropHit(fx: EffectsPool, _e: CombatEvent, at: Pos): void {
  burst(fx, at, DROP.ring, DROP.radius / 0.35, 0.35, 0.34, 0.3, RED, EMBER, -0.3);
  for (let i = 0; i < DROP.plume; i++) fx.spawn({ x: at.x, y: at.y - 0.3, z: at.z, vx: Math.cos(i) * 1.5, vy: 4 + (i % 4), vz: Math.sin(i) * 1.5, life: 0.5, size: 0.36, color: i % 2 ? GOLD : EMBER, gravity: 8 });
}

/** ea.a1 Arc Descent: a fast streak over the 8 m path. Hit tiers: 15 HP capture strike (wrap), 20 HP missed-probe blast (5 m), 13 HP interrupted blast (2 m), 25 HP release (burst). A capture event (0) wraps the victim. */
export const ARC = { streak: 16, travelM: 7.2, travelSec: 0.3, wrap: 8, blast: 24, small: 10, release: 18 } as const;
export function playArcDescent(fx: EffectsPool, at: Pos, yaw: number): void { streak(fx, at, yaw, ARC.streak, ARC.travelM / ARC.travelSec, ARC.travelSec, 0.3, RED, GOLD, 1); }
export function playArcHit(fx: EffectsPool, e: CombatEvent, at: Pos): void {
  const d = e.damage100 ?? 0;
  if (d >= 2500) burst(fx, at, ARC.release, 7, 0.45, 0.32, 2, GOLD, EMBER);
  else if (d >= 2000) burst(fx, at, ARC.blast, 5 / 0.4, 0.4, 0.34, 0.5, RED, EMBER, -0.2);
  else if (d >= 1500 || d === 0) burst(fx, at, ARC.wrap, 3, 0.4, 0.24, 0.8, EMBER, GOLD);
  else burst(fx, at, ARC.small, 2 / 0.3, 0.3, 0.26, 0.5, EMBER, RED);
}

/** ea.a2 Comet Lock: a long streak over the 16 m dash; capture locks (ring), the 50/30 HP slam is a 4 m shock, the 20 HP splash a small ring. */
export const COMET = { streak: 18, travelM: 16, travelSec: 0.4, lock: 10, slam: 24, splash: 8 } as const;
export function playCometLock(fx: EffectsPool, at: Pos, yaw: number): void { streak(fx, at, yaw, COMET.streak, COMET.travelM / COMET.travelSec, COMET.travelSec, 0.34, GOLD, RED); }
export function playCometHit(fx: EffectsPool, e: CombatEvent, at: Pos): void {
  const d = e.damage100 ?? 0;
  if (d === 0) burst(fx, at, COMET.lock, 2.5, 0.5, 0.26, 0.4, GOLD, EMBER);
  else if (d >= 3000) burst(fx, at, COMET.slam, 4 / 0.35, 0.35, 0.36, 3, RED, GOLD, -0.2);
  else burst(fx, at, COMET.splash, 3, 0.3, 0.24, 1, EMBER, GOLD);
}

/**
 * ea.a4 Solar Vent. While Active, a wide pale-gold beam (core plus a broad amber sheath for the 3 m radius) is redrawn every
 * emitTicks along the aim, ending at the first cover (client cover query, same as the warning). Pulses (10, server schedule)
 * flare. It stops when the replicated action leaves Active or the tick reaches the active end; particles live at most `life`.
 */
export const SOLAR = { emitTicks: 5, life: 0.16, core: 26, sheath: 12, coreSize: 1.0, sheathSize: 1.1, grow: 0.8, flare: 6, flareLife: 0.28, pulses: def("ea.a4").hitOffsets ?? [], length: 36, halfWidth: 0.4, hit: 6 } as const;
const WHITE = 0xfff7d6, AMBER = 0xffa526;
export function playSolarVent(fx: EffectsPool, c: SustainCtx): void {
  const [dx, dz] = forwardOf(c.yaw), px = -dz, pz = dx;
  const ox = c.at.x + dx * 0.6, oz = c.at.z + dz * 0.6, oy = c.at.y + 1;
  const len = c.cover ? Math.min(SOLAR.length, c.cover(ox, oy - 1 + 0.4, oz, dx, dz, SOLAR.length)) : SOLAR.length;
  if (len <= 0) return;
  let due = -1;
  for (let i = c.state.lastPulse + 1; i < SOLAR.pulses.length && c.startTick + SOLAR.pulses[i]! <= c.tick; i++) due = i;
  if (due >= 0) {
    c.state.lastPulse = due;
    for (let i = 0; i < SOLAR.flare; i++) { const d = ((i + 0.5) / SOLAR.flare) * len; fx.spawn({ x: ox + dx * d, y: oy, z: oz + dz * d, vx: 0, vy: 1, vz: 0, life: SOLAR.flareLife, size: 1.1, color: GOLD, essential: true }); }
  }
  if (c.state.lastEmit >= 0 && c.tick - c.state.lastEmit < SOLAR.emitTicks) return;
  c.state.lastEmit = c.tick;
  // QV09: continuous pale core (interleaved generations) with a wider amber halo hugging it, not blobs spread across the arena.
  const gen = beamGen(c.state);
  for (let i = 0; i < SOLAR.core; i++) { const d = beamStation(i, SOLAR.core, len, gen); fx.spawn({ x: ox + dx * d, y: oy, z: oz + dz * d, vx: 0, vy: 0, vz: 0, life: SOLAR.life, size: SOLAR.coreSize * (1 + SOLAR.grow * d / len), color: WHITE, essential: true }); }
  for (let i = 0; i < SOLAR.sheath; i++) {
    const d = beamStation(i, SOLAR.sheath, len, gen), side = i % 2 === 0 ? SOLAR.halfWidth : -SOLAR.halfWidth;
    fx.spawn({ x: ox + dx * d + px * side, y: oy, z: oz + dz * d + pz * side, vx: 0, vy: 0, vz: 0, life: SOLAR.life, size: SOLAR.sheathSize * (1 + SOLAR.grow * d / len), color: AMBER, essential: true });
  }
}
export function playSolarHit(fx: EffectsPool, _e: CombatEvent, at: Pos): void { burst(fx, at, SOLAR.hit, 3, 0.25, 0.22, 1, GOLD, WHITE); }

/** ea.activate (Awakening, 90 ticks, pulses +0 and +72, 16 HP, 5 m): a rising furnace column, a ground ring and a glow once; each pulse hit scorches its victim. */
export const ACTIVATE = { column: 16, ring: 12, glow: 6, life: 0.9, radius: 2.6, hit: 10 } as const;
export function playEmberActivate(fx: EffectsPool, at: Pos, _yaw: number, surface: Surface): void {
  for (let i = 0; i < ACTIVATE.column; i++) { const a = (i / ACTIVATE.column) * Math.PI * 4; fx.spawn({ x: at.x + Math.cos(a) * 0.7, y: at.y + 0.1 + (i / ACTIVATE.column) * 0.6, z: at.z + Math.sin(a) * 0.7, vx: -Math.sin(a) * 1.2, vy: 3, vz: Math.cos(a) * 1.2, life: ACTIVATE.life, size: 0.28, color: i % 2 ? GOLD : RED }); }
  for (let i = 0; i < ACTIVATE.ring; i++) { const a = (i / ACTIVATE.ring) * Math.PI * 2, x = at.x + Math.cos(a) * 0.5, z = at.z + Math.sin(a) * 0.5, y = surface(x, z, at.y); if (y !== null) fx.spawn({ x, y: y + 0.08, z, vx: Math.cos(a) * ACTIVATE.radius / 0.6, vy: 0, vz: Math.sin(a) * ACTIVATE.radius / 0.6, life: 0.6, size: 0.3, color: EMBER }); }
  for (let i = 0; i < ACTIVATE.glow; i++) fx.spawn({ x: at.x, y: at.y + 0.6 + i * 0.25, z: at.z, vx: 0, vy: 0.3, vz: 0, life: 0.8, size: 0.6, color: EMBER });
}
export function playEmberActivateHit(fx: EffectsPool, _e: CombatEvent, at: Pos): void { burst(fx, at, ACTIVATE.hit, 4, 0.4, 0.26, 1.5, GOLD, RED); }

/** One recipe per shipped ea.* ability plus the activation. Total particles per recipe stay under LOW_QUALITY_CAP (the low pool holds 200). */
export const EA_RECIPES: Readonly<Record<string, EaRecipe>> = {
  "ea.b1": { ...r("ea.b1", true, "heat", CINDER.burst, EMBER, 2.5, 0), playActive: playCinderArray, playHit: playCinderHit, hitCount: CINDER.finish },
  "ea.b2": { ...r("ea.b2", false, "heat", VENT.streak, RED, 8, 0), playActive: playVentRush, playHit: playVentHit, hitCount: VENT.front },
  "ea.b3": { ...r("ea.b3", true, "ribbon", ORB.muzzle, GOLD, 6, 0), playActive: playOrbRelease, playHit: playOrbHit, hitCount: ORB.full },
  "ea.b4": { ...r("ea.b4", false, "heat", DROP.column, EMBER, 4, 0), playActive: (fx, at) => playFurnaceDrop(fx, at), playHit: playDropHit, hitCount: DROP.ring + DROP.plume },
  "ea.a1": { ...r("ea.a1", false, "spiral", ARC.streak, RED, 7.2, 0), playActive: playArcDescent, playHit: playArcHit, hitCount: ARC.blast },
  "ea.a2": { ...r("ea.a2", true, "ring", COMET.streak, GOLD, 16, 0), playActive: playCometLock, playHit: playCometHit, hitCount: COMET.slam },
  "ea.a3": { ...r("ea.a3", true, "ribbon", 6, RED, 4, 14), sustain: playFurnaceRay, sustainPeak: (FURNACE.core + FURNACE.sheath) * 2 + FURNACE.flare },
  "ea.a4": { ...r("ea.a4", false, "heat", 0, AMBER, 36, 0), sustain: playSolarVent, sustainPeak: (SOLAR.core + SOLAR.sheath) * 2 + SOLAR.flare, playHit: playSolarHit, hitCount: SOLAR.hit },
  /** Awakening (action "Awakening", moveId ea.activate): played once from the replicated action start. */
  "ea.activate": { ...r("ea.b4", false, "heat", ACTIVATE.column + ACTIVATE.ring + ACTIVATE.glow, EMBER, 2.6, 0), playActive: playEmberActivate, playHit: playEmberActivateHit, hitCount: ACTIVATE.hit },
};

export const recipeFor = (moveId: string | undefined): EaRecipe | undefined => (moveId ? EA_RECIPES[moveId] : undefined);

export function scanPlayers(fx: EffectsPool, players: Map<string, unknown>, seen: Map<string, string>): void {
  scanWith(fx, players, seen, recipeFor);
}

export function onHit(fx: EffectsPool, e: CombatEvent, chest: (id: string) => Pos | undefined): void {
  onHitWith(fx, e, chest, recipeFor);
}

const baseFx = makeKitFx(recipeFor);

/** QV08: the server reports a capture as kind `capture` (damage 0); map it to the move's hit cue as a 0 damage hit (a1 wrap, a2 lock). */
export const EaFx = {
  attach(bus: CombatBus, deps: PresentationDeps): () => void {
    const fx = deps.effects;
    const offBase = baseFx.attach(bus, deps);
    if (!fx) return offBase;
    const chest = (id: string): Pos | undefined => {
      const p = deps.players().get(id) as Pos | undefined;
      return p ? { x: p.x / 100, y: p.y / 100 + 0.3, z: p.z / 100 } : undefined;
    };
    const off = bus.on((e) => { onEaEvent(fx, e, chest); });
    return () => { off(); offBase(); };
  },
};

/** Exported for tests: capture mapping. */
export function onEaEvent(fx: EffectsPool, e: CombatEvent, chest: (id: string) => Pos | undefined): void {
  if (e.kind === "capture") onHit(fx, { ...e, kind: "hit", damage100: 0 }, chest);
}
