/**
 * Pure fixed-step locomotion integration (spec sections 11 and 21). Shared by server authority and,
 * later, client prediction (T08). No DOM, Three.js, Rapier or Node APIs: collision correction is
 * applied by the caller's character controller after `integrateMovement` returns a desired translation.
 * All timers are integer ticks; dt is fixed and never supplied by a client.
 */
import { COMBAT } from "./config/combat.js";
import { TICK_RATE } from "./protocol.js";

export const MOVE_DT = 1 / TICK_RATE;

/**
 * Minimal validated movement intent for one logical tick. moveX/moveZ are a world-space horizontal
 * direction with magnitude <= 1 (the client resolves its camera-relative stick vector using camera yaw
 * before sending; D, see docs/test-results/T06.md). jumpPressed is true on the tick a jump edge is drained.
 */
export interface MoveIntent {
  moveX: number;
  moveZ: number;
  run: boolean;
  guard: boolean;
  jumpPressed: boolean;
  /** Optional camera-facing intent; rate-limited by the same authority step. */
  aimYaw?: number;
}

export const NEUTRAL_MOVE: Readonly<MoveIntent> = { moveX: 0, moveZ: 0, run: false, guard: false, jumpPressed: false };

/** Per-body locomotion state. Ticks are integers; -1 means "never". */
export interface MoveState {
  vx: number; vy: number; vz: number;
  grounded: boolean;
  /** Last tick the body was grounded (coyote window). */
  lastGroundedTick: number;
  /** Tick of the latest unconsumed jump press (jump buffer). */
  jumpPressTick: number;
  /** True after a jump until the body is grounded again; prevents double jump. */
  jumpedSinceGrounded: boolean;
  facingYaw: number;
}

export function initialMoveState(facingYaw = 0): MoveState {
  return { vx: 0, vy: 0, vz: 0, grounded: false, lastGroundedTick: -1, jumpPressTick: -1, jumpedSinceGrounded: false, facingYaw };
}

/** Speed for the requested gait. Guard wins over run. */
export function gaitSpeed(i: MoveIntent): number {
  const m = COMBAT.movement;
  return i.guard ? m.guard : i.run ? m.run : m.walk;
}

/** Sanitises an intent: non-finite components become zero, magnitude is clamped to 1. */
export function sanitizeIntent(i: MoveIntent): MoveIntent {
  let x = Number.isFinite(i.moveX) ? i.moveX : 0;
  let z = Number.isFinite(i.moveZ) ? i.moveZ : 0;
  const len = Math.hypot(x, z);
  if (len > 1) { x /= len; z /= len; }
  return { moveX: x, moveZ: z, run: i.run === true, guard: i.guard === true, jumpPressed: i.jumpPressed === true, ...(Number.isFinite(i.aimYaw) ? { aimYaw: i.aimYaw } : {}) };
}

const TURN_RATE = (540 * Math.PI) / 180; // rad/s, spec section 7 facing lock off (D)

function turnToward(from: number, to: number, maxDelta: number): number {
  let d = to - from;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  if (Math.abs(d) <= maxDelta) return to;
  return from + Math.sign(d) * maxDelta;
}

/**
 * Advances velocity by one tick and returns the desired translation for the character controller.
 * Mutates `s`. `tick` is the current logical tick. Grounded state is from the previous controller pass.
 */
export function integrateMovement(s: MoveState, rawIntent: MoveIntent, tick: number): { dx: number; dy: number; dz: number; jumped: boolean } {
  const i = sanitizeIntent(rawIntent);
  const m = COMBAT.movement;
  const cap = COMBAT.capsule;
  if (i.jumpPressed) s.jumpPressTick = tick;
  if (s.grounded) { s.lastGroundedTick = tick; s.jumpedSinceGrounded = false; }

  // Horizontal: approach desired velocity by acceleration*dt; 30 percent authority in the air.
  const speed = gaitSpeed(i);
  const accel = m.acceleration * (s.grounded ? 1 : m.airControl) * MOVE_DT;
  const tx = i.moveX * speed, tz = i.moveZ * speed;
  const dvx = tx - s.vx, dvz = tz - s.vz;
  const dl = Math.hypot(dvx, dvz);
  if (dl <= accel) { s.vx = tx; s.vz = tz; } else { s.vx += (dvx / dl) * accel; s.vz += (dvz / dl) * accel; }

  // Jump: buffered press within window, grounded or within coyote window, one jump per grounding.
  let jumped = false;
  const buffered = s.jumpPressTick >= 0 && tick - s.jumpPressTick <= cap.jumpBufferTicks;
  const coyote = s.lastGroundedTick >= 0 && tick - s.lastGroundedTick <= cap.coyoteTicks;
  if (buffered && coyote && !s.jumpedSinceGrounded) {
    s.vy = cap.jumpSpeed;
    s.jumpPressTick = -1;
    s.jumpedSinceGrounded = true;
    s.grounded = false;
    jumped = true;
  } else if (s.grounded) {
    s.vy = Math.max(0, s.vy); // resting contact: no accumulated fall speed
  } else {
    s.vy += m.gravity * MOVE_DT;
  }

  if (i.aimYaw !== undefined) {
    s.facingYaw = turnToward(s.facingYaw, i.aimYaw, 4 * Math.PI * MOVE_DT);
  } else if (i.moveX !== 0 || i.moveZ !== 0) {
    // Local forward is -Z: yaw 0 faces -Z, so yaw = atan2(-x, -z).
    s.facingYaw = turnToward(s.facingYaw, Math.atan2(-i.moveX, -i.moveZ), TURN_RATE * MOVE_DT);
  }
  return { dx: s.vx * MOVE_DT, dy: s.vy * MOVE_DT, dz: s.vz * MOVE_DT, jumped };
}

/**
 * Applies the controller result. Grounded clears downward speed; a blocked rise (ceiling) clears upward
 * speed; horizontal motion blocked by a wall (steeper than the slope limit) keeps only the achieved
 * horizontal velocity. Ground contacts never cancel horizontal speed.
 */
export function applyCorrection(
  s: MoveState,
  desired: { dx: number; dy: number; dz: number },
  corrected: { x: number; y: number; z: number },
  grounded: boolean,
  wallHit = true,
): { landed: boolean } {
  const wasGrounded = s.grounded;
  const priorVy = s.vy;
  s.grounded = grounded;
  if (grounded && s.vy < 0) s.vy = 0;
  if (desired.dy > 0 && corrected.y < desired.dy - 1e-4) s.vy = 0; // ceiling
  const eps = 1e-5;
  if (wallHit && Math.abs(corrected.x - desired.dx) > eps) s.vx = corrected.x / MOVE_DT;
  if (wallHit && Math.abs(corrected.z - desired.dz) > eps) s.vz = corrected.z / MOVE_DT;
  return { landed: !wasGrounded && grounded && priorVy < 0 };
}
