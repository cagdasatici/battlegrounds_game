import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Client, type Room } from "@colyseus/sdk";
import { matchMaker } from "colyseus";
import { startHarness, waitFor, players, freshCode, loginClient, type Harness } from "../fixtures/harness.js";
import { computeContentHash } from "../../packages/shared/src/config/content.js";
import {
  JoinOptionsSchema, PROTOCOL_VERSION, ROUND_OVER_TICKS, type CombatEvent, type RoundOverMessage,
} from "../../packages/shared/src/protocol.js";
import { ARENA } from "../../packages/shared/src/config/arena.js";
import { AdminRoomCreateSchema } from "../../packages/shared/src/admin.js";
import { SparringCreateRequestSchema } from "../../packages/shared/src/sparring.js";
import type { SparringRoom } from "../../apps/server/src/rooms/SparringRoom.js";
import type { BotArenaRoom } from "../../apps/server/src/rooms/BotArenaRoom.js";

// MODE01 (decision 0054): real HTTP + real Colyseus client; the clock is stepped by hand so every tick number is exact.
let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h.stop(); });
const hash = computeContentHash();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Rig { room: Room; live: SparringRoom; events: CombatEvent[]; over: RoundOverMessage[]; humanId: number; botId: number; step(): number; now(): number }
async function rig(roundTarget: number | undefined): Promise<Rig> {
  const adult = h.svc.sessions.create(`Host${Math.floor(Math.random() * 1e6)}`);
  const headers = { origin: h.origin, cookie: `eb_session=${adult.cookieToken}`, "x-csrf-token": adult.session.csrf, "content-type": "application/json" };
  const body: Record<string, unknown> = { bots: ["easy"] };
  if (roundTarget !== undefined) body["roundTarget"] = roundTarget;
  const created = await fetch(`${h.origin}/api/sparring`, { method: "POST", headers, body: JSON.stringify(body) });
  expect(created.status).toBe(201);
  const { roomCode } = await created.json() as { roomCode: string };
  const t = await (await fetch(`${h.origin}/api/join-ticket`, { method: "POST", headers, body: JSON.stringify({ roomCode }) })).json() as { ticket: string; roomId: string };
  const room: Room = await new Client(`ws://localhost:${h.port}`).joinById(t.roomId, { ticket: t.ticket, roomCode, protocolVersion: PROTOCOL_VERSION, contentHash: hash });
  const events: CombatEvent[] = [], over: RoundOverMessage[] = [];
  room.onMessage("welcome", () => undefined); room.onMessage("actionResult", () => undefined);
  room.onMessage("combatEvent", (e: CombatEvent) => events.push(e));
  room.onMessage("roundOver", (m: RoundOverMessage) => over.push(m));
  await waitFor(() => players(room).size === 2);
  room.send("ready", { kitId: "sv", contentHash: hash });
  await waitFor(() => [...players(room).values()].every((p) => p.ready));
  const live = matchMaker.getLocalRoomById(room.roomId) as unknown as SparringRoom;
  live.setSimulationInterval(() => undefined, 1000); // manual ticks from here on
  let tick = live.sim.tick;
  const humanId = [...players(room).values()].find((p) => !/^Bot /.test(p.displayName as string))!.entityId as number;
  const botId = [...players(room).values()].find((p) => /^Bot /.test(p.displayName as string))!.entityId as number;
  const place = (id: number, x: number, z: number): void => {
    const b = live.movement!.get(id)!;
    const pos = { x, y: (live.world!.groundHeight(x, z) ?? 0) + ARENA.capsule.centreAboveSurface, z };
    b.rb.setTranslation(pos, true); b.rb.setNextKinematicTranslation(pos); b.state.vx = b.state.vy = b.state.vz = 0;
  };
  place(humanId, 0, -3); place(botId, 2.5, 0);
  for (let i = 0; i < 200; i++) live.stepTick(++tick); // spawn protection and grounding settle
  return { room, live, events, over, humanId, botId, now: () => tick, step: () => { live.stepTick(++tick); return tick; } };
}

