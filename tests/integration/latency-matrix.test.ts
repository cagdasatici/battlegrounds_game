import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { writeFileSync } from "node:fs";
import { matchMaker } from "colyseus";
import { Client } from "@colyseus/sdk";
import { startHarness, browserFetch, waitFor, players, freshCode, type Harness } from "../fixtures/harness.js";
import { LatencyProxy, type LatencyStats } from "../fixtures/LatencyProxy.js";
import { RoomClient } from "../../apps/client/src/net/RoomClient.js";
import type { CombatEvent } from "../../packages/shared/src/protocol.js";
import type { ArenaRoom } from "../../apps/server/src/rooms/ArenaRoom.js";
import { computeLayout } from "../../apps/client/src/input/ControlLayout.js";
import { PointerRouter } from "../../apps/client/src/input/PointerRouter.js";
import { IntentSampler } from "../../apps/client/src/input/IntentSampler.js";

/**
 * R18 latency matrix (spec section 26): A01, A07, A08 and A20 through a TCP delay proxy at RTT 20/80/150/250 ms and
 * jitter 0/40 ms, always against real RoomClient connections. HTTP (login, ticket) goes direct; only the WebSocket is delayed.
 * Each scenario returns a signature of authoritative results; every condition must equal the 0 ms run.
 * Set R18_REPORT=<path> to write the measured rows as JSON.
 */
let h: Harness;
beforeAll(async () => { h = await startHarness(25716); });
afterAll(async () => { await h.stop(); });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const L = computeLayout({ x0: 0, y0: 0, W: 1024, H: 768 });
type Sig = Record<string, unknown>;

interface Seat {
  name: string; cl: RoomClient; room: Awaited<ReturnType<RoomClient["join"]>>; id: number; events: CombatEvent[];
  tap(slot: 1 | 2 | 3 | 4): void;
}

async function login(proxyPort: number, name: string): Promise<RoomClient> {
  const store = new Map<string, string>();
  const c = new RoomClient({
    httpBase: h.origin, wsEndpoint: `ws://localhost:${proxyPort}`, fetchFn: browserFetch(h.origin),
    storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: (k) => void store.delete(k) },
    sleep: async () => undefined,
  });
  await c.login(h.svc.invites.create({ ttlMs: 60_000, maxUses: 1 }).token, name);
  return c;
}

async function openRoom(proxyPort: number, specs: Array<[string, "sv" | "td"]>) {
  const code = freshCode();
  const seats: Seat[] = [];
  for (const [name] of specs) {
    const cl = await login(proxyPort, name);
    const room = await cl.join(code);
    const events: CombatEvent[] = [];
    room.onMessage("combatEvent", (e: CombatEvent) => { events.push(e); });
    seats.push({ name, cl, room, id: 0, events, tap: () => undefined });
  }
  const first = seats[0]!;
  await waitFor(() => seats.every((s) => s.cl.welcome !== null) && seats.every((s) => players(s.room).size === specs.length), 8000, "joined");
  specs.forEach(([, kit], i) => seats[i]!.cl.send("ready", { kitId: kit, contentHash: seats[i]!.cl.localContentHash }));
  const find = (s: Seat, n: string) => [...players(s.room).values()].find((p) => p.displayName === n);
  await waitFor(() => seats.every((s) => specs.every(([n]) => find(s, n)?.ready && find(s, n).action === "Idle")), 8000, "ready");
  const room = matchMaker.getLocalRoomById(first.room.roomId) as unknown as ArenaRoom;
  seats.forEach((s) => { s.id = find(first, s.name).entityId as number; });
  await waitFor(() => seats.every((s) => room.sim.tick > room.combat.get(s.id)!.protectedUntilTick + 2 && room.movement!.get(s.id)!.state.grounded), 8000, "settled");
  let pid = 500;
  const raw = (s: Seat, slot: number) => {
    const router = new PointerRouter(L, { awakeningReady: () => true });
    const sampler = new IntentSampler(router, s.cl.welcome!.epoch);
    const c = L.controls[`skill${slot}` as "skill1"];
    router.down({ pointerId: ++pid, x: c.cx, y: c.cy });
    const down = sampler.sample(1)!;
    router.up(pid);
    return { down, up: sampler.sample(2)! };
  };
  for (const s of seats) s.tap = (slot) => { const p = raw(s, slot); s.cl.send("input", p.down); s.cl.send("input", p.up); };
  const place = (s: Seat, x: number, z: number, yaw: number) => {
    const body = room.movement!.get(s.id)!;
    const y = room.movement!.position(s.id)![1];
    body.rb.setTranslation({ x, y, z }, true);
    body.rb.setNextKinematicTranslation({ x, y, z });
    body.state.facingYaw = yaw; body.state.vx = 0; body.state.vz = 0;
  };
  const close = async () => { for (const s of seats) await s.room.leave().catch(() => undefined); };
  return { seats, room, find, place, raw, close };
}

