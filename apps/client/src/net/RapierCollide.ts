/**
 * Client collision for locomotion prediction (R14): the same static map (islands.v1.json) and the same
 * Rapier character controller configuration as the server MovementSystem, so prediction and authority
 * resolve walls, steps and floor identically. Static geometry only; players never collide with players.
 * The capsule is a parentless collider that is re-placed at the corrected pose before every query.
 */
import RAPIER from "@dimforge/rapier3d-compat";
import { COMBAT } from "@eb/shared/config/combat";
import type { ArenaMap } from "@eb/shared/config/arena";
import type { Collide } from "./Prediction.js";

const WALKABLE_COS = Math.cos((COMBAT.controller.maxSlopeDeg * Math.PI) / 180);

export interface RapierCollide {
  collide: Collide;
  dispose(): void;
}

let ready: Promise<void> | null = null;
/** Rapier WASM init, once per page. */
export function initRapier(): Promise<void> {
  ready ??= RAPIER.init();
  return ready;
}

/** Builds the static world and controller. Call `initRapier()` first. */
export function createRapierCollide(map: ArenaMap): RapierCollide {
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  world.timestep = 1 / 60;
  const fixed = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  for (const c of map.colliders) {
    const desc = c.shape === "cuboid"
      ? RAPIER.ColliderDesc.cuboid(c.halfExtents[0], c.halfExtents[1], c.halfExtents[2])
      : RAPIER.ColliderDesc.cylinder(c.halfHeight, c.radius);
    desc.setTranslation(c.centre[0], c.centre[1], c.centre[2]);
    world.createCollider(desc, fixed);
  }
  world.step(); // primes the query BVH, as the server World does

  const k = COMBAT.controller;
  const controller = world.createCharacterController(k.offset);
  controller.setUp({ x: 0, y: 1, z: 0 });
  controller.enableAutostep(k.stepHeight, k.minStepWidth, false);
  controller.setMaxSlopeClimbAngle((k.maxSlopeDeg * Math.PI) / 180);
  controller.setMinSlopeSlideAngle((k.maxSlopeDeg * Math.PI) / 180);
  controller.enableSnapToGround(k.snapDown);
  controller.setSlideEnabled(true);
  controller.setApplyImpulsesToDynamicBodies(false);

  // Parentless capsule: its world pose is set directly (a parented body's collider pose only updates in step()).
  const body = world.createCollider(RAPIER.ColliderDesc.capsule(COMBAT.capsule.halfHeight, COMBAT.capsule.radius));
  let disposed = false;

  const collide: Collide = (pos, desired) => {
    if (disposed) throw new Error("collide disposed");
    body.setTranslation(pos);
    // No snap while rising (spec section 11), same as the server.
    if (desired.y > 0) controller.disableSnapToGround();
    else controller.enableSnapToGround(k.snapDown);
    controller.computeColliderMovement(body, desired, RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC);
    const m = controller.computedMovement();
    let wallHit = false;
    for (let i = 0; i < controller.numComputedCollisions(); i++) {
      const c = controller.computedCollision(i);
      if (c && Math.abs(c.normal1.y) < WALKABLE_COS) wallHit = true;
    }
    return { corrected: { x: m.x, y: m.y, z: m.z }, grounded: controller.computedGrounded(), wallHit };
  };

  return {
    collide,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      world.removeCharacterController(controller);
      world.free();
    },
  };
}
