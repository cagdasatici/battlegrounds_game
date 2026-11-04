import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { matchMaker } from "colyseus";
import { browserFetch, startHarness, waitFor, players, freshCode, type Harness } from "../fixtures/harness.js";
import { LatencyProxy } from "../fixtures/LatencyProxy.js";
import { RoomClient } from "../../apps/client/src/net/RoomClient.js";
import { loadMapFile } from "../../apps/server/src/sim/World.js";
import type { ArenaRoom } from "../../apps/server/src/rooms/ArenaRoom.js";
import { Prediction, type OwnerSnapshot } from "../../apps/client/src/net/Prediction.js";
import { createRapierCollide, initRapier } from "../../apps/client/src/net/RapierCollide.js";
import { NEUTRAL_MOVE, type MoveIntent } from "../../packages/shared/src/movement.js";

/**
 * GR04: prediction reconciles from the authoritative snapshot tick. Real RoomClients (A through the R18 delay proxy at
 * 0/60/120 ms RTT, B direct) and the real Rapier collider. Pure integration of the server-applied intents is compared with
 * the authoritative pose at the same tick (0.05 m, cm quantization), and reconciliation from a delayed snapshot replays
 * exactly the ticks after serverTick.
 */
let h: Harness;
beforeAll(async () => { h = await startHarness(); await initRapier(); });
afterAll(async () => { await h.stop(); });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TOL = 0.05;

const pkt = (epoch: number, seq: number, sampleTick: number, o: Record<string, unknown> = {}) => ({
  v: 1, epoch, seq, sampleTick, moveX: 0, moveZ: 0, yaw: 0, pitch: 0,
  attackHeld: false, blockHeld: false, jumpHeld: false, runHeld: false, chargeHeldSlot: 0, edges: [], ...o,
});

interface SeatLike { entityId: number; input: { lastInputTick: number; lastSampleTick: number; lastReceivedSeq: number } }
interface Snap { serverTick: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; loco: OwnerSnapshot["loco"] }

async function login(wsPort: number | null, name: string): Promise<RoomClient> {
  const store = new Map<string, string>();
  const c = new RoomClient({
    httpBase: h.origin, wsEndpoint: wsPort === null ? `ws://localhost:${h.port}` : `ws://localhost:${wsPort}`, fetchFn: browserFetch(h.origin),
    storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: (k) => void store.delete(k) },
    sleep: async () => undefined,
  });
  await c.login(h.svc.invites.create({ ttlMs: 60_000, maxUses: 1 }).token, name);
  return c;
}

