import { describe, expect, test } from "vitest";
import type { WelcomeMessage } from "../../packages/shared/src/protocol.js";
import {
  CLOSE_TEXT, ConnectionLifecycle, JOINING_TEXT, RECONNECTING_TEXT, classifyClose, phaseText,
  type LifecycleRoom, type LocalView, type SignalLike,
} from "../../apps/client/src/app/ConnectionLifecycle.js";
import { RoomClient, parseResumeMeta, type StorageLike } from "../../apps/client/src/net/RoomClient.js";

function signal<A extends unknown[]>() {
  const subs = new Set<(...a: A) => void>();
  const fn = ((cb: (...a: A) => void) => { subs.add(cb); }) as SignalLike<A>;
  fn.remove = (cb) => { subs.delete(cb); };
  return { fn, subs, emit: (...a: A) => { for (const c of [...subs]) c(...a); } };
}
function fakeRoom() {
  const drop = signal<[number, string?]>(), reconnect = signal<[]>(), leave = signal<[number, string?]>();
  const handlers = new Set<(w: WelcomeMessage) => void>();
  const room: LifecycleRoom = {
    onDrop: drop.fn, onReconnect: reconnect.fn, onLeave: leave.fn,
    onMessage: (_t, cb) => { handlers.add(cb); return () => { handlers.delete(cb); }; },
  };
  return {
    room, handlers,
    listeners: () => drop.subs.size + reconnect.subs.size + leave.subs.size + handlers.size,
    drop: () => drop.emit(1006), reconnect: () => reconnect.emit(), leave: (c: number) => leave.emit(c),
    welcome: (epoch: number) => { for (const h of [...handlers]) h({ epoch, serverTick: 1, tickRate: 60, contentHash: "x" }); },
  };
}
function setup(requireReady = true) {
  const f = fakeRoom();
  const calls: string[] = [];
  let local: LocalView | null = null;
  const lc = new ConnectionLifecycle({
    readLocal: () => local,
    onPhase: (p) => calls.push(`phase:${p}`),
    onDrop: () => calls.push("drop"),
    onWelcome: (w) => calls.push(`welcome:${w.epoch}`),
    onClosed: (k, c) => calls.push(`closed:${k}:${c}`),
  });
  lc.attach(f.room);
  lc.setRequireReady(requireReady);
  return { f, lc, calls, setLocal: (v: LocalView | null) => { local = v; } };
}

describe("GR03 ConnectionLifecycle", () => {
  test("active needs a welcome AND the matching owner epoch AND the authoritative ready flag", () => {
    const { f, lc, setLocal } = setup();
    expect(lc.inputEnabled).toBe(false);
    f.welcome(1);
    expect(lc.inputEnabled).toBe(false); // no snapshot yet
    setLocal({ epoch: 0, ready: true });
    expect(lc.inputEnabled).toBe(false); // wrong epoch
    setLocal({ epoch: 1, ready: false });
    expect(lc.inputEnabled).toBe(false); // not ready
    setLocal({ epoch: 1, ready: true });
    expect(lc.inputEnabled).toBe(true);
    expect(lc.phase).toBe("active");
  });

  test("drop clears local state once; reconnect stays gated until the NEW welcome epoch appears in a snapshot", () => {
    const { f, lc, calls, setLocal } = setup();
    f.welcome(1); setLocal({ epoch: 1, ready: true });
    expect(lc.inputEnabled).toBe(true);
    f.drop();
    expect(lc.phase).toBe("reconnecting");
    expect(calls.filter((c) => c === "drop")).toHaveLength(1);
    expect(lc.inputEnabled).toBe(false); // old snapshot still carries epoch 1
    f.reconnect();
    expect(lc.phase).toBe("connecting");
    expect(lc.inputEnabled).toBe(false); // no welcome yet, even though the stale snapshot says epoch 1
    f.welcome(2);
    expect(lc.inputEnabled).toBe(false); // stale epoch-1 snapshot
    setLocal({ epoch: 2, ready: true });
    expect(lc.inputEnabled).toBe(true);
    expect(calls).toContain("welcome:2");
  });

  test("terminal close classes: 4401 session, 4500 arena, anything else lost; text is the specified copy", () => {
    expect(classifyClose(4401)).toBe("session");
    expect(classifyClose(4500)).toBe("arena");
    for (const c of [1000, 1006, 4000, 4010, 4999]) expect(classifyClose(c)).toBe("lost");
    expect(CLOSE_TEXT.session).toBe("Your session ended. Return to the welcome screen.");
    expect(CLOSE_TEXT.arena).toBe("This arena closed. Return to the welcome screen.");
    expect(CLOSE_TEXT.lost).toBe("Connection lost. Try joining again.");
    expect(phaseText("connecting")).toBe(JOINING_TEXT);
    expect(phaseText("reconnecting")).toBe(RECONNECTING_TEXT);
    expect(phaseText("active")).toBeNull();
    for (const [code, kind] of [[4401, "session"], [4500, "arena"], [1006, "lost"]] as const) {
      const { f, calls, lc } = setup();
      f.welcome(1); f.leave(code);
      expect(calls).toContain(`closed:${kind}:${code}`);
      expect(lc.phase).toBe("closed");
      expect(f.listeners()).toBe(0);
    }
  });

  test("an explicit Leave is silent and a close while reconnecting is terminal", () => {
    const a = setup();
    a.f.welcome(1); a.lc.explicitLeave(); a.f.leave(1000);
    expect(a.calls.some((c) => c.startsWith("closed:"))).toBe(false);
    const b = setup();
    b.f.welcome(1); b.f.drop(); b.f.leave(1006);
    expect(b.calls).toContain("closed:lost:1006");
  });

  test("dispose removes every subscription it made", () => {
    const { f, lc } = setup();
    expect(f.listeners()).toBe(4);
    lc.dispose();
    expect(f.listeners()).toBe(0);
    f.welcome(3); f.drop();
    expect(lc.phase).toBe("connecting"); // ignored after dispose
  });
});

