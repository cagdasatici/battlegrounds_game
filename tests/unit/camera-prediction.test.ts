import { describe, expect, test } from "vitest";
import { COMBAT } from "../../packages/shared/src/config/combat.js";
import type { Collider } from "../../packages/shared/src/config/arena.js";
import { NEUTRAL_MOVE, type MoveIntent } from "../../packages/shared/src/movement.js";
import { parseInputPacket } from "../../packages/shared/src/index.js";
import { CAMERA, CameraRig, cameraRelativeToWorld, sphereCast } from "../../apps/client/src/scene/CameraRig.js";
import { Prediction, PREDICTION, type Collide, type OwnerSnapshot } from "../../apps/client/src/net/Prediction.js";
import { ClockSync } from "../../apps/client/src/net/ClockSync.js";
import { SnapshotBuffer } from "../../apps/client/src/net/SnapshotBuffer.js";
import { PointerRouter } from "../../apps/client/src/input/PointerRouter.js";
import { IntentSampler } from "../../apps/client/src/input/IntentSampler.js";

const near = (a: number, b: number, e = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(e);

// Fake controller: floor with capsule centre at y=0.9; wall blocks centre x beyond WALL_X.
const FLOOR = 0.9, WALL_X = 3;
const collide: Collide = (p, d) => {
  let x = d.x, y = d.y, wallHit = false;
  if (p.x + x > WALL_X) { x = Math.max(0, WALL_X - p.x); wallHit = true; }
  let grounded = false;
  if (p.y + y <= FLOOR) { y = FLOOR - p.y; grounded = true; }
  return { corrected: { x, y, z: d.z }, grounded, wallHit };
};
const fwd: MoveIntent = { moveX: 0, moveZ: -1, run: false, guard: false, jumpPressed: false };
const right: MoveIntent = { ...fwd, moveX: 1, moveZ: 0 };
const snapOf = (p: Prediction, tick: number, over: Partial<OwnerSnapshot> = {}): OwnerSnapshot => ({
  serverTick: tick, x: p.pos.x, y: p.pos.y, z: p.pos.z, vx: p.state.vx, vy: p.state.vy, vz: p.state.vz,
  facingYaw: p.state.facingYaw, action: "Idle", ...over,
});

function run(p: Prediction, from: number, to: number, i: MoveIntent, sampleEvery = 1, start = from): void {
  for (let t = from; t <= to; t++) p.step(t, i, t - ((t - start) % sampleEvery));
}

describe("Prediction reconciliation (section 22)", () => {
  test("matching authority replays to the same pose with no correction", () => {
    const p = new Prediction(collide, { x: 0, y: FLOOR, z: 0 });
    run(p, 1, 10, fwd);
    const ref = new Prediction(collide, { x: 0, y: FLOOR, z: 0 });
    run(ref, 1, 5, fwd);
    expect(p.reconcile(snapOf(ref, 5))).toBe("none");
    expect(p.bufferedTicks).toBe(5);
  });

  test("small error eases over 6 frames; simulation pose corrected immediately", () => {
    const p = new Prediction(collide, { x: 0, y: FLOOR, z: 0 });
    run(p, 1, 10, fwd);
    const ref = new Prediction(collide, { x: 0, y: FLOOR, z: 0 });
    run(ref, 1, 5, fwd);
    const before = { ...p.pos };
    expect(p.reconcile(snapOf(ref, 5, { x: ref.pos.x + 0.05 }))).toBe("small");
    near(p.pos.x, before.x + 0.05, 1e-9);
    near(p.meshPosition(0).x, before.x, 1e-9); // mesh unchanged at first
    for (let f = 0; f < 6; f++) p.meshPosition(1000 / 60);
    near(p.meshPosition(0).x, p.pos.x, 1e-9);
  });

  test("medium error corrects simulation and eases mesh over 100 ms", () => {
    const p = new Prediction(collide, { x: 0, y: FLOOR, z: 0 });
    run(p, 1, 10, fwd);
    const ref = new Prediction(collide, { x: 0, y: FLOOR, z: 0 });
    run(ref, 1, 5, fwd);
    expect(p.reconcile(snapOf(ref, 5, { z: ref.pos.z + 1 }))).toBe("medium");
    const m50 = p.meshPosition(50);
    near(m50.z - p.pos.z, -0.5, 1e-6);
    p.meshPosition(50);
    near(p.meshPosition(0).z, p.pos.z, 1e-9);
  });

  test("error above 2 m snaps and clears old prediction; forced snap and suspend states", () => {
    const p = new Prediction(collide, { x: 0, y: FLOOR, z: 0 });
    run(p, 1, 10, fwd);
    expect(p.reconcile(snapOf(p, 5, { x: 10 }))).toBe("snap");
    expect(p.bufferedTicks).toBe(0);
    near(p.meshPosition(0).x, p.pos.x);
    run(p, 11, 14, fwd);
    expect(p.reconcile(snapOf(p, 12), true)).toBe("snap");
    expect(p.bufferedTicks).toBe(0);
    for (const action of ["Stunned", "Captured", "Dead", "Ragdolled"] as const) {
      expect(p.reconcile(snapOf(p, 20, { action }))).toBe("suspended");
      const at = { ...p.pos };
      run(p, 21, 25, fwd);
      expect(p.pos).toEqual(at); // locomotion prediction suspended
    }
    p.reconcile(snapOf(p, 30, { action: "Idle" }));
    expect(p.suspended).toBe(false);
  });

  test("replay is capped at 12 ticks and acknowledged ticks are discarded", () => {
    const p = new Prediction(collide, { x: 0, y: FLOOR, z: 0 });
    run(p, 1, 40, fwd);
    p.reconcile(snapOf(p, 10));
    expect(p.bufferedTicks).toBe(PREDICTION.maxReplayTicks);
  });

  test("history keeps at most 120 tick samples", () => {
    const p = new Prediction(collide, { x: 0, y: FLOOR, z: 0 });
    run(p, 1, 300, NEUTRAL_MOVE);
    expect(p.bufferedTicks).toBe(PREDICTION.historyTicks);
  });

  test("replay respects wall collision through the corrected pose", () => {
    const p = new Prediction(collide, { x: 2.9, y: FLOOR, z: 0 });
    run(p, 1, 20, right);
    expect(p.pos.x).toBeLessThanOrEqual(WALL_X + 1e-9);
    p.reconcile(snapOf(p, 5, { x: 2.95 }));
    expect(p.pos.x).toBeLessThanOrEqual(WALL_X + 1e-9);
    near(p.state.vx, 0, 1e-9); // blocked by wall, matching server applyCorrection
  });

  test("jump edge replays once, not every replayed tick", () => {
    const p = new Prediction(collide, { x: 0, y: FLOOR, z: 0 });
    run(p, 1, 3, NEUTRAL_MOVE);
    p.step(4, { ...NEUTRAL_MOVE, jumpPressed: true }, 4);
    for (let t = 5; t <= 8; t++) p.step(t, { ...NEUTRAL_MOVE, jumpPressed: true }, 4); // held sample, edge not repeated
    const vyAfter = p.state.vy;
    p.reconcile(snapOf(p, 3, { y: FLOOR, vy: 0 }));
    near(p.state.vy, vyAfter, 1e-9);
  });
});

describe("Stale input lease (section 13: server clears held intent after 15 ticks)", () => {
  test("held intent applies within the lease and becomes neutral after it", () => {
    expect(Prediction.leased(fwd, 100, 100 + COMBAT.inputLeaseTicks)).toBe(fwd);
    expect(Prediction.leased(fwd, 100, 101 + COMBAT.inputLeaseTicks)).toBe(NEUTRAL_MOVE);
  });
  test("prediction stops accelerating when samples stop arriving", () => {
    const p = new Prediction(collide, { x: 0, y: FLOOR, z: 0 });
    for (let t = 1; t <= 60; t++) p.step(t, fwd, 1); // single sample, never refreshed
    near(p.state.vz, 0, 1e-9);
    const fresh = new Prediction(collide, { x: 0, y: FLOOR, z: 0 });
    run(fresh, 1, 60, fwd, 2); // 30 Hz refresh keeps it moving
    expect(fresh.state.vz).toBeLessThan(-1);
  });
  test("replay after reconcile also applies the lease", () => {
    const p = new Prediction(collide, { x: 0, y: FLOOR, z: 0 });
    for (let t = 1; t <= 30; t++) p.step(t, fwd, 1);
    p.reconcile(snapOf(p, 18, { vz: -3 }));
    near(p.state.vz, 0, 1e-9);
  });
});

describe("CameraRig (section 9)", () => {
  const wall: Collider = { id: "w", role: "obstacle", shape: "cuboid", centre: [0, 2, 4], halfExtents: [3, 3, 0.3] };
  const pillar: Collider = { id: "c", role: "obstacle", shape: "cylinder", centre: [0, 2, 3], radius: 0.5, halfHeight: 3 };
  test("unobstructed camera sits at default distance behind pivot +1.1 m", () => {
    const r = new CameraRig([]);
    const pose = r.update({ x: 0, y: 1, z: 0 }, 0, 0, 1 / 60);
    near(pose.pivot.y, 2.1);
    near(pose.distance, CAMERA.defaultDistance);
    near(pose.position.z, CAMERA.defaultDistance); // yaw 0 faces -Z, camera behind at +Z
  });
  test("obstruction pulls inward immediately with radius and clearance", () => {
    const r = new CameraRig([wall]);
    const pose = r.update({ x: 0, y: 1, z: 0 }, 0, 0, 1 / 60);
    near(pose.distance, 4 - 0.3 - CAMERA.castRadius - CAMERA.clearance, 1e-9);
  });
  test("cylinder obstruction", () => {
    near(sphereCast([pillar], { x: 0, y: 2, z: 0 }, { x: 0, y: 0, z: 1 }, 6.5, 0.18), 3 - 0.68, 1e-9);
  });
  test("eases outward over 0.15 s after obstruction clears", () => {
    const r = new CameraRig([wall]);
    const pulled = r.update({ x: 0, y: 1, z: 0 }, 0, 0, 1 / 60).distance;
    r.setColliders([]);
    const d1 = r.update({ x: 0, y: 1, z: 0 }, 0, 0, 0.075).distance;
    expect(d1).toBeGreaterThan(pulled);
    expect(d1).toBeLessThan(CAMERA.defaultDistance);
    near(d1, pulled + (CAMERA.defaultDistance - pulled) / 2, 1e-9);
    near(r.update({ x: 0, y: 1, z: 0 }, 0, 0, 0.075).distance, CAMERA.defaultDistance, 1e-9);
  });
  test("distance setting clamps to 3.5..10 and rejects non-finite", () => {
    const r = new CameraRig([]);
    r.setDistance(1); expect(r.distanceSetting).toBe(3.5);
    r.setDistance(99); expect(r.distanceSetting).toBe(10);
    r.setDistance(Number.NaN); expect(r.distanceSetting).toBe(6.5);
  });
});

describe("Camera relative stick to world space (T06/T07 coordinator decision)", () => {
  test("rotation by camera yaw", () => {
    let w = cameraRelativeToWorld(0, 1, 0); near(w.x, 0); near(w.z, -1);
    w = cameraRelativeToWorld(1, 0, 0); near(w.x, 1); near(w.z, 0);
    w = cameraRelativeToWorld(0, 1, Math.PI / 2); near(w.x, -1); near(w.z, 0); // yaw +90 faces -X
    w = cameraRelativeToWorld(0, 1, Math.PI); near(w.x, 0); near(w.z, 1);
    w = cameraRelativeToWorld(0.6, 0.8, 1.234); near(Math.hypot(w.x, w.z), 1);
  });
  test("IntentSampler sends world space moveX/moveZ that pass validation", () => {
    const router = new PointerRouter();
    router.moveX = 0; router.moveZ = 1; router.yaw = Math.PI / 2;
    const pkt = new IntentSampler(router, 1).sample(1)!;
    expect(parseInputPacket(pkt)).not.toBeNull();
    near(pkt.moveX, -1); near(pkt.moveZ, 0);
  });
});

describe("ClockSync (section 22)", () => {
  test("midpoint, median of 8, 5 ms per frame clamp, reset", () => {
    const c = new ClockSync();
    const ping = (sendMs: number, rtt: number, offset: number) => {
      const p = c.makePing(sendMs);
      return c.onPong({ nonce: p.nonce, serverMs: sendMs + rtt / 2 + offset, serverTick: 0 }, sendMs + rtt);
    };
    expect(ping(0, 40, 1000)).toBe(true);
    c.frame(); near(c.offsetMs, 1000); // first estimate applied directly
    for (let i = 1; i < 8; i++) ping(i * 100, 40, i === 3 ? 5000 : 1100); // one outlier
    expect(c.targetOffsetMs).toBe(1100);
    c.frame(); near(c.offsetMs, 1005);
    for (let i = 0; i < 30; i++) c.frame();
    near(c.offsetMs, 1100);
    expect(c.onPong({ nonce: 9999, serverMs: 0, serverTick: 0 }, 0)).toBe(false); // unknown nonce
    c.reset(); ping(5000, 20, -50); c.frame(); near(c.offsetMs, -50); // reconnect: unclamped
  });
  test("estimated server tick advances at 60 Hz", () => {
    const c = new ClockSync();
    const p = c.makePing(0);
    c.onPong({ nonce: p.nonce, serverMs: 500, serverTick: 600 }, 20);
    c.frame();
    near(c.serverTick(10)!, 600);
    near(c.serverTick(1010)!, 660);
  });
});

describe("SnapshotBuffer (section 22)", () => {
  const s = (tick: number, x: number, yaw = 0, vx = 0) => ({ tick, x, y: 0, z: 0, vx, vy: 0, vz: 0, yaw });
  test("interpolates 100 ms behind with shortest path yaw", () => {
    const b = new SnapshotBuffer();
    b.push(s(0, 0, 3.0)); b.push(s(3, 3, -3.0));
    const r = b.sample(1.5 + 6)!;
    near(r.x, 1.5);
    expect(Math.abs(Math.atan2(Math.sin(r.yaw), Math.cos(r.yaw)))).toBeGreaterThan(3.0); // via pi, not 0
    b.push(s(2, 99)); expect(b.size).toBe(2); // out of order dropped
  });
  test("extrapolates at most 100 ms then freezes with uncertainty", () => {
    const b = new SnapshotBuffer();
    b.push(s(0, 0, 0, 6)); b.push(s(3, 0.3, 0, 6));
    const a = b.sample(3 + 6 + 3)!; near(a.x, 0.6); expect(a.uncertain).toBe(false);
    const f = b.sample(3 + 6 + 60)!; near(f.x, 0.9); expect(f.uncertain).toBe(true);
    b.clear(); expect(b.sample(10)).toBeNull();
  });
});
