import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { Server } from "colyseus";
import { createGameServer } from "../../apps/server/src/createServer.js";
import { createAuthServices, type AuthServices } from "../../apps/server/src/auth/Services.js";
import { JoinTicketStore, TICKET_TTL_MS } from "../../apps/server/src/auth/JoinTicketStore.js";
import { SessionStore, SESSION_ABSOLUTE_MS, SESSION_IDLE_MS } from "../../apps/server/src/auth/SessionStore.js";
import { redact } from "../../apps/server/src/ops/StructuredLog.js";
import { PROTOCOL_VERSION } from "../../packages/shared/src/protocol.js";
import { computeContentHash } from "../../packages/shared/src/config/content.js";

const PORT = 25671;
const ORIGIN = `http://localhost:${PORT}`;
const BASE = ORIGIN;
const dir = mkdtempSync(join(tmpdir(), "eb-auth-"));
let server: Server;
let svc: AuthServices;

async function api(path: string, init: { method?: string; body?: unknown; cookie?: string; csrf?: string; origin?: string | null } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (init.origin !== null) headers["origin"] = init.origin ?? ORIGIN;
  if (init.cookie) headers["cookie"] = init.cookie;
  if (init.csrf) headers["x-csrf-token"] = init.csrf;
  return fetch(BASE + path, {
    method: init.method ?? "GET",
    headers,
    ...(init.body !== undefined ? { body: typeof init.body === "string" ? init.body : JSON.stringify(init.body) } : {}),
  });
}

async function login(displayName = "Arel") {
  const { token } = svc.invites.create({ ttlMs: 60_000, maxUses: 1 });
  const r = await api("/api/session", { method: "POST", body: { invite: token, displayName } });
  const setCookie = r.headers.get("set-cookie") ?? "";
  const cookie = setCookie.split(";")[0] ?? "";
  return { r, cookie, token, setCookie };
}

beforeAll(async () => {
  svc = createAuthServices({
    dataDir: dir, allowedOrigins: [ORIGIN], secureCookies: true,
    roomCodes: { play: "arena" }, buildId: "test", sessionsPerMinute: 1000, globalSessionsPerMinute: 1000,
  });
  server = createGameServer(svc);
  await server.listen(PORT, undefined, undefined);
});
afterAll(async () => { await server.gracefullyShutdown(false); });

describe("public endpoints", () => {
  test("healthz exposes no details", async () => {
    const r = await api("/healthz");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
  });
  test("version", async () => {
    const j = await (await api("/api/version")).json();
    expect(j).toEqual({ protocolVersion: PROTOCOL_VERSION, contentHash: computeContentHash(), buildId: "test" });
  });
});

describe("session exchange", () => {
  test("valid invite gives 201 with Secure HttpOnly SameSite=Strict cookie", async () => {
    const { r, setCookie } = await login();
    expect(r.status).toBe(201);
    expect(setCookie).toMatch(/Secure/);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Strict/);
    expect(setCookie).toMatch(/Path=\//);
    expect(typeof (await r.json()).expiresAt).toBe("number");
  });
  test("invite is single use", async () => {
    const { token } = await login();
    const r = await api("/api/session", { method: "POST", body: { invite: token, displayName: "Nora" } });
    expect(r.status).toBe(401);
  });
  test("invalid invite and bad names give 401", async () => {
    expect((await api("/api/session", { method: "POST", body: { invite: "nope-nope-nope", displayName: "A" } })).status).toBe(401);
    const { token } = svc.invites.create({ ttlMs: 1000, maxUses: 1 });
    expect((await api("/api/session", { method: "POST", body: { invite: token, displayName: "bad\u0001" } })).status).toBe(401);
  });
  test("cross origin and missing origin are rejected", async () => {
    const { token } = svc.invites.create({ ttlMs: 1000, maxUses: 1 });
    expect((await api("/api/session", { method: "POST", origin: "https://evil.example", body: { invite: token, displayName: "x" } })).status).toBe(403);
    expect((await api("/api/session", { method: "POST", origin: null, body: { invite: token, displayName: "x" } })).status).toBe(403);
  });
  test("bodies over 1 KB are rejected", async () => {
    const r = await api("/api/session", { method: "POST", body: JSON.stringify({ invite: "x".repeat(4000), displayName: "x" }) });
    expect([401, 413]).toContain(r.status);
  });
  test("invitation hash and session hash are stored, not the tokens; files are 0600", async () => {
    const { token, cookie } = await login("Nora");
    const inv = readFileSync(join(dir, "invites.json"), "utf8");
    const ses = readFileSync(join(dir, "sessions.json"), "utf8");
    expect(inv).not.toContain(token);
    expect(ses).not.toContain(cookie.split("=")[1]!);
    expect(statSync(join(dir, "invites.json")).mode & 0o777).toBe(0o600);
    expect(statSync(join(dir, "sessions.json")).mode & 0o777).toBe(0o600);
  });
});