/** A real server-side knockout: the human damages the bot, then the bot leaves the void plane (ring-out credits the human). */
function ringOutBot(r: Rig): number {
  r.live.respawns.recordDamage(r.humanId, r.botId, r.now(), 2000);
  const b = r.live.movement!.get(r.botId)!;
  const pos = { x: 0, y: ARENA.voidY - 5, z: 0 };
  b.rb.setTranslation(pos, true); b.rb.setNextKinematicTranslation(pos);
  return r.step();
}
const state = (r: Rig, id: number) => r.live.state.players.get(String(id))!;

describe("MODE01 first-to-N rounds over a real hosted sparring room", () => {
  test("target reached flips the phase on that tick, freezes inputs and damage, then resets scores and respawns everyone", async () => {
    const r = await rig(5);
    expect(r.live.roundTarget).toBe(5);
    const human = state(r, r.humanId);
    human.kills = 4; // earlier KOs of this round
    expect(r.live.state.phase).toBe("playing");

    // Fifth KO by the real scoring path: the phase changes on exactly that tick.
    const koTick = ringOutBot(r);
    expect(human.kills).toBe(5);
    expect(r.live.state.phase).toBe("roundOver");
    await waitFor(() => r.over.length === 1 && r.room.state.phase === "roundOver", 3000, "roundOver delivered");
    expect(r.over[0]).toMatchObject({ tick: koTick, roundTarget: 5, resumesAtTick: koTick + ROUND_OVER_TICKS });
    expect(r.over[0]!.standings[0]).toMatchObject({ entityId: r.humanId, kills: 5 });
    expect(r.over[0]!.standings).toHaveLength(2);

    // Inputs during roundOver: attack hold and a skill edge from the real client do nothing; no damage events.
    const before = r.events.length;
    const hp = [state(r, r.humanId).hp100, state(r, r.botId).hp100];
    const epoch = (r.live as unknown as { seats: Map<string, { input: { epoch: number } }> }).seats.values().next().value!.input.epoch;
    for (let i = 1; i <= 20; i++) {
      r.room.send("input", { v: 1, epoch, seq: i, sampleTick: 0, moveX: 1, moveZ: 0, yaw: 0, pitch: 0, attackHeld: true, blockHeld: false,
        jumpHeld: false, runHeld: false, chargeHeldSlot: 0, edges: [{ id: i, kind: "skillDown", slot: 1 }] });
      await sleep(5);
    }
    const posBefore = r.live.movement!.position(r.humanId)!.slice();
    const frozen = (): string => { const f = r.live.combat.get(r.humanId)!; return `${f.action}@${f.actionStartTick}`; };
    const frozenAtKo = frozen(); // the sim is frozen: whatever the fighter was doing at the KO tick is untouched, nothing new starts
    let t = koTick;
    while (t < koTick + ROUND_OVER_TICKS - 1) { t = r.step(); expect(r.live.state.phase).toBe("roundOver"); expect(frozen()).toBe(frozenAtKo); }
    await sleep(150);
    expect(r.events.slice(before).filter((e) => e.kind !== "respawn")).toEqual([]);
    expect([state(r, r.humanId).hp100, state(r, r.botId).hp100]).toEqual(hp);
    expect(r.live.movement!.position(r.humanId)).toEqual(posBefore);

    // Tick koTick+600: scores reset, everyone alive on a new life, phase back to playing.
    const lifeBefore = [state(r, r.humanId).lifeId, state(r, r.botId).lifeId];
    expect(r.step()).toBe(koTick + ROUND_OVER_TICKS);
    expect(r.live.state.phase).toBe("playing");
    for (const id of [r.humanId, r.botId]) {
      const p = state(r, id);
      expect([p.kills, p.deaths, p.assists]).toEqual([0, 0, 0]);
      expect(r.live.combat.get(id)!.action).toBe("Idle");
      expect(p.hp100).toBe(10000);
    }
    expect(state(r, r.humanId).lifeId).not.toBe(lifeBefore[0]);
    expect(state(r, r.botId).lifeId).not.toBe(lifeBefore[1]);
    await waitFor(() => r.room.state.phase === "playing" && [...players(r.room).values()].every((p) => p.kills === 0 && p.deaths === 0), 3000, "reset replicated");
    expect(r.events.filter((e) => e.kind === "respawn" && e.tick === koTick + ROUND_OVER_TICKS)).toHaveLength(2);
    // The next round can end again (the room is not wedged).
    for (let i = 0; i < 130; i++) r.step(); // spawn protection ends
    human.kills = 4;
    ringOutBot(r);
    expect(r.live.state.phase).toBe("roundOver");
    r.room.leave();
  });

  test("roundTarget 0 (default) never ends a round", async () => {
    const r = await rig(undefined);
    expect(r.live.roundTarget).toBe(0);
    state(r, r.humanId).kills = 40;
    ringOutBot(r);
    for (let i = 0; i < 30; i++) r.step();
    expect(r.live.state.phase).toBe("playing");
    expect(r.over).toHaveLength(0);
    r.room.leave();
  });
});

