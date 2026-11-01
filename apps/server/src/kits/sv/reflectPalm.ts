import { forwardOf, meleeCandidates, type AbilityHandler, type CastContext } from "../../sim/AbilityRunner.js";
import type { HitCandidate } from "../../sim/HitResolver.js";

/**
 * sv.b3 Rift Palm (spec 15). On every active tick: first check reflectable projectiles inside a 1.8 m radius
 * frontal hemisphere around the caster (projectile centre minus its radius, horizontal forward component >= 0),
 * then run the ordinary melee query (7 HP, U, stun 30, launch F2 U0, supports ragdoll targets; the melee hit is
 * independent of the reflect and may land on one other target).
 *
 * At most one projectile interaction per cast (D: a reflect or an absorb both consume it; a "rejected" projectile
 * does not). The provider (ReflectableProjectiles, T19) owns owner change, redirection, damage preservation, the
 * one-reflection limit and absorb on a second attempt. A reflect never touches cooldown (it starts on the accepted
 * press) and grants no meter: meter is awarded only when the reflected projectile later damages someone (T19/T14).
 * Without a provider on the host only the melee branch runs.
 */
export const REFLECT_RADIUS = 1.8;
const DONE_KEY = "projectileHandled";
export const REFLECTED_KEY = "reflectedProjectileIds";

function reflectStep(c: CastContext): void {
  const provider = c.host.projectiles;
  const ap = c.host.pose(c.fighter.entityId);
  const { cast, tick } = c;
  if (!provider || !ap || cast.data[DONE_KEY] === true) return;
  if (tick < cast.activeStart || tick >= cast.activeEnd) return;
  const [fx, fz] = forwardOf(cast.aimYaw);
  const near: { id: number; dist: number }[] = [];
  for (const p of provider.reflectable()) {
    if (p.ownerId === c.fighter.entityId) continue;
    const dx = p.x - ap.x, dy = p.y - ap.y, dz = p.z - ap.z;
    if (dx * fx + dz * fz < 0) continue; // behind the palm
    const dist = Math.hypot(dx, dy, dz);
    if (dist - p.radius > REFLECT_RADIUS) continue;
    near.push({ id: p.id, dist });
  }
  near.sort((a, b) => a.dist - b.dist || a.id - b.id);
  for (const n of near) {
    const outcome = provider.reflect(n.id, c.fighter.entityId, cast.castCounter, tick);
    if (outcome === "rejected") continue;
    cast.data[DONE_KEY] = true;
    if (outcome === "reflected") ((cast.data[REFLECTED_KEY] ??= []) as number[]).push(n.id);
    return;
  }
}

function candidates(c: CastContext): HitCandidate[] {
  reflectStep(c);
  return meleeCandidates(c);
}

export const REFLECT_PALM: AbilityHandler = { name: "reflectPalm", candidates };
