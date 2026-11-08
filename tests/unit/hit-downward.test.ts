import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { shapeOverlaps, type AbilityPose } from "../../apps/server/src/sim/AbilityRunner.js";
import { m1Overlaps, type M1Pose } from "../../apps/server/src/sim/M1.js";
import { groundHeightAt, type GroundCrater } from "../../packages/shared/src/craterGround.js";
import { World } from "../../apps/server/src/sim/World.js";
import { MovementSystem } from "../../apps/server/src/sim/Movement.js";
import { craterAwareBlocked } from "../../apps/server/src/sim/Movement.js";

const A: AbilityPose = { x: 0, y: 1, z: 0 } as AbilityPose;
const at = (x: number, y: number, z: number): AbilityPose => ({ ...A, x, y, z });
// aimYaw 0 faces -z or +z depending on forwardOf; probe both signs via helper.
const anyDir = (f: (z: number) => boolean): boolean => f(1) || f(-1);

describe("shapeOverlaps is one-sided vertically", () => {
  const box = { kind: "box", w: 2, d: 3, h: 1.2 } as never;
  const sphere = { kind: "sphere", r: 1.5 } as never;
  const beam = { kind: "beam", length: 8, radius: 0.5 } as never;
  for (const [name, shape, range] of [["box", box, 0], ["sphere", sphere, 2], ["beam", beam, 0]] as const) {
    test(`${name}: 1.8 m lower hits, out of horizontal range misses, well above misses`, () => {
      expect(anyDir((s) => shapeOverlaps(shape, range, A, s > 0 ? Math.PI : 0, at(0, 1 - 1.8, 2 * s), 8))).toBe(true);
      expect(anyDir((s) => shapeOverlaps(shape, range, A, s > 0 ? Math.PI : 0, at(20, 1 - 1.8, 2 * s), 8))).toBe(false);
      expect(anyDir((s) => shapeOverlaps(shape, range, A, s > 0 ? Math.PI : 0, at(0, 1 + 4, 2 * s), 8))).toBe(false);
    });
  }
});

describe("m1Overlaps is one-sided vertically", () => {
  const p = (x: number, y: number, z: number, facingYaw = 0): M1Pose => ({ x, y, z, facingYaw, grounded: true } as M1Pose);
  test("target 1.8 m lower hits, far misses, well above misses", () => {
    expect(m1Overlaps(p(0, 1, 0), p(0, -0.8, -1), null)).toBe(true);
    expect(m1Overlaps(p(0, 1, 0), p(30, -0.8, -1), null)).toBe(false);
    expect(m1Overlaps(p(0, 1, 0), p(0, 5, -1), null)).toBe(false);
  });
});

describe("line of sight converts crater offset to physical y", () => {
  let world: World; let sys: MovementSystem; const craters: GroundCrater[] = [{ x: 0, z: 0, radius: 4 }];
  beforeEach(async () => {
    world = await World.create(); sys = new MovementSystem(world);
    sys.setGround((x, z, t) => groundHeightAt(x, z, craters, t));
  });
  afterEach(() => { sys.dispose(); world.dispose(); });
  test("a shot into a bowl is not blocked by the flat slab; raw world coords would be", () => {
    const off = groundHeightAt(0, 0, craters, 0);
    expect(off).toBeLessThan(-0.5);
    const from: [number, number, number] = [-3.5, 1.2, 0]; // rim edge, standing height
    const to: [number, number, number] = [0, 0.9 + off, 0]; // bowl floor
    expect(world.segmentBlocked(from, to)).toBe(true); // raw world coords hit the flat slab
    expect(craterAwareBlocked(world, sys, from, to)).toBe(false);
  });
});
