import type { CombatEvent } from "@eb/shared/protocol";
import type { CombatBus } from "../app/CombatBus.js";
import type { EffectsPool } from "../scene/EffectsPool.js";
import type { PresentationDeps } from "./index.js";

/**
 * Hit impact effects (FX1, decision 0024). Every confirmed contact reads differently per outcome: sparks, rings, shield
 * arcs, heal motes and KO dust come from the pooled particle mesh, plus a victim flash, hitstop and camera shake.
 * Driven only by bus events (confirmed by the server), never by predicted local input. Presentation only.
 */

export interface Burst { count: number; color: number; life: number; speed: number; size: number }
export interface HitFxPlan {
  burst?: Burst;
  /** Flat expanding ring of particles on the ground plane, radius in metres. */
  ring?: { color: number; radius: number; life: number };
  /** Cyan arc in front of the victim, facing the attacker. */
  shield?: { color: number; life: number };
  motes?: { count: number; color: number; life: number; rise: number };
  ko?: boolean;
  flash?: { who: "target" | "actor"; color: number; ms: number };
  /** Hitstop frames applied to both fighters. */
  freeze?: number;
  /** Shake amplitude (metres before the shake scale) and duration; applied only when the local player is involved. */
  shake?: { amplitude: number; ms: number };
}

const RED = 0xff3b3b, GOLD = 0xffcc33, GREEN = 0x4dff88;

/** Pure table from a confirmed event to its effect plan; null for kinds with no impact effect. */
export function planFor(e: Pick<CombatEvent, "kind" | "hitClass">): HitFxPlan | null {
  switch (e.kind) {
    case "hit":
      return e.hitClass === "heavy"
        ? { burst: { count: 24, color: 0xff6a2a, life: 0.35, speed: 5, size: 0.14 }, ring: { color: 0xff6a2a, radius: 1.2, life: 0.35 },
            flash: { who: "target", color: RED, ms: 140 }, freeze: 4, shake: { amplitude: 0.35, ms: 180 } }
        : { burst: { count: 10, color: 0xffd9a0, life: 0.25, speed: 4, size: 0.1 }, flash: { who: "target", color: RED, ms: 90 } };
    case "block":
      return { shield: { color: 0x5fd8ff, life: 0.2 }, shake: { amplitude: 0.1, ms: 80 } };
    case "counter":
      return { burst: { count: 16, color: GOLD, life: 0.3, speed: 5, size: 0.12 }, ring: { color: GOLD, radius: 1.2, life: 0.3 },
        flash: { who: "actor", color: GOLD, ms: 160 }, freeze: 6 };
    case "heal":
      return { motes: { count: 12, color: GREEN, life: 0.6, rise: 1 }, flash: { who: "target", color: GREEN, ms: 200 } };
    case "ko":
      return { ko: true };
    default:
      return null;
  }
}

export interface HitFxIo {
  effects: EffectsPool;
  fighterOf(id: string): { flash(color: number, ms: number, level?: number): void; freeze(frames: number): void } | undefined;
  /** Chest position fallback in metres for an entity when the event carries no position. */
  chestOf(id: string): { x: number; y: number; z: number } | undefined;
  shake(amplitude: number, ms: number): void;
  flashLevel(): number;
  localId(): string | undefined;
}

const rnd = (a: number, b: number): number => a + Math.random() * (b - a);

