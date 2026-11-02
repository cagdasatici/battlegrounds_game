import { describe, expect, test } from "vitest";
import { EffectsPool } from "../../apps/client/src/scene/EffectsPool.js";
import { GLOW_BUDGET } from "../../apps/client/src/scene/GlowLayer.js";
import { playSpecialImpact, THEME } from "../../apps/client/src/fx/Impact.js";
import { ProjectileViews } from "../../apps/client/src/scene/ProjectileViews.js";
import { buildArena } from "../../apps/client/src/scene/ArenaView.js";
import { makeToonRamp } from "../../apps/client/src/scene/FighterModel.js";
import { buildIslandsMap } from "../../packages/shared/src/config/arena.js";
const { Scene, Matrix4, Vector3, Quaternion } = await import("../../apps/client/node_modules/three/build/three.module.js");

describe("VIS01 readability and shaped effects", () => {
  test("a special hit adds directional accents without another flash ball or ring stack", () => {
    const fx = new EffectsPool(); fx.configure(new Scene(), "high");
    playSpecialImpact(fx, { at: { x: 0, y: 1, z: 0 }, groundY: 0, dir: { x: 1, z: 0 }, theme: THEME.stone, power: 2 });
    expect(fx.glow.stats().flashes).toBe(0); expect(fx.glow.stats().rings).toBe(0);
    expect(fx.glow.stats().streaks).toBeGreaterThan(5);
    fx.dispose();
  });
  test("a shaped beam follows its heading and slot reuse resets the shape", () => {
    const scene = new Scene(), fx = new EffectsPool(); fx.configure(scene, "low");
    const p = { x: 0, y: 1, z: 0, vx: 0, vy: 0, vz: 0, size: 1, life: 0.5, color: 0xffffff, essential: true };
    fx.spawn({ ...p, stretch: [0.2, 0.2, 3], yaw: Math.PI / 2 });
    const mesh = scene.getObjectByName("fx.pool") as InstanceType<typeof import("../../apps/client/node_modules/three/build/three.module.js").InstancedMesh>;
    const m = new Matrix4(), q = new Quaternion(), pos = new Vector3(), scale = new Vector3();
    mesh.getMatrixAt(0, m); m.decompose(pos, q, scale);
    expect(scale.x).toBeCloseTo(0.2); expect(scale.z).toBeCloseTo(3);
    const heading = new Vector3(0, 0, 1).applyQuaternion(q); expect(heading.x).toBeCloseTo(1);
    for (let i = 0; i < fx.capacity; i++) fx.spawn(p);
    mesh.getMatrixAt(0, m); m.decompose(pos, q, scale);
    expect(scale.toArray()).toEqual([1, 1, 1]); expect(q.w).toBeCloseTo(1);
    fx.dispose();
  });
  test("curved ribbons use bounded slots, cancel by owner, and do not create scene objects", () => {
    for (const tier of ["low", "medium", "high"] as const) {
      const scene = new Scene(), fx = new EffectsPool(); fx.configure(scene, tier);
      const objects = scene.children.length;
      for (let i = 0; i < 20; i++) fx.glow.arc({ centre: { x: 0, y: 1, z: 0 }, radius: 2, start: 0, sweep: Math.PI, color: 0x37c8ff, width: 0.15, life: 0.4, owner: "caster" });
      expect(fx.glow.stats().streaks).toBeLessThanOrEqual(GLOW_BUDGET[tier].streaks);
      expect(scene.children.length).toBe(objects);
      fx.update(0.016);
      fx.glow.clearOwner("caster"); expect(fx.glow.activeCount).toBe(0);
      fx.dispose(); expect(scene.children.length).toBe(0);
    }
  });
  test("reflection changes the persistent orb core as well as the shell", () => {
    const scene = new Scene(), views = new ProjectileViews(scene);
    const p = { entityId: 1, ownerId: 1, spawnTick: 1, x: 0, y: 100, z: 0, vx: 0, vy: 0, vz: 100, chargeClass: "full", remainingTicks: 30, reflectionCount: 0 };
    views.sync([["1", p]], 1, 1);
    const group = scene.getObjectByName("ember-orb.1")!;
    const core = group.children[0] as InstanceType<typeof import("../../apps/client/node_modules/three/build/three.module.js").Mesh>;
    const before = core.material;
    views.sync([["1", { ...p, reflectionCount: 1 }]], 2, 2);
    expect(core.material).not.toBe(before);
    views.dispose(); expect(scene.children.length).toBe(0);
  });
  test("stone court stays flush and sky landmarks follow the sky dome", () => {
    const ramp = makeToonRamp(), arena = buildArena(buildIslandsMap().colliders, ramp);
    const court = arena.group.getObjectByName("deco.court") as InstanceType<typeof import("../../apps/client/node_modules/three/build/three.module.js").Mesh>;
    court.geometry.computeBoundingBox();
    expect(court.geometry.boundingBox!.max.y).toBeLessThan(0.05);
    expect(court.geometry.boundingBox!.min.y).toBeGreaterThanOrEqual(0);
    expect(arena.sky.getObjectByName("deco.horizon")).toBeDefined();
    for (const g of arena.geometries) g.dispose(); for (const m of arena.materials) m.dispose(); for (const t of arena.textures) t.dispose(); ramp.dispose();
  });
});
