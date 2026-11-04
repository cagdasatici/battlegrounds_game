import { describe, expect, test, vi } from "vitest";
import { AppFlow, type FlowDeps } from "../../apps/client/src/app/AppFlow.js";
import { RoomClient, ClientError } from "../../apps/client/src/net/RoomClient.js";

const code = "sp-" + "a".repeat(32);
const token = "t".repeat(43);
const guestCsrf = "g".repeat(32);
function transport(responses: [number, unknown][]) {
  const calls: { path: string; init: RequestInit }[] = [];
  const rc = new RoomClient({
    httpBase: "", wsEndpoint: "ws://localhost",
    fetchFn: async (url, init) => {
      calls.push({ path: String(url), init: init! });
      const next = responses.shift();
      if (!next) throw Error("unexpected request");
      return new Response(next[0] === 204 ? null : JSON.stringify(next[1]), { status: next[0] });
    },
  });
  return { rc, calls };
}
function flowFixture(over: Partial<FlowDeps> = {}) {
  const log: string[] = [];
  const deps: FlowDeps = {
    supported: () => true, loadAssets: async () => {}, hasInvite: true,
    login: async () => { log.push("login"); },
    join: async (mode) => { log.push("join:" + mode); },
    sendReady: (kit) => { log.push("ready:" + kit); },
    leave: async () => { log.push("leave"); }, sleep: async () => {},
    sparring: { guest: false, recover: async () => false,
      create: async () => { log.push("create"); }, end: async () => { log.push("end"); } },
    ...over,
  };
  return { flow: new AppFlow(deps), log };
}