const kinds = (ev: CombatEvent[]) => { const m: Record<string, number> = {}; for (const e of ev) m[e.kind] = (m[e.kind] ?? 0) + 1; return m; };

const scenarios: Record<string, (port: number) => Promise<Sig>> = {
  A01: async (port) => {
    const r = await openRoom(port, [["Arel", "sv"], ["Nora", "sv"]]);
    try {
      const [a, b] = r.seats as [Seat, Seat];
      const view = (s: Seat) => [...players(s.room).values()].map((p) => ({ n: p.displayName, hp: p.hp100, e: p.entityId, l: p.lifeId }));
      await waitFor(() => view(a).length === 2 && view(b).length === 2, 5000, "both views");
      const va = view(a).sort((x, y) => x.e - y.e), vb = view(b).sort((x, y) => x.e - y.e);
      expect(vb).toEqual(va); // identical health and ids on both clients
      expect(new Set(va.map((p) => p.e)).size).toBe(2);
      expect(new Set(va.map((p) => p.l)).size).toBe(2);
      return { players: va.length, hp: va.map((p) => p.hp), distinctEntities: true, distinctLives: true };
    } finally { await r.close(); }
  },
  A07: async (port) => {
    const r = await openRoom(port, [["Arel", "sv"], ["Nora", "td"]]);
    try {
      const [a, b] = r.seats as [Seat, Seat];
      const bp = r.room.movement!.position(b.id)!;
      r.place(b, bp[0], bp[2], Math.PI);
      r.place(a, bp[0], bp[2] + 1.5, 0);
      await sleep(60);
      const before = r.room.combat.get(a.id)!.castCounter;
      const { down } = r.raw(a, 3);
      for (let i = 0; i < 10; i++) a.cl.send("input", down); // the same skill edge, 10 times
      a.cl.send("input", { ...down, epoch: down.epoch - 1, seq: down.seq + 50, edges: [{ ...down.edges[0]!, id: down.edges[0]!.id + 7 }] }); // stale epoch
      await waitFor(() => r.find(b, "Nora").hp100 < 10000, 10000, "hit landed");
      await sleep(1200); // any duplicate cast would have landed by now
      const hp = r.find(b, "Nora").hp100;
      expect(hp).toBe(10000 - 700);
      expect(r.room.combat.get(a.id)!.castCounter - before).toBe(1);
      expect(r.room.combat.invariantViolations()).toEqual([]);
      return { casts: r.room.combat.get(a.id)!.castCounter - before, victimHp100: hp, events: kinds(a.events), eventsMatch: JSON.stringify(a.events) === JSON.stringify(b.events) };
    } finally { await r.close(); }
  },
  A08: async (port) => {
    const r = await openRoom(port, [["Arel", "td"], ["Cleo", "td"], ["Nora", "sv"]]);
    try {
      const [a, c, b] = r.seats as [Seat, Seat, Seat];
      const bp = r.room.movement!.position(b.id)!;
      r.place(b, bp[0], bp[2], Math.PI);
      r.place(a, bp[0], bp[2] + 1.5, 0);
      r.place(c, bp[0], bp[2] - 1.5, Math.PI);
      await sleep(60);
      a.tap(1); c.tap(1); // both attempt the td.b1 capture in the same instant
      await waitFor(() => a.events.some((e) => e.kind === "capture") || c.events.some((e) => e.kind === "capture"), 10000, "capture");
      await waitFor(() => r.room.combat.captures.size === 0 && r.find(b, "Nora").action !== "Captured", 10000, "capture finished");
      await sleep(800);
      const hp = r.find(b, "Nora").hp100;
      // Whichever capture the server ordered first wins; the other cast must not damage the victim.
      expect(hp).toBe(10000 - 2400);
      expect(r.room.combat.invariantViolations()).toEqual([]);
      return { victimHp100: hp, stuckCaptures: r.room.combat.captures.size, invariants: r.room.combat.invariantViolations().length };
    } finally { await r.close(); }
  },
  A20: async (port) => {
    const r = await openRoom(port, [["Arel", "sv"], ["Nora", "td"]]);
    try {
      const [a, b] = r.seats as [Seat, Seat];
      const bp = r.room.movement!.position(b.id)!;
      r.place(b, bp[0], bp[2], Math.PI);
      r.place(a, bp[0], bp[2] + 1.5, 0);
      await sleep(60);
      const stale = r.raw(a, 3); // built under the old epoch, sent only after the resync
      const before = r.room.combat.get(a.id)!.castCounter;
      const token = a.room.reconnectionToken;
      a.room.reconnection.enabled = false;
      a.room.connection.close(4010, "network lost");
      const arel = () => [...players(b.room).values()].find((p) => p.displayName === "Arel");
      await waitFor(() => arel()?.connected === false, 8000, "dropped");
      const back = await new Client(`ws://localhost:${port}`).reconnect(token);
      await waitFor(() => arel()?.connected === true, 8000, "reconnected");
      back.send("input", stale.down);
      back.send("input", stale.up);
      await sleep(1500);
      const hp = r.find(b, "Nora").hp100;
      expect(hp).toBe(10000);
      expect(r.room.combat.get(a.id)!.castCounter).toBe(before);
      expect(r.room.combat.get(a.id)!.cast).toBeNull();
      expect(r.room.combat.invariantViolations()).toEqual([]);
      const casts = r.room.combat.get(a.id)!.castCounter - before;
      await back.leave().catch(() => undefined);
      return { casts, victimHp100: hp };
    } finally { await r.close(); }
  },
};