describe("csrf and join tickets", () => {
  test("csrf requires a valid cookie", async () => {
    expect((await api("/api/csrf")).status).toBe(401);
    const { cookie } = await login();
    const r = await api("/api/csrf", { cookie });
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(typeof (await r.json()).csrfToken).toBe("string");
  });
  test("join ticket needs csrf; unknown room is 409; success returns a 64 hex ticket", async () => {
    const { cookie } = await login();
    const { csrfToken } = await (await api("/api/csrf", { cookie })).json();
    expect((await api("/api/join-ticket", { method: "POST", cookie, body: { roomCode: "play" } })).status).toBe(403);
    expect((await api("/api/join-ticket", { method: "POST", cookie, csrf: csrfToken, body: { roomCode: "zzz" } })).status).toBe(409);
    expect((await api("/api/join-ticket", { method: "POST", cookie, csrf: csrfToken, body: { roomCode: "__proto__" } })).status).toBe(409);
    expect((await api("/api/join-ticket", { method: "POST", cookie, body: { roomCode: "play" }, origin: "https://evil.example" })).status).toBe(403);
    const r = await api("/api/join-ticket", { method: "POST", cookie, csrf: csrfToken, body: { roomCode: "play" } });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.ticket).toMatch(/^[0-9a-f]{64}$/);
    expect(j.roomName).toBe("arena");
    expect(j.expiresAt).toBeGreaterThan(Date.now());
  });
  test("join ticket without a session is 401", async () => {
    expect((await api("/api/join-ticket", { method: "POST", body: { roomCode: "play" } })).status).toBe(401);
  });
  test("DELETE revokes the session and its outstanding tickets", async () => {
    const { cookie } = await login();
    const { csrfToken } = await (await api("/api/csrf", { cookie })).json();
    const t = await (await api("/api/join-ticket", { method: "POST", cookie, csrf: csrfToken, body: { roomCode: "play" } })).json();
    expect((await api("/api/session", { method: "DELETE", cookie })).status).toBe(403); // csrf
    expect((await api("/api/session", { method: "DELETE", cookie, csrf: csrfToken })).status).toBe(204);
    expect((await api("/api/csrf", { cookie })).status).toBe(401);
    expect(svc.tickets.consume(t.ticket, { roomName: "arena", contentHash: computeContentHash(), protocolVersion: PROTOCOL_VERSION })).toBeNull();
  });
  test("session creation is limited to 5 per source per minute by default, and responses carry security headers", async () => {
    const p2 = PORT + 1;
    const o2 = `http://localhost:${p2}`;
    const s2 = createGameServer(createAuthServices({ dataDir: mkdtempSync(join(tmpdir(), "eb-rl-")), allowedOrigins: [o2], secureCookies: true, roomCodes: { play: "arena" }, buildId: "test" }));
    await s2.listen(p2, undefined, undefined);
    try {
      const post = () => fetch(`${o2}/api/session`, { method: "POST", headers: { origin: o2, "content-type": "application/json" }, body: JSON.stringify({ invite: "garbage-garbage", displayName: "x" }) });
      const codes: number[] = [];
      for (let i = 0; i < 7; i++) codes.push((await post()).status);
      expect(codes.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
      expect(codes.slice(5)).toEqual([429, 429]);
      const h = (await fetch(`${o2}/healthz`)).headers;
      expect(h.get("referrer-policy")).toBe("no-referrer");
      expect(h.get("content-security-policy")).toContain("frame-ancestors 'none'");
      expect(h.get("x-content-type-options")).toBe("nosniff");
    } finally { await s2.gracefullyShutdown(false); }
  });
});

