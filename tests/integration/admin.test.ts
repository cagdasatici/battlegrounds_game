// WEB4: admin API over real HTTP and real Colyseus clients.
import { afterAll, beforeAll, expect, test } from "vitest";
import { setLogSink } from "../../apps/server/src/ops/StructuredLog.js";
import { hashPassword } from "../../apps/server/src/admin/AdminAuth.js";
import { startHarness, loginClient, waitFor, type Harness } from "../fixtures/harness.js";
import { AdminStatusSchema } from "../../packages/shared/src/admin.js";

const PW = "a long admin passphrase";
// createGameServer binds process-wide singletons (arena auth, room directory), so only one harness may serve
// gameplay at a time. Tests that need their own server run first and stop it before the main harness starts.
let h: Harness;
let hash = "";
const logs: string[] = [];
let cookie = "";
let csrf = "";
beforeAll(async () => {
  setLogSink((l) => logs.push(l));
  hash = await hashPassword(PW);
});
afterAll(async () => { await h?.stop(); setLogSink((l) => console.log(l)); });

const call = (path: string, method = "GET", body?: unknown, o: { cookie?: string; csrf?: string | null; origin?: string | null; raw?: string; base?: Harness } = {}) => {
  const base = o.base ?? h;
  const origin = o.origin === undefined ? base.origin : o.origin;
  const ck = o.cookie ?? cookie;
  const tok = o.csrf === undefined ? csrf : o.csrf;
  return fetch(base.origin + path, {
    method,
    headers: { ...(origin ? { origin } : {}), ...(ck ? { cookie: ck } : {}), ...(tok ? { "x-csrf-token": tok } : {}), "content-type": "application/json" },
    ...(method === "GET" ? {} : o.raw !== undefined ? { body: o.raw } : body === undefined ? {} : { body: JSON.stringify(body) }),
  });
};
const login = async (password = PW) => call("/api/admin/login", "POST", { password }, { cookie: "", csrf: null });

test("disabled without a hash: every admin route is 404, announcement stays public", async () => {
  const off = await startHarness();
  try {
    expect((await call("/api/admin/login", "POST", { password: PW }, { base: off })).status).toBe(404);
    expect((await call("/api/admin/status", "GET", undefined, { base: off })).status).toBe(404);
    expect((await call("/api/announcement", "GET", undefined, { base: off })).status).toBe(200);
  } finally { await off.stop(); }
});

test("wrong password 401, bad shape 400, foreign origin 403, 6th attempt in a minute 429", async () => {
  const hh = await startHarness(undefined, { adminPasswordHash: hash });
  try {
    const c = (b: unknown, origin: string | null = hh.origin) => call("/api/admin/login", "POST", b, { cookie: "", csrf: null, origin, base: hh });
    expect((await c({ password: "nope" })).status).toBe(401);
    expect((await c({ password: PW, extra: 1 })).status).toBe(400);
    expect((await c({ password: PW }, "https://foreign.invalid")).status).toBe(403);
    expect((await c({ password: "nope" })).status).toBe(401);
    expect((await c({ password: "nope" })).status).toBe(401);
    // Fifth attempt is still allowed, the sixth is limited, and even the right password is refused.
    expect((await c({ password: "nope" })).status).toBe(401);
    expect((await c({ password: PW })).status).toBe(429);
  } finally { await hh.stop(); }
});

test("login sets a hardened cookie and returns a CSRF token; body limit enforced", async () => {
  h = await startHarness(undefined, { adminPasswordHash: hash });
  const r = await login();
  expect(r.status).toBe(200);
  const sc = r.headers.get("set-cookie")!;
  expect(sc).toMatch(/^eb_admin=/);
  for (const part of ["HttpOnly", "SameSite=Strict", "Path=/api/admin", "Secure", "Max-Age=7200"]) expect(sc).toContain(part);
  cookie = sc.split(";")[0]!;
  const body = (await r.json()) as { csrfToken: string };
  csrf = body.csrfToken;
  expect(csrf.length).toBeGreaterThan(16);
  expect((await call("/api/admin/login", "POST", undefined, { cookie: "", csrf: null, raw: JSON.stringify({ password: "x".repeat(2000) }) })).status).toBe(413);
  expect(logs.some((l) => l.includes("admin login ok"))).toBe(true);
});

