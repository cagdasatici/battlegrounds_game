import { meterRequired100 } from "@eb/shared/awakening";
import type { RejectReason } from "@eb/shared/protocol";
import { beginAwakening, isAlive, isProtected, type Fighter } from "./ActionMachine.js";
import type { CombatSystem } from "./Combat.js";
import type { HitCandidate, HitResult } from "./HitResolver.js";

/**
 * Awakening system (spec sections 12, 15, 26): damage based meter, activation, form state and form expiry.
 * Pure server module driven only by the room's fixed tick; no timers.
 *
 * - Meter gain is the actual HP removed (hundredths) from another fighter by a hit or capture commit.
 *   Blocked, countered, overkill, self and practice damage never build meter. Nothing is gained while
 *   Awakened or during an activation. Meter is capped at the kit threshold.
 * - Activation is accepted only from grounded, unprotected Idle with a full meter and Base form. It is never
 *   buffered. An interrupted activation (armorBreak, capture, death) keeps the meter and the Base form.
 * - Completion sets form Awakened, meter 0, awakened use bits and contextSpent reset, and starts the form timer
 *   (kits with a duration). Expiry returns to Base but never cancels a committed cast (spec 15, A14).
 */
export interface ActivationConfig {
  ticks: number;
  /** Form duration in ticks from completion; 0 means no time expiry (Stone Vanguard). */
  formTicks: number;
  /** Heal in hundredths once at completion. */
  healAtCompletion100: number;
  /** Invulnerable ticks [from, to) relative to activation start; null for none. */
  invulnerable: { from: number; to: number } | null;
  /** Burst at a relative tick (Ocean Surge). */
  burst: { atTick: number; damage100: number; radius: number; maxTargets: number; reaction: { ragdollTicks: number; forward: number; up: number } } | null;
}

/** D values from spec section 15 (sv.activate, td.activate). The Ember Artificer is P1 and not configured here. */
export const ACTIVATIONS: Readonly<Record<string, ActivationConfig>> = {
  sv: { ticks: 30, formTicks: 0, healAtCompletion100: 0, invulnerable: null, burst: null },
  td: {
    ticks: 60, formTicks: 2940, healAtCompletion100: 4000, invulnerable: { from: 48, to: 60 },
    burst: { atTick: 48, damage100: 2000, radius: 5, maxTargets: 4, reaction: { ragdollTicks: 72, forward: 6, up: 6 } },
  },
};

/** Slotted awakened move ids (sv.a1 to ea.a4). Their damage resolves after the form returned to Base. */
const AWAKENED_MOVE_RE = /^(sv|td|ea)\.a[1-4]$/;

interface Activation { kit: string; startTick: number; endTick: number; generation: number; castCounter: number }

export type AwakenOutcome =
  | { kind: "started"; castCounter: number; moveId: string }
  | { kind: "rejected"; reason: RejectReason };

export interface AwakeningHost {
  readonly combat: CombatSystem;
  pose(entityId: number): { x: number; y: number; z: number; facingYaw: number; grounded: boolean } | undefined;
}

export class AwakeningSystem {
  private readonly active = new Map<number, Activation>();
  /** Practice rooms turn meter off (spec 7: practice damage never builds meter). */
  meterEnabled = true;

  constructor(private readonly host: AwakeningHost) {}

  get activeCount(): number { return this.active.size; }

  request(f: Fighter, tick: number): AwakenOutcome {
    const kit = f.kitId;
    const cfg = ACTIVATIONS[kit];
    if (!cfg) return { kind: "rejected", reason: "INVALID" };
    if (!isAlive(f) || f.action !== "Idle") return { kind: "rejected", reason: "STATE" };
    if (f.form === "Awakened") return { kind: "rejected", reason: "FORM" };
    if (f.meter100 < meterRequired100(kit)) return { kind: "rejected", reason: "METER" };
    const pose = this.host.pose(f.entityId);
    if (!pose?.grounded || isProtected(f, tick)) return { kind: "rejected", reason: "STATE" };
    const r = beginAwakening(f, tick, cfg.ticks, `${kit}.activate`);
    if (!r.ok) return { kind: "rejected", reason: r.reason };
    this.active.set(f.entityId, { kit, startTick: tick, endTick: tick + cfg.ticks, generation: f.generation, castCounter: f.castCounter });
    f.armored = true; // armor, no damage reduction (spec 15)
    return { kind: "started", castCounter: f.castCounter, moveId: `${kit}.activate` };
  }

