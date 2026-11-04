import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { matchMaker } from "colyseus";
import { startHarness, loginClient, waitFor, players, freshCode, type Harness } from "../fixtures/harness.js";
import { loadMapFile } from "../../apps/server/src/sim/World.js";
import type { ArenaRoom } from "../../apps/server/src/rooms/ArenaRoom.js";
import { Prediction, type OwnerSnapshot } from "../../apps/client/src/net/Prediction.js";
import { createRapierCollide, initRapier } from "../../apps/client/src/net/RapierCollide.js";
import { NEUTRAL_MOVE, type MoveIntent } from "../../packages/shared/src/movement.js";

let h: Harness;
beforeAll(async () => { h = await startHarness(25714); await initRapier(); });
afterAll(async () => { await h.stop(); });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const pkt = (epoch: number, seq: number, sampleTick: number, o: Record<string, unknown> = {}) => ({
  v: 1, epoch, seq, sampleTick, moveX: 0, moveZ: 0, yaw: 0, pitch: 0,
  attackHeld: false, blockHeld: false, jumpHeld: false, runHeld: false, chargeHeldSlot: 0, edges: [], ...o,
});

interface SeatLike { entityId: number; input: { lastInputTick: number; lastSampleTick: number; lastReceivedSeq: number } }

describe("R14 prediction against the real Rapier collider", () => {
  test("client and server agree within 0.1 m after 120 ticks of scripted input with wall contact; reconcile anchors on ackInputTick", async () => {
    const code = freshCode();
    const a = await loginClient(h, "Arel");
    const b = await loginClient(h, "Nora");
    const ra = await a.join(code);
    const rb = await b.join(code);
    await waitFor(() => a.welcome !== null && players(ra).size === 2 && players(rb).size === 2, 3000, "joined");
    a.send("ready", { kitId: "sv", contentHash: a.localContentHash });
    b.send("ready", { kitId: "td", contentHash: b.localContentHash });
    const view = () => [...players(ra).values()].find((p) => p.displayName === "Arel");
    await waitFor(() => view()?.ready === true && view().action === "Idle", 3000, "ready");
    const room = matchMaker.getLocalRoomById(ra.roomId) as unknown as ArenaRoom;
    const aId = view().entityId as number;
    await waitFor(() => room.sim.tick > room.combat.get(aId)!.protectedUntilTick + 2 && room.movement!.get(aId)!.state.grounded, 4000, "settled");
    await sleep(100);
    const seat = [...(room as unknown as { seats: Map<string, SeatLike> }).seats.values()].find((s) => s.entityId === aId)!;
    const body = room.movement!.get(aId)!;
    expect(Math.hypot(body.state.vx, body.state.vz)).toBeLessThan(1e-6);

    // Client prediction starts from the exact server pose and state (same shared map, same controller).
    const map = loadMapFile();
    const kit = createRapierCollide(map);
    const t0 = body.rb.translation();
    const pred = new Prediction(kit.collide, { x: t0.x, y: t0.y, z: t0.z }, body.state.facingYaw);
    pred.state = { ...body.state };
    expect(Math.abs(t0.x)).toBeCloseTo(18, 1);
    // Run diagonally at the face of the pillar nearest the spawn: contact, then slide along it.
    const sx = Math.sign(t0.x), sz = Math.sign(t0.z);
    const len = Math.hypot(6, 3);
    const run: MoveIntent = { moveX: (-sx * 6) / len, moveZ: (-sz * 3) / len, run: true, guard: false, jumpPressed: false };

    // Server-side pose log per tick (the real room, not a fake).
    const serverAt = new Map<number, { x: number; y: number; z: number }>();
    let logging = true;
    const logger = (async () => {
      let last = -1;
      while (logging) {
        const t = room.sim.tick;
        if (t !== last) { const p = room.movement!.position(aId)!; serverAt.set(t, { x: p[0], y: p[1], z: p[2] }); last = t; }
        await sleep(1);
      }
    })();

    const epoch = a.welcome!.epoch;
    const start = room.sim.tick;
    const end = start + 120;
    let seq = 0;
    const applied: { from: number; sample: number; intent: MoveIntent }[] = [];
    const sendIntent = async (m: { moveX: number; moveZ: number; runHeld: boolean }, intent: MoveIntent): Promise<void> => {
      const s = room.sim.tick;
      a.send("input", pkt(epoch, ++seq, s, m));
      await waitFor(() => seat.input.lastReceivedSeq === seq, 2000, "packet accepted");
      // The server applies the held intent from the first step after receipt.
      applied.push({ from: seat.input.lastInputTick + 1, sample: seat.input.lastInputTick, intent });
    };
    await sendIntent({ moveX: run.moveX, moveZ: run.moveZ, runHeld: true }, run);
    let nextRefresh = room.sim.tick + 8;
    while (room.sim.tick < end) {
      if (room.sim.tick >= nextRefresh) { await sendIntent({ moveX: run.moveX, moveZ: run.moveZ, runHeld: true }, run); nextRefresh = room.sim.tick + 8; }
      await sleep(2);
    }
    await sendIntent({ moveX: 0, moveZ: 0, runHeld: false }, NEUTRAL_MOVE);
    const stopSample = seat.input.lastSampleTick;
    const stopArrival = seat.input.lastInputTick;
    // Let the server come to rest, then stop logging.
    await waitFor(() => Math.hypot(body.state.vx, body.state.vz) < 1e-6 && room.sim.tick > stopArrival + 30, 3000, "server at rest");
    logging = false; await logger;
    const finalTick = Math.max(...serverAt.keys());

    // Client replays the same applied intents tick by tick through the real collider.
    const clientAt = new Map<number, { x: number; y: number; z: number }>();
    let cur = applied[0]!;
    let idx = 0;
    for (let t = applied[0]!.from; t <= finalTick; t++) {
      while (idx + 1 < applied.length && applied[idx + 1]!.from <= t) cur = applied[++idx]!;
      pred.step(t, cur.intent, cur.sample);
      clientAt.set(t, { ...pred.pos });
    }

    // Agreement at (about) 120 ticks after start, and every logged tick: within 0.1 m (server pose is the cm-exact body).
    let worst = 0, compared = 0;
    for (const [t, c] of clientAt) {
      const s = serverAt.get(t);
      if (!s) continue;
      worst = Math.max(worst, Math.hypot(c.x - s.x, c.y - s.y, c.z - s.z));
      compared++;
    }
    expect(compared).toBeGreaterThan(120);
    expect(worst).toBeLessThan(0.1);
    const s120 = serverAt.get(end), c120 = clientAt.get(end);
    expect(s120 && c120).toBeTruthy();
    expect(Math.hypot(c120!.x - s120!.x, c120!.z - s120!.z)).toBeLessThan(0.1);
    // The run really touched the pillar face (server wall contact inside the scripted window), then slid along it.
    expect(body.wallHitTick).toBeGreaterThan(start);
    expect(body.wallHitTick).toBeLessThan(end);

    // Reconcile anchored on the owner ackInputTick: replicated owner record vs the client's rest pose.
    await waitFor(() => view().owner?.ackInputTick === stopSample, 2000, "owner ack replicated");
    const w = view();
    const snap: OwnerSnapshot = {
      serverTick: finalTick, ackInputTick: w.owner.ackInputTick, loco: { ...w.owner },
      x: w.x / 100, y: w.y / 100, z: w.z / 100, vx: w.vx / 100, vy: w.vy / 100, vz: w.vz / 100,
      facingYaw: pred.state.facingYaw, action: "Idle",
    };
    const bufferedBefore = pred.bufferedTicks;
    const result = pred.reconcile(snap);
    expect(["none", "small"]).toContain(result);
    // Everything up to and including the snapshot tick was discarded (GR04).
    expect(pred.bufferedTicks).toBeLessThanOrEqual(bufferedBefore);
    expect(Math.hypot(pred.pos.x - serverAt.get(finalTick)!.x, pred.pos.z - serverAt.get(finalTick)!.z)).toBeLessThan(0.1);

    kit.dispose();
    await a.leave(); await b.leave();
  }, 20000);

  test("reconcile replays only inputs after snapshot serverTick (ackInputTick is diagnostic, GR04 / spec section 22)", () => {
    const map = loadMapFile();
    const kit = createRapierCollide(map);
    const floorY = 0.9;
    const pred = new Prediction(kit.collide, { x: 0, y: floorY, z: 0 });
    const fwd: MoveIntent = { moveX: 0, moveZ: -1, run: false, guard: false, jumpPressed: false };
    for (let t = 1; t <= 10; t++) pred.step(t, fwd, t);
    const ref = new Prediction(kit.collide, { x: 0, y: floorY, z: 0 });
    for (let t = 1; t <= 5; t++) ref.step(t, fwd, t);
    const snap: OwnerSnapshot = {
      serverTick: 5, ackInputTick: 1, x: ref.pos.x, y: ref.pos.y, z: ref.pos.z,
      vx: ref.state.vx, vy: ref.state.vy, vz: ref.state.vz, facingYaw: ref.state.facingYaw, action: "Idle", loco: { ...ref.state },
    };
    expect(pred.reconcile(snap)).toBe("none");
    expect(pred.bufferedTicks).toBe(5);
    kit.dispose();
  });
});
