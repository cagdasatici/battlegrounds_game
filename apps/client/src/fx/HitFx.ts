/**
 * FX1 hit impact effects (decision 0024). Driven only by confirmed bus events: pooled particles, victim flash,
 * hitstop and camera shake. Presentation only: nothing here touches simulation, positions or ticks.
 */
import type { CombatEvent } from "@eb/shared/protocol";
import type { CombatBus } from "../app/CombatBus.js";
import { EffectsPool } from "../scene/EffectsPool.js";
import type { PresentationDeps } from "./index.js";

/** TODO: replace with a camera-shake setting in SettingsStore when settings gain one (spec default 0.25). */
export const CAMERA_SHAKE_SETTING = 0.25;

const RED = 0xff3b3b, GOLD = 0xffcc33, GREEN = 0x4dff88;
type P = { x: number; y: number; z: number };

export const HitFx = {
  /** Live instance for debug and tests; null when not attached. */
  current: null as { pool: EffectsPool; count: number } | null,

  attach(bus: CombatBus, deps: PresentationDeps): () => void {
    // FX0's registerPresentation test passes empty stub deps; with no scene or settings there is nothing to draw into.
    if (typeof deps.scene?.add !== "function" || typeof deps.settings?.get !== "function") return () => undefined;
    const pool = new EffectsPool();
    pool.init(deps.scene, deps.settings.get().quality);
    const state = { pool, count: 0 };
    HitFx.current = state;
    const burst = (at: P, n: number, color: number, speed: number, life: number, size: number, up = 0): void => {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, s = speed * (0.5 + Math.random() * 0.5);
        pool.spawn({ x: at.x, y: at.y, z: at.z, vx: Math.cos(a) * s, vy: up + (Math.random() - 0.3) * speed * 0.6, vz: Math.sin(a) * s, life, size, color });
      }
    };
    const ring = (at: P, n: number, color: number, radius: number, life: number): void => {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2, s = radius / life;
        pool.spawn({ x: at.x, y: at.y, z: at.z, vx: Math.cos(a) * s, vy: 0, vz: Math.sin(a) * s, life, size: 0.18, color, grow: true });
      }
    };
    const posOf = (id: string | undefined): P | null => {
      const q = id === undefined ? undefined : deps.players().get(id) as { x?: number; y?: number; z?: number } | undefined;
      return q && typeof q.x === "number" ? { x: q.x / 100, y: (q.y ?? 0) / 100, z: (q.z ?? 0) / 100 } : null;
    };
    const involved = (e: CombatEvent): boolean => { const me = deps.localId(); return me !== undefined && (e.actorId === me || e.targetId === me); };
    const shake = (e: CombatEvent, amp: number, ms: number): void => {
      const k = amp * CAMERA_SHAKE_SETTING;
      if (deps.settings.get().reducedMotion || !involved(e) || !(k > 0)) return;
      deps.shake?.(k, ms);
    };
    const flash = (id: string | undefined, color: number, ms: number): void => {
      if (id !== undefined) deps.viewFor?.(id)?.flash(color, ms, deps.settings.get().flashLevel);
    };
    const freeze = (e: CombatEvent, frames: number): void => {
      for (const id of [e.actorId, e.targetId]) if (id !== undefined) deps.viewFor?.(id)?.freeze(frames);
    };

    const onEvent = (e: CombatEvent): void => {
      const subject = e.kind === "heal" ? (e.targetId ?? e.actorId) : e.targetId;
      const sp = posOf(subject);
      const at: P | null = e.position ?? (sp ? { x: sp.x, y: sp.y + 0.3, z: sp.z } : null);
      if (!at) return;
      switch (e.kind) {
        case "hit":
          if (e.hitClass === "heavy") {
            burst(at, 24, 0xff6a2a, 6, 0.35, 0.12);
            ring(at, 16, 0xff6a2a, 1.2, 0.35);
            flash(e.targetId, RED, 140);
            freeze(e, 4);
            shake(e, 0.35, 180);
          } else {
            burst(at, 10, 0xffd9a0, 4, 0.25, 0.08);
            flash(e.targetId, RED, 90);
          }
          break;
        case "block": {
          const from = posOf(e.actorId);
          let dx = from && sp ? from.x - sp.x : 1, dz = from && sp ? from.z - sp.z : 0;
          const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
          const base = Math.atan2(dz, dx);
          for (let i = 0; i < 9; i++) {
            const a = base + ((i - 4) / 4) * 1.0;
            pool.spawn({ x: at.x + Math.cos(a) * 0.7, y: at.y + (i % 3 - 1) * 0.25, z: at.z + Math.sin(a) * 0.7, vx: Math.cos(a) * 0.6, vy: 0, vz: Math.sin(a) * 0.6, life: 0.2, size: 0.16, color: 0x5fd8ff });
          }
          shake(e, 0.1, 80);
          break;
        }
        case "counter":
          burst(at, 14, GOLD, 5, 0.3, 0.1);
          ring(at, 16, GOLD, 1.2, 0.35);
          flash(e.actorId, GOLD, 160);
          freeze(e, 6);
          break;
        case "heal":
          for (let i = 0; i < 12; i++) {
            const a = Math.random() * Math.PI * 2, r = 0.15 + Math.random() * 0.35;
            pool.spawn({ x: at.x + Math.cos(a) * r, y: at.y - 0.3, z: at.z + Math.sin(a) * r, vx: 0, vy: 1 / 0.6, vz: 0, life: 0.6, size: 0.09, color: GREEN });
          }
          flash(subject, GREEN, 200);
          break;
        case "ko": {
          burst({ x: at.x, y: at.y - 0.6, z: at.z }, 10, 0xb8a98a, 2.2, 0.5, 0.2);
          for (let i = 0; i < 8; i++) pool.spawn({ x: at.x, y: at.y - 0.6 + i * 0.12, z: at.z, vx: 0, vy: 3, vz: 0, life: 0.6, size: 0.3, color: 0xfff3b0, grow: true });
          break;
        }
        default: return;
      }
      state.count++;
    };

    const offBus = bus.on(onEvent);
    const offFrame = deps.onFrame?.((dt) => { pool.update(dt); }) ?? ((): void => undefined);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      offBus(); offFrame(); pool.dispose();
      if (HitFx.current === state) HitFx.current = null;
    };
  },
};

