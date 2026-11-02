import { afterAll, beforeAll, expect, test } from "vitest";
import { writeFileSync } from "node:fs";
import { matchMaker } from "colyseus";
import { startHarness, loginClient, waitFor, players, freshCode, type Harness } from "../fixtures/harness.js";
import type { ArenaRoom } from "../../apps/server/src/rooms/ArenaRoom.js";
import { parseInputPacket } from "../../packages/shared/src/protocol.js";
import { meterRequired100 } from "../../packages/shared/src/awakening.js";

/**
 * T30 server budgets (spec section 24): four real RoomClient connections over loopback WebSocket in one arena room.
 * Opt in with T30_PERF=1 (about 40 s); T30_REPORT=<path> writes the measured numbers as JSON.
 * Tick time is the wall time of ArenaRoom.stepTick (one 60 Hz logical tick) and of the whole scheduler callback.
 * Bytes are WebSocket message payload bytes counted on the server socket (no TCP/WS framing, no compression).
 * Each client sends what GameLoop sends: a packet every 2 ticks (30 Hz), moving, plus a skill tap per second.
 */
const RUN_MS = 30_000;
const enabled = process.env["T30_PERF"] === "1";
let h: Harness;
beforeAll(async () => { if (enabled) h = await startHarness(); });
afterAll(async () => { if (enabled) await h.stop(); });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]! : 0; };