const RTTS = [20, 80, 150, 250], JITTERS = [0, 40];
const rows: Array<{ scenario: string; rttMs: number; jitterMs: number; wallMs: number; stats: LatencyStats; signature: Sig }> = [];
const baselines: Record<string, Sig> = {};

describe("R18 latency matrix: authoritative results equal the 0 ms run", () => {
  for (const [name, run] of Object.entries(scenarios)) {
    test(`${name} baseline (proxy, 0 ms)`, async () => {
      const px = new LatencyProxy(h.port, { rttMs: 0, jitterMs: 0 });
      await px.start();
      try {
        const t0 = Date.now();
        baselines[name] = await run(px.port);
        rows.push({ scenario: name, rttMs: 0, jitterMs: 0, wallMs: Date.now() - t0, stats: px.stats(), signature: baselines[name]! });
      } finally { await px.stop(); }
    }, 90000);
    for (const jitter of JITTERS) for (const rtt of RTTS) {
      test(`${name} rtt ${rtt} ms jitter ${jitter} ms`, async () => {
        const px = new LatencyProxy(h.port, { rttMs: rtt, jitterMs: jitter, seed: rtt * 7 + jitter });
        await px.start();
        try {
          const t0 = Date.now();
          const sig = await run(px.port);
          rows.push({ scenario: name, rttMs: rtt, jitterMs: jitter, wallMs: Date.now() - t0, stats: px.stats(), signature: sig });
          expect(sig).toEqual(baselines[name]);
          expect(px.stats().chunks).toBeGreaterThan(0);
        } finally { await px.stop(); }
      }, 120000);
    }
  }
  test("report", () => { if (process.env.R18_REPORT) writeFileSync(process.env.R18_REPORT, JSON.stringify(rows, null, 1)); });
  test.todo("packet loss 1 percent: NOT RUN (needs OS level shaping)");
  test.todo("packet loss 3 percent: NOT RUN (needs OS level shaping)");
});
