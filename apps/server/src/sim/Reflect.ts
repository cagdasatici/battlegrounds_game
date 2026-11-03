/**
 * Minimal projectile reflection interface (spec 13/15). The projectile system arrives in T19 and does not exist
 * yet; the reflect handler (sv.b3) is written against this optional host interface and tested with a fake.
 *
 * Contract for the provider (T19): reflect() changes the owner to `newOwnerId`, redirects the projectile toward
 * the ORIGINAL owner's current position without crossing static geometry, preserves its damage, assigns the new
 * cast counter, and limits reflection count to one. A second reflection attempt absorbs the projectile with no
 * damage. Meter is granted only when the reflected projectile later damages someone (provider/T19 responsibility).
 */
export interface ReflectableProjectile {
  id: number;
  ownerId: number;
  /** Server-only occupant generation of the owner id at fire (or reflect) time (GR02). */
  ownerOccupant: number;
  x: number;
  y: number;
  z: number;
  /** Projectile collision radius, metres (0 when unknown). */
  radius: number;
  /** How many times it was already reflected. */
  reflectCount: number;
}

export type ReflectOutcome = "reflected" | "absorbed" | "rejected";

export interface ReflectableProjectiles {
  /** Live reflectable projectiles in stable (id) order. */
  reflectable(): readonly ReflectableProjectile[];
  reflect(projectileId: number, newOwnerId: number, newCastCounter: number, tick: number): ReflectOutcome;
}
