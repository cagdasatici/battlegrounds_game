import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { buildIslandsMap } from "../../packages/shared/src/config/arena.js";
import { parseInputPacket, type InputPacket } from "../../packages/shared/src/index.js";
import { computeLayout } from "../../apps/client/src/input/ControlLayout.js";
import { PointerRouter } from "../../apps/client/src/input/PointerRouter.js";
import { IntentSampler } from "../../apps/client/src/input/IntentSampler.js";
import { ClockSync } from "../../apps/client/src/net/ClockSync.js";
import { createRapierCollide, initRapier, type RapierCollide } from "../../apps/client/src/net/RapierCollide.js";
import { CameraRig } from "../../apps/client/src/scene/CameraRig.js";
import { GameScene, type RendererLike, type WindowLike } from "../../apps/client/src/scene/GameScene.js";
import { GameLoop, type LoopPlayer, type LoopState } from "../../apps/client/src/app/GameLoop.js";

const map = buildIslandsMap();
const L = computeLayout({ x0: 0, y0: 0, W: 1024, H: 768 });
beforeAll(async () => { await initRapier(); });

const win: WindowLike = { innerWidth: 800, innerHeight: 600, addEventListener() {}, removeEventListener() {} };
const renderer: RendererLike = { setSize() {}, render() {}, dispose() {} };

interface Rig {
  loop: GameLoop; router: PointerRouter; scene: GameScene; kit: RapierCollide;
  sent: InputPacket[]; pings: { nonce: number; clientMs: number }[];
  state: { serverTick: number; players: Map<string, LoopPlayer> };
  clockAt(ms: number, tick: number): void;
  gate: { open: boolean };
}
const rigs: Rig[] = [];
afterEach(() => { for (const r of rigs.splice(0)) { r.loop.dispose(); r.scene.dispose(); r.kit.dispose(); } });

const player = (o: Partial<LoopPlayer> & { entityId: number }): LoopPlayer => ({
  displayName: "p", kitId: "sv", lifeId: 1, x: 0, y: 90, z: 0, vx: 0, vy: 0, vz: 0, facingYaw: 0,
  hp100: 10000, action: "Idle", ...o,
});

function makeRig(): Rig {
  const router = new PointerRouter(L, { awakeningReady: () => true });
  const sampler = new IntentSampler(router, 1);
  const kit = createRapierCollide(map);
  const scene = new GameScene(renderer, map.colliders, win);
  const clock = new ClockSync();
  const sent: InputPacket[] = [];
  const pings: { nonce: number; clientMs: number }[] = [];
  const state = {
    serverTick: 100,
    players: new Map<string, LoopPlayer>([
      ["1", player({ entityId: 1, owner: { ackInputTick: 0, epoch: 1 } })],
      ["2", player({ entityId: 2, x: 500, z: -300, kitId: "td" })],
    ]),
  };
  const gate = { open: true };
  const loop = new GameLoop({
    scene, camera: new CameraRig(map.colliders), collide: kit.collide, router, sampler, clock,
    inputEnabled: () => gate.open,
    readState: (): LoopState => state,
    sendInput: (p) => { sent.push(p); },
    sendPing: (p) => { pings.push(p); },
  });
  const rig: Rig = {
    loop, router, scene, kit, sent, pings, state, gate,
    clockAt(ms, tick) {
      const p = clock.makePing(ms);
      clock.onPong({ nonce: p.nonce, serverMs: 1_000_000 + ms + 5, serverTick: tick }, ms + 10);
    },
  };
  rigs.push(rig);
  return rig;
}

/** Drives frames at 16.67 ms; the estimated server tick follows wall time at 60 Hz. */
function run(rig: Rig, fromMs: number, frames: number): number {
  let t = fromMs;
  for (let i = 0; i < frames; i++) { t += 1000 / 60; rig.loop.frame(t); }
  return t;
}

