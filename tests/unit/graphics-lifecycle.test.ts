import { describe, expect, test } from "vitest";
import { GraphicsLifecycle, type GraphicsState } from "../../apps/client/src/app/GraphicsLifecycle.js";

function setup(opts: { tick?: () => number | null } = {}) {
  const canvas = new EventTarget();
  const calls: string[] = [];
  const states: GraphicsState[] = [];
  let tick: number | null = 100;
  const timers: { fn: () => void; ms: number; live: boolean }[] = [];
  const lc = new GraphicsLifecycle({
    canvas,
    scene: { pauseRendering: () => calls.push("pause"), resumeRendering: () => calls.push("resume"), discardTransient: () => calls.push("discard") },
    ownerTick: opts.tick ?? (() => tick),
    onState: (s) => states.push(s),
    setTimer: (fn, ms) => { const t = { fn, ms, live: true }; timers.push(t); return t; },
    clearTimer: (h) => { (h as { live: boolean }).live = false; },
  });
  lc.setMatch({ close: () => calls.push("gate-close"), open: () => calls.push("gate-open") });
  const lose = (): Event => { const e = new Event("webglcontextlost", { cancelable: true }); canvas.dispatchEvent(e); return e; };
  const restore = (): void => { canvas.dispatchEvent(new Event("webglcontextrestored")); };
  return { lc, calls, states, timers, lose, restore, setTick: (t: number) => { tick = t; }, canvas };
}

describe("GraphicsLifecycle", () => {
  test("loss prevents default, closes the gate, stops rendering and arms the 5 s UI timeout", () => {
    const s = setup();
    const e = s.lose();
    expect(e.defaultPrevented).toBe(true);
    expect(s.calls).toEqual(["pause", "gate-close"]);
    expect(s.lc.state).toBe("lost");
    expect(s.timers[0]!.ms).toBe(5000);
  });

  test("restore discards transients but waits for a frame and a newer snapshot before reopening input", () => {
    const s = setup();
    s.lose(); s.restore();
    expect(s.lc.state).toBe("restoring");
    expect(s.calls).toEqual(["pause", "gate-close", "discard", "resume"]);
    s.lc.frameRendered(); // same snapshot tick: still waiting
    expect(s.lc.state).toBe("restoring");
    s.setTick(101); s.lc.frameRendered();
    expect(s.lc.state).toBe("ok");
    expect(s.calls.at(-1)).toBe("gate-open");
    expect(s.timers[0]!.live).toBe(false);
  });

  test("no recovery within the timeout shows failed; a late restore still recovers", () => {
    const s = setup();
    s.lose(); s.timers[0]!.fn();
    expect(s.lc.state).toBe("failed");
    s.restore(); s.setTick(105); s.lc.frameRendered();
    expect(s.lc.state).toBe("ok");
  });

  test("restore without a prior loss is ignored; repeated loss does not stack timers' effect", () => {
    const s = setup();
    s.restore();
    expect(s.states).toEqual([]);
    s.lose(); s.lose();
    expect(s.states).toEqual(["lost"]);
  });

  test("a match entered while lost starts with a closed gate; dispose removes listeners", () => {
    const s = setup();
    s.lose();
    const calls: string[] = [];
    s.lc.setMatch({ close: () => calls.push("close"), open: () => calls.push("open") });
    expect(calls).toEqual(["close"]);
    s.lc.dispose();
    s.lose();
    expect(s.states).toEqual(["lost"]);
    expect(s.timers[0]!.live).toBe(false);
  });
});
