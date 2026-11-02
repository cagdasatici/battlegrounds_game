import { describe, expect, test } from "vitest";
import type { Scene } from "three";
import { EffectsPool, POOL_CAPACITY } from "../../apps/client/src/scene/EffectsPool.js";
import { FighterView } from "../../apps/client/src/scene/FighterView.js";
import { makeToonRamp } from "../../apps/client/src/scene/FighterModel.js";
import { CameraRig } from "../../apps/client/src/scene/CameraRig.js";
import { planFor, playHit, type HitFxIo } from "../../apps/client/src/fx/HitFx.js";
import type { CombatEvent } from "../../packages/shared/src/protocol.js";

// `three` resolves only from apps/client, so borrow a Group (an Object3D, which is all the pool needs) from a FighterView.
const Scene = function (): Scene { const g = new FighterView("sv", makeToonRamp()).group; g.clear(); return g as unknown as Scene; } as unknown as new () => Scene;
const P = { x: 0, y: 1, z: 0, vx: 0, vy: 0, vz: 0, life: 1, size: 0.1, color: 0xffffff };
const ev = (over: Partial<CombatEvent>): CombatEvent => ({ eventId: "e", tick: 1, kind: "hit", actorId: "1", targetId: "2", lifeId: 1, position: { x: 1, y: 1, z: 1 }, ...over });

describe("EffectsPool", () => {
  test("capacity per tier, cap holds, oldest overwritten", () => {
    for (const tier of ["low", "medium", "high"] as const) {
      const pool = new EffectsPool();
      pool.configure(new Scene(), tier);
      expect(pool.capacity).toBe(POOL_CAPACITY[tier]);
      for (let i = 0; i < POOL_CAPACITY[tier] + 50; i++) pool.spawn(P);
      expect(pool.activeCount).toBe(POOL_CAPACITY[tier]);
      pool.dispose();
    }
  });
  test("particles expire after their life in render seconds", () => {
    const pool = new EffectsPool();
    pool.configure(new Scene(), "low");
    pool.spawn({ ...P, life: 0.25 });
    pool.spawn({ ...P, life: 1 });
    for (let i = 0; i < 4; i++) pool.update(0.05);
    expect(pool.activeCount).toBe(2);
    for (let i = 0; i < 2; i++) pool.update(0.05);
    expect(pool.activeCount).toBe(1);
    for (let i = 0; i < 30; i++) pool.update(0.05);
    expect(pool.activeCount).toBe(0);
  });
  test("dispose removes the mesh, runs registered disposers once and stops spawning", () => {
    const scene = new Scene();
    const pool = new EffectsPool();
    pool.configure(scene, "low");
    let n = 0;
    pool.register(() => { n += 1; });
    expect(scene.children.length).toBe(1);
    pool.dispose(); pool.dispose();
    expect(scene.children.length).toBe(0);
    expect(n).toBe(1);
    expect(pool.spawn(P)).toBe(false);
    expect(pool.activeCount).toBe(0);
  });
  test("same tier configure keeps live particles, tier change replaces them", () => {
    const scene = new Scene();
    const pool = new EffectsPool();
    pool.configure(scene, "low");
    pool.spawn(P);
    pool.configure(scene, "low");
    expect(pool.activeCount).toBe(1);
    pool.configure(scene, "high");
    expect(pool.activeCount).toBe(0);
    expect(scene.children.length).toBe(1);
    pool.dispose();
  });
});

describe("FighterView flash and freeze", () => {
  test("flash amount scales with flashLevel and fades out; level 0 still flashes", () => {
    const v = new FighterView("sv", makeToonRamp());
    v.flash(0xff3b3b, 100, 0.3);
    expect(v.flashing).toBe(true);
    expect(v.flashAmount).toBeCloseTo(0.3, 5);
    const body = v.group.children.find((c) => c.name.endsWith(".body")) as unknown as { material: { emissive: { r: number } } };
    expect(body.material.emissive.r).toBeGreaterThan(0);
    v.update(0.05);
    expect(v.flashAmount).toBeCloseTo(0.15, 2);
    v.update(0.06);
    expect(v.flashing).toBe(false);
    expect(body.material.emissive.r).toBe(0);
    v.flash(0xff3b3b, 100, 0);
    expect(v.flashing).toBe(true);
    expect(v.flashAmount).toBe(0);
    v.dispose();
  });
  test("freeze lasts N render frames", () => {
    const v = new FighterView("td", makeToonRamp());
    v.freeze(4);
    for (let i = 0; i < 3; i++) v.update(1 / 60);
    expect(v.frozen).toBe(true);
    v.update(1 / 60);
    expect(v.frozen).toBe(false);
    v.dispose();
  });
});

