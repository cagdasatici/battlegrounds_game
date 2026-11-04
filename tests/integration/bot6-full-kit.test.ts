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

/** GR14 capability scenario (not proof the bots are fun or equally difficult): controlled distances, real client, manual ticks. */
test("GR14: hard bots charge the orb, beam from range, counter only during an attack, cast three moves per kit, leave no stale hold", async () => {
  const adult = h.svc.sessions.create("Host14");
  const headers = { origin: h.origin, cookie: `eb_session=${adult.cookieToken}`, "x-csrf-token": adult.session.csrf, "content-type": "application/json" };
  const created = await fetch(`${h.origin}/api/sparring`, { method: "POST", headers, body: JSON.stringify({ bots: ["hard", "hard", "hard"] }) });
  const { roomCode } = await created.json() as { roomCode: string };
  const t = await (await fetch(`${h.origin}/api/join-ticket`, { method: "POST", headers, body: JSON.stringify({ roomCode }) })).json() as { ticket: string; roomId: string };
  const room: Room = await new Client(`ws://localhost:${h.port}`).joinById(t.roomId, { ticket: t.ticket, roomCode, protocolVersion: PROTOCOL_VERSION, contentHash: hash });
  room.onMessage("welcome", () => undefined); room.onMessage("actionResult", () => undefined); room.onMessage("combatEvent", () => undefined);
  await waitFor(() => players(room).size === 4);
  room.send("ready", { kitId: "sv", contentHash: hash });
  await waitFor(() => [...players(room).values()].every(p => p.ready));
  const live = matchMaker.getLocalRoomById(room.roomId) as unknown as SparringRoom;
  live.setSimulationInterval(() => undefined, 1000);
  const all = [...players(room).values()];
  const botOf = (kit: string) => all.find(p => /^Bot /.test(p.displayName as string) && p.kitId === kit)!.entityId as number;
  const humanId = all.find(p => p.displayName === "Host14")!.entityId as number;
  const [sv, td, ea] = [botOf("sv"), botOf("td"), botOf("ea")];
  const place = (id: number, x: number, z: number, yaw?: number) => {
    // Let ragdoll and stun physics run; teleporting every tick would pin a fighter in them.
    const a = live.combat.get(id)?.action;
    if (a === "Ragdolled" || a === "Stunned" || a === "Captured") return;
    const b = live.movement!.get(id)!;
    const pos = { x, y: (live.world!.groundHeight(x, z) ?? 0) + ARENA.capsule.centreAboveSurface, z };
    b.rb.setTranslation(pos, true); b.rb.setNextKinematicTranslation(pos);
    b.state.vx = b.state.vz = b.state.vy = 0;
    if (yaw !== undefined) b.state.facingYaw = yaw;
  };
  let tick = live.sim.tick;
  const casts: Array<{ id: number; moveId: string; distance: number }> = [];
  const seen = new Map<number, number>();
  const stepOnce = (active: number, others: number[], act: [number, number], foe: [number, number], opts: { foeAttacks?: boolean } = {}) => {
    // Park idle bots on the east satellite; keep the human alive and in place.
    others.forEach((id, i) => place(id, 38, -3 + 3 * i));
    place(active, act[0], act[1]);
    place(humanId, foe[0], foe[1], Math.atan2(-(act[0] - foe[0]), -(act[1] - foe[1])));
    const hf = live.combat.get(humanId)!;
    for (const id of [active, ...others, humanId]) { const f = live.combat.get(id); if (f && f.hp100 > 0) f.hp100 = 10000; }
    if (opts.foeAttacks) hf.action = "Active";
    live.stepTick(++tick);
    for (const id of [active]) {
      const f = live.combat.get(id);
      if (f && f.cast && seen.get(id) !== f.castCounter) {
        seen.set(id, f.castCounter);
        const p = live.movement!.position(id)!, q = live.movement!.position(humanId)!;
        casts.push({ id, moveId: f.cast.moveId, distance: Math.hypot(p[0] - q[0], p[2] - q[2]) });
      }
    }
  };
  const botSeat = (id: number) => (live as unknown as { bots: Map<string, { input: { held: { chargeHeldSlot: number } } }> }).bots.get(`bot:${id}`)!;

  // 1. Ember Orb at 10 m: a charge held for the hard release time (<= 186 ticks).
  let chargeRun = 0, longestCharge = 0;
  for (let i = 0; i < 700; i++) {
    stepOnce(ea, [sv, td], [0, 5], [0, -5]);
    if (live.abilities.chargeStartOf(ea) > 0) { chargeRun++; longestCharge = Math.max(longestCharge, chargeRun); } else chargeRun = 0;
  }
  expect(casts.some(c => c.id === ea && c.moveId === "ea.b3" && c.distance >= 5)).toBe(true);
  expect(longestCharge).toBeGreaterThanOrEqual(150);
  expect(longestCharge).toBeLessThanOrEqual(186);

  // 2. Awakened Ember casts a beam or comet from more than 6 m.
  const ef = live.combat.get(ea)!;
  ef.form = "Awakened"; ef.formEndTick = tick + 5000; ef.awakenedUsedMask = 0;
  const before = casts.length;
  for (let i = 0; i < 700; i++) stepOnce(ea, [sv, td], [0, 6], [0, -6]);
  expect(casts.slice(before).some(c => c.id === ea && /^ea\.a[34]$/.test(c.moveId) && c.distance > 6), JSON.stringify(casts.slice(before))).toBe(true);

  // 3. Duelist counters only while the rival is attacking and facing it.
  const tdBefore = casts.length;
  for (let i = 0; i < 400; i++) stepOnce(td, [sv, ea], [0, 1.5], [0, -0.5]);
  expect(casts.slice(tdBefore).some(c => c.moveId === "td.b4")).toBe(false);
  const armed = casts.length;
  for (let i = 0; i < 240; i++) {
    stepOnce(td, [sv, ea], [0, 1.5], [0, -0.5], { foeAttacks: true });
    live.combat.get(humanId)!.action = "Idle";
  }
  expect(casts.slice(armed).some(c => c.moveId === "td.b4"), JSON.stringify(casts.slice(armed))).toBe(true);

  // 4. At least three distinct moves per kit across the scenario above plus a Vanguard run.
  for (let i = 0; i < 1200; i++) { stepOnce(sv, [td, ea], [0, 1.5], [0, -0.5]); }
  const distinct = (id: number) => new Set(casts.filter(c => c.id === id).map(c => c.moveId)).size;
  expect(distinct(sv)).toBeGreaterThanOrEqual(3);
  expect(distinct(td)).toBeGreaterThanOrEqual(3);
  expect(distinct(ea)).toBeGreaterThanOrEqual(3);

  // 5. Death mid-charge leaves no stale hold or charge state.
  live.combat.get(ea)!.form = "Base";
  let charging = false;
  for (let i = 0; i < 400 && !charging; i++) { stepOnce(ea, [sv, td], [0, 5], [0, -5]); charging = live.abilities.chargeStartOf(ea) > 0; }
  expect(charging).toBe(true);
  expect(live.combat.kill(ea, tick)).toBe(true);
  stepOnce(ea, [sv, td], [0, 5], [0, -5]);
  expect(live.abilities.chargeStartOf(ea)).toBe(0);
  expect(botSeat(ea).input.held.chargeHeldSlot).toBe(0);
  await fetch(`${h.origin}/api/sparring/end`, { method: "POST", headers, body: JSON.stringify({ roomCode }) });
}, 120000);
