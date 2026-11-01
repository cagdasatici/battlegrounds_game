import type { CombatEvent } from "@eb/shared/protocol";
import { TD_DEFS } from "@eb/shared/config/kits/index";
import type { CombatBus } from "../../app/CombatBus.js";
import type { EffectsPool } from "../../scene/EffectsPool.js";
import type { PresentationDeps } from "../index.js";

/**
 * Tide Duelist ability effects (FX4-td). Water language: ribbon arcs, spirals and rising droplets. Windup telegraphs key
 * on the replicated action Windup + moveId, active effects on Active, impacts on a bus `hit` with the moveId. All
 * particles come from the FX1 pool and expire by themselves. Presentation only; nothing reads or feeds the simulation.
 */

export type ActiveStyle = "ribbon" | "spiral" | "arc" | "ring";
export interface TdRecipe {
  /** Windup telegraph: ground decal ring (metres from the ability shape) and a charging glow at the hand. Never quality scaled. */
  windup: { decalRadius: number; color: number; glow: boolean };
  active: { style: ActiveStyle; count: number; color: number; life: number; reach: number };
  impact: { count: number; color: number; life: number; speed: number };
}

const AQUA = 0x37c8ff, DEEP = 0x1f6fff, FOAM = 0xd8f6ff;
const r = (decalRadius: number, glow: boolean, style: ActiveStyle, count: number, color: number, reach: number, impact: number): TdRecipe => ({
  windup: { decalRadius, color: AQUA, glow },
  active: { style, count, color, life: 0.4, reach },
  impact: { count: impact, color: FOAM, life: 0.3, speed: 4 },
});

/** One recipe per shipped td.* ability. Total particles per recipe stay under LOW_QUALITY_CAP (the low pool holds 200). */
export const TD_RECIPES: Readonly<Record<string, TdRecipe>> = {
  "td.b1": r(1.2, false, "ribbon", 24, AQUA, 2.4, 8),
  "td.b2": r(1.1, false, "spiral", 28, DEEP, 2.2, 10),
  "td.b3": r(1.1, true, "arc", 20, AQUA, 2.2, 12),
  "td.b4": r(2, false, "ring", 24, FOAM, 4, 12),
  "td.a1": r(1.3, false, "ribbon", 30, DEEP, 2.5, 8),
  "td.a2": r(2, false, "spiral", 36, DEEP, 4, 20),
  "td.a3": r(1.5, false, "arc", 28, AQUA, 3, 14),
  "td.a4": r(1, true, "ribbon", 30, AQUA, 9, 12),
};

export const LOW_QUALITY_CAP = 100;
const DECAL_PARTS = 12, GLOW_PARTS = 6;

/** Particles one recipe can spawn across windup, active and impact. */
export const recipeParticles = (t: TdRecipe): number => DECAL_PARTS + (t.windup.glow ? GLOW_PARTS : 0) + t.active.count + t.impact.count;

export const recipeFor = (moveId: string | undefined): TdRecipe | undefined => (moveId ? TD_RECIPES[moveId] : undefined);

/** Ground decal radius from the ability definition's shape; used by tests to keep recipes honest. */
export function shapeRadius(moveId: string): number | undefined {
  const s = TD_DEFS.find((d) => d.id === moveId)?.shape;
  if (!s) return undefined;
  return s.kind === "sphere" ? s.r : s.kind === "box" ? s.w / 2 : s.radius;
}

type Pos = { x: number; y: number; z: number };

export function playWindup(fx: EffectsPool, t: TdRecipe, at: Pos, yaw: number): void {
  const R = t.windup.decalRadius;
  for (let i = 0; i < DECAL_PARTS; i++) {
    const a = (i / DECAL_PARTS) * Math.PI * 2;
    fx.spawn({ x: at.x + Math.cos(a) * R, y: at.y + 0.05, z: at.z + Math.sin(a) * R, vx: 0, vy: 0, vz: 0, life: 0.5, size: 0.14, color: t.windup.color });
  }
  if (t.windup.glow) {
    for (let i = 0; i < GLOW_PARTS; i++) {
      fx.spawn({ x: at.x + Math.sin(yaw) * 0.5, y: at.y + 1.1 + i * 0.03, z: at.z + Math.cos(yaw) * 0.5, vx: 0, vy: 0.2, vz: 0, life: 0.4, size: 0.18, color: t.windup.color });
    }
  }
}

