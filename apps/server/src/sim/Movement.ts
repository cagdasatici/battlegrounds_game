import RAPIER from "@dimforge/rapier3d-compat";
import { COMBAT } from "@eb/shared/config/combat";
import { MOVE_DT, applyCorrection, initialMoveState, integrateMovement, type MoveIntent, type MoveState } from "@eb/shared/movement";
import type { MapVec3 } from "@eb/shared/config/arena";
import type { World } from "./World.js";

/** D: lift (m) applied to the capsule for straight sweeps so floor contact never blocks a horizontal move. */
const SWEEP_LIFT = 0.06;
const WALKABLE_COS = Math.cos((COMBAT.controller.maxSlopeDeg * Math.PI) / 180);

/** Forced horizontal velocity in m/s for one tick. */
export interface HorizontalOverride { vx: number; vz: number }

export interface Body {
  entityId: number;
  state: MoveState;
  rb: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  landedTick: number;
  /** Last tick in which the body touched a wall (steep surface, never the floor). -1 if never. */
  wallHitTick: number;
}

/**
 * Authoritative capsule locomotion (spec section 21). Bodies are position based kinematic capsules;
 * the Rapier character controller corrects desired translation against static geometry only
 * (kinematic player capsules are excluded so players never push each other through cover).
 * Driven solely by the caller's FixedClock step; holds no scheduler of its own.
 */
export class MovementSystem {
  private readonly bodies = new Map<number, Body>();
  private readonly controller: RAPIER.KinematicCharacterController;
  private readonly sweepShape = new RAPIER.Capsule(COMBAT.capsule.halfHeight, COMBAT.capsule.radius);
  private disposed = false;

