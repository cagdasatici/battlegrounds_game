import { isAlive, type Fighter } from "./ActionMachine.js";
import type { AbilityHost } from "./AbilityRunner.js";
import type { HitCandidate } from "./HitResolver.js";

/**
 * Landing bonus book (spec 14/15, Fault Strike). A landing bonus is delayed damage attached to a victim and the
 * cast that struck it. It outlives the casting action (up to 120 ticks), so it cannot live in handler cast state.
 *
 * Hook: AbilityRunner.collect() calls collect() once per tick after the movement step, so `pose.grounded` is the
 * authoritative contact state of this tick. The bonus is applied on the first ground contact that follows at
 * least one airborne tick observed after the attach. Entries are dropped on: expiry (exclusive), victim or
 * attacker death/respawn (life id change), evasive (Fighter.landingBonus cleared by the action machine), spawn
 * protection of the victim, runner reset/remove/dispose. No timers: only the room's fixed tick drives it.
 *
 * The produced candidate goes through the normal serial resolver (invulnerability, shield, damage, lethal).
 * It is U and noncounterable (D) and carries no reaction. hitIndex 100 marks it for handlers.
 */
export const LANDING_HIT_INDEX = 100;

export interface LandingBonusSpec {
  attackerId: number;
  attackerLifeId: number;
  victimId: number;
  victimLifeId: number;
  castCounter: number;
  moveId: string;
  damage100: number;
  expireTick: number; // exclusive
}

interface Entry extends LandingBonusSpec { sawAirborne: boolean }

export class LandingBonusBook {
  private entries: Entry[] = [];

  /** Attaches a bonus to a victim; one bonus per (attacker, cast, victim). Sets Fighter.landingBonus. */
  attach(victim: Fighter, spec: LandingBonusSpec): void {
    victim.landingBonus = true;
    this.entries = this.entries.filter((e) => !(e.attackerId === spec.attackerId && e.castCounter === spec.castCounter && e.victimId === spec.victimId));
    this.entries.push({ ...spec, sawAirborne: false });
  }

  has(victimId: number): boolean { return this.entries.some((e) => e.victimId === victimId); }
  get size(): number { return this.entries.length; }

  collect(tick: number, host: AbilityHost): HitCandidate[] {
    if (this.entries.length === 0) return [];
    const out: HitCandidate[] = [];
    const keep: Entry[] = [];
    for (const e of this.entries) {
      const v = host.combat.get(e.victimId), a = host.combat.get(e.attackerId);
      if (!v || !a || !isAlive(v) || !isAlive(a) || v.lifeId !== e.victimLifeId || a.lifeId !== e.attackerLifeId) continue;
      if (tick >= e.expireTick || !v.landingBonus || tick < v.protectedUntilTick) continue;
      const p = host.pose(e.victimId);
      if (!p) continue;
      if (!p.grounded) { e.sawAirborne = true; keep.push(e); continue; }
      if (!e.sawAirborne) { keep.push(e); continue; }
      out.push({
        attackerId: e.attackerId, attackerGeneration: a.generation, castCounter: e.castCounter, hitIndex: LANDING_HIT_INDEX,
        toi: 0, targetId: e.victimId, moveId: e.moveId, originX: p.x, originZ: p.z, block: "U", counterable: false,
        armorBreak: false, damage100: e.damage100, reaction: { kind: "none" }, maxHitsPerTarget: 2,
      });
    }
    this.entries = keep;
    return out;
  }

  dropEntity(entityId: number): void {
    this.entries = this.entries.filter((e) => e.victimId !== entityId && e.attackerId !== entityId);
  }

  clear(): void { this.entries = []; }
}
