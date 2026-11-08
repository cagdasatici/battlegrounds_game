// Open join: all three presets get sessions without invitations and meet in the shared room, with real clients.
import { afterAll, beforeAll, expect, test } from "vitest";
import { Client } from "@colyseus/sdk";
import { RoomClient } from "../../apps/client/src/net/RoomClient.js";
import { startHarness, newClient, browserFetch, waitFor, players, type Harness } from "../fixtures/harness.js";

let h: Harness;
beforeAll(async () => {
  h = await startHarness(undefined, { openJoin: true });
});
afterAll(async () => { await h.stop(); });

test("Arel, Nora and Cagdas join the same room and each sees their own name", async () => {
  const a = newClient(h), n = newClient(h), c = newClient(h);
  expect(await a.openLogin("Arel")).toBe(true);
  expect(await n.openLogin("Nora")).toBe(true);
  expect(await c.openLogin("Cagdas")).toBe(true);
  const ra = await a.join("r5");
  const rn = await n.join("r5");
  const rc = await c.join("r5");
  await waitFor(() => [ra, rn, rc].every(r => players(r).size === 3), 3000, "all three seated");
  expect(ra.roomId).toBe(rn.roomId);
  expect(ra.roomId).toBe(rc.roomId);
  const names = [...players(ra).values()].map((p) => p.displayName).sort();
  expect(names).toEqual(["Arel", "Cagdas", "Nora"]);
  await a.leave(); await n.leave(); await c.leave();
});

test("picking Nora after Arel in the same browser replaces the session (name bug)", async () => {
  const c = newClient(h);
  await c.openLogin("Arel");
  await c.openLogin("Nora");
  const room = await c.join("r5");
  await waitFor(() => players(room).size >= 1, 3000, "seated");
  const mine = [...players(room).values()].filter((p) => p.owner !== undefined).map((p) => p.displayName);
  expect(mine).toEqual(["Nora"]);
  await c.leave();
});

test("repeating the same pick keeps the session; other names are refused", async () => {
  const c = newClient(h);
  await c.openLogin("Arel");
  const csrf1 = (await (await (c as unknown as { http(p: string): Promise<Response> }).http("/api/csrf")).json()).csrfToken;
  await c.openLogin("Arel");
  const csrf2 = (await (await (c as unknown as { http(p: string): Promise<Response> }).http("/api/csrf")).json()).csrfToken;
  expect(csrf2).toBe(csrf1);
  const bad = await fetch(`${h.origin}/api/open-session`, { method: "POST", headers: { origin: h.origin, "content-type": "application/json" }, body: JSON.stringify({ displayName: "Mallory" }) });
  expect(bad.status).toBe(400);
});

test("open join is off by default (404) so the client falls back", async () => {
  // One harness per file: the arena room's auth services are a module singleton.
  h.svc.config.openJoin = false;
  try { expect(await newClient(h).openLogin("Arel")).toBe(false); } finally { h.svc.config.openJoin = true; }
});

test("a forged CF-Connecting-IP is ignored unless the peer is loopback, and is hashed not stored raw", async () => {
  const r = await fetch(`${h.origin}/api/open-session`, { method: "POST", headers: { origin: h.origin, "content-type": "application/json", "cf-connecting-ip": "203.0.113.9" }, body: JSON.stringify({ displayName: "Nora" }) });
  expect(r.status).toBe(201);
  const raw = JSON.stringify(h.svc.sessions.list());
  expect(raw).not.toContain("203.0.113.9");
});

test("with an Access verifier configured, a request without a valid token gets no session", async () => {
  const { AccessVerifier } = await import("../../apps/server/src/auth/AccessJwt.js");
  h.svc.config.access = new AccessVerifier("team", "a".repeat(32), (async () => new Response("{}", { status: 500 })) as typeof fetch);
  try {
    const r = await fetch(`${h.origin}/api/open-session`, { method: "POST", headers: { origin: h.origin, "content-type": "application/json", "cf-access-jwt-assertion": "x.y.z" }, body: JSON.stringify({ displayName: "Arel" }) });
    expect(r.status).toBe(401);
    expect(r.headers.get("set-cookie")).toBeNull();
  } finally { h.svc.config.access = null; }
});

// OPEN01 / decision 0053: the session is identified by the cookie, not the source address.
function ipClient(ip: { v: string }): { c: RoomClient; csrf(): Promise<string> } {
  const inner = browserFetch(h.origin);
  const fetchFn = ((url: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("cf-connecting-ip", ip.v);
    return inner(url, { ...init, headers });
  }) as typeof fetch;
  const store = new Map<string, string>();
  const c = new RoomClient({
    httpBase: h.origin, wsEndpoint: `ws://localhost:${h.port}`, fetchFn,
    storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: (k) => void store.delete(k) },
    sleep: async () => undefined,
  });
  return { c, csrf: async () => (await (await fetchFn(`${h.origin}/api/csrf`)).json()).csrfToken };
}

test("same cookie from a new address keeps the session and the seat in the reconnect window", async () => {
  const ip = { v: "198.51.100.1" };
  const { c, csrf } = ipClient(ip);
  expect(await c.openLogin("Arel")).toBe(true);
  const csrf1 = await csrf();
  const other = newClient(h);
  await other.openLogin("Nora");
  const code = "r7";
  const r1 = await c.join(code);
  const ro = await other.join(code);
  await waitFor(() => players(ro).size === 2, 3000, "2 players");
  const mine = [...players(ro).values()].find((p) => p.displayName === "Arel")!;
  const token = r1.reconnectionToken;
  r1.reconnection.enabled = false;
  r1.connection.close(4010, "network lost");
  await waitFor(() => players(ro).get(String(mine.entityId))?.connected === false, 3000, "dropped");

  ip.v = "203.0.113.77"; // phone moved from wifi to mobile data
  expect(await c.openLogin("Arel")).toBe(true);
  expect(await csrf()).toBe(csrf1); // same session id (csrf is per session)
  expect(JSON.stringify(h.svc.sessions.list())).not.toContain("203.0.113.77");
  // A ticket issued after the change is bound to the SAME session: the room still sees the reserved seat as this
  // session's and refuses a second one (SEAT_TAKEN surfaces as INVITE_INVALID). A new session would have been seated.
  await expect(c.join(code)).rejects.toThrow(/INVITE_INVALID/);
  expect(players(ro).size).toBe(2);
  // The reconnect token resumes the same seat in the window.
  const r2 = await new Client(`ws://localhost:${h.port}`).reconnect(token);
  await waitFor(() => players(ro).get(String(mine.entityId))?.connected === true, 3000, "same seat resumed");
  expect(players(ro).size).toBe(2);
  expect([...players(ro).values()].filter((p) => p.displayName === "Arel").length).toBe(1);
  await r2.leave(); await other.leave();
});

test("same cookie from a new address with a different name does not reuse the session", async () => {
  const ip = { v: "198.51.100.2" };
  const { c, csrf } = ipClient(ip);
  await c.openLogin("Arel");
  const csrf1 = await csrf();
  ip.v = "203.0.113.78";
  expect(await c.openLogin("Nora")).toBe(true);
  expect(await csrf()).not.toBe(csrf1);
});