describe("CameraRig shake", () => {
  const run = (cam: CameraRig, n: number) => { let moved = false; for (let i = 0; i < n; i++) { const a = cam.update({ x: 0, y: 0, z: 0 }, 0, 0, 1 / 60).position; if (Math.abs(a.x) > 1e-6 || Math.abs(a.z - 6.5) > 1e-6) moved = true; } return moved; };
  test("shake moves the camera then settles", () => {
    const cam = new CameraRig([]);
    cam.shake(0.35, 180);
    expect(cam.shaking).toBe(true);
    expect(run(cam, 5)).toBe(true);
    run(cam, 20);
    expect(cam.shaking).toBe(false);
    expect(run(cam, 2)).toBe(false);
  });
  test("Reduced Motion produces zero shake", () => {
    const cam = new CameraRig([]);
    cam.reducedMotion = true;
    cam.shake(0.35, 180);
    expect(cam.shaking).toBe(false);
    expect(run(cam, 10)).toBe(false);
  });
});

describe("HitFx table and playback", () => {
  const rig = (local?: string) => {
    const pool = new EffectsPool(); pool.configure(new Scene(), "medium");
    const calls: string[] = [];
    const f = (id: string) => ({ flash: (c: number, ms: number, l?: number) => calls.push(`flash:${id}:${c.toString(16)}:${ms}:${l}`), freeze: (n: number) => calls.push(`freeze:${id}:${n}`) });
    const io: HitFxIo = {
      effects: pool, fighterOf: f, chestOf: (id) => ({ x: id === "1" ? 0 : 2, y: 1, z: 0 }),
      shake: (a, ms) => calls.push(`shake:${a}:${ms}`), flashLevel: () => 0.3, localId: () => local,
    };
    return { pool, calls, io };
  };
  test("light hit: 10 sparks, red 90 ms victim flash, no hitstop, no shake", () => {
    const t = rig("1");
    expect(planFor({ kind: "hit", hitClass: "light" })).toMatchObject({ burst: { count: 10 } });
    playHit(ev({ hitClass: "light" }), t.io);
    expect(t.pool.activeCount).toBe(10);
    expect(t.calls).toEqual(["flash:2:ff3b3b:90:0.3"]);
  });
  test("heavy hit: 24 sparks plus ring, hitstop on both, shake only when the local player is involved", () => {
    const a = rig("1");
    playHit(ev({ hitClass: "heavy" }), a.io);
    expect(a.pool.activeCount).toBe(24 + 16);
    expect(a.calls).toEqual(["flash:2:ff3b3b:140:0.3", "freeze:2:4", "freeze:1:4", "shake:0.35:180"]);
    const b = rig("9");
    playHit(ev({ hitClass: "heavy" }), b.io);
    expect(b.calls.some((c) => c.startsWith("shake"))).toBe(false);
  });
  test("block: shield arc, no flash, small shake for involved local only", () => {
    const t = rig("2");
    playHit(ev({ kind: "block" }), t.io);
    expect(t.pool.activeCount).toBe(7);
    expect(t.calls).toEqual(["shake:0.1:80"]);
  });
  test("counter: gold flash on the countered attacker and hitstop 6 on both", () => {
    const t = rig();
    playHit(ev({ kind: "counter" }), t.io);
    expect(t.calls).toEqual(["flash:1:ffcc33:160:0.3", "freeze:2:6", "freeze:1:6"]);
    expect(t.pool.activeCount).toBe(16 + 16);
  });
  test("heal: 12 motes and a green 200 ms flash; ko: dust and column, no flash", () => {
    const h = rig();
    playHit(ev({ kind: "heal", actorId: "2", targetId: undefined }), h.io);
    expect(h.pool.activeCount).toBe(12);
    expect(h.calls).toEqual(["flash:2:4dff88:200:0.3"]);
    const k = rig();
    playHit(ev({ kind: "ko" }), k.io);
    expect(k.pool.activeCount).toBe(22);
    expect(k.calls).toEqual([]);
  });
  test("missing position falls back to the target chest; unknown kinds and positionless unknown entities do nothing", () => {
    const t = rig();
    playHit(ev({ position: undefined }), t.io);
    expect(t.pool.activeCount).toBe(10);
    playHit(ev({ kind: "cast" }), t.io);
    playHit(ev({ kind: "capture" }), t.io);
    expect(t.pool.activeCount).toBe(10);
    const none = rig();
    none.io.chestOf = () => undefined;
    playHit(ev({ position: undefined }), none.io);
    expect(none.pool.activeCount).toBe(0);
  });
});
