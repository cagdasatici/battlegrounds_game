import type { CombatEvent } from "@eb/shared/protocol";
import type { CombatBus } from "../../app/CombatBus.js";
import type { EffectsPool } from "../../scene/EffectsPool.js";
import type { PresentationDeps } from "../index.js";

/**
 * Shared machinery for the per-kit ability effects (FX4-sv, FX4-td, FX4-ea). A kit supplies a recipe table; this module
 * turns replicated action phases and bus hits into pooled FX1 particles. Presentation only; nothing reads or feeds the
 * simulation. Every particle expires by itself.
 */

/** ribbon/spiral/arc/ring: water. fan/fracture: stone. heat: ember rings with rising particles. */
export type ActiveStyle = "ribbon" | "spiral" | "arc" | "ring" | "fan" | "fracture" | "heat";
export interface Recipe {
  /** Windup telegraph: ground decal ring (metres, from the ability shape) and a charging glow at the hand. Never quality scaled. */
  windup: { decalRadius: number; color: number; glow: boolean };
  active: { style: ActiveStyle; count: number; color: number; life: number; reach: number };
  impact: { count: number; color: number; life: number; speed: number };
}

export const LOW_QUALITY_CAP = 100;
export const DECAL_PARTS = 12, GLOW_PARTS = 6;

/** Particles one recipe can spawn across windup, active and impact. */
export const recipeParticles = (t: Recipe): number => DECAL_PARTS + (t.windup.glow ? GLOW_PARTS : 0) + t.active.count + t.impact.count;

/** Ground decal radius from an ability definition's shape, clamped so huge boxes still draw a readable ring. */
export function decalRadiusFor(defs: readonly { id: string; shape: { kind: string; r?: number; w?: number; radius?: number } }[], moveId: string): number {
  const s = defs.find((d) => d.id === moveId)?.shape;
  const raw = !s ? 1 : s.kind === "sphere" ? s.r ?? 1 : s.kind === "box" ? (s.w ?? 2) / 2 : s.radius ?? 1;
  return Math.min(10, Math.max(1, raw));
}

export type Pos = { x: number; y: number; z: number };

export function playWindup(fx: EffectsPool, t: Recipe, at: Pos, yaw: number): void {
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

export function playActive(fx: EffectsPool, t: Recipe, at: Pos, yaw: number): void {
  const { style, count, color, life, reach } = t.active;
  const fx0 = Math.sin(yaw), fz0 = Math.cos(yaw);
  for (let i = 0; i < count; i++) {
    const k = i / count;
    if (style === "ring" || style === "heat") {
      const a = k * Math.PI * 2;
      fx.spawn({ x: at.x, y: at.y + 0.2, z: at.z, vx: Math.cos(a) * reach / life, vy: style === "heat" ? 1.6 : 0, vz: Math.sin(a) * reach / life, life, size: 0.16, color });
    } else if (style === "spiral") {
      const a = k * Math.PI * 4;
      fx.spawn({ x: at.x + Math.cos(a) * 0.6, y: at.y + 0.2 + k * 1.6, z: at.z + Math.sin(a) * 0.6, vx: -Math.sin(a) * 2, vy: 0.5, vz: Math.cos(a) * 2, life, size: 0.15, color });
    } else if (style === "fan") {
      // Stone fan: a wedge of chips thrown forward.
      const a = yaw + (k - 0.5) * 1.2;
      fx.spawn({ x: at.x, y: at.y + 0.6, z: at.z, vx: Math.sin(a) * reach / life, vy: 0.6, vz: Math.cos(a) * reach / life, life, size: 0.18, color, gravity: 4 });
    } else if (style === "fracture") {
      // Circular fracture: 8 radial cracks on the ground, several chips per crack at increasing radius.
      const spoke = i % 8, ringIdx = Math.floor(i / 8), rings = Math.ceil(count / 8);
      const a = (spoke / 8) * Math.PI * 2, rad = (reach * (ringIdx + 1)) / rings;
      fx.spawn({ x: at.x + Math.cos(a) * rad, y: at.y + 0.08, z: at.z + Math.sin(a) * rad, vx: 0, vy: 0.3, vz: 0, life, size: 0.2, color });
    } else {
      // ribbon: forward stream; arc: same stream bowed sideways.
      const side = style === "arc" ? Math.sin(k * Math.PI) * 0.8 : 0;
      fx.spawn({ x: at.x + fx0 * k * reach + fz0 * side, y: at.y + 1 + (style === "arc" ? 0.3 * Math.sin(k * Math.PI) : 0), z: at.z + fz0 * k * reach - fx0 * side, vx: fx0, vy: 0, vz: fz0, life, size: 0.14, color });
    }
  }
}

export function playImpact(fx: EffectsPool, t: Recipe, at: Pos): void {
  const { count, color, life, speed } = t.impact;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    fx.spawn({ x: at.x, y: at.y, z: at.z, vx: Math.cos(a) * speed, vy: 1.5, vz: Math.sin(a) * speed, life, size: 0.12, color, gravity: 6 });
  }
}

interface PlayerLike { x: number; y: number; z: number; facingYaw?: number; action?: string; moveId?: string; actionStartTick?: number }

/**
 * Scans replicated players once and fires windup/active effects exactly once per action start. `seen` maps entity id to
 * the last triggered "<action>:<moveId>:<startTick>" key. Exported through each kit so tests can drive it without a frame loop.
 */
export function scanPlayers(fx: EffectsPool, players: Map<string, unknown>, seen: Map<string, string>, recipeFor: (moveId: string | undefined) => Recipe | undefined): void {
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

export function onHit(fx: EffectsPool, e: CombatEvent, chest: (id: string) => Pos | undefined, recipeFor: (moveId: string | undefined) => Recipe | undefined): void {
  if (e.kind !== "hit") return;
  const t = recipeFor(e.moveId);
  const at = e.position ?? chest(e.targetId ?? e.actorId);
  if (t && at) playImpact(fx, t, at);
}

/** Builds a kit's `attach`: bus hit impacts plus a per-frame scan for windup and active. The disposer cancels both. */
export function makeKitFx(recipeFor: (moveId: string | undefined) => Recipe | undefined): { attach(bus: CombatBus, deps: PresentationDeps): () => void } {
  return {
    attach(bus, deps) {
      const fx = deps.effects;
      if (!fx) return () => {};
      const chest = (id: string): Pos | undefined => {
        const p = deps.players().get(id) as Pos | undefined;
        return p ? { x: p.x / 100, y: p.y / 100 + 0.3, z: p.z / 100 } : undefined;
      };
      const off = bus.on((e) => { onHit(fx, e, chest, recipeFor); });
      const seen = new Map<string, string>();
      let raf = 0, alive = true;
      const frame = (): void => {
        if (!alive) return;
        scanPlayers(fx, deps.players(), seen, recipeFor);
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
}