describe("MODE01 open FFA stays endless", () => {
  test("strict schemas: join options refuse roundTarget, admin refuses it without bots, sparring accepts only 0, 5, 10", () => {
    const join = { roomCode: "x", ticket: "a".repeat(64), protocolVersion: PROTOCOL_VERSION, contentHash: hash };
    expect(JoinOptionsSchema.safeParse(join).success).toBe(true);
    expect(JoinOptionsSchema.safeParse({ ...join, roundTarget: 5 }).success).toBe(false);
    expect(AdminRoomCreateSchema.safeParse({ name: "Open", roundTarget: 5 }).success).toBe(false);
    expect(AdminRoomCreateSchema.safeParse({ name: "Open", bots: ["easy"], roundTarget: 5 }).success).toBe(true);
    expect(AdminRoomCreateSchema.parse({ name: "Open" }).roundTarget).toBe(0);
    for (const bad of [1, 7, -5, "5"]) expect(SparringCreateRequestSchema.safeParse({ bots: [], roundTarget: bad }).success).toBe(false);
    for (const ok of [0, 5, 10]) expect(SparringCreateRequestSchema.safeParse({ bots: [], roundTarget: ok }).success).toBe(true);
  });

  test("an arena room without bots ignores a roundTarget in its metadata and never ends a round", async () => {
    const code = freshCode();
    h.svc.roomMeta.set(code, { name: "Open", listed: true, roundTarget: 5 });
    const room = await matchMaker.createRoom("arena", { roomCode: code });
    const live = matchMaker.getLocalRoomById(room.roomId) as unknown as BotArenaRoom;
    expect(live.roundTarget).toBe(0);
    h.svc.roomMeta.delete(code);
    await live.disconnect();
  });

  test("an admin bot room takes its roundTarget from the room metadata", async () => {
    const code = freshCode();
    h.svc.roomMeta.set(code, { name: "Bots", listed: true, bots: ["easy"], roundTarget: 10 });
    const room = await matchMaker.createRoom("arena", { roomCode: code });
    const live = matchMaker.getLocalRoomById(room.roomId) as unknown as BotArenaRoom;
    expect(live.roundTarget).toBe(10);
    h.svc.roomMeta.delete(code);
    await live.disconnect();
  });
});

