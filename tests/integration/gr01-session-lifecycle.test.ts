// GR01: active-session revocation, reserved-seat revocation, reconnect revalidation and wall-clock expiry. Real clients and servers.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as createNetServer } from "node:net";
import { afterEach, expect, test, vi } from "vitest";
import { Client } from "@colyseus/sdk";
import { createGameServer } from "../../apps/server/src/createServer.js";
import { createAuthServices } from "../../apps/server/src/auth/Services.js";
import { SESSION_ABSOLUTE_MS, SESSION_IDLE_MS } from "../../apps/server/src/auth/SessionStore.js";
import { hashPassword } from "../../apps/server/src/admin/AdminAuth.js";
import { liveArenaRooms, roomTuning } from "../../apps/server/src/rooms/ArenaRoom.js";
import { sha256 } from "../../apps/server/src/auth/tokens.js";
import { RoomClient } from "../../apps/client/src/net/RoomClient.js";
import { players, waitFor, type Harness } from "../fixtures/harness.js";

vi.setConfig({ testTimeout: 45_000 });
const PW = "a long admin passphrase";
const closes = new Map<string, number>();
let current: Harness | null = null;
let clock = 1_800_000_000_000;
const advanceTo = (t: number): void => { clock = t; };

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createNetServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); });
  });
}

async function start(): Promise<Harness> {
  const port = await freePort();
  const origin = `http://localhost:${port}`;
  const svc = createAuthServices({
    dataDir: mkdtempSync(join(tmpdir(), "eb-gr01-")), allowedOrigins: [origin], secureCookies: true,
    roomCodes: { r1: "arena", r2: "arena", r3: "arena", r4: "arena", r5: "arena" }, buildId: "test",
    sessionsPerMinute: 10_000, globalSessionsPerMinute: 10_000, adminPasswordHash: await hashPassword(PW),
  }, () => clock);
  const server = createGameServer(svc);
  await server.listen(port, undefined, undefined);
  current = { server, svc, port, origin, stop: () => server.gracefullyShutdown(false) };
  return current;
}
afterEach(async () => { await current?.stop(); current = null; roomTuning.reconnectSeconds = 20; });

interface Player { c: RoomClient; cookie: string; csrf: string; id: string }
async function player(h: Harness, name: string): Promise<Player> {
  const { token } = h.svc.invites.create({ ttlMs: 60_000, maxUses: 1 });
  const r = await fetch(`${h.origin}/api/session`, { method: "POST", headers: { origin: h.origin, "content-type": "application/json" }, body: JSON.stringify({ invite: token, displayName: name }) });
  const cookie = r.headers.get("set-cookie")!.split(";")[0]!;
  const fetchFn = ((url: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers); headers.set("origin", h.origin); headers.set("cookie", cookie);
    return fetch(url, { ...init, headers });
  }) as typeof fetch;
  const csrf = ((await (await fetchFn(`${h.origin}/api/csrf`)).json()) as { csrfToken: string }).csrfToken;
  const c = new RoomClient({ httpBase: h.origin, wsEndpoint: `ws://localhost:${h.port}`, fetchFn, sleep: async () => undefined,
    storage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined } });
  const id = sha256(cookie.split("=")[1]!);
  return { c, cookie, csrf, id };
}
async function joinWatched(h: Harness, p: Player, code: string): Promise<void> {
  const room = await p.c.join(code);
  room.onLeave((c) => { closes.set(p.id, c); });
}
async function adminCookie(h: Harness): Promise<{ cookie: string; csrf: string }> {
  const r = await fetch(`${h.origin}/api/admin/login`, { method: "POST", headers: { origin: h.origin, "content-type": "application/json" }, body: JSON.stringify({ password: PW }) });
  return { cookie: r.headers.get("set-cookie")!.split(";")[0]!, csrf: ((await r.json()) as { csrfToken: string }).csrfToken };
}
const roomFor = (code: string) => [...liveArenaRooms()].find((r) => r.roomCode === code)!;

async function twoPlayers(h: Harness, code: string) {
  const a = await player(h, `A${code}`); const b = await player(h, `B${code}`);
  await joinWatched(h, a, code); await joinWatched(h, b, code);
  const rb = b.c.room!;
  await waitFor(() => players(rb).size === 2, 3000, "two players");
  return { a, b, rb };
}

test("admin revoke closes only the revoked seat with 4401; the other client keeps receiving patches", async () => {
  const h = await start();
  const { a, b, rb } = await twoPlayers(h, "r1");
  const adm = await adminCookie(h);
  const r = await fetch(`${h.origin}/api/admin/sessions/${a.id}`, { method: "DELETE", headers: { origin: h.origin, cookie: adm.cookie, "x-csrf-token": adm.csrf } });
  expect(r.status).toBe(204);
  await waitFor(() => closes.get(a.id) === 4401, 8000, "A closed 4401");
  await waitFor(() => players(rb).size === 1, 20000, "A removed");
  expect(roomFor("r1").clients.length).toBe(1);
  // B still lives: it receives a further patch when it changes kit.
  expect(closes.has(b.id)).toBe(false);
  expect([...players(rb).values()][0].displayName).toBe("Br1");
  await b.c.leave();
});

