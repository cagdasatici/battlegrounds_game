// BOT4: hosted sparring over real Colyseus connections and real HTTP (no mocked transport).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as createNetServer } from "node:net";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Client, type Room } from "@colyseus/sdk";
import { matchMaker, type Server } from "colyseus";
import { createGameServer } from "../../apps/server/src/createServer.js";
import { createAuthServices, type AuthServices } from "../../apps/server/src/auth/Services.js";
import { PROTOCOL_VERSION } from "../../packages/shared/src/protocol.js";
import { computeContentHash } from "../../packages/shared/src/config/content.js";
import type { SparringRoom } from "../../apps/server/src/rooms/SparringRoom.js";
import { roomDirectory } from "../../apps/server/src/rooms/RoomDirectory.js";
import { waitFor, players } from "../fixtures/harness.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hash = computeContentHash();
let svc: AuthServices, server: Server, origin = "", port = 0, offset = 0;
const now = (): number => Date.now() + offset;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createNetServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); });
  });
}

beforeAll(async () => {
  port = await freePort();
  origin = `http://localhost:${port}`;
  svc = createAuthServices({
    dataDir: mkdtempSync(join(tmpdir(), "eb-spar-")), allowedOrigins: [origin], secureCookies: true,
    roomCodes: { play: "arena", practice: "practice" }, buildId: "test", sessionsPerMinute: 10_000, globalSessionsPerMinute: 10_000,
  }, now);
  server = createGameServer(svc);
  await server.listen(port, undefined, undefined);
});
afterAll(async () => { await server.gracefullyShutdown(false); });

