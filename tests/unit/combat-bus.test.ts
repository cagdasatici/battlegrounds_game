import { describe, expect, test } from "vitest";
import { CombatBus, COMBAT_BUS_RING, type CombatListener } from "../../apps/client/src/app/CombatBus.js";
import { registerPresentation } from "../../apps/client/src/fx/index.js";
import type { CombatEvent } from "../../packages/shared/src/protocol.js";

const ev = (eventId: string, over: Partial<CombatEvent> = {}): CombatEvent =>
  ({ eventId, tick: 1, kind: "hit", actorId: "1", targetId: "2", lifeId: 5, ...over });

function make(life: Record<string, number> = { "2": 5 }) {
  let handler: CombatListener | null = null;
  let subs = 0, unsubs = 0;
  const bus = new CombatBus((h) => { handler = h; subs++; return () => { handler = null; unsubs++; }; }, (id) => life[id]);
  const got: CombatEvent[] = [];
  bus.on((e) => got.push(e));
  return { bus, got, send: (e: CombatEvent) => handler?.(e), subs: () => subs, unsubs: () => unsubs, attached: () => handler !== null };
}

describe("FX0 CombatBus", () => {
  test("subscribes once and delivers a duplicate eventId once", () => {
    const m = make();
    m.send(ev("a")); m.send(ev("a")); m.send(ev("b"));
    expect(m.subs()).toBe(1);
    expect(m.got.map((e) => e.eventId)).toEqual(["a", "b"]);
  });
  test("dedup memory is a ring of 512", () => {
    const m = make();
    for (let i = 0; i < COMBAT_BUS_RING + 1; i++) m.send(ev(`e${i}`));
    m.send(ev("e0")); // fell out of the ring: delivered again
    m.send(ev(`e${COMBAT_BUS_RING}`)); // still inside: dropped
    expect(m.got.length).toBe(COMBAT_BUS_RING + 2);
  });
  test("an event from an older life is dropped, the current and a newer life pass", () => {
    const m = make({ "2": 6 });
    m.send(ev("old", { lifeId: 5 })); m.send(ev("cur", { lifeId: 6 })); m.send(ev("next", { lifeId: 7 }));
    expect(m.got.map((e) => e.eventId)).toEqual(["cur", "next"]);
  });
  test("an unknown fighter never drops events", () => {
    const m = make({});
    m.send(ev("x"));
    expect(m.got.length).toBe(1);
  });
  test("dispose unsubscribes from the room and from listeners", () => {
    const m = make();
    m.bus.dispose();
    m.send(ev("a")); m.bus.dispatch(ev("b"));
    expect(m.unsubs()).toBe(1);
    expect(m.attached()).toBe(false);
    expect(m.got).toEqual([]);
  });
  test("a listener unsubscribe stops only that listener", () => {
    const m = make();
    const extra: string[] = [];
    const off = m.bus.on((e) => extra.push(e.eventId));
    m.send(ev("a")); off(); m.send(ev("b"));
    expect(extra).toEqual(["a"]);
    expect(m.got.length).toBe(2);
  });
  test("registerPresentation returns a callable disposer for the no-op stubs", () => {
    const m = make();
    const d = registerPresentation(m.bus, { scene: null as never, camera: null as never, players: () => new Map(), settings: null as never, localId: () => undefined });
    expect(() => d()).not.toThrow();
  });
});