  constructor(private readonly world: World) {
    const c = COMBAT.controller;
    this.controller = world.rapier.createCharacterController(c.offset);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    this.controller.enableAutostep(c.stepHeight, c.minStepWidth, false);
    this.controller.setMaxSlopeClimbAngle((c.maxSlopeDeg * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((c.maxSlopeDeg * Math.PI) / 180);
    this.controller.enableSnapToGround(c.snapDown);
    this.controller.setSlideEnabled(true);
    this.controller.setApplyImpulsesToDynamicBodies(false);
  }

  add(entityId: number, centre: MapVec3, facingYaw = 0): Body {
    this.remove(entityId);
    const cap = COMBAT.capsule;
    const rb = this.world.rapier.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(centre[0], centre[1], centre[2]));
    const collider = this.world.rapier.createCollider(RAPIER.ColliderDesc.capsule(cap.halfHeight, cap.radius), rb);
    const b: Body = { entityId, state: initialMoveState(facingYaw), rb, collider, landedTick: -1, wallHitTick: -1 };
    this.bodies.set(entityId, b);
    return b;
  }

  remove(entityId: number): void {
    const b = this.bodies.get(entityId);
    if (!b) return;
    this.bodies.delete(entityId);
    if (!this.disposed) this.world.rapier.removeRigidBody(b.rb); // also removes its collider
  }

  get(entityId: number): Body | undefined { return this.bodies.get(entityId); }
  get size(): number { return this.bodies.size; }

  position(entityId: number): MapVec3 | null {
    const b = this.bodies.get(entityId);
    if (!b) return null;
    const t = b.rb.nextTranslation();
    return [t.x, t.y, t.z];
  }

  /**
   * Stages one tick of movement for every body in stable entity order, then steps physics once.
   * `intentOf` returns the validated intent for this tick. `overrideOf` (combat, T09) may force a horizontal
   * velocity for this tick, e.g. a dash; gravity and collision still apply.
   */
  step(tick: number, intentOf: (entityId: number) => MoveIntent, overrideOf?: (entityId: number) => HorizontalOverride | null,
    facingOverrideOf?: (entityId: number) => number | null, holdVertical?: (entityId: number) => boolean): void {
    if (this.disposed) throw new Error("movement disposed");
    const ids = [...this.bodies.keys()].sort((a, b) => a - b);
    for (const id of ids) {
      const b = this.bodies.get(id)!;
      const desired = integrateMovement(b.state, intentOf(id), tick);
      // T19: charge and Cinder Array hold an airborne caster's vertical velocity at zero (spec 15).
      if (!b.state.grounded && holdVertical?.(id)) { b.state.vy = 0; desired.dy = 0; }
      const fo = facingOverrideOf?.(id);
      if (fo !== null && fo !== undefined && Number.isFinite(fo)) b.state.facingYaw = fo; // cast aim owns the body facing (R07)
      const o = overrideOf?.(id);
      if (o && Number.isFinite(o.vx) && Number.isFinite(o.vz)) {
        b.state.vx = o.vx; b.state.vz = o.vz;
        desired.dx = o.vx * MOVE_DT; desired.dz = o.vz * MOVE_DT;
      }
      // No snap while rising (spec section 11).
      if (b.state.vy > 0) this.controller.disableSnapToGround();
      else this.controller.enableSnapToGround(COMBAT.controller.snapDown);
      this.controller.computeColliderMovement(b.collider, { x: desired.dx, y: desired.dy, z: desired.dz },
        RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC);
      const m = this.controller.computedMovement();
      const corrected = { x: m.x, y: m.y, z: m.z };
      // A wall contact is any collision whose normal is steeper than the walkable slope limit.
      let wallHit = false;
      for (let k = 0; k < this.controller.numComputedCollisions(); k++) {
        const c = this.controller.computedCollision(k);
        if (c && Math.abs(c.normal1.y) < WALKABLE_COS) wallHit = true;
      }
      const { landed } = applyCorrection(b.state, desired, corrected, this.controller.computedGrounded(), wallHit);
      if (landed) b.landedTick = tick;
      if (wallHit) b.wallHitTick = tick;
      const p = b.rb.translation();
      b.rb.setNextKinematicTranslation({ x: p.x + corrected.x, y: p.y + corrected.y, z: p.z + corrected.z });
    }
    this.world.step();
  }

  /**
   * Displaces every listed body by the same horizontal vector (T13 drag moves). The fraction of the move that is
   * free for each body is found with a straight, non-sliding sweep against static geometry; every body is then
   * displaced by the smallest fraction, so the group stops together at the first wall and nothing tunnels.
   * Vertical position is left to the next locomotion step (gravity, snap). Callable between ticks only.
   */
  moveTogether(entityIds: readonly number[], dx: number, dz: number): { dx: number; dz: number } {
    const len = Math.hypot(dx, dz);
    const bodies = entityIds.map((id) => this.bodies.get(id)).filter((b): b is Body => !!b);
    if (!(len > 1e-9) || !Number.isFinite(len) || bodies.length === 0) return { dx: 0, dz: 0 };
    let frac = 1;
    for (const b of bodies) {
      // Cast the capsule, lifted off the floor so floor contact cannot stop a horizontal move, along the move.
      const t = b.rb.translation();
      const hit = this.world.rapier.castShape({ x: t.x, y: t.y + SWEEP_LIFT, z: t.z }, { x: 0, y: 0, z: 0, w: 1 },
        { x: dx, y: 0, z: dz }, this.sweepShape, COMBAT.controller.offset, 1, true, RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC);
      if (hit) frac = Math.min(frac, Math.max(0, Math.min(1, hit.time_of_impact)));
    }
    if (frac < 1e-6) return { dx: 0, dz: 0 };
    for (const b of bodies) {
      const t = b.rb.translation();
      const p = { x: t.x + dx * frac, y: t.y, z: t.z + dz * frac };
      b.rb.setTranslation(p, true);
      b.rb.setNextKinematicTranslation(p);
    }
    return { dx: dx * frac, dz: dz * frac };
  }

  /** Sets a body's velocity (launch); leaves the ground when moving upward. */
  setVelocity(entityId: number, vx: number, vy: number, vz: number): void {
    const b = this.bodies.get(entityId);
    if (!b || !Number.isFinite(vx + vy + vz)) return;
    b.state.vx = vx; b.state.vz = vz; b.state.vy = vy;
    if (vy > 0) b.state.grounded = false;
  }

  dispose(): void {
    if (this.disposed) return;
    for (const id of [...this.bodies.keys()]) this.remove(id);
    this.disposed = true;
    this.world.rapier.removeCharacterController(this.controller);
  }
}
