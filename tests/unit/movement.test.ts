import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { COMBAT } from "../../packages/shared/src/config/combat.js";
import { MOVE_DT, NEUTRAL_MOVE, initialMoveState, integrateMovement, sanitizeIntent, type MoveIntent } from "../../packages/shared/src/movement.js";
import { World } from "../../apps/server/src/sim/World.js";
import { MovementSystem } from "../../apps/server/src/sim/Movement.js";
import { FixedClock, STEP_MS } from "../../apps/server/src/sim/FixedClock.js";

const mv = (o: Partial<MoveIntent> = {}): MoveIntent => ({ ...NEUTRAL_MOVE, ...o });

describe("shared integrateMovement (pure)", () => {
  test("accelerates at COMBAT.movement.acceleration to walk speed and caps there", () => {
    const s = initialMoveState(); s.grounded = true;
    integrateMovement(s, mv({ moveX: 1 }), 1);
    expect(s.vx).toBeCloseTo(COMBAT.movement.acceleration * MOVE_DT, 9);
    for (let t = 2; t < 60; t++) integrateMovement(s, mv({ moveX: 1 }), t);
    expect(s.vx).toBeCloseTo(COMBAT.movement.walk, 9);
  });
  test("run and guard gaits; guard wins", () => {
    for (const [i, v] of [[mv({ moveZ: -1, run: true }), COMBAT.movement.run], [mv({ moveZ: -1, run: true, guard: true }), COMBAT.movement.guard]] as const) {
      const s = initialMoveState(); s.grounded = true;
      for (let t = 1; t < 60; t++) integrateMovement(s, i, t);
      expect(Math.hypot(s.vx, s.vz)).toBeCloseTo(v, 9);
    }
  });
  test("air control is 30 percent", () => {
    const s = initialMoveState(); s.grounded = false;
    integrateMovement(s, mv({ moveX: 1 }), 1);
    expect(s.vx).toBeCloseTo(COMBAT.movement.acceleration * 0.3 * MOVE_DT, 9);
  });
  test("non-finite and oversize intents are sanitised", () => {
    expect(sanitizeIntent(mv({ moveX: Number.NaN, moveZ: Infinity }))).toMatchObject({ moveX: 0, moveZ: 0 });
    const k = sanitizeIntent(mv({ moveX: 3, moveZ: 4 }));
    expect(Math.hypot(k.moveX, k.moveZ)).toBeCloseTo(1, 12);
  });
  test("gravity -24 m/s^2 in air; jump speed 8", () => {
    const s = initialMoveState(); s.grounded = true;
    const r = integrateMovement(s, mv({ jumpPressed: true }), 10);
    expect(r.jumped).toBe(true);
    expect(s.vy).toBe(8);
    s.grounded = false;
    integrateMovement(s, mv(), 11);
    expect(s.vy).toBeCloseTo(8 - 24 * MOVE_DT, 9);
  });
  test("no double jump while airborne", () => {
    const s = initialMoveState(); s.grounded = true;
    integrateMovement(s, mv({ jumpPressed: true }), 1);
    s.grounded = false;
    expect(integrateMovement(s, mv({ jumpPressed: true }), 2).jumped).toBe(false);
  });
  test("coyote: jump allowed 6 ticks after leaving ground, not 7", () => {
    for (const [late, ok] of [[6, true], [7, false]] as const) {
      const s = initialMoveState(); s.grounded = true;
      integrateMovement(s, mv(), 100);
      s.grounded = false;
      for (let t = 101; t < 100 + late; t++) integrateMovement(s, mv(), t);
      expect(integrateMovement(s, mv({ jumpPressed: true }), 100 + late).jumped).toBe(ok);
    }
  });
  test("jump buffer: press up to 6 ticks before landing fires on landing; 7 expires", () => {
    for (const [early, ok] of [[6, true], [7, false]] as const) {
      // DJ01: with the air jump still available an airborne press is an air jump, so exhaust it to test the ground buffer.
      const s = initialMoveState(); s.grounded = false; s.airJumpsUsed = 1;
      integrateMovement(s, mv({ jumpPressed: true }), 200);
      for (let t = 201; t < 200 + early; t++) integrateMovement(s, mv(), t);
      s.grounded = true;
      expect(integrateMovement(s, mv(), 200 + early).jumped).toBe(ok);
    }
  });
  test("facing turns toward movement at <= 540 deg/s; stationary keeps facing", () => {
    const s = initialMoveState(0); s.grounded = true;
    integrateMovement(s, mv({ moveX: 1 }), 1); // target yaw -pi/2
    expect(Math.abs(s.facingYaw)).toBeCloseTo((540 * Math.PI / 180) * MOVE_DT, 9);
    const f = s.facingYaw;
    integrateMovement(s, mv(), 2);
    expect(s.facingYaw).toBe(f);
  });
});

