import { describe, expect, test } from "vitest";
import { AppFlow, retryDelayMs, type FlowDeps, type FlowError } from "../../apps/client/src/app/AppFlow.js";
import { ClientError } from "../../apps/client/src/net/RoomClient.js";

const mk = (over: Partial<FlowDeps> = {}) => {
  const log: string[] = [];
  const sleeps: number[] = [];
  const deps: FlowDeps = {
    supported: () => true,
    loadAssets: async () => { log.push("assets"); },
    login: async () => { log.push("login"); },
    join: async () => { log.push("join"); },
    sendReady: (k) => { log.push(`ready:${k}`); },
    leave: async () => { log.push("leave"); },
    sleep: async (ms) => { sleeps.push(ms); },
    hasInvite: true,
    ...over,
  };
  const flow = new AppFlow(deps);
  const seen: string[] = [];
  const off = flow.subscribe((s) => seen.push(s.screen + (s.error ? `:${s.error}` : "")));
  return { flow, log, sleeps, seen, off };
};

describe("AppFlow journey (spec section 6)", () => {
  test("happy path: boot, welcome, lobby, ready, match", async () => {
    const { flow, log } = mk();
    await flow.start();
    expect(flow.state.screen).toBe("welcome");
    await flow.play();
    expect(flow.state.screen).toBe("lobby");
    flow.ready("td");
    expect(flow.state.screen).toBe("match");
    expect(log).toEqual(["assets", "login", "join", "ready:td"]);
  });
  test("unsupported device: readable error with Retry, no join request", async () => {
    const { flow, log } = mk({ supported: () => false });
    await flow.start();
    expect(flow.state).toMatchObject({ screen: "error", error: "UNSUPPORTED", canRetry: true });
    expect(log).toEqual([]);
  });
  test("each failure maps to its error state; only retryable ones offer Retry", async () => {
    const cases: [() => Promise<void>, FlowError, boolean][] = [
      [async () => { throw new ClientError("ROOM_FULL", true); }, "ROOM_FULL", true],
      [async () => { throw new ClientError("INVITE_INVALID", false); }, "INVITE_INVALID", false],
      [async () => { throw new ClientError("VERSION_MISMATCH", false); }, "VERSION_MISMATCH", false],
      [async () => { throw new ClientError("SERVER_OFFLINE", true); }, "SERVER_OFFLINE", true],
      [async () => { throw new TypeError("fetch failed"); }, "SERVER_OFFLINE", true],
    ];
    for (const [join, code, retry] of cases) {
      const { flow } = mk({ join });
      await flow.start();
      await flow.play();
      expect(flow.state).toMatchObject({ screen: "error", error: code, canRetry: retry });
    }
  });
  test("asset failure at boot is ASSET_FAILED with Retry", async () => {
    let n = 0;
    const { flow } = mk({ loadAssets: async () => { if (n++ === 0) throw new Error("404"); } });
    await flow.start();
    expect(flow.state).toMatchObject({ screen: "error", error: "ASSET_FAILED", canRetry: true });
    await flow.retry();
    expect(flow.state.screen).toBe("welcome");
  });
  test("no invitation: Play shows INVITE_INVALID with Back only, no request sent", async () => {
    const { flow, log } = mk({ hasInvite: false });
    await flow.start();
    await flow.play();
    expect(flow.state).toMatchObject({ screen: "error", error: "INVITE_INVALID", canRetry: false });
    expect(log).toEqual(["assets"]);
    await flow.back();
    expect(flow.state.screen).toBe("welcome");
  });
  test("retry uses bounded exponential delay and re-runs only the failed step; login is never repeated", async () => {
    let joins = 0;
    const { flow, log, sleeps } = mk({ join: async () => { if (joins++ < 3) throw new ClientError("ROOM_FULL", true); } });
    await flow.start();
    await flow.play();
    await flow.retry();
    expect(flow.state.error).toBe("ROOM_FULL");
    await flow.retry();
    expect(flow.state.error).toBe("ROOM_FULL");
    await flow.retry();
    expect(flow.state.screen).toBe("lobby");
    expect(sleeps).toEqual([500, 1000, 2000]);
    expect(log.filter((l) => l === "login")).toHaveLength(1);
    expect([0, 1, 2, 3, 4, 5, 6, 10].map(retryDelayMs)).toEqual([500, 1000, 2000, 4000, 8000, 8000, 8000, 8000]);
  });
  test("Back from the lobby leaves the room and returns to Welcome; unsubscribe stops notifications", async () => {
    const { flow, log, seen, off } = mk();
    await flow.start();
    await flow.play();
    await flow.back();
    expect(flow.state.screen).toBe("welcome");
    expect(log.at(-1)).toBe("leave");
    off();
    const n = seen.length;
    await flow.play();
    expect(seen.length).toBe(n);
  });

  test("Practice: same session exchange, joins in practice mode, lobby then match; Back resets to play mode", async () => {
    const modes: string[] = [];
    const { flow, log } = mk({ join: async (m) => { modes.push(m); } });
    await flow.start();
    await flow.practice();
    expect(flow.mode).toBe("practice");
    expect(flow.state.screen).toBe("lobby");
    flow.ready("sv");
    expect(flow.state.screen).toBe("match");
    await flow.back();
    expect(flow.mode).toBe("play");
    await flow.play();
    expect(modes).toEqual(["practice", "play"]);
    expect(log.filter((l) => l === "login")).toHaveLength(1);
  });
  test("Practice without an invitation shows INVITE_INVALID and makes no request; Retry keeps practice mode", async () => {
    const a = mk({ hasInvite: false });
    await a.flow.start();
    await a.flow.practice();
    expect(a.flow.state).toMatchObject({ screen: "error", error: "INVITE_INVALID", canRetry: false });
    expect(a.log).toEqual(["assets"]);
    const modes: string[] = [];
    let n = 0;
    const b = mk({ join: async (m) => { modes.push(m); if (n++ === 0) throw new ClientError("ROOM_FULL", true); } });
    await b.flow.start();
    await b.flow.practice();
    expect(b.flow.state.error).toBe("ROOM_FULL");
    await b.flow.retry();
    expect(b.flow.state.screen).toBe("lobby");
    expect(modes).toEqual(["practice", "practice"]);
  });
});