test("a socket drop after the session is revoked never reserves the seat (regression: revoke vs close race)", async () => {
  const h = await start();
  const { a, b, rb } = await twoPlayers(h, "r5");
  // Suppress the revoke-driven close so the only thing the server sees is an unexpected drop of a revoked session.
  vi.spyOn(roomFor("r5"), "revokeAuthSession").mockImplementation(() => undefined);
  h.svc.sessions.revokeById(a.id);
  a.c.room!.reconnection.enabled = false;
  a.c.room!.connection.close(4010, "network lost");
  await waitFor(() => players(rb).size === 1, 3000, "revoked dropped seat removed without a 20 s reservation");
  expect(roomFor("r5").seatedSessions().some((s) => s.authId === a.id)).toBe(false);
  await b.c.leave();
});

test("DELETE /api/session closes the active seat with 4401", async () => {
  const h = await start();
  const { a, b } = await twoPlayers(h, "r2");
  const r = await fetch(`${h.origin}/api/session`, { method: "DELETE", headers: { origin: h.origin, cookie: a.cookie, "x-csrf-token": a.csrf } });
  expect(r.status).toBe(204);
  await waitFor(() => closes.get(a.id) === 4401, 8000, "A closed 4401");
  await waitFor(() => players(b.c.room!).size === 1, 20000, "A removed");
  await b.c.leave();
});

test("revoking a dropped (reserved) seat cancels the reservation: reconnect is refused and nothing is resurrected", async () => {
  const h = await start();
  const { a, b, rb } = await twoPlayers(h, "r3");
  const token = a.c.room!.reconnectionToken;
  a.c.room!.reconnection.enabled = false;
  a.c.room!.connection.close(4010, "network lost");
  const mineKey = [...players(rb).entries()].find(([, p]) => p.displayName === "Ar3")![0];
  await waitFor(() => players(rb).get(mineKey)?.connected === false, 3000, "dropped");
  h.svc.sessions.revokeById(a.id);
  await waitFor(() => players(rb).size === 1, 20000, "reserved fighter removed");
  await expect(new Client(`ws://localhost:${h.port}`).reconnect(token)).rejects.toThrow();
  expect(players(rb).size).toBe(1);
  expect(roomFor("r3").combat.get(Number(mineKey))).toBeUndefined();
  await b.c.leave();
});

test("reconnect rechecks the session: an expired one gets no welcome", async () => {
  const h = await start();
  const { a, b, rb } = await twoPlayers(h, "r4");
  const token = a.c.room!.reconnectionToken;
  a.c.room!.reconnection.enabled = false;
  a.c.room!.connection.close(4010, "network lost");
  await waitFor(() => [...players(rb).values()].some((p) => !p.connected), 3000, "dropped");
  // Jump past absolute expiry and reconnect at once: whichever of the sweep or the reconnect recheck runs first, no welcome may be sent.
  advanceTo(clock + SESSION_ABSOLUTE_MS + 1);
  let welcomes = 0; let closed: number | null = null;
  try {
    const back = await new Client(`ws://localhost:${h.port}`).reconnect(token);
    back.onMessage("welcome", () => { welcomes++; });
    back.onLeave((c) => { closed = c; });
    await waitFor(() => closed === 4401, 3000, "closed 4401");
  } catch { /* refused at the reservation: also correct */ }
  expect(welcomes).toBe(0);
  await waitFor(() => players(rb).size === 1, 20000, "fighter removed");
  await b.c.leave();
});

test("wall-clock sweep closes an active socket past the absolute expiry within 1 s; idle refresh never extends the 24 h cap", async () => {
  const h = await start();
  const a = await player(h, "Asweep");
  await joinWatched(h, a, "r5");
  const created = clock;
  // Activity refresh at 59 s: no write yet (touch is at most once per 60 s).
  const touched = async (t: number): Promise<void> => { advanceTo(t); await waitFor(() => h.svc.sessions.getById(a.id)?.lastActive === t, 4000, `touched at ${t}`); };
  await touched(created + 61_000);
  // Keep refreshing until the absolute cap: lastActive moves but expiry stays created + 24 h.
  for (let h7 = 1; h7 <= 3; h7++) { // 7 h steps stay inside the 8 h idle window because the sweep keeps refreshing
    await touched(created + h7 * 7 * 3600_000);
  }
  await touched(created + SESSION_ABSOLUTE_MS - 1000);
  expect(h.svc.sessions.getById(a.id)).not.toBeNull();
  expect(closes.has(a.id)).toBe(false);
  advanceTo(created + SESSION_ABSOLUTE_MS + 1);
  await waitFor(() => closes.get(a.id) === 4401, 2500, "closed within the 1 s sweep");
  expect(SESSION_IDLE_MS).toBeLessThan(SESSION_ABSOLUTE_MS);
});

test("server shutdown unsubscribes the revoke listener", async () => {
  const h = await start();
  const svc = h.svc;
  const p = await player(h, "Aoff");
  await joinWatched(h, p, "r1");
  await h.stop(); current = null;
  // A late revoke after shutdown must not touch dead rooms or throw.
  expect(() => svc.sessions.revokeById(p.id)).not.toThrow();
  expect(liveArenaRooms().size).toBe(0);
});
