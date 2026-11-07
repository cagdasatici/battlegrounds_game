import { describe, expect, test } from "vitest";
import { AppFlow, type FlowDeps } from "../../apps/client/src/app/AppFlow.js";
import { ClientError, RoomClient } from "../../apps/client/src/net/RoomClient.js";
import { roomLabel } from "../../apps/client/src/ui/RoomList.js";
import { SparringDirectory, SparringError } from "../../apps/server/src/auth/SparringDirectory.js";
import { RoomListResponseSchema, RoomSummarySchema, roomIsFull, type RoomSummary } from "../../packages/shared/src/rooms.js";
import { SparringCreateRequestSchema } from "../../packages/shared/src/sparring.js";

function dir(bots: ("easy" | "medium" | "hard")[], listed: boolean) {
  let time = 1000;
  const live = new Set(["host", "g1", "g2", "g3"]);
  const d = new SparringDirectory((id) => live.has(id), () => time);
  const host = { kind: "host", id: "host" } as const;
  const { roomCode } = d.create(host, { bots }, listed);
  return { d, host, roomCode, at: (t: number) => { time = t; } };
}
const code = (e: () => unknown): number => { try { e(); } catch (x) { return (x as SparringError).status; } return 0; };

describe("WEB3 directory listing and guest admission", () => {
  test("only listed matches with a connected host appear, as counts", () => {
    const a = dir(["easy"], true), b = dir(["easy"], false);
    expect(a.d.listed()).toEqual([]);
    a.d.connected(a.host, a.roomCode, "c1");
    expect(a.d.listed()).toEqual([{ roomCode: a.roomCode, humans: 1, bots: 1, teamPlay: false }]);
    b.d.connected(b.host, b.roomCode, "c1");
    expect(b.d.listed()).toEqual([]);
  });
  test("joinListed reserves a seat for 60 s, enforces capacity, and refuses unlisted, closed or own matches", () => {
    const f = dir(["easy", "easy"], true);
    f.d.connected(f.host, f.roomCode, "c1");
    expect(code(() => f.d.joinListed("host", f.roomCode, "Me"))).toBe(409);
    const g = f.d.joinListed("g1", f.roomCode, "G1");
    expect(g.principal.kind).toBe("guest");
    expect(f.d.listed()[0]).toMatchObject({ humans: 2 });
    expect(code(() => f.d.joinListed("g2", f.roomCode, "G2"))).toBe(409);
    f.at(1000 + 60_001); // unconnected reservation expires and frees the seat
    expect(f.d.listed()[0]).toMatchObject({ humans: 1 });
    expect(() => f.d.joinListed("g2", f.roomCode, "G2")).not.toThrow();
    expect(code(() => f.d.joinListed("gone", f.roomCode, "X"))).toBe(401);
    const u = dir([], false); u.d.connected(u.host, u.roomCode, "c1");
    expect(code(() => u.d.joinListed("g1", u.roomCode, "G"))).toBe(409);
    expect(code(() => f.d.joinListed("g1", "sp-" + "0".repeat(32), "G"))).toBe(409);
  });
  test("create request schema: optional boolean listed, strict", () => {
    expect(SparringCreateRequestSchema.safeParse({ bots: [] }).success).toBe(true);
    expect(SparringCreateRequestSchema.safeParse({ bots: [], listed: true }).success).toBe(true);
    expect(SparringCreateRequestSchema.safeParse({ bots: [], listed: 1 }).success).toBe(false);
    expect(SparringCreateRequestSchema.safeParse({ bots: [], other: 1 }).success).toBe(false);
  });
});

const arena: RoomSummary = { roomCode: "play", name: "Play", kind: "arena", players: 2, capacity: 4, bots: 0 };
describe("WEB3 shared schema and labels", () => {
  test("strict rows; full means humans plus bots reach capacity", () => {
    expect(RoomSummarySchema.safeParse({ ...arena, roomId: "x" }).success).toBe(false);
    expect(RoomListResponseSchema.safeParse({ rooms: [arena] }).success).toBe(true);
    expect(roomIsFull(arena)).toBe(false);
    expect(roomIsFull({ ...arena, players: 2, bots: 2 })).toBe(true);
    expect(roomLabel({ ...arena, bots: 1 })).toBe("Play: 2 of 4 players, 1 bot");
  });
});

describe("WEB3 client transport", () => {
  test("listRooms parses strictly and maps 401 and 429", async () => {
    const responses: [number, unknown][] = [[200, { rooms: [arena] }], [401, {}], [429, {}], [200, { rooms: [{ ...arena, extra: 1 }] }]];
    const rc = new RoomClient({ httpBase: "", wsEndpoint: "ws://x", fetchFn: async () => { const [s, b] = responses.shift()!; return new Response(JSON.stringify(b), { status: s }); } });
    expect(await rc.listRooms()).toEqual([arena]);
    await expect(rc.listRooms()).rejects.toMatchObject({ code: "INVITE_INVALID" });
    await expect(rc.listRooms()).rejects.toMatchObject({ code: "SERVER_OFFLINE" });
    await expect(rc.listRooms()).rejects.toBeTruthy();
  });
});

function flow(over: Partial<FlowDeps["sparring"]> = {}, join?: FlowDeps["join"]) {
  const log: string[] = [];
  const deps: FlowDeps = {
    supported: () => true, loadAssets: async () => {}, hasInvite: true,
    login: async () => { log.push("login"); },
    join: join ?? (async (m, c) => { log.push(`join:${m}:${c ?? ""}`); }),
    sendReady: () => {}, leave: async () => { log.push("leave"); }, sleep: async () => {},
    sparring: { guest: false, recover: async () => false, create: async () => {}, end: async () => { log.push("end"); },
      joinListed: async (c) => { log.push(`seat:${c}`); }, ...over },
  };
  return { f: new AppFlow(deps), log };
}

describe("WEB3 AppFlow one-tap join", () => {
  test("arena row joins that room code through the normal login and join", async () => {
    const { f, log } = flow();
    await f.start(); await f.joinListed({ ...arena, roomCode: "other" });
    expect(f.state.screen).toBe("lobby");
    expect(log).toEqual(["login", "join:play:other"]);
  });
  test("sparring row reserves the seat, then joins as sparring", async () => {
    const { f, log } = flow();
    await f.start(); await f.joinListed({ ...arena, kind: "sparring", roomCode: "sp-" + "a".repeat(32) });
    expect(f.state.screen).toBe("lobby");
    expect(log).toEqual(["login", "seat:sp-" + "a".repeat(32), "join:sparring:"]);
  });
  test("a full match shows ROOM_FULL without retry and returns to play mode", async () => {
    const { f } = flow({ joinListed: async () => { throw new ClientError("ROOM_FULL", true); } });
    await f.start(); await f.joinListed({ ...arena, kind: "sparring", roomCode: "sp-" + "a".repeat(32) });
    expect(f.state).toMatchObject({ screen: "error", error: "ROOM_FULL", canRetry: false });
    await f.back();
    expect(f.state.screen).toBe("welcome");
    expect(f.mode).toBe("play");
  });
  test("ignored outside Welcome and while a join is in flight (double tap)", async () => {
    let release!: () => void;
    const { f, log } = flow({}, () => new Promise<void>((r) => { release = r; }));
    await f.start();
    const first = f.joinListed(arena);
    await f.joinListed(arena);
    await new Promise((r) => setTimeout(r, 0)); // assets and login settle before the join is pending
    release(); await first;
    expect(log).toEqual(["login"]);
    await f.joinListed(arena); // now in the lobby: ignored
    expect(f.state.screen).toBe("lobby");
  });
});