describe("GR03 RoomClient resume storage", () => {
  const mkStorage = (): StorageLike & { m: Map<string, string> } => {
    const m = new Map<string, string>();
    return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => { m.delete(k); } };
  };
  const fakeSdkRoom = () => {
    const closed: [number, string?][] = [];
    const sig = () => { const s = signal<unknown[]>(); return s.fn; };
    return {
      closed,
      room: {
        reconnectionToken: "tok1", reconnection: { enabled: true, maxEnqueuedMessages: 10 },
        connection: { close: (c: number, r?: string) => { closed.push([c, r]); } },
        onMessage: () => () => undefined, onReconnect: sig(), onLeave: sig(),
        leave: async () => 1000,
      },
    };
  };
  test("metadata is strict: unknown mode or code shape reads as nothing to resume", () => {
    expect(parseResumeMeta('{"roomCode":"play","mode":"play","host":false}')).toEqual({ roomCode: "play", mode: "play", host: false });
    expect(parseResumeMeta('{"roomCode":"play","mode":"admin"}')).toBeNull();
    expect(parseResumeMeta('{"roomCode":"a b","mode":"play"}')).toBeNull();
    expect(parseResumeMeta("not json")).toBeNull();
    expect(parseResumeMeta(null)).toBeNull();
  });
  test("suspend keeps token and metadata and closes without consent; explicit leave clears both; no token means no resume", async () => {
    const storage = mkStorage();
    const rc = new RoomClient({ httpBase: "", wsEndpoint: "ws://x", storage });
    const f = fakeSdkRoom();
    (rc as unknown as { attach(r: unknown): void }).attach(f.room);
    expect(f.room.reconnection.maxEnqueuedMessages).toBe(0); // no browser offline buffering: nothing from before a drop is replayed
    rc.setResumeMeta({ roomCode: "play", mode: "play", host: false });
    expect(rc.resumeMeta()).toEqual({ roomCode: "play", mode: "play", host: false });
    rc.suspend();
    expect(f.room.reconnection.enabled).toBe(false);
    expect(f.closed).toEqual([[4010, "page suspended"]]);
    expect(storage.m.get("eb.reconnect")).toBe("tok1");
    expect(rc.resumeMeta()).not.toBeNull();
    const rc2 = new RoomClient({ httpBase: "", wsEndpoint: "ws://x", storage });
    (rc2 as unknown as { attach(r: unknown): void }).attach(fakeSdkRoom().room);
    rc2.setResumeMeta({ roomCode: "play", mode: "play", host: false });
    await rc2.leave();
    expect(storage.m.size).toBe(0);
    expect(rc2.resumeMeta()).toBeNull();
  });
});