test("cookie, CSRF and origin checks on every route; player cookie never opens admin; admin cookie never opens player routes", async () => {
  const routes: [string, string][] = [
    ["GET", "/api/admin/status"], ["GET", "/api/admin/invites"], ["POST", "/api/admin/invites"], ["DELETE", "/api/admin/invites/abc"],
    ["GET", "/api/admin/sessions"], ["DELETE", "/api/admin/sessions/abcdefghijkl"], ["GET", "/api/admin/rooms"], ["POST", "/api/admin/rooms"],
    ["DELETE", "/api/admin/rooms/play"], ["PATCH", "/api/admin/rooms/play"], ["GET", "/api/admin/announcement"], ["PUT", "/api/admin/announcement"], ["POST", "/api/admin/logout"],
  ];
  const player = h.svc.sessions.create("Kid");
  for (const [m, p] of routes) {
    const none = await call(p, m, {}, { cookie: "", csrf: null });
    expect(none.status, `${m} ${p} no cookie`).toBe(401);
    const asPlayer = await call(p, m, {}, { cookie: `eb_session=${player.cookieToken}`, csrf: player.session.csrf });
    expect(asPlayer.status, `${m} ${p} player cookie`).toBe(401);
    expect((await call(p, m, {}, { csrf: null })).status, `${m} ${p} no csrf`).toBe(403);
    expect((await call(p, m, {}, { csrf: "wrong" })).status, `${m} ${p} bad csrf`).toBe(403);
    expect((await call(p, m, {}, { origin: "https://foreign.invalid" })).status, `${m} ${p} foreign origin`).toBe(403);
    if (m !== "GET") expect((await call(p, m, {}, { origin: null })).status, `${m} ${p} missing origin`).toBe(403);
  }
  // Admin cookie on player routes.
  const rooms = await fetch(`${h.origin}/api/rooms`, { headers: { origin: h.origin, cookie: cookie } });
  expect(rooms.status).toBe(401);
  const csrfRes = await fetch(`${h.origin}/api/csrf`, { headers: { origin: h.origin, cookie } });
  expect(csrfRes.status).toBe(401);
  const ticket = await fetch(`${h.origin}/api/join-ticket`, { method: "POST", headers: { origin: h.origin, cookie, "x-csrf-token": csrf, "content-type": "application/json" }, body: JSON.stringify({ roomCode: "play" }) });
  expect(ticket.status).toBe(401);
});

test("status: build, protocol, content hash, uptime, rooms, player count, redacted logs", async () => {
  const c = await loginClient(h, "Seated");
  await c.join("play");
  await waitFor(() => c.welcome !== null, 3000, "welcome");
  const r = await call("/api/admin/status");
  expect(r.status).toBe(200);
  const body = AdminStatusSchema.parse(await r.json());
  expect(body.buildId).toBe("test");
  expect(body.contentHash.length).toBeGreaterThan(8);
  expect(body.logs.length).toBeLessThanOrEqual(50);
  expect(body.rooms.find((x) => x.roomCode === "play")?.players).toBe(1);
  expect(body.playerCount).toBeGreaterThanOrEqual(1);
});

