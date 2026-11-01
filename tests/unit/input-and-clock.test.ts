import { describe, expect, test } from "vitest";
import { FixedClock, MAX_CATCHUP_STEPS, STEP_MS } from "../../apps/server/src/sim/FixedClock.js";
import { InputChannel } from "../../apps/server/src/net/ValidateInput.js";
import { TokenBucket } from "../../apps/server/src/net/RateLimits.js";

const pkt = (o: Record<string, unknown> = {}) => ({
  v: 1, epoch: 1, seq: 1, sampleTick: 0, moveX: 0, moveZ: 0, yaw: 0, pitch: 0,
  attackHeld: false, blockHeld: false, jumpHeld: false, runHeld: false, chargeHeldSlot: 0, edges: [], ...o,
});

describe("FixedClock", () => {
  test("runs exactly one logical tick per 1/60 s regardless of callback cadence", () => {
    const c = new FixedClock();
    let n = 0;
    for (let i = 0; i < 60; i++) c.advance(STEP_MS, () => n++);
    expect(n).toBe(60);
    expect(c.tick).toBe(60);
  });
  test("accumulates sub-step time and never uses a client dt", () => {
    const c = new FixedClock();
    let n = 0;
    c.advance(STEP_MS / 2, () => n++);
    expect(n).toBe(0);
    c.advance(STEP_MS / 2 + 0.001, () => n++);
    expect(n).toBe(1);
  });
  test("caps catch up at 5 steps and records overload instead of granting extra ticks", () => {
    const c = new FixedClock();
    let n = 0;
    const steps = c.advance(250, () => n++);
    expect(steps).toBe(MAX_CATCHUP_STEPS);
    expect(n).toBe(5);
    expect(c.overloads).toBe(1);
  });
  test("negative elapsed is ignored; more than 3 overloads in 10 s flags overload", () => {
    const c = new FixedClock();
    c.advance(-50, () => { throw new Error("no step"); });
    for (let i = 0; i < 4; i++) c.advance(250, () => undefined, 1000 + i);
    expect(c.isOverloaded(2000)).toBe(true);
    expect(c.isOverloaded(20_000)).toBe(false);
  });
});

describe("InputChannel", () => {
  test("accepts a valid packet and normalizes oversize movement vectors", () => {
    const ch = new InputChannel(0);
    expect(ch.accept(pkt({ moveX: 3, moveZ: 4 }), 5, 0)).toBeNull();
    expect(Math.hypot(ch.held.moveX, ch.held.moveZ)).toBeCloseTo(1, 6);
  });
  test("A07: the same skill edge replayed 10 times queues one action; stale epoch is rejected", () => {
    const ch = new InputChannel(0);
    const edge = { id: 1, kind: "skillDown", slot: 2 };
    for (let i = 1; i <= 10; i++) ch.accept(pkt({ seq: i, edges: [edge] }), i, i * 40);
    expect(ch.drain()).toHaveLength(1);
    expect(ch.accept(pkt({ epoch: 0, seq: 99 }), 11, 500)).toBe("STALE_EPOCH");
  });
  test("old seq cannot overwrite newer holds", () => {
    const ch = new InputChannel(0);
    ch.accept(pkt({ seq: 5, attackHeld: true }), 1, 0);
    expect(ch.accept(pkt({ seq: 4, attackHeld: false }), 2, 100)).toBe("OLD_SEQ");
    expect(ch.held.attackHeld).toBe(true);
  });
  test("A16: NaN, 100 edges, oversized strings are rejected and the channel keeps working", () => {
    const ch = new InputChannel(0);
    expect(ch.accept(pkt({ moveX: NaN }), 1, 0)).toBe("MALFORMED");
    expect(ch.accept(pkt({ edges: Array.from({ length: 100 }, (_, i) => ({ id: i + 1, kind: "jump" })) }), 1, 0)).toBe("MALFORMED");
    expect(ch.accept(pkt({ displayName: "x".repeat(5000) }), 1, 0)).toBe("MALFORMED");
    expect(ch.accept("garbage", 1, 0)).toBe("MALFORMED");
    expect(ch.accept(null, 1, 0)).toBe("MALFORMED");
    expect(ch.accept(pkt({ seq: 1 }), 1, 0)).toBeNull();
  });
  test("packet rate bucket: burst 15 then ~45 per second", () => {
    const ch = new InputChannel(0);
    let ok = 0;
    for (let i = 1; i <= 30; i++) if (ch.accept(pkt({ seq: i }), 1, 0) === null) ok++;
    expect(ok).toBe(15);
    expect(ch.accept(pkt({ seq: 31 }), 1, 1000)).toBeNull(); // refilled after 1 s
  });
  test("edge rate bucket: burst 8 edges then limited; excess edges are dropped not queued", () => {
    const ch = new InputChannel(0);
    const edges = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, kind: "jump" }));
    const more = Array.from({ length: 6 }, (_, i) => ({ id: i + 7, kind: "jump" }));
    ch.accept(pkt({ seq: 1, edges }), 1, 0);
    ch.accept(pkt({ seq: 2, edges: more }), 1, 0);
    expect(ch.drain()).toHaveLength(8);
  });
  test("A20: renewing the epoch discards queued edges and old epoch packets", () => {
    const ch = new InputChannel(0);
    ch.accept(pkt({ seq: 1, edges: [{ id: 1, kind: "skillDown", slot: 1 }], attackHeld: true }), 1, 0);
    const e = ch.renewEpoch(1000);
    expect(e).toBe(2);
    expect(ch.drain()).toHaveLength(0);
    expect(ch.held.attackHeld).toBe(false);
    expect(ch.accept(pkt({ epoch: 1, seq: 2, edges: [{ id: 2, kind: "skillUp", slot: 1 }] }), 2, 1100)).toBe("STALE_EPOCH");
    expect(ch.accept(pkt({ epoch: 2, seq: 1 }), 2, 1100)).toBeNull(); // counters restart in the new epoch
  });
  test("lease: holds clear after 15 ticks without a fresh packet; fresh input keeps them", () => {
    const ch = new InputChannel(0);
    ch.accept(pkt({ attackHeld: true, blockHeld: true }), 10, 0);
    ch.expireLease(25, 15);
    expect(ch.held.attackHeld).toBe(true);
    ch.expireLease(26, 15);
    expect(ch.held.attackHeld).toBe(false);
    expect(ch.held.blockHeld).toBe(false);
  });
});

describe("TokenBucket", () => {
  test("never exceeds burst and refills linearly", () => {
    const b = new TokenBucket(2, 2, 0);
    expect([b.take(0), b.take(0), b.take(0)]).toEqual([true, true, false]);
    expect(b.take(500)).toBe(true);
    expect(b.take(500)).toBe(false);
    expect(b.take(100_000)).toBe(true);
    expect([b.take(100_000), b.take(100_000)]).toEqual([true, false]);
  });
});