describe("T18b GameLoop", () => {
  test("creates fighter views from replicated players: owner record marks the local one", () => {
    const r = makeRig();
    r.clockAt(0, 100);
    run(r, 0, 2);
    expect(r.scene.fighterCount).toBe(2);
    expect(r.loop.localEntityId).toBe(1);
    r.state.players.delete("2");
    run(r, 100, 1);
    expect(r.scene.fighterCount).toBe(1);
  });

  test("sends validated intent packets at 30 Hz with increasing seq and sampleTick, no damage fields", () => {
    const r = makeRig();
    r.clockAt(0, 100);
    r.router.setKeyboardMove(0, 1);
    run(r, 0, 61);
    expect(r.sent.length).toBeGreaterThanOrEqual(28);
    expect(r.sent.length).toBeLessThanOrEqual(33);
    for (let i = 0; i < r.sent.length; i++) {
      expect(parseInputPacket(r.sent[i])).not.toBeNull();
      if (i > 0) {
        expect(r.sent[i]!.seq).toBeGreaterThan(r.sent[i - 1]!.seq);
        expect(r.sent[i]!.sampleTick).toBeGreaterThan(r.sent[i - 1]!.sampleTick);
      }
      expect(Object.keys(r.sent[i]!).some((k) => /damage|hit|target|hp/i.test(k))).toBe(false);
    }
    expect(r.sent.at(-1)!.moveZ).toBeLessThan(0); // stick forward at yaw 0 is world -Z
  });

  test("an edge is sent immediately, in the frame that raised it", () => {
    const r = makeRig();
    r.clockAt(0, 100);
    const t = run(r, 0, 10);
    const before = r.sent.length;
    r.router.keyHold("jump", true); r.router.keyHold("jump", false);
    r.loop.frame(t + 1000 / 60);
    expect(r.sent.length).toBe(before + 1);
    expect(r.sent.at(-1)!.edges.map((e) => e.kind)).toEqual(["jump"]);
  });

  test("never sends before the first pong gives a tick estimate; pings are rate limited to 1 per second", () => {
    const r = makeRig();
    run(r, 0, 30);
    expect(r.sent).toHaveLength(0);
    expect(r.pings.length).toBe(1);
    run(r, 500, 90);
    expect(r.pings.length).toBeLessThanOrEqual(3);
  });

  test("predicts locally on the real collider, then reconciles on the owner ackInputTick without a visible jump", () => {
    const r = makeRig();
    r.clockAt(0, 100);
    r.router.setKeyboardMove(0, 1);
    const t = run(r, 0, 40);
    const view = r.scene.viewFor("1")!;
    expect(view.group.position.z).toBeLessThan(-0.5); // moved ahead of the (still stationary) server record
    expect(r.loop.correctionCounts.snap).toBe(0);
    // Server accepted up to an old sample and reports the pose that sample produced.
    const ack = r.sent[10]!.sampleTick;
    const probe = r.loop.prediction!;
    const hist = probe.bufferedTicks;
    expect(hist).toBeGreaterThan(5);
    r.state.serverTick = 130;
    r.state.players.get("1")!.owner = { ackInputTick: ack, epoch: 1 };
    // Place the record on the predicted path at that tick so the correction is tiny.
    run(r, t, 1);
    expect(r.loop.reconcileCount).toBeGreaterThan(0);
    expect(r.loop.prediction!.bufferedTicks).toBeLessThan(hist + 2);
  });

  test("GR04: every fresh owner snapshot reconciles even when the ack did not advance; stale ticks are ignored", () => {
    const r = makeRig();
    r.clockAt(0, 100);
    const t = run(r, 0, 20);
    const before = r.loop.reconcileCount;
    r.state.serverTick += 1; // fresh snapshot, owner.ackInputTick still 0
    run(r, t, 1);
    expect(r.loop.reconcileCount).toBe(before + 1);
    const n = r.loop.reconcileCount;
    run(r, t + 1, 3); // no new snapshot
    expect(r.loop.reconcileCount).toBe(n);
  });

  test("a large server disagreement snaps the local fighter to the replicated pose", () => {
    const r = makeRig();
    r.clockAt(0, 100);
    const t = run(r, 0, 20);
    const me = r.state.players.get("1")!;
    me.x = 1800; me.z = 1400; me.y = 90;
    me.owner = { ackInputTick: r.sent.at(-1)!.sampleTick, epoch: 1 };
    r.state.serverTick += 5;
    run(r, t, 2);
    expect(r.loop.correctionCounts.snap).toBeGreaterThan(0);
    expect(r.loop.prediction!.pos.x).toBeCloseTo(18, 0);
  });

  test("remote fighters are fed to SnapshotBuffer only when serverTick advances", () => {
    const r = makeRig();
    r.clockAt(0, 100);
    run(r, 0, 5);
    const buf = r.scene.bufferFor("2")!;
    const n = buf.size;
    run(r, 100, 5);
    expect(buf.size).toBe(n);
    r.state.serverTick += 3;
    run(r, 200, 1);
    expect(buf.size).toBe(n + 1);
  });

  test("neutral intent is sent at once on release-all (blur) and dispose removes the frame callback", () => {
    const r = makeRig();
    r.clockAt(0, 100);
    r.router.keyHold("attack", true);
    const t = run(r, 0, 10);
    expect(r.sent.at(-1)!.attackHeld).toBe(true);
    r.router.releaseAll();
    r.loop.frame(t + 1000 / 60);
    expect(r.sent.at(-1)!.attackHeld).toBe(false);
    r.loop.dispose();
    const n = r.sent.length;
    r.loop.frame(t + 1000);
    expect(r.sent.length).toBe(n);
  });

  test("start and dispose schedule and cancel exactly one animation frame at a time", () => {
    const r = makeRig();
    let pending = 0, id = 0;
    const live = new Set<number>();
    const loop = new GameLoop({
      scene: r.scene, camera: new CameraRig(map.colliders), collide: r.kit.collide, router: r.router,
      sampler: new IntentSampler(r.router, 1), clock: new ClockSync(), readState: () => null,
      sendInput() {}, sendPing() {},
      raf: () => { pending++; live.add(++id); return id; }, caf: (i) => { live.delete(i); },
      now: () => 0,
    });
    loop.start();
    expect(live.size).toBe(1);
    loop.dispose();
    expect(live.size).toBe(0);
    expect(pending).toBe(1);
  });
});

