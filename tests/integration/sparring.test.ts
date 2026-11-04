import { afterAll, beforeAll, expect, test } from "vitest";
import { Client, type Room } from "@colyseus/sdk";
import { matchMaker } from "colyseus";
import { startHarness, waitFor, players, loginClient, type Harness } from "../fixtures/harness.js";
import { HIT_STUN } from "../../packages/shared/src/config/combat.js";
import { ARENA } from "../../packages/shared/src/config/arena.js";
import { computeContentHash } from "../../packages/shared/src/config/content.js";
import { PROTOCOL_VERSION, type CombatEvent } from "../../packages/shared/src/protocol.js";
import { applyReaction } from "../../apps/server/src/sim/ActionMachine.js";
import type { SparringRoom } from "../../apps/server/src/rooms/SparringRoom.js";
import type { Difficulty } from "../../packages/shared/src/sparring.js";

let h: Harness;
// Decision 0049: QA01 relies on the legacy on-hit freeze to make same-tick trades land exactly once.
beforeAll(() => { HIT_STUN.enabled = true; });
afterAll(() => { HIT_STUN.enabled = false; });
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h.stop(); });
const hash = computeContentHash();
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
function http(cookie = "", csrf = "") {
  return async (path: string, data?: unknown, extra: Record<string, string> = {}) => fetch(`${h.origin}${path}`, {
    method: data === undefined ? "GET" : "POST", headers: { origin: h.origin, cookie, "x-csrf-token": csrf, "content-type": "application/json", ...extra },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
}
async function host(bots: Difficulty[]) {
  const adult = h.svc.sessions.create("Host");
  const api = http(`eb_session=${adult.cookieToken}`, adult.session.csrf);
  const response = await api("/api/sparring", { bots });
  expect(response.status).toBe(201);
  const { roomCode: code } = await response.json() as { roomCode: string };
  return { api, code, adult, join: () => join(api, code) };
}
async function join(api: ReturnType<typeof http>, code: string): Promise<Room> {
  const response = await api("/api/join-ticket", { roomCode: code });
  expect(response.status).toBe(200);
  const t = await response.json() as { ticket: string; roomId: string };
  const room = await new Client(`ws://localhost:${h.port}`).joinById(t.roomId, { ticket: t.ticket, roomCode: code, protocolVersion: PROTOCOL_VERSION, contentHash: hash });
  room.onMessage("welcome", () => undefined); room.onMessage("actionResult", () => undefined); room.onMessage("combatEvent", () => undefined);
  await waitFor(() => players(room).size > 0);
  return room;
}
async function guest(owner: Awaited<ReturnType<typeof host>>) {
  const l = await owner.api("/api/sparring/link", { roomCode: owner.code });
  expect(l.status).toBe(201);
  const { token } = await l.json() as { token: string };
  const r = await http()("/api/sparring/redeem", { token, displayName: "Guest" });
  expect(r.status).toBe(201);
  const body = await r.json() as { csrfToken: string };
  return { api: http(r.headers.get("set-cookie")!.split(";")[0], body.csrfToken), token };
}
const live = (r: Room): SparringRoom => matchMaker.getLocalRoomById(r.roomId) as unknown as SparringRoom;
function place(room: SparringRoom, id: number, x: number, z: number) {
  const b = room.movement!.get(id)!;
  const pos = { x, y: (room.world!.groundHeight(x, z) ?? 0) + ARENA.capsule.centreAboveSurface, z };
  b.rb.setTranslation(pos, true); b.rb.setNextKinematicTranslation(pos);
  b.state.vx = b.state.vz = b.state.vy = 0;
}

test("HTTP schema/origin/CSRF, direct joins, duplicate tickets and ready bypass", async () => {
  const owner = await host(["easy"]);
  expect((await http()("/api/sparring", { bots: [] })).status).toBe(401);
  expect((await owner.api("/api/sparring", { bots: [], extra: 1 })).status).toBe(400);
  expect((await owner.api("/api/sparring", { bots: [] }, { origin: "https://foreign.invalid" })).status).toBe(403);
  expect((await owner.api("/api/sparring", { bots: [] }, { "x-csrf-token": "bad" })).status).toBe(403);
  const t1 = await (await owner.api("/api/join-ticket", { roomCode: owner.code })).json() as { roomId: string; ticket: string };
  const t2 = await (await owner.api("/api/join-ticket", { roomCode: owner.code })).json() as { roomId: string; ticket: string };
  expect(t1.roomId).toBe(t2.roomId);
  const sdk = new Client(`ws://localhost:${h.port}`);
  await expect(sdk.joinById(t1.roomId, { roomCode: owner.code })).rejects.toBeTruthy();
  const options = (ticket: string) => ({ ticket, roomCode: owner.code, protocolVersion: PROTOCOL_VERSION, contentHash: hash });
  const results = await Promise.allSettled([sdk.joinById(t1.roomId, options(t1.ticket)), sdk.joinById(t2.roomId, options(t2.ticket))]);
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  const r = (results.find(r => r.status === "fulfilled") as PromiseFulfilledResult<Room>).value;
  r.onMessage("welcome", () => undefined); r.onMessage("combatEvent", () => undefined);
  await waitFor(() => players(r).size === 2);
  expect([...players(r).values()].find(p => p.displayName === "Host").ready).toBe(false);
  r.send("ready", { kitId: "sv", contentHash: "0".repeat(16) });
  await sleep(100);
  expect([...players(r).values()].find(p => p.displayName === "Host").ready).toBe(false);
  await owner.api("/api/sparring/end", { roomCode: owner.code });
});

test("fresh guest scope, reservation capacity, single-use link and shared replication", async () => {
  const owner = await host(["medium", "hard"]);
  const a = await owner.join();
  const g = await guest(owner);
  expect((await g.api("/api/csrf")).status).toBe(401);
  expect((await g.api("/api/sparring", { bots: [] })).status).toBe(401);
  expect((await g.api("/api/join-ticket", { roomCode: "play" })).status).toBe(401);
  expect((await g.api("/api/sparring/end", { roomCode: owner.code })).status).toBe(401);
  expect((await http()("/api/sparring/redeem", { token: g.token, displayName: "Replay" })).status).toBe(401);
  expect((await owner.api("/api/sparring/link", { roomCode: owner.code })).status).toBe(409);
  expect((await g.api("/api/sparring/guest")).status).toBe(200);
  const b = await join(g.api, owner.code);
  a.send("ready", { kitId: "sv", contentHash: hash }); b.send("ready", { kitId: "td", contentHash: hash });
  await waitFor(() => players(a).size === 4 && players(b).size === 4 && [...players(a).values()].every(p => p.ready));
  expect([...players(a).values()].map(p => p.displayName)).toEqual(["Bot 1", "Bot 2", "Host", "Guest"]);
  expect(JSON.stringify([...players(b).values()].map(p => p.toJSON()))).not.toMatch(/token|ticket|authId|cookie/i);
  await b.leave();
  await waitFor(() => players(a).size === 3);
  expect((await g.api("/api/sparring/guest")).status).toBe(401);
  await owner.api("/api/sparring/end", { roomCode: owner.code });
});

test.each(["easy", "medium", "hard"] as const)("%s ordinary combat, interruption, one KO and respawn without score bleed", async tier => {
  const owner = await host([tier]); const a = await owner.join();
  const events: CombatEvent[] = []; a.onMessage("combatEvent", (e: CombatEvent) => events.push(e));
  a.send("ready", { kitId: "td", contentHash: hash });
  await waitFor(() => [...players(a).values()].every(p => p.ready));
  const room = live(a), bot = [...players(a).values()].find(p => p.displayName === "Bot 1")!.entityId as number;
  const human = [...players(a).values()].find(p => p.displayName === "Host")!.entityId as number;
  await waitFor(() => room.sim.tick > room.combat.get(human)!.protectedUntilTick + 2, 4000);
  place(room, bot, 0, 0); place(room, human, 0, -1.5);
  room.combat.get(human)!.hp100 = 100;
  applyReaction(room.combat.get(bot)!, room.sim.tick, { kind: "stun", ticks: 40 }, false);
  const start = room.sim.tick;
  await sleep(250);
  expect(events.some(e => e.kind === "cast" && e.actorId === String(bot) && e.tick >= start)).toBe(false);
  await waitFor(() => events.some(e => e.kind === "ko" && e.targetId === String(human)), 4000, "bot KO");
  await waitFor(() => players(a).get(String(bot)).kills === 1 && players(a).get(String(human)).deaths === 1);
  expect(events.filter(e => e.kind === "ko" && e.targetId === String(human))).toHaveLength(1);
  const ko = events.find(e => e.kind === "ko" && e.targetId === String(human))!;
  await waitFor(() => events.some(e => e.kind === "respawn" && e.targetId === String(human)), 5000);
  const rs = events.find(e => e.kind === "respawn" && e.targetId === String(human))!;
  expect(rs.tick - ko.tick).toBe(180);
  expect(rs.lifeId).not.toBe(ko.lifeId);
  const ordinary = await loginClient(h, "Ordinary"); const ffa = await ordinary.join("other");
  await waitFor(() => players(ffa).size === 1);
  expect([...players(ffa).values()][0].kills).toBe(0);
  await ordinary.leave();
  expect(room.combat.invariantViolations()).toEqual([]);
  await owner.api("/api/sparring/end", { roomCode: owner.code });
}, 15000);

test("host reconnect retains membership, explicit end closes guests and permits rehost", async () => {
  const owner = await host([]), a = await owner.join(), g = await guest(owner), b = await join(g.api, owner.code);
  let closed = false; b.onLeave(() => { closed = true; });
  const token = a.reconnectionToken;
  a.reconnection.enabled = false; a.connection.close(4010, "test drop");
  await waitFor(() => [...players(b).values()].some(p => p.displayName === "Host" && !p.connected));
  const again = await new Client(`ws://localhost:${h.port}`).reconnect(token);
  again.onMessage("welcome", () => undefined); again.onMessage("combatEvent", () => undefined);
  await waitFor(() => [...players(b).values()].every(p => p.connected));
  expect((await owner.api("/api/sparring/end", { roomCode: owner.code })).status).toBe(204);
  await waitFor(() => closed);
  expect((await g.api("/api/sparring/guest")).status).toBe(401);
  expect((await owner.api("/api/sparring", { bots: ["easy"] })).status).toBe(201);
});

test("revocation closes a match without connected clients", async () => {
  const owner = await host(["easy"]), a = await owner.join();
  a.reconnection.enabled = false; a.connection.close(4010, "test drop");
  await sleep(100);
  h.svc.sessions.revoke(owner.adult.cookieToken);
  await waitFor(() => matchMaker.getLocalRoomById(a.roomId) === undefined, 3000, "independent sweep disposed room");
  expect(h.svc.sparring.describe(owner.code)).toBeNull();
});

test("real colliders stop voluntary approach at an edge and obstacle; bot life resets on respawn", async () => {
  const owner = await host(["easy"]), a = await owner.join();
  a.send("ready", { kitId: "td", contentHash: hash });
  await waitFor(() => [...players(a).values()].every(p => p.ready));
  const room = live(a), bot = [...players(a).values()].find(p => p.displayName === "Bot 1")!.entityId as number;
  const human = [...players(a).values()].find(p => p.displayName === "Host")!.entityId as number;
  room.setSimulationInterval(() => undefined, 1000);
  let tick = room.sim.tick;
  // At the unguarded north lip; target is on disconnected ground, so no path is attempted.
  place(room, bot, 10, -19.5); place(room, human, 10, -35);
  for (let i = 0; i < 180; i++) room.stepTick(++tick);
  expect(room.movement!.position(bot)![2]).toBeGreaterThan(-19.7);
  expect(room.combat.get(bot)!.action).not.toBe("Dead");
  // Pillar blocks the direct route. GR13 routes around it in later ticks; within 120 ticks the bot has only begun to sidestep, and it never teleports.
  place(room, bot, 12, -7.5); place(room, human, 12, -13);
  for (let i = 0; i < 120; i++) room.stepTick(++tick);
  expect(room.movement!.position(bot)![2]).toBeGreaterThan(-8.6);
  const oldLife = room.combat.get(bot)!.lifeId;
  const b = room.movement!.get(bot)!;
  b.rb.setTranslation({ x: 0, y: -30, z: 0 }, true); b.rb.setNextKinematicTranslation({ x: 0, y: -30, z: 0 });
  room.stepTick(++tick);
  const death = tick;
  expect(room.combat.get(bot)!.action).toBe("Dead");
  for (let i = 0; i < 180; i++) room.stepTick(++tick);
  expect(room.combat.get(bot)!.lifeId).not.toBe(oldLife);
  expect(tick - death).toBe(180);
  place(room, bot, 0, 0); place(room, human, 0, -1.5);
  for (let i = 0; i < 29; i++) room.stepTick(++tick);
  expect(room.combat.get(bot)!.action).toBe("Idle");
  room.stepTick(++tick);
  expect(room.combat.get(bot)!.action).toBe("Windup");
  await waitFor(() => players(a).get(String(bot)).lifeId === room.combat.get(bot)!.lifeId);
  expect(players(a).get(String(bot)).deaths).toBe(1);
  await owner.api("/api/sparring/end", { roomCode: owner.code });
});

test("wall-time expiry closes unjoined and dropped hosts; expired links and guest reservations fail", async () => {
  const { SparringDirectory } = await import("../../apps/server/src/auth/SparringDirectory.js");
  const original = h.svc.sparring;
  let now = Date.now();
  h.svc.sparring = new SparringDirectory(id => h.svc.sessions.getById(id) !== null, () => now);
  try {
    const neverJoined = await host([]);
    now += 60_000;
    expect((await neverJoined.api("/api/join-ticket", { roomCode: neverJoined.code })).status).toBe(401);
    const owner = await host(["easy", "medium"]), a = await owner.join();
    const link = await owner.api("/api/sparring/link", { roomCode: owner.code });
    const { token } = await link.json() as { token: string };
    now += 600_000;
    expect((await http()("/api/sparring/redeem", { token, displayName: "Expired" })).status).toBe(401);
    const g = await guest(owner);
    now += 60_000;
    expect((await g.api("/api/sparring/guest")).status).toBe(401);
    const fresh = await guest(owner);
    expect((await fresh.api("/api/sparring/guest")).status).toBe(200);
    a.reconnection.enabled = false; a.connection.close(4010, "test drop");
    await waitFor(() => ![...live(a).state.players.values()].find(p => p.displayName === "Host")!.connected);
    now += 20_000;
    await waitFor(() => matchMaker.getLocalRoomById(a.roomId) === undefined, 3000, "grace sweep");
    expect((await fresh.api("/api/sparring/guest")).status).toBe(401);
  } finally { h.svc.sparring = original; }
});

test("QA01: simultaneous hits, reconnect during a cast, KO agreement, guest leave/rejoin and a clean rematch", async () => {
  const owner = await host([]), a = await owner.join(), g = await guest(owner), b = await join(g.api, owner.code);
  a.send("ready", { kitId: "sv", contentHash: hash }); b.send("ready", { kitId: "td", contentHash: hash });
  await waitFor(() => players(a).size === 2 && [...players(a).values()].every(p => p.ready) && [...players(b).values()].every(p => p.ready));
  const room = live(a);
  const idOf = (r: Room, name: string) => [...players(r).values()].find(p => p.displayName === name)!.entityId as number;
  const hostId = idOf(a, "Host"), guestId = idOf(a, "Guest");
  await waitFor(() => [...room.combat.all()].every(f => room.sim.tick > f.protectedUntilTick + 2), 6000, "spawn protection");
  const seqs = new Map<Room, number>();
  const press = async (r: Room, held: boolean, ms = 0) => {
    const yaw = r === b ? Math.PI : 0; // guest faces the host (+Z), host faces -Z
    const epoch = (live(r) as unknown as { seats: Map<string, { input: { epoch: number } }> }).seats.get(r.sessionId)!.input.epoch;
    const t0 = Date.now();
    do {
      const seq = (seqs.get(r) ?? 0) + 1; seqs.set(r, seq);
      r.send("input", { v: 1, epoch, seq, sampleTick: 0, moveX: 0, moveZ: 0, yaw, pitch: 0, attackHeld: held, blockHeld: false, jumpHeld: false, runHeld: false, chargeHeldSlot: 0, edges: [] });
      if (ms) await sleep(33);
    } while (Date.now() - t0 < ms);
  };
  const face = (id: number, yaw: number) => { room.movement!.get(id)!.state.facingYaw = yaw; };
  // Simultaneous hits: both start the same M1 on the same tick, facing each other.
  place(room, hostId, 0, 0); place(room, guestId, 0, -1.5); face(hostId, 0); face(guestId, Math.PI);
  await Promise.all([press(a, false, 300), press(b, false, 300)]); // settle facing first
  await press(a, true); await press(b, true); // back to back: both casts start within the same tick or the next
  // Spec: a same-tick tie resolves by the damage resolver order and trades are not promised, so exactly one side lands.
  await waitFor(() => players(a).get(String(hostId)).hp100 < 10000 || players(a).get(String(guestId)).hp100 < 10000, 4000, "one hit landed");
  await sleep(300);
  const hp = (r: Room) => [hostId, guestId].map(i => players(r).get(String(i)).hp100);
  expect(hp(a).filter(v => v < 10000)).toHaveLength(1);
  expect(hp(b)).toEqual(hp(a));
  expect(room.combat.invariantViolations()).toEqual([]);
  await press(a, false); await press(b, false);
  await waitFor(() => room.combat.get(hostId)!.action === "Idle" && room.combat.get(guestId)!.action === "Idle", 4000, "recovered");
  // Reconnect during a cast: the host's socket drops mid-cast; the cast still resolves on the server and the seat is retained.
  const hpBefore = players(b).get(String(guestId)).hp100 as number;
  place(room, hostId, 0, 0); place(room, guestId, 0, -1.5); face(hostId, 0); face(guestId, Math.PI);
  await press(a, true);
  await waitFor(() => room.combat.get(hostId)!.action !== "Idle", 2000, "cast begun");
  const token = a.reconnectionToken;
  a.reconnection.enabled = false; a.connection.close(4010, "drop mid-cast");
  await waitFor(() => [...players(b).values()].some(p => p.displayName === "Host" && !p.connected));
  const again = await new Client(`ws://localhost:${h.port}`).reconnect(token);
  again.onMessage("welcome", () => undefined); again.onMessage("combatEvent", () => undefined);
  await waitFor(() => [...players(b).values()].every(p => p.connected), 4000, "host connected again");
  await waitFor(() => players(b).get(String(guestId)).hp100 < hpBefore, 4000, "mid-cast hit landed");
  expect(idOf(again, "Host")).toBe(hostId); // same seat, no duplicate fighter
  expect(players(b).size).toBe(2);
  // KO agreement: both clients read the same score.
  room.combat.get(guestId)!.hp100 = 100;
  await waitFor(() => room.combat.get(hostId)!.action === "Idle", 4000, "host idle");
  place(room, hostId, 0, 0); place(room, guestId, 0, -1.5); face(hostId, 0); face(guestId, Math.PI);
  await press(again, true, 1500); await press(again, false);
  await waitFor(() => players(b).get(String(guestId)).deaths === 1 && players(again).get(String(hostId)).kills === 1, 4000, "KO replicated");
  const score = (r: Room) => [...players(r).values()].map(p => [p.displayName, p.kills, p.deaths]);
  expect(score(again)).toEqual(score(b));
  // Guest leaves and a fresh single-use link admits a fresh guest with no carried score.
  await b.leave();
  await waitFor(() => players(again).size === 1);
  expect((await g.api("/api/sparring/guest")).status).toBe(401);
  const g2 = await guest(owner), c = await join(g2.api, owner.code);
  c.send("ready", { kitId: "td", contentHash: hash });
  await waitFor(() => players(again).size === 2);
  const fresh = [...players(again).values()].find(p => p.displayName === "Guest")!;
  expect([fresh.kills, fresh.deaths, fresh.hp100]).toEqual([0, 0, 10000]);
  // Host ends; the old guest scope is dead and the same two players start a new match with zero scores.
  expect((await owner.api("/api/sparring/end", { roomCode: owner.code })).status).toBe(204);
  expect((await g2.api("/api/sparring/guest")).status).toBe(401);
  const next = await owner.api("/api/sparring", { bots: [] });
  expect(next.status).toBe(201);
  const { roomCode } = await next.json() as { roomCode: string };
  expect(roomCode).not.toBe(owner.code);
  const a2 = await join(owner.api, roomCode);
  expect([...players(a2).values()].every(p => p.kills === 0 && p.deaths === 0)).toBe(true);
  await owner.api("/api/sparring/end", { roomCode });
}, 40000);
