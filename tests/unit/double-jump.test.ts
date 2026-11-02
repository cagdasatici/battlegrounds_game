import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { COMBAT, DOUBLE_JUMP_COUNT, DOUBLE_JUMP_VELOCITY_SCALE } from "../../packages/shared/src/config/combat.js";
import { MOVE_DT, NEUTRAL_MOVE, initialMoveState, integrateMovement, type MoveIntent } from "../../packages/shared/src/movement.js";
import { World, loadMapFile } from "../../apps/server/src/sim/World.js";
import { MovementSystem } from "../../apps/server/src/sim/Movement.js";
import { Prediction } from "../../apps/client/src/net/Prediction.js";
import { createRapierCollide, initRapier } from "../../apps/client/src/net/RapierCollide.js";
import { newAirJumps } from "../../apps/client/src/fx/AirJump.js";

const mv = (o: Partial<MoveIntent> = {}): MoveIntent => ({ ...NEUTRAL_MOVE, ...o });
const AIR_VY = COMBAT.capsule.jumpSpeed * DOUBLE_JUMP_VELOCITY_SCALE;

/** Grounded body that performs a ground jump at tick 1 and is airborne afterwards. */
function airborne() {
  const s = initialMoveState(); s.grounded = true;
  integrateMovement(s, mv({ jumpPressed: true }), 1);
  s.grounded = false;
  return s;
}

describe("DJ01 registry", () => {
  test("numbers are the decided D values", () => {
    expect(DOUBLE_JUMP_VELOCITY_SCALE).toBe(0.85);
    expect(DOUBLE_JUMP_COUNT).toBe(1);
  });
});

describe("DJ01 shared double jump (pure)", () => {
  test("ground jump then one air jump; the third press is ignored", () => {
    const s = airborne();
    const r2 = integrateMovement(s, mv({ jumpPressed: true }), 2);
    expect(r2.airJumped).toBe(true);
    expect(s.vy).toBeCloseTo(AIR_VY, 12);
    const r3 = integrateMovement(s, mv({ jumpPressed: true }), 3);
    expect(r3.airJumped).toBe(false);
    expect(r3.jumped).toBe(false);
    expect(s.vy).toBeCloseTo(AIR_VY + COMBAT.movement.gravity * MOVE_DT, 12);
  });
  test("a ground jump is not an air jump and sets no air flag", () => {
    const s = initialMoveState(); s.grounded = true;
    const r = integrateMovement(s, mv({ jumpPressed: true }), 1);
    expect(r).toMatchObject({ jumped: true, airJumped: false });
    expect(s.airJumpsUsed).toBe(0);
  });
  test("charge resets only on landing", () => {
    const s = airborne();
    integrateMovement(s, mv({ jumpPressed: true }), 2);
    expect(s.airJumpsUsed).toBe(1);
    for (let t = 3; t < 10; t++) integrateMovement(s, mv(), t);
    expect(s.airJumpsUsed).toBe(1);
    s.grounded = true; // landed
    integrateMovement(s, mv(), 10);
    expect(s.airJumpsUsed).toBe(0);
    expect(integrateMovement(s, mv({ jumpPressed: true }), 11).jumped).toBe(true); // ground jump again
    s.grounded = false;
    expect(integrateMovement(s, mv({ jumpPressed: true }), 12).airJumped).toBe(true);
  });
  test("walking off a ledge: after the coyote window one air jump is allowed, then none", () => {
    const s = initialMoveState(); s.grounded = true;
    integrateMovement(s, mv(), 100);
    s.grounded = false;
    for (let t = 101; t <= 100 + COMBAT.capsule.coyoteTicks + 1; t++) integrateMovement(s, mv(), t);
    const t = 100 + COMBAT.capsule.coyoteTicks + 2;
    const a = integrateMovement(s, mv({ jumpPressed: true }), t);
    expect(a).toMatchObject({ jumped: false, airJumped: true });
    expect(integrateMovement(s, mv({ jumpPressed: true }), t + 1).airJumped).toBe(false);
  });
  test("a coyote-window press is still the ground jump and keeps the air jump for later", () => {
    const s = initialMoveState(); s.grounded = true;
    integrateMovement(s, mv(), 100);
    s.grounded = false;
    expect(integrateMovement(s, mv({ jumpPressed: true }), 102)).toMatchObject({ jumped: true, airJumped: false });
    expect(integrateMovement(s, mv({ jumpPressed: true }), 103).airJumped).toBe(true);
  });
  test("airJumpBlocked ignores the press and does not buffer it", () => {
    const s = airborne();
    const r = integrateMovement(s, mv({ jumpPressed: true, airJumpBlocked: true }), 2);
    expect(r.airJumped).toBe(false);
    expect(s.airJumpsUsed).toBe(0);
    // Next tick the block is gone and nothing is pressed: no delayed air jump.
    expect(integrateMovement(s, mv(), 3).airJumped).toBe(false);
    expect(s.airJumpsUsed).toBe(0);
  });
  test("a held guard intent blocks the air jump", () => {
    const s = airborne();
    expect(integrateMovement(s, mv({ jumpPressed: true, guard: true }), 2).airJumped).toBe(false);
    expect(s.airJumpsUsed).toBe(0);
  });
  test("vertical velocity is SET, not added, also when falling fast and when rising fast", () => {
    for (const vy of [-30, -1, 0, 3, 20]) {
      const s = airborne();
      s.vy = vy;
      integrateMovement(s, mv({ jumpPressed: true }), 2);
      expect(s.vy).toBeCloseTo(AIR_VY, 12);
    }
  });
  test("horizontal velocity and air control are unchanged by the air jump", () => {
    const s = airborne();
    s.vx = 5;
    integrateMovement(s, mv({ jumpPressed: true, moveX: 1 }), 2);
    expect(s.vx).toBeCloseTo(5 + COMBAT.movement.acceleration * COMBAT.movement.airControl * MOVE_DT, 9);
  });
});