  /** Meter gain from this tick's resolved hits (call once after resolution). */
  gain(results: readonly HitResult[]): void {
    if (!this.meterEnabled) return;
    for (const r of results) {
      if ((r.outcome !== "hit" && r.outcome !== "captured") || r.damage100 <= 0) continue;
      const c = r.candidate;
      if (c.attackerId === c.targetId) continue;
      if (AWAKENED_MOVE_RE.test(c.moveId)) continue; // D (T15): damage of a consumed awakened move never feeds the next meter
      const a = this.host.combat.get(c.attackerId);
      if (!a || !isAlive(a) || a.form !== "Base" || a.action === "Awakening") continue;
      a.meter100 = Math.min(meterRequired100(a.kitId), a.meter100 + r.damage100);
    }
  }

  /**
   * Expiry step, after combat.expire and before input. Completes or drops activations, expires timed forms.
   * A form expiring never cancels a committed cast and never touches captures.
   */
  update(tick: number): void {
    for (const id of [...this.active.keys()].sort((a, b) => a - b)) {
      const act = this.active.get(id)!;
      const f = this.host.combat.get(id);
      if (!f || !isAlive(f) || f.generation !== act.generation || f.castCounter !== act.castCounter) {
        this.active.delete(id);
        if (f) f.armored = false; // interrupted: meter and Base form are kept
        continue;
      }
      const cfg = ACTIVATIONS[act.kit]!;
      const rel = tick - act.startTick;
      if (cfg.invulnerable && rel >= cfg.invulnerable.from && rel < cfg.invulnerable.to) {
        f.invulnerableUntil = Math.max(f.invulnerableUntil, act.startTick + cfg.invulnerable.to);
      }
      if (tick >= act.endTick) {
        this.active.delete(id);
        f.armored = false;
        f.form = "Awakened";
        f.meter100 = 0;
        f.awakenedUsedMask = 0;
        f.contextSpent = false;
        f.formEndTick = cfg.formTicks > 0 ? tick + cfg.formTicks : 0;
        if (cfg.healAtCompletion100 > 0) f.hp100 = Math.min(10000, f.hp100 + cfg.healAtCompletion100);
      }
    }
    for (const f of this.host.combat.all()) {
      if (f.form === "Awakened" && f.formEndTick > 0 && tick >= f.formEndTick) {
        f.form = "Base";
        f.formEndTick = 0;
      }
    }
  }

  /** Burst hit candidates for this tick (Ocean Surge at relative tick 48): U, armorBreak, noncounterable. */
  collect(tick: number): HitCandidate[] {
    const out: HitCandidate[] = [];
    for (const id of [...this.active.keys()].sort((a, b) => a - b)) {
      const act = this.active.get(id)!;
      const burst = ACTIVATIONS[act.kit]!.burst;
      if (!burst || tick !== act.startTick + burst.atTick) continue;
      const f = this.host.combat.get(id);
      const ap = this.host.pose(id);
      if (!f || !ap) continue;
      const near: { id: number; d: number }[] = [];
      for (const t of this.host.combat.all()) {
        if (t.entityId === id || !isAlive(t)) continue;
        const tp = this.host.pose(t.entityId);
        if (!tp) continue;
        const dy = Math.max(0, Math.abs(tp.y - ap.y) - 0.55);
        const d = Math.hypot(Math.hypot(tp.x - ap.x, tp.z - ap.z), dy);
        if (d <= burst.radius + 0.35) near.push({ id: t.entityId, d });
      }
      near.sort((a, b) => a.d - b.d || a.id - b.id);
      near.slice(0, burst.maxTargets).forEach((n, i) => {
        out.push({
          attackerId: id, attackerGeneration: act.generation, castCounter: act.castCounter, hitIndex: i, toi: 0, targetId: n.id,
          moveId: `${act.kit}.activate`, originX: ap.x, originZ: ap.z, block: "U", counterable: false, armorBreak: true,
          damage100: burst.damage100, reaction: { kind: "ragdoll", ticks: burst.reaction.ragdollTicks },
          maxHitsPerTarget: 1, launch: { forward: burst.reaction.forward, up: burst.reaction.up },
        });
      });
    }
    return out;
  }

  remove(entityId: number): void { this.active.delete(entityId); }
  /** Death or respawn. */
  reset(entityId: number): void { this.active.delete(entityId); }
  dispose(): void { this.active.clear(); }
}
