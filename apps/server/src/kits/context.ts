import type { AbilityHandler } from "../sim/AbilityRunner.js";
import { fire } from "./projectile.js";

/**
 * T23 context handlers (spec 10, 15, 16). Urn pickup and throw drive the server owned UrnSystem. No timers: every phase boundary is
 * an integer tick of the room clock.
 */
/** Pickup: reserve the nearest urn at commit, hold it when the 12 tick channel ends; any other ending frees it. */
export const URN_PICKUP: AbilityHandler = {
  name: "urnPickup",
  canStart(c) {
    const urns = c.host.urns;
    if (!urns || urns.heldBy(c.fighter.entityId) || urns.reservedBy(c.fighter.entityId)) return "STATE";
    return urns.nearest(c.pose.x, c.pose.y, c.pose.z) ? null : "STATE";
  },
  onCommit(c) {
    const p = c.host.pose(c.fighter.entityId)!;
    const u = c.host.urns!.nearest(p.x, p.y, p.z)!; // canStart just proved one exists
    c.host.urns!.reserve(u.id, c.fighter);
  },
  onTick(c) {
    if (c.cast.data.done === true || c.tick < c.cast.activeStart) return;
    c.cast.data.done = true;
    c.host.urns?.complete(c.fighter.entityId);
  },
  onEnd(c) {
    if (c.cast.data.done !== true) c.host.urns?.drop(c.fighter.entityId);
  },
};

/** Throw: at activeStart the held urn becomes a swept projectile (<kit>.throw or sv.x3 numbers come from the definition). */
export const URN_THROW: AbilityHandler = {
  name: "urnThrow",
  canStart(c) {
    return c.host.urns?.heldBy(c.fighter.entityId) ? null : "STATE";
  },
  onTick(c) {
    if (c.cast.data.spawned === true || c.tick < c.cast.activeStart) return;
    c.cast.data.spawned = true;
    if (!c.host.urns?.consumeThrown(c.fighter.entityId, c.tick)) return; // dropped during startup: nothing to throw
    fire(c, false);
  },
};

export const CONTEXT_HANDLERS: AbilityHandler[] = [URN_PICKUP, URN_THROW];
