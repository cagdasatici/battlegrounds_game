import { describe, expect, it } from "vitest";
import { UPDATE_CHECK_MS, UpdateWatcher, type UpdateDeps } from "../../apps/client/src/app/UpdateWatcher.js";

function make(over: Partial<UpdateDeps> = {}) {
  const st = { manifest: { assets: ["/assets/a.js"] } as { assets: string[] } | null, waiting: false, match: false, lobby: true, reloads: 0, activated: 0, fetches: 0 };
  const timers = new Map<number, () => void>();
  let nextId = 1;
  const visible = new Set<() => void>();
  const deps: UpdateDeps = {
    loadedAssets: () => ["/assets/a.js"],
    fetchManifest: async () => { st.fetches++; return st.manifest; },
    fetchBuildId: async () => "b1",
    hasWaitingWorker: () => st.waiting,
    activate: async () => { st.activated++; },
    reload: () => { st.reloads++; },
    inMatch: () => st.match,
    onLobbyScreen: () => st.lobby,
    setInterval: (fn) => { const id = nextId++; timers.set(id, fn); return id; },
    clearInterval: (id) => { timers.delete(id); },
    onVisible: (fn) => { visible.add(fn); return () => visible.delete(fn); },
    ...over,
  };
  return { st, timers, visible, w: new UpdateWatcher(deps) };
}

describe("UpdateWatcher", () => {
  it("same build: no button, buildId recorded for display", async () => {
    const { w } = make();
    await w.check();
    expect(w.state).toEqual({ available: false, visible: false, buildId: "b1" });
  });
  it("new bundle shows the button, and apply activates then reloads", async () => {
    const { w, st } = make();
    st.manifest = { assets: ["/assets/b.js"] };
    await w.check();
    expect(w.state.visible).toBe(true);
    await w.apply();
    expect(st.activated).toBe(1);
    expect(st.reloads).toBe(1);
  });
  it("a changed buildId alone does not offer an update", async () => {
    const { w } = make({ fetchBuildId: async () => "other" });
    await w.check();
    expect(w.state.available).toBe(false);
  });
  it("waiting worker offers the button", async () => {
    const { w, st } = make();
    st.waiting = true;
    expect(w.state.visible).toBe(true);
  });
  it("hidden in a match, never reloads there, back after leaving", async () => {
    const { w, st } = make();
    st.waiting = true;
    st.match = true;
    expect(w.state).toMatchObject({ available: true, visible: false });
    await w.apply();
    expect(st.reloads).toBe(0);
    st.match = false;
    expect(w.state.visible).toBe(true);
  });
  it("offline keeps the earlier answer and does not throw", async () => {
    const { w, st } = make();
    st.manifest = { assets: ["/assets/b.js"] };
    await w.check();
    st.manifest = null;
    await w.check();
    expect(w.state.visible).toBe(true);
    const off = make({ fetchManifest: async () => { throw new Error("x"); } });
    await expect(off.w.check()).resolves.toBeUndefined();
    expect(off.w.state.available).toBe(false);
  });
  it("overlapping checks share one request", async () => {
    const { w, st } = make();
    await Promise.all([w.check(), w.check(), w.check()]);
    expect(st.fetches).toBe(1);
  });
  it("start is idempotent: one timer, one listener; timer only checks on the lobby screen; dispose cleans up", async () => {
    const { w, st, timers, visible } = make();
    w.start(); w.start();
    await w.check();
    expect(timers.size).toBe(1);
    expect(visible.size).toBe(1);
    const before = st.fetches;
    st.lobby = false;
    for (const f of timers.values()) f();
    for (const f of visible) f();
    expect(st.fetches).toBe(before);
    st.lobby = true;
    for (const f of timers.values()) f();
    await w.check();
    expect(st.fetches).toBeGreaterThan(before);
    w.dispose();
    expect(timers.size).toBe(0);
    expect(visible.size).toBe(0);
    await w.apply();
    expect(st.reloads).toBe(0);
  });
  it("interval is ten minutes", () => { expect(UPDATE_CHECK_MS).toBe(600_000); });
});
