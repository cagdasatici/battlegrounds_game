import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { startHarness, loginClient, waitFor, players, freshCode, type Harness } from "../fixtures/harness.js";

let h: Harness;
beforeAll(async () => { h = await startHarness(25676); });
afterAll(async () => { await h.stop(); });

const pkt = (epoch: number, seq: number, o: Record<string, unknown> = {}) => ({
  v: 1, epoch, seq, sampleTick: 0, moveX: 0, moveZ: 0, yaw: 0, pitch: 0,
  attackHeld: false, blockHeld: false, jumpHeld: false, runHeld: false, chargeHeldSlot: 0, edges: [], ...o,
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("T06 authoritative movement over a real Colyseus connection", () => {
  test("ready spawns on an anchor; held move intent moves the player; both clients see it; jump rises and lands", async () => {
    const code = freshCode();
    const a = await loginClient(h, "Arel");
    const b = await loginClient(h, "Nora");
    const ra = await a.join(code);
    const rb = await b.join(code);
    await waitFor(() => a.welcome !== null && players(ra).size === 2 && players(rb).size === 2, 3000, "joined");
    a.send("ready", { kitId: "sv", contentHash: a.localContentHash });
    b.send("ready", { kitId: "sv", contentHash: b.localContentHash });
    const me = () => [...players(ra).values()].find((p) => p.displayName === "Arel");
    const meFromB = () => [...players(rb).values()].find((p) => p.displayName === "Arel");
    await waitFor(() => me()?.ready === true && Math.abs(me()!.y - 92) <= 3, 3000, "spawned and settled");
    const start = { x: me()!.x, z: me()!.z };
    // Spawn anchors are (+-18, 0, +-14) or (+-34, 0, +-3); capsule centre 0.9 m above surface.
    expect([1800, 3400]).toContain(Math.abs(start.x));
    const epoch = a.welcome!.epoch;
    let seq = 0;
    const dir = start.x > 0 ? -1 : 1; // walk toward the centre
    // Send held intent at ~30 Hz for ~1 s (lease is 15 ticks, so steady packets keep it held).
    const t0 = Date.now();
    while (Date.now() - t0 < 1000) { a.send("input", pkt(epoch, ++seq, { moveX: dir })); await sleep(33); }
    await waitFor(() => Math.abs(meFromB()!.x - start.x) > 300, 2000, "B observes A moving");
    const moved = Math.abs(me()!.x - start.x) / 100;
    expect(moved).toBeGreaterThan(3); // ~5 m/s walk for ~1 s minus acceleration and latency
    expect(moved).toBeLessThan(6.5);
    expect(Math.abs(me()!.z - start.z)).toBeLessThan(5);
    // Lease expiry: with no packets, movement stops within ~15 ticks.
    await sleep(500);
    const stopX = me()!.x;
    await sleep(300);
    expect(Math.abs(me()!.x - stopX)).toBeLessThan(2);

    // Jump edge: rises then returns to ground. A duplicate edge id is not a second jump.
    const groundY = me()!.y;
    let maxY = groundY;
    a.send("input", pkt(epoch, ++seq, { jumpHeld: true, edges: [{ id: 1, kind: "jump" }] }));
    a.send("input", pkt(epoch, ++seq, { jumpHeld: true, edges: [{ id: 1, kind: "jump" }] }));
    const t1 = Date.now();
    while (Date.now() - t1 < 1200) { maxY = Math.max(maxY, me()!.y); await sleep(10); }
    expect(maxY - groundY).toBeGreaterThan(100);
    expect(maxY - groundY).toBeLessThan(160); // one jump: 8^2/(2*24)=1.33 m plus ~0.07 m discrete-step overshoot; two would be ~2.8 m
    expect(Math.abs(me()!.y - groundY)).toBeLessThanOrEqual(3);
    expect(me()!.vy).toBe(0);
    await a.leave(); await b.leave();
  });

  test("client-claimed positions are ignored: unknown fields reject the packet", async () => {
    const code = freshCode();
    const a = await loginClient(h, "Arel");
    const ra = await a.join(code);
    await waitFor(() => a.welcome !== null, 3000, "welcome");
    a.send("ready", { kitId: "sv", contentHash: a.localContentHash });
    const me = () => [...players(ra).values()][0];
    await waitFor(() => me()?.ready === true && Math.abs(me()!.y - 92) <= 3, 3000, "settled");
    const x0 = me()!.x;
    for (let i = 1; i <= 10; i++) { a.send("input", { ...pkt(a.welcome!.epoch, i, { moveX: 1 }), x: 0, y: 99 }); await sleep(20); }
    await sleep(300);
    expect(me()!.x).toBe(x0);
    await a.leave();
  });
});