describe("T30 frame time hook", () => {
  test("onFrameTime reports each frame interval, not the first frame", () => {
    const router = new PointerRouter(L, { awakeningReady: () => true });
    const kit = createRapierCollide(map);
    const scene = new GameScene(renderer, map.colliders, win);
    const seen: number[] = [];
    const loop = new GameLoop({
      scene, camera: new CameraRig(map.colliders), collide: kit.collide, router, sampler: new IntentSampler(router, 1), clock: new ClockSync(),
      readState: () => null, sendInput() {}, sendPing() {}, onFrameTime: (ms) => { seen.push(ms); },
    });
    loop.frame(1000); loop.frame(1016); loop.frame(1050);
    loop.dispose(); scene.dispose(); kit.dispose();
    expect(seen).toEqual([16, 34]);
  });
});

describe("GR03 connection gate", () => {
  test("closed gate: no input, no prediction, queued edges discarded; reopening needs a fresh press", () => {
    const r = makeRig();
    r.clockAt(0, 100);
    r.router.setKeyboardMove(0, 1);
    r.router.keyHold("attack", true);
    let t = run(r, 0, 20);
    expect(r.sent.length).toBeGreaterThan(0);
    r.gate.open = false;
    t = run(r, t, 1);
    const sentAtClose = r.sent.length;
    expect(r.loop.prediction).toBeNull();
    r.router.keyHold("jump", true); r.router.keyHold("jump", false);
    t = run(r, t, 60);
    expect(r.sent.length).toBe(sentAtClose);
    expect(r.loop.prediction).toBeNull();
    expect(r.router.hasEdges).toBe(false);
    r.gate.open = true;
    t = run(r, t, 10);
    expect(r.loop.prediction).not.toBeNull();
    const after = r.sent.slice(sentAtClose);
    expect(after.length).toBeGreaterThan(0);
    for (const p of after) { expect(p.attackHeld).toBe(false); expect(p.moveZ).toBe(0); expect(p.edges).toEqual([]); }
  });

  test("resetEpoch clears prediction, send bookkeeping and remote buffers; the next snapshot rebinds the local fighter", () => {
    const r = makeRig();
    r.clockAt(0, 100);
    let t = run(r, 0, 20);
    expect(r.loop.localEntityId).toBe(1);
    expect(r.scene.bufferFor("2")?.size ?? 0).toBeGreaterThan(0);
    r.loop.resetEpoch();
    expect(r.loop.prediction).toBeNull();
    expect(r.loop.localEntityId).toBeNull();
    expect(r.scene.bufferFor("2")?.size).toBe(0);
    r.state.serverTick += 5;
    t = run(r, t, 3);
    expect(r.loop.localEntityId).toBe(1);
    expect(r.loop.prediction).not.toBeNull();
  });
});