export function playActive(fx: EffectsPool, t: TdRecipe, at: Pos, yaw: number): void {
  const { style, count, color, life, reach } = t.active;
  const fx0 = Math.sin(yaw), fz0 = Math.cos(yaw);
  for (let i = 0; i < count; i++) {
    const k = i / count;
    if (style === "ring") {
      const a = k * Math.PI * 2;
      fx.spawn({ x: at.x, y: at.y + 0.2, z: at.z, vx: Math.cos(a) * reach / life, vy: 0, vz: Math.sin(a) * reach / life, life, size: 0.16, color });
    } else if (style === "spiral") {
      const a = k * Math.PI * 4;
      fx.spawn({ x: at.x + Math.cos(a) * 0.6, y: at.y + 0.2 + k * 1.6, z: at.z + Math.sin(a) * 0.6, vx: -Math.sin(a) * 2, vy: 0.5, vz: Math.cos(a) * 2, life, size: 0.15, color });
    } else {
      // ribbon: forward stream; arc: same stream bowed sideways.
      const side = style === "arc" ? Math.sin(k * Math.PI) * 0.8 : 0;
      fx.spawn({ x: at.x + fx0 * k * reach + fz0 * side, y: at.y + 1 + (style === "arc" ? 0.3 * Math.sin(k * Math.PI) : 0), z: at.z + fz0 * k * reach - fx0 * side, vx: fx0, vy: 0, vz: fz0, life, size: 0.14, color });
    }
  }
}

export function playImpact(fx: EffectsPool, t: TdRecipe, at: Pos): void {
  const { count, color, life, speed } = t.impact;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    fx.spawn({ x: at.x, y: at.y, z: at.z, vx: Math.cos(a) * speed, vy: 1.5, vz: Math.sin(a) * speed, life, size: 0.12, color, gravity: 6 });
  }
}

interface PlayerLike { x: number; y: number; z: number; facingYaw?: number; action?: string; moveId?: string; actionStartTick?: number; kitId?: string }

/**
 * Scans replicated players once and fires windup/active effects exactly once per action start. `seen` maps entity id to
 * the last triggered "<action>:<moveId>:<startTick>" key. Exported so tests can drive it without a frame loop.
 */
export function scanPlayers(fx: EffectsPool, players: Map<string, unknown>, seen: Map<string, string>): void {
  const live = new Set<string>();
  for (const [id, v] of players) {
    live.add(id);
    const p = v as PlayerLike;
    if (p.action !== "Windup" && p.action !== "Active") { seen.delete(id); continue; }
    const t = recipeFor(p.moveId);
    if (!t) continue;
    const key = `${p.action}:${p.moveId}:${p.actionStartTick ?? 0}`;
    if (seen.get(id) === key) continue;
    seen.set(id, key);
    const at = { x: p.x / 100, y: p.y / 100, z: p.z / 100 };
    const yaw = ((p.facingYaw ?? 0) / 1024) * Math.PI * 2;
    if (p.action === "Windup") playWindup(fx, t, at, yaw); else playActive(fx, t, at, yaw);
  }
  for (const id of [...seen.keys()]) if (!live.has(id)) seen.delete(id);
}

export function onHit(fx: EffectsPool, e: CombatEvent, chest: (id: string) => Pos | undefined): void {
  if (e.kind !== "hit") return;
  const t = recipeFor(e.moveId);
  const at = e.position ?? chest(e.targetId ?? e.actorId);
  if (t && at) playImpact(fx, t, at);
}

export const TdFx = {
  attach(bus: CombatBus, deps: PresentationDeps): () => void {
    const fx = deps.effects;
    if (!fx) return () => {};
    const chest = (id: string): Pos | undefined => {
      const p = deps.players().get(id) as Pos | undefined;
      return p ? { x: p.x / 100, y: p.y / 100 + 0.3, z: p.z / 100 } : undefined;
    };
    const off = bus.on((e) => { onHit(fx, e, chest); });
    const seen = new Map<string, string>();
    let raf = 0, alive = true;
    const frame = (): void => {
      if (!alive) return;
      scanPlayers(fx, deps.players(), seen);
      raf = requestAnimationFrame(frame);
    };
    if (typeof requestAnimationFrame === "function") raf = requestAnimationFrame(frame);
    return () => {
      alive = false;
      if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(raf);
      off();
      seen.clear();
    };
  },
};
