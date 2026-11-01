import { COMBAT } from "@eb/shared/config/combat";
import type { AbilityDef } from "@eb/shared/abilities";
import type { Fighter } from "./ActionMachine.js";
import type { AbilityHost, AbilityRunner } from "./AbilityRunner.js";
import type { ContextRequest, ContextStart } from "./M1.js";
import type { UrnSystem } from "./Urns.js";

/**
 * T23 context selection (spec 15, 16). Called by M1System before each M1 commit. Priority: held urn -> pickup -> wall
 * opportunity -> grounded mini uppercut (sv.x1). Awakened Vanguard with contextSpent false uses sv.x1 to sv.x3 and spends
 * the one shared bit at commit; everyone else gets the shared `<kit>.wall`, `.pickup` and `.throw` moves. The wall branch is gated by `enabled`
 * (P0 disables it, P1 enables it; rooms switch it on). Nothing here keeps timers or listeners.
 */
export class ContextSystem {
  /** P1 switch (spec 13: "P0 disables this branch"). Off by default so bare M1 rigs keep the P0 behaviour. */
  enabled = false;

  constructor(private readonly runner: AbilityRunner, private readonly urns: UrnSystem, private readonly host: AbilityHost) {}

  private def(id: string): AbilityDef {
    const d = this.runner.registry.byId(id);
    if (!d) throw new Error(`missing context definition ${id}`);
    return d;
  }

  /** True while the fighter may spend its shared sv.x use. */
  private vanguardOpen(f: Fighter): boolean {
    return f.kitId === "sv" && f.form === "Awakened" && !f.contextSpent;
  }

  /** An opponent within the attacker's reach that stands within the wall gap of a vertical face (spec 13). */
  wallTargetOf(f: Fighter, tick: number): number | null {
    const ap = this.host.pose(f.entityId);
    if (!ap || !this.host.nearWall) return null;
    let best: { id: number; d: number } | null = null;
    for (const t of this.host.combat.all()) {
      if (t.entityId === f.entityId || t.action === "Dead" || t.action === "Captured") continue;
      if (this.host.combat.captures.shieldsFrom(t.entityId, f.entityId)) continue;
      if (tick < t.protectedUntilTick || tick < t.invulnerableUntil) continue;
      const tp = this.host.pose(t.entityId);
      if (!tp) continue;
      const d = Math.hypot(tp.x - ap.x, tp.z - ap.z);
      if (d > COMBAT.wall.attackerReach || Math.abs(tp.y - ap.y) > 1.2) continue;
      if (!this.host.nearWall(tp.x, tp.y, tp.z) || this.host.blocked([ap.x, ap.y, ap.z], [tp.x, tp.y, tp.z])) continue;
      if (!best || d < best.d || (d === best.d && t.entityId < best.id)) best = { id: t.entityId, d };
    }
    return best ? best.id : null;
  }

  decide(f: Fighter, tick: number, req: ContextRequest): ContextStart | null {
    if (!this.enabled) return null;
    const start = (id: string, advance: boolean): ContextStart | null => {
      const o = this.runner.startContext(f, tick, this.def(id));
      return o.kind === "started" ? { accept: { ok: true, castCounter: o.castCounter }, advance } : null;
    };
    // 1. Held urn: the next Attack throws it (a fresh press only; a held button never chains pickup into a throw).
    if (this.urns.heldBy(f.entityId)) return req.pressed ? start(this.vanguardOpen(f) ? "sv.x3" : `${f.kitId}.throw`, false) : null;
    // 2. Pickup: standing still beside a free urn at the start of a chain.
    const mag = Math.hypot(req.held.moveX ?? 0, req.held.moveZ ?? 0);
    if (req.pressed && req.index === 0 && mag < COMBAT.props.pickupStickMax
      && this.urns.nearest(req.pose.x, req.pose.y, req.pose.z)) return start(`${f.kitId}.pickup`, false);
    if (req.index !== 3) return null;
    // 3. Wall opportunity replaces the fourth M1 (reserved before the normal fourth hit).
    if (this.wallTargetOf(f, tick) !== null) {
      const r = start(this.vanguardOpen(f) ? "sv.x2" : `${f.kitId}.wall`, true);
      if (r) return r;
    }
    // 4. Grounded mini uppercut with jump held.
    if (this.vanguardOpen(f) && req.pose.grounded && req.held.jumpHeld) return start("sv.x1", true);
    return null;
  }
}