/** A browser stand-in: its own cookie jar, optional CSRF, JSON helpers. */
class Http {
  jar = new Map<string, string>();
  csrf = "";
  async call(method: string, path: string, body?: unknown, csrf: string | null = this.csrf): Promise<{ status: number; json: any }> {
    const headers: Record<string, string> = { origin, "content-type": "application/json" };
    if (this.jar.size) headers["cookie"] = [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
    if (csrf) headers["x-csrf-token"] = csrf;
    const r = await fetch(origin + path, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    for (const c of r.headers.getSetCookie()) {
      const [kv] = c.split(";");
      const i = kv!.indexOf("=");
      this.jar.set(kv!.slice(0, i), kv!.slice(i + 1));
    }
    const text = await r.text();
    return { status: r.status, json: text ? JSON.parse(text) : null };
  }
}

async function host(name = "Host"): Promise<Http> {
  const http = new Http();
  const { token } = svc.invites.create({ ttlMs: 60_000, maxUses: 1 });
  expect((await http.call("POST", "/api/session", { invite: token, displayName: name }, null)).status).toBe(201);
  http.csrf = (await http.call("GET", "/api/csrf", undefined, null)).json.csrfToken;
  return http;
}

interface Member { http: Http; room: Room; epoch: () => number; me: () => any }

async function enter(http: Http, roomCode: string, name: string): Promise<Member> {
  const t = await http.call("POST", "/api/join-ticket", { roomCode });
  expect(t.status).toBe(200);
  const room = await new Client(`ws://localhost:${port}`).joinById(t.json.roomId, {
    roomCode, ticket: t.json.ticket, protocolVersion: PROTOCOL_VERSION, contentHash: hash,
  });
  let epoch = 0;
  room.onMessage("welcome", (w: { epoch: number }) => { epoch = w.epoch; });
  await waitFor(() => epoch > 0, 3000, "welcome");
  return { http, room, epoch: () => epoch, me: () => [...players(room).values()].find((p) => p.displayName === name) };
}

async function guestOf(roomCode: string, hostHttp: Http, name = "Guest"): Promise<{ http: Http; status: number }> {
  const link = await hostHttp.call("POST", "/api/sparring/link", { roomCode });
  const g = new Http();
  const r = await g.call("POST", "/api/sparring/redeem", { token: link.json?.token ?? "x".repeat(43), displayName: name }, null);
  if (r.status === 201) g.csrf = r.json.csrfToken;
  return { http: g, status: r.status };
}

const created = async (http: Http, bots: string[]): Promise<string> => {
  const r = await http.call("POST", "/api/sparring", { bots });
  expect(r.status).toBe(201);
  expect(r.json.roomCode).toMatch(/^sp-[0-9a-f]{32}$/);
  return r.json.roomCode;
};

describe("BOT4 hosted sparring (real clients)", () => {
  test("host plus one bot: the bot is a server fighter, hits the host through the ordinary pipeline, and never a Colyseus client", async () => {
    const hh = await host("Arel");
    const code = await created(hh, ["medium"]);
    const m = await enter(hh, code, "Arel");
    await waitFor(() => players(m.room).size === 2, 3000, "bot and host replicated");
    const bot = [...players(m.room).values()].find((p) => p.displayName === "Bot 1");
    expect(bot.kitId).toBe("sv");
    expect(bot.ready).toBe(true);
    const sparRoom = matchMaker.getLocalRoomById(m.room.roomId) as unknown as SparringRoom;
    expect(sparRoom.clients.length).toBe(1); // the bot has no synthetic client
    m.room.send("ready", { kitId: "td", contentHash: hash });
    await waitFor(() => m.me()?.ready && m.me().action === "Idle", 3000, "host ready");
    await waitFor(() => sparRoom.movement!.get(m.me().entityId)!.state.grounded, 4000, "grounded");
    // Fixture: stand the host 1.5 m from the bot. Damage must still come from the bot's own server input.
    const bp = sparRoom.movement!.position(bot.entityId)!;
    const hb = sparRoom.movement!.get(m.me().entityId)!;
    const p = { x: bp[0], y: bp[1], z: bp[2] + 1.5 };
    hb.rb.setTranslation(p, true); hb.rb.setNextKinematicTranslation(p);
    await waitFor(() => m.me().hp100 < 10000, 15000, "bot damaged the host");
    // The host owner record is visible to the host only; the bot's is never sent to anyone.
    expect(bot.owner).toBeUndefined();
    await m.room.leave(true);
  }, 30000);

  test("a fresh guest joins through a scoped link; its authority is limited to that match", async () => {
    const hh = await host("Ana");
    const code = await created(hh, []);
    // No link until the host has joined.
    expect((await hh.call("POST", "/api/sparring/link", { roomCode: code })).status).toBe(409);
    const hm = await enter(hh, code, "Ana");
    const g = await guestOf(code, hh, "Gus");
    expect(g.status).toBe(201);
    expect(g.http.jar.get("eb_spar_guest")).toBeTruthy();
    // Recover credentials after a reload from the cookie alone.
    const rec = await g.http.call("GET", "/api/sparring/guest", undefined, null);
    expect(rec.json).toEqual({ roomCode: code, csrfToken: g.http.csrf });
    // Guest cookie never authorizes the general endpoints or host operations.
    expect((await g.http.call("POST", "/api/join-ticket", { roomCode: "play" })).status).toBe(401);
    expect((await g.http.call("POST", "/api/sparring", { bots: [] })).status).toBe(401);
    expect((await g.http.call("POST", "/api/sparring/link", { roomCode: code })).status).toBe(401);
    expect((await g.http.call("POST", "/api/sparring/end", { roomCode: code })).status).toBe(401);
    expect((await g.http.call("GET", "/api/csrf", undefined, null)).status).toBe(401);
    // Wrong CSRF is refused; the host session cannot be borrowed by a guest cookie for another match.
    expect((await g.http.call("POST", "/api/join-ticket", { roomCode: code }, "wrong")).status).toBe(403);
    const other = await host("Other");
    const otherCode = await created(other, []);
    expect((await g.http.call("POST", "/api/join-ticket", { roomCode: otherCode })).status).toBe(401);
    const gm = await enter(g.http, code, "Gus");
    await waitFor(() => players(hm.room).size === 2 && players(gm.room).size === 2, 3000, "both replicated");
    // Ready, then each human only sees their own owner record.
    gm.room.send("ready", { kitId: "sv", contentHash: hash });
    await waitFor(() => gm.me()?.ready, 3000, "guest ready");
    await waitFor(() => gm.me().owner.epoch > 0, 3000, "guest owner record");
    const guestSeenByHost = [...players(hm.room).values()].find((p) => p.displayName === "Gus");
    expect(guestSeenByHost.owner).toBeUndefined(); // owner-only fields never reach another human
    expect(hm.me().owner).toBeDefined();
    // The same principal cannot be admitted twice while connected.
    expect((await g.http.call("POST", "/api/join-ticket", { roomCode: code })).status).toBe(409);
    await gm.room.leave(true);
    await hm.room.leave(true);
    await other.call("POST", "/api/sparring/end", { roomCode: otherCode });
  }, 30000);

  test("seat limits: bots, host and reservations never exceed four, and a link redeems once", async () => {
    const hh = await host("Cap");
    const code = await created(hh, ["easy", "easy"]);
    const hm = await enter(hh, code, "Cap");
    const link = await hh.call("POST", "/api/sparring/link", { roomCode: code });
    expect(link.status).toBe(201);
    const redeem = (name: string) => new Http().call("POST", "/api/sparring/redeem", { token: link.json.token, displayName: name }, null);
    const results = await Promise.all([redeem("A"), redeem("B")]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 401]); // single use, exactly one wins the last seat
    expect((await hh.call("POST", "/api/sparring/link", { roomCode: code })).status).toBe(409); // full
    await hm.room.leave(true);
  }, 20000);

  test("direct SDK creation and joins are refused; a code alone grants nothing", async () => {
    const fake = `sp-${"a".repeat(32)}`;
    const c = new Client(`ws://localhost:${port}`);
    await expect(c.create("sparring", { roomCode: fake })).rejects.toBeTruthy();
    await expect(c.joinOrCreate("sparring", { roomCode: fake })).rejects.toBeTruthy();
    const hh = await host("Real");
    const code = await created(hh, []);
    const t = await hh.call("POST", "/api/join-ticket", { roomCode: code });
    await expect(c.joinById(t.json.roomId, { roomCode: code, ticket: "0".repeat(64), protocolVersion: PROTOCOL_VERSION, contentHash: hash })).rejects.toBeTruthy();
    // A ticket for another room name cannot enter this one.
    const play = await hh.call("POST", "/api/join-ticket", { roomCode: "play" });
    await expect(c.joinById(t.json.roomId, { roomCode: code, ticket: play.json.ticket, protocolVersion: PROTOCOL_VERSION, contentHash: hash })).rejects.toBeTruthy();
    // Creating a second hosted match for the same host is refused.
    expect((await hh.call("POST", "/api/sparring", { bots: [] })).status).toBe(409);
    // Invalid rosters are schema errors.
    const h2 = await host("Two");
    expect((await h2.call("POST", "/api/sparring", { bots: ["easy", "easy", "easy", "easy"] })).status).toBe(400);
    expect((await h2.call("POST", "/api/sparring", { bots: ["insane"] })).status).toBe(400);
    expect((await h2.call("POST", "/api/sparring", { bots: [], extra: 1 })).status).toBe(400);
    expect((await h2.call("POST", "/api/sparring", { bots: [] }, "wrong")).status).toBe(403);
    await hh.call("POST", "/api/sparring/end", { roomCode: code });
  }, 20000);

  test("host Leave closes the match: guests are dropped, links and tickets die", async () => {
    const hh = await host("Lea");
    const code = await created(hh, ["easy"]);
    const hm = await enter(hh, code, "Lea");
    const g = await guestOf(code, hh);
    const gm = await enter(g.http, code, "Guest");
    let guestLeft = false;
    gm.room.onLeave(() => { guestLeft = true; });
    const link = await hh.call("POST", "/api/sparring/link", { roomCode: code }).catch(() => null);
    await hm.room.leave(true);
    await waitFor(() => guestLeft, 4000, "guest returned");
    expect(svc.sparring.isOpen(code)).toBe(false);
    expect((await g.http.call("POST", "/api/join-ticket", { roomCode: code })).status).toBeGreaterThanOrEqual(400);
    if (link?.json?.token) expect((await new Http().call("POST", "/api/sparring/redeem", { token: link.json.token, displayName: "Late" }, null)).status).toBe(401);
    await waitFor(() => roomsFor(code) === 0, 4000, "room disposed");
  }, 20000);

  test("end route and a revoked host session both close the room, even with no client connected", async () => {
    const a = await host("Endr");
    const codeA = await created(a, []);
    expect((await a.call("POST", "/api/sparring/end", { roomCode: codeA })).status).toBe(204);
    await waitFor(() => roomsFor(codeA) === 0, 4000, "ended room disposed");
    expect((await a.call("POST", "/api/join-ticket", { roomCode: codeA })).status).toBe(409);

    const b = await host("Revk");
    const codeB = await created(b, ["hard"]);
    const bm = await enter(b, codeB, "Revk");
    let left = false;
    bm.room.onLeave(() => { left = true; });
    const id = [...svc.sessions["store"].read().sessions].find((s: { displayName: string }) => s.displayName === "Revk")!.id;
    expect(svc.sessions.revokeById(id)).toBe(true);
    await waitFor(() => left, 4000, "revoked host disconnected");
    await waitFor(() => roomsFor(codeB) === 0, 4000, "revoked room disposed");
  }, 20000);

  test("an unjoined match closes after its 60 s reservation; a dropped host keeps 20 s", async () => {
    const hh = await host("Idle");
    const code = await created(hh, ["easy"]);
    offset += 61_000;
    await waitFor(() => roomsFor(code) === 0, 4000, "unjoined room closed");
    expect(svc.sparring.isOpen(code)).toBe(false);
    offset += 0;
    const h2 = await host("Drop");
    const code2 = await created(h2, []);
    const m = await enter(h2, code2, "Drop");
    m.room.reconnection.enabled = false;
    m.room.connection.close(4010, "network lost");
    await sleep(300);
    offset += 10_000;
    await sleep(1300);
    expect(svc.sparring.isOpen(code2)).toBe(true); // inside the 20 s grace
    offset += 11_000;
    await waitFor(() => roomsFor(code2) === 0, 4000, "grace exhausted closes the match");
  }, 30000);

  test("per-life KO and respawn score each bot once with no score bleed between matches", async () => {
    const hh = await host("Kor");
    const code = await created(hh, ["easy"]);
    const m = await enter(hh, code, "Kor");
    const sparRoom = matchMaker.getLocalRoomById(m.room.roomId) as unknown as SparringRoom;
    const bot = () => [...players(m.room).values()].find((p) => p.displayName === "Bot 1");
    const botId = bot().entityId as number;
    await waitFor(() => sparRoom.movement!.get(botId)!.state.grounded && sparRoom.sim.tick > sparRoom.combat.get(botId)!.protectedUntilTick + 2, 4000, "bot settled");
    const life0 = sparRoom.combat.get(botId)!.lifeId;
    const b = sparRoom.movement!.get(botId)!;
    const off = { x: 0, y: -200, z: 0 };
    b.rb.setTranslation(off, true); b.rb.setNextKinematicTranslation(off); // ring-out below the void plane
    await waitFor(() => bot().deaths === 1, 4000, "ring-out KO scored once");
    await waitFor(() => sparRoom.combat.get(botId)!.lifeId !== life0 && bot().action !== "Dead", 8000, "respawned in a new life");
    expect(bot().deaths).toBe(1);
    expect(bot().kills).toBe(0);
    expect(bot().hp100).toBe(10000);
    // A second match has its own fresh scoreboard.
    const h2 = await host("Fresh");
    const code2 = await created(h2, ["easy"]);
    const m2 = await enter(h2, code2, "Fresh");
    const bot2 = [...players(m2.room).values()].find((p) => p.displayName === "Bot 1");
    expect(bot2.deaths).toBe(0);
    await m.room.leave(true);
    await m2.room.leave(true);
  }, 30000);
});

/** 1 while the hosted room is registered (it unregisters on dispose), else 0. */
function roomsFor(code: string): number { return roomDirectory.get(code) ? 1 : 0; }