test.skipIf(!enabled)("T30 four players: server tick percentiles and per player bandwidth", async () => {
  const code = freshCode();
  const kits = ["sv", "td", "sv", "td"] as const;
  const cls = [];
  for (let i = 0; i < 4; i++) { const c = await loginClient(h, `Perf${i}`); const room = await c.join(code); cls.push({ c, room }); }
  await waitFor(() => cls.every((x) => x.c.welcome !== null) && cls.every((x) => players(x.room).size === 4), 10_000, "joined");
  cls.forEach((x, i) => x.c.send("ready", { kitId: kits[i], contentHash: x.c.localContentHash }));
  await waitFor(() => cls.every((x) => [...players(x.room).values()].every((p) => p.ready && p.action === "Idle")), 10_000, "ready");
  const arena = matchMaker.getLocalRoomById(cls[0]!.room.roomId) as unknown as ArenaRoom;

  // Server instrumentation lives only in this test: patch the instance, never the source.
  const stepMs: number[] = [], schedMs: number[] = [];
  let measuring = false;
  const origStep = arena.stepTick.bind(arena);
  arena.stepTick = (t: number) => { const a = performance.now(); origStep(t); if (measuring) stepMs.push(performance.now() - a); };
  const priv = arena as unknown as { onSchedulerTick(): void };
  const origSched = priv.onSchedulerTick.bind(arena);
  priv.onSchedulerTick = () => { const a = performance.now(); origSched(); if (measuring) schedMs.push(performance.now() - a); };

  // Byte counters per socket, 100 ms buckets for burst detection.
  const BUCKET = 100;
  const down = arena.clients.map(() => new Map<number, number>()), up = arena.clients.map(() => new Map<number, number>());
  let t0 = 0;
  const add = (m: Map<number, number>, n: number) => { const k = Math.floor((performance.now() - t0) / BUCKET); m.set(k, (m.get(k) ?? 0) + n); };
  const size = (d: unknown) => typeof d === "string" ? Buffer.byteLength(d) : (d as { byteLength?: number })?.byteLength ?? 0;
  arena.clients.forEach((cl, i) => {
    const ws = (cl as unknown as { ref: { send: (...a: unknown[]) => unknown; on: (e: string, f: (d: unknown) => void) => void } }).ref;
    const send = ws.send.bind(ws);
    ws.send = (d: unknown, ...rest: unknown[]) => { if (measuring) add(down[i]!, size(d)); return send(d, ...rest); };
    ws.on("message", (d: unknown) => { if (measuring) add(up[i]!, size(d)); });
  });

  // Put the fighters close together so skills and hits actually happen.
  cls.forEach((_, i) => {
    const id = [...players(cls[0]!.room).values()].find((p) => p.displayName === `Perf${i}`).entityId as number;
    const body = arena.movement!.get(id)!;
    const y = arena.movement!.position(id)![1];
    const x = Math.cos(i * 1.57) * 2.5, z = Math.sin(i * 1.57) * 2.5;
    body.rb.setTranslation({ x, y, z }, true); body.rb.setNextKinematicTranslation({ x, y, z });
  });
  await sleep(500);

  const overloadsBefore = arena.sim.overloads;
  t0 = performance.now(); measuring = true;
  const seqs = cls.map(() => 0), edgeIds = cls.map(() => 0);
  let stop = false;
  const loops = cls.map(async (x, i) => {
    let n = 0;
    while (!stop) {
      n++;
      const ang = (n / 30) * 0.8 + i;
      const edges: Array<Record<string, unknown>> = [];
      if (n % 30 === 0) { const slot = ((n / 30 + i) % 3) + 1; edges.push({ id: ++edgeIds[i]!, kind: "skillDown", slot }, { id: ++edgeIds[i]!, kind: "skillUp", slot }); }
      const pkt = parseInputPacket({
        v: 1, epoch: x.c.welcome!.epoch, seq: ++seqs[i]!, sampleTick: arena.sim.tick >>> 0, moveX: Math.cos(ang), moveZ: Math.sin(ang),
        yaw: ang, pitch: 0, attackHeld: n % 20 < 6, blockHeld: false, jumpHeld: false, runHeld: false, chargeHeldSlot: 0, edges,
      });
      if (pkt) x.c.send("input", pkt);
      await sleep(1000 / 30);
    }
  });
  await sleep(RUN_MS);
  stop = true; measuring = false;
  await Promise.all(loops);
  const secs = RUN_MS / 1000;
  const overloads = arena.sim.overloads - overloadsBefore;

  const stat = (m: Map<number, number>) => {
    const total = [...m.values()].reduce((a, b) => a + b, 0);
    const perSec = BUCKET > 0 ? 1000 / BUCKET : 10;
    let burst = 0; // best sliding 1 s window
    const maxK = Math.floor(RUN_MS / BUCKET);
    let win = 0;
    for (let k = 0; k < maxK; k++) { win += m.get(k) ?? 0; if (k >= perSec) win -= m.get(k - perSec) ?? 0; burst = Math.max(burst, win); }
    return { steadyKBps: +(total / secs / 1000).toFixed(2), burstKB1s: +(burst / 1000).toFixed(2) };
  };
  const report = {
    runSeconds: secs, players: 4,
    stepTick: { n: stepMs.length, p50: +pct(stepMs, 0.5).toFixed(3), p95: +pct(stepMs, 0.95).toFixed(3), p99: +pct(stepMs, 0.99).toFixed(3), max: +Math.max(...stepMs).toFixed(3) },
    schedulerCallback: { n: schedMs.length, p50: +pct(schedMs, 0.5).toFixed(3), p95: +pct(schedMs, 0.95).toFixed(3), p99: +pct(schedMs, 0.99).toFixed(3), max: +Math.max(...schedMs).toFixed(3) },
    overloadEvents: overloads,
    upstreamPerPlayer: up.map(stat), downstreamPerPlayer: down.map(stat),
  };
  if (process.env["T30_REPORT"]) writeFileSync(process.env["T30_REPORT"], JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
  for (const x of cls) await x.room.leave().catch(() => undefined);
  expect(stepMs.length).toBeGreaterThan(RUN_MS / 1000 * 40); // the room really ticked
  expect(up.every((m) => m.size > 0) && down.every((m) => m.size > 0)).toBe(true);
}, RUN_MS + 40_000);

/**
 * QP02 peak combat: four fighters packed into one 1.2 m cluster, attack held, all three skills pressed every second, two awakenings
 * overlapping (meter filled by fixture), HP topped up twice a second so the exchange never ends. Server decides everything; the fixture
 * only places, fills the meter and tops up HP (synthetic). Splits stepTick from the Colyseus patch serializer (broadcastPatch) and from
 * socket bytes. Hits are counted on the server as HP decreases between ticks.
 */
test.skipIf(!enabled)("QP02 peak combat: collision-heavy exchange with overlapping awakenings, tick and serializer cost, bytes", async () => {
  const code = freshCode();
  const kits = ["sv", "td", "sv", "td"] as const;
  const cls = [];
  for (let i = 0; i < 4; i++) { const c = await loginClient(h, `Peak${i}`); const room = await c.join(code); cls.push({ c, room }); }
  await waitFor(() => cls.every((x) => x.c.welcome !== null) && cls.every((x) => players(x.room).size === 4), 10_000, "joined");
  cls.forEach((x, i) => x.c.send("ready", { kitId: kits[i], contentHash: x.c.localContentHash }));
  await waitFor(() => cls.every((x) => [...players(x.room).values()].every((p) => p.ready && p.action === "Idle")), 10_000, "ready");
  const arena = matchMaker.getLocalRoomById(cls[0]!.room.roomId) as unknown as ArenaRoom;
  const ids = cls.map((_, i) => [...players(cls[0]!.room).values()].find((p) => p.displayName === `Peak${i}`).entityId as number);
  await waitFor(() => ids.every((id) => arena.sim.tick > arena.combat.get(id)!.protectedUntilTick + 2), 10_000, "spawn protection over");

  const stepMs: number[] = [], patchMs: number[] = [];
  let measuring = false, hits = 0, kos = 0, maxAwakened = 0;
  const origStep = arena.stepTick.bind(arena);
  const prevHp = new Map<number, number>(ids.map((id) => [id, arena.combat.get(id)!.hp100]));
  arena.stepTick = (t: number) => {
    const a = performance.now(); origStep(t); const dt = performance.now() - a;
    if (!measuring) return;
    stepMs.push(dt);
    let awake = 0;
    for (const id of ids) {
      const f = arena.combat.get(id)!; const p = prevHp.get(id)!;
      if (f.hp100 < p) { hits += 1; if (f.hp100 <= 0) kos += 1; }
      prevHp.set(id, f.hp100);
      if (f.form === "Awakened") awake += 1;
    }
    maxAwakened = Math.max(maxAwakened, awake);
  };
  const priv = arena as unknown as { broadcastPatch(): boolean };
  const origPatch = priv.broadcastPatch.bind(arena);
  priv.broadcastPatch = () => { const a = performance.now(); const r = origPatch(); if (measuring) patchMs.push(performance.now() - a); return r; };

  const BUCKET = 100;
  const down = arena.clients.map(() => new Map<number, number>()), up = arena.clients.map(() => new Map<number, number>());
  let t0 = 0;
  const add = (m: Map<number, number>, n: number) => { const k = Math.floor((performance.now() - t0) / BUCKET); m.set(k, (m.get(k) ?? 0) + n); };
  const size = (d: unknown) => typeof d === "string" ? Buffer.byteLength(d) : (d as { byteLength?: number })?.byteLength ?? 0;
  arena.clients.forEach((cl, i) => {
    const ws = (cl as unknown as { ref: { send: (...a: unknown[]) => unknown; on: (e: string, f: (d: unknown) => void) => void } }).ref;
    const send = ws.send.bind(ws);
    ws.send = (d: unknown, ...rest: unknown[]) => { if (measuring) add(down[i]!, size(d)); return send(d, ...rest); };
    ws.on("message", (d: unknown) => { if (measuring) add(up[i]!, size(d)); });
  });

  const cluster = (): void => ids.forEach((id, i) => {
    const body = arena.movement!.get(id)!;
    const y = arena.movement!.position(id)![1];
    const x = Math.cos(i * 1.57) * 0.6, z = Math.sin(i * 1.57) * 0.6;
    body.rb.setTranslation({ x, y, z }, true); body.rb.setNextKinematicTranslation({ x, y, z });
  });
  cluster();
  await sleep(300);
  const overloadsBefore = arena.sim.overloads;
  t0 = performance.now(); measuring = true;
  const seqs = cls.map(() => 0), edgeIds = cls.map(() => 0);
  let stop = false;
  const fixture = (async () => {
    while (!stop) {
      for (const [i, id] of ids.entries()) { const f = arena.combat.get(id)!; f.hp100 = 10000; prevHp.set(id, 10000); if (i < 2 && f.form !== "Awakened") f.meter100 = meterRequired100(kits[i]!); }
      if (arena.sim.tick % 120 < 30) cluster();
      await sleep(500);
    }
  })();
  const loops = cls.map(async (x, i) => {
    let n = 0;
    while (!stop) {
      n++;
      const ang = (n / 30) * 1.5 + i;
      const edges: Array<Record<string, unknown>> = [];
      if (n === 1 && i < 2) edges.push({ id: ++edgeIds[i]!, kind: "awaken" });
      if (n % 30 === 0) for (const slot of [1, 2, 3]) edges.push({ id: ++edgeIds[i]!, kind: "skillDown", slot }, { id: ++edgeIds[i]!, kind: "skillUp", slot });
      const pkt = parseInputPacket({
        v: 1, epoch: x.c.welcome!.epoch, seq: ++seqs[i]!, sampleTick: arena.sim.tick >>> 0, moveX: Math.cos(ang) * 0.3, moveZ: Math.sin(ang) * 0.3,
        yaw: ang + Math.PI, pitch: 0, attackHeld: true, blockHeld: false, jumpHeld: false, runHeld: false, chargeHeldSlot: 0, edges,
      });
      if (pkt) x.c.send("input", pkt);
      await sleep(1000 / 30);
    }
  });
  await sleep(RUN_MS);
  stop = true; measuring = false;
  await Promise.all([...loops, fixture]);
  const secs = RUN_MS / 1000;
  const stat = (m: Map<number, number>) => {
    const total = [...m.values()].reduce((a, b) => a + b, 0);
    let burst = 0, win = 0;
    const maxK = Math.floor(RUN_MS / BUCKET);
    for (let k = 0; k < maxK; k++) { win += m.get(k) ?? 0; if (k >= 1000 / BUCKET) win -= m.get(k - 1000 / BUCKET) ?? 0; burst = Math.max(burst, win); }
    return { steadyKBps: +(total / secs / 1000).toFixed(2), burstKB1s: +(burst / 1000).toFixed(2) };
  };
  const summ = (xs: number[]) => ({ n: xs.length, p50: +pct(xs, 0.5).toFixed(3), p95: +pct(xs, 0.95).toFixed(3), p99: +pct(xs, 0.99).toFixed(3), max: +Math.max(...xs).toFixed(3) });
  const report = {
    runSeconds: secs, players: 4, hits, kos, maxAwakenedAtOnce: maxAwakened,
    stepTick: summ(stepMs), patchSerialize: summ(patchMs), overloadEvents: arena.sim.overloads - overloadsBefore,
    upstreamPerPlayer: up.map(stat), downstreamPerPlayer: down.map(stat),
  };
  if (process.env["T30_PEAK_REPORT"]) writeFileSync(process.env["T30_PEAK_REPORT"], JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
  for (const x of cls) await x.room.leave().catch(() => undefined);
  // The workload must really be peak combat, then the T30 spec section 24 budgets must hold under it.
  expect(hits).toBeGreaterThan(20);
  expect(maxAwakened).toBeGreaterThanOrEqual(2);
  expect(report.stepTick.p95).toBeLessThan(4);
  expect(report.stepTick.p99).toBeLessThan(8);
  expect(report.overloadEvents).toBe(0);
  for (const s of report.upstreamPerPlayer) { expect(s.steadyKBps).toBeLessThan(8); expect(s.burstKB1s).toBeLessThan(80); }
  for (const s of report.downstreamPerPlayer) { expect(s.steadyKBps).toBeLessThan(30); expect(s.burstKB1s).toBeLessThan(80); }
}, RUN_MS + 40_000);