test("invites: create returns the link once, list and revoke never expose tokens", async () => {
  const bad = await call("/api/admin/invites", "POST", { ttlHours: 0, maxUses: 1 });
  expect(bad.status).toBe(400);
  const r = await call("/api/admin/invites", "POST", { ttlHours: 2, maxUses: 3 });
  expect(r.status).toBe(201);
  const made = (await r.json()) as { id: string; link: string; expiresAt: number };
  const token = made.link.split("#invite=")[1]!;
  expect(made.link.startsWith(h.origin)).toBe(true);
  const list = await (await call("/api/admin/invites")).text();
  expect(list).toContain(made.id);
  expect(list).not.toContain(token);
  expect(JSON.parse(list).invites.find((i: { id: string }) => i.id === made.id).usesLeft).toBe(3);
  // The link really works as an invitation.
  const session = await fetch(`${h.origin}/api/session`, { method: "POST", headers: { origin: h.origin, "content-type": "application/json" }, body: JSON.stringify({ invite: token, displayName: "Via" }) });
  expect(session.status).toBe(201);
  expect((await call(`/api/admin/invites/${made.id}`, "DELETE")).status).toBe(204);
  expect((await call(`/api/admin/invites/${made.id}`, "DELETE")).status).toBe(404);
  expect(JSON.parse(await (await call("/api/admin/invites")).text()).invites.some((i: { id: string }) => i.id === made.id)).toBe(false);
});

test("sessions: list shows names and prefixes only; revoke by prefix; unknown 404; revoked player is signed out", async () => {
  const p = h.svc.sessions.create("Victim");
  const text = await (await call("/api/admin/sessions")).text();
  expect(text).toContain("Victim");
  expect(text).not.toContain(p.session.id);
  expect(text).not.toContain(p.cookieToken);
  const prefix = p.session.id.slice(0, 12);
  expect((await call(`/api/admin/sessions/${prefix}`, "DELETE")).status).toBe(204);
  expect(h.svc.sessions.getById(p.session.id)).toBeNull();
  expect((await call(`/api/admin/sessions/${prefix}`, "DELETE")).status).toBe(404);
  expect((await call("/api/admin/sessions/short", "DELETE")).status).toBe(404);
});

test("rooms: create a named listed arena room, list it publicly, toggle listing, close it; unknown 404; sparring controls", async () => {
  const bad = await call("/api/admin/rooms", "POST", { name: "" });
  expect(bad.status).toBe(400);
  const r = await call("/api/admin/rooms", "POST", { name: "Friday Fun" });
  expect(r.status).toBe(201);
  const { roomCode } = (await r.json()) as { roomCode: string };
  const watcher = await loginClient(h, "Watcher");
  expect((await watcher.listRooms()).find((x) => x.roomCode === roomCode)?.name).toBe("Friday Fun");
  // A player can join the new room.
  const joined = await loginClient(h, "Joiner");
  await joined.join(roomCode);
  await waitFor(() => joined.welcome !== null, 3000, "welcome");
  const patch = await call(`/api/admin/rooms/${roomCode}`, "PATCH", { listed: false });
  expect(patch.status).toBe(200);
  expect((await watcher.listRooms()).some((x) => x.roomCode === roomCode)).toBe(false);
  expect((await (await call("/api/admin/rooms")).json() as { rooms: { roomCode: string; listed: boolean }[] }).rooms.find((x) => x.roomCode === roomCode)?.listed).toBe(false);
  expect((await call(`/api/admin/rooms/${roomCode}`, "PATCH", { listed: "yes" })).status).toBe(400);
  expect((await call(`/api/admin/rooms/${roomCode}`, "DELETE")).status).toBe(204);
  expect((await call(`/api/admin/rooms/${roomCode}`, "DELETE")).status).toBe(404);
  expect((await call("/api/admin/rooms/nope", "PATCH", { listed: true })).status).toBe(404);
  expect((await call("/api/admin/rooms/practice", "DELETE")).status).toBe(404);
  // Sparring: unlisted match is visible to the admin, can be listed and closed.
  const host = h.svc.sessions.create("Hoster");
  const { roomCode: sp } = h.svc.sparring.create({ kind: "host", id: host.session.id }, { bots: ["easy"] });
  const rows = (await (await call("/api/admin/rooms")).json() as { rooms: { roomCode: string; kind: string; listed: boolean }[] }).rooms;
  expect(rows.find((x) => x.roomCode === sp)).toMatchObject({ kind: "sparring", listed: false });
  expect((await call(`/api/admin/rooms/${sp}`, "PATCH", { listed: true })).status).toBe(200);
  expect(h.svc.sparring.all().find((m) => m.roomCode === sp)?.listed).toBe(true);
  expect((await call(`/api/admin/rooms/${sp}`, "DELETE")).status).toBe(204);
  expect(h.svc.sparring.describe(sp)).toBeNull();
});

