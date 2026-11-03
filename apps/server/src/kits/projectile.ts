import { releaseToIdle } from "../sim/ActionMachine.js";
import type { AbilityHandler, CastContext } from "../sim/AbilityRunner.js";
import { forwardOf } from "../sim/AbilityRunner.js";
import { reactionOfDef } from "../sim/AbilityRunner.js";
import type { ProjectileSpawn } from "../sim/Projectiles.js";

/**
 * chargeProjectile (T19, spec 15 Ember Orb card): a holdRelease cast that fires one detached projectile.
 *
 *  - Commit (accepted press): cooldown starts now, charging begins; the cast holds in Windup for at most
 *    projectile.chargeMaxTicks. data.chargeStart is the commit tick (owner chargeStartTick).
 *  - Release: a skillUp edge, a fresh packet whose chargeHeldSlot no longer names the slot, or the charge cap.
 *    chargeTicks = releaseTick - commitTick, capped. Then def.startup ticks of windup, then active (spawn tick) and
 *    recovery. Charging for chargeMaxTicks or more is "full" (fullDamage100, bypasses guard); anything less is
 *    "partial" (damage100[0], blockable with chip).
 *  - A stale input lease (host.hold === "stale", A11) cancels the charge: no projectile, the fighter returns to Idle
 *    and the cooldown stays spent. Interruption, death and capture end the cast through AbilityRunner, so a later
 *    spawn never happens; the cast owns no timer, listener or other state beyond cast.data.
 *  - moveScale and turnRate come from the definition; the caster's vertical velocity is frozen in air from commit
 *    until the projectile spawns.
 */
const SPAWN_FORWARD = 0.8; // metres in front of the capsule centre
const SPAWN_UP = 0.2;

export function fire(c: CastContext, full: boolean): void {
  const d = c.cast.def;
  const proj = d.projectile!;
  const ap = c.host.pose(c.fighter.entityId);
  const spawner = c.host.projectileSpawner;
  if (!ap || !spawner) return;
  const [fx, fz] = forwardOf(c.cast.aimYaw);
  // Spawn at the capsule front, clear of walls: pull back to the first static contact on the way out.
  const origin: [number, number, number] = [ap.x, ap.y + SPAWN_UP, ap.z];
  const front: [number, number, number] = [ap.x + fx * SPAWN_FORWARD, ap.y + SPAWN_UP, ap.z + fz * SPAWN_FORWARD];
  const t = c.host.sweepSphere?.(origin, front, proj.radius) ?? null;
  const k = t === null ? 1 : t;
  const spawn: ProjectileSpawn = {
    ownerId: c.fighter.entityId, ownerOccupant: c.host.occupantOf?.(c.fighter.entityId) ?? 0, ownerLifeId: c.fighter.lifeId, castCounter: c.cast.castCounter, moveId: d.id,
    x: origin[0] + (front[0] - origin[0]) * k, y: origin[1], z: origin[2] + (front[2] - origin[2]) * k,
    dirX: fx, dirY: 0, dirZ: fz,
    speed: proj.speed, lifeTicks: proj.lifeTicks, maxRange: proj.maxRange, radius: proj.radius,
    splashRadius: proj.splashRadius, splashMax: proj.splashMax, reflectable: proj.reflectable,
    arcAmplitude: proj.arcAmplitude, arcSpan: proj.arcSpan,
    chargeClass: full ? "full" : "partial",
    damage100: full && proj.fullDamage100 > 0 ? proj.fullDamage100 : d.damage100[0]!,
    chip100: full ? 0 : proj.chip100,
    block: full ? "U" : d.block,
    reaction: reactionOfDef(d),
    launch: d.launch,
  };
  spawner.spawn(spawn, c.tick); // null at the room cap: no shot, cooldown stays spent
}

export const CHARGE_PROJECTILE: AbilityHandler = {
  name: "chargeProjectile",
  onCommit(c) {
    const proj = c.cast.def.projectile;
    if (!proj) throw new Error(`${c.cast.def.id}: chargeProjectile needs a projectile block`);
    c.cast.data.phase = "charge";
    c.cast.data.charging = true;
    c.cast.data.chargeStart = c.tick;
    c.runner.rescheduleCast(c.fighter, c.cast, c.tick, c.tick + proj.chargeMaxTicks + c.cast.def.startup);
  },
  freezeVertical(c) {
    return c.cast.data.spawned !== true;
  },
  onTick(c) {
    const d = c.cast.def;
    const data = c.cast.data;
    const proj = d.projectile!;
    if (data.phase === "charge") {
      const slot = d.slot;
      const hold = slot ? c.host.hold?.(c.fighter.entityId, slot, c.tick) : undefined;
      if (hold === "stale") {
        // A11: no shot; cooldown was spent at commit and stays spent.
        data.charging = false;
        data.phase = "cancelled";
        releaseToIdle(c.fighter, c.tick);
        c.runner.cancel(c.fighter.entityId);
        return;
      }
      const chargeTicks = c.tick - (data.chargeStart as number);
      const released = data.upTick !== undefined || hold === "released";
      if (released || chargeTicks >= proj.chargeMaxTicks) {
        const ticks = Math.min(chargeTicks, proj.chargeMaxTicks);
        data.chargeTicks = ticks;
        data.full = proj.chargeMaxTicks > 0 && ticks >= proj.chargeMaxTicks;
        data.charging = false;
        data.phase = "windup";
        c.runner.rescheduleCast(c.fighter, c.cast, c.tick, c.tick + d.startup);
      }
      return;
    }
    if (data.phase === "windup" && c.tick >= c.cast.activeStart && data.spawned !== true) {
      data.spawned = true;
      fire(c, data.full === true);
    }
  },
};

export const PROJECTILE_HANDLERS: AbilityHandler[] = [CHARGE_PROJECTILE];
