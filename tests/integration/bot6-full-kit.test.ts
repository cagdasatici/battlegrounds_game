import { afterAll, beforeAll, expect, test } from "vitest";
import { Client, type Room } from "@colyseus/sdk";
import { matchMaker } from "colyseus";
import { startHarness, waitFor, players, type Harness } from "../fixtures/harness.js";
import { computeContentHash } from "../../packages/shared/src/config/content.js";
import { PROTOCOL_VERSION, type CombatEvent } from "../../packages/shared/src/protocol.js";
import { ARENA } from "../../packages/shared/src/config/arena.js";
import type { SparringRoom } from "../../apps/server/src/rooms/SparringRoom.js";

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h.stop(); });
const hash = computeContentHash();
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

test("BOT6: three hard bots rotate kits and use dash and several skills without stuck actions", async () => {
  const adult = h.svc.sessions.create("Host");
  const headers = { origin: h.origin, cookie: `eb_session=${adult.cookieToken}`, "x-csrf-token": adult.session.csrf, "content-type": "application/json" };
  const created = await fetch(`${h.origin}/api/sparring`, { method: "POST", headers, body: JSON.stringify({ bots: ["hard", "hard", "hard"] }) });
  expect(created.status).toBe(201);
  const { roomCode } = await created.json() as { roomCode: string };
  const ticketRes = await fetch(`${h.origin}/api/join-ticket`, { method: "POST", headers, body: JSON.stringify({ roomCode }) });
  const t = await ticketRes.json() as { ticket: string; roomId: string };
  const room: Room = await new Client(`ws://localhost:${h.port}`).joinById(t.roomId, { ticket: t.ticket, roomCode, protocolVersion: PROTOCOL_VERSION, contentHash: hash });
  const events: CombatEvent[] = [];
  room.onMessage("welcome", () => undefined); room.onMessage("actionResult", () => undefined);
  room.onMessage("combatEvent", (e: CombatEvent) => events.push(e));
  await waitFor(() => players(room).size === 4);
  room.send("ready", { kitId: "sv", contentHash: hash });
  await waitFor(() => [...players(room).values()].every(p => p.ready));

  // 1. Kits rotate sv, td, ea.
  const bots = [...players(room).values()].filter(p => /^Bot /.test(p.displayName as string))
    .sort((a, b) => (a.displayName as string).localeCompare(b.displayName as string));
  expect(bots.map(b => b.kitId)).toEqual(["sv", "td", "ea"]);

  // 2. 3,600 manual ticks (60 s) with the human idle.
  const live = matchMaker.getLocalRoomById(room.roomId) as unknown as SparringRoom;
  live.setSimulationInterval(() => undefined, 1000);
  const ids = bots.map(b => b.entityId as number);
  let tick = live.sim.tick;
  const run = new Map<number, { action: string; since: number }>();
  const longest = new Map<number, number>();
  let dashSeen = false;
  // Bots have no map-wide routing (see sparring.test.ts), so keep every fighter on the central island.
  const spots: Array<[number, number]> = [[-2.5, 0], [2.5, 0], [0, 2.5]];
  const place = (id: number, x: number, z: number) => {
    const b = live.movement!.get(id)!;
    const pos = { x, y: (live.world!.groundHeight(x, z) ?? 0) + ARENA.capsule.centreAboveSurface, z };
    b.rb.setTranslation(pos, true); b.rb.setNextKinematicTranslation(pos);
    b.state.vx = b.state.vz = b.state.vy = 0;
  };
  const humanId = [...players(room).values()].find(p => p.displayName === "Host")!.entityId as number;
  const lives = new Map<number, number>();
  place(humanId, 0, -3);
  for (let i = 0; i < 3600; i++) {
    live.stepTick(++tick);
    ids.forEach((id, n) => {
      const f = live.combat.get(id);
      if (f && lives.get(id) !== f.lifeId) { lives.set(id, f.lifeId); place(id, ...spots[n]!); }
    });
    for (const id of ids) {
      const a = live.combat.get(id)?.action ?? "Dead";
      if (a === "Dash") dashSeen = true;
      const prev = run.get(id);
      if (!prev || prev.action !== a) run.set(id, { action: a, since: tick });
      const busy = ["Windup", "Active", "Recovery", "Channel", "Charge"].includes(a);
      if (busy) longest.set(id, Math.max(longest.get(id) ?? 0, tick - run.get(id)!.since));
    }
  }
  await sleep(300);
  for (const b of bots) {
    const moves = new Set(events.filter(e => e.kind === "cast" && e.actorId === String(b.entityId)).map(e => e.moveId));
    expect(moves.size, `${b.kitId} distinct moves: ${[...moves].join(",")}`).toBeGreaterThanOrEqual(3);
  }
  // Dash is observable as ActionMachine action "Dash".
  expect(dashSeen).toBe(true);
  // 3. No bot stays in one casting action for more than 600 ticks.
  for (const id of ids) expect(longest.get(id) ?? 0).toBeLessThanOrEqual(600);
  await fetch(`${h.origin}/api/sparring/end`, { method: "POST", headers, body: JSON.stringify({ roomCode }) });
}, 60000);