/** Plays one event. Exported so unit tests can drive it without a scene. */
export function playHit(e: CombatEvent, io: HitFxIo): void {
  const plan = planFor(e);
  if (!plan) return;
  const victim = e.targetId ?? e.actorId;
  const chest = io.chestOf(victim);
  const o = e.position ?? (chest ? { x: chest.x, y: chest.y + 0.3, z: chest.z } : undefined);
  if (!o) return;
  const fx = io.effects;

  const b = plan.burst;
  if (b) {
    for (let i = 0; i < b.count; i++) {
      const th = rnd(0, Math.PI * 2), ph = rnd(-0.3, 1);
      const s = b.speed * rnd(0.5, 1), c = Math.sqrt(1 - ph * ph);
      fx.spawn({ x: o.x, y: o.y, z: o.z, vx: Math.cos(th) * c * s, vy: ph * s, vz: Math.sin(th) * c * s, life: b.life, size: b.size, color: b.color, gravity: 6 });
    }
  }
  if (plan.ring) {
    const n = 16, speed = plan.ring.radius / plan.ring.life;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      fx.spawn({ x: o.x, y: o.y, z: o.z, vx: Math.cos(a) * speed, vy: 0, vz: Math.sin(a) * speed, life: plan.ring.life, size: 0.16, color: plan.ring.color });
    }
  }
  if (plan.shield) {
    // Arc of 7 particles in front of the victim, centred on the direction toward the attacker.
    const at = io.chestOf(e.actorId);
    const base = at ? Math.atan2(at.z - o.z, at.x - o.x) : 0;
    for (let i = 0; i < 7; i++) {
      const a = base + ((i - 3) / 3) * 0.9;
      fx.spawn({ x: o.x + Math.cos(a) * 0.9, y: o.y + ((i % 2) * 0.2 - 0.1), z: o.z + Math.sin(a) * 0.9, vx: 0, vy: 0, vz: 0, life: plan.shield.life, size: 0.2, color: plan.shield.color });
    }
  }
  if (plan.motes) {
    const m = plan.motes;
    for (let i = 0; i < m.count; i++) {
      fx.spawn({ x: o.x + rnd(-0.4, 0.4), y: o.y - 0.3, z: o.z + rnd(-0.4, 0.4), vx: 0, vy: m.rise / m.life, vz: 0, life: m.life, size: 0.1, color: m.color });
    }
  }
  if (plan.ko) {
    for (let i = 0; i < 14; i++) {
      const a = rnd(0, Math.PI * 2);
      fx.spawn({ x: o.x, y: o.y - 0.5, z: o.z, vx: Math.cos(a) * 1.2, vy: rnd(0.2, 0.8), vz: Math.sin(a) * 1.2, life: 0.6, size: 0.3, color: 0xd8cdb8 });
    }
    for (let i = 0; i < 8; i++) fx.spawn({ x: o.x, y: o.y - 0.5 + i * 0.35, z: o.z, vx: 0, vy: 0.3, vz: 0, life: 0.5, size: 0.35, color: 0xfff3b0 });
  }

  if (plan.flash) {
    io.fighterOf(plan.flash.who === "target" ? victim : e.actorId)?.flash(plan.flash.color, plan.flash.ms, io.flashLevel());
  }
  if (plan.freeze) {
    io.fighterOf(victim)?.freeze(plan.freeze);
    io.fighterOf(e.actorId)?.freeze(plan.freeze);
  }
  const me = io.localId();
  if (plan.shake && me !== undefined && (e.actorId === me || e.targetId === me)) io.shake(plan.shake.amplitude, plan.shake.ms);
}

export const HitFx = {
  attach(bus: CombatBus, deps: PresentationDeps): () => void {
    const effects = deps.effects;
    if (!effects) return () => {};
    const io: HitFxIo = {
      effects,
      fighterOf: (id) => deps.fighters?.(id),
      chestOf: (id) => {
        const p = deps.players().get(id) as { x: number; y: number; z: number } | undefined;
        return p ? { x: p.x / 100, y: p.y / 100, z: p.z / 100 } : undefined;
      },
      shake: (a, ms) => { deps.shake?.(a, ms); },
      flashLevel: () => {
        const v = (deps.settings.get() as { flashLevel?: unknown } | undefined)?.flashLevel;
        return typeof v === "number" ? v : 0.3;
      },
      localId: deps.localId,
    };
    return bus.on((e) => { playHit(e, io); });
  },
};