// GR08: durable round state replicated to every client; the roundOver message is only a transient cue.
describe("GR08 durable round state over real clients", () => {
  test("a late joiner and a reconnecting client see the frozen standings and deadline from state alone; the winner leaving does not rewrite them; reset lands at exactly +600", async () => {
    const code = freshCode();
    h.svc.roomMeta.set(code, { name: "Bots", listed: true, bots: ["easy"], roundTarget: 5 });
    const a = await loginClient(h, "Winner"), b = await loginClient(h, "Watcher");
    const ra = await a.join(code), rb = await b.join(code);
    const live = matchMaker.getLocalRoomById(ra.roomId) as unknown as BotArenaRoom;
    for (const r of [ra, rb]) r.send("ready", { kitId: "sv", contentHash: hash });
    await waitFor(() => [...players(rb).values()].filter((p) => p.ready).length >= 2, 3000, "humans ready");
    live.setSimulationInterval(() => undefined, 1000); // manual ticks from here on
    expect(rb.state.roundTarget).toBe(5);
    expect(rb.state.roundNumber).toBe(1);
    expect(rb.state.roundEndsAtTick).toBe(0);
    expect(rb.state.roundStandings.length).toBe(0);

    let tick = live.sim.tick;
    const winner = [...live.state.players.values()].find((p) => p.displayName === "Winner")!;
    winner.kills = 5; winner.deaths = 1;
    live.stepTick(++tick);
    const koTick = tick;
    expect(live.state.phase).toBe("roundOver");
    expect(live.state.roundEndsAtTick).toBe(koTick + ROUND_OVER_TICKS);
    await waitFor(() => rb.state.phase === "roundOver" && rb.state.roundStandings.length > 0, 3000, "results replicated");
    const snapshot = (room: Room): unknown => ({
      phase: room.state.phase, target: room.state.roundTarget, ends: room.state.roundEndsAtTick, n: room.state.roundNumber,
      rows: [...room.state.roundStandings].map((s: { entityId: number; displayName: string; kills: number; deaths: number; assists: number }) => [s.entityId, s.displayName, s.kills, s.deaths, s.assists]),
    });
    expect((snapshot(rb) as { rows: unknown[][] }).rows[0]).toEqual([winner.entityId, "Winner", 5, 1, 0]);

    // A client joining mid-results gets the same standings and deadline without any message replay.
    const c = await loginClient(h, "Latecomer");
    const rc = await c.join(code);
    let cues = 0; rc.onMessage("roundOver", () => { cues++; });
    await waitFor(() => rc.state.phase === "roundOver" && rc.state.roundStandings.length > 0, 3000, "late join sees results");
    expect(snapshot(rc)).toEqual(snapshot(rb));

    // Drop and reconnect the watcher during results: same state again, nothing replayed.
    const token = rb.reconnectionToken;
    rb.reconnection.enabled = false;
    rb.connection.close(4010, "network lost");
    await waitFor(() => [...players(ra).values()].some((p) => p.displayName === "Watcher" && p.connected === false), 3000, "watcher dropped");
    const back = await new Client(`ws://localhost:${h.port}`).reconnect(token);
    await waitFor(() => back.state.phase === "roundOver" && back.state.roundStandings.length > 0, 3000, "reconnect sees results");
    expect(snapshot(back)).toEqual(snapshot(rc));

    // The winner leaves: frozen standings still name the winner.
    await ra.leave();
    await waitFor(() => !players(rc).has(String(winner.entityId)), 3000, "winner removed");
    expect(live.state.phase).toBe("roundOver");
    expect((snapshot(rc) as { rows: unknown[][] }).rows[0]![1]).toBe("Winner");

    // Exactly +599 still results, exactly +600 resets scores/standings/deadline and bumps the round number.
    while (tick < koTick + ROUND_OVER_TICKS - 1) live.stepTick(++tick);
    expect(live.state.phase).toBe("roundOver");
    expect(live.state.roundStandings.length).toBeGreaterThan(0);
    live.stepTick(++tick);
    expect(tick).toBe(koTick + ROUND_OVER_TICKS);
    expect(live.state.phase).toBe("playing");
    expect(live.state.roundStandings.length).toBe(0);
    expect(live.state.roundEndsAtTick).toBe(0);
    expect(live.state.roundNumber).toBe(2);
    for (const p of live.state.players.values()) expect([p.kills, p.deaths, p.assists]).toEqual([0, 0, 0]);
    await waitFor(() => rc.state.roundNumber === 2 && rc.state.roundStandings.length === 0 && rc.state.phase === "playing", 3000, "reset replicated");
    expect(cues).toBe(0);
    await c.leave(); await b.leave();
    h.svc.roomMeta.delete(code);
  });

  test("a hosted sparring room mirrors its target into state, and botless admin creation stays endless", async () => {
    const r = await rig(10);
    expect(r.room.state.roundTarget).toBe(10);
    r.room.leave();
    const code = freshCode();
    h.svc.roomMeta.set(code, { name: "NoBots", listed: true, roundTarget: 5 });
    const room = await matchMaker.createRoom("arena", { roomCode: code });
    const live = matchMaker.getLocalRoomById(room.roomId) as unknown as BotArenaRoom;
    expect(live.state.roundTarget).toBe(0);
    h.svc.roomMeta.delete(code);
    await live.disconnect();
  });
});
