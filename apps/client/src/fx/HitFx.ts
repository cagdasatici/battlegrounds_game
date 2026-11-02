import { HIT_STUN } from "@eb/shared/config/combat";
import type { CombatEvent } from "@eb/shared/protocol";
import { fromYaw } from "@eb/shared/schema";
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
  /** QV09: directional fan thrown from the victim away from the attacker (m1 strikes). Spread in radians. */
  spray?: { count: number; color: number; life: number; speed: number; size: number; spread: number };
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

/** QV09: the universal move a generic event belongs to, from its replicated move id. Kit ability ids have no variant (kit recipes override). */
export type Universal = "m1.1" | "m1.2" | "m1.3" | "m1.4" | "wall" | "pickup" | "throw";
export function universalOf(moveId: string | undefined): Universal | undefined {
  if (!moveId) return undefined;
  const m = /^m1\.([1-4])(\.|$)/.exec(moveId);
  if (m) return `m1.${m[1]}` as Universal;
  const c = /^(?:sv|td|ea)\.(wall|pickup|throw)$/.exec(moveId);
  return c ? (c[1] as Universal) : undefined;
}

const DUST = 0xb8a58c, OCHRE = 0xd9a441, PALE = 0xe8f4ff, CYAN = 0x5fd8ff;

/** Pure table from a confirmed event to its effect plan; null for kinds with no impact effect. */
export function planFor(e: Pick<CombatEvent, "kind" | "hitClass"> & { moveId?: string | undefined }): HitFxPlan | null {
  const u = universalOf(e.moveId);
  switch (e.kind) {
    case "hit": {
      const flash = { who: "target" as const, color: RED, ms: 90 };
      if (u === "wall") {
        return { burst: { count: 14, color: DUST, life: 0.4, speed: 3, size: 0.16 }, ring: { color: DUST, radius: 1.6, life: 0.4 },
          flash: { ...flash, ms: 120 }, freeze: 3, shake: { amplitude: 0.25, ms: 150 } };
      }
      if (u === "throw") {
        return { burst: { count: 12, color: OCHRE, life: 0.3, speed: 4, size: 0.13 }, ring: { color: OCHRE, radius: 1.4, life: 0.3 },
          flash: { ...flash, ms: 120 }, freeze: 3, shake: { amplitude: 0.2, ms: 120 } };
      }
      if (u === "m1.4") { // fourth hit: forward fan, ring, hitstop, shake, whether or not the finisher flag made it heavy
        return { burst: { count: 10, color: 0xff9a4a, life: 0.3, speed: 4.5, size: 0.13 }, spray: { count: 16, color: 0xffe0b0, life: 0.3, speed: 7, size: 0.11, spread: 0.7 },
          ring: { color: 0xff9a4a, radius: 1.4, life: 0.35 }, flash: { ...flash, ms: 140 }, freeze: 4, shake: { amplitude: 0.3, ms: 160 } };
      }
      if (e.hitClass === "heavy") {
        return { burst: { count: 24, color: 0xff6a2a, life: 0.35, speed: 5, size: 0.14 }, ring: { color: 0xff6a2a, radius: 1.2, life: 0.35 },
          flash: { who: "target", color: RED, ms: 140 }, freeze: 4, shake: { amplitude: 0.35, ms: 180 } };
      }
      if (u === "m1.2") return { burst: { count: 4, color: 0xffd9a0, life: 0.2, speed: 3, size: 0.09 }, spray: { count: 10, color: 0xfff0c8, life: 0.22, speed: 5.5, size: 0.09, spread: 1.3 }, flash };
      if (u === "m1.3") return { burst: { count: 6, color: 0xffd9a0, life: 0.25, speed: 3.5, size: 0.1 }, ring: { color: 0xffe9b0, radius: 0.8, life: 0.25 }, flash };
      return { burst: { count: 10, color: 0xffd9a0, life: 0.25, speed: 4, size: 0.1 }, flash };
    }
    case "block":
      return { burst: { count: 5, color: 0xbfeaff, life: 0.18, speed: 3, size: 0.08 }, shield: { color: CYAN, life: 0.2 }, shake: { amplitude: 0.1, ms: 80 } };
    case "counter":
      return { burst: { count: 16, color: GOLD, life: 0.3, speed: 5, size: 0.12 }, ring: { color: GOLD, radius: 1.2, life: 0.3 },
        flash: { who: "actor", color: GOLD, ms: 160 }, freeze: 6 };
    case "heal":
      return { motes: { count: 12, color: GREEN, life: 0.6, rise: 1 }, flash: { who: "target", color: GREEN, ms: 200 } };
    case "ko":
      return { ko: true };
    case "capture": // a tether ring where the victim was seized; the kit recipe adds its own wrap on top
      return { ring: { color: PALE, radius: 0.9, life: 0.3 } };
    case "release":
      return { burst: { count: 8, color: PALE, life: 0.3, speed: 4, size: 0.1 }, ring: { color: PALE, radius: 1.0, life: 0.3 } };
    case "respawn":
      return { motes: { count: 10, color: 0xfff3b0, life: 0.8, rise: 2 }, ring: { color: 0xfff3b0, radius: 1.4, life: 0.5 }, flash: { who: "target", color: 0xfff3b0, ms: 200 } };
    case "cast":
      return u === "pickup" ? { motes: { count: 8, color: OCHRE, life: 0.5, rise: 0.8 } } : null;
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
  if (plan.spray) {
    const sp = plan.spray, at = io.chestOf(e.actorId);
    const base = at ? Math.atan2(o.z - at.z, o.x - at.x) : 0; // away from the attacker
    for (let i = 0; i < sp.count; i++) {
      const a = base + rnd(-sp.spread / 2, sp.spread / 2), s = sp.speed * rnd(0.6, 1);
      fx.spawn({ x: o.x, y: o.y, z: o.z, vx: Math.cos(a) * s, vy: rnd(0, 1.5), vz: Math.sin(a) * s, life: sp.life, size: sp.size, color: sp.color, gravity: 5 });
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
  if (plan.freeze && HIT_STUN.enabled) {
    io.fighterOf(victim)?.freeze(plan.freeze);
    io.fighterOf(e.actorId)?.freeze(plan.freeze);
  }
  const me = io.localId();
  if (plan.shake && me !== undefined && (e.actorId === me || e.targetId === me)) io.shake(plan.shake.amplitude, plan.shake.ms);
}

// ---- QV09: replicated-state cues (directional dash, evasive, guard raise) ------------------------------------------------

interface MotionPlayer { x: number; y: number; z: number; vx?: number; vz?: number; facingYaw?: number; action?: string; moveId?: string; actionStartTick?: number }
export interface MotionSeen { key: string; action: string }
export const DASH_PARTS = 8, EVASIVE_PARTS = 14, GUARD_PARTS = 5;

/**
 * Fires one cue per replicated Dash start (forward, side, back, evasive from the moveId the server sets) and one per
 * entry into Guard. Reads state only; a dash that began before this client looked still plays once, and every particle
 * expires by itself. `seen` is pruned for players that left.
 */
export function scanMotion(fx: EffectsPool, players: Map<string, unknown>, seen: Map<string, MotionSeen>): void {
  const live = new Set<string>();
  for (const [id, v] of players) {
    live.add(id);
    const p = v as MotionPlayer;
    const action = p.action ?? "", prev = seen.get(id);
    const key = action === "Dash" ? `${p.moveId}:${p.actionStartTick ?? 0}` : "";
    const at = { x: p.x / 100, y: p.y / 100 - 0.55, z: p.z / 100 }; // feet
    if (action === "Dash" && prev?.key !== key) {
      const yaw = fromYaw(p.facingYaw ?? 0);
      let dx = -Math.sin(yaw), dz = -Math.cos(yaw); // facing; yaw 0 faces -Z
      const speed = Math.hypot(p.vx ?? 0, p.vz ?? 0);
      if (speed > 50) { dx = (p.vx ?? 0) / speed; dz = (p.vz ?? 0) / speed; } // cm/s: travel direction wins when replicated
      else if (p.moveId === "dash.side" || p.moveId === "evasive") { dx = Math.cos(yaw); dz = -Math.sin(yaw); }
      else if (p.moveId === "dash.back") { dx = -dx; dz = -dz; }
      if (p.moveId === "evasive") {
        for (let i = 0; i < EVASIVE_PARTS; i++) {
          const a = (i / EVASIVE_PARTS) * Math.PI * 2;
          fx.spawn({ x: at.x, y: at.y + 0.1, z: at.z, vx: Math.cos(a) * 2.4, vy: i % 2 ? 1.4 : 0.4, vz: Math.sin(a) * 2.4, life: 0.35, size: 0.12, color: 0xbfe8ff });
        }
      } else {
        const wide = p.moveId === "dash.side" ? 0.45 : 0.2;
        for (let i = 0; i < DASH_PARTS; i++) { // streak trailing behind the travel direction
          const back = 0.3 + i * 0.16, off = ((i % 3) - 1) * wide;
          fx.spawn({ x: at.x - dx * back - dz * off, y: at.y + 0.15 + (i % 2) * 0.25, z: at.z - dz * back + dx * off, vx: -dx * 1.2, vy: 0.2, vz: -dz * 1.2, life: 0.3, size: 0.17, color: p.moveId === "dash.forward" ? 0xffe0b0 : 0xd8e8f5 });
        }
      }
    }
    if (action === "Guard" && prev?.action !== "Guard") {
      const yaw = fromYaw(p.facingYaw ?? 0), base = Math.atan2(-Math.cos(yaw), -Math.sin(yaw));
      for (let i = 0; i < GUARD_PARTS; i++) {
        const a = base + ((i - 2) / 2) * 0.8;
        fx.spawn({ x: at.x + Math.cos(a) * 0.8, y: at.y + 0.6 + (i % 2) * 0.25, z: at.z + Math.sin(a) * 0.8, vx: 0, vy: 0, vz: 0, life: 0.18, size: 0.14, color: CYAN });
      }
    }
    seen.set(id, { key: key || (prev?.key ?? ""), action });
  }
  for (const id of [...seen.keys()]) if (!live.has(id)) seen.delete(id);
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
    const off = bus.on((e) => { playHit(e, io); });
    const seen = new Map<string, MotionSeen>();
    let raf = 0, alive = true;
    const frame = (): void => {
      if (!alive) return;
      scanMotion(effects, deps.players(), seen);
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