test("admin bots: strict config, real client sees bots and reserved human capacity", async () => {
  for (const bots of [["impossible"], ["easy", "easy", "easy", "easy"]]) {
    expect((await call("/api/admin/rooms", "POST", { name: "Invalid", bots })).status).toBe(400);
  }
  const r = await call("/api/admin/rooms", "POST", { name: "Bot arena", bots: ["easy", "hard", "medium"] });
  expect(r.status).toBe(201);
  const made = await r.json() as { roomCode: string; bots: number };
  expect(made.bots).toBe(3);
  const c = await loginClient(h, "Bot tester");
  const room = await c.join(made.roomCode);
  await waitFor(() => (room.state as { players: Map<string, unknown> }).players?.size === 4, 3000, "three bots and human");
  expect((await c.listRooms()).find(x => x.roomCode === made.roomCode)).toMatchObject({ bots: 3, capacity: 4, players: 1 });
  const other = await loginClient(h, "No space");
  await expect(other.join(made.roomCode)).rejects.toThrow();
  expect((await call(`/api/admin/rooms/${made.roomCode}`, "PATCH", { listed: false })).status).toBe(200);
  expect(h.svc.roomMeta.get(made.roomCode)?.bots).toEqual(["easy", "hard", "medium"]);
  await c.leave();
  await call(`/api/admin/rooms/${made.roomCode}`, "DELETE");
});

test("announcement: set, public read, clear, expiry, length and strictness", async () => {
  expect(((await (await call("/api/announcement", "GET", undefined, { cookie: "", csrf: null })).json()) as { announcement: unknown }).announcement).toBeNull();
  expect((await call("/api/admin/announcement", "PUT", { text: "x".repeat(201) })).status).toBe(400);
  expect((await call("/api/admin/announcement", "PUT", { text: "hi", extra: 1 })).status).toBe(400);
  expect((await call("/api/admin/announcement", "PUT", { text: "hi", expiresAt: 5 })).status).toBe(400); // already past
  const set = await call("/api/admin/announcement", "PUT", { text: "Server restart at 8", expiresAt: Date.now() + 60_000 });
  expect(set.status).toBe(200);
  const pub = (await (await call("/api/announcement", "GET", undefined, { cookie: "", csrf: null })).json()) as { announcement: { text: string } };
  expect(pub.announcement.text).toBe("Server restart at 8");
  expect(((await (await call("/api/admin/announcement")).json()) as { announcement: { text: string } }).announcement.text).toBe("Server restart at 8");
  expect((await call("/api/admin/announcement", "PUT", { text: "" })).status).toBe(200);
  expect(((await (await call("/api/announcement", "GET", undefined, { cookie: "", csrf: null })).json()) as { announcement: unknown }).announcement).toBeNull();
});

test("logout ends the admin session", async () => {
  expect((await call("/api/admin/logout", "POST", {})).status).toBe(204);
  expect((await call("/api/admin/status")).status).toBe(401);
});

test("no password, hash, cookie token or invite token appears in any log line", () => {
  const all = logs.join("\n");
  expect(all).not.toContain(PW);
  expect(all).not.toContain("scrypt$");
  expect(all).not.toContain("#invite=");
  expect(all).not.toContain(cookie.split("=")[1] ?? "never");
  expect(all).toContain("admin login failed");
});
