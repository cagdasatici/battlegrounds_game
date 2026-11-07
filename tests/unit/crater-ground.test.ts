import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { CRATER } from "../../packages/shared/src/config/beast.js";
import { NEUTRAL_MOVE, type MoveIntent } from "../../packages/shared/src/movement.js";
import { climbScale, craterPitDepth, groundCollide, groundHeightAt, type GroundCrater } from "../../packages/shared/src/craterGround.js";
import { World } from "../../apps/server/src/sim/World.js";
import { MovementSystem } from "../../apps/server/src/sim/Movement.js";

const mv = (o: Partial<MoveIntent> = {}): MoveIntent => ({ ...NEUTRAL_MOVE, ...o });
const C: GroundCrater = { x: 0, z: 0, radius: 4 };

describe("groundHeightAt (pure)", () => {
  test("deepest at the centre inside the D band, zero at and beyond the rim, smooth and monotonic", () => {
    const d = groundHeightAt(0, 0, [C]);
    expect(-d).toBeGreaterThanOrEqual(CRATER.depthMin);
    expect(-d).toBeLessThanOrEqual(CRATER.depthMax);
    expect(d).toBeCloseTo(-craterPitDepth(4), 9);
    expect(groundHeightAt(4, 0, [C])).toBe(0);
    expect(groundHeightAt(9, 9, [C])).toBe(0);
    let prev = -Infinity;
    for (let r = 0; r <= 4; r += 0.1) { const h = groundHeightAt(r, 0, [C]); expect(h).toBeGreaterThanOrEqual(prev - 1e-12); prev = h; }
    expect(groundHeightAt(1, 0, [])).toBe(0);
  });
  test("overlapping craters use the minimum; healing and expiry restore the ground", () => {
    const a: GroundCrater = { x: 0, z: 0, radius: 4 }, b: GroundCrater = { x: 2, z: 0, radius: 6 };
    expect(groundHeightAt(1, 0, [a, b])).toBe(Math.min(groundHeightAt(1, 0, [a]), groundHeightAt(1, 0, [b])));
    const h: GroundCrater = { ...C, startTick: 100 };
    const full = groundHeightAt(0, 0, [h], 100);
    expect(groundHeightAt(0, 0, [h], 100 + CRATER.healTicks / 2)).toBeCloseTo(full / 2, 9);
    expect(groundHeightAt(0, 0, [h], 100 + CRATER.healTicks)).toBeCloseTo(0, 12);
    expect(groundHeightAt(0, 0, [])).toBe(0); // dropped from the list
  });
  test("climbing is slower, descending and level are not", () => {
    const g = (x: number, z: number): number => groundHeightAt(x, z, [C]);
    expect(climbScale(g, -2, 0, 0.05, 0)).toBe(1); // toward the centre = descending
    const up = climbScale(g, -1, 0, -0.05, 0); // away from the centre = up
    expect(up).toBeLessThan(1);
    expect(up).toBeGreaterThanOrEqual(CRATER.climbMinScale);
    expect(climbScale(g, 20, 0, 0.05, 0)).toBe(1);
  });
  test("groundCollide shears y by the ground change and slows the climb", () => {
    const g = (x: number, z: number): number => groundHeightAt(x, z, [C]);
    const inner = (p: { x: number; y: number; z: number }, d: { x: number; y: number; z: number }) => ({ corrected: { ...d }, seenY: p.y });
    const r = groundCollide(g, { x: 0, y: 0.9 + g(0, 0), z: 0 }, { x: 0.05, y: 0, z: 0 }, inner);
    expect(r.seenY).toBeCloseTo(0.9, 9); // inner runs in flat physical space
    expect(r.corrected.y).toBeGreaterThan(0); // moving outward = climbing
    expect(r.corrected.x).toBeLessThan(0.05);
  });
});

describe("server MovementSystem in a crater", () => {
  let world: World; let sys: MovementSystem; let craters: GroundCrater[];
  beforeEach(async () => {
    world = await World.create(); sys = new MovementSystem(world); craters = [];
    sys.setGround((x, z, t) => groundHeightAt(x, z, craters, t));
  });
  afterEach(() => { sys.dispose(); world.dispose(); });
  let tick = 1;
  const run = (n: number, i: (t: number) => MoveIntent): void => { for (let k = 0; k < n; k++, tick++) sys.step(tick, () => i(tick)); };
  const y = (): number => sys.position(1)![1];

  test("standing in a crater lowers Y, walking out climbs back to flat, jumping out lands on flat ground", () => {
    sys.add(1, [-8, 0.92, 0]); run(60, () => mv());
    const flat = y();
    expect(flat).toBeGreaterThan(0.88);
    craters.push({ x: -8, z: 0, radius: 4 });
    run(5, () => mv());
    expect(flat - y()).toBeGreaterThan(CRATER.depthMin - 0.05);
    expect(sys.get(1)!.state.grounded).toBe(true);
    const x0 = sys.position(1)![0];
    run(180, () => mv({ moveX: 1 })); // walk out through the lip (slowed)
    expect(sys.position(1)![0]).toBeGreaterThan(x0 + 4);
    expect(Math.abs(y() - flat)).toBeLessThan(0.05);
    expect(sys.get(1)!.state.grounded).toBe(true);
    // jump takeoff from the bowl and landing on flat ground beyond the rim
    sys.setPosition(1, [-8, flat + groundHeightAt(-8, 0, craters, tick), 0]); run(10, () => mv());
    let peak = -Infinity, jumped = false;
    for (let k = 0; k < 150; k++, tick++) { sys.step(tick, () => mv({ moveX: 1, jumpPressed: k === 0 })); peak = Math.max(peak, y()); jumped ||= !sys.get(1)!.state.grounded; }
    expect(jumped).toBe(true);
    expect(peak).toBeGreaterThan(flat + 0.2);
    expect(sys.position(1)![0]).toBeGreaterThan(-3.9);
  });

  test("climbing out is slower than walking on flat ground, and a healed/removed crater restores the ground under a stander", () => {
    sys.add(1, [-8, 0.92, 0]); run(60, () => mv());
    const flat = y();
    craters.push({ x: -8, z: 0, radius: 4, startTick: tick });
    run(2, () => mv());
    expect(y()).toBeLessThan(flat - 1);
    const a = sys.position(1)![0]; run(60, () => mv({ moveX: 1 })); const climbed = sys.position(1)![0] - a;
    sys.setPosition(1, [-8, flat, 0]); run(10, () => mv()); craters.length = 0;
    const b = sys.position(1)![0]; run(60, () => mv({ moveX: 1 })); const level = sys.position(1)![0] - b;
    expect(climbed).toBeLessThan(level);
    craters.push({ x: sys.position(1)![0], z: 0, radius: 4 });
    run(2, () => mv()); expect(y()).toBeLessThan(flat - 1);
    craters.length = 0; run(2, () => mv());
    expect(y()).toBeCloseTo(flat, 2);
  });
});