describe("server MovementSystem against the islands collision world", () => {
  let world: World;
  let sys: MovementSystem;
  beforeEach(async () => { world = await World.create(); sys = new MovementSystem(world); });
  afterEach(() => { sys.dispose(); world.dispose(); });

  const run = (ticks: number, intent: (t: number) => MoveIntent, from = 1): number => {
    for (let t = from; t < from + ticks; t++) sys.step(t, () => intent(t));
    return from + ticks;
  };

  test("settles on the ground at capsule centre 0.9 m and becomes grounded", () => {
    sys.add(1, [0, 1.5, 0]);
    run(90, () => mv());
    const p = sys.position(1)!;
    expect(p[1]).toBeGreaterThan(0.88);
    expect(p[1]).toBeLessThan(0.95);
    expect(sys.get(1)!.state.grounded).toBe(true);
    expect(sys.get(1)!.landedTick).toBeGreaterThan(0);
  });

  test("walks at COMBAT.movement.walk on open ground", () => {
    sys.add(1, [-8, 0.92, 0]); // start far enough from the wall at x=10 to cover the whole walk
    let t = run(30, () => mv());
    const x0 = sys.position(1)![0];
    t = run(30, () => mv({ moveX: 1 }), t); // ~0.11 s accelerate, then constant
    run(60, () => mv({ moveX: 1 }), t);
    const dx = sys.position(1)![0] - x0;
    const ideal = COMBAT.movement.walk * 1.5;
    // 90 ticks: the acceleration phase loses walk^2/(2*accel) of the ideal distance
    expect(dx).toBeGreaterThan(ideal - COMBAT.movement.walk ** 2 / (2 * COMBAT.movement.acceleration) - 0.1);
    expect(dx).toBeLessThan(ideal + 0.01);
  });

  test("wall blocks movement: wall.1 at x=16 spans z -0.3..0.3, height 1.2", () => {
    sys.add(1, [16, 0.92, -3]);
    run(240, () => mv({ moveZ: 1 })); // 4 s toward +Z into the wall
    const p = sys.position(1)!;
    expect(p[2]).toBeLessThan(-0.3 - COMBAT.capsule.radius + 0.01);
    expect(p[2]).toBeGreaterThan(-0.3 - COMBAT.capsule.radius - 0.1);
    expect(p[0]).toBeCloseTo(16, 1);
    expect(world.capsuleOverlaps(p, COMBAT.capsule.radius, COMBAT.capsule.halfHeight).filter((id) => id.startsWith("wall"))).toEqual([]);
  });

  test("pillar blocks a diagonal approach (slides, never penetrates)", () => {
    sys.add(1, [12, 0.92, -14]);
    for (let t = 1; t <= 300; t++) {
      sys.step(t, () => mv({ moveZ: 1 }));
      const p = sys.position(1)!;
      expect(world.capsuleOverlaps(p, COMBAT.capsule.radius - 0.01, COMBAT.capsule.halfHeight).filter((id) => id.startsWith("pillar"))).toEqual([]);
    }
  });

  test("jump rises ~v^2/2g = 1.33 m and lands; holding jump does not re-jump", () => {
    sys.add(1, [0, 0.92, 0]);
    let t = run(30, () => mv());
    const y0 = sys.position(1)![1];
    let maxY = y0;
    sys.step(t++, () => mv({ jumpPressed: true }));
    for (let i = 0; i < 90; i++) { sys.step(t++, () => mv()); maxY = Math.max(maxY, sys.position(1)![1]); }
    expect(maxY - y0).toBeGreaterThan(1.2);
    expect(maxY - y0).toBeLessThan(1.45); // + ~v*dt/2 discrete-step overshoot
    expect(sys.position(1)![1]).toBeCloseTo(y0, 1);
    expect(sys.get(1)!.state.grounded).toBe(true);
  });

  test("player capsules are filtered out of movement collision (overlap allowed)", () => {
    sys.add(1, [0, 0.92, 0]);
    sys.add(2, [1, 0.92, 0]);
    run(30, () => mv());
    run(30, (t) => (t > 0 ? mv({ moveX: 1 }) : mv()));
    run(60, () => mv());
    expect(sys.position(1)![0]).toBeGreaterThan(1.5); // passed through body 2's start
  });

  test("walking off the island edge falls under gravity", () => {
    sys.add(1, [8, 0.92, 38]); // x=8 avoids the south bridge (width 4 at x=0); the island edge is at z=45 (ARENA01)
    run(120, () => mv({ moveZ: 1 }));
    const b = sys.get(1)!;
    expect(b.state.grounded).toBe(false);
    expect(sys.position(1)![1]).toBeLessThan(0);
    expect(b.state.vy).toBeLessThan(-5);
  });

  test("remove and dispose free bodies and are idempotent", () => {
    sys.add(1, [0, 0.92, 0]);
    sys.remove(1); sys.remove(1);
    expect(sys.size).toBe(0);
    expect(world.capsuleOverlaps([0, 0.92, 0], 0.35, 0.55)).toEqual([]);
  });

  test("driven by FixedClock: 1 s of wall time in odd chunks yields exactly 60 movement ticks", () => {
    sys.add(1, [0, 0.92, 0]);
    const clock = new FixedClock();
    let n = 0;
    const chunks = [7, 23, 16.7, 40, 13, 60, 3, 50, 80, 20, 33.3, 70, 9, 75, 1000 - 500];
    for (const c of chunks.slice(0, -1)) clock.advance(c, (tick) => { n++; sys.step(tick, () => mv()); });
    // Remaining 500 ms delivered at a steady 1/60 s cadence (each callback within the 5 step catch-up cap).
    for (let i = 0; i < 30; i++) clock.advance(STEP_MS, (tick) => { n++; sys.step(tick, () => mv()); });
    expect(clock.overloads).toBe(0);
    expect(clock.tick).toBe(n);
    expect(n).toBeGreaterThanOrEqual(59); // float accumulation may leave the last step pending
    expect(n).toBeLessThanOrEqual(60);
  });
});