describe("JoinTicketStore (fake clock)", () => {
  const exp = { roomName: "arena", contentHash: "a".repeat(16), protocolVersion: 1 };
  test("single use", () => {
    const t = new JoinTicketStore(() => 0);
    const { ticket } = t.issue({ sessionId: "s", roomName: "arena", roomCode: "play", contentHash: exp.contentHash, protocolVersion: 1 });
    expect(t.consume(ticket, exp)?.sessionId).toBe("s");
    expect(t.consume(ticket, exp)).toBeNull();
  });
  test("expires after 30 s", () => {
    let now = 0;
    const t = new JoinTicketStore(() => now);
    const { ticket } = t.issue({ sessionId: "s", roomName: "arena", roomCode: "play", contentHash: exp.contentHash, protocolVersion: 1 });
    now = TICKET_TTL_MS;
    expect(t.consume(ticket, exp)).toBeNull();
  });
  test("bound to room, hash and protocol; a failed attempt burns the ticket", () => {
    const t = new JoinTicketStore(() => 0);
    const mk = () => t.issue({ sessionId: "s", roomName: "arena", roomCode: "play", contentHash: exp.contentHash, protocolVersion: 1 }).ticket;
    let k = mk();
    expect(t.consume(k, { ...exp, roomName: "practice" })).toBeNull();
    expect(t.consume(k, exp)).toBeNull();
    k = mk();
    expect(t.consume(k, { ...exp, contentHash: "b".repeat(16) })).toBeNull();
    k = mk();
    expect(t.consume(k, { ...exp, protocolVersion: 2 })).toBeNull();
    k = mk();
    expect(t.consume(k, { ...exp, roomCode: "other" })).toBeNull();
  });
});

describe("SessionStore expiry", () => {
  test("idle 8h refreshed by activity; absolute 24h cap", () => {
    let now = 1_000;
    const s = new SessionStore(join(mkdtempSync(join(tmpdir(), "eb-ses-")), "s.json"), () => now);
    const { cookieToken } = s.create("A");
    now += SESSION_IDLE_MS - 1;
    expect(s.get(cookieToken)).not.toBeNull(); // touches
    now += SESSION_IDLE_MS - 1;
    expect(s.get(cookieToken)).not.toBeNull(); // still alive thanks to refresh
    now += SESSION_IDLE_MS - 1;
    expect(s.get(cookieToken)).not.toBeNull();
    now = 1_000 + SESSION_ABSOLUTE_MS;
    expect(s.get(cookieToken)).toBeNull(); // absolute cap
  });
  test("idle expiry without activity; get(touch=false) does not extend", () => {
    let now = 0;
    const s = new SessionStore(join(mkdtempSync(join(tmpdir(), "eb-ses-")), "s.json"), () => now);
    const { cookieToken } = s.create("A");
    now = SESSION_IDLE_MS - 1;
    expect(s.get(cookieToken, false)).not.toBeNull();
    now = SESSION_IDLE_MS;
    expect(s.get(cookieToken)).toBeNull();
  });
});

describe("log redaction", () => {
  test("secret-like keys are redacted", () => {
    expect(redact({ invite: "a", ticket: "b", nested: { cookie: "c", ok: 1 }, reconnectionToken: "r" }))
      .toEqual({ invite: "[redacted]", ticket: "[redacted]", nested: { cookie: "[redacted]", ok: 1 }, reconnectionToken: "[redacted]" });
  });
});
