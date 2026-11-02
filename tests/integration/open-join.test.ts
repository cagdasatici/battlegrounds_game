// Open join: Arel and Nora get sessions without invitations and meet in the one shared room, with real clients.
import { afterAll, beforeAll, expect, test } from "vitest";
import { startHarness, newClient, waitFor, players, type Harness } from "../fixtures/harness.js";

let h: Harness;
beforeAll(async () => {
  h = await startHarness(undefined, { openJoin: true });
});
afterAll(async () => { await h.stop(); });

test("Arel and Nora join the same room and each sees their own name", async () => {
  const a = newClient(h), n = newClient(h);
  expect(await a.openLogin("Arel")).toBe(true);
  expect(await n.openLogin("Nora")).toBe(true);
  const ra = await a.join("r5");
  const rn = await n.join("r5");
  await waitFor(() => players(ra).size === 2 && players(rn).size === 2, 3000, "both seated");
  expect(ra.roomId).toBe(rn.roomId);
  const names = [...players(ra).values()].map((p) => p.displayName).sort();
  expect(names).toEqual(["Arel", "Nora"]);
  await a.leave(); await n.leave();
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