describe("DJ01 prediction matches the server over a jump + double jump", () => {
  let world: World; let sys: MovementSystem; let kit: ReturnType<typeof createRapierCollide>;
  beforeEach(async () => { world = await World.create(); sys = new MovementSystem(world); await initRapier(); kit = createRapierCollide(loadMapFile()); });
  afterEach(() => { sys.dispose(); world.dispose(); kit.dispose(); });

  test("positions agree every tick; the air jump lifts the apex above a single jump", () => {
    sys.add(1, [0, 0.92, 0]);
    const settle = 40;
    for (let t = 1; t <= settle; t++) sys.step(t, () => mv());
    const b = sys.get(1)!;
    const t0 = b.rb.translation();
    const pred = new Prediction(kit.collide, { x: t0.x, y: t0.y, z: t0.z }, b.state.facingYaw);
    pred.state = { ...b.state };
    const presses = new Set([settle + 1, settle + 25]); // ground jump, then air jump near the apex-to-fall transition
    let maxY = 0, worst = 0, worstAir = 0, airSeen = false;
    for (let t = settle + 1; t <= settle + 110; t++) {
      const i = mv({ jumpPressed: presses.has(t), moveX: 0.5 });
      sys.step(t, () => i);
      pred.step(t, i, t);
      const p = sys.position(1)!;
      const err = Math.hypot(p[0] - pred.pos.x, p[1] - pred.pos.y, p[2] - pred.pos.z);
      worst = Math.max(worst, err);
      if (!b.state.grounded) worstAir = Math.max(worstAir, err);
      maxY = Math.max(maxY, p[1]);
      airSeen ||= b.state.airJumpsUsed > 0;
    }
    expect(airSeen).toBe(true);
    expect(worstAir).toBeLessThan(1e-4); // in the air the two simulations are identical
    expect(worst).toBeLessThan(0.01); // ground contact jitter only (R14 allows 0.1 m)
    expect(pred.state.airJumpsUsed).toBe(b.state.airJumpsUsed);
    expect(maxY - 0.92).toBeGreaterThan(1.6); // a single 8 m/s jump peaks ~1.4 m
  });
});

describe("DJ01 client air-jump edge detector", () => {
  test("fires once per false-to-true transition and forgets removed players", () => {
    const prev = new Map<string, boolean>();
    const mk = (flag: boolean) => new Map<string, unknown>([["1", { airJumpUsed: flag }]]);
    expect(newAirJumps(mk(false), prev)).toEqual([]);
    expect(newAirJumps(mk(true), prev)).toEqual(["1"]);
    expect(newAirJumps(mk(true), prev)).toEqual([]);
    expect(newAirJumps(mk(false), prev)).toEqual([]);
    expect(newAirJumps(mk(true), prev)).toEqual(["1"]);
    newAirJumps(new Map(), prev);
    expect(prev.size).toBe(0);
  });
});