async function scenario(rttMs: number): Promise<void> {
  const px = new LatencyProxy(h.port, { rttMs, jitterMs: 0, seed: 4 + rttMs });
  await px.start();
  const kit = createRapierCollide(loadMapFile());
  try {
    const a = await login(px.port, "Arel"), b = await login(null, "Nora");
    const code = freshCode();
    const ra = await a.join(code), rb = await b.join(code);
    await waitFor(() => a.welcome !== null && b.welcome !== null && players(ra).size === 2 && players(rb).size === 2, 8000, "joined");
    a.send("ready", { kitId: "sv", contentHash: a.localContentHash });
    b.send("ready", { kitId: "td", contentHash: b.localContentHash });
    const view = () => [...players(ra).values()].find((p) => p.displayName === "Arel");
    await waitFor(() => view()?.ready === true && view().action === "Idle", 8000, "ready");
    const room = matchMaker.getLocalRoomById(ra.roomId) as unknown as ArenaRoom;
    const aId = view().entityId as number;
    await waitFor(() => room.sim.tick > room.combat.get(aId)!.protectedUntilTick + 2 && room.movement!.get(aId)!.state.grounded, 8000, "settled");
    await sleep(150);
    const seat = [...(room as unknown as { seats: Map<string, SeatLike> }).seats.values()].find((s) => s.entityId === aId)!;
    const body = room.movement!.get(aId)!;

    const t0 = body.rb.translation();
    const pred = new Prediction(kit.collide, { x: t0.x, y: t0.y, z: t0.z }, body.state.facingYaw);
    pred.state = { ...body.state };
    const sx = Math.sign(t0.x), sz = Math.sign(t0.z), len = Math.hypot(6, 3);
    const run: MoveIntent = { moveX: (-sx * 6) / len, moveZ: (-sz * 3) / len, run: true, guard: false, jumpPressed: false };

    // Authoritative per-tick log on the server, and the owner snapshots exactly as client A's replicated state shows them.
    const serverAt = new Map<number, { x: number; y: number; z: number }>();
    const snaps: Snap[] = [];
    let logging = true;
    const logger = (async () => {
      let last = -1, lastSnap = -1;
      while (logging) {
        const t = room.sim.tick;
        if (t !== last) { const p = room.movement!.position(aId)!; serverAt.set(t, { x: p[0], y: p[1], z: p[2] }); last = t; }
        const v = view(), st = (ra.state as unknown as { serverTick: number }).serverTick;
        if (v && st !== lastSnap) {
          lastSnap = st;
          snaps.push({ serverTick: st, x: v.x / 100, y: v.y / 100, z: v.z / 100, vx: v.vx / 100, vy: v.vy / 100, vz: v.vz / 100,
            loco: { grounded: v.owner.grounded, lastGroundedTick: v.owner.lastGroundedTick, jumpPressTick: v.owner.jumpPressTick, jumpedSinceGrounded: v.owner.jumpedSinceGrounded, airJumpsUsed: v.owner.airJumpsUsed } });
        }
        await sleep(1);
      }
    })();

    const epoch = a.welcome!.epoch;
    const start = room.sim.tick, end = start + 120;
    let seq = 0;
    const applied: { from: number; sample: number; intent: MoveIntent }[] = [];
    const sendIntent = async (m: { moveX: number; moveZ: number; runHeld: boolean }, intent: MoveIntent): Promise<void> => {
      a.send("input", pkt(epoch, ++seq, room.sim.tick, m));
      await waitFor(() => seat.input.lastReceivedSeq === seq, 4000, "packet accepted");
      applied.push({ from: seat.input.lastInputTick + 1, sample: seat.input.lastInputTick, intent });
    };
    await sendIntent({ moveX: run.moveX, moveZ: run.moveZ, runHeld: true }, run);
    let nextRefresh = room.sim.tick + 8;
    while (room.sim.tick < end) {
      if (room.sim.tick >= nextRefresh) { await sendIntent({ moveX: run.moveX, moveZ: run.moveZ, runHeld: true }, run); nextRefresh = room.sim.tick + 8; }
      await sleep(2);
    }
    await sendIntent({ moveX: 0, moveZ: 0, runHeld: false }, NEUTRAL_MOVE);
    const stopArrival = seat.input.lastInputTick;
    await waitFor(() => Math.hypot(body.state.vx, body.state.vz) < 1e-6 && room.sim.tick > stopArrival + 30, 5000, "server at rest");
    await sleep(100);
    logging = false; await logger;
    const finalTick = Math.max(...serverAt.keys());
    expect(body.wallHitTick).toBeGreaterThan(start); // the walk reached the pillar

    // Pure integration of the server-applied intents (walk, wall contact, stop).
    const clientAt = new Map<number, { x: number; y: number; z: number }>();
    let cur = applied[0]!, idx = 0;
    const intentAt = (t: number): typeof cur => { while (idx + 1 < applied.length && applied[idx + 1]!.from <= t) cur = applied[++idx]!; return cur; };
    pred.state = { ...pred.state };
    for (let t = applied[0]!.from; t <= finalTick; t++) { const c = intentAt(t); pred.step(t, c.intent, c.sample); clientAt.set(t, { ...pred.pos }); }

    let worst = 0, compared = 0;
    for (const [t, c] of clientAt) { const s = serverAt.get(t); if (s) { worst = Math.max(worst, Math.hypot(c.x - s.x, c.y - s.y, c.z - s.z)); compared++; } }
    expect(compared).toBeGreaterThan(120);
    expect(worst).toBeLessThan(TOL);

    // Delayed ack: reconcile from a replicated snapshot at serverTick S while the client is k ticks ahead.
    const moving = snaps.filter((s) => s.serverTick > applied[0]!.from + 10 && s.serverTick < end - 20 && clientAt.has(s.serverTick + 6));
    expect(moving.length).toBeGreaterThan(10);
    for (const s of moving.filter((_, i) => i % 7 === 0)) {
      const truth = serverAt.get(s.serverTick)!;
      expect(Math.hypot(s.x - truth.x, s.y - truth.y, s.z - truth.z)).toBeLessThan(TOL); // snapshot is the pose at that tick
      const k = 6;
      const p2 = new Prediction(kit.collide, { x: t0.x, y: t0.y, z: t0.z }, 0);
      p2.state = { ...body.state, vx: 0, vz: 0, vy: 0 };
      cur = applied[0]!; idx = 0;
      for (let t = applied[0]!.from; t <= s.serverTick + k; t++) { const c = intentAt(t); p2.step(t, c.intent, c.sample); }
      const cls = p2.reconcile({ serverTick: s.serverTick, ackInputTick: 1, x: s.x, y: s.y, z: s.z, vx: s.vx, vy: s.vy, vz: s.vz, facingYaw: p2.state.facingYaw, action: "Idle", loco: s.loco });
      expect(["none", "small"]).toContain(cls);
      expect(p2.bufferedTicks).toBe(k); // exactly ticks S+1..S+k, nothing from the acked past
      const want = clientAt.get(s.serverTick + k)!;
      expect(Math.hypot(p2.pos.x - want.x, p2.pos.z - want.z)).toBeLessThan(TOL);
    }

    // Ground jump, air jump, third press: replicated loco fields drive the client state and never create a third jump.
    const idle = (): void => a.send("input", pkt(epoch, ++seq, room.sim.tick));
    let edge = 0;
    const press = (): void => a.send("input", pkt(epoch, ++seq, room.sim.tick, { jumpHeld: true, edges: [{ id: ++edge, kind: "jump" }] }));
    press();
    await waitFor(() => view().owner.grounded === false && view().owner.jumpedSinceGrounded === true, 4000, "ground jump replicated");
    idle();
    await sleep(250);
    press();
    await waitFor(() => view().owner.airJumpsUsed === 1, 4000, "air jump replicated");
    expect(body.state.airJumpsUsed).toBe(1);
    idle(); press(); await sleep(120 + rttMs); // third press
    expect(view().owner.airJumpsUsed).toBe(1);
    const o = view().owner;
    const j = new Prediction(kit.collide, { x: view().x / 100, y: view().y / 100, z: view().z / 100 }, 0);
    j.reconcile({ serverTick: (ra.state as unknown as { serverTick: number }).serverTick, x: view().x / 100, y: view().y / 100, z: view().z / 100,
      vx: 0, vy: view().vy / 100, vz: 0, facingYaw: 0, action: "Idle",
      loco: { grounded: o.grounded, lastGroundedTick: o.lastGroundedTick, jumpPressTick: o.jumpPressTick, jumpedSinceGrounded: o.jumpedSinceGrounded, airJumpsUsed: o.airJumpsUsed } }, true);
    const vyBefore = j.state.vy;
    j.step((ra.state as unknown as { serverTick: number }).serverTick + 1, { ...NEUTRAL_MOVE, jumpPressed: true }, (ra.state as unknown as { serverTick: number }).serverTick + 1);
    expect(j.state.vy).toBeLessThanOrEqual(vyBefore); // no third impulse after a snap
    await waitFor(() => view().owner.grounded === true && view().owner.airJumpsUsed === 0, 6000, "landed, air jump restored");
    await a.leave(); await b.leave();
  } finally { kit.dispose(); await px.stop(); }
}

describe("GR04 prediction against a delayed real connection", () => {
  for (const rtt of [0, 60, 120]) test(`walk, wall contact, stop, jump and air jump at ${rtt} ms RTT`, () => scenario(rtt), 60_000);
});
