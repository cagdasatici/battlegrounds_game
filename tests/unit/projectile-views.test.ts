import { expect, test } from "vitest";
import { GameScene } from "../../apps/client/src/scene/GameScene.js";
import { ProjectileViews, type LoopProjectile } from "../../apps/client/src/scene/ProjectileViews.js";

test("replicated flight interpolates; reflection discards incoming history; removal and disposal clear views", () => {
  const game = new GameScene({ setSize() {}, render() {}, dispose() {} }, [],
    { innerWidth: 800, innerHeight: 600, addEventListener() {}, removeEventListener() {} });
  const scene = game.scene;
  const baseline = scene.children.length;
  const views = new ProjectileViews(scene);
  const p: LoopProjectile = { entityId: 1, ownerId: 1, spawnTick: 1, x: 100, y: 200, z: 0,
    vx: 0, vy: 0, vz: 600, chargeClass: "partial", reflectionCount: 0, remainingTicks: 90 };
  views.sync([["1", p]], 10, 16);
  views.sync([["1", { ...p, z: 60 }]], 16, 19);
  expect(views.snapshot()[0]!.z).toBeCloseTo(0.3);
  views.sync([["1", { ...p, ownerId: 2, reflectionCount: 1, z: 50, vz: -600 }]], 20, 20);
  expect(views.snapshot()[0]).toMatchObject({ x: 1, y: 2, z: 0.5, ownerId: 2, reflectionCount: 1 });
  views.sync([], 21, 21);
  expect(scene.children).toHaveLength(baseline);
  views.sync([["1", p]], 22, 22);
  views.dispose(); views.dispose();
  expect(scene.children).toHaveLength(baseline);
  views.sync([["1", p]], 23, 23);
  expect(views.snapshot()).toEqual([]);
  game.dispose();
});
