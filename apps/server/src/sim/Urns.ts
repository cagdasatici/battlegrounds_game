import { COMBAT } from "@eb/shared/config/combat";
import type { MapVec3 } from "@eb/shared/config/arena";
import type { Fighter } from "./ActionMachine.js";

/**
 * Server owned throwable urns (T23, spec 10 and 15). Pure server module: no timers, no Rapier. Eight urns sit on fixed
 * anchors. Lifecycle: anchored -> reserved (a 12 tick pickup channel) -> held -> returning (thrown; back on its anchor
 * after COMBAT.props.returnTicks integer ticks, hit or miss). A dropped urn (guard, damage, capture, stun, death, leave)
 * goes straight back to its anchor: urns never become loose debris (spec 10 forbids unconstrained debris physics).
 * Everything is keyed by entity id and life id; clear() empties the system on room dispose.
 */
export type UrnState = "anchored" | "reserved" | "held" | "returning";

export interface Urn {
  readonly id: number;
  readonly anchor: MapVec3;
  state: UrnState;
  holderId: number;
  holderLife: number;
  /** Tick at which a returning urn is anchored again. */
  returnTick: number;
}

const P = COMBAT.props;
/** Vertical tolerance between a fighter centre and an urn anchor for pickup (anchor y 0.25, centre about 0.9). */
const PICKUP_DY = 1.5;

export class UrnSystem {
  private readonly urns: Urn[];

  constructor(anchors: readonly MapVec3[]) {
    this.urns = anchors.map((a, id) => ({ id, anchor: a, state: "anchored", holderId: 0, holderLife: 0, returnTick: 0 }));
  }

  /** WORLD01: re-seats the urns on another map's anchors. Only valid before play starts (room creation): every urn is reset to anchored. */
  setAnchors(anchors: readonly MapVec3[]): void {
    this.urns.length = 0;
    anchors.forEach((a, id) => this.urns.push({ id, anchor: a, state: "anchored", holderId: 0, holderLife: 0, returnTick: 0 }));
  }

  list(): readonly Urn[] { return this.urns; }
  get(id: number): Urn | undefined { return this.urns[id]; }

  heldBy(entityId: number): Urn | undefined {
    return this.urns.find((u) => u.state === "held" && u.holderId === entityId);
  }
  reservedBy(entityId: number): Urn | undefined {
    return this.urns.find((u) => u.state === "reserved" && u.holderId === entityId);
  }
  /** Nearest anchored urn within pickup reach of a fighter centre (ties: lowest id), or undefined. */
  nearest(x: number, y: number, z: number): Urn | undefined {
    let best: Urn | undefined, bd = Infinity;
    for (const u of this.urns) {
      if (u.state !== "anchored" || Math.abs(y - u.anchor[1]) > PICKUP_DY) continue;
      const d = Math.hypot(x - u.anchor[0], z - u.anchor[2]);
      if (d <= P.pickupRadius && d < bd) { best = u; bd = d; }
    }
    return best;
  }

  /** Starts the pickup channel. False when the urn is not free or the fighter already holds or reserves one. */
  reserve(urnId: number, f: Pick<Fighter, "entityId" | "lifeId">): boolean {
    const u = this.urns[urnId];
    if (!u || u.state !== "anchored" || this.heldBy(f.entityId) || this.reservedBy(f.entityId)) return false;
    u.state = "reserved"; u.holderId = f.entityId; u.holderLife = f.lifeId;
    return true;
  }
  /** Channel finished: reserved -> held. */
  complete(entityId: number): boolean {
    const u = this.reservedBy(entityId);
    if (!u) return false;
    u.state = "held";
    return true;
  }
  /** Releases a held or reserved urn back to its anchor. Idempotent. */
  drop(entityId: number): boolean {
    let any = false;
    for (const u of this.urns) {
      if ((u.state === "held" || u.state === "reserved") && u.holderId === entityId) { this.reset(u); any = true; }
    }
    return any;
  }
  /** The held urn leaves the hand as a projectile; it returns to its anchor returnTicks later. */
  consumeThrown(entityId: number, tick: number): Urn | undefined {
    const u = this.heldBy(entityId);
    if (!u) return undefined;
    u.state = "returning"; u.returnTick = tick + P.returnTicks; u.holderId = 0; u.holderLife = 0;
    return u;
  }

  /**
   * Expiry step: returns timed out urns to their anchors and drops urns whose holder is gone, dead, from another life,
   * guarding, stunned, ragdolled or captured. A reserved urn also needs its pickup cast to still be running.
   */
  update(tick: number, fighterOf: (id: number) => Fighter | undefined): void {
    for (const u of this.urns) {
      if (u.state === "returning") { if (tick >= u.returnTick) this.reset(u); continue; }
      if (u.state === "anchored") continue;
      const f = fighterOf(u.holderId);
      const bad = !f || f.lifeId !== u.holderLife || f.action === "Dead" || f.action === "Guard" || f.action === "Stunned"
        || f.action === "Ragdolled" || f.action === "Captured"
        || (u.state === "reserved" && !f.moveId.endsWith(".pickup"));
      if (bad) this.reset(u);
    }
  }

  clear(): void { for (const u of this.urns) this.reset(u); }

  private reset(u: Urn): void { u.state = "anchored"; u.holderId = 0; u.holderLife = 0; u.returnTick = 0; }
}
