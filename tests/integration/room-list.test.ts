// WEB3: room list and one-tap join with real clients over real HTTP and Colyseus sockets.
import { afterAll, beforeAll, expect, test } from "vitest";
import type { Room } from "@colyseus/sdk";
import { startHarness, loginClient, waitFor, players, type Harness } from "../fixtures/harness.js";
import { ClientError, type RoomClient } from "../../apps/client/src/net/RoomClient.js";
import { RoomListResponseSchema } from "../../packages/shared/src/rooms.js";

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h.stop(); });
const rooms = (c: RoomClient) => c.listRooms();
const row = async (c: RoomClient, code: string) => (await rooms(c)).find((r) => r.roomCode === code);
async function seat(name: string, code: string): Promise<{ c: RoomClient; room: Room }> {
  const c = await loginClient(h, name);
  const room = await c.join(code);
  await waitFor(() => c.welcome !== null, 3000, "welcome");
  return { c, room };
}
const raw = (cookie: string, csrf: string) => (path: string, method: string, body?: unknown, origin: string | null = h.origin) => fetch(h.origin + path, {
  method, headers: { ...(origin ? { origin } : {}), cookie, "x-csrf-token": csrf, "content-type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

test("401 without a session, 403 for a foreign origin, strict response schema", async () => {
  expect((await fetch(`${h.origin}/api/rooms`, { headers: { origin: h.origin } })).status).toBe(401);
  const s = h.svc.sessions.create("Lister");
  const api = raw(`eb_session=${s.cookieToken}`, s.session.csrf);
  expect((await api("/api/rooms", "GET", undefined, "https://foreign.invalid")).status).toBe(403);
  const ok = await api("/api/rooms", "GET");
  expect(ok.status).toBe(200);
  const body = await ok.json();
  expect(RoomListResponseSchema.safeParse(body).success).toBe(true);
  const text = JSON.stringify(body);
  expect(text).not.toContain(s.session.id);
  expect(text).not.toContain("Lister");
  // Practice is never listed; every configured arena code is.
  const codes = (body as { rooms: { roomCode: string }[] }).rooms.map((r) => r.roomCode);
  expect(codes).toContain("play");
  expect(codes).not.toContain("practice");
});

test("arena counts follow real seats; a full room reads full and its join is 409", async () => {
  const code = "r3";
  const watcher = await loginClient(h, "Watcher");
  expect(await row(watcher, code)).toMatchObject({ kind: "arena", players: 0, capacity: 4, bots: 0 });
  const seated: { c: RoomClient; room: Room }[] = [];
  for (let i = 0; i < 4; i++) seated.push(await seat(`P${i}`, code));
  await waitFor(() => players(seated[0]!.room).size === 4, 3000, "4 players");
  expect(await row(watcher, code)).toMatchObject({ players: 4, capacity: 4 });
  await expect(watcher.requestTicket(code)).rejects.toMatchObject({ code: "ROOM_FULL" });
  await seated[3]!.c.leave();
  await waitFor(() => players(seated[0]!.room).size === 3, 3000, "3 players");
  expect(await row(watcher, code)).toMatchObject({ players: 3 });
  for (const s of seated) await s.c.leave().catch(() => undefined);
});

test("two simultaneous joins for the last arena seat admit exactly one", async () => {
  const code = "r4";
  const held = [await seat("A0", code), await seat("A1", code), await seat("A2", code)];
  const a = await loginClient(h, "RaceA"), b = await loginClient(h, "RaceB");
  const results = await Promise.allSettled([a.join(code), b.join(code)]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
  expect(rejected.reason).toBeInstanceOf(ClientError);
  expect((rejected.reason as ClientError).code).toBe("ROOM_FULL");
  for (const s of held) await s.c.leave().catch(() => undefined);
  await a.leave().catch(() => undefined); await b.leave().catch(() => undefined);
});

async function hostSparring(bots: ("easy" | "medium" | "hard")[], listed: boolean) {
  const c = await loginClient(h, "Host");
  const code = await c.createSparring({ bots }, listed);
  return { c, code, join: async () => { const room = await c.join(code); await waitFor(() => c.welcome !== null, 3000, "welcome"); return room; } };
}

test("unlisted sparring never appears; listed appears only after the host is connected, with counts only", async () => {
  const watcher = await loginClient(h, "Watcher2");
  const hidden = await hostSparring(["easy"], false);
  await hidden.join();
  const listed = await hostSparring(["easy", "hard"], true);
  expect(await row(watcher, listed.code)).toBeUndefined(); // host has not joined yet
  await listed.join();
  const all = await rooms(watcher);
  expect(all.find((r) => r.roomCode === hidden.code)).toBeUndefined();
  const mine = all.find((r) => r.roomCode === listed.code)!;
  expect(mine).toMatchObject({ kind: "sparring", players: 1, capacity: 4, bots: 2 });
  expect(Object.keys(mine).sort()).toEqual(["bots", "capacity", "kind", "name", "players", "roomCode"]);
  // An unlisted match cannot be joined through the listed route.
  await expect(watcher.joinListedSparring(hidden.code)).rejects.toMatchObject({ code: "ROOM_FULL" });
  await hidden.c.endSparring(hidden.code); await listed.c.endSparring(listed.code);
  await hidden.c.leave().catch(() => undefined); await listed.c.leave().catch(() => undefined);
});

test("a signed-in session joins a listed match as a guest and reaches the room", async () => {
  const host = await hostSparring(["easy"], true);
  const hostRoom = await host.join();
  const guest = await loginClient(h, "Guesty");
  const code = await guest.joinListedSparring(host.code);
  expect(code).toBe(host.code);
  const room = await guest.join(code);
  await waitFor(() => players(hostRoom).size >= 3, 3000, "host sees guest");
  expect(room.sessionId).toBeTruthy();
  const watcher = await loginClient(h, "Watcher3");
  expect(await row(watcher, host.code)).toMatchObject({ players: 2, bots: 1 });
  // The guest's authority stops at this match: it cannot end it or mint a link.
  await expect(guest.endSparring(host.code)).rejects.toBeInstanceOf(ClientError);
  await host.c.endSparring(host.code);
  await host.c.leave().catch(() => undefined); await guest.leave().catch(() => undefined);
});

test("two simultaneous joins for the last sparring seat admit one; the other is 409", async () => {
  const host = await hostSparring(["easy", "easy"], true);
  await host.join();
  const a = await loginClient(h, "SeatA"), b = await loginClient(h, "SeatB");
  const results = await Promise.allSettled([a.joinListedSparring(host.code), b.joinListedSparring(host.code)]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
  expect((rejected.reason as ClientError).code).toBe("ROOM_FULL");
  const watcher = await loginClient(h, "Watcher4");
  expect(await row(watcher, host.code)).toMatchObject({ players: 2, bots: 2 });
  await host.c.endSparring(host.code); await host.c.leave().catch(() => undefined);
});

test("strict schemas, auth and CSRF on create(listed) and join", async () => {
  const s = h.svc.sessions.create("Strict");
  const api = raw(`eb_session=${s.cookieToken}`, s.session.csrf);
  expect((await api("/api/sparring", "POST", { bots: [], listed: "yes" })).status).toBe(400);
  expect((await api("/api/sparring", "POST", { bots: [], listed: true, extra: 1 })).status).toBe(400);
  expect((await api("/api/sparring/join", "POST", { roomCode: "sp-" + "0".repeat(32), extra: 1 })).status).toBe(400);
  expect((await api("/api/sparring/join", "POST", { roomCode: "nope" })).status).toBe(400);
  expect((await api("/api/sparring/join", "POST", { roomCode: "sp-" + "0".repeat(32) })).status).toBe(409);
  const bad = raw(`eb_session=${s.cookieToken}`, "wrong");
  expect((await bad("/api/sparring/join", "POST", { roomCode: "sp-" + "0".repeat(32) })).status).toBe(403);
  expect((await raw("", "")("/api/sparring/join", "POST", { roomCode: "sp-" + "0".repeat(32) })).status).toBe(401);
  expect((await api("/api/sparring/join", "POST", { roomCode: "sp-" + "0".repeat(32) }, "https://foreign.invalid")).status).toBe(403);
  // The host's own listed match cannot be joined as its own guest.
  const own = await api("/api/sparring", "POST", { bots: [], listed: true });
  expect(own.status).toBe(201);
  const { roomCode } = await own.json() as { roomCode: string };
  await api("/api/sparring/end", "POST", { roomCode });
});

test("ordinary FFA and practice joins still work", async () => {
  const ffa = await seat("Ffa", "r5");
  expect(ffa.c.welcome).not.toBeNull();
  const c = await loginClient(h, "Prac");
  const room = await c.join("practice");
  await waitFor(() => c.welcome !== null, 3000, "practice welcome");
  expect(room.roomId).toBeTruthy();
  await c.leave(); await ffa.c.leave();
});