describe("BOT4C transport and journey", () => {
  test("host create, link and end use adult CSRF and exact wire records", async () => {
    const { rc, calls } = transport([[200, { csrfToken: "adult" }], [201, { roomCode: code }],
      [201, { token, expiresAt: 42 }], [204, null]]);
    expect(await rc.createSparring({ bots: ["medium"] })).toBe(code);
    expect(await rc.copySparringLink(code, "https://game.test")).toBe("https://game.test/#spar=" + token);
    await rc.endSparring(code);
    expect(calls.map(c => c.path)).toEqual(["/api/csrf", "/api/sparring", "/api/sparring/link", "/api/sparring/end"]);
    expect(JSON.parse(calls[1]!.init.body as string)).toEqual({ bots: ["medium"] });
    for (const c of calls.slice(1)) expect(c.init.headers).toMatchObject({ "x-csrf-token": "adult" });
  });
  test("redeem then ticket uses scoped CSRF; general endpoints still fetch adult CSRF", async () => {
    const { rc, calls } = transport([[201, { roomCode: code, csrfToken: guestCsrf }],
      [200, { ticket: "fixture", roomId: "fixture" }], [401, {}]]);
    expect(await rc.redeemSparring(token, "Nora")).toBe(code);
    await rc.requestTicket(code);
    expect(calls.map(c => c.path)).toEqual(["/api/sparring/redeem", "/api/join-ticket"]);
    expect(calls[1]!.init.headers).toMatchObject({ "x-csrf-token": guestCsrf });
    await expect(rc.createSparring({ bots: [] })).rejects.toMatchObject({ code: "INVITE_INVALID" });
    expect(calls[2]!.path).toBe("/api/csrf");
  });
  test("reload recovers guest cookie and uses matching CSRF only for its room", async () => {
    const { rc, calls } = transport([[200, { roomCode: code, csrfToken: guestCsrf }],
      [200, {}], [401, {}]]);
    expect(await rc.recoverSparringGuest()).toBe(code);
    await rc.requestTicket(code);
    await expect(rc.requestTicket("play")).rejects.toMatchObject({ code: "INVITE_INVALID" });
    expect(calls[2]!.path).toBe("/api/csrf");
    expect(calls.every(c => c.init.credentials === "include" && c.init.cache === "no-store")).toBe(true);
  });
  test.each([[401, "INVITE_INVALID", false], [403, "INVITE_INVALID", false],
    [409, "ROOM_FULL", true], [429, "SERVER_OFFLINE", true], [503, "SERVER_OFFLINE", true]] as const)(
    "route status %i is safe and actionable", async (status, error, retryable) => {
      const { rc } = transport([[status, {}]]);
      await expect(rc.redeemSparring(token, "Arel")).rejects.toMatchObject({ code: error, retryable });
    });
  test("invalid fragment credential sends no request", async () => {
    const { rc, calls } = transport([]);
    await expect(rc.redeemSparring("invalid", "Arel")).rejects.toBeInstanceOf(ClientError);
    expect(calls).toHaveLength(0);
  });
  test("host ordering, kit and leave; duplicate start suppressed", async () => {
    const { flow, log } = flowFixture();
    await flow.start();
    await Promise.all([flow.hostSparring({ bots: [] }, "td"), flow.hostSparring({ bots: ["hard"] }, "sv")]);
    expect(log).toEqual(["login", "create", "join:sparring", "ready:td"]);
    expect(flow.state.screen).toBe("match");
    await flow.back();
    expect(log.slice(-2)).toEqual(["end", "leave"]);
    expect(flow.state.screen).toBe("welcome");
  });
  test("host failure permits setup retry", async () => {
    let n = 0;
    const { flow } = flowFixture({ join: async () => { if (n++ === 0) throw new ClientError("ROOM_FULL", true); } });
    await flow.start();
    await expect(flow.hostSparring({ bots: [] }, "sv")).rejects.toBeInstanceOf(ClientError);
    await flow.hostSparring({ bots: [] }, "sv");
    expect(flow.state.screen).toBe("match");
  });
  test("fresh guest uses redemption/login, chosen Ready, leave; reload recovers before joining", async () => {
    const end = vi.fn(async () => {});
    const { flow, log } = flowFixture({ hasInvite: false, sparring: {
      guest: true, recover: async () => false, create: async () => {}, end,
    } });
    await flow.start(); await flow.play(); flow.ready("td"); await flow.back();
    expect(log).toEqual(["login", "join:sparring", "ready:td", "leave"]);
    expect(end).toHaveBeenCalledOnce();
    const recovered = flowFixture({ hasInvite: false, sparring: {
      guest: false, recover: async () => true, create: async () => {}, end,
    } });
    await recovered.flow.start(); await recovered.flow.play();
    expect(recovered.log).toEqual(["login", "join:sparring"]);
  });
  test("unsubscribe and ordinary practice regression", async () => {
    const { flow, log } = flowFixture();
    const seen = vi.fn(); const off = flow.subscribe(seen);
    await flow.start(); off(); await flow.practice(); flow.ready("sv"); await flow.back();
    expect(seen).toHaveBeenCalledTimes(2);
    expect(log).toEqual(["login", "join:practice", "ready:sv", "leave"]);
  });
});

test("Back during a pending join cleans up and never sends Ready", async () => {
  let release!: () => void;
  const { flow, log } = flowFixture({ join: async () => { await new Promise<void>(r => { release = r; }); } });
  await flow.start();
  const joining = flow.play();
  await vi.waitFor(() => expect(release).toBeDefined());
  await flow.back(); release(); await joining;
  expect(flow.state.screen).toBe("welcome");
  expect(log.filter(x => x.startsWith("ready"))).toEqual([]);
  expect(log.at(-1)).toBe("leave");
});
test("dispose suppresses late transitions and removes subscriptions", async () => {
  let release!: () => void;
  const { flow } = flowFixture({ join: async () => { await new Promise<void>(r => { release = r; }); } });
  await flow.start();
  const seen = vi.fn(); flow.subscribe(seen);
  const joining = flow.play();
  await vi.waitFor(() => expect(release).toBeDefined());
  const before = seen.mock.calls.length; // GR12: the busy phase is published while joining
  flow.dispose(); release(); await joining;
  expect(seen).toHaveBeenCalledTimes(before);
});
