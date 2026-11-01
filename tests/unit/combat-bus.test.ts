import { describe, expect, test } from "vitest";
import { CombatBus } from "../../apps/client/src/app/CombatBus.js";
import { registerPresentation } from "../../apps/client/src/fx/index.js";
import type { CombatEvent } from "../../packages/shared/src/protocol.js";

const ev = (eventId: string, over: Partial<CombatEvent> = {}): CombatEvent =>
  ({ eventId, tick: 1, kind: "hit", actorId: "1", targetId: "2", lifeId: 1, ...over });

function mk(lives: Record<string, number> = { "2": 1 }) {
  let handler: ((e: CombatEvent) => void) | null = null;
  const bus = new CombatBus((h) => { handler = h; return () => { handler = null; }; }, (id) => lives[id]);
  const got: string[] = [];
  bus.on((e) => got.push(e.eventId));
  return { bus, got, send: (e: CombatEvent) => handler?.(e), attached: () => handler !== null };
}

describe("CombatBus", () => {
  test("duplicate eventId delivered once", () => {
    const t = mk();
    t.send(ev("a")); t.send(ev("a")); t.send(ev("b"));
    expect(t.got).toEqual(["a", "b"]);
  });
  test("ring buffer forgets ids older than 512", () => {
    const t = mk();
    for (let i = 0; i < 513; i++) t.send(ev(`e${i}`));
    t.send(ev("e0")); // evicted, delivered again
    t.send(ev("e512")); // still remembered
    expect(t.got.length).toBe(514);
  });
  test("stale life dropped, current and newer delivered", () => {
    const t = mk({ "2": 3 });
    t.send(ev("old", { lifeId: 2 })); t.send(ev("cur", { lifeId: 3 })); t.send(ev("new", { lifeId: 4 }));
    expect(t.got).toEqual(["cur", "new"]);
  });
  test("dispose unsubscribes and stops delivery", () => {
    const t = mk();
    t.bus.dispose();
    expect(t.attached()).toBe(false);
    t.send(ev("x"));
    expect(t.got).toEqual([]);
  });
  test("listener unsubscribe works; presentation disposer is callable", () => {
    const t = mk();
    const got2: string[] = [];
    const off = t.bus.on((e) => got2.push(e.eventId));
    t.send(ev("a")); off(); t.send(ev("b"));
    expect(got2).toEqual(["a"]);
    const d = registerPresentation(t.bus, { scene: {} as never, camera: {} as never, players: () => new Map(), settings: { get: () => ({}) }, localId: () => undefined });
    expect(() => d()).not.toThrow();
  });
});
